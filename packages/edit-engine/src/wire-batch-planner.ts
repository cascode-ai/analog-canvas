import {
  deriveNetConnectivityContext,
  endpointKey,
  pointOnSegment,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { routeEnd, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import { proposeWireIntent, type WireIntent } from "./routing-planner.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { createRouteClearance } from "./route-clearance.js";
import { resolveWireIntentTarget } from "./wire-intent-target.js";

/**
 * A wire between two endpoints that keeps clear of what it must not touch
 * (#1257): another Net's pin, a part's body or drawing, another Net's wire.
 * Any of those would read as a connection the netlist does not have. The
 * planner's own path is kept when it is clear. Otherwise a wire with no
 * via points takes the cheapest clear path, and one with via points, which
 * the caller chose, is refused with what it would meet.
 */
function keepClear(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
): WireIntent | string {
  if (intent.from.kind !== "endpoint" || intent.to.kind !== "endpoint")
    return intent;
  const planned = proposeWireIntent(document, resolver, intent);
  if (typeof planned === "string") return intent;
  const path = planned.edits.find((edit) => edit.kind === "set_route_path");
  if (!path) return intent;
  const points = resolveRouteGeometry(
    document,
    resolver,
    path.route,
  )?.centerline;
  if (!points) return intent;
  const context = deriveNetConnectivityContext(document, resolver);
  const ends = [intent.from.endpoint, intent.to.endpoint];
  const ownNets = ends.flatMap((endpoint) => {
    const netId =
      endpoint.kind === "junction"
        ? document.junctions.find((item) => item.id === endpoint.junctionId)
            ?.netId
        : document.nets.find((net) =>
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === endpoint.instanceId &&
                terminal.pinName === endpoint.pinName,
            ),
          )?.id;
    return netId
      ? [context.logicalNetResolution.byBaseNetId.get(netId)?.id ?? netId]
      : [];
  });
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set(ownNets),
    endpointKeys: new Set(ends.map(endpointKey)),
  });
  const problem = clearance.conflict(points, ends);
  if (!problem) return intent;
  if (intent.waypoints?.length)
    return `the requested path ${problem}, so it would read as connected there; give via points that keep clear of it`;
  const clear = clearance.path(ends[0]!, ends[1]!);
  if (typeof clear === "string") return clear;
  return {
    ...intent,
    waypoints: clear.waypoints,
    cornerOrder: clear.cornerOrder,
  };
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
