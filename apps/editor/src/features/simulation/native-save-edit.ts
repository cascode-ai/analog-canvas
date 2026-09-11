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
