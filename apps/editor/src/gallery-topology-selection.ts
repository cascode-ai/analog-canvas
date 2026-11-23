/**
 * A non-exact candidate reads as close from this similarity up. In the
 * Gallery of 2026-10-07, related circuits scored above it: two
 * folded-cascode op amps 0.84, two bandgaps 0.51 and 0.53, a band-stop and a
 * band-pass ladder 0.58. 99% of unrelated pairs scored under 0.43, so a
 * circuit with no real relative listed five near-zero "nearest" ones (#1443).
 */
export const CLOSE_MATCH_SIMILARITY = 0.5;
/** At most this many close non-exact candidates; exact matches all show. */
const NEAREST_LIMIT = 3;

/**
 * The duplicate check's shown results, the same in this browser and on the
 * server: every exact match and the closest few close ones, ranked by
 * similarity, exact first, then name and id. `omitted` counts close ones
 * beyond the few.
 */
export function closeTopologyMatches<
  Match extends {
    exact: boolean;
    similarity: number;
    entry: { id: string; name: string };
  },
>(candidates: readonly Match[]): { matches: Match[]; omitted: number } {
  const ranked = [...candidates].sort(
    (left, right) =>
      right.similarity - left.similarity ||
      Number(right.exact) - Number(left.exact) ||
      left.entry.name.localeCompare(right.entry.name) ||
      left.entry.id.localeCompare(right.entry.id),
  );
  let close = 0;
  const matches = ranked.filter(
    (match) =>
      match.exact ||
      (match.similarity >= CLOSE_MATCH_SIMILARITY && close++ < NEAREST_LIMIT),
  );
  return { matches, omitted: Math.max(0, close - NEAREST_LIMIT) };
}

/** Count every comparison before ranking can discard its witness. */
export function countTopologyComparison(
  report: {
    comparable: number;
    exactMatches?: number;
    limitedComparisons?: number;
  },
  result: { exact: boolean; limited: boolean },
): void {
  report.comparable++;
  if (result.exact) report.exactMatches = (report.exactMatches ?? 0) + 1;
  if (result.limited)
    report.limitedComparisons = (report.limitedComparisons ?? 0) + 1;
}
