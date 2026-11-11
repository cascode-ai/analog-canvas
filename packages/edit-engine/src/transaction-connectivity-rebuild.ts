import {
  routeEndpoints,
  routeElectricalConnections,
  isFrozenSnapshot,
  type Net,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  ConnectionGraph,
  buildDocumentDerivedContext,
  deriveDocumentContactEvidence,
  endpointKey,
  isMosBulkTerminal,
  isVisibleEndpoint,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import type { EditTransaction } from "./edit-schema.js";
import {
  addEndpointToNet,
  prepareNetEndpointGroupRead,
} from "./transaction-routing.js";
import { prepareConnectivityPhaseRead } from "./connectivity-phase-read.js";
import {
  mergeBaseNets,
  preferredPhysicalMergeTarget,
  propagateSpiceSourceEvidenceAfterSplit,
  removeNoConnectForEndpoint,
  retargetMosBulkDefaultsAfterSplit,
  retargetOwnerEvidenceAfterSplit,
  uniquePhysicalContactId,
} from "./transaction-connectivity.js";

function partitionNet(
  draft: SchematicDocument,
  net: Net,
  groups: string[][],
  changed: Set<string>,
): void {
  if (groups.length < 2) return;
  const logical = resolveDocumentLogicalNets(draft).byBaseNetId.get(net.id);
  const identity = logical
    ? {
        ...(logical.name ? { name: logical.name } : {}),
        ...(logical.scope ? { scope: logical.scope } : {}),
        ...(logical.powerDomain === "vdd" || logical.powerDomain === "ground"
          ? { powerDomain: logical.powerDomain }
          : {}),
      }
    : undefined;
  const byEndpoint = new Map<string, string>();
  const terminals = net.terminals;
  const ids: string[] = [];
  groups.forEach((group, index) => {
    const id =
      index === 0
        ? net.id
        : uniquePhysicalContactId(draft, "net", `split:${net.id}:${group[0]}`);
    ids.push(id);
    for (const key of group) byEndpoint.set(key, id);
    const members = terminals.filter((t) =>
      group.includes(endpointKey({ kind: "terminal", ...t })),
    );
    if (index === 0) net.terminals = members;
    else draft.nets.push({ id, terminals: members });
    changed.add(id);
  });
  for (const junction of draft.junctions) {
    if (junction.members) {
      for (const member of junction.members) {
        const id = byEndpoint.get(
          endpointKey({
            kind: "junction",
            junctionId: junction.id,
            memberId: member.id,
          }),
        );
        if (member.netId === net.id && id) {
          member.netId = id;
          changed.add(junction.id);
        }
      }
      junction.netId = junction.members[0]!.netId;
      continue;
    }
    if (junction.netId !== net.id) continue;
    const id = byEndpoint.get(
      endpointKey({ kind: "junction", junctionId: junction.id }),
    );
    if (id && id !== junction.netId) {
      junction.netId = id;
      changed.add(junction.id);
    }
  }
  for (const route of draft.routes) {
    if (route.members) {
      for (const edge of routeElectricalConnections(route)) {
        if (edge.netId !== net.id) continue;
        const id = edge.endpoints
          .map((endpoint) => byEndpoint.get(endpointKey(endpoint)))
          .find(Boolean);
        const member = route.members.find((item) => item.id === edge.memberId)!;
        if (id) {
          member.netId = id;
          changed.add(route.id);
        }
      }
      route.netId = route.members[0]!.netId;
      continue;
    }
    if (route.netId !== net.id) continue;
    const id = routeEndpoints(route)
      .map((e) => byEndpoint.get(endpointKey(e)))
      .find(Boolean);
    if (id && id !== route.netId) {
      route.netId = id;
      changed.add(route.id);
    }
  }
  for (const instance of draft.instances) {
    if (instance.mosBulkBinding?.netId !== net.id) continue;
    const id = byEndpoint.get(
      endpointKey({ kind: "terminal", instanceId: instance.id, pinName: "B" }),
    );
    if (id && id !== net.id) {
      instance.mosBulkBinding.netId = id;
      changed.add(instance.id);
    }
  }
  for (const terminal of draft.netlist?.terminals ?? []) {
    if (terminal.signal && terminal.signal.members.length > 1) {
      for (const member of terminal.signal.members) {
        if (member.netId !== net.id) continue;
        const instanceId = terminal.interfaceInstanceIds[0];
        const id =
          instanceId &&
          byEndpoint.get(
            endpointKey({
              kind: "terminal",
              instanceId,
              pinName: "P",
              memberId: member.id,
            }),
          );
        if (id) {
          member.netId = id;
          changed.add(terminal.id);
        }
      }
      terminal.netId = terminal.signal.members[0]!.netId;
      continue;
    }
    if (terminal.netId !== net.id) continue;
    const instanceId = terminal.interfaceInstanceIds[0];
    const annotation = draft.annotations.find(
      (a) => a.id === terminal.interfaceAnnotationId,
    );
    const id = instanceId
      ? byEndpoint.get(
          endpointKey({ kind: "terminal", instanceId, pinName: "P" }),
        )
      : annotation?.anchor.kind === "object"
        ? byEndpoint.get(
            endpointKey({
              kind: "junction",
              junctionId: annotation.anchor.objectId,
            }),
          )
        : undefined;
    if (id && id !== terminal.netId) {
      terminal.netId = id;
      if (terminal.signal) terminal.signal.members[0]!.netId = id;
      changed.add(terminal.id);
    }
  }
  retargetOwnerEvidenceAfterSplit(draft, net.id, changed);
  propagateSpiceSourceEvidenceAfterSplit(draft, net.id, ids, changed);
  retargetMosBulkDefaultsAfterSplit(draft, net.id, ids, identity, changed);
}

/** A Net that holds no pin, wire or Junction (a label's own logical Net). */
function memberless(document: SchematicDocument, netId: string): boolean {
  const net = document.nets.find((candidate) => candidate.id === netId);
  return (
    (net?.terminals.length ?? 0) === 0 &&
    !document.routes.some((route) => route.netId === netId) &&
    !document.junctions.some((junction) => junction.netId === netId)
  );
}

/**
 * A cut releases its Net's unrouted intent, but not a pin no one can draw: a
 * hidden supply pin (an op-amp's VDD) or a model's substrate has no geometry
 * to keep it on its Net, so cutting any other wire would strand it on a Net of
 * its own (#2254). It stays with the Net's largest surviving component. MOS
 * bulks are left to the bulk reconciler, which follows the Cell defaults.
 */
function keepUndrawableMembersAfterCut(
  draft: SchematicDocument,
  groups: readonly string[][],
  graph: ConnectionGraph,
  endpoints: ReadonlyMap<string, RouteEndpoint>,
  resolver: SymbolResolver | undefined,
): void {
  if (!resolver) return;
  const undrawable = (key: string) => {
    const endpoint = endpoints.get(key);
    return (
      endpoint?.kind === "terminal" &&
      !isMosBulkTerminal(draft, endpoint) &&
      !isVisibleEndpoint(draft, resolver, endpoint)
    );
  };
  const stranded = groups.filter((group) => group.every(undrawable));
  if (stranded.length === 0) return;
  const drawn = groups
    .filter((group) => !group.every(undrawable))
    .flat()
    .filter((key) => endpoints.has(key));
  if (drawn.length === 0) return;
  const largest = graph
    .groups(drawn)
    .reduce((best, group) => (group.length > best.length ? group : best));
  graph.join([
    largest[0]!,
    ...stranded.flat().filter((key) => endpoints.has(key)),
  ]);
}

/**
 * Materialize Base Nets once geometry is final, before contact/overlap cleanup.
 * Explicit unrouted intent survives, but a formerly routed edge is never
 * recreated from its old membership. A cut deliberately releases the old
 * Net's unrouted intent, just as the historical cut command did.
 */
export function rebuildEditedConnectivity(
  before: SchematicDocument,
  draft: SchematicDocument,
  transaction: EditTransaction,
  resolver: SymbolResolver | undefined,
  changed: Set<string>,
): ReturnType<typeof mergeBaseNets> {
  const graph = new ConnectionGraph();
  let read = prepareConnectivityPhaseRead(draft);
  const sourceRead = prepareConnectivityPhaseRead(before);
  const endpoints = new Map<string, RouteEndpoint>();
  const remember = (e: RouteEndpoint) => {
    const key = endpointKey(e);
    endpoints.set(key, e);
    graph.add(key);
    return key;
  };
  for (const net of draft.nets)
    for (const e of read.netEndpoints(net)) remember(e);
  for (const route of draft.routes)
    for (const edge of routeElectricalConnections(route))
      graph.join(edge.endpoints.map(remember));
  // Coincidence of confirmed endpoint contacts is an edge; an interior X is
  // never an edge. Newly made cross-Net contacts are settled by the ordinary
  // endpoint-contact normalizer immediately after this rebuild.
  for (const contact of resolver
    ? deriveDocumentContactEvidence(draft, resolver).contacts
    : []) {
    graph.join(contact.endpoints.map(remember));
  }
  const cutNetIds = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "cut_connection"
        ? before.routes
            .filter((r) => r.id === edit.routeId)
            .flatMap(routeElectricalConnections)
            .map((edge) => edge.netId)
        : [],
    ),
  );
  const beforeContacts = resolver
    ? isFrozenSnapshot(before)
      ? buildDocumentDerivedContext(before, resolver).contactEvidence
      : deriveDocumentContactEvidence(before, resolver)
    : undefined;
  const sourceGroups = prepareNetEndpointGroupRead(sourceRead, beforeContacts);
  // Legacy/imported Nets can contain intentional, not-yet-routed components.
  // Preserve a bridge between their surviving representatives, not between
  // every member: doing the latter would resurrect a deleted physical wire.
  for (const net of before.nets) {
    const groups = sourceGroups(net.id);
    if (cutNetIds.has(net.id)) {
      keepUndrawableMembersAfterCut(draft, groups, graph, endpoints, resolver);
      continue;
    }
    const representatives = groups.flatMap((group) => {
      const key = group.find((key) => {
        const e = endpoints.get(key);
        return e && read.ownerOf(e) !== null;
      });
      return key ? [key] : [];
    });
    graph.join(representatives);
  }
  const explicitlyDisconnected = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "disconnect_endpoint" ? [endpointKey(edit.endpoint)] : [],
    ),
  );
  for (const edit of transaction.edits) {
    if (edit.kind === "unplace_instance") {
      for (const net of before.nets.filter((n) =>
        n.terminals.some((t) => t.instanceId === edit.instanceId),
      )) {
        graph.join(
          sourceRead
            .netEndpoints(net)
            .map(endpointKey)
            .filter((key) => endpoints.has(key)),
        );
      }
    }
    if (edit.kind === "connect_endpoints") {
      // A later disconnect/removal in this transaction owns the final state.
      // Do not replay an earlier logical request over that completed edit.
      const pair = [edit.from, edit.to];
      if (pair.every((e) => read.ownerOf(e) !== null)) {
        graph.join(pair.map(remember));
      }
    }
    if (edit.kind === "remove_route_geometry") {
      const route = before.routes.find((r) => r.id === edit.routeId);
      if (route)
        for (const edge of routeElectricalConnections(route))
          graph.join(
            edge.endpoints
              .filter(
                (e) =>
                  endpoints.has(endpointKey(e)) &&
                  !explicitlyDisconnected.has(endpointKey(e)),
              )
              .map(remember),
          );
    }
    // An explicit logical merge is still supported by the typed Agent API.
    // The Wire planner does not emit one merely to draw a path.
    if (edit.kind === "merge_nets") {
      graph.join(
        before.nets
          .filter((n) => n.id === edit.sourceNetId || n.id === edit.targetNetId)
          .flatMap((n) => sourceRead.netEndpoints(n))
          .map(endpointKey)
          .filter((key) => endpoints.has(key)),
      );
    }
  }
  // A property-only terminal, such as a model's substrate, has no geometry to
  // hold it on its Net: the Net an edit of this transaction named for it is
  // its connection, as a logical join is. Tie it to the members that Net
  // holds by other means, or a paste that binds it and draws the Net's wires
  // at once would strand it on a Net of its own.
  const boundProperties = new Set(
    transaction.edits.flatMap((edit) =>
      edit.kind === "set_property_terminal_net" && edit.netId !== null
        ? [
            endpointKey({
              kind: "terminal",
              instanceId: edit.instanceId,
              pinName: edit.pinName,
            }),
          ]
        : [],
    ),
  );
  if (boundProperties.size > 0) {
    for (const net of draft.nets) {
      const keys = read
        .netEndpoints(net)
        .map(endpointKey)
        .filter((key) => endpoints.has(key));
      const bound = keys.filter((key) => boundProperties.has(key));
      if (bound.length === 0) continue;
      const anchor = keys.find((key) => !boundProperties.has(key));
      graph.join(anchor ? [anchor, ...bound] : bound);
    }
  }
  for (const net of [...draft.nets]) {
    const keys = read.netEndpoints(net).map(endpointKey);
    const groups = graph.groups(keys);
    // Retain the original identity on the authored cut's start side.
    const cutRoute = transaction.edits.flatMap((edit) =>
      edit.kind === "cut_connection"
        ? before.routes.filter(
            (r) =>
              r.id === edit.routeId &&
              routeElectricalConnections(r).some(
                (edge) => edge.netId === net.id,
              ),
          )
        : [],
    )[0];
    const preferredKeys = cutRoute
      ? routeElectricalConnections(cutRoute)
          .filter((edge) => edge.netId === net.id)
          .flatMap((edge) => edge.endpoints)
          .map(endpointKey)
      : net.terminals.map((t) => endpointKey({ kind: "terminal", ...t }));
    const primary = preferredKeys
      .map((key) => groups.findIndex((group) => group.includes(key)))
      .find((index) => index >= 0);
    if (primary !== undefined && primary > 0)
      groups.unshift(...groups.splice(primary, 1));
    partitionNet(draft, net, groups, changed);
    if (groups.length > 1) read = prepareConnectivityPhaseRead(draft);
  }
  // Existing Net IDs choose stable identities only after the graph is known.
  // Two unconnected paths carrying the same stale hint remain separate.
  const occupiedHints = new Set(draft.nets.map((n) => n.id));
  const routesByRoot = new Map<
    string,
    Array<{
      route: SchematicDocument["routes"][number];
      edge: ReturnType<typeof routeElectricalConnections>[number];
    }>
  >();
  for (const route of draft.routes) {
    for (const edge of routeElectricalConnections(route)) {
      const root = graph.root(endpointKey(edge.endpoints[0]));
      const routes = routesByRoot.get(root) ?? [];
      routes.push({ route, edge });
      routesByRoot.set(root, routes);
    }
  }
  for (const keys of graph.groups([...endpoints.keys()])) {
    const groupEndpoints = keys.map((key) => endpoints.get(key)!);
    const owners = [
      ...new Set(
        groupEndpoints
          .map((e) => read.ownerOf(e))
          .filter((id): id is string => id !== null),
      ),
    ];
    const routes = routesByRoot.get(graph.root(keys[0]!)) ?? [];
    if (owners.length === 0 && routes.length === 0) continue;
    let netId = owners[0];
    for (const other of owners.slice(1)) {
      const [target, source] = preferredPhysicalMergeTarget(
        draft,
        netId!,
        other,
      );
      const result = mergeBaseNets(draft, target, source, changed);
      if (!result.ok) return result;
      read = prepareConnectivityPhaseRead(draft);
      netId = target;
    }
    if (!netId) {
      const hint = routes[0]!.edge.netId;
      netId = occupiedHints.has(hint)
        ? uniquePhysicalContactId(draft, "net", keys[0]!)
        : hint;
      occupiedHints.add(netId);
      draft.nets.push({ id: netId, terminals: [] });
      changed.add(netId);
    }
    for (const e of groupEndpoints) {
      if (read.ownerOf(e) !== netId) {
        addEndpointToNet(draft, netId, e);
        read = prepareConnectivityPhaseRead(draft);
        changed.add(netId);
      }
      removeNoConnectForEndpoint(draft, e, changed);
    }
    for (const { route, edge } of routes) {
      const member = route.members?.find((item) => item.id === edge.memberId);
      if (member) member.netId = netId;
      if (route.netId !== netId && (!member || member === route.members?.[0])) {
        route.netId = netId;
        changed.add(route.id);
      }
    }
  }
  // Route-owned names and formal interfaces follow their final conductor. A
  // Net with no pin, wire or Junction before or after has none to follow: a
  // hidden process label on a part names its own empty Net, and moving it to
  // the part's first Net gave a pin two names (#2254).
  for (const net of draft.nets)
    if (!(memberless(before, net.id) && memberless(draft, net.id)))
      retargetOwnerEvidenceAfterSplit(draft, net.id, changed);
  return { ok: true };
}
