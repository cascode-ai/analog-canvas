/** Update only the named MCP's launch and origin; unrelated host settings survive. */
export function codexMcpConfig(
  text: string,
  name: string,
  launch: { command: string; args: string[]; env: Record<string, string> },
): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw Error("Invalid MCP server name");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let result = text;
  if (
    /^\s*\[\s*mcp_servers\s*\]/mu.test(text) ||
    /^\s*mcp_servers\s*=/mu.test(text)
  )
    throw Error(
      "Inline MCP tables require manual configuration; existing file unchanged",
    );
  function section(suffix: string, fields: Record<string, unknown>) {
    const header = `mcp_servers.${name}${suffix}`;
    const quoted = `mcp_servers."${name}"${suffix}`;
    const literal = `mcp_servers.'${name}'${suffix}`;
    const lines = result.split(/\r?\n/u);
    const matches = lines.flatMap((line, index) => {
      const trimmed = line.trim().replace(/\s+#.*$/u, "");
      const spaced = new RegExp(
        `^\\[\\s*mcp_servers\\s*\\.\\s*(?:${name}|"${name}"|'${name}')\\s*${suffix ? "\\.\\s*env\\s*" : ""}\\]$`,
        "u",
      );
      return trimmed === `[${header}]` ||
        trimmed === `[${quoted}]` ||
        trimmed === `[${literal}]` ||
        spaced.test(trimmed)
        ? [index]
        : [];
    });
    if (matches.length > 1)
      throw Error(`Ambiguous duplicate configuration: ${header}`);
    if (!matches.length) {
      result =
        result.replace(/\s*$/u, "") +
        eol +
        eol +
        `[${header}]` +
        eol +
        Object.entries(fields)
          .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
          .join(eol) +
        eol;
      return;
    }
    const start = matches[0]!;
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/u.test(lines[end]!)) end++;
    const body = lines.slice(start + 1, end);
    for (const [key, value] of Object.entries(fields)) {
      const pattern = new RegExp(`^\\s*(?:${key}|"${key}")\\s*=`, "u");
      const indexes = body.flatMap((line, index) =>
        pattern.test(line) ? [index] : [],
      );
      if (indexes.length > 1) throw Error(`Duplicate ${header}.${key}`);
      const replacement = `${key} = ${JSON.stringify(value)}`;
      if (!indexes.length) {
        body.unshift(replacement);
        continue;
      }
      const index = indexes[0]!;
      // Support the ordinary one-line and multiline string-array args forms.
      // Refuse unfamiliar syntax rather than corrupt an existing host file.
      const old = body[index]!.slice(body[index]!.indexOf("=") + 1).trim();
      if (key === "args" && old.includes("#"))
        throw Error(
          "Commented MCP args require manual configuration; existing file unchanged",
        );
      if (key === "args" && old.startsWith("[") && !old.includes("]")) {
        let last = index + 1;
        while (last < body.length && !/^\s*\]\s*(?:#.*)?$/u.test(body[last]!))
          last++;
        if (last === body.length) throw Error("Unterminated MCP args array");
        body.splice(index, last - index + 1, replacement);
      } else {
        if (
          (key === "args" && !/^\[.*\](?:\s*#.*)?$/u.test(old)) ||
          (key !== "args" &&
            !/^(?:"[^\r\n]*"|'[^\r\n]*')(?:\s*#.*)?$/u.test(old))
        )
          throw Error(
            `Unsupported ${header}.${key} syntax; keep the old configuration`,
          );
        body[index] = replacement;
      }
    }
    lines.splice(start + 1, end - start - 1, ...body);
    result = lines.join(eol);
  }
  section("", { command: launch.command, args: launch.args });
  section(".env", launch.env);
  return result;
}
