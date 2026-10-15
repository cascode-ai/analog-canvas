import { orientPoint, type RnlOrient } from "./orientation.js";

/**
 * Analog Canvas units in one RNL unit. An RNL unit is one grid step, the
 * editor's default 10-unit grid; it is fixed rather than read from a
 * Document's grid, so that symbol coordinates stay the same everywhere.
 */
export const AC_UNITS_PER_RNL_UNIT = 10;

export type RnlPoint = readonly [x: number, y: number];

/** Coordinates are kept to a millionth, which absorbs binary rounding. */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}

/** An Analog Canvas point (y down) in RNL scene coordinates (y up). */
export function toRnlPoint(point: { x: number; y: number }): RnlPoint {
  return [
    clean(point.x / AC_UNITS_PER_RNL_UNIT),
    clean(-point.y / AC_UNITS_PER_RNL_UNIT),
  ];
}

/** An RNL scene point back in Analog Canvas coordinates. */
function fromRnlPoint([x, y]: RnlPoint): { x: number; y: number } {
  return {
    x: clean(x * AC_UNITS_PER_RNL_UNIT),
    y: clean(-y * AC_UNITS_PER_RNL_UNIT),
  };
}

/**
 * Where RNL places a part: its Analog Canvas origin moved to the symbol's
 * registration point. `offset` is that point in the Analog Canvas symbol's
 * own frame, in RNL units, and turns with the part.
 */
export function rnlPlace(
  position: { x: number; y: number },
  orient: RnlOrient,
  offset: RnlPoint,
): RnlPoint {
  const [x, y] = toRnlPoint(position);
  const [dx, dy] = orientPoint(orient, offset);
  return [clean(x + dx), clean(y + dy)];
}

/** The Analog Canvas origin of a part RNL places at `place`. */
export function acPosition(
  place: RnlPoint,
  orient: RnlOrient,
  offset: RnlPoint,
): { x: number; y: number } {
  const [dx, dy] = orientPoint(orient, offset);
  return fromRnlPoint([place[0] - dx, place[1] - dy]);
}
