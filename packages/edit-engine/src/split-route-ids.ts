import { deriveStableId } from "@icm/model";

/** The longest piece ID that keeps the readable `${parent}-a-${marker}` form. */
const READABLE_PIECE_ID_LIMIT = 128;

/** The IDs of the two pieces one split of a Route makes. */
export interface SplitRoutePieceIds {
  /** The piece from the Route's start to the split point. */
  firstRouteId: string;
  /** The piece from the split point to the Route's end. */
  secondRouteId: string;
}

/**
 * Name the two pieces a split of `parentRouteId` makes. `marker` is what
 * makes this split unique: an intent ID and side, or a session suffix.
 *
 * The pieces read `${parent}-a-${marker}` and `${parent}-b-${marker}` while
 * that fits in 128 characters. Tapping one wire again and again splits pieces
 * named after pieces, and the readable form grows by a marker per tap, so past
 * the bound each piece takes a short ID derived from the parent, its side and
 * the marker: deterministic, distinct for the two sides, and well inside
 * StableIdSchema's 256 characters however often the wire is tapped.
 */
export function splitRoutePieceIds(
  parentRouteId: string,
  marker: string | number,
): SplitRoutePieceIds {
  const firstRouteId = `${parentRouteId}-a-${marker}`;
  if (firstRouteId.length <= READABLE_PIECE_ID_LIMIT) {
    return { firstRouteId, secondRouteId: `${parentRouteId}-b-${marker}` };
  }
  return {
    firstRouteId: deriveStableId("route", parentRouteId, "a", String(marker)),
    secondRouteId: deriveStableId("route", parentRouteId, "b", String(marker)),
  };
}
