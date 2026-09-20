import { createRoutePath, deriveStableId, routeEndpoints } from "@icm/model";
import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  deriveDirectContactDelta,
  deriveDocumentContactEvidence,
  endpointKey,
  isVisibleEndpoint,
  isMosBulkTerminal,
  netEndpoints,
  pointOnSegment,
  resolveEndpointConnection,
  resolveEndpointPoint,
} from "@icm/derived";
import type { DocumentContactEvidence } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { buildManualWirePath } from "./routing-planner.js";
import {
  endpointOwnerNetId,
  netEndpointGroups,
} from "./transaction-routing.js";
import type {
  ContactEvidenceHint,
  RejectedTransaction,
} from "./transaction-result.js";
import { resolveRouteEditPath } from "./route-operations.js";
import {
  applyRouteTopologyEdit,
  type RouteTopologyEditContext,
} from "./transaction-route-topology.js";

export interface DirectContactReconciliation {
  geometryChanged: boolean;
  changedRouteIds: readonly string[];
  rejection?: RejectedTransaction;
}

function routeContactSegment(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
  point: Point,
): number {
  const path = resolveRouteEditPath(document, resolver, route);
  return path
    ? path.points
        .slice(1)
        .findIndex(
          (to, i) =>
            path.segmentModes[i] !== "escape" &&
            pointOnSegment(point, path.points[i]!, to),
        )
    : -1;
}

/**
 * Cheap conservative guard for transform transactions. A lost direct contact
 * must have contained a moved endpoint at a coordinate shared by at least one
 * other visible endpoint or a same-Net conductor before the transform.
 * Returning true may do extra work; returning false proves the full
 * contact-delta derivation unnecessary.
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
    const movedEndpoints: { endpoint: RouteEndpoint; point: Point }[] = [];
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
      if (
        (endpoint.kind === "terminal" &&
          instanceIds.has(endpoint.instanceId)) ||
        (endpoint.kind === "junction" && junctionIds.has(endpoint.junctionId))
      ) {
        movedEndpoints.push({ endpoint, point });
      }
    }
    if (
      [...positions.values()].some(
        (entry) => entry.count > 1 && entry.containsTransformedEndpoint,
      )
    ) {
      return true;
    }
    for (const { endpoint, point } of movedEndpoints) {
      if (
        document.routes.some(
          (route) =>
            route.netId === net.id &&
            !routeEndpoints(route).some(
              (e) => endpointKey(e) === endpointKey(endpoint),
            ) &&
            routeContactSegment(document, resolver, route, point) >= 0,
        )
      )
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
  contactEvidence?: DocumentContactEvidence,
): boolean {
  const [leftKey, rightKey] = endpoints.map(endpointKey);
  return netEndpointGroups(document, netId, resolver, contactEvidence).some(
    (group) => group.includes(leftKey!) && group.includes(rightKey!),
  );
}

function uniqueDerivedId(
  document: SchematicDocument,
  transactionId: string,
  pairId: string,
  kind: "route" | "junction" = "route",
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
      kind,
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
 * This phase adds Route geometry and, for unsplit taps, an anchored Junction.
 * Gained exact contacts are
 * handled later by the transaction connectivity normalizer, after every edit
 * and route-follow operation has reached its final geometry.
 */
export function reconcileTransformDirectContacts(
  before: SchematicDocument,
  draft: SchematicDocument,
  resolver: SymbolResolver,
  transactionId: string,
  changedObjectIds: Set<string>,
  topologyContext: Omit<
    RouteTopologyEditContext,
    "draft" | "resolver" | "changedObjectIds"
  >,
  beforeContactEvidence?: ContactEvidenceHint,
): DirectContactReconciliation {
  // The reconciliation below asks `netEndpointGroups` — which derives the whole
  // Document's contact evidence to answer one Net's question — once per lost
  // pair. Deriving the draft's evidence once and handing it to both callers
  // turns (2 + lost pairs) full derivations into two, so the cost no longer
  // grows with how many contacts the edit breaks.
  const priorEvidence =
    beforeContactEvidence?.document === before
      ? beforeContactEvidence.evidence
      : deriveDocumentContactEvidence(before, resolver);
  const draftContactEvidence = deriveDocumentContactEvidence(draft, resolver);
  const delta = deriveDirectContactDelta(before, draft, resolver, {
    // Only an identity match is safe: the payload carries no revision of its
    // own, and evidence from another Document would answer from stale geometry.
    before: priorEvidence,
    after: draftContactEvidence,
  });
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
        draftContactEvidence,
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

  // A parked pin on an unsplit conductor has only one endpoint in its
  // contact, so it has no pair in delta.lost. Keep the original tap in place
  // and materialize a branch when the pin leaves it. Use the typed attachment
  // primitive so route labels/styles survive and unrelated crossings stay
  // untouched. This derives from the pre-move contact, never Net identity alone.
  const splitProducts = new Map<string, Set<string>>();
  for (const contact of priorEvidence.contacts) {
    const routeIds = new Set(
      contact.incidents
        .filter((i) => i.kind === "route")
        .map((i) => i.objectId),
    );
    for (const endpoint of contact.endpoints) {
      const connection = resolveEndpointConnection(draft, resolver, endpoint);
      if (
        !connection ||
        (connection.contactPoint.x === contact.point.x &&
          connection.contactPoint.y === contact.point.y)
      )
        continue;
      const netId = endpointOwnerNetId(draft, endpoint);
      if (!netId) continue; // An explicit disconnect takes precedence.
      for (const id of routeIds) {
        const originalRoute = before.routes.find((r) => r.id === id);
        const products = splitProducts.get(id) ?? new Set([id]);
        const candidates = draft.routes.filter(
          (r) => products.has(r.id) && r.netId === netId,
        );
        if (
          !originalRoute ||
          routeEndpoints(originalRoute).some((e) =>
            contact.endpoints.some((c) => endpointKey(c) === endpointKey(e)),
          )
        )
          continue;
        if (
          candidates.some(
            (route) =>
              routeContactSegment(
                draft,
                resolver,
                route,
                connection.contactPoint,
              ) >= 0,
          )
        )
          continue;
        const route = candidates.find(
          (route) =>
            routeContactSegment(draft, resolver, route, contact.point) >= 0,
        );
        if (!route) continue;
        const segmentIndex = routeContactSegment(
          draft,
          resolver,
          route,
          contact.point,
        );
        if (
          segmentIndex < 0 ||
          endpointsSharePhysicalComponent(draft, resolver, netId, [
            endpoint,
            route.start,
          ])
        )
          continue;
        let anchor = routeEndpoints(route).find((e) => {
          const point = resolveEndpointPoint(draft, resolver, e);
          return point?.x === contact.point.x && point.y === contact.point.y;
        });
        if (!anchor) {
          const junctionId = uniqueDerivedId(
            draft,
            transactionId,
            contact.id,
            "junction",
          );
          anchor = { kind: "junction", junctionId };
          draft.junctions.push({
            id: junctionId,
            netId,
            position: { ...contact.point },
            role: "route-anchor",
          });
          changedObjectIds.add(junctionId);
          const secondRouteId = uniqueDerivedId(
            draft,
            transactionId,
            `${contact.id}:split`,
          );
          const attached = applyRouteTopologyEdit(
            {
              kind: "attach_endpoint_to_route",
              endpoint: anchor,
              routeId: route.id,
              legId: route.legs[segmentIndex]!.id,
              point: contact.point,
              firstRouteId: route.id,
              secondRouteId,
            },
            { ...topologyContext, draft, resolver, changedObjectIds },
          );
          if (!attached.ok)
            return {
              geometryChanged,
              changedRouteIds,
              rejection: attached.rejection,
            };
          changedRouteIds.push(route.id, secondRouteId);
          products.add(secondRouteId);
          splitProducts.set(id, products);
        }
        const anchorConnection = resolveEndpointConnection(
          draft,
          resolver,
          anchor,
        )!;
        const geometry = buildManualWirePath(
          { connection },
          { connection: anchorConnection },
        );
        const routeId = uniqueDerivedId(
          draft,
          transactionId,
          `${contact.id}:${endpointKey(endpoint)}`,
        );
        draft.routes.push(
          createRoutePath({
            id: routeId,
            netId,
            start: structuredClone(endpoint),
            end: structuredClone(anchor),
            bends: geometry.waypoints,
            modes: geometry.segmentModes,
            ...(isMosBulkTerminal(draft, endpoint)
              ? { presentation: "bulk-dashed" as const }
              : {}),
          }),
        );
        changedObjectIds.add(routeId);
        changedRouteIds.push(routeId);
        geometryChanged = true;
      }
    }
  }

  return {
    geometryChanged,
    changedRouteIds,
  };
}
