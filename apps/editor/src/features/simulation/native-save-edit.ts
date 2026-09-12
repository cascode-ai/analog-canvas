/** Insert before analyses, or extend the save statement under the cursor. */
export function nativeSaveEdit(
  text: string,
  cursor: number,
  vectors: readonly string[],
  entry: boolean,
) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const start = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const newline = text.indexOf("\n", cursor);
  const end = newline < 0 ? text.length : newline;
  const line = text.slice(start, end).replace(/\r$/u, "");
  if (/^\s*\.?save(?:\s|$)/iu.test(line)) {
    const missing = vectors.filter(
      (v) => !line.toLowerCase().split(/\s+/u).includes(v.toLowerCase()),
    );
    return {
      from: start + line.length,
      insert: missing.length ? " " + missing.join(" ") : "",
    };
  }
  const control = /^\s*\.control[^\r\n]*(?:\r?\n|$)/imu.exec(text);
  const from = control
    ? control.index + control[0].length
    : entry
      ? text.indexOf("\n") < 0
        ? text.length
        : text.indexOf("\n") + 1
      : 0;
  return {
    from,
    insert:
      (from > 0 && text[from - 1] !== "\n" ? eol : "") +
      `${control ? "save" : ".save"} ${vectors.join(" ")}${eol}`,
  };
}

/** One undoable native edit, including deck-level .probe cards when required. */
export function nativeAcquisitionEdit(
  text: string,
  cursor: number,
  vectors: readonly string[],
  entry: boolean,
  directives: readonly string[] = [],
) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const existing = new Set(
    text.split(/\r?\n/u).map((line) => line.trim().toLowerCase()),
  );
  const missing = directives.filter(
    (line) => !existing.has(line.toLowerCase()),
  );
  let next = text;
  let anchor = cursor;
  if (missing.length) {
    const from = entry
      ? text.indexOf("\n") < 0
        ? text.length
        : text.indexOf("\n") + 1
      : 0;
    const insert =
      (from > 0 && text[from - 1] !== "\n" ? eol : "") +
      missing.join(eol) +
      eol;
    next = text.slice(0, from) + insert + text.slice(from);
    anchor = cursor >= from ? cursor + insert.length : cursor;
    if (!vectors.length) anchor = from + insert.length;
  }
  if (vectors.length) {
    const edit = nativeSaveEdit(next, anchor, vectors, entry);
    next = next.slice(0, edit.from) + edit.insert + next.slice(edit.from);
    anchor = edit.from + edit.insert.replace(/[\r\n]+$/u, "").length;
  }
  return { text: next, anchor };
}
