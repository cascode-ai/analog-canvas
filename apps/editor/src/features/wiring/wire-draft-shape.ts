import { resolveRouteGeometry, visibleSymbolInkBounds } from "@icm/derived";
import {
  compileWireDraft,
  type WireCornerOrder,
  type WireDraftStep,
  type WireRoutingMode,
  type WireSource,
} from "@icm/edit-engine";
import {
  transformPoint,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

type Axis = "horizontal" | "vertical";

/** The shape a fresh wire compiles to: the drawer's clicks, ordered. */
export interface WireDraftShapeChoice {
  steps: readonly WireDraftStep[];
  cornerOrder: WireCornerOrder;
}

function step(point: Point): WireDraftStep {
  return { point, routingMode: "orthogonal" };
}

function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  if (from.x === to.x) {
    return (
      point.x === from.x &&
      point.y >= Math.min(from.y, to.y) &&
      point.y <= Math.max(from.y, to.y)
    );
  }
  if (from.y === to.y) {
    return (
      point.y === from.y &&
      point.x >= Math.min(from.x, to.x) &&
      point.x <= Math.max(from.x, to.x)
    );
  }
  return false;
}

/**
 * Pins the wire would run over without joining them.
 *
 * A contact is only made with a third component: the planner never joins the
 * wire to another pin of the very components it is attaching to. So a leg
 * drawn across such a pin draws a meeting that does not exist — the one shape
 * the editor may not hand back.
 */
function overrunPins(
  from: WireSource,
  to: WireSource,
  visibleEndpoints: readonly WireSource[],
): Point[] {
  const owners = new Set(
    [from.endpoint, to.endpoint]
      .filter((endpoint) => endpoint.kind === "terminal")
      .map((endpoint) => (endpoint as { instanceId: string }).instanceId),
  );
  if (owners.size === 0) return [];
  const ends = [from, to].map(
    (source) => source.connection.contactPoint,
  ) as Point[];
  return visibleEndpoints
    .filter(
      (candidate) =>
        candidate.endpoint.kind === "terminal" &&
        owners.has(candidate.endpoint.instanceId) &&
        !ends.some(
          (end) =>
            end.x === candidate.connection.contactPoint.x &&
            end.y === candidate.connection.contactPoint.y,
        ),
    )
    .map((candidate) => candidate.connection.contactPoint);
}

function overruns(points: readonly Point[], pins: readonly Point[]): number {
  return pins.filter((pin) =>
    points
      .slice(0, -1)
      .some((point, index) => pointOnSegment(pin, point, points[index + 1]!)),
  ).length;
}

/**
 * The drawn bodies of the components this wire attaches to.
 *
 * Only theirs: a run deliberately crossing some other symbol is the drawer's
 * business, but a wire that cuts through the very component it lands on is
 * drawing a part it is also drawing over.
 */
interface EndpointObstacle {
  box: Rect;
  /** Which ends of the wire this component owns. */
  owns: { start: boolean; end: boolean };
}

function endpointInk(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
): EndpointObstacle[] {
  const owners = new Set(
    [from.endpoint, to.endpoint]
      .filter((endpoint) => endpoint.kind === "terminal")
      .map((endpoint) => (endpoint as { instanceId: string }).instanceId),
  );
  return document.instances.flatMap((instance) => {
    if (!instance.placement || !owners.has(instance.id)) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return [];
    const local = visibleSymbolInkBounds(
      resolved,
      instance.signalFlowParameters,
    );
    const corners = [
      { x: local.x, y: local.y },
      { x: local.x + local.width, y: local.y },
      { x: local.x, y: local.y + local.height },
      { x: local.x + local.width, y: local.y + local.height },
    ].map((corner) =>
      transformPoint(corner, instance.placement!.position, instance.placement!),
    );
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      {
        box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
        owns: {
          start: owner(from) === instance.id,
          end: owner(to) === instance.id,
        },
      },
    ];
  });
}

function owner(source: WireSource): string | null {
  return source.endpoint.kind === "terminal"
    ? source.endpoint.instanceId
    : null;
}

/** Whether the segment runs the way the pin it leaves points. */
function alongOutward(
  from: Point,
  to: Point,
  outward: Point | null | undefined,
): boolean {
  if (!outward) return false;
  return (
    Math.sign(to.x - from.x) === Math.sign(outward.x) &&
    Math.sign(to.y - from.y) === Math.sign(outward.y)
  );
}

function segmentCrossesInterior(from: Point, to: Point, box: Rect): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  if (from.y === to.y) {
    if (from.y <= top || from.y >= bottom) return false;
    return Math.min(from.x, to.x) < right && Math.max(from.x, to.x) > left;
  }
  if (from.x === to.x) {
    if (from.x <= left || from.x >= right) return false;
    return Math.min(from.y, to.y) < bottom && Math.max(from.y, to.y) > top;
  }
  return false;
}

/**
 * How many of those bodies the wire runs through.
 *
 * The lead is inside the body's bounds, so the ordinary arrival — straight
 * down the lead into a pin that points down — would read as a crossing. A
 * first or last leg that runs the way its own pin points is that arrival, and
 * is not counted; every other leg through the box is the wire drawn over the
 * part.
 */
function crossings(
  points: readonly Point[],
  obstacles: readonly EndpointObstacle[],
  from: WireSource,
  to: WireSource,
): number {
  const last = points.length - 2;
  return obstacles.filter(({ box, owns }) =>
    points.slice(0, -1).some((point, index) => {
      const next = points[index + 1]!;
      if (
        owns.start &&
        index === 0 &&
        alongOutward(point, next, from.connection.outward)
      )
        return false;
      if (
        owns.end &&
        index === last &&
        alongOutward(next, point, to.connection.outward)
      )
        return false;
      return segmentCrossesInterior(point, next, box);
    }),
  ).length;
}

function pathLength(points: readonly Point[]): number {
  return points.slice(0, -1).reduce((total, point, index) => {
    const next = points[index + 1]!;
    return total + Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
  }, 0);
}

/**
 * The axis of the conductor this end taps, when the end splits one.
 *
 * The split is already planned in the endpoint's prelude, so the Route and the
 * leg it lands on are named there rather than guessed from the pointer.
 */
function tappedConductorAxis(
  document: SchematicDocument,
  resolver: SymbolResolver,
  source: WireSource,
): Axis | null {
  const split = source.preludeEdits.find(
    (edit) => edit.kind === "add_junction" && edit.split,
  );
  if (split?.kind !== "add_junction" || !split.split) return null;
  const { routeId, legId } = split.split;
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) return null;
  const segment = resolveRouteGeometry(
    document,
    resolver,
    route,
  )?.segments.find(({ address }) => address.legId === legId);
  if (!segment) return null;
  if (segment.from.y === segment.to.y) return "horizontal";
  if (segment.from.x === segment.to.x) return "vertical";
  return null;
}

function segmentAxis(from: Point, to: Point): Axis | null {
  if (from.y === to.y && from.x !== to.x) return "horizontal";
  if (from.x === to.x && from.y !== to.y) return "vertical";
  return null;
}

/**
 * Legs that lie inside the conductor the wire tapped.
 *
 * Such a leg is drawn twice over and picked up as neither: the rail can no
 * longer be grabbed where the wire covers it, and the wire cannot be told
 * from the rail.
 */
function hidden(
  points: readonly Point[],
  tapped: { start: Axis | null; end: Axis | null },
): number {
  let count = 0;
  if (
    tapped.start &&
    segmentAxis(points[0]!, points[1] ?? points[0]!) === tapped.start
  )
    count += 1;
  const last = points.at(-1)!;
  if (tapped.end && segmentAxis(points.at(-2) ?? last, last) === tapped.end)
    count += 1;
  return count;
}

/**
 * The shape a fresh orthogonal wire takes between two ends.
 *
 * The wire is the gesture: two clicks compile to one corner, and a pin does
 * not push the wire out along its own direction — leaving a downward pin
 * sideways is an ordinary drawing, not a mistake to correct. Two shapes are
 * refused, both because they draw something that is not true:
 *
 * - a leg lying inside the conductor the wire just tapped, which hides both;
 * - a leg running over another pin of a component the wire is attaching to,
 *   which the planner will not join, so the drawing would show a meeting the
 *   netlist does not have.
 *
 * The answer is the first shape that draws neither: the compiled corner, else
 * the other corner, else one corridor between the two ends. When every shape
 * runs over such a pin the drawer's own corner stands — the editor states what
 * was drawn rather than inventing a detour around it.
 */
export function resolveWireDraftShape(
  document: SchematicDocument,
  resolver: SymbolResolver,
  from: WireSource,
  to: WireSource,
  steps: readonly WireDraftStep[],
  routingMode: WireRoutingMode,
  cornerOrder: WireCornerOrder,
  visibleEndpoints: readonly WireSource[],
): WireDraftShapeChoice {
  if (routingMode !== "orthogonal" || cornerOrder !== "auto" || steps.length)
    return { steps, cornerOrder };
  // A wire continued from a Junction that is already on the sheet carries the
  // leg it grew from: auto means "keep going that way", and re-ordering the
  // corner would stop the two pieces from reading — and coalescing — as one
  // conductor.
  const persistedJunction = [from, to].some((source) => {
    const endpoint = source.endpoint;
    return (
      endpoint.kind === "junction" &&
      document.junctions.some((junction) => junction.id === endpoint.junctionId)
    );
  });
  if (persistedJunction) return { steps, cornerOrder };
  const pins = overrunPins(from, to, visibleEndpoints);
  const tapped = {
    start: tappedConductorAxis(document, resolver, from),
    end: tappedConductorAxis(document, resolver, to),
  };
  const start = from.connection.gridLanding;
  const end = to.connection.gridLanding;
  // A corridor turns at a point the Document can hold: every authored step
  // lands on the drawing grid, and an edit off it is refused.
  const grid = Math.max(1, document.presentation.grid);
  const onGrid = (value: number) => Math.round(value / grid) * grid;
  const midX = onGrid((start.x + end.x) / 2);
  const midY = onGrid((start.y + end.y) / 2);
  const candidates: WireDraftShapeChoice[] = [
    { steps: [], cornerOrder },
    { steps: [], cornerOrder: "horizontal-first" },
    { steps: [], cornerOrder: "vertical-first" },
    // A corridor between the two ends: it turns before reaching either
    // component, so it can clear what a single corner cannot.
    {
      steps: [step({ x: midX, y: start.y }), step({ x: midX, y: end.y })],
      cornerOrder,
    },
    {
      steps: [step({ x: start.x, y: midY }), step({ x: end.x, y: midY })],
      cornerOrder,
    },
  ];
  const ink = endpointInk(document, resolver, from, to);
  interface Scored {
    candidate: WireDraftShapeChoice;
    rank: number;
    untrue: number;
    through: number;
    points: readonly Point[];
  }
  const scored = candidates.map((candidate, rank) => {
    const { points } = compileWireDraft(
      from,
      to,
      candidate.steps,
      routingMode,
      candidate.cornerOrder,
    );
    return {
      candidate,
      rank,
      untrue: overruns(points, pins) + hidden(points, tapped),
      through: crossings(points, ink, from, to),
      points,
    };
  });
  const first = scored[0]!;
  if (first.untrue === 0 && first.through === 0) return first.candidate;
  // One corner is the shape a wire has. Between the two, the one that stays
  // off the parts it lands on wins; a corridor is only for the case where
  // both would draw something untrue.
  const order = (left: Scored, right: Scored) =>
    left.untrue - right.untrue ||
    left.through - right.through ||
    left.points.length - right.points.length ||
    pathLength(left.points) - pathLength(right.points) ||
    left.rank - right.rank;
  const [corner] = scored.slice(0, 3).sort(order);
  if (!corner || corner.untrue === 0) return (corner ?? first).candidate;
  const [corridor] = scored
    .slice(3)
    .filter((entry) => entry.untrue === 0)
    .sort(order);
  return (corridor ?? corner).candidate;
}
