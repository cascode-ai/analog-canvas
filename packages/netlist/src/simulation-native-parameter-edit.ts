/** An unfinished, source-owned declaration, not a persisted variable override.
 * Entry files start with a literal title; included files have no title. Insert
 * before any circuit/include/control scope, even when the existing draft is
 * syntactically incomplete. Callers apply this edit through their normal file
 * transaction and fill in the declaration at anchor. */
export function nativeParameterDeclarationEdit(text: string, entry: boolean) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const newline = text.indexOf("\n");
  const from = entry ? (newline < 0 ? text.length : newline + 1) : 0;
  const prefix =
    entry && newline < 0 ? `${text ? "" : "Simulation"}${eol}` : "";
  const head = `${prefix}parameters `;
  const insert = `${head}${eol}`;
  return {
    text: text.slice(0, from) + insert + text.slice(from),
    changes: [{ from, to: from, insert }],
    anchor: from + head.length,
  };
}
