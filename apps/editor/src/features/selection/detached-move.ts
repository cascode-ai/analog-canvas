import { deriveDocumentContactEvidence, endpointKey } from "@icm/derived";
import {
  partitionNetSubgraphComponents,
  planBoundaryRouteDetachment,
  planRoutedTerminalDetachment,
  planSubgraphNetLift,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  routeEnd,
  routeEndpoints,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export interface DetachedMoveRegion {
  /** Internal Routes that travel intact with the moving region. */
  readonly routeIds: ReadonlySet<string>;
  /** Internal Junctions that travel intact with the moving region. */
  readonly junctionIds: ReadonlySet<string>;
}

export interface DetachedMovePlan {
  /** Existing typed edits; this planner adds no editor or Engine protocol. */
  edits: readonly SchematicEdit[];
  /** Terminal memberships intentionally removed by the move. */
  disconnectedEndpointKeys: readonly string[];
  /** Boundary Routes re-anchored onto stationary Junction stubs. */
  detachedBoundaryRouteIds: readonly string[];
  /** Base Nets split between moving internal wiring and stationary endpoints. */
  partitionedNetIds: readonly string[];
}

function occupiedDocumentIds(document: SchematicDocument): Set<string> {
  return new Set(
    [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.connectivityEvidence,
      ...document.layoutGroups,
      ...document.constraints,
      ...(document.inductorCouplings ?? []),
      ...(document.drafting?.objects ?? []),
    ].map((object) => object.id),
  );
}

/**
 * Leave every detached wire at its authored coordinates, then electrically
 * disconnect only the boundary connections leaving the moving selection:
 * - Without `region` (single-part detach or Shift+M), every routed wire
 *   touching the selected instances becomes an open Junction stub and those
 *   terminals disconnect.
 * - With `region` (Ctrl/Cmd-drag on a selected region), internal Routes and
 *   Junctions stay intact while boundary Routes re-anchor onto stationary
 *   Junction stubs and separate cleanly from the moving Nets.
 */
export function planDetachedMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
  sequence: number,
  region?: DetachedMoveRegion,
): DetachedMovePlan {
  const preservedRoutes = region?.routeIds ?? new Set<string>();
  const preservedJunctions = region?.junctionIds ?? new Set<string>();
  const hasRegionWiring =
    preservedRoutes.size > 0 || preservedJunctions.size > 0;
  const isMoving = (endpoint: RouteEndpoint): boolean =>
    endpoint.kind === "terminal"
      ? instanceIds.has(endpoint.instanceId)
      : preservedJunctions.has(endpoint.junctionId);

  if (!hasRegionWiring) {
    const detachedTerminalKeys = new Set(
      document.routes.flatMap((route) =>
        routeEndpoints(route).flatMap((endpoint) =>
          endpoint.kind === "terminal" && instanceIds.has(endpoint.instanceId)
            ? [endpointKey(endpoint)]
            : [],
        ),
      ),
    );
    // A pin set directly on another part's pin, or on a Junction, holds a
    // contact with no wire: the part lets go of it too, or the move would
    // carry what it touches along.
    for (const contact of deriveDocumentContactEvidence(document, resolver)
      .contacts)
      if (contact.endpoints.some((endpoint) => !isMoving(endpoint)))
        for (const endpoint of contact.endpoints)
          if (endpoint.kind === "terminal" && isMoving(endpoint))
            detachedTerminalKeys.add(endpointKey(endpoint));
    const disconnectedEndpointKeys: string[] = [];
    const disconnectEdits = document.nets.flatMap((net): SchematicEdit[] =>
      net.terminals.flatMap((terminal): SchematicEdit[] => {
        const endpoint = { kind: "terminal" as const, ...terminal };
        const key = endpointKey(endpoint);
        if (!detachedTerminalKeys.has(key)) return [];
        disconnectedEndpointKeys.push(key);
        return [{ kind: "disconnect_endpoint", endpoint }];
      }),
    );

    return {
      edits: [
        ...planRoutedTerminalDetachment(
          document,
          resolver,
          instanceIds,
          sequence,
        ),
        ...disconnectEdits,
      ],
      disconnectedEndpointKeys,
      detachedBoundaryRouteIds: [],
      partitionedNetIds: [],
    };
  }

  const boundary = planBoundaryRouteDetachment(
    document,
    resolver,
    instanceIds,
    preservedJunctions,
    preservedRoutes,
    sequence,
  );
  const contacts = deriveDocumentContactEvidence(document, resolver).contacts;

  // Moving endpoints bound together inside the region (by a preserved Route or
  // an internal direct contact) stay wired together instead of disconnecting.
  const internallyConnectedKeys = new Set<string>();
  for (const route of document.routes) {
    if (!preservedRoutes.has(route.id)) continue;
    for (const endpoint of routeEndpoints(route)) {
      if (isMoving(endpoint))
        internallyConnectedKeys.add(endpointKey(endpoint));
    }
  }
  for (const contact of contacts) {
    const movingHere = contact.endpoints.filter(isMoving);
    if (movingHere.length >= 2) {
      for (const endpoint of movingHere) {
        internallyConnectedKeys.add(endpointKey(endpoint));
      }
    }
  }

  const boundaryRouteSet = new Set(boundary.detachedRouteIds);
  const loneDetachedTerminalKeys = new Set<string>();
  const partitionedNetIds = new Set<string>();
  const directContactBoundaryNetIds = new Set<string>();

  for (const route of document.routes) {
    if (!boundaryRouteSet.has(route.id)) continue;
    for (const endpoint of [route.start, routeEnd(route)]) {
      if (!isMoving(endpoint)) continue;
      const key = endpointKey(endpoint);
      if (endpoint.kind === "terminal" && !internallyConnectedKeys.has(key)) {
        loneDetachedTerminalKeys.add(key);
      } else {
        partitionedNetIds.add(route.netId);
      }
    }
  }

  for (const contact of contacts) {
    if (!contact.endpoints.some((endpoint) => !isMoving(endpoint))) continue;
    for (const endpoint of contact.endpoints) {
      if (!isMoving(endpoint)) continue;
      const key = endpointKey(endpoint);
      if (endpoint.kind === "terminal" && !internallyConnectedKeys.has(key)) {
        loneDetachedTerminalKeys.add(key);
      } else {
        const ownerNet =
          endpoint.kind === "terminal"
            ? document.nets.find((net) =>
                net.terminals.some(
                  (t) =>
                    t.instanceId === endpoint.instanceId &&
                    t.pinName === endpoint.pinName &&
                    t.memberId === endpoint.memberId,
                ),
              )?.id
            : document.junctions.find(
                (junction) => junction.id === endpoint.junctionId,
              )?.netId;
        if (ownerNet) {
          partitionedNetIds.add(ownerNet);
          directContactBoundaryNetIds.add(ownerNet);
        }
      }
    }
  }

  const disconnectedEndpointKeys: string[] = [];
  const disconnectEdits = document.nets.flatMap((net): SchematicEdit[] =>
    net.terminals.flatMap((terminal): SchematicEdit[] => {
      const endpoint = { kind: "terminal" as const, ...terminal };
      const key = endpointKey(endpoint);
      if (!loneDetachedTerminalKeys.has(key)) return [];
      disconnectedEndpointKeys.push(key);
      return [{ kind: "disconnect_endpoint", endpoint }];
    }),
  );

  // When an internally wired moving subgraph directly touches a stationary pin
  // or Junction with no wire between them, lift that moving subgraph onto its
  // own Base Net before the move so direct-contact reconciliation does not
  // synthesize a bridging wire back to the stationary contact.
  const liftEdits: SchematicEdit[] = [];
  if (directContactBoundaryNetIds.size > 0) {
    const occupied = occupiedDocumentIds(document);
    let netCounter = 0;
    for (const netId of [...directContactBoundaryNetIds].sort((a, b) =>
      a.localeCompare(b, "en"),
    )) {
      const net = document.nets.find((candidate) => candidate.id === netId);
      if (!net) continue;
      const movingNetRoutes = new Set(
        document.routes
          .filter(
            (route) => route.netId === netId && preservedRoutes.has(route.id),
          )
          .map((route) => route.id),
      );
      const movingNetJunctions = new Set(
        document.junctions
          .filter(
            (junction) =>
              junction.netId === netId && preservedJunctions.has(junction.id),
          )
          .map((junction) => junction.id),
      );
      const movingNetTerminals = net.terminals.filter(
        (terminal) =>
          instanceIds.has(terminal.instanceId) &&
          !loneDetachedTerminalKeys.has(
            endpointKey({ kind: "terminal", ...terminal }),
          ),
      );
      const internalContactGroups = contacts
        .map((contact) => contact.endpoints.filter(isMoving))
        .filter((group) => group.length >= 2);
      const components = partitionNetSubgraphComponents(
        document,
        netId,
        movingNetRoutes,
        movingNetJunctions,
        movingNetTerminals,
        internalContactGroups,
      );
      for (const component of components) {
        if (
          component.routeIds.size === 0 &&
          component.junctionIds.size === 0 &&
          component.directContactPairs.length === 0
        ) {
          continue;
        }
        let newNetId: string;
        do {
          netCounter += 1;
          newNetId = `net-detach-${sequence}-${netCounter}`;
        } while (occupied.has(newNetId));
        occupied.add(newNetId);
        liftEdits.push(
          ...planSubgraphNetLift(document, netId, component, newNetId),
        );
      }
    }
  }

  return {
    edits: [...boundary.edits, ...disconnectEdits, ...liftEdits],
    disconnectedEndpointKeys,
    detachedBoundaryRouteIds: boundary.detachedRouteIds,
    partitionedNetIds: [...partitionedNetIds].sort((a, b) =>
      a.localeCompare(b, "en"),
    ),
  };
}
