import {
  deriveNetConnectivityContext,
  endpointKey,
  intersectSegments,
  pointOnSegment,
  resolveEndpointConnection,
  resolveRouteGeometry,
  samePoint,
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
} from "./wire-intent-planner.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { createRouteClearance } from "./route-clearance.js";
import {
  resolveWireIntentTarget,
  wireTargetReference,
} from "./wire-intent-target.js";

/**
 * A drawn path from landing to landing, as the clearance check reads one: the
 * lead from a pin's contact to its landing is the pin's own, as a hidden MOS
 * body's is out of the channel. Read from the contact, a body wire passed
 * through its own part, so one given via points was refused (#1514).
 */
function fromLandings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  points: readonly Point[],
  ends: readonly (RouteEndpoint | undefined)[],
): Point[] {
  const trim = (path: Point[], end: RouteEndpoint | undefined) => {
    const connection =
      end && resolveEndpointConnection(document, resolver, end);
    if (
      !connection ||
      path.length < 2 ||
      samePoint(connection.contactPoint, connection.gridLanding) ||
      !samePoint(path[0]!, connection.contactPoint) ||
      !pointOnSegment(connection.gridLanding, path[0]!, path[1]!)
    )
      return path;
    return samePoint(connection.gridLanding, path[1]!)
      ? path.slice(1)
      : [connection.gridLanding, ...path.slice(1)];
  };
  return trim(trim([...points], ends[0]).reverse(), ends[1]).reverse();
}

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
 * would meet, where, and what to send instead.
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
    wireTargetReference(intent.waypoints, "from", intent.to),
  );
  if (typeof from === "string") return intent;
  const to = resolveWireIntentTarget(
    document,
    resolver,
    intent.to,
    wireTargetReference(intent.waypoints, "to", from),
  );
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
  points = fromLandings(document, resolver, points, ends);
  const netsOf = (anchor: typeof from): string[] => {
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
  };
  const nets = { from: netsOf(from), to: netsOf(to) };
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set([...nets.from, ...nets.to]),
    endpointKeys: new Set(
      ends.flatMap((end) => (end ? [endpointKey(end)] : [])),
    ),
  });
  const problem = clearance.conflict(points, ends);
  if (!problem)
    return tapOwnWire(document, resolver, resolved, points, nets) ?? intent;
  const clear = clearance.path(endOf(from), endOf(to));
  if (intent.waypoints?.length) {
    // What the caller can send instead, so it need not guess new via
    // points: a hand-routed body wire was refused where leaving the route
    // to the editor worked, and nothing said so (#1527).
    const { waypoints: _refused, ...unforced } = intent;
    const editor = keepClear(document, resolver, unforced);
    const bends = typeof clear === "string" ? [] : corners(clear.points!);
    const instead =
      typeof editor === "string"
        ? `Leaving the route to the editor fails too: ${editor}`
        : bends.length
          ? `The editor finds a clear path: send via ${JSON.stringify(bends)} (a wireIntent's waypoints) in the next call, or omit via to let it route`
          : "Omit via to let the editor route it clear";
    return `the requested path ${problem}, so it would read as connected there. ${instead}`;
  }
  if (typeof clear === "string") return clear;
  // The detour is orthogonal and its corners the planner's, never a
  // caller's diagonal to refuse (#1437).
  const cleared = {
    ...resolved,
    waypoints: clear.waypoints,
    routingMode: "orthogonal" as const,
    cornerOrder: clear.cornerOrder,
  };
  return (
    (clear.points &&
      tapOwnWire(document, resolver, cleared, clear.points, nets)) ??
    cleared
  );
}

/**
 * A wire whose last leg into a pin, or first leg out of one, would run along
 * a wire of that pin's own Net there ends where it meets that wire instead,
 * with a T: two wires drawn over each other read as one, and the eye cannot
 * tell where either goes. A source follower's body, wired to its source,
 * came down beside the device and ran back along the output wire into the
 * source pin (#1337). It now taps the output wire where it comes down. Only
 * a wire of the end's own Net may take the wire there: one of the other
 * end's Net would leave the pin unjoined, and a body still on its Cell's
 * default has no Net to tap. Null when no end needs it.
 */
function tapOwnWire(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
  points: readonly Point[],
  nets: { from: readonly string[]; to: readonly string[] },
): WireIntent | null {
  if (points.length < 3) return null;
  const context = deriveNetConnectivityContext(document, resolver);
  const wiresOf = (logicalIds: readonly string[]) => {
    const own = new Set(logicalIds);
    return document.routes.flatMap((route) => {
      if (
        !own.has(
          context.logicalNetResolution.byBaseNetId.get(route.netId)?.id ??
            route.netId,
        )
      )
        return [];
      const geometry = resolveRouteGeometry(document, resolver, route);
      return (geometry?.segments ?? []).map((segment) => ({
        route,
        segment,
        ends: [
          { point: geometry!.centerline[0], endpoint: route.start },
          { point: geometry!.centerline.at(-1), endpoint: routeEnd(route) },
        ],
      }));
    });
  };
  /** Where a leg, walked from `outer` toward the pin at `pin`, first runs
   * along one of `wires` for some length. */
  const meeting = (
    wires: ReturnType<typeof wiresOf>,
    outer: Point,
    pin: Point,
  ) => {
    let best: Extract<
      WireIntent["to"],
      { kind: "route-segment" } | { kind: "endpoint" }
    > | null = null;
    let bestPoint: Point | null = null;
    for (const { route, segment, ends } of wires) {
      const near = intersectSegments(outer, pin, segment.from, segment.to);
      const far = intersectSegments(pin, outer, segment.from, segment.to);
      // Touching at one point is a crossing, or the pin itself.
      if (
        near?.kind !== "overlap" ||
        far?.kind !== "overlap" ||
        samePoint(near.point, far.point)
      )
        continue;
      if (
        !bestPoint ||
        Math.hypot(near.point.x - outer.x, near.point.y - outer.y) <
          Math.hypot(bestPoint.x - outer.x, bestPoint.y - outer.y)
      ) {
        bestPoint = near.point;
        // Met where that wire ends, at a Junction a wire there already left
        // from, or a pin, the wire joins that end: there is no wire on
        // either side to split (#1589).
        const end = ends.find(
          (candidate) =>
            candidate.point && samePoint(candidate.point, near.point),
        );
        best = end
          ? { kind: "endpoint", endpoint: end.endpoint }
          : {
              kind: "route-segment",
              routeId: route.id,
              legId: segment.address.legId,
              point: near.point,
            };
      }
    }
    return best && bestPoint ? { anchor: best, point: bestPoint } : null;
  };
  let path = [...points];
  let next: WireIntent = intent;
  if (intent.to.kind === "endpoint" && nets.to.length) {
    const end = meeting(wiresOf(nets.to), path.at(-2)!, path.at(-1)!);
    if (end) {
      path = [...path.slice(0, -1), end.point];
      next = { ...next, to: end.anchor };
    }
  }
  if (intent.from.kind === "endpoint" && nets.from.length) {
    const start = meeting(wiresOf(nets.from), path[1]!, path[0]!);
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
  // The bends of a path already planned, in its own routing mode.
  return {
    ...next,
    waypoints: bends,
    routingMode: intent.routingMode ?? "orthogonal",
  };
}

/** The corners of an orthogonal path between its ends: as via points, they
 * draw it again whatever the corner order. */
function corners(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    if (kept.length && samePoint(kept.at(-1)!, point)) continue;
    const [before, last] = [kept.at(-2), kept.at(-1)];
    // A point on the line through the two before it bends nothing.
    if (
      before &&
      last &&
      (before.x - last.x) * (last.y - point.y) ===
        (before.y - last.y) * (last.x - point.x)
    )
      kept.pop();
    kept.push(point);
  }
  return kept.slice(1, -1);
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
    const selectedFrom = resolveAnchor(
      from,
      wireTargetReference(intent.waypoints, "from", to),
    );
    if (typeof selectedFrom === "string")
      return `Wire ${index + 1}: ${selectedFrom}`;
    const selectedTo = resolveAnchor(
      to,
      wireTargetReference(intent.waypoints, "to", selectedFrom),
    );
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
