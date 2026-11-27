import { endpointKey } from "@icm/derived";
import {
  foldNetName,
  routeEnd,
  routeEndpoints,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";
import { writableDraftRow } from "./local-transaction-draft.js";
import { replaceLayoutReference } from "./transaction-routing.js";

function deduplicateConnectivityEvidence(
  draft: SchematicDocument,
  changedObjectIds: Set<string>,
): void {
  const seenEvidence = new Set<string>();
  draft.connectivityEvidence = draft.connectivityEvidence.filter((evidence) => {
    const key =
      evidence.kind === "spice-source"
        ? `spice-source\u0000${evidence.netId}\u0000${evidence.sourceNetId}`
        : evidence.kind === "net-name-hint"
          ? `net-name-hint\u0000${evidence.netId}\u0000${evidence.origin}\u0000${foldNetName(evidence.sourceName)}`
          : evidence.kind === "name-claim" &&
              evidence.owner.kind === "global-declaration"
            ? `global-declaration\u0000${evidence.netId}\u0000${evidence.owner.sourceNetId}\u0000${foldNetName(evidence.name)}`
            : null;
    if (!key || !seenEvidence.has(key)) {
      if (key) seenEvidence.add(key);
      return true;
    }
    changedObjectIds.add(evidence.id);
    return false;
  });
}

/**
 * Single authoritative mutator that remaps every reference to `sourceNetId`
 * onto `targetNetId` across all linked Document tables:
 * 1. `instances[].mosBulkBinding` & `instances[].netlist.control`
 * 2. `mosBulkDefaults` (`nmosNetId`, `pmosNetId`)
 * 3. `netlist.terminals` (scalar `netId` and bus `signal.members`)
 * 4. `routes` (scalar `netId` and bus `members`)
 * 5. `junctions` (scalar `netId` and bus `members`)
 * 6. `annotations` (`netId` and `net-name` binding)
 * 7. `layoutGroups` and `constraints`
 * 8. `connectivityEvidence` (scalar `netId`, bus `signal.members`, deduplication)
 */
export function remapDocumentNetReferences(
  draft: SchematicDocument,
  sourceNetId: string,
  targetNetId: string,
  changedObjectIds: Set<string>,
): void {
  if (sourceNetId === targetNetId) return;

  for (const instance of draft.instances) {
    if (instance.mosBulkBinding?.netId === sourceNetId) {
      instance.mosBulkBinding.netId = targetNetId;
      changedObjectIds.add(instance.id);
    }
    // A controlled source senses the merged Net, not the identity it lost.
    const control = instance.netlist?.control;
    if (control?.kind === "voltage") {
      if (control.positiveNetId === sourceNetId) {
        control.positiveNetId = targetNetId;
        changedObjectIds.add(instance.id);
      }
      if (control.negativeNetId === sourceNetId) {
        control.negativeNetId = targetNetId;
        changedObjectIds.add(instance.id);
      }
    }
  }

  if (draft.mosBulkDefaults?.nmosNetId === sourceNetId) {
    draft.mosBulkDefaults.nmosNetId = targetNetId;
  }
  if (draft.mosBulkDefaults?.pmosNetId === sourceNetId) {
    draft.mosBulkDefaults.pmosNetId = targetNetId;
  }

  for (const terminal of draft.netlist?.terminals ?? []) {
    if (terminal.netId === sourceNetId) terminal.netId = targetNetId;
    for (const member of terminal.signal?.members ?? []) {
      if (member.netId === sourceNetId) member.netId = targetNetId;
    }
  }

  for (const [index, route] of draft.routes.entries()) {
    for (const member of route.members ?? []) {
      if (member.netId === sourceNetId) member.netId = targetNetId;
    }
    if (route.netId === sourceNetId) {
      writableDraftRow(draft, draft.routes, route, index).netId = targetNetId;
      changedObjectIds.add(route.id);
    }
  }

  for (const [index, junction] of draft.junctions.entries()) {
    for (const member of junction.members ?? []) {
      if (member.netId === sourceNetId) member.netId = targetNetId;
    }
    if (junction.netId === sourceNetId) {
      writableDraftRow(draft, draft.junctions, junction, index).netId =
        targetNetId;
      changedObjectIds.add(junction.id);
    }
  }

  for (const annotation of draft.annotations) {
    if (annotation.netId === sourceNetId) {
      annotation.netId = targetNetId;
      changedObjectIds.add(annotation.id);
    }
    if (
      annotation.binding?.kind === "net-name" &&
      annotation.binding.netId === sourceNetId
    ) {
      annotation.binding = { kind: "net-name", netId: targetNetId };
      changedObjectIds.add(annotation.id);
    }
  }

  for (const group of draft.layoutGroups) {
    const replaced = group.objectIds.includes(sourceNetId);
    group.objectIds = replaceLayoutReference(
      group.objectIds,
      sourceNetId,
      targetNetId,
    );
    if (replaced) changedObjectIds.add(group.id);
  }

  for (const constraint of draft.constraints) {
    const replaced = constraint.objectIds.includes(sourceNetId);
    constraint.objectIds = replaceLayoutReference(
      constraint.objectIds,
      sourceNetId,
      targetNetId,
    );
    if (replaced) changedObjectIds.add(constraint.id);
  }

  for (const [index, evidence] of draft.connectivityEvidence.entries()) {
    if (evidence.kind === "name-claim") {
      for (const member of evidence.signal?.members ?? []) {
        if (member.netId === sourceNetId) {
          member.netId = targetNetId;
          changedObjectIds.add(evidence.id);
        }
      }
    }
    if (evidence.netId === sourceNetId) {
      writableDraftRow(
        draft,
        draft.connectivityEvidence,
        evidence,
        index,
      ).netId = targetNetId;
      changedObjectIds.add(evidence.id);
    }
  }
  deduplicateConnectivityEvidence(draft, changedObjectIds);
}

/**
 * Whether any live electrical, routing, presentation, layout, or bulk-binding
 * owner still references `netId` (excluding passive evidence/defaults).
 */
export function isBaseNetReferenced(
  draft: SchematicDocument,
  netId: string,
): boolean {
  return (
    draft.routes.some(
      (route) =>
        route.netId === netId ||
        route.members?.some((member) => member.netId === netId),
    ) ||
    draft.junctions.some(
      (junction) =>
        junction.netId === netId ||
        junction.members?.some((member) => member.netId === netId),
    ) ||
    Boolean(
      draft.netlist?.terminals.some(
        (terminal) =>
          terminal.netId === netId ||
          terminal.signal?.members.some((member) => member.netId === netId),
      ),
    ) ||
    draft.annotations.some(
      (annotation) =>
        annotation.netId === netId ||
        (annotation.binding?.kind === "net-name" &&
          annotation.binding.netId === netId),
    ) ||
    draft.layoutGroups.some((group) => group.objectIds.includes(netId)) ||
    draft.constraints.some((constraint) =>
      constraint.objectIds.includes(netId),
    ) ||
    draft.instances.some((instance) => instance.mosBulkBinding?.netId === netId)
  );
}

/** Remove `netId` from `mosBulkDefaults`, deleting the container when empty. */
export function clearMosBulkDefaultNetReference(
  draft: SchematicDocument,
  netId: string,
  changedObjectIds: Set<string>,
): boolean {
  let cleared = false;
  if (draft.mosBulkDefaults?.nmosNetId === netId) {
    delete draft.mosBulkDefaults.nmosNetId;
    cleared = true;
  }
  if (draft.mosBulkDefaults?.pmosNetId === netId) {
    delete draft.mosBulkDefaults.pmosNetId;
    cleared = true;
  }
  if (cleared) {
    if (
      !draft.mosBulkDefaults?.nmosNetId &&
      !draft.mosBulkDefaults?.pmosNetId
    ) {
      delete draft.mosBulkDefaults;
    }
    changedObjectIds.add(draft.id);
  }
  return cleared;
}

export interface NetSubgraphComponent {
  readonly routeIds: Set<string>;
  readonly junctionIds: Set<string>;
  readonly terminals: Array<{
    instanceId: string;
    pinName: string;
    memberId?: string | undefined;
  }>;
  readonly directContactPairs: Array<[RouteEndpoint, RouteEndpoint]>;
}

/**
 * Partition selected endpoints/routes/junctions on one Base Net into connected
 * components so disconnected subgraphs never merge onto one fresh Base Net.
 */
export function partitionNetSubgraphComponents(
  document: SchematicDocument,
  netId: string,
  selectedRouteIds: ReadonlySet<string>,
  selectedJunctionIds: ReadonlySet<string>,
  selectedTerminals: readonly {
    instanceId: string;
    pinName: string;
    memberId?: string | undefined;
  }[],
  internalContacts: readonly (readonly RouteEndpoint[])[],
): NetSubgraphComponent[] {
  const endpointByKey = new Map<string, RouteEndpoint>();
  const terminalByKey = new Map<
    string,
    { instanceId: string; pinName: string; memberId?: string | undefined }
  >();
  for (const terminal of selectedTerminals) {
    const endpoint: RouteEndpoint = { kind: "terminal", ...terminal };
    const key = endpointKey(endpoint);
    endpointByKey.set(key, endpoint);
    terminalByKey.set(key, terminal);
  }
  for (const junctionId of selectedJunctionIds) {
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
    (route) => route.netId === netId && selectedRouteIds.has(route.id),
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
  const components: NetSubgraphComponent[] = [];
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
      [...selectedJunctionIds].filter((id) =>
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
 * Plan typed edits that lift one connected subgraph off `sourceNetId` onto a
 * fresh Base Net (`newNetId`), re-anchoring and retargeting its routes,
 * junctions, terminals, direct contacts, anchored annotations, and owned
 * net-label name claims.
 */
export function planSubgraphNetLift(
  document: SchematicDocument,
  sourceNetId: string,
  component: Pick<
    NetSubgraphComponent,
    "routeIds" | "junctionIds" | "terminals" | "directContactPairs"
  >,
  newNetId: string,
): SchematicEdit[] {
  const liftedRoutes = document.routes.filter((route) =>
    component.routeIds.has(route.id),
  );
  const liftedJunctions = document.junctions.filter((junction) =>
    component.junctionIds.has(junction.id),
  );
  const anchoredAnnotations = document.annotations.filter(
    (annotation) =>
      (annotation.anchor.kind === "route" &&
        component.routeIds.has(annotation.anchor.routeId)) ||
      (annotation.anchor.kind === "object" &&
        component.junctionIds.has(annotation.anchor.objectId)),
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
  const disconnectTerminals: SchematicEdit[] = component.terminals.map(
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
  const restoreDirectContacts: SchematicEdit[] = component.directContactPairs
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
