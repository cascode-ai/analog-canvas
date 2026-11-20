import {
  routeEndpoints,
  routeElectricalConnections,
  junctionElectricalEndpoints,
  type Net,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  ConnectionGraph,
  buildEndpointObjectLookup,
  endpointKey,
  groupCoincidentEndpoints,
  isMosBulkTerminal,
  isVisibleEndpoint,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import type { RouteEdits } from "./transaction-route-edits.js";
import {
  addEndpointToNet,
  netEndpointGroupsFromEdges,
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

export interface CutPropertyGroup {
  stranded: Extract<RouteEndpoint, { kind: "terminal" }>[];
  drawn: RouteEndpoint[];
}

function isUndrawablePropertyPin(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint | undefined,
): boolean {
  return (
    endpoint?.kind === "terminal" &&
    !isMosBulkTerminal(draft, endpoint) &&
    !isVisibleEndpoint(draft, resolver, endpoint)
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
  edits: RouteEdits,
): CutPropertyGroup | undefined {
  if (!resolver) return;
  const undrawable = (key: string) =>
    isUndrawablePropertyPin(draft, resolver, endpoints.get(key));
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
  const propertyKeys = stranded
    .flat()
    .filter(
      (key) => !edits.boundProperties.has(key) && !edits.disconnected.has(key),
    );
  const propertyTerminals = propertyKeys.flatMap((key) => {
    const endpoint = endpoints.get(key);
    return endpoint?.kind === "terminal" ? [endpoint] : [];
  });
  if (propertyTerminals.length === 0) return;
  graph.join([largest[0]!, ...propertyTerminals.map(endpointKey)]);
  return {
    stranded: propertyTerminals,
    drawn: drawn.map((key) => endpoints.get(key)!),
  };
}

/** A licensed contact can change which side of a cut is largest. */
export function reconcileCutPropertyTerminals(
  draft: SchematicDocument,
  groups: readonly CutPropertyGroup[],
  resolver: SymbolResolver,
  changed: Set<string>,
): void {
  if (groups.length === 0) return;
  const read = prepareConnectivityPhaseRead(draft);
  const departed = new Map<string, Map<string, string>>();
  const counts = new Map<string, number>();
  const sizeOf = (netId: string) => {
    const cached = counts.get(netId);
    if (cached !== undefined) return cached;
    const net = read.netsById.get(netId);
    const count = net
      ? read
          .netEndpoints(net)
          .filter((e) => !isUndrawablePropertyPin(draft, resolver, e)).length
      : 0;
    counts.set(netId, count);
    return count;
  };
  for (const { stranded, drawn } of groups) {
    let largest: { id: string; size: number } | undefined;
    for (const endpoint of drawn) {
      const owner = read.ownerOf(endpoint);
      if (!owner) continue;
      const size = sizeOf(owner);
      if (!largest || size > largest.size) largest = { id: owner, size };
    }
    if (!largest) continue;
    for (const endpoint of stranded) {
      const owner = read.ownerOf(endpoint);
      if (!owner || largest.size <= sizeOf(owner)) continue;
      const net = read.netsById.get(owner);
      if (!net) continue;
      net.terminals = net.terminals.filter(
        (terminal) =>
          terminal.instanceId !== endpoint.instanceId ||
          terminal.pinName !== endpoint.pinName ||
          terminal.memberId !== endpoint.memberId,
      );
      addEndpointToNet(draft, largest.id, endpoint);
      const moved = departed.get(owner) ?? new Map<string, string>();
      moved.set(endpoint.instanceId, largest.id);
      departed.set(owner, moved);
      changed.add(owner);
      changed.add(largest.id);
      changed.add(endpoint.instanceId);
    }
  }
  for (const [owner, movedPropertyOwners] of departed)
    retargetOwnerEvidenceAfterSplit(draft, owner, changed, {
      movedPropertyOwners,
    });
}

type ConnectivityRead = ReturnType<typeof prepareConnectivityPhaseRead>;
type Route = SchematicDocument["routes"][number];

/** Follow actual endpoint incidence in both revisions. Route Net hints never
 * enlarge the closure. A newly authored path can re-use an occupied hint. */
function affectedConductors(
  before: SchematicDocument,
  draft: SchematicDocument,
  source: ConnectivityRead,
  read: ConnectivityRead,
  edits: RouteEdits,
  changed: ReadonlySet<string>,
) {
  const edges = draft.routes.flatMap((route) =>
    routeElectricalConnections(route).map((edge) => ({ route, edge })),
  );
  const incident = new Map<string, typeof edges>();
  for (const entry of edges) {
    for (const endpoint of entry.edge.endpoints) {
      const key = endpointKey(endpoint);
      const connected = incident.get(key) ?? [];
      connected.push(entry);
      incident.set(key, connected);
    }
  }
  const endpoints = new Set<string>();
  const netIds = new Set<string>();
  const activeEdges = new Set<(typeof edges)[number]>();
  const pending: RouteEndpoint[] = [];
  const addNet = (id: string) => {
    if (netIds.has(id)) return;
    netIds.add(id);
    const original = source.netsById.get(id);
    const current = read.netsById.get(id);
    if (original)
      for (const endpoint of source.netEndpoints(original))
        pending.push(endpoint);
    if (current)
      for (const endpoint of read.netEndpoints(current)) pending.push(endpoint);
  };
  for (const snapshot of [before, draft]) {
    for (const net of snapshot.nets) {
      if (
        changed.has(net.id) ||
        net.terminals.some(
          ({ instanceId }) =>
            changed.has(instanceId) || edits.unplaced.has(instanceId),
        )
      )
        addNet(net.id);
    }
    for (const junction of snapshot.junctions)
      if (changed.has(junction.id))
        for (const { endpoint, netId } of junctionElectricalEndpoints(
          junction,
        )) {
          pending.push(endpoint);
          addNet(netId);
        }
    for (const route of snapshot.routes)
      if (changed.has(route.id))
        for (const { endpoints } of routeElectricalConnections(route))
          pending.push(...endpoints);
  }
  for (const id of edits.cutEndsByNet.keys()) addNet(id);
  for (const merge of edits.merges) for (const id of merge) addNet(id);
  for (const endpoint of edits.disconnected.values()) pending.push(endpoint);
  for (const pair of edits.connections) pending.push(...pair);
  for (const { endpoints } of edits.keptUnrouted) pending.push(...endpoints);
  while (pending.length) {
    const endpoint = pending.pop()!;
    const key = endpointKey(endpoint);
    if (endpoints.has(key)) continue;
    endpoints.add(key);
    const old = source.ownerOf(endpoint);
    const current = read.ownerOf(endpoint);
    if (old !== null) addNet(old);
    if (current !== null) addNet(current);
    for (const entry of incident.get(key) ?? []) {
      if (activeEdges.has(entry)) continue;
      activeEdges.add(entry);
      pending.push(...entry.edge.endpoints);
    }
  }
  return {
    netIds,
    endpoints,
    edges: edges.filter((entry) => activeEdges.has(entry)),
  };
}

/**
 * Materialize Base Nets once geometry is final, before contact/overlap cleanup.
 * Explicit unrouted intent survives, but a formerly routed edge is never
 * recreated from its old membership. A cut releases the old Net's unrouted
 * intent except for its property-only endpoints.
 */
export function rebuildEditedConnectivity(
  before: SchematicDocument,
  draft: SchematicDocument,
  edits: RouteEdits,
  resolver: SymbolResolver | undefined,
  changed: Set<string>,
):
  | Extract<ReturnType<typeof mergeBaseNets>, { ok: false }>
  | { ok: true; cutPropertyGroups: CutPropertyGroup[] } {
  const graph = new ConnectionGraph();
  const cutPropertyGroups: CutPropertyGroup[] = [];
  let read = prepareConnectivityPhaseRead(draft);
  const sourceRead = prepareConnectivityPhaseRead(before);
  const affected = affectedConductors(
    before,
    draft,
    sourceRead,
    read,
    edits,
    changed,
  );
  const beforeNets = before.nets.filter(({ id }) => affected.netIds.has(id));
  const draftNets = draft.nets.filter(({ id }) => affected.netIds.has(id));
  const beforeLookup = resolver && buildEndpointObjectLookup(before);
  const draftLookup = resolver && buildEndpointObjectLookup(draft);
  const endpoints = new Map<string, RouteEndpoint>();
  const remember = (e: RouteEndpoint) => {
    const key = endpointKey(e);
    endpoints.set(key, e);
    graph.add(key);
    return key;
  };
  for (const net of draftNets)
    for (const endpoint of read.netEndpoints(net)) remember(endpoint);
  for (const { edge } of affected.edges)
    graph.join(edge.endpoints.map(remember));
  // The graph reads confirmed same-Net contacts. Newly allowed cross-Net
  // contact still goes through the edit's contact license after this phase.
  if (resolver)
    for (const net of draftNets)
      for (const contact of groupCoincidentEndpoints(
        draft,
        resolver,
        read.netEndpoints(net),
        draftLookup,
      ))
        graph.join(contact.endpoints.map(remember));
  // Preserve intent between surviving representatives of old components.
  for (const net of beforeNets) {
    const members = sourceRead.netEndpoints(net);
    const contacts = resolver
      ? groupCoincidentEndpoints(before, resolver, members, beforeLookup)
      : [];
    const groups = netEndpointGroupsFromEdges(
      members.map(endpointKey),
      sourceRead.routesByNet.get(net.id) ?? [],
      contacts,
    );
    if (edits.cutEndsByNet.has(net.id)) {
      const group = keepUndrawableMembersAfterCut(
        draft,
        groups,
        graph,
        endpoints,
        resolver,
        edits,
      );
      if (group) cutPropertyGroups.push(group);
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
  const survivingKeys = (netId: string) => {
    const net = sourceRead.netsById.get(netId);
    return net
      ? sourceRead
          .netEndpoints(net)
          .map(endpointKey)
          .filter((key) => endpoints.has(key))
      : [];
  };
  for (const net of beforeNets)
    if (net.terminals.some(({ instanceId }) => edits.unplaced.has(instanceId)))
      graph.join(survivingKeys(net.id));

  for (const pair of edits.connections) {
    // A later disconnect/removal owns the final state.
    if (pair.every((endpoint) => read.ownerOf(endpoint) !== null))
      graph.join(pair.map(remember));
  }
  const retained = edits.keptUnrouted.filter(({ endpoints }) =>
    endpoints.every(
      (endpoint) =>
        !edits.disconnected.has(endpointKey(endpoint)) &&
        (endpoint.kind === "terminal"
          ? draft.instances.some(({ id }) => id === endpoint.instanceId)
          : draft.junctions.some(({ id }) => id === endpoint.junctionId)),
    ),
  );
  for (const { endpoints } of retained) graph.join(endpoints.map(remember));
  for (const netIds of edits.merges) graph.join(netIds.flatMap(survivingKeys));

  // A hidden property terminal's chosen Net is a connection, like a logical
  // join. Preserve it when a paste binds it and draws the same Net at once.
  if (edits.boundProperties.size > 0) {
    for (const net of draftNets) {
      const keys = read.netEndpoints(net).map(endpointKey);
      const bound = keys.filter((key) => edits.boundProperties.has(key));
      if (!bound.length) continue;
      const anchor = keys.find((key) => !edits.boundProperties.has(key));
      graph.join(anchor ? [anchor, ...bound] : bound);
    }
  }
  for (const net of draftNets) {
    const keys = read.netEndpoints(net).map(endpointKey);
    const groups = graph.groups(keys);
    const preferredKeys =
      edits.cutEndsByNet.get(net.id) ??
      net.terminals.map((t) => endpointKey({ kind: "terminal", ...t }));
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
  const reassignedRouteHints = new Set<string>();
  const unroutedHints = new Map(
    retained.map(({ endpoints, netId }) => [
      graph.root(endpointKey(endpoints[0])),
      netId,
    ]),
  );
  const routesByRoot = new Map<
    string,
    Array<{
      route: Route;
      edge: ReturnType<typeof routeElectricalConnections>[number];
    }>
  >();
  for (const route of new Set(affected.edges.map((entry) => entry.route))) {
    for (const edge of routeElectricalConnections(route)) {
      if (
        !edge.endpoints.every((endpoint) =>
          affected.endpoints.has(endpointKey(endpoint)),
        )
      )
        continue;
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
    const root = graph.root(keys[0]!);
    const routes = routesByRoot.get(root) ?? [];
    const hint = routes[0]?.edge.netId ?? unroutedHints.get(root);
    if (owners.length === 0 && hint === undefined) continue;
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
    if (!netId && hint !== undefined) {
      netId = occupiedHints.has(hint)
        ? uniquePhysicalContactId(draft, "net", keys[0]!)
        : hint;
      occupiedHints.add(netId);
      draft.nets.push({ id: netId, terminals: [] });
      changed.add(netId);
    }
    if (netId === undefined) continue;
    for (const e of groupEndpoints) {
      if (read.ownerOf(e) !== netId) {
        addEndpointToNet(draft, netId, e);
        read = prepareConnectivityPhaseRead(draft);
        changed.add(netId);
      }
      removeNoConnectForEndpoint(draft, e, changed);
    }
    for (const { route, edge } of routes) {
      // The old hint can still hold this Route's name claim. Repair those
      // owners even when the hint selected an unrelated Net.
      if (edge.netId !== netId) reassignedRouteHints.add(edge.netId);
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
  for (const { id } of draft.nets) {
    const reassigned = reassignedRouteHints.has(id);
    if (!reassigned && !affected.netIds.has(id) && !changed.has(id)) continue;
    const empty = memberless(before, id) && memberless(draft, id);
    if (reassigned || !empty)
      retargetOwnerEvidenceAfterSplit(draft, id, changed, {
        routeAnchorsOnly: empty,
      });
  }
  return { ok: true, cutPropertyGroups };
}
