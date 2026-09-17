import type { Point, SegmentMode } from "@icm/model";
import { areCollinear, polylineSatisfiesConstraint } from "@icm/derived";

export type { SegmentMode } from "@icm/model";

export interface RouteEditPath {
  points: readonly Point[];
  segmentModes: readonly SegmentMode[];
}

export interface RoutedEndpointGeometry {
  contactPoint: Point;
  gridLanding: Point;
  outward: Point | null;
}

export interface OrthogonalEscapeRoute {
  points: Point[];
  waypoints: Point[];
  segmentModes: SegmentMode[];
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

export function isOrthogonal(points: readonly Point[]): boolean {
  return polylineSatisfiesConstraint(points, "orthogonal");
}

/** Valid persisted interactive geometry.  Authoring policy stays in planner. */
export function isOctilinear(points: readonly Point[]): boolean {
  return polylineSatisfiesConstraint(points, "octilinear");
}

const MODE_PRIORITY: Record<SegmentMode, number> = {
  auto: 0,
  escape: 1,
  manual: 2,
  trunk: 3,
  locked: 4,
};

export function strongerMode(
  left: SegmentMode,
  right: SegmentMode,
): SegmentMode {
  return MODE_PRIORITY[left] >= MODE_PRIORITY[right] ? left : right;
}

export function normalizeRouteGeometry(
  points: readonly Point[],
  segmentModes: readonly SegmentMode[],
): { points: Point[]; segmentModes: SegmentMode[] } {
  if (points.length < 2 || segmentModes.length !== points.length - 1) {
    throw new Error("Route normalization requires one mode per segment");
  }
  const normalizedPoints: Point[] = [{ ...points[0]! }];
  const normalizedModes: SegmentMode[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const mode = segmentModes[index - 1]!;
    if (samePoint(normalizedPoints.at(-1)!, point)) {
      if (normalizedModes.length > 0) {
        normalizedModes[normalizedModes.length - 1] = strongerMode(
          normalizedModes.at(-1)!,
          mode,
        );
      }
      continue;
    }
    normalizedPoints.push({ ...point });
    normalizedModes.push(mode);
    while (normalizedPoints.length >= 3) {
      const a = normalizedPoints.at(-3)!;
      const b = normalizedPoints.at(-2)!;
      const c = normalizedPoints.at(-1)!;
      if (!areCollinear(a, b, c)) {
        break;
      }
      const mergedMode = strongerMode(
        normalizedModes.at(-2)!,
        normalizedModes.at(-1)!,
      );
      normalizedPoints.splice(-2, 1);
      normalizedModes.splice(-2, 2, mergedMode);
    }
  }
  return { points: normalizedPoints, segmentModes: normalizedModes };
}

function offsetPoint(point: Point, direction: Point, distance: number): Point {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

/**
 * Builds an orthogonal path whose first/last segment leaves a terminal in the
 * resolved outward pin direction. This is an Agent-side authoring helper; the
 * returned waypoints remain ordinary canonical Route geometry.
 */
export function buildOrthogonalEscapeRoute(
  from: RoutedEndpointGeometry,
  to: RoutedEndpointGeometry,
  escapeLength = 20,
  connectionGrid = 10,
): OrthogonalEscapeRoute {
  if (!Number.isInteger(escapeLength) || escapeLength <= 0) {
    throw new Error("Route escape length must be a positive integer");
  }
  if (!Number.isInteger(connectionGrid) || connectionGrid <= 0) {
    throw new Error("Route connection grid must be a positive integer");
  }
  const snapToConnectionGrid = (value: number) =>
    Math.round(value / connectionGrid) * connectionGrid;
  const rawPoints: Point[] = [{ ...from.contactPoint }];
  const rawModes: SegmentMode[] = [];
  const append = (point: Point, mode: SegmentMode) => {
    const previous = rawPoints.at(-1)!;
    if (previous.x === point.x && previous.y === point.y) return;
    rawPoints.push({ ...point });
    rawModes.push(mode);
  };

  const fromOutward = from.outward;
  const toOutward = to.outward;
  if (!samePoint(from.contactPoint, from.gridLanding)) {
    append(from.gridLanding, "escape");
  }
  const fromEscape = fromOutward
    ? offsetPoint(from.gridLanding, fromOutward, escapeLength)
    : from.gridLanding;
  const toEscape = toOutward
    ? offsetPoint(to.gridLanding, toOutward, escapeLength)
    : to.gridLanding;
  if (fromOutward) append(fromEscape, "escape");

  const current = rawPoints.at(-1)!;
  const aligned = current.x === toEscape.x || current.y === toEscape.y;
  const fromWouldReverse =
    fromOutward !== null &&
    (toEscape.x - from.contactPoint.x) * fromOutward.x +
      (toEscape.y - from.contactPoint.y) * fromOutward.y <=
      0;
  const toWouldReverse =
    toOutward !== null &&
    (current.x - to.contactPoint.x) * toOutward.x +
      (current.y - to.contactPoint.y) * toOutward.y <=
      0;
  if (
    fromOutward &&
    toOutward &&
    !(aligned && !fromWouldReverse && !toWouldReverse)
  ) {
    if (fromOutward.x !== 0 && toOutward.x !== 0) {
      const middleY =
        fromEscape.y === toEscape.y
          ? fromEscape.y + escapeLength
          : snapToConnectionGrid((fromEscape.y + toEscape.y) / 2);
      append({ x: fromEscape.x, y: middleY }, "auto");
      append({ x: toEscape.x, y: middleY }, "auto");
    } else if (fromOutward.y !== 0 && toOutward.y !== 0) {
      const middleX =
        fromEscape.x === toEscape.x
          ? fromEscape.x + escapeLength
          : snapToConnectionGrid((fromEscape.x + toEscape.x) / 2);
      append({ x: middleX, y: fromEscape.y }, "auto");
      append({ x: middleX, y: toEscape.y }, "auto");
    } else if (fromOutward.x !== 0) {
      append({ x: fromEscape.x, y: toEscape.y }, "auto");
    } else {
      append({ x: toEscape.x, y: fromEscape.y }, "auto");
    }
  } else if (aligned && (fromWouldReverse || toWouldReverse)) {
    if (current.y === toEscape.y) {
      const detourY = current.y + escapeLength;
      append({ x: current.x, y: detourY }, "auto");
      append({ x: toEscape.x, y: detourY }, "auto");
    } else {
      const detourX = current.x + escapeLength;
      append({ x: detourX, y: current.y }, "auto");
      append({ x: detourX, y: toEscape.y }, "auto");
    }
  } else if (!aligned) {
    const bend = fromOutward
      ? fromOutward.x !== 0
        ? { x: current.x, y: toEscape.y }
        : { x: toEscape.x, y: current.y }
      : toOutward
        ? toOutward.x !== 0
          ? { x: toEscape.x, y: current.y }
          : { x: current.x, y: toEscape.y }
        : { x: toEscape.x, y: current.y };
    append(bend, "auto");
  }
  append(toEscape, "auto");
  if (!samePoint(toEscape, to.gridLanding)) append(to.gridLanding, "escape");
  if (!samePoint(to.gridLanding, to.contactPoint)) {
    append(to.contactPoint, "escape");
  }

  const normalized = normalizeRouteGeometry(rawPoints, rawModes);
  return {
    points: normalized.points,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

export interface DiagonalSegmentDrag {
  /** Rigid translation of the dragged run, along exactly one axis. */
  move: Point;
  /** First and last polyline point indices that travel with the diagonal. */
  first: number;
  last: number;
}

/**
 * Where a dragged 45-degree segment goes. It never moves diagonally: it
 * translates along the dominant axis of the pointer's travel from `origin`
 * (horizontally when no origin is known). An adjacent leg perpendicular to
 * that axis travels with it, just as an orthogonal segment carries nothing
 * but stretches its perpendicular neighbors.
 */
export function planDiagonalSegmentDrag(
  points: readonly Point[],
  segmentIndex: number,
  target: Point,
  origin?: Point,
): DiagonalSegmentDrag {
  const from = points[segmentIndex]!;
  const to = points[segmentIndex + 1]!;
  let move: Point;
  if (origin) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    move =
      Math.abs(dx) >= Math.abs(dy) ? { x: dx || 0, y: 0 } : { x: 0, y: dy };
  } else {
    // The horizontal shift that puts the diagonal's line through the target.
    const slope = Math.sign((to.y - from.y) / (to.x - from.x));
    const offset = target.y - slope * target.x - (from.y - slope * from.x);
    move = { x: -slope * offset || 0, y: 0 };
  }
  const axis = move.y === 0 ? "x" : "y";
  let first = segmentIndex;
  let last = segmentIndex + 1;
  if (first > 0 && points[first - 1]![axis] === from[axis]) first -= 1;
  if (last < points.length - 1 && points[last + 1]![axis] === to[axis]) {
    last += 1;
  }
  return { move, first, last };
}

function acuteTurnCount(points: readonly Point[]): number {
  let count = 0;
  for (let index = 1; index + 1 < points.length; index += 1) {
    const before = points[index - 1]!;
    const at = points[index]!;
    const after = points[index + 1]!;
    const dot =
      (at.x - before.x) * (after.x - at.x) +
      (at.y - before.y) * (after.y - at.y);
    if (dot < 0) count += 1;
  }
  return count;
}

/**
 * Translate the run of `planDiagonalSegmentDrag` rigidly. Each end of the run
 * slides when its outside leg lies along the move, and otherwise stays behind
 * with a jog along the move: at a slanted leg, or at a fixed Route end. A
 * `carried` Route end moves with the run instead; the caller moves its
 * Junction by the same translation.
 */
function moveDiagonalSegment(
  points: readonly Point[],
  modes: readonly SegmentMode[],
  segmentIndex: number,
  target: Point,
  origin: Point | undefined,
  carried: { from?: boolean; to?: boolean },
): { waypoints: Point[]; segmentModes: SegmentMode[] } {
  const { move, first, last } = planDiagonalSegmentDrag(
    points,
    segmentIndex,
    target,
    origin,
  );
  if (
    modes
      .slice(Math.max(0, first - 1), last + 1)
      .some((mode) => mode === "locked" || mode === "trunk")
  ) {
    throw new Error("Route segment or its neighbor is protected");
  }
  const across = move.y === 0 ? "y" : "x";
  const lastIndex = points.length - 1;
  const staysBehind = (index: number, outside: number | null): boolean =>
    outside === null
      ? index === 0
        ? carried.from !== true
        : carried.to !== true
      : points[outside]![across] !== points[index]![across];
  const firstStays = staysBehind(first, first > 0 ? first - 1 : null);
  const lastStays = staysBehind(last, last < lastIndex ? last + 1 : null);
  // A lead that leaves its pin is authored wire, no longer a derived stub.
  const authored = (mode: SegmentMode): SegmentMode =>
    mode === "escape" ? "manual" : mode;
  const nextPoints: Point[] = points.slice(0, first);
  const nextModes: SegmentMode[] = modes.slice(0, first);
  if (firstStays) {
    nextPoints.push({ ...points[first]! });
    nextModes.push(authored(modes[first]!));
  }
  for (let index = first; index <= last; index += 1) {
    nextPoints.push({
      x: points[index]!.x + move.x,
      y: points[index]!.y + move.y,
    });
    if (index < last) nextModes.push(authored(modes[index]!));
  }
  if (lastStays) {
    nextPoints.push({ ...points[last]! });
    nextModes.push(authored(modes[last - 1]!));
  }
  nextPoints.push(...points.slice(last + 1));
  nextModes.push(...modes.slice(last));
  const normalized = normalizeRouteGeometry(nextPoints, nextModes);
  if (!isOctilinear(normalized.points)) {
    throw new Error("Diagonal segment move would make geometry non-octilinear");
  }
  // A leg shrunk past its far end, or a jog that doubles back against the
  // diagonal, would fold the wire over itself. The drag holds instead.
  if (acuteTurnCount(normalized.points) > acuteTurnCount(points)) {
    throw new Error("Diagonal segment move would fold the wire back");
  }
  return {
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

export function moveRouteSegment(
  polyline: RouteEditPath,
  segmentIndex: number,
  target: Point,
  {
    origin,
    carried = {},
  }: {
    /** Where the drag began, which picks a diagonal's axis. */
    origin?: Point | undefined;
    /** Route ends whose Junction the caller moves with a diagonal. */
    carried?: { from?: boolean; to?: boolean };
  } = {},
): { waypoints: Point[]; segmentModes: SegmentMode[] } {
  if (segmentIndex < 0 || segmentIndex >= polyline.points.length - 1) {
    throw new Error(`Route segment index is out of range: ${segmentIndex}`);
  }
  const affectedModes = [
    polyline.segmentModes[segmentIndex - 1],
    polyline.segmentModes[segmentIndex],
    polyline.segmentModes[segmentIndex + 1],
  ].filter((mode): mode is SegmentMode => mode !== undefined);
  if (affectedModes.some((mode) => mode === "locked" || mode === "trunk")) {
    throw new Error("Route segment or its neighbor is protected");
  }

  const points = polyline.points.map((point) => ({ ...point }));
  const modes = [...polyline.segmentModes];
  const from = points[segmentIndex]!;
  const to = points[segmentIndex + 1]!;
  const horizontal = from.y === to.y;
  const vertical = from.x === to.x;
  const slanted = !horizontal && !vertical;
  const diagonal =
    slanted && Math.abs(to.x - from.x) === Math.abs(to.y - from.y);
  const lastSegmentIndex = points.length - 2;

  if (diagonal) {
    return moveDiagonalSegment(
      points,
      modes,
      segmentIndex,
      target,
      origin,
      carried,
    );
  }

  // A slanted leg outside the 45-degree family should never survive an
  // edit, so its drag both moves and repairs it: the leg is replaced by an
  // orthogonal Z along its dominant axis through the dragged coordinate,
  // with perpendicular jogs at the unmoved endpoints. Model geometry can
  // hold such a leg (an imported or auto-laid-out file), and refusing the
  // drag would leave no mouse-only way to fix it.
  if (slanted) {
    const axis: "x" | "y" =
      Math.abs(to.y - from.y) > Math.abs(to.x - from.x) ? "x" : "y";
    const coordinate = target[axis];
    const shiftedFrom = { ...from, [axis]: coordinate };
    const shiftedTo = { ...to, [axis]: coordinate };
    const mode = modes[segmentIndex] ?? "manual";
    points.splice(segmentIndex + 1, 0, shiftedFrom, shiftedTo);
    modes.splice(segmentIndex, 1, mode, mode, mode);
    const normalized = normalizeRouteGeometry(points, modes);
    if (!isOctilinear(normalized.points)) {
      throw new Error(
        "Slanted segment move would make geometry non-octilinear",
      );
    }
    return {
      waypoints: normalized.points.slice(1, -1),
      segmentModes: normalized.segmentModes,
    };
  }

  if (points.length === 2) {
    const moved = horizontal
      ? [
          points[0]!,
          { x: points[0]!.x, y: target.y },
          { x: points[1]!.x, y: target.y },
          points[1]!,
        ]
      : [
          points[0]!,
          { x: target.x, y: points[0]!.y },
          { x: target.x, y: points[1]!.y },
          points[1]!,
        ];
    // Dragging a derived escape lead authors real wire geometry: the moved
    // leg leaves the pin axis and the new endpoint stubs arrive across it,
    // so nothing here may stay "escape" or commit validation rejects it.
    const sourceMode = modes[0] ?? "manual";
    const mode = sourceMode === "escape" ? "manual" : sourceMode;
    const normalized = normalizeRouteGeometry(moved, [mode, mode, mode]);
    return {
      waypoints: normalized.points.slice(1, -1),
      segmentModes: normalized.segmentModes,
    };
  }

  if (segmentIndex === 0) {
    const fixedEndpoint = points[0]!;
    if (horizontal) {
      points[1]!.y = target.y;
      points.splice(1, 0, { x: fixedEndpoint.x, y: target.y });
    } else {
      points[1]!.x = target.x;
      points.splice(1, 0, { x: target.x, y: fixedEndpoint.y });
    }
    const stubMode = modes[0] === "escape" ? "manual" : modes[0]!;
    modes.splice(0, 1, stubMode, stubMode);
  } else if (segmentIndex === lastSegmentIndex) {
    const fixedEndpoint = points.at(-1)!;
    if (horizontal) {
      points[segmentIndex]!.y = target.y;
      points.splice(-1, 0, { x: fixedEndpoint.x, y: target.y });
    } else {
      points[segmentIndex]!.x = target.x;
      points.splice(-1, 0, { x: target.x, y: fixedEndpoint.y });
    }
    const stubMode =
      modes[segmentIndex] === "escape" ? "manual" : modes[segmentIndex]!;
    modes.splice(segmentIndex, 1, stubMode, stubMode);
  } else if (horizontal) {
    points[segmentIndex]!.y = target.y;
    points[segmentIndex + 1]!.y = target.y;
  } else {
    points[segmentIndex]!.x = target.x;
    points[segmentIndex + 1]!.x = target.x;
  }

  const normalized = normalizeRouteGeometry(points, modes);
  if (!isOrthogonal(normalized.points)) {
    throw new Error("Route segment move would make geometry non-orthogonal");
  }
  return {
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

/** Adds an explicit orthogonal jog to the selected unprotected segment. */

export type PinAxis = "horizontal" | "vertical" | null;

/**
 * The axis a pin's lead is drawn along, reported only when following it also
 * carries the wire toward the other end. A pin whose lead points away from
 * where the wire has to go needs an escape stub rather than a corner, which
 * is beyond what a stretch may invent, so it reports no axis and leaves the
 * heading to the fallback.
 */
export function usablePinAxis(
  outward: Point | null,
  self: Point,
  other: Point,
): PinAxis {
  if (!outward) return null;
  const toward =
    (other.x - self.x) * outward.x + (other.y - self.y) * outward.y;
  if (toward <= 0) return null;
  if (outward.x !== 0 && outward.y === 0) return "horizontal";
  if (outward.y !== 0 && outward.x === 0) return "vertical";
  return null;
}

/**
 * Bends that keep a stretched single segment meeting both pins along their
 * own leads.
 *
 * A one-segment Route is adjacent to both endpoints at once, so it is the
 * only shape where following the moved end can spoil the end that stayed
 * put. A pin is drawn with its lead along the outward direction; a wire that
 * arrives across that axis lands on the side of the symbol and runs over its
 * artwork instead of meeting the lead. One corner can serve only one end, so
 * pins whose axes are parallel get two corners and a crossbar between them.
 * Either axis may be unusable — a Junction has no lead, and a lead pointing
 * away from the other end cannot be followed — and then the usable one
 * decides; with neither, the segment keeps its original heading.
 */
export function bridgeStretchedSegment(
  from: Point,
  to: Point,
  fromAxis: PinAxis,
  toAxis: PinAxis,
  originallyVertical: boolean,
  grid: number,
): Point[] {
  const snap = (value: number): number =>
    grid > 0 ? Math.round(value / grid) * grid : value;
  if (fromAxis === "vertical" && toAxis === "vertical") {
    const crossbar = snap((from.y + to.y) / 2);
    return [
      { x: from.x, y: crossbar },
      { x: to.x, y: crossbar },
    ];
  }
  if (fromAxis === "horizontal" && toAxis === "horizontal") {
    const crossbar = snap((from.x + to.x) / 2);
    return [
      { x: crossbar, y: from.y },
      { x: crossbar, y: to.y },
    ];
  }
  const leavesVertically =
    fromAxis === "vertical" ||
    toAxis === "horizontal" ||
    (fromAxis === null && toAxis === null && originallyVertical);
  return [leavesVertically ? { x: from.x, y: to.y } : { x: to.x, y: from.y }];
}
