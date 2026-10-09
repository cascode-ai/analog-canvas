/** SVG attribute text every layer shares: escaped values and point lists. */

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function pointList(
  points: ReadonlyArray<{ x: number; y: number }>,
): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
