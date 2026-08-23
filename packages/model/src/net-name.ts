/** Sole case-folding rule for logical Net marker names. */
export function foldNetName(name: string): string {
  return name.trim().toLowerCase();
}
