import {
  inspectVacaskSource,
  type VacaskSourceStatement,
  type VacaskSourceToken,
} from "./vacask-source.js";

const bare = (s: VacaskSourceStatement, name: string) =>
  s.tokens[0]?.value === name &&
  s.rawText.startsWith(name) &&
  s.tokens[0].end - s.tokens[0].start === name.length;
const key = (tokens: readonly VacaskSourceToken[]) =>
  JSON.stringify(tokens.map((t) => [t.kind, t.value]));

/** Split only complete native selectors. Quoted hierarchy and comma spacing
 * remain semantic identity; Out and out are deliberately distinct. */
function selectors(tokens: readonly VacaskSourceToken[]) {
  const result: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const head = tokens[i]!;
    if (head.kind !== "word") return undefined;
    if (["default", "full"].includes(head.value)) {
      result.push(key([head]));
      i++;
      continue;
    }
    const size =
      head.value === "p" ? 6 : ["v", "i"].includes(head.value) ? 4 : 0;
    const group = tokens.slice(i, i + size);
    if (
      !size ||
      group.length !== size ||
      group[1]?.value !== "(" ||
      group[1]?.kind !== "symbol" ||
      group[2]?.kind !== "word" ||
      group.at(-1)?.value !== ")" ||
      group.at(-1)?.kind !== "symbol" ||
      (size === 6 && (group[3]?.value !== "," || group[4]?.kind !== "word"))
    )
      return undefined;
    result.push(key(group));
    i += size;
  }
  return result;
}

/** Pure shared API: caller applies returned sequential insertions through the
 * normal File/Project or editor transaction. No persistent settings or IO.
 * The helper authors common save selectors; arbitrary native programs remain
 * editable as text, including analysis-specific directives not covered here. */
export function nativeAcquisitionEdit(
  text: string,
  cursor: number,
  requested: readonly string[],
  entry: boolean,
  oldDirectives: readonly string[] = [],
) {
  const failure = (message: string) => ({
    ok: false as const,
    error: { code: "SIMULATION_SAVE_EDIT_INVALID", message },
    text,
    anchor: cursor,
    changes: [],
  });
  if (oldDirectives.length)
    return failure(
      "VACASK does not use ngspice .probe cards. Select a native branch or device output, or author the required sense circuit explicitly.",
    );
  const wanted = new Map<string, string>();
  for (const value of requested) {
    const selector = value.trim();
    const parsed = inspectVacaskSource("selection", `save ${selector}`);
    const statement = parsed.statements[0];
    const keys = statement && selectors(statement.tokens.slice(1));
    if (
      parsed.diagnostics.length ||
      parsed.statements.length !== 1 ||
      !keys ||
      keys.length !== 1 ||
      statement?.sourceRef.end.offset !== selector.length + 5 ||
      /[\r\n]/u.test(value)
    )
      return failure(
        "Choose one native v(node), i(instance), p(instance, output), default or full selector; edit other native directives directly in Code.",
      );
    wanted.set(keys[0]!, selector);
  }
  const point = Math.max(0, Math.min(text.length, cursor));
  if (!wanted.size)
    return { ok: true as const, text, anchor: point, changes: [] };
  const parsed = inspectVacaskSource("edit", text, entry);
  if (parsed.diagnostics.length)
    return failure(
      "Finish the incomplete native string or statement before inserting a save; your source remains unchanged.",
    );
  if (
    parsed.statements.some((s) =>
      [".control", ".endc", ".save", ".probe"].includes(
        s.tokens[0]?.value ?? "",
      ),
    )
  )
    return failure(
      "Translate this legacy control program to native VACASK before using the save helper; its original source remains editable.",
    );
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let from: number, insert: string;
  const underCursor = parsed.statements.find(
    (s) =>
      bare(s, "save") &&
      s.sourceRef.start.offset <= point &&
      point <=
        (text.indexOf("\n", s.sourceRef.end.offset) < 0
          ? text.length
          : text.indexOf("\n", s.sourceRef.end.offset)),
  );
  if (underCursor) {
    const existing = new Set(selectors(underCursor.tokens.slice(1)) ?? []);
    const missing = [...wanted]
      .filter(([k]) => !existing.has(k))
      .map(([, value]) => value);
    from = underCursor.sourceRef.end.offset;
    insert = missing.length ? ` ${missing.join(" ")}` : "";
  } else {
    const blocks: { start: VacaskSourceStatement; end: number }[] = [];
    let open: VacaskSourceStatement | undefined;
    for (const statement of parsed.statements) {
      if (bare(statement, "control")) {
        if (open)
          return failure(
            "Resolve the nested control block before inserting a save.",
          );
        open = statement;
      } else if (bare(statement, "endc") && open) {
        blocks.push({ start: open, end: statement.sourceRef.start.offset });
        open = undefined;
      }
    }
    if (open) blocks.push({ start: open, end: text.length });
    const block =
      blocks.find(
        (b) => b.start.sourceRef.end.offset <= point && point <= b.end,
      ) ?? blocks[0];
    const line = `save ${[...wanted.values()].join(" ")}`;
    if (!block) {
      if (!entry)
        return failure(
          "Select the entry or a source file containing control before inserting a new save statement.",
        );
      from = text.length;
      insert =
        (from && !text.endsWith("\n") ? eol : "") +
        `control${eol}${line}${eol}endc${eol}`;
    } else {
      // Clear resets the acquisition scope. Never deduplicate against saves
      // before the user's most recent clear, which no longer applies here.
      const reset = parsed.statements
        .filter(
          (s) =>
            bare(s, "clear") &&
            s.sourceRef.start.offset > block.start.sourceRef.start.offset &&
            s.sourceRef.end.offset <= Math.min(point, block.end) &&
            (s.tokens.length === 1 ||
              s.tokens.slice(1).some((t) => t.value === "saves")),
        )
        .at(-1);
      const after = (reset ?? block.start).sourceRef.end.offset;
      const newline = text.indexOf("\n", after);
      from = newline < 0 ? text.length : newline + 1;
      insert = (from && text[from - 1] !== "\n" ? eol : "") + line + eol;
    }
  }
  return {
    ok: true as const,
    text: text.slice(0, from) + insert + text.slice(from),
    anchor: from + insert.replace(/[\r\n]+$/u, "").length,
    changes: insert ? [{ from, insert }] : [],
  };
}
