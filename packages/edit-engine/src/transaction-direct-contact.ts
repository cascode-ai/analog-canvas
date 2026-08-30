import { createRoutePath, deriveStableId } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  deriveDirectContactDelta,
  endpointKey,
  isVisibleEndpoint,
  isMosBulkTerminal,
  netEndpoints,
  resolveEndpointConnection,
  resolveEndpointPoint,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { buildManualWirePath } from "./routing-planner.js";
import {
  endpointOwnerNetId,
  netEndpointGroups,
} from "./transaction-routing.js";

export interface DirectContactReconciliation {
  geometryChanged: boolean;
  changedRouteIds: readonly string[];
}

/**
 * Cheap conservative guard for transform transactions. A lost direct contact
 * must have contained a moved endpoint at a coordinate shared by at least one
 * other visible endpoint before the transform. Returning true may do extra
 * work; returning false proves the full contact-delta derivation unnecessary.
 */
export function transformMaySeparateDirectContact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
  junctionIds: ReadonlySet<string>,
): boolean {
  for (const net of document.nets) {
    const positions = new Map<
      string,
      { count: number; containsTransformedEndpoint: boolean }
    >();
    for (const endpoint of netEndpoints(document, net)) {
      if (!isVisibleEndpoint(document, resolver, endpoint)) continue;
      const point = resolveEndpointPoint(document, resolver, endpoint);
      if (!point) continue;
      const key = `${point.x},${point.y}`;
      const current = positions.get(key) ?? {
        count: 0,
        containsTransformedEndpoint: false,
      };
      current.count += 1;
      current.containsTransformedEndpoint ||=
        (endpoint.kind === "terminal" &&
          instanceIds.has(endpoint.instanceId)) ||
        (endpoint.kind === "junction" && junctionIds.has(endpoint.junctionId));
      positions.set(key, current);
    }
    if (
      [...positions.values()].some(
        (entry) => entry.count > 1 && entry.containsTransformedEndpoint,
      )
    ) {
      return true;
    }
  }
  return false;
}

function endpointsSharePhysicalComponent(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netId: string,
  endpoints: readonly [RouteEndpoint, RouteEndpoint],
): boolean {
  const [leftKey, rightKey] = endpoints.map(endpointKey);
  return netEndpointGroups(document, netId, resolver).some(
    (group) => group.includes(leftKey!) && group.includes(rightKey!),
  );
}

function uniqueDerivedId(
  document: SchematicDocument,
  transactionId: string,
  pairId: string,
): string {
  const occupied = new Set([
    ...document.instances.map((instance) => instance.id),
    ...document.nets.map((net) => net.id),
    ...document.routes.map((route) => route.id),
    ...document.junctions.map((junction) => junction.id),
    ...document.annotations.map((annotation) => annotation.id),
    ...document.noConnects.map((noConnect) => noConnect.id),
    ...document.connectivityEvidence.map((evidence) => evidence.id),
    ...document.layoutGroups.map((group) => group.id),
    ...document.constraints.map((constraint) => constraint.id),
    ...(document.drafting?.objects.map((object) => object.id) ?? []),
    ...(document.netlist?.terminals.map((terminal) => terminal.id) ?? []),
  ]);
  let attempt = 0;
  while (true) {
    const id = deriveStableId(
      "route",
      document.id,
      "direct-contact",
      transactionId,
      pairId,
      String(attempt),
    );
    if (!occupied.has(id)) return id;
    attempt += 1;
  }
}

/**
 * Reconcile zero-length endpoint contacts once, after all transform edits have
 * reached their final projected positions.
 *
 * This phase mutates only ordinary Route geometry. Gained exact contacts are
 * handled later by the transaction connectivity normalizer, after every edit
 * and route-follow operation has reached its final geometry.
 */
export function reconcileTransformDirectContacts(
  before: SchematicDocument,
  draft: SchematicDocument,
  resolver: SymbolResolver,
  transactionId: string,
  changedObjectIds: Set<string>,
): DirectContactReconciliation {
  const delta = deriveDirectContactDelta(before, draft, resolver);
  let geometryChanged = false;
  const changedRouteIds: string[] = [];

  for (const pair of delta.lost) {
    const [left, right] = pair.endpoints;
    const leftOwner = endpointOwnerNetId(draft, left);
    const rightOwner = endpointOwnerNetId(draft, right);
    if (!leftOwner || leftOwner !== rightOwner) continue;
    if (
      endpointsSharePhysicalComponent(
        draft,
        resolver,
        leftOwner,
        pair.endpoints,
      )
    ) {
      continue;
    }
    const leftConnection = resolveEndpointConnection(draft, resolver, left);
    const rightConnection = resolveEndpointConnection(draft, resolver, right);
    const leftPoint = leftConnection?.contactPoint;
    const rightPoint = rightConnection?.contactPoint;
    if (
      !leftConnection ||
      !rightConnection ||
      !leftPoint ||
      !rightPoint ||
      (leftPoint.x === rightPoint.x && leftPoint.y === rightPoint.y)
    ) {
      continue;
    }
    const geometry = buildManualWirePath(
      { connection: leftConnection },
      { connection: rightConnection },
    );
    const routeId = uniqueDerivedId(draft, transactionId, pair.id);
    draft.routes.push(
      createRoutePath({
        id: routeId,
        netId: leftOwner,
        start: structuredClone(left),
        end: structuredClone(right),
        bends: geometry.waypoints,
        modes: geometry.segmentModes,
        ...([left, right].some((endpoint) => isMosBulkTerminal(draft, endpoint))
          ? { presentation: "bulk-dashed" as const }
          : {}),
      }),
    );
    changedObjectIds.add(routeId);
    changedRouteIds.push(routeId);
    geometryChanged = true;
  }

  return {
    geometryChanged,
    changedRouteIds,
  };
}
