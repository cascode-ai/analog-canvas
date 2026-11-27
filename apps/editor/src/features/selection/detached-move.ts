import { deriveDocumentContactEvidence, endpointKey } from "@icm/derived";
import {
  planBoundaryRouteDetachment,
  planRoutedTerminalDetachment,
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
 * Partition the moving endpoints/routes/junctions on one Net into connected
 * components so disconnected moving subgraphs never merge onto one fresh Net.
 */
function movingSubgraphComponentsOnNet(
  document: SchematicDocument,
  netId: string,
  movingRouteIds: ReadonlySet<string>,
  movingJunctionIds: ReadonlySet<string>,
  movingTerminals: readonly {
    instanceId: string;
    pinName: string;
    memberId?: string | undefined;
  }[],
  internalContacts: readonly (readonly RouteEndpoint[])[],
): Array<{
  routeIds: Set<string>;
  junctionIds: Set<string>;
  terminals: {
    instanceId: string;
    pinName: string;
    memberId?: string | undefined;
  }[];
  directContactPairs: Array<[RouteEndpoint, RouteEndpoint]>;
}> {
  const endpointByKey = new Map<string, RouteEndpoint>();
  const terminalByKey = new Map<
    string,
    { instanceId: string; pinName: string; memberId?: string | undefined }
  >();
  for (const terminal of movingTerminals) {
    const endpoint: RouteEndpoint = { kind: "terminal", ...terminal };
    const key = endpointKey(endpoint);
    endpointByKey.set(key, endpoint);
    terminalByKey.set(key, terminal);
  }
  for (const junctionId of movingJunctionIds) {
    const endpoint: RouteEndpoint = { kind: "junction", junctionId };
    endpointByKey.set(endpointKey(endpoint), endpoint);
  }
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let listA = adjacency.get(a);
    if (!listA) {
      listA = new Set();
      adjacency.set(a, listA);
    }
    listA.add(b);
    let listB = adjacency.get(b);
    if (!listB) {
      listB = new Set();
      adjacency.set(b, listB);
    }
    listB.add(a);
  };
  const routesOnNet = document.routes.filter(
    (route) => route.netId === netId && movingRouteIds.has(route.id),
  );
  for (const route of routesOnNet) {
    const startKey = endpointKey(route.start);
    const endKey = endpointKey(routeEnd(route));
    endpointByKey.set(startKey, route.start);
    endpointByKey.set(endKey, routeEnd(route));
    link(startKey, endKey);
  }
  const contactPairs: Array<[RouteEndpoint, RouteEndpoint]> = [];
  for (const group of internalContacts) {
    const inNet = group.filter((endpoint) =>
      endpointByKey.has(endpointKey(endpoint)),
    );
    const [first, ...rest] = inNet;
    if (!first) continue;
    for (const other of rest) {
      link(endpointKey(first), endpointKey(other));
      contactPairs.push([first, other]);
    }
  }
  const visited = new Set<string>();
  const components: Array<{
    routeIds: Set<string>;
    junctionIds: Set<string>;
    terminals: {
      instanceId: string;
      pinName: string;
      memberId?: string | undefined;
    }[];
    directContactPairs: Array<[RouteEndpoint, RouteEndpoint]>;
  }> = [];
  for (const startKey of [...endpointByKey.keys()].sort((a, b) =>
    a.localeCompare(b, "en"),
  )) {
    if (visited.has(startKey)) continue;
    const componentKeys = new Set<string>();
    const queue = [startKey];
    visited.add(startKey);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      componentKeys.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const routeIds = new Set(
      routesOnNet
        .filter(
          (route) =>
            componentKeys.has(endpointKey(route.start)) ||
            componentKeys.has(endpointKey(routeEnd(route))),
        )
        .map((route) => route.id),
    );
    const junctionIds = new Set(
      [...movingJunctionIds].filter((id) =>
        componentKeys.has(endpointKey({ kind: "junction", junctionId: id })),
      ),
    );
    const terminals = [...componentKeys]
      .flatMap((key) => {
        const terminal = terminalByKey.get(key);
        return terminal ? [terminal] : [];
      })
      .sort((a, b) =>
        `${a.instanceId}:${a.pinName}`.localeCompare(
          `${b.instanceId}:${b.pinName}`,
          "en",
        ),
      );
    const directContactPairs = contactPairs.filter(
      ([a, b]) =>
        componentKeys.has(endpointKey(a)) && componentKeys.has(endpointKey(b)),
    );
    components.push({ routeIds, junctionIds, terminals, directContactPairs });
  }
  return components;
}

/**
 * Lift one connected internal moving subgraph off a shared Net onto a fresh
 * Base Net so direct contacts with stationary pins/Junctions separate cleanly
 * without synthesizing bridging wires.
 */
function planDirectContactSubgraphLift(
  document: SchematicDocument,
  sourceNetId: string,
  movingComponent: {
    routeIds: ReadonlySet<string>;
    junctionIds: ReadonlySet<string>;
    terminals: readonly {
      instanceId: string;
      pinName: string;
      memberId?: string | undefined;
    }[];
    directContactPairs: readonly [RouteEndpoint, RouteEndpoint][];
  },
  newNetId: string,
): SchematicEdit[] {
  const liftedRoutes = document.routes.filter((route) =>
    movingComponent.routeIds.has(route.id),
  );
  const liftedJunctions = document.junctions.filter((junction) =>
    movingComponent.junctionIds.has(junction.id),
  );
  const anchoredAnnotations = document.annotations.filter(
    (annotation) =>
      (annotation.anchor.kind === "route" &&
        movingComponent.routeIds.has(annotation.anchor.routeId)) ||
      (annotation.anchor.kind === "object" &&
        movingComponent.junctionIds.has(annotation.anchor.objectId)),
  );
  const lockedAnnotation = anchoredAnnotations.find(
    (annotation) => annotation.locked,
  );
  if (lockedAnnotation) {
    throw new Error(
      `Cannot detach moving region with locked label ${lockedAnnotation.id}`,
    );
  }
  const liftedAnnotationIds = new Set(
    anchoredAnnotations.map((annotation) => annotation.id),
  );
  const retargetedEvidence = document.connectivityEvidence.filter(
    (evidence) =>
      evidence.netId === sourceNetId &&
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "net-label" &&
      liftedAnnotationIds.has(evidence.owner.annotationId),
  );
  const liftAnnotations: SchematicEdit[] = anchoredAnnotations.map(
    (annotation) => ({
      kind: "upsert_schematic_annotation",
      annotation: {
        ...structuredClone(annotation),
        anchor: {
          kind: "free",
          position: structuredClone(
            annotation.anchor.kind === "route" ||
              annotation.anchor.kind === "object"
              ? annotation.anchor.fallbackPosition
              : { x: 0, y: 0 },
          ),
        },
      },
    }),
  );
  const removeRoutes: SchematicEdit[] = liftedRoutes.map((route) => ({
    kind: "remove_route_geometry",
    routeId: route.id,
  }));
  const removeJunctions: SchematicEdit[] = liftedJunctions.map((junction) => ({
    kind: "remove_junction",
    junctionId: junction.id,
  }));
  const disconnectTerminals: SchematicEdit[] = movingComponent.terminals.map(
    (terminal) => ({
      kind: "disconnect_endpoint",
      endpoint: { kind: "terminal", ...terminal },
    }),
  );
  const createNet: SchematicEdit = {
    kind: "create_base_net",
    netId: newNetId,
  };
  const restoreJunctions: SchematicEdit[] = liftedJunctions.map((junction) => ({
    kind: "add_junction",
    junctionId: junction.id,
    netId: newNetId,
    ...(junction.members ? { members: structuredClone(junction.members) } : {}),
    position: structuredClone(junction.position),
    ...(junction.role ? { role: junction.role } : {}),
    ...(junction.documentStyle
      ? { documentStyle: structuredClone(junction.documentStyle) }
      : {}),
    ...(junction.styleOverride
      ? { styleOverride: structuredClone(junction.styleOverride) }
      : {}),
    ...(junction.contactAnchor
      ? { contactAnchor: structuredClone(junction.contactAnchor) }
      : {}),
  }));
  const restoreRoutes: SchematicEdit[] = liftedRoutes.map((route) => ({
    kind: "set_route_path",
    route: {
      ...structuredClone(route),
      netId: newNetId,
    },
  }));
  const routedEndpointKeys = new Set(
    liftedRoutes.flatMap((route) =>
      routeEndpoints(route).map((endpoint) => endpointKey(endpoint)),
    ),
  );
  const restoreDirectContacts: SchematicEdit[] =
    movingComponent.directContactPairs
      .filter(
        ([from, to]) =>
          !routedEndpointKeys.has(endpointKey(from)) ||
          !routedEndpointKeys.has(endpointKey(to)),
      )
      .map(([from, to]) => ({
        kind: "connect_endpoints",
        from,
        to,
        newNetId,
      }));
  const restoreAnnotations: SchematicEdit[] = anchoredAnnotations.map(
    (annotation) => {
      const restored = structuredClone(annotation);
      if (restored.netId !== undefined) restored.netId = newNetId;
      if (restored.binding?.kind === "net-name") {
        restored.binding = { ...restored.binding, netId: newNetId };
      }
      return {
        kind: "upsert_schematic_annotation",
        annotation: restored,
      };
    },
  );
  const restoreEvidence: SchematicEdit[] = retargetedEvidence.map(
    (evidence) => ({
      kind: "upsert_connectivity_evidence",
      evidence: {
        ...structuredClone(evidence),
        netId: newNetId,
      },
    }),
  );
  return [
    ...liftAnnotations,
    ...removeRoutes,
    ...removeJunctions,
    ...disconnectTerminals,
    createNet,
    ...restoreJunctions,
    ...restoreRoutes,
    ...restoreDirectContacts,
    ...restoreAnnotations,
    ...restoreEvidence,
  ];
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
      const components = movingSubgraphComponentsOnNet(
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
          ...planDirectContactSubgraphLift(
            document,
            netId,
            component,
            newNetId,
          ),
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
