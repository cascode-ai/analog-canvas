import {
  endpointKey,
  pointOnSegment,
  resolveEndpointConnection,
  visibleSymbolInkBounds,
  type EndpointConnection,
  type NetConnectivityContext,
} from "@icm/derived";
import {
  transformPoint,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { compileWireDraft } from "./routing-planner.js";

type Rect = { x: number; y: number; width: number; height: number };
type CornerOrder = "horizontal-first" | "vertical-first";

/** The bends a planned wire takes, and the corner order that reproduces it. */
export interface ClearPath {
  waypoints: Point[];
  cornerOrder: CornerOrder;
}

export interface RouteClearance {
  /** The cheapest path between two endpoints that meets nothing it must
   * not, or why every tried path does. */
  path(from: RouteEndpoint, to: RouteEndpoint): ClearPath | string;
  /** Why a fixed path, from landing to landing, would read as a false
   * connection, or null. `ends` are the endpoints at its two ends. */
  conflict(
    points: readonly Point[],
    ends: readonly (RouteEndpoint | undefined)[],
  ): string | null;
}

const EPSILON = 1e-6;
/** Artwork coordinates are not grid values; this absorbs their rounding. */
const TOLERANCE = 1e-3;
const same = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
const format = (point: Point) => `(${point.x}, ${point.y})`;

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
    /** Points of other Nets a path must not touch although no wire of
     * `document` reaches them, such as the ends of wires left out of it. */
    blockedPoints?: readonly Point[];
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
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
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
        const points =
          primitive.kind === "line"
            ? [primitive.from, primitive.to]
            : primitive.kind === "polyline"
              ? primitive.points
              : primitive.kind === "polygon"
                ? [...primitive.points, primitive.points[0]!]
                : [];
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
    const hidden = new Set(resolved.variant?.hiddenPinNames ?? []);
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
      });
    }
  }
  const routes = document.routes.flatMap((route) => {
    const points = context.routingGeometry.routes.get(route.id)?.centerline;
    const logicalId = logicalOf(route.netId);
    return points && points.length > 1 && !ownNet(logicalId)
      ? [{ id: route.id, logicalId, points }]
      : [];
  });
  const endpointText = (endpoint: RouteEndpoint) =>
    endpoint.kind === "terminal"
      ? `${labels.get(endpoint.instanceId) ?? endpoint.instanceId}.${endpoint.pinName}`
      : `Junction ${endpoint.junctionId}`;

  const conflict: RouteClearance["conflict"] = (points, ends) => {
    const endConnections = ends.map((end) =>
      end ? connectionOf(end) : undefined,
    );
    const endKeys = new Set(
      ends.flatMap((end) => (end ? [endpointKey(end)] : [])),
    );
    const segments = points
      .slice(1)
      .map((to, index) => [points[index]!, to] as const);
    for (const pin of pins) {
      if (
        endKeys.has(pin.key) ||
        own.endpointKeys.has(pin.key) ||
        ownNet(pin.logicalId)
      )
        continue;
      if (
        segments.some(([a, b]) =>
          pin.points.some((point) => pointOnSegment(point, a, b)),
        )
      )
        return pin.logicalId
          ? `passes over pin ${pin.label} of ${netText(pin.logicalId)}`
          : `passes over pin ${pin.label}, which is on no Net`;
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
          return `passes through ${body.label}`;
        // Along the outline is clear unless something is drawn there, such
        // as a lead.
        if (body.strokes.some(([c, d]) => runsAlong(a, b, c, d)))
          return `runs along ${body.label}'s drawing`;
      }
    }
    for (const route of routes) {
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
        return end
          ? `${endpointText(end)} sits on ${text}`
          : `touches ${text} at ${format(point)}`;
      }
      for (const point of route.points)
        if (segments.some(([a, b]) => pointOnSegment(point, a, b)))
          return `touches ${text} at ${format(point)}`;
    }
    for (const point of own.blockedPoints ?? [])
      if (segments.some(([a, b]) => pointOnSegment(point, a, b)))
        return `touches another Net's wire end at ${format(point)}`;
    return null;
  };

  const grid = document.presentation.grid;
  const path: RouteClearance["path"] = (from, to) => {
    const a = connectionOf(from);
    const b = connectionOf(to);
    if (!a || !b) return "an endpoint has no routing landing";
    // No path helps a pin that already sits on another Net's wire.
    for (const [end, connection] of [
      [from, a],
      [to, b],
    ] as const) {
      const sitting = conflict([connection.gridLanding], [end]);
      if (sitting) return `${sitting}; move that wire off the pin first`;
    }
    const start = a.gridLanding;
    const end = b.gridLanding;
    const axis = (connection: EndpointConnection) => {
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
      const points = compiled.points.slice(first, last + 1);
      const signature = JSON.stringify(points);
      if (seen.has(signature)) return [];
      seen.add(signature);
      const length = points
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum +
            Math.abs(point.x - points[index]!.x) +
            Math.abs(point.y - points[index]!.y),
          0,
        );
      return [
        {
          candidate,
          points,
          cost: length + Math.max(0, points.length - 2) * 2 * grid,
        },
      ];
    });
    // Stable: equal costs keep the order above.
    scored.sort((left, right) => left.cost - right.cost);
    let reason: string | null = null;
    for (const entry of scored) {
      const found = conflict(entry.points, [from, to]);
      if (found === null) return entry.candidate;
      reason ??= found;
    }
    return `no clear path from ${endpointText(from)} to ${endpointText(to)}: the direct one ${reason ?? "is blocked"}. Move the parts apart, or give a trunk`;
  };
  return { path, conflict };
}
