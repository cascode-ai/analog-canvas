import { transformPoint, type Mirror, type Orientation } from "@icm/model";

/**
 * RNL's eight orientations (language standard 11.2): mirror first, then turn
 * counter-clockwise, with y up. Only quarter turns exist.
 */
export type RnlOrient =
  "R0" | "R90" | "R180" | "R270" | "MY" | "MX" | "MYR90" | "MXR90";

type Matrix = readonly [a: number, b: number, c: number, d: number];

/** Each code as the matrix taking (x, y) to (a x + b y, c x + d y), y up. */
const MATRICES: Readonly<Record<RnlOrient, Matrix>> = {
  R0: [1, 0, 0, 1],
  R90: [0, -1, 1, 0],
  R180: [-1, 0, 0, -1],
  R270: [0, 1, -1, 0],
  MY: [-1, 0, 0, 1],
  MX: [1, 0, 0, -1],
  MYR90: [0, -1, -1, 0],
  MXR90: [0, 1, 1, 0],
};

const CODES = Object.keys(MATRICES) as RnlOrient[];

export type RnlOrientResult =
  | { ok: true; orient: RnlOrient }
  /** RNL has no 45° turns; the export refuses such a part. */
  | { ok: false; reason: "not-quarter-turn" };

/**
 * The RNL orientation that draws a part the way an Analog Canvas orientation
 * does. Analog Canvas turns, then mirrors in world axes, with y down; its
 * matrix seen with y up is F·M·F, F = diag(1, −1).
 */
export function rnlOrient(orientation: Orientation): RnlOrientResult {
  const origin = { x: 0, y: 0 };
  const ex = transformPoint({ x: 1, y: 0 }, origin, orientation);
  const ey = transformPoint({ x: 0, y: 1 }, origin, orientation);
  const matrix = [ex.x, -ey.x, -ex.y, ey.y].map((value) => value + 0);
  const orient = CODES.find((code) =>
    MATRICES[code].every((value, index) => value === matrix[index]),
  );
  return orient
    ? { ok: true, orient }
    : { ok: false, reason: "not-quarter-turn" };
}

const CANONICAL: readonly Orientation[] = ([0, 90, 180, 270] as const).flatMap(
  (rotation) =>
    (["none", "horizontal"] as const satisfies readonly Mirror[]).map(
      (mirror) => ({ rotation, mirror }),
    ),
);

/**
 * The Analog Canvas orientation drawing a part as an RNL code does, written
 * as a quarter turn with no mirror or a left-right mirror; Analog Canvas
 * spells some of these with a vertical mirror too, which draws the same.
 */
export function acOrientation(orient: RnlOrient): Orientation {
  const found = CANONICAL.find((orientation) => {
    const result = rnlOrient(orientation);
    return result.ok && result.orient === orient;
  });
  return found!;
}

/** The orientation that turns a point by `inner`, then by `outer`. */
export function composeOrient(outer: RnlOrient, inner: RnlOrient): RnlOrient {
  const [a, b, c, d] = MATRICES[outer];
  const [e, f, g, h] = MATRICES[inner];
  const product = [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
  return CODES.find((code) =>
    MATRICES[code].every((value, index) => value === product[index]),
  )!;
}

/** A point in a symbol's own frame turned by an RNL orientation, y up. */
export function orientPoint(
  orient: RnlOrient,
  [x, y]: readonly [number, number],
): [number, number] {
  const [a, b, c, d] = MATRICES[orient];
  return [a * x + b * y + 0, c * x + d * y + 0];
}
