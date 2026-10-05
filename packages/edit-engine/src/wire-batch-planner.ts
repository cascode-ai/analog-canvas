import {
  deriveNetConnectivityContext,
  endpointKey,
  pointOnSegment,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  routeEnd,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import {
  defaultBoundMosBody,
  proposeWireIntent,
  type WireIntent,
} from "./routing-planner.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { createRouteClearance } from "./route-clearance.js";
import { resolveWireIntentTarget } from "./wire-intent-target.js";

/**
 * A wire that keeps clear of what it must not touch (#1257): another Net's
 * pin, a part's body or drawing, another Net's wire. Any of those would read
 * as a connection the netlist does not have. It leaves a pin or a Junction
 * for another, for a Net (the conductor the selector resolves to), for a tap
 * on a wire or for an open end. Only a wire between two endpoints used to be
 * checked: one to a Net was drawn straight through four transistors of an
 * OTA to reach its bias Net. The planner's own path is kept when it is
 * clear. Otherwise a wire with no via points takes the cheapest clear path,
 * and one with via points, which the caller chose, is refused with what it
 * would meet.
 */
function keepClear(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
): WireIntent | string {
  const from = resolveWireIntentTarget(
    document,
    resolver,
    intent.from,
    intent.to,
  );
  if (typeof from === "string") return intent;
  const to = resolveWireIntentTarget(document, resolver, intent.to, from);
  if (typeof to === "string") return intent;
  // A wire drawn between points alone is drawn where it is asked: it may
  // end on another wire to join it.
  if (from.kind !== "endpoint" && to.kind !== "endpoint") return intent;
  const resolved = { ...intent, from, to };
  const planned = proposeWireIntent(document, resolver, resolved);
  if (typeof planned === "string") return intent;
  const path = planned.edits.find((edit) => edit.kind === "set_route_path");
  if (!path) return intent;
  // A tap's Junction exists only once the planned edits apply.
  let points = resolveRouteGeometry(document, resolver, path.route)?.centerline;
  if (!points) {
    const draft = createContactPlanningDraft(document, resolver);
    try {
      for (const edit of planned.edits) draft.apply(edit);
    } catch {
      return intent;
    }
    points = resolveRouteGeometry(
      draft.document,
      resolver,
      path.route,
    )?.centerline;
  }
  if (!points) return intent;
  const context = deriveNetConnectivityContext(document, resolver);
  const ends = [from, to].map((anchor) =>
    anchor.kind === "endpoint" ? anchor.endpoint : undefined,
  );
  const ownNets = [from, to].flatMap((anchor) => {
    if (anchor.kind === "route-segment") {
      const netId = document.routes.find(
        (route) => route.id === anchor.routeId,
      )?.netId;
      return netId
        ? [context.logicalNetResolution.byBaseNetId.get(netId)?.id ?? netId]
        : [];
    }
    if (anchor.kind !== "endpoint") return [];
    const endpoint = anchor.endpoint;
    const key = endpointKey(endpoint);
    const netIds = [
      endpoint.kind === "junction"
        ? document.junctions.find((item) => item.id === endpoint.junctionId)
            ?.netId
        : // A body on its Cell's default leaves it for the wire's Net.
          defaultBoundMosBody(document, endpoint)
          ? undefined
          : document.nets.find((net) =>
              net.terminals.some(
                (terminal) =>
                  terminal.instanceId === endpoint.instanceId &&
                  terminal.pinName === endpoint.pinName,
              ),
            )?.id,
      // A wire an earlier connect of this batch ran to the pin is the pin's
      // own: its Net membership settles only at commit (#1304).
      ...document.routes
        .filter((route) =>
          [route.start, routeEnd(route)].some(
            (end) => endpointKey(end) === key,
          ),
        )
        .map((route) => route.netId),
    ];
    return netIds.flatMap((netId) =>
      netId
        ? [context.logicalNetResolution.byBaseNetId.get(netId)?.id ?? netId]
        : [],
    );
  });
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set(ownNets),
    endpointKeys: new Set(
      ends.flatMap((end) => (end ? [endpointKey(end)] : [])),
    ),
  });
  const problem = clearance.conflict(points, ends);
  if (!problem)
    return tapOwnWire(document, resolver, resolved, points, ownNets) ?? intent;
  if (intent.waypoints?.length)
    return `the requested path ${problem}, so it would read as connected there; give via points that keep clear of it`;
  const clear = clearance.path(endOf(from), endOf(to));
  if (typeof clear === "string") return clear;
  const cleared = {
    ...resolved,
    waypoints: clear.waypoints,
    cornerOrder: clear.cornerOrder,
  };
  return (
    (clear.points &&
      tapOwnWire(document, resolver, cleared, clear.points, ownNets)) ??
    cleared
  );
}

/**
 * A wire whose last leg into a pin, or first leg out of one, would run along
 * a wire of its own Net there ends where it meets that wire instead, with a
 * T: two wires drawn over each other read as one, and the eye cannot tell
 * where either goes. A source follower's body, wired to its source, came
 * down beside the device and ran back along the output wire into the source
 * pin (#1337). It now taps the output wire where it comes down. Null when no
 * end needs it.
 */
function tapOwnWire(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
  points: readonly Point[],
  ownNets: readonly string[],
): WireIntent | null {
  if (points.length < 3) return null;
  const context = deriveNetConnectivityContext(document, resolver);
  const own = new Set(ownNets);
  const segments = document.routes.flatMap((route) => {
    const logical =
      context.logicalNetResolution.byBaseNetId.get(route.netId)?.id ??
      route.netId;
    if (!own.has(logical)) return [];
    return (
      resolveRouteGeometry(document, resolver, route)?.segments ?? []
    ).map((segment) => ({ route, segment }));
  });
  /** Where a leg, walked from `outer` toward the pin at `pin`, first runs
   * along one of those wires. */
  const meeting = (outer: Point, pin: Point) => {
    let best: { anchor: WireIntent["to"]; point: Point } | null = null;
    for (const { route, segment } of segments) {
      const overlap = collinearOverlap(outer, pin, segment.from, segment.to);
      if (!overlap) continue;
      // The overlap's end nearer the far end of the leg is where the wire
      // first meets the other one.
      const point =
        Math.hypot(overlap[0].x - outer.x, overlap[0].y - outer.y) <=
        Math.hypot(overlap[1].x - outer.x, overlap[1].y - outer.y)
          ? overlap[0]
          : overlap[1];
      if (
        !best ||
        Math.hypot(point.x - outer.x, point.y - outer.y) <
          Math.hypot(best.point.x - outer.x, best.point.y - outer.y)
      )
        best = {
          anchor: {
            kind: "route-segment",
            routeId: route.id,
            legId: segment.address.legId,
            point,
          },
          point,
        };
    }
    return best;
  };
  let path = [...points];
  let next: WireIntent = intent;
  if (intent.to.kind === "endpoint") {
    const end = meeting(path.at(-2)!, path.at(-1)!);
    if (end) {
      path = [...path.slice(0, -1), end.point];
      next = { ...next, to: end.anchor };
    }
  }
  if (intent.from.kind === "endpoint") {
    const start = meeting(path[1]!, path[0]!);
    if (start) {
      path = [start.point, ...path.slice(1)];
      next = { ...next, from: start.anchor };
    }
  }
  if (next === intent) return null;
  const bends = path
    .slice(1, -1)
    .filter(
      (point, index, all) =>
        !samePoint(point, path[0]!) &&
        !samePoint(point, path.at(-1)!) &&
        (index === 0 || !samePoint(point, all[index - 1]!)),
    );
  return { ...next, waypoints: bends };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** The two ends of the positive-length overlap of collinear segments a-b
 * and c-d, axis-aligned, or null. */
function collinearOverlap(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): [Point, Point] | null {
  const horizontal = a.y === b.y && c.y === d.y && a.y === c.y && a.x !== b.x;
  const vertical = a.x === b.x && c.x === d.x && a.x === c.x && a.y !== b.y;
  if (!horizontal && !vertical) return null;
  const axis = horizontal ? "x" : "y";
  const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  if (high - low <= 1e-6) return null;
  return horizontal
    ? [
        { x: low, y: a.y },
        { x: high, y: a.y },
      ]
    : [
        { x: a.x, y: low },
        { x: a.x, y: high },
      ];
}

/** Where a resolved wire end is: its endpoint, or the point of a tap or an
 * open end. */
function endOf(
  anchor: Exclude<WireIntent["from"], { kind: "net" | "wire-at" }>,
): RouteEndpoint | Point {
  return anchor.kind === "endpoint" ? anchor.endpoint : anchor.point;
}

/** Plan on private evolving state, then dispatch the combined edits once.
 * `keepClear` (the Agent's connect) routes each wire between two endpoints
 * clear of foreign pins, bodies and wires; route-net clears its own. */
export function planWireBatch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input:
    | Parameters<typeof proposeWireIntent>[2]
    | Parameters<typeof proposeWireIntent>[2][],
  limit: number,
  options: { keepClear?: boolean } = {},
): { edits: SchematicEdit[] } | string {
  if (!Array.isArray(input)) {
    const intent = options.keepClear
      ? keepClear(document, resolver, input)
      : input;
    if (typeof intent === "string") return intent;
    return proposeWireIntent(document, resolver, intent);
  }
  const draft = createContactPlanningDraft(document, resolver);
  const working = draft.document;
  const edits = draft.edits;
  const descendants = new Map(
    document.routes.map((route) => [route.id, new Set([route.id])]),
  );
  const resolveAnchor = (
    anchor: Parameters<typeof proposeWireIntent>[2]["from"],
    other: Parameters<typeof proposeWireIntent>[2]["from"],
  ) => {
    const resolved = resolveWireIntentTarget(working, resolver, anchor, other);
    if (
      typeof resolved !== "string" ||
      (anchor.kind !== "wire-at" && anchor.kind !== "net") ||
      !edits.length
    )
      return resolved;
    // A preceding gesture may create overlapping portions of one conductor,
    // still bearing different Net hints until endpoint topology is finalized.
    // New terminal membership and named Net selectors also need that derived
    // view when the raw draft cannot resolve them.
    // Ask the ordinary finalizer whether the tap is unambiguous, but never
    // copy its rewritten IDs into the replay draft. Foreign crossings remain
    // subject to the same selector contract.
    const preview = executeTransaction(
      document,
      {
        transactionId: "wire-batch-selector",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "wire-planner" },
        dryRun: true,
        edits,
      },
      { symbolResolver: resolver },
    );
    if (!preview.ok) return resolved;
    const otherPoint =
      other.kind === "endpoint"
        ? resolveEndpointConnection(working, resolver, other.endpoint)
            ?.gridLanding
        : undefined;
    const selected = resolveWireIntentTarget(
      preview.document,
      resolver,
      anchor,
      otherPoint ? { kind: "free", point: otherPoint } : other,
    );
    if (typeof selected === "string") return selected;
    if (
      selected.kind === "endpoint" &&
      resolveEndpointConnection(working, resolver, selected.endpoint)
    )
      return selected;
    const point =
      selected.kind === "endpoint"
        ? resolveEndpointConnection(
            preview.document,
            resolver,
            selected.endpoint,
          )?.gridLanding
        : selected.point;
    if (!point) return resolved;
    for (const route of working.routes) {
      const segment = resolveRouteGeometry(
        working,
        resolver,
        route,
      )?.segments.find((s) => pointOnSegment(point, s.from, s.to));
      if (segment)
        return {
          kind: "route-segment" as const,
          routeId: route.id,
          legId: segment.address.legId,
          point,
        };
    }
    return resolved;
  };
  const rebaseAnchor = (
    anchor: Parameters<typeof proposeWireIntent>[2]["from"],
  ): typeof anchor | string => {
    if (
      anchor.kind !== "route-segment" ||
      working.routes.some((route) => route.id === anchor.routeId)
    )
      return anchor;
    const original = document.routes.find(
      (route) => route.id === anchor.routeId,
    );
    if (!original || !original.legs.some((leg) => leg.id === anchor.legId))
      return `Wire route or leg does not exist: ${anchor.routeId}/${anchor.legId}`;
    const originalSegment = resolveRouteGeometry(
      document,
      resolver,
      original,
    )?.segments.find((segment) => segment.address.legId === anchor.legId);
    if (
      !originalSegment ||
      !pointOnSegment(anchor.point, originalSegment.from, originalSegment.to)
    )
      return `Wire route point is not on the original leg: ${anchor.routeId}/${anchor.legId}`;
    const candidates = [...(descendants.get(anchor.routeId) ?? [])].flatMap(
      (routeId) => {
        const route = working.routes.find((entry) => entry.id === routeId);
        if (!route) return [];
        const geometry = resolveRouteGeometry(working, resolver, route);
        if (!geometry) return [];
        return geometry.segments
          .filter((segment) =>
            pointOnSegment(anchor.point, segment.from, segment.to),
          )
          .map((segment) => ({ route, segment, geometry }));
      },
    );
    const junction = candidates.flatMap(({ route, geometry }) => {
      const endpoints = [
        { endpoint: route.start, point: geometry.centerline[0] },
        { endpoint: routeEnd(route), point: geometry.centerline.at(-1) },
      ];
      return endpoints
        .filter(
          ({ endpoint, point }) =>
            endpoint.kind === "junction" &&
            point?.x === anchor.point.x &&
            point.y === anchor.point.y,
        )
        .map(({ endpoint }) => endpoint);
    })[0];
    if (junction) return { kind: "endpoint", endpoint: junction };
    if (candidates.length !== 1)
      return `Wire route segment has ${candidates.length} descendants at the requested point: ${anchor.routeId}/${anchor.legId}`;
    const match = candidates[0]!;
    return {
      ...anchor,
      routeId: match.route.id,
      legId: match.segment.address.legId,
    };
  };
  for (const [index, intent] of input.entries()) {
    const from = rebaseAnchor(intent.from);
    if (typeof from === "string") return `Wire ${index + 1}: ${from}`;
    const to = rebaseAnchor(intent.to);
    if (typeof to === "string") return `Wire ${index + 1}: ${to}`;
    const selectedFrom = resolveAnchor(from, to);
    if (typeof selectedFrom === "string")
      return `Wire ${index + 1}: ${selectedFrom}`;
    const selectedTo = resolveAnchor(to, selectedFrom);
    if (typeof selectedTo === "string")
      return `Wire ${index + 1}: ${selectedTo}`;
    const selected = { ...intent, from: selectedFrom, to: selectedTo };
    const cleared = options.keepClear
      ? keepClear(working, resolver, selected)
      : selected;
    if (typeof cleared === "string") return `Wire ${index + 1}: ${cleared}`;
    const planned = proposeWireIntent(working, resolver, cleared);
    if (typeof planned === "string") return `Wire ${index + 1}: ${planned}`;
    // Match the final transaction's pre-finalization state. Normalizing each
    // private step would invent Net/Route identities absent during replay.
    // A new route's Net remains a hint until finalization; a tap can materialize
    // that hint using the existing createNet contract.
    const materialized = planned.edits.map((edit): SchematicEdit =>
      edit.kind === "add_junction" &&
      !document.nets.some((net) => net.id === edit.netId)
        ? { ...edit, createNet: true }
        : edit,
    );
    if (edits.length + materialized.length > limit)
      return `Wire ${index + 1}: batch requires ${edits.length + materialized.length} edits, exceeding the ${limit}-edit transaction limit`;
    try {
      for (const edit of materialized) draft.apply(edit);
    } catch (error) {
      return `Wire ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
    }
    for (const edit of planned.edits) {
      if (edit.kind !== "add_junction" || !edit.split) continue;
      for (const lineage of descendants.values()) {
        if (!lineage.delete(edit.split.routeId)) continue;
        lineage.add(edit.split.firstRouteId);
        lineage.add(edit.split.secondRouteId);
      }
    }
  }
  return { edits };
}
