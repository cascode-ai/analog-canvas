/** CodeMirror indexes normalized LF text; File Resource indexes exact authored UTF-16. */
export function editorText(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}
export function sourceOffset(text: string, offset: number): number {
  let editor = 0,
    source = 0;
  while (editor < offset && source < text.length) {
    source += text[source] === "\r" && text[source + 1] === "\n" ? 2 : 1;
    editor++;
  }
  return source;
}
export function editorOffset(text: string, offset: number): number {
  let editor = 0,
    source = 0;
  while (source < Math.min(offset, text.length)) {
    source += text[source] === "\r" && text[source + 1] === "\n" ? 2 : 1;
    editor++;
  }
  return editor;
}
export interface CodeTextChange {
  from: number;
  to: number;
  text: string;
}
/** Preserve all untouched bytes, even mixed line endings; new lines use the source's first separator. */
export function applyCodeTextChanges(
  text: string,
  changes: readonly CodeTextChange[],
): string {
  const newline = /\r\n|\r|\n/u.exec(text)?.[0] ?? "\n";
  let result = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    result =
      result.slice(0, sourceOffset(text, change.from)) +
      editorText(change.text).replace(/\n/gu, newline) +
      result.slice(sourceOffset(text, change.to));
  }
  return result;
}
