import type { CommandA, CommandC } from "svg-pathdata";
import type { DerivedPoint } from "./schema/types.js";

export interface BodyCurve {
  readonly from: DerivedPoint;
  readonly to: DerivedPoint;
  readonly at: (t: number) => DerivedPoint;
  readonly xExtrema: readonly number[];
  readonly yExtrema: readonly number[];
  readonly linear: boolean;
  readonly projectionExtrema: (x: number, y: number) => readonly number[];
}

function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b;
}

export function bodyLine(from: DerivedPoint, to: DerivedPoint): BodyCurve {
  if (!Number.isFinite(to.x - from.x) || !Number.isFinite(to.y - from.y))
    throw new Error("Path line geometry must be finite");
  return {
    from,
    to,
    linear: true,
    xExtrema: [],
    yExtrema: [],
    projectionExtrema: () => [],
    at: (t) => ({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }),
  };
}

function cubicAt(
  a: number,
  b: number,
  c: number,
  d: number,
  t: number,
): number {
  const middle = lerp(b, c, t);
  return lerp(
    lerp(lerp(a, b, t), middle, t),
    lerp(middle, lerp(c, d, t), t),
    t,
  );
}

function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
  const scale = Math.max(Math.abs(b - a), Math.abs(c - b), Math.abs(d - c));
  if (!scale) return [];
  if (!Number.isFinite(scale))
    throw new Error("Path curve geometry must be finite");
  const first = (b - a) / scale;
  const next = (c - b) / scale;
  const last = (d - c) / scale;
  const quadratic = first - 2 * next + last;
  const linear = 2 * (next - first);
  const within = (t: number) => 0 < t && t < 1;
  if (quadratic === 0) return [-first / linear].filter(within);
  const discriminant = linear ** 2 - 4 * quadratic * first;
  if (discriminant <= 0) return [];
  // Compute the large root first so close extrema keep their precision.
  const q = -(linear + (linear < 0 ? -1 : 1) * Math.sqrt(discriminant)) / 2;
  return [q / quadratic, first / q].filter(within);
}

export function bodyCubic(
  from: DerivedPoint,
  to: DerivedPoint,
  command: CommandC,
): BodyCurve {
  const { x1, y1, x2, y2 } = command;
  return {
    from,
    to,
    linear: false,
    xExtrema: cubicExtrema(from.x, x1, x2, to.x),
    yExtrema: cubicExtrema(from.y, y1, y2, to.y),
    projectionExtrema: (x, y) => {
      // A common power-of-two scale leaves derivative roots unchanged and
      // keeps finite source controls safe through sums and differences.
      const ordinate = (px: number, py: number) => (px / 4) * x + (py / 4) * y;
      return cubicExtrema(
        ordinate(from.x, from.y),
        ordinate(x1, y1),
        ordinate(x2, y2),
        ordinate(to.x, to.y),
      );
    },
    at: (t) => ({
      x: cubicAt(from.x, x1, x2, to.x, t),
      y: cubicAt(from.y, y1, y2, to.y, t),
    }),
  };
}

function arcExtrema(
  start: number,
  sweep: number,
  cosine: number,
  sine: number,
) {
  const extremum = Math.atan2(sine, cosine);
  const low = Math.min(start, start + sweep);
  const high = Math.max(start, start + sweep);
  const roots: number[] = [];
  const first = Math.floor((low - extremum) / Math.PI) + 1;
  for (let turn = first; extremum + turn * Math.PI < high; turn++) {
    roots.push((extremum + turn * Math.PI - start) / sweep);
  }
  return roots;
}

export function bodyArc(
  from: DerivedPoint,
  to: DerivedPoint,
  command: CommandA,
): BodyCurve | undefined {
  if (from.x === to.x && from.y === to.y) return undefined;
  const rotation = (((command.xRot % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let rx = Math.abs(command.rX);
  let ry = Math.abs(command.rY);
  if (!rx || !ry) return bodyLine(from, to);

  // SVG 2 Appendix B, endpoint to center conversion and radius correction.
  const dx = from.x / 2 - to.x / 2;
  const dy = from.y / 2 - to.y / 2;
  const u = (dx * cos + dy * sin) / rx;
  const v = (-dx * sin + dy * cos) / ry;
  const distance = Math.hypot(u, v);
  if (!distance || !Number.isFinite(distance))
    throw new Error("Path arc geometry must be finite");
  const scale = Math.max(1, distance);
  rx *= scale;
  ry *= scale;
  const side = command.lArcFlag === command.sweepFlag ? -1 : 1;
  const factor = side * Math.sqrt(Math.max(0, 1 - (distance / scale) ** 2));
  const offsetU = (v / distance) * factor;
  const offsetV = (-u / distance) * factor;
  const start = Math.atan2(v / scale - offsetV, u / scale - offsetU);
  const end = Math.atan2(-v / scale - offsetV, -u / scale - offsetU);
  let sweep = end - start;
  const revolution = 2 * Math.PI;
  if (command.sweepFlag && sweep < 0) sweep += revolution;
  if (!command.sweepFlag && sweep > 0) sweep -= revolution;
  if (!sweep) throw new Error("Path arc span is too small to resolve");
  const xCos = rx * cos;
  const xSin = -ry * sin;
  const yCos = rx * sin;
  const ySin = ry * cos;
  const cx = from.x / 2 + to.x / 2 + offsetU * xCos + offsetV * xSin;
  const cy = from.y / 2 + to.y / 2 + offsetU * yCos + offsetV * ySin;
  return {
    from,
    to,
    linear: false,
    xExtrema: arcExtrema(start, sweep, xCos, xSin),
    yExtrema: arcExtrema(start, sweep, yCos, ySin),
    projectionExtrema: (x, y) =>
      arcExtrema(
        start,
        sweep,
        x * (xCos / 2) + y * (yCos / 2),
        x * (xSin / 2) + y * (ySin / 2),
      ),
    at: (t) => {
      const angle = start + t * sweep;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return { x: cx + xCos * c + xSin * s, y: cy + yCos * c + ySin * s };
    },
  };
}

export function bodyCurvePoint(curve: BodyCurve, t: number): DerivedPoint {
  return t === 0 ? curve.from : t === 1 ? curve.to : curve.at(t);
}
