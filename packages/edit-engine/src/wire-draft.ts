// Manual wire paths: authored clicks compiled to persisted Route geometry,
// each leg orthogonal, octilinear or free, with doubled-back legs dropped.
import type { EndpointRoutingGeometry } from "@icm/derived";
import {
  normalizeRouteGeometry,
  strongerMode,
  type SegmentMode,
} from "./route-geometry-edit.js";
import type { Point } from "@icm/model";

export interface WireEndpointGeometry {
  connection: EndpointRoutingGeometry;
}

export interface ManualWirePath {
  points: Point[];
  waypoints: Point[];
  segmentModes: SegmentMode[];
}

/** A transient command constraint, never a second persisted Route type. */
export type WireRoutingMode = "orthogonal" | "octilinear" | "free";
/**
 * Which leg of a corner is drawn first. `diagonal-first`/`orthogonal-first`
 * order an octilinear corner; `horizontal-first`/`vertical-first` order an
 * orthogonal one. `auto` keeps the incoming segment's direction, which is the
 * behavior every existing draft relies on.
 */
export type WireCornerOrder =
  | "auto"
  | "diagonal-first"
  | "orthogonal-first"
  | "horizontal-first"
  | "vertical-first";

/** One authored click. The compiler may insert an unpersisted elbow. */
export interface WireDraftStep {
  point: Point;
  routingMode: WireRoutingMode;
  cornerOrder?: WireCornerOrder;
}

export interface WireDraftOptions {
  steps?: readonly WireDraftStep[];
  routingMode?: WireRoutingMode;
  cornerOrder?: WireCornerOrder;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function append(
  points: Point[],
  modes: SegmentMode[],
  point: Point,
  mode: SegmentMode,
): void {
  if (samePoint(points.at(-1)!, point)) return;
  points.push({ ...point });
  modes.push(mode);
}

function appendOrthogonal(
  points: Point[],
  modes: SegmentMode[],
  target: Point,
  mode: SegmentMode,
  cornerOrder: WireCornerOrder = "auto",
): void {
  const last = points.at(-1)!;
  if (samePoint(last, target)) return;
  if (last.x !== target.x && last.y !== target.y) {
    const previous = points.at(-2);
    // An explicit axis wins; otherwise the corner carries the incoming
    // segment's direction through before it turns.
    const horizontalFirst =
      cornerOrder === "horizontal-first"
        ? true
        : cornerOrder === "vertical-first"
          ? false
          : previous
            ? previous.y === last.y
            : true;
    append(
      points,
      modes,
      horizontalFirst ? { x: target.x, y: last.y } : { x: last.x, y: target.y },
      mode,
    );
  }
  append(points, modes, target, mode);
}

function appendOctilinear(
  points: Point[],
  modes: SegmentMode[],
  target: Point,
  mode: SegmentMode,
  cornerOrder: WireCornerOrder,
): void {
  const last = points.at(-1)!;
  if (samePoint(last, target)) return;
  const dx = target.x - last.x;
  const dy = target.y - last.y;
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
    append(points, modes, target, mode);
    return;
  }
  const diagonalDistance = Math.min(Math.abs(dx), Math.abs(dy));
  const diagonal = {
    x: last.x + Math.sign(dx) * diagonalDistance,
    y: last.y + Math.sign(dy) * diagonalDistance,
  };
  const useDiagonalFirst = cornerOrder !== "orthogonal-first";
  if (useDiagonalFirst) {
    append(points, modes, diagonal, mode);
  } else if (Math.abs(dx) > Math.abs(dy)) {
    append(
      points,
      modes,
      { x: target.x - Math.sign(dx) * diagonalDistance, y: last.y },
      mode,
    );
  } else {
    append(
      points,
      modes,
      { x: last.x, y: target.y - Math.sign(dy) * diagonalDistance },
      mode,
    );
  }
  append(points, modes, target, mode);
}

/**
 * Compile authored wire clicks to ordinary persisted Route geometry.  A mode
 * applies only to the leg being authored; prior compiled legs are immutable.
 */
/**
 * Drop legs that double back along the leg before them.
 *
 * Authoring keeps whatever the pointer traced: pull left, come back right and
 * the wire folds over itself; overshoot downwards and return and the overshoot
 * hangs past the corner as a stub. Both paint on top of a line already drawn,
 * so neither is geometry anyone asked for.
 *
 * `normalizeRouteGeometry` will not do this — its collinearity test means
 * collinear *and continuing*, which is what crossing detection and hit testing
 * need. Only the authored path wants the wider reading, so it is folded in
 * here rather than in the shared normalizer.
 */
export function cancelDoubledBackLegs(
  points: readonly Point[],
  modes: readonly SegmentMode[],
): { points: Point[]; segmentModes: SegmentMode[] } {
  const keptPoints: Point[] = [];
  const keptModes: SegmentMode[] = [];
  for (const [index, point] of points.entries()) {
    keptPoints.push({ ...point });
    if (index > 0) keptModes.push(modes[index - 1]!);
    for (;;) {
      const count = keptPoints.length;
      if (count < 3) break;
      const first = keptPoints[count - 3]!;
      const middle = keptPoints[count - 2]!;
      const last = keptPoints[count - 1]!;
      const before = { x: middle.x - first.x, y: middle.y - first.y };
      const after = { x: last.x - middle.x, y: last.y - middle.y };
      const onOneLine = before.x * after.y - before.y * after.x === 0;
      const reverses = before.x * after.x + before.y * after.y < 0;
      if (!onOneLine || !reverses) break;
      keptPoints.splice(count - 2, 1);
      keptModes.splice(
        count - 3,
        2,
        strongerMode(keptModes[count - 3]!, keptModes[count - 2]!),
      );
      if (samePoint(keptPoints.at(-2)!, keptPoints.at(-1)!)) {
        keptPoints.pop();
        keptModes.pop();
      }
    }
  }
  return { points: keptPoints, segmentModes: keptModes };
}

export function compileWireDraft(
  from: WireEndpointGeometry,
  to: WireEndpointGeometry,
  steps: readonly WireDraftStep[] = [],
  finalRoutingMode: WireRoutingMode = "orthogonal",
  finalCornerOrder: WireCornerOrder = "auto",
): ManualWirePath {
  const points: Point[] = [{ ...from.connection.gridLanding }];
  const modes: SegmentMode[] = [];
  const appendStep = (step: WireDraftStep) => {
    // A free leg is the straight line to the click: no elbow is inserted, so
    // the wire lands at whatever angle reaches the endpoint.
    if (step.routingMode === "free") {
      append(points, modes, step.point, "manual");
      return;
    }
    if (step.routingMode === "orthogonal") {
      appendOrthogonal(
        points,
        modes,
        step.point,
        "manual",
        step.cornerOrder ?? "auto",
      );
    } else {
      appendOctilinear(
        points,
        modes,
        step.point,
        "manual",
        step.cornerOrder ?? "auto",
      );
    }
  };
  for (const step of steps) appendStep(step);
  appendStep({
    point: to.connection.gridLanding,
    routingMode: finalRoutingMode,
    cornerOrder: finalCornerOrder,
  });
  const straightened =
    points.length === 1
      ? { points, segmentModes: [] as SegmentMode[] }
      : cancelDoubledBackLegs(points, modes);
  const normalized =
    straightened.points.length === 1
      ? straightened
      : normalizeRouteGeometry(straightened.points, straightened.segmentModes);
  const authoredPoints: Point[] = [{ ...from.connection.contactPoint }];
  const authoredModes: SegmentMode[] = [];
  const appendAuthored = (point: Point, mode: SegmentMode) => {
    const previous = authoredPoints.at(-1);
    if (previous?.x === point.x && previous.y === point.y) return;
    if (previous) authoredModes.push(mode);
    authoredPoints.push({ ...point });
  };
  appendAuthored(from.connection.gridLanding, "escape");
  for (let index = 1; index < normalized.points.length; index += 1) {
    appendAuthored(
      normalized.points[index]!,
      normalized.segmentModes[index - 1] ?? "manual",
    );
  }
  appendAuthored(to.connection.contactPoint, "escape");
  return {
    points: authoredPoints,
    waypoints: authoredPoints.slice(1, -1),
    segmentModes: authoredModes,
  };
}

/** Build a persisted manual orthogonal path without hidden terminal escapes. */
export function buildManualWirePath(
  from: WireEndpointGeometry,
  to: WireEndpointGeometry,
  manualWaypoints: readonly Point[] = [],
): ManualWirePath {
  return compileWireDraft(
    from,
    to,
    manualWaypoints.map((point) => ({ point, routingMode: "orthogonal" })),
  );
}
