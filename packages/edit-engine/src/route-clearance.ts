import {
  endpointKey,
  intersectSegments,
  isSchematicAnnotationVisible,
  pointOnSegment,
  resolveAnnotationPresentation,
  resolveDraftingObjectGeometry,
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  resolveEndpointConnection,
  visibleSymbolInkBounds,
  type EndpointConnection,
  type EndpointRoutingGeometry,
  type NetConnectivityContext,
} from "@icm/derived";
import {
  electricalConnectionGrid,
  flattenRichText,
  transformPoint,
  routeEndpoints,
  routeElectricalConnections,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveInstanceSymbol,
  variantHiddenPinNames,
  type SymbolResolver,
  type SymbolPrimitive,
} from "@icm/symbols";
import { compileWireDraft } from "./wire-draft.js";
import { signalEndpointMembers } from "./signal-endpoint.js";

type Rect = { x: number; y: number; width: number; height: number };

function primitiveStrokePoints(primitive: SymbolPrimitive): readonly Point[] {
  switch (primitive.kind) {
    case "line":
      return [primitive.from, primitive.to];
    case "polyline":
      return primitive.points;
    case "polygon": {
      const first = primitive.points[0];
      return first ? [...primitive.points, first] : [];
    }
    case "rectangle": {
      const { x, y, width, height } = primitive.bounds;
      return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
        { x, y },
      ];
    }
    case "path":
      return straightPathPoints(primitive.data);
    case "circle":
      return [];
  }
}
type CornerOrder = "horizontal-first" | "vertical-first";

/** The bends a planned wire takes, and the corner order that reproduces it. */
export interface ClearPath {
  waypoints: Point[];
  cornerOrder: CornerOrder;
  /** The path drawn, from landing to landing, and what it cost to choose it:
   * length, two grid steps a bend, one for leaving or reaching a pin
   * against its direction. Set by `path`. */
  points?: Point[];
  cost?: number;
  /** Where the path taps its own Net's wire short of `to`. */
  tap?: Point;
}

export interface RouteClearance {
  /** The cheapest path between two ends that meets nothing it must not, or
   * why every tried path does. An end is an endpoint, or a point: a tap on a
   * wire of the path's own Net, or an open end. With `trunk`, `to` is a tap
   * on that planned trunk: the path meets the trunk only at its last point,
   * and avoid's search may tap it elsewhere, each step from `to` costing
   * one; the path's last point is then the tap. With `own`, the path keeps
   * to meetOwnNet: it may end sooner, on a joined wire of its Net, and its
   * `tap` is then that point. */
  path(
    from: RouteEndpoint | Point,
    to: RouteEndpoint | Point,
    options?: { trunk?: readonly [Point, Point]; own?: OwnNetWiring },
  ): ClearPath | string;
  /** Why a fixed path, from landing to landing, would read as a false
   * connection, or null. `ends` are the endpoints at its two ends. */
  conflict(
    points: readonly Point[],
    ends: readonly (RouteEndpoint | undefined)[],
  ): string | null;
  /** Where a path crosses another Net's wire: drawn without a dot, it joins
   * nothing, yet the receipt says so. */
  crossings(points: readonly Point[]): RouteCrossing[];
}

export interface RouteCrossing {
  routeId: string;
  /** The crossed wire's Net, by name where it has one. */
  net: string;
  point: Point;
}

/** The side a detour should take when it must leave its ends' span. */
export type DetourSide = "above" | "below" | "left" | "right";

const EPSILON = 1e-6;
/** Artwork coordinates are not grid values; this absorbs their rounding. */
const TOLERANCE = 1e-3;
/** How far round its ends, in grid squares, avoid's search may go. */
const SEARCH_MARGIN = 16;
/** The largest grid avoid's search walks; a longer wire is refused. */
const SEARCH_NODES = 40_000;
const same = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
const format = (point: Point) => `(${point.x}, ${point.y})`;

/** The corners of an orthogonal path between its ends. */
function bendsOf(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    if (kept.length && same(kept.at(-1)!, point)) continue;
    const [before, last] = [kept.at(-2), kept.at(-1)];
    if (
      before &&
      last &&
      Math.abs(
        (before.x - last.x) * (last.y - point.y) -
          (before.y - last.y) * (last.x - point.x),
      ) <= EPSILON
    )
      kept.pop();
    kept.push(point);
  }
  return kept.slice(1, -1);
}

/** Positive-length overlap of segment a-b with a collinear segment c-d. */
function runsAlong(a: Point, b: Point, c: Point, d: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return false;
  const off = (point: Point) =>
    Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
  if (off(c) > TOLERANCE || off(d) > TOLERANCE) return false;
  const along = (point: Point) =>
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
  const low = Math.max(0, Math.min(along(c), along(d)));
  const high = Math.min(length, Math.max(along(c), along(d)));
  return high - low > TOLERANCE;
}

/**
 * Where segment a-b meets segment c-d at single points: a proper crossing,
 * or an end of one lying on the other. Collinear overlaps are runsAlong's.
 */
function contactPoints(a: Point, b: Point, c: Point, d: Point): Point[] {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const onSegment = (p: Point, from: Point, to: Point) =>
    Math.abs(cross(from, to, p)) <=
      TOLERANCE * Math.hypot(to.x - from.x, to.y - from.y) &&
    p.x >= Math.min(from.x, to.x) - TOLERANCE &&
    p.x <= Math.max(from.x, to.x) + TOLERANCE &&
    p.y >= Math.min(from.y, to.y) - TOLERANCE &&
    p.y <= Math.max(from.y, to.y) + TOLERANCE;
  const points = [
    ...[c, d].filter((p) => onSegment(p, a, b)),
    ...[a, b].filter((p) => onSegment(p, c, d)),
  ];
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (
    ((d1 > TOLERANCE && d2 < -TOLERANCE) ||
      (d1 < -TOLERANCE && d2 > TOLERANCE)) &&
    ((d3 > TOLERANCE && d4 < -TOLERANCE) || (d3 < -TOLERANCE && d4 > TOLERANCE))
  ) {
    const t = d1 / (d1 - d2);
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

/**
 * Why a branch meets the trunk it taps anywhere but at its own last point,
 * or null. Along the trunk it would read as one wire drawn twice, and a
 * second contact as a junction where nothing branches.
 */
function offTap(
  points: readonly Point[],
  [c, d]: readonly [Point, Point],
): string | null {
  const segments = points
    .slice(1)
    .map((to, index) => [points[index]!, to] as const);
  for (const [index, [a, b]] of segments.entries()) {
    const between = ` between ${format(a)} and ${format(b)}`;
    if (runsAlong(a, b, c, d)) return `runs along the trunk${between}`;
    const last = index === segments.length - 1;
    const met = contactPoints(a, b, c, d).find(
      (point) => !(last && same(point, b)),
    );
    if (met)
      return `meets the trunk at ${format(met)}, away from its tap,${between}`;
  }
  return null;
}

type Segment = readonly [Point, Point];

/** A path's own Net round it: the wiring it may end on, and the rest. */
export interface OwnNetWiring {
  /** Wires already joined to the Net's tree, drawn or planned: a path ends
   * where it first meets one, a tap. */
  joins?: readonly Segment[];
  /** The Net's wires not yet joined, the path's own pin's among them: met
   * only at the path's ends. */
  apart?: readonly Segment[];
  /** A planned trunk, which the path meets only at its own tap (offTap):
   * counted where a tap would land, never tapped short. */
  trunk?: Segment;
}

/** How many joined wires leave a point: one for each that ends there, two
 * for each that passes through. */
function joinedWiresAt(point: Point, own: OwnNetWiring): number {
  return [...(own.joins ?? []), ...(own.trunk ? [own.trunk] : [])]
    .filter(([c, d]) => pointOnSegment(point, c, d))
    .reduce(
      (sum, [c, d]) => sum + (same(point, c) || same(point, d) ? 1 : 2),
      0,
    );
}

/**
 * A path beside the other wires of its own Net, or why it may not be drawn.
 * Two wires of one Net meet only where one ends on the other, at a dot; a
 * crossing or a shared stretch reads as a join nobody marked, or as a
 * crossing that joins nothing. So the path stops at the first joined wire it
 * meets, a tap (shorter, and the dot is drawn there), and meets the Net's
 * other wires at its ends alone. A tap where three wires already meet would
 * make a four-way dot, which reads as a crossing; it is not taken. `tapped`
 * when it was cut short.
 */
export function meetOwnNet(
  points: readonly Point[],
  own: OwnNetWiring,
  grid: number,
): { points: Point[]; tapped: boolean } | string {
  const start = points[0]!;
  const segmentsOf = (path: readonly Point[]) =>
    path.slice(1).map((to, index) => [path[index]!, to] as const);
  let drawn = [...points];
  let tapped = false;
  for (const [index, [a, b]] of segmentsOf(points).entries()) {
    let first: { point: Point; along: number } | null = null;
    for (const [c, d] of own.joins ?? []) {
      if (index === 0 && runsAlong(a, b, c, d) && pointOnSegment(start, c, d))
        return `runs along its own Net's wire from ${format(start)}`;
      for (const point of contactPoints(a, b, c, d)) {
        if (same(point, start)) continue;
        const along = Math.hypot(point.x - a.x, point.y - a.y);
        if (!first || along < first.along) first = { point, along };
      }
    }
    if (!first) continue;
    if (!same(first.point, points.at(-1)!)) {
      if (first.point.x % grid !== 0 || first.point.y % grid !== 0)
        return `meets its own Net's wire off the grid at ${format(first.point)}`;
      const wires = joinedWiresAt(first.point, own);
      if (wires >= 3)
        return `meets its own Net's wire at ${format(first.point)}, where ${wires} wires already meet`;
      drawn = [...points.slice(0, index + 1), first.point];
      tapped = true;
    }
    break;
  }
  const end = drawn.at(-1)!;
  for (const [a, b] of segmentsOf(drawn))
    for (const [c, d] of own.apart ?? []) {
      const between = ` between ${format(a)} and ${format(b)}`;
      if (runsAlong(a, b, c, d))
        return `runs along its own Net's wire${between}`;
      const met = contactPoints(a, b, c, d).find(
        (point) => !same(point, start) && (tapped || !same(point, end)),
      );
      if (met)
        return `meets its own Net's wire at ${format(met)}, which it does not join,${between}`;
    }
  return { points: drawn, tapped };
}

/**
 * The corners of a path drawn only with straight lines (M, L, H, V and Z,
 * absolute or relative), such as an op-amp's triangle; none for curves.
 */
function straightPathPoints(data: string): Point[] {
  const tokens = data.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gu);
  if (!tokens) return [];
  const points: Point[] = [];
  let current = { x: 0, y: 0 };
  let start = current;
  let command = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]!;
    if (/[a-zA-Z]/u.test(token)) {
      command = token;
      index += 1;
      if (command === "Z" || command === "z") {
        current = start;
        points.push(current);
      }
      continue;
    }
    const number = (offset: number) => Number(tokens[index + offset]);
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        const x = number(0);
        const y = number(1);
        current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
        if (command.toUpperCase() === "M") {
          // A second figure in one path is not joined to the first.
          if (points.length) return [];
          start = current;
          command = relative ? "l" : "L";
        }
        points.push(current);
        index += 2;
        break;
      }
      case "H":
        current = {
          x: relative ? current.x + number(0) : number(0),
          y: current.y,
        };
        points.push(current);
        index += 1;
        break;
      case "V":
        current = {
          x: current.x,
          y: relative ? current.y + number(0) : number(0),
        };
        points.push(current);
        index += 1;
        break;
      default:
        return [];
    }
  }
  return points;
}

/** Parameter interval of segment a-b inside a closed rectangle, if any. */
function clip(a: Point, b: Point, box: Rect): [number, number] | null {
  let low = 0;
  let high = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ] as const) {
    if (Math.abs(p) <= EPSILON) {
      if (q < -EPSILON) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high + EPSILON) return null;
  }
  return [low, high];
}

/**
 * Keeps planner-generated wires from reading as connections they are not: a
 * wire over another Net's pin, through a part's body, or onto another Net's
 * wire looks joined although the netlist keeps them apart. Wires of the Net
 * being routed are never obstacles.
 */
export function createRouteClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: NetConnectivityContext,
  own: {
    logicalIds: ReadonlySet<string>;
    endpointKeys: ReadonlySet<string>;
    signalWidth?: number;
    /** Explicit, validated taps may meet this route only at the selected point. */
    routeContacts?: readonly { routeId: string; point: Point }[];
    /** Points of other Nets a path must not touch although no wire of
     * `document` reaches them, such as the ends of wires left out of it. */
    blockedPoints?: readonly Point[];
    /** route-net `avoid`: drawn labels are obstacles too, and a path no
     * simple shape clears is searched for on the grid. */
    avoid?: boolean;
    /** The side a detour takes when it must leave its ends' span. */
    prefer?: DetourSide;
  },
): RouteClearance {
  const logical = context.logicalNetResolution;
  const logicalOf = (netId: string | null | undefined) =>
    netId ? (logical.byBaseNetId.get(netId)?.id ?? netId) : undefined;
  const ownNet = (logicalId: string | undefined) =>
    logicalId !== undefined && own.logicalIds.has(logicalId);
  const netText = (logicalId: string | undefined) =>
    logicalId
      ? `a different Net (${logical.byId.get(logicalId)?.name ?? logicalId})`
      : "no Net";
  const pinNet = new Map<string, string>();
  for (const net of document.nets)
    for (const terminal of net.terminals)
      pinNet.set(
        endpointKey({ kind: "terminal", ...terminal }),
        logicalOf(net.id)!,
      );
  const connections = new Map<string, EndpointConnection>();
  const connectionOf = (endpoint: RouteEndpoint) => {
    const key = endpointKey(endpoint);
    let connection = connections.get(key);
    if (!connection) {
      connection =
        resolveEndpointConnection(document, resolver, endpoint, context) ??
        undefined;
      if (connection) connections.set(key, connection);
    }
    return connection;
  };
  const labels = new Map<string, string>();
  const pins: {
    key: string;
    label: string;
    points: Point[];
    logicalId: string | undefined;
    /** How an Agent names this pin as a wire's end. */
    target: string;
    /** The pin in words, for a part with or without a Reference. */
    text: string;
  }[] = [];
  const bodies: {
    instanceId: string;
    label: string;
    /** The ink's open interior; its outline itself is not drawn. */
    interior: Rect | null;
    /** Drawn straight strokes, such as leads on the outline. */
    strokes: (readonly [Point, Point])[];
  }[] = [];
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    // The ink the Instance draws, an adder's sign marks included, as
    // visual diagnostics measure it: a wire planned clear of it is not
    // reported as through it.
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) continue;
    const label = instance.reference ?? instance.id;
    labels.set(instance.id, label);
    const place = (point: Point) =>
      transformPoint(point, instance.placement!.position, instance.placement!);
    const ink = visibleSymbolInkBounds(resolved, instance.signalFlowParameters);
    const corners = [
      { x: ink.x, y: ink.y },
      { x: ink.x + ink.width, y: ink.y + ink.height },
    ].map(place);
    const x = Math.min(...corners.map((point) => point.x)) + TOLERANCE;
    const y = Math.min(...corners.map((point) => point.y)) + TOLERANCE;
    const width = Math.max(...corners.map((point) => point.x)) - TOLERANCE - x;
    const height = Math.max(...corners.map((point) => point.y)) - TOLERANCE - y;
    const hiddenParts = new Set(resolved.variant?.hiddenPrimitiveParts ?? []);
    const strokes = [
      ...resolved.definition.primitives,
      ...(resolved.variant?.additionalPrimitives ?? []),
    ]
      .filter(
        (primitive) => !primitive.part || !hiddenParts.has(primitive.part),
      )
      .flatMap((primitive) => {
        const points = primitiveStrokePoints(primitive);
        return points
          .slice(1)
          .map((to, index) => [place(points[index]!), place(to)] as const);
      });
    bodies.push({
      instanceId: instance.id,
      label,
      interior: width > 0 && height > 0 ? { x, y, width, height } : null,
      strokes,
    });
    const hidden = variantHiddenPinNames(resolved.variant);
    for (const pin of resolved.definition.pins) {
      if (hidden.has(pin.name)) continue;
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      const connection = connectionOf(endpoint);
      if (!connection) continue;
      const key = endpointKey(endpoint);
      pins.push({
        key,
        label: `${label}.${pin.name}`,
        points: [connection.contactPoint, connection.gridLanding],
        logicalId: pinNet.get(key),
        target: instance.reference
          ? `{kind:"pin",instance:"${instance.reference}",pin:"${pin.name}"}`
          : `{kind:"pin",instance:{kind:"instance",id:"${instance.id}"},pin:"${pin.name}"}`,
        text: instance.reference
          ? `${instance.reference}.${pin.name}`
          : `pin ${pin.name} of the ${instance.symbolId} ${instance.id}`,
      });
    }
  }
  const routes = document.routes.flatMap((route) => {
    const points = context.routingGeometry.routes.get(route.id)?.centerline;
    const logicalId = logicalOf(route.netId);
    const sameSignal =
      (route.members?.length ?? 1) === (own.signalWidth ?? 1) &&
      routeElectricalConnections(route).every((connection) =>
        ownNet(logicalOf(connection.netId)),
      );
    return points && points.length > 1 && !sameSignal
      ? [{ id: route.id, logicalId, points, endpoints: routeEndpoints(route) }]
      : [];
  });
  const endpointText = (endpoint: RouteEndpoint) =>
    endpoint.kind === "terminal"
      ? `${labels.get(endpoint.instanceId) ?? endpoint.instanceId}.${endpoint.pinName}`
      : `Junction ${endpoint.junctionId}`;
  // Drawn text, as a label's ink measures it: a wire through a part's name
  // or a Net label reads as struck out. Only route-net's avoid asks.
  const texts: { text: string; box: Rect }[] = [];
  if (own.avoid) {
    const style = resolveDocumentStyleProfile(document.presentation);
    for (const annotation of document.annotations) {
      if (
        !isSchematicAnnotationVisible(
          document,
          annotation,
          logical,
          undefined,
          resolver,
        )
      )
        continue;
      const box = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        style,
        context.routingGeometry,
        logical,
      ).inkBounds;
      if (box.width <= 0 || box.height <= 0) continue;
      texts.push({
        text: flattenRichText(
          resolveAnnotationText(document, annotation, logical, resolver),
        ),
        box,
      });
    }
    // Free drawing text is in a wire's way as a label is.
    for (const object of document.drafting?.objects ?? [])
      if (object.kind === "text")
        texts.push({
          text: flattenRichText(object.content),
          box: resolveDraftingObjectGeometry(
            document,
            resolver,
            object,
            context.routingGeometry,
          ).bounds,
        });
  }
  const contains = (box: Rect, point: Point) =>
    point.x >= box.x - TOLERANCE &&
    point.x <= box.x + box.width + TOLERANCE &&
    point.y >= box.y - TOLERANCE &&
    point.y <= box.y + box.height + TOLERANCE;
  const routeSegmentsOf = (route: (typeof routes)[number]) =>
    route.points
      .slice(1)
      .map((to, index) => [route.points[index]!, to] as const);
  const netName = (logicalId: string | undefined) =>
    logicalId ? (logical.byId.get(logicalId)?.name ?? logicalId) : "no Net";
  const crossings: RouteClearance["crossings"] = (points) => {
    const found: RouteCrossing[] = [];
    const segments = points
      .slice(1)
      .map((to, index) => [points[index]!, to] as const);
    for (const route of routes)
      for (const [c, d] of routeSegmentsOf(route))
        for (const [a, b] of segments) {
          const hit = intersectSegments(a, b, c, d);
          if (
            hit?.kind !== "crossing" ||
            [a, b, c, d].some((end) => same(end, hit.point))
          )
            continue;
          found.push({
            routeId: route.id,
            net: netName(route.logicalId),
            point: hit.point,
          });
        }
    return found;
  };
  const grid = document.presentation.grid;
  // The side a detour should keep to: any length beyond the other side of
  // its ends' span costs four times its length.
  const sideCost = (
    points: readonly Point[],
    span: readonly [Point, Point] = [points[0]!, points.at(-1)!],
  ) => {
    if (!own.prefer || points.length < 2) return 0;
    const vertical = own.prefer === "above" || own.prefer === "below";
    const ends = span.map((point) => (vertical ? point.y : point.x));
    // y grows downward: away from "above" is past the larger y.
    const away = own.prefer === "above" || own.prefer === "left";
    const limit = away ? Math.max(...ends) : Math.min(...ends);
    let cost = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const [p, q] = vertical ? [from.y, to.y] : [from.x, to.x];
      const along = vertical
        ? Math.abs(to.x - from.x)
        : Math.abs(to.y - from.y);
      const beyond = (value: number) => (away ? value - limit : limit - value);
      if (along > EPSILON) {
        if (beyond(p) > EPSILON) cost += along;
        continue;
      }
      const low = Math.max(0, Math.min(beyond(p), beyond(q)));
      const high = Math.max(0, beyond(p), beyond(q));
      cost += high - low;
    }
    return cost * 4;
  };

  /** The pins a path's ends are, a bus member's aggregate pin included. */
  const endKeysOf = (ends: readonly (RouteEndpoint | undefined)[]) =>
    new Set(
      ends.flatMap((end) => {
        if (!end) return [];
        const keys = [endpointKey(end)];
        const { memberId, ...aggregate } = end;
        if (
          memberId &&
          signalEndpointMembers(document, resolver, aggregate)?.some(
            (member) => member.id === memberId,
          )
        )
          keys.push(endpointKey(aggregate));
        return keys;
      }),
    );
  const conflict: RouteClearance["conflict"] = (points, ends) => {
    const endConnections = ends.map((end) =>
      end ? connectionOf(end) : undefined,
    );
    const endKeys = endKeysOf(ends);
    const segments = points
      .slice(1)
      .map((to, index) => [points[index]!, to] as const);
    const sharedBusContact = (
      point: Point,
      endpoint: RouteEndpoint | undefined,
      route: (typeof routes)[number],
    ) => {
      if (!endpoint) return false;
      const { memberId, ...aggregate } = endpoint;
      const members = signalEndpointMembers(document, resolver, aggregate);
      if (
        !members ||
        (memberId && !members.some((member) => member.id === memberId))
      )
        return false;
      const connection = connectionOf(endpoint);
      if (
        !connection ||
        (!same(point, connection.contactPoint) &&
          !same(point, connection.gridLanding))
      )
        return false;
      return route.endpoints.some((candidate) => {
        const { memberId: _memberId, ...physical } = candidate;
        return endpointKey(physical) === endpointKey(aggregate);
      });
    };
    // Which stretch of the path meets it, so a caller moves the right via
    // point (#1527).
    const between = ([a, b]: readonly [Point, Point]) =>
      ` between ${format(a)} and ${format(b)}`;
    for (const pin of pins) {
      if (
        endKeys.has(pin.key) ||
        own.endpointKeys.has(pin.key) ||
        ownNet(pin.logicalId)
      )
        continue;
      for (const segment of segments) {
        const point = pin.points.find((candidate) =>
          pointOnSegment(candidate, segment[0], segment[1]),
        );
        if (!point) continue;
        const where = ` at ${format(point)}${between(segment)}`;
        return pin.logicalId
          ? `passes over pin ${pin.label} of ${netText(pin.logicalId)}${where}`
          : `passes over pin ${pin.label}, which is on no Net,${where}`;
      }
    }
    const outwardFrom = (
      connection: EndpointConnection | undefined,
      a: Point,
      b: Point,
      instanceId: string,
    ) => {
      const outward = connection?.outward;
      if (
        !connection ||
        !outward ||
        connection.endpoint.kind !== "terminal" ||
        connection.endpoint.instanceId !== instanceId ||
        !same(a, connection.gridLanding)
      )
        return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return (
        Math.abs(dx * outward.y - dy * outward.x) <= EPSILON &&
        dx * outward.x + dy * outward.y > EPSILON
      );
    };
    for (const body of bodies) {
      for (const [index, [a, b]] of segments.entries()) {
        // A pin inside its own part's outline is left outward.
        if (
          (index === 0 &&
            outwardFrom(endConnections[0], a, b, body.instanceId)) ||
          (index === segments.length - 1 &&
            outwardFrom(endConnections.at(-1), b, a, body.instanceId))
        )
          continue;
        const inside = body.interior && clip(a, b, body.interior);
        if (
          inside &&
          (inside[1] - inside[0]) * Math.hypot(b.x - a.x, b.y - a.y) > TOLERANCE
        )
          return `passes through ${body.label}${between([a, b])}`;
        // Along the outline is clear unless something is drawn there, such
        // as a lead.
        if (body.strokes.some(([c, d]) => runsAlong(a, b, c, d)))
          return `runs along ${body.label}'s drawing${between([a, b])}`;
        // Nor may it touch the drawing on the way, as along an op-amp's
        // edge through the corner of its triangle; only where it meets the
        // part's own pin does it reach a lead.
        const attachments = endConnections.flatMap((connection) =>
          connection?.endpoint.kind === "terminal" &&
          connection.endpoint.instanceId === body.instanceId
            ? [connection.gridLanding, connection.contactPoint]
            : [],
        );
        if (
          body.strokes.some(([c, d]) =>
            contactPoints(a, b, c, d).some(
              (point) => !attachments.some((end) => same(point, end)),
            ),
          )
        )
          return `touches ${body.label}'s drawing${between([a, b])}`;
      }
    }
    for (const { text, box } of texts) {
      // Text drawn over a path's own end cannot be kept clear of.
      if (contains(box, points[0]!) || contains(box, points.at(-1)!)) continue;
      for (const [a, b] of segments) {
        const inside = clip(a, b, box);
        if (
          inside &&
          (inside[1] - inside[0]) * Math.hypot(b.x - a.x, b.y - a.y) > TOLERANCE
        )
          return `crosses the label "${text}"${between([a, b])}`;
      }
    }
    for (const route of routes) {
      const selectedContact = (point: Point) =>
        (same(point, points[0]!) || same(point, points.at(-1)!)) &&
        own.routeContacts?.some(
          (contact) =>
            contact.routeId === route.id && same(contact.point, point),
        );
      const routeSegments = route.points
        .slice(1)
        .map((to, index) => [route.points[index]!, to] as const);
      const text = `Route ${route.id} of ${netText(route.logicalId)}`;
      for (const [index, point] of points.entries()) {
        if (!routeSegments.some(([c, d]) => pointOnSegment(point, c, d)))
          continue;
        const end =
          index === 0
            ? ends[0]
            : index === points.length - 1
              ? ends.at(-1)
              : undefined;
        if (selectedContact(point) || sharedBusContact(point, end, route))
          continue;
        return end
          ? `${endpointText(end)} sits on ${text}`
          : `touches ${text} at ${format(point)}`;
      }
      for (const point of route.points) {
        if (
          selectedContact(point) ||
          ends.some((end) => sharedBusContact(point, end, route))
        )
          continue;
        const segment = segments.find(([a, b]) => pointOnSegment(point, a, b));
        if (segment)
          return `touches ${text} at ${format(point)}${between(segment)}`;
      }
    }
    for (const point of own.blockedPoints ?? []) {
      const segment = segments.find(([a, b]) => pointOnSegment(point, a, b));
      if (segment)
        return `touches another Net's wire end at ${format(point)}${between(segment)}`;
    }
    return null;
  };

  /**
   * The cheapest orthogonal path on the grid from landing to landing, priced
   * as `path` prices its shapes, that meets nothing `conflict` refuses, or
   * null. Searched only within SEARCH_MARGIN grid squares of its ends, and
   * only for route-net's avoid, when no simple shape is clear. With a trunk,
   * any of its grid points is a goal, priced by its distance from `end`, and
   * the path touches the trunk nowhere else. A joined wire of its own Net is
   * a goal too, reached as meetOwnNet reaches it.
   */
  const search = (
    start: Point,
    end: Point,
    fromEnd: RouteEndpoint | undefined,
    toEnd: RouteEndpoint | undefined,
    a: EndpointRoutingGeometry,
    b: EndpointRoutingGeometry,
    trunk?: readonly [Point, Point],
    ownWiring: OwnNetWiring = {},
  ): Point[] | null => {
    const onTrunk = (point: Point) =>
      Boolean(trunk && pointOnSegment(point, trunk[0], trunk[1]));
    // A joined wire is a goal where a tap leaves a T, not a four-way dot.
    const onJoined = (point: Point) =>
      (ownWiring.joins ?? []).some(([c, d]) => pointOnSegment(point, c, d)) &&
      joinedWiresAt(point, ownWiring) < 3;
    if (onTrunk(start)) return null;
    const margin = SEARCH_MARGIN * grid;
    const lattice = (s: number, e: number) => {
      const low = Math.min(s, e) - margin;
      const high = Math.max(s, e) + margin;
      const values = new Set<number>();
      for (const origin of [s, e]) {
        for (let value = origin; value >= low; value -= grid) values.add(value);
        for (let value = origin + grid; value <= high; value += grid)
          values.add(value);
      }
      return [...values].sort((left, right) => left - right);
    };
    const xs = lattice(start.x, end.x);
    const ys = lattice(start.y, end.y);
    if (xs.length * ys.length > SEARCH_NODES) return null;
    const pointOf = (node: number) => ({
      x: xs[Math.floor(node / ys.length)]!,
      y: ys[node % ys.length]!,
    });
    const startNode = xs.indexOf(start.x) * ys.length + ys.indexOf(start.y);
    const goalNode = xs.indexOf(end.x) * ys.length + ys.indexOf(end.y);
    if (startNode < 0 || goalNode < 0) return null;
    const endKeys = endKeysOf([fromEnd, toEnd]);
    const endConnections = [fromEnd, toEnd].map((endpoint) =>
      endpoint ? connectionOf(endpoint) : undefined,
    );
    const outwardAt = (point: Point, q: Point, instanceId: string) =>
      endConnections.some((connection) => {
        const outward = connection?.outward;
        if (
          !connection ||
          !outward ||
          connection.endpoint.kind !== "terminal" ||
          connection.endpoint.instanceId !== instanceId ||
          !same(point, connection.gridLanding)
        )
          return false;
        const dx = q.x - point.x;
        const dy = q.y - point.y;
        return (
          Math.abs(dx * outward.y - dy * outward.x) <= EPSILON &&
          dx * outward.x + dy * outward.y > EPSILON
        );
      });
    // What a unit step may not meet, bucketed by where it is.
    type Obstacle = {
      box: Rect;
      blocks: (p: Point, q: Point) => boolean;
    };
    const obstacles: Obstacle[] = [];
    const pointBox = (point: Point): Rect => ({
      ...point,
      width: 0,
      height: 0,
    });
    const segmentBox = (c: Point, d: Point): Rect => ({
      x: Math.min(c.x, d.x),
      y: Math.min(c.y, d.y),
      width: Math.abs(d.x - c.x),
      height: Math.abs(d.y - c.y),
    });
    const crosses = (p: Point, q: Point, box: Rect) => {
      const inside = clip(p, q, box);
      return Boolean(
        inside &&
        (inside[1] - inside[0]) * Math.hypot(q.x - p.x, q.y - p.y) > TOLERANCE,
      );
    };
    for (const pin of pins) {
      if (
        endKeys.has(pin.key) ||
        own.endpointKeys.has(pin.key) ||
        ownNet(pin.logicalId)
      )
        continue;
      for (const point of pin.points)
        obstacles.push({
          box: pointBox(point),
          blocks: (p, q) => pointOnSegment(point, p, q),
        });
    }
    for (const body of bodies) {
      const exempt = (p: Point, q: Point) =>
        outwardAt(p, q, body.instanceId) || outwardAt(q, p, body.instanceId);
      const attachments = endConnections.flatMap((connection) =>
        connection?.endpoint.kind === "terminal" &&
        connection.endpoint.instanceId === body.instanceId
          ? [connection.gridLanding, connection.contactPoint]
          : [],
      );
      const interior = body.interior;
      if (interior)
        obstacles.push({
          box: interior,
          blocks: (p, q) => !exempt(p, q) && crosses(p, q, interior),
        });
      for (const [c, d] of body.strokes)
        obstacles.push({
          box: segmentBox(c, d),
          blocks: (p, q) =>
            !exempt(p, q) &&
            (runsAlong(p, q, c, d) ||
              contactPoints(p, q, c, d).some(
                (point) => !attachments.some((at) => same(point, at)),
              )),
        });
    }
    for (const { box } of texts)
      if (!contains(box, start) && !contains(box, end))
        obstacles.push({ box, blocks: (p, q) => crosses(p, q, box) });
    const foreign: (readonly [Point, Point])[] = [];
    for (const route of routes) {
      for (const point of route.points) {
        const selected =
          (same(point, start) || same(point, end)) &&
          own.routeContacts?.some(
            (contact) =>
              contact.routeId === route.id && same(contact.point, point),
          );
        if (!selected)
          obstacles.push({
            box: pointBox(point),
            blocks: (p, q) => pointOnSegment(point, p, q),
          });
      }
      for (const [c, d] of routeSegmentsOf(route)) {
        foreign.push([c, d]);
        obstacles.push({
          box: segmentBox(c, d),
          blocks: (p, q) => runsAlong(p, q, c, d),
        });
      }
    }
    for (const point of own.blockedPoints ?? [])
      obstacles.push({
        box: pointBox(point),
        blocks: (p, q) => pointOnSegment(point, p, q),
      });
    // A step may reach the trunk, where the path ends, and touch it nowhere
    // else.
    if (trunk) {
      const [c, d] = trunk;
      obstacles.push({
        box: segmentBox(c, d),
        blocks: (p, q) =>
          runsAlong(p, q, c, d) ||
          contactPoints(p, q, c, d).some((point) => !same(point, q)),
      });
    }
    // Its own Net's joined wires likewise; the rest only at its ends.
    for (const [c, d] of ownWiring.joins ?? [])
      obstacles.push({
        box: segmentBox(c, d),
        blocks: (p, q) =>
          runsAlong(p, q, c, d) ||
          contactPoints(p, q, c, d).some(
            (point) => !same(point, q) && !same(point, start),
          ),
      });
    for (const [c, d] of ownWiring.apart ?? [])
      obstacles.push({
        box: segmentBox(c, d),
        blocks: (p, q) =>
          runsAlong(p, q, c, d) ||
          contactPoints(p, q, c, d).some(
            (point) => !same(point, start) && !same(point, end),
          ),
      });
    const cell = grid * 4;
    const buckets = new Map<string, number[]>();
    const cellsOf = (box: Rect) => {
      const keys: string[] = [];
      for (
        let cx = Math.floor((box.x - TOLERANCE) / cell);
        cx <= Math.floor((box.x + box.width + TOLERANCE) / cell);
        cx += 1
      )
        for (
          let cy = Math.floor((box.y - TOLERANCE) / cell);
          cy <= Math.floor((box.y + box.height + TOLERANCE) / cell);
          cy += 1
        )
          keys.push(`${cx}:${cy}`);
      return keys;
    };
    const area = {
      x: xs[0]!,
      y: ys[0]!,
      width: xs.at(-1)! - xs[0]!,
      height: ys.at(-1)! - ys[0]!,
    };
    const meets = (box: Rect, other: Rect) =>
      box.x <= other.x + other.width + TOLERANCE &&
      other.x <= box.x + box.width + TOLERANCE &&
      box.y <= other.y + other.height + TOLERANCE &&
      other.y <= box.y + box.height + TOLERANCE;
    const index = (box: Rect, value: number, into: Map<string, number[]>) => {
      if (!meets(box, area)) return;
      for (const key of cellsOf(box)) {
        const list = into.get(key);
        if (list) list.push(value);
        else into.set(key, [value]);
      }
    };
    obstacles.forEach((obstacle, at) => index(obstacle.box, at, buckets));
    const foreignBuckets = new Map<string, number[]>();
    foreign.forEach(([c, d], at) =>
      index(segmentBox(c, d), at, foreignBuckets),
    );
    const near = (box: Rect, from: Map<string, number[]>) => {
      const found = new Set<number>();
      for (const key of cellsOf(box))
        for (const value of from.get(key) ?? []) found.add(value);
      return found;
    };
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    const reverse = [1, 0, 3, 2];
    const directionOf = (connection: EndpointRoutingGeometry, sign: number) => {
      const outward = connection.outward;
      if (!outward) return -1;
      const [x, y] =
        Math.abs(outward.x) >= Math.abs(outward.y)
          ? [Math.sign(outward.x) * sign, 0]
          : [0, Math.sign(outward.y) * sign];
      return steps.findIndex(([dx, dy]) => dx === x && dy === y);
    };
    const leave = directionOf(a, 1);
    const arrive = directionOf(b, -1);
    const neighbour = (node: number, step: number) => {
      const i = Math.floor(node / ys.length) + steps[step]![0];
      const j = (node % ys.length) + steps[step]![1];
      return i < 0 || j < 0 || i >= xs.length || j >= ys.length
        ? -1
        : i * ys.length + j;
    };
    const edges = new Map<number, number>();
    /** A unit step's crossings, or -1 when it may not be taken. */
    const stepCrossings = (node: number, step: number) => {
      const key = node * 4 + step;
      const known = edges.get(key);
      if (known !== undefined) return known;
      const next = neighbour(node, step);
      let result = -1;
      if (next >= 0) {
        const p = pointOf(node);
        const q = pointOf(next);
        const box = segmentBox(p, q);
        const blocked = [...near(box, buckets)].some((at) =>
          obstacles[at]!.blocks(p, q),
        );
        if (!blocked) {
          result = 0;
          for (const at of near(box, foreignBuckets)) {
            const [c, d] = foreign[at]!;
            const hit = intersectSegments(p, q, c, d);
            if (
              hit?.kind === "crossing" &&
              ![q, c, d].some((point) => same(point, hit.point))
            )
              result += 1;
          }
        }
      }
      edges.set(key, result);
      return result;
    };
    const turns = new Map<number, boolean>();
    /** Whether a path may bend at a node: not on another Net's wire. */
    const mayTurn = (node: number) => {
      let known = turns.get(node);
      if (known === undefined) {
        const point = pointOf(node);
        known = ![...near(pointBox(point), foreignBuckets)].some((at) =>
          pointOnSegment(point, foreign[at]![0], foreign[at]![1]),
        );
        turns.set(node, known);
      }
      return known;
    };
    const states = xs.length * ys.length * 5;
    const cost = new Float64Array(states).fill(Infinity);
    const parent = new Int32Array(states).fill(-1);
    const goal = pointOf(goalNode);
    const isGoal = (node: number) =>
      (trunk ? onTrunk(pointOf(node)) : node === goalNode) ||
      (node !== startNode && onJoined(pointOf(node)));
    // To the nearest goal: the trunk, or the one end.
    const [low, high] = trunk
      ? [
          {
            x: Math.min(trunk[0].x, trunk[1].x),
            y: Math.min(trunk[0].y, trunk[1].y),
          },
          {
            x: Math.max(trunk[0].x, trunk[1].x),
            y: Math.max(trunk[0].y, trunk[1].y),
          },
        ]
      : [goal, goal];
    const estimate = (node: number) => {
      const point = pointOf(node);
      return (
        Math.max(0, low.x - point.x, point.x - high.x) +
        Math.max(0, low.y - point.y, point.y - high.y)
      );
    };
    /** What a trunk tap costs beyond its path: its distance from `end`. */
    const tapCost = (node: number) => {
      const point = pointOf(node);
      if (!onTrunk(point)) return 0;
      return Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
    };
    // A binary heap of [priority, state].
    const heap: [number, number][] = [];
    const push = (entry: [number, number]) => {
      heap.push(entry);
      for (let at = heap.length - 1; at > 0;) {
        const up = (at - 1) >> 1;
        if (heap[up]![0] <= heap[at]![0]) break;
        [heap[up], heap[at]] = [heap[at]!, heap[up]!];
        at = up;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let at = 0; ;) {
          const left = at * 2 + 1;
          const right = left + 1;
          let least = at;
          if (left < heap.length && heap[left]![0] < heap[least]![0])
            least = left;
          if (right < heap.length && heap[right]![0] < heap[least]![0])
            least = right;
          if (least === at) break;
          [heap[least], heap[at]] = [heap[at]!, heap[least]!];
          at = least;
        }
      }
      return top;
    };
    const first = startNode * 5 + 4;
    cost[first] = 0;
    push([estimate(startNode), first]);
    for (
      let popped = 0;
      heap.length && popped < SEARCH_NODES * 5;
      popped += 1
    ) {
      const [priority, state] = pop();
      const node = Math.floor(state / 5);
      const heading = state % 5;
      if (priority - estimate(node) > cost[state]! + EPSILON) continue;
      if (isGoal(node)) {
        const nodes: number[] = [];
        for (let at = state; at >= 0; at = parent[at]!)
          nodes.push(Math.floor(at / 5));
        return nodes.reverse().map(pointOf);
      }
      for (const [step] of steps.entries()) {
        if (heading !== 4 && step === reverse[heading]) continue;
        const bends = heading !== 4 && step !== heading;
        if (bends && !mayTurn(node)) continue;
        const crossed = stepCrossings(node, step);
        if (crossed < 0) continue;
        const next = neighbour(node, step);
        const p = pointOf(node);
        const q = pointOf(next);
        const price =
          Math.abs(q.x - p.x) +
          Math.abs(q.y - p.y) +
          crossed * 2 * grid +
          sideCost([p, q], [start, end]) +
          (bends ? 2 * grid : 0) +
          (heading === 4 && leave >= 0 && step !== leave ? grid : 0) +
          (next === goalNode && arrive >= 0 && step !== arrive ? grid : 0) +
          (isGoal(next) ? tapCost(next) : 0);
        const reached = next * 5 + step;
        if (cost[state]! + price >= cost[reached]!) continue;
        cost[reached] = cost[state]! + price;
        parent[reached] = state;
        push([cost[reached]! + estimate(next), reached]);
      }
    }
    return null;
  };

  const path: RouteClearance["path"] = (from, to, options = {}) => {
    const trunk = options.trunk;
    // A point has no pin to leave along, as a Junction has none.
    const endpointOf = (end: RouteEndpoint | Point) =>
      "kind" in end ? end : undefined;
    const geometryOf = (
      end: RouteEndpoint | Point,
    ): EndpointRoutingGeometry | undefined =>
      "kind" in end
        ? connectionOf(end)
        : {
            contactPoint: end,
            gridLanding: end,
            escapePath: [],
            outward: null,
          };
    const endText = (end: RouteEndpoint | Point) =>
      "kind" in end ? endpointText(end) : format(end);
    const clash = (points: readonly Point[], ends = [fromEnd, toEnd]) =>
      conflict(points, ends) ?? (trunk ? offTap(points, trunk) : null);
    const fromEnd = endpointOf(from);
    const toEnd = endpointOf(to);
    const a = geometryOf(from);
    const b = geometryOf(to);
    if (!a || !b) return "an endpoint has no routing landing";
    // An open end on another part's pin is that pin, and no path to it can
    // keep clear of it. A connect to the spot where a ground's pin sat was
    // refused as passing over "pin instance-d437….0"; name the pin to join.
    for (const end of [from, to]) {
      if ("kind" in end) continue;
      const pin = pins.find(
        (candidate) =>
          !own.endpointKeys.has(candidate.key) &&
          !ownNet(candidate.logicalId) &&
          candidate.points.some(
            (point) => point.x === end.x && point.y === end.y,
          ),
      );
      if (pin)
        return `${format(end)} is ${pin.text}${pin.logicalId ? `, on Net ${logical.byId.get(pin.logicalId)?.name ?? pin.logicalId}` : ""}: to join it, connect to the pin itself, ${pin.target}`;
    }
    // No path helps a pin that already sits on another Net's wire.
    for (const [end, connection] of [
      [fromEnd, a],
      [toEnd, b],
    ] as const) {
      if (!end) continue;
      const sitting = conflict([connection.gridLanding], [end]);
      if (sitting) return `${sitting}; move that wire off the pin first`;
    }
    const start = a.gridLanding;
    const end = b.gridLanding;
    const axis = (connection: EndpointRoutingGeometry) => {
      const outward = connection.outward;
      if (!outward) return null;
      return Math.abs(outward.x) >= Math.abs(outward.y)
        ? { x: Math.sign(outward.x), y: 0 }
        : { x: 0, y: Math.sign(outward.y) };
    };
    const away = (point: Point, direction: Point | null, steps: number) =>
      direction
        ? {
            x: point.x + direction.x * grid * steps,
            y: point.y + direction.y * grid * steps,
          }
        : null;
    const candidates: ClearPath[] = [];
    const both = (waypoints: Point[]) => {
      candidates.push({ waypoints, cornerOrder: "horizontal-first" });
      candidates.push({ waypoints, cornerOrder: "vertical-first" });
    };
    // The plain L first, as route-net always drew it.
    both([]);
    // Leave one or both pins outward before turning.
    for (const steps of [1, 2, 3, 4]) {
      const first = away(start, axis(a), steps);
      const last = away(end, axis(b), steps);
      if (first) both([first]);
      if (last) both([last]);
      if (first && last) both([first, last]);
    }
    // Detour along a free row or column, from the pins or just past them.
    const lines = (from: number, to: number) => {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const values: number[] = [];
      for (let step = 1; step <= 8; step += 1)
        values.push(low - step * grid, high + step * grid);
      for (
        let value = low + grid;
        value < high && values.length < 64;
        value += grid
      )
        values.push(value);
      return values;
    };
    for (const steps of [0, 1, 2]) {
      const first = steps ? away(start, axis(a), steps) : start;
      const last = steps ? away(end, axis(b), steps) : end;
      if (!first || !last) continue;
      const ends = (middle: Point[]) => [
        ...(steps ? [first] : []),
        ...middle,
        ...(steps ? [last] : []),
      ];
      for (const y of lines(first.y, last.y))
        candidates.push({
          waypoints: ends([
            { x: first.x, y },
            { x: last.x, y },
          ]),
          cornerOrder: "vertical-first",
        });
      for (const x of lines(first.x, last.x))
        candidates.push({
          waypoints: ends([
            { x, y: first.y },
            { x, y: last.y },
          ]),
          cornerOrder: "horizontal-first",
        });
    }
    const ownWiring = options.own && {
      ...options.own,
      ...(trunk ? { trunk } : {}),
    };
    const meet = (points: Point[]) =>
      ownWiring
        ? meetOwnNet(points, ownWiring, electricalConnectionGrid(grid))
        : { points, tapped: false };
    // A crossing costs what a bend does: of two detours round a part, the
    // one over a source's supply wire read as joined to it.
    const priced = (points: readonly Point[]) =>
      points
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum +
            Math.abs(point.x - points[index]!.x) +
            Math.abs(point.y - points[index]!.y),
          0,
        ) +
      Math.max(0, points.length - 2) * 2 * grid +
      crossings(points).length * 2 * grid +
      sideCost(points);
    const seen = new Set<string>();
    const scored = candidates.flatMap((candidate) => {
      const compiled = compileWireDraft(
        { connection: a },
        { connection: b },
        candidate.waypoints.map((point) => ({
          point,
          routingMode: "orthogonal" as const,
          cornerOrder: candidate.cornerOrder,
        })),
        "orthogonal",
        candidate.cornerOrder,
      );
      // The contact-to-grid escape leads belong to the pins themselves.
      const first = compiled.segmentModes[0] === "escape" ? 1 : 0;
      const last =
        compiled.segmentModes.at(-1) === "escape" &&
        compiled.points.length - 2 >= first
          ? compiled.points.length - 2
          : compiled.points.length - 1;
      const raw = compiled.points.slice(first, last + 1);
      const signature = JSON.stringify(raw);
      if (seen.has(signature)) return [];
      seen.add(signature);
      const met = meet(raw);
      const refused = typeof met === "string" ? met : null;
      const points = typeof met === "string" ? raw : met.points;
      const tapped = typeof met !== "string" && met.tapped;
      // A wire leaves a pin, and reaches one, along the way the pin points.
      // Of two equally short L shapes, the one turning away right at a pin
      // read as a bump (each node of an R-2R ladder came out as two), and
      // which of the two came first depended only on how pin IDs sorted.
      const along = (
        connection: EndpointRoutingGeometry,
        from: Point | undefined,
        to: Point | undefined,
      ) => {
        const outward = connection.outward;
        if (!outward || !from || !to) return true;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        return (
          Math.abs(dx * outward.y - dy * outward.x) <= EPSILON &&
          dx * outward.x + dy * outward.y > EPSILON
        );
      };
      const turnsAway =
        (along(a, points[0], points[1]) ? 0 : 1) +
        (tapped || along(b, points.at(-1), points.at(-2)) ? 0 : 1);
      return [
        {
          candidate,
          points,
          refused,
          tapped,
          cost: priced(points) + turnsAway * grid,
        },
      ];
    });
    // Stable: equal costs keep the order above.
    scored.sort((left, right) => left.cost - right.cost);
    let reason: string | null = null;
    for (const entry of scored) {
      const found =
        entry.refused ??
        clash(entry.points, [fromEnd, entry.tapped ? undefined : toEnd]);
      if (found === null)
        return {
          ...entry.candidate,
          ...(entry.tapped
            ? { waypoints: bendsOf(entry.points), tap: entry.points.at(-1)! }
            : {}),
          points: entry.points,
          cost: entry.cost,
        };
      reason ??= found;
    }
    if (own.avoid) {
      const found = search(start, end, fromEnd, toEnd, a, b, trunk, ownWiring);
      if (found) {
        const candidate: ClearPath = {
          waypoints: bendsOf(found),
          cornerOrder: "horizontal-first",
        };
        // The search may have tapped the trunk, or a wire of its own Net,
        // away from `to`.
        const tap = found.at(-1)!;
        const compiled = compileWireDraft(
          { connection: a },
          { connection: same(tap, end) ? b : geometryOf(tap)! },
          candidate.waypoints.map((point) => ({
            point,
            routingMode: "orthogonal" as const,
            cornerOrder: candidate.cornerOrder,
          })),
          "orthogonal",
          candidate.cornerOrder,
        );
        const first = compiled.segmentModes[0] === "escape" ? 1 : 0;
        const last =
          compiled.segmentModes.at(-1) === "escape" &&
          compiled.points.length - 2 >= first
            ? compiled.points.length - 2
            : compiled.points.length - 1;
        const met = meet(compiled.points.slice(first, last + 1));
        if (typeof met !== "string") {
          const points = met.points;
          const reached = points.at(-1)!;
          const tapped =
            !same(reached, end) &&
            !(trunk && pointOnSegment(reached, trunk[0], trunk[1]));
          if (
            clash(points, [fromEnd, same(reached, end) ? toEnd : undefined]) ===
            null
          )
            return {
              ...candidate,
              waypoints: bendsOf(points),
              points,
              cost: priced(points),
              ...(tapped ? { tap: reached } : {}),
            };
        }
      }
    }
    // Textbooks draw a bias line that cannot cross the drawing as a short
    // labelled stub at each end; say so, or the Agent is left stuck.
    const searched = own.avoid
      ? `, and none goes round within ${SEARCH_MARGIN} grid squares`
      : "";
    return `no clear path from ${endText(from)} to ${trunk ? "the trunk" : endText(to)}: the direct one ${reason ?? "is blocked"}${searched}. Move the parts apart, give a trunk, or name the Net at each end with a Net Label on a short stub`;
  };
  return { path, conflict, crossings };
}
