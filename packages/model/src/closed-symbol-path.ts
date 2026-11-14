import { SVGPathData, SVGPathDataTransformer } from "svg-pathdata";
import type { DerivedPoint, DerivedRect } from "./schema/types.js";
import {
  bodyArc,
  bodyCubic,
  bodyCurvePoint,
  bodyLine,
  type BodyCurve,
} from "./closed-symbol-curves.js";

interface ClosedSymbolPath {
  readonly bounds: DerivedRect;
  contains(point: DerivedPoint): boolean;
  segmentWitness(
    from: DerivedPoint,
    to: DerivedPoint,
  ): DerivedPoint | undefined;
  /** Actual straight edges and on-curve samples of the authored outline. */
  outlineEvidence(): {
    readonly points: readonly DerivedPoint[];
    readonly segments: readonly { from: DerivedPoint; to: DerivedPoint }[];
  };
}

type PathResult =
  | { readonly ok: true; readonly geometry: ClosedSymbolPath }
  | { readonly ok: false; readonly message: string };

const MAX_PATH_LENGTH = 1_048_576;
const MAX_COMMANDS = 65_536;

function requireFiniteGeometry(values: object): void {
  if (
    Object.values(values).some(
      (value) => typeof value === "number" && !Number.isFinite(value),
    )
  )
    throw new Error("Path coordinates must be finite");
}

function samePoint(a: DerivedPoint, b: DerivedPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

interface CrossingSegment {
  readonly curve: BodyCurve;
  readonly from: DerivedPoint;
  readonly to: DerivedPoint;
  readonly start: number;
  readonly end: number;
}

function crossingSegments(curve: BodyCurve): CrossingSegment[] {
  // Split horizontal cubics by x as well so even a reversal has its true extent.
  const extrema =
    curve.yExtrema.length || curve.from.y !== curve.to.y
      ? curve.yExtrema
      : curve.xExtrema;
  const knots = [0, ...[...new Set(extrema)].sort((a, b) => a - b), 1];
  const points = knots.map((t) => bodyCurvePoint(curve, t));
  return knots.slice(1).flatMap((end, index) => {
    const start = knots[index];
    const from = points[index];
    const to = points[index + 1];
    return start !== undefined && from && to
      ? [{ curve, start, end, from, to }]
      : [];
  });
}

// A curve between consecutive y extrema has at most one crossing. Bisect
// its parameter on the source curve, preserving holes next to grid anchors.
function crossingX(segment: CrossingSegment, y: number): number {
  const { from, to, curve } = segment;
  if (y === from.y) return from.x;
  if (y === to.y) return to.x;
  if (curve.linear) {
    const t = (y - from.y) / (to.y - from.y);
    return (1 - t) * from.x + t * to.x;
  }
  let { start, end } = segment;
  const increasing = to.y > from.y;
  for (let i = 0; i < 54; i++) {
    const middle = (start + end) / 2;
    const point = curve.at(middle);
    if (point.y === y || middle === start || middle === end) return point.x;
    const below = point.y < y;
    if (below === increasing) start = middle;
    else end = middle;
  }
  return curve.at((start + end) / 2).x;
}

function crossingParity(
  segments: readonly CrossingSegment[],
  point: DerivedPoint,
  scale: number,
): { inside: boolean; onBoundary: boolean } {
  let inside = false;
  let onBoundary = false;
  const epsilon = scale * Number.EPSILON * 8;
  for (const segment of segments) {
    const { from, to } = segment;
    if (point.y < Math.min(from.y, to.y) || point.y > Math.max(from.y, to.y))
      continue;
    if (from.y === to.y) {
      if (
        point.x >= Math.min(from.x, to.x) &&
        point.x <= Math.max(from.x, to.x)
      )
        onBoundary = true;
      continue;
    }
    const x = crossingX(segment, point.y);
    if (Math.abs(x - point.x) <= epsilon) onBoundary = true;
    // Count the low vertex and exclude the high vertex of each segment.
    if (x > point.x && point.y < Math.max(from.y, to.y)) inside = !inside;
  }
  return { inside, onBoundary };
}

function containsPoint(
  segments: readonly CrossingSegment[],
  bounds: DerivedRect,
  point: DerivedPoint,
): boolean {
  const scale = Math.max(
    Math.abs(point.x),
    Math.abs(point.y),
    bounds.width,
    bounds.height,
  );
  const parity = crossingParity(segments, point, scale);
  if (!parity.onBoundary) return parity.inside;
  // SVG includes a boundary that borders the fill. An edge retraced by the
  // path can be part of its outline stroke without bordering any fill.
  const delta = scale * Number.EPSILON * 64;
  for (const dx of [-delta, 0, delta])
    for (const dy of [-delta, 0, delta]) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = crossingParity(
        segments,
        { x: point.x + dx, y: point.y + dy },
        scale,
      );
      if (neighbor.inside && !neighbor.onBoundary) return true;
    }
  return false;
}

function crossingPositions(
  segments: readonly CrossingSegment[],
  y: number,
  fromBelow = false,
): number[] {
  const xs: number[] = [];
  for (const segment of segments) {
    const { from, to } = segment;
    const low = Math.min(from.y, to.y);
    const high = Math.max(from.y, to.y);
    const crosses = fromBelow ? low < y && y <= high : low <= y && y < high;
    if (crosses) xs.push(crossingX(segment, y));
  }
  return xs.sort((a, b) => a - b);
}

function crossingInterval(
  segments: readonly CrossingSegment[],
  y: number,
  tolerance: number,
): boolean {
  const xs = crossingPositions(segments, y);
  for (let index = 1; index < xs.length; index += 2) {
    const start = xs[index - 1];
    const end = xs[index];
    if (start !== undefined && end !== undefined && end - start > tolerance)
      return true;
  }
  return false;
}

function segmentWitness(
  curves: readonly BodyCurve[],
  horizontalSegments: readonly CrossingSegment[],
  bounds: DerivedRect,
  from: DerivedPoint,
  to: DerivedPoint,
): DerivedPoint | undefined {
  if (
    Math.max(from.x, to.x) < bounds.x ||
    Math.min(from.x, to.x) > bounds.x + bounds.width ||
    Math.max(from.y, to.y) < bounds.y ||
    Math.min(from.y, to.y) > bounds.y + bounds.height
  )
    return undefined;
  const dx = to.x / 4 - from.x / 4;
  const dy = to.y / 4 - from.y / 4;
  const length = Math.hypot(dx, dy);
  if (!length || !Number.isFinite(length)) return undefined;
  const x = dx / length;
  const y = dy / length;
  // In segment coordinates, the finite segment is the row y=0, x=0..length.
  const project = (point: DerivedPoint): DerivedPoint => {
    const px = point.x / 4 - from.x / 4;
    const py = point.y / 4 - from.y / 4;
    const left = py * x;
    const right = px * y;
    const normal = left - right;
    // Keep a collinear point on the scan row despite product roundoff.
    const roundoff = (Math.abs(left) + Math.abs(right)) * Number.EPSILON * 4;
    return { x: px * x + py * y, y: Math.abs(normal) <= roundoff ? 0 : normal };
  };
  const segments =
    dy === 0
      ? horizontalSegments
      : curves.flatMap((curve) => {
          const scanned: BodyCurve = {
            ...curve,
            from: project(curve.from),
            to: project(curve.to),
            at: (t) => project(curve.at(t)),
            xExtrema: curve.projectionExtrema(x, y),
            yExtrema: curve.projectionExtrema(-y, x),
          };
          return crossingSegments(scanned);
        });
  const row = dy === 0 ? from.y : 0;
  const witnessOnRow = (fromBelow: boolean): DerivedPoint | undefined => {
    const crossings = crossingPositions(segments, row, fromBelow);
    const xs =
      dy === 0
        ? crossings.map((value) => (value / 4 - from.x / 4) * x)
        : crossings;
    if (dy === 0 && x < 0) xs.reverse();
    const tolerance = length * Number.EPSILON * 16;
    for (let index = 1; index < xs.length; index += 2) {
      const left = xs[index - 1];
      const right = xs[index];
      if (left === undefined || right === undefined) continue;
      const start = Math.max(0, left);
      const end = Math.min(length, right);
      if (!(end - start > tolerance)) continue;
      const t = (start + (end - start) / 2) / length;
      const point = {
        x: (1 - t) * from.x + t * to.x,
        y: (1 - t) * from.y + t * to.y,
      };
      return containsPoint(horizontalSegments, bounds, point)
        ? point
        : undefined;
    }
    return undefined;
  };
  // At a collinear edge the fill can border either side of the scan row.
  return witnessOnRow(false) ?? witnessOnRow(true);
}

function outlineEvidence(
  curves: readonly BodyCurve[],
): ReturnType<ClosedSymbolPath["outlineEvidence"]> {
  const points: DerivedPoint[] = [];
  const segments: { from: DerivedPoint; to: DerivedPoint }[] = [];
  for (const curve of curves) {
    if (curve.linear) segments.push({ from: curve.from, to: curve.to });
    else points.push(curve.from, curve.at(0.5), curve.to);
  }
  return { points, segments };
}

function hasFilledInterval(
  segments: readonly CrossingSegment[],
  bounds: DerivedRect,
): boolean {
  const span = bounds.height;
  if (!span || !bounds.width) return false;
  const scale = Math.max(Math.abs(bounds.x), bounds.width);
  const tolerance = scale * Number.EPSILON * 16;
  // First check several interior rows across the bounds. Then sweep the
  // intervals between successive endpoints/extrema to find narrow lobes.
  for (const t of [0.5, 0.25, 0.75, 0.125, 0.875])
    if (crossingInterval(segments, bounds.y + t * span, tolerance)) return true;
  const levels = [
    ...new Set(segments.flatMap(({ from, to }) => [from.y, to.y])),
  ].sort((a, b) => a - b);
  const rows = levels.length - 1;
  // Limit work for intentionally cancelling inputs. A missed narrow lobe
  // is reported at authoring instead of installing a body with no usable face.
  const limit = Math.min(
    rows,
    Math.max(5, Math.floor(1_048_576 / segments.length)),
  );
  for (let sample = 0; sample < limit; sample++) {
    const index = Math.floor((sample * rows) / limit);
    const low = levels[index];
    const high = levels[index + 1];
    if (low === undefined || high === undefined) continue;
    for (const t of [0.5, 0.211, 0.789]) {
      const y = (1 - t) * low + t * high;
      if (low < y && y < high && crossingInterval(segments, y, tolerance))
        return true;
    }
  }
  return false;
}

function measurePath(curves: readonly BodyCurve[]): DerivedRect {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const curve of curves)
    for (const t of [0, 1, ...curve.xExtrema, ...curve.yExtrema]) {
      const point = bodyCurvePoint(curve, t);
      requireFiniteGeometry(point);
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
    }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  requireFiniteGeometry(bounds);
  return bounds;
}

function parseClosedPath(data: string): ClosedSymbolPath {
  if (data.length > MAX_PATH_LENGTH)
    throw new Error("Body path exceeds 1 MiB of SVG path data");
  const path = new SVGPathData(data);
  if (path.commands.length > MAX_COMMANDS)
    throw new Error("Path body geometry is too complex");
  // Normalization can replace zero-radius arcs and discard their parameters.
  for (const command of path.commands) requireFiniteGeometry(command);
  path
    .toAbs()
    .normalizeST()
    .qtToC()
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, false));

  const curves: BodyCurve[] = [];
  const segments: CrossingSegment[] = [];
  let contour: BodyCurve[] = [];
  let start: DerivedPoint | undefined;
  let current: DerivedPoint | undefined;
  for (const command of path.commands) {
    requireFiniteGeometry(command);
    if (command.type === SVGPathData.MOVE_TO) {
      if (start) throw new Error("Every body subpath must end with Z");
      start = current = { x: command.x, y: command.y };
      continue;
    }
    if (!start || !current)
      throw new Error("Each body subpath must start with M and end with Z");
    if (command.type === SVGPathData.CLOSE_PATH) {
      if (!samePoint(current, start)) contour.push(bodyLine(current, start));
      const crossings = contour.flatMap(crossingSegments);
      if (
        !contour.length ||
        !hasFilledInterval(crossings, measurePath(contour))
      )
        throw new Error("Each body subpath must enclose an area");
      for (const curve of contour) curves.push(curve);
      for (const segment of crossings) segments.push(segment);
      contour = [];
      start = current = undefined;
      continue;
    }
    if (!("x" in command) || !("y" in command))
      throw new Error("Body path contains unresolved geometry");
    const next = { x: command.x, y: command.y };
    switch (command.type) {
      case SVGPathData.LINE_TO:
        if (!samePoint(current, next)) contour.push(bodyLine(current, next));
        break;
      case SVGPathData.CURVE_TO:
        contour.push(bodyCubic(current, next, command));
        break;
      case SVGPathData.ARC: {
        const arc = bodyArc(current, next, command);
        if (arc) contour.push(arc);
        break;
      }
      case SVGPathData.QUAD_TO:
      case SVGPathData.SMOOTH_QUAD_TO:
      case SVGPathData.SMOOTH_CURVE_TO:
        throw new Error("Body path contains unresolved geometry");
    }
    current = next;
  }
  if (start || !curves.length)
    throw new Error("Every body subpath must end with Z");
  const bounds = measurePath(curves);
  if (!hasFilledInterval(segments, bounds))
    throw new Error(
      "Body path must enclose an area after applying even-odd fill",
    );
  return {
    bounds,
    contains: (point) => containsPoint(segments, bounds, point),
    segmentWitness: (from, to) =>
      segmentWitness(curves, segments, bounds, from, to),
    outlineEvidence: () => outlineEvidence(curves),
  };
}

/** Validate and prepare the same closed path that the formal SVG draws. */
export function resolveClosedSymbolPath(data: string): PathResult {
  try {
    return { ok: true, geometry: parseClosedPath(data) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid path data",
    };
  }
}
