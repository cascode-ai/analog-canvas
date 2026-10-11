/** Short location hint; keep the exact path in the element's title. */
export function nativePathLabel(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  const tail = parts
    .slice(-2)
    .map((part) => (/^[a-f\d-]{36}$/iu.test(part) ? part.slice(0, 8) : part));
  return `${parts.length > 2 ? "… / " : ""}${tail.join(" / ")}`;
}
