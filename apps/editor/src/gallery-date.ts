/**
 * A Gallery circuit's date as every page shows it, "Oct 19, 2026" in an
 * English browser: the wall's tiles and a phone's circuit page alike.
 */
export function galleryDateLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
