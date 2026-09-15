import type { Point } from "@icm/model";

const ANGLE_EPSILON = 1e-6;

/**
 * True when a visible wire segment is neither orthogonal nor a standard 45°
 * diagonal. Degenerate segments are handled by route normalization and are
 * deliberately excluded from this visual-quality classification.
 */
export function isNonStandardWireAngle(from: Point, to: Point): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx <= ANGLE_EPSILON || dy <= ANGLE_EPSILON) return false;
  return Math.abs(dx - dy) > ANGLE_EPSILON;
}
