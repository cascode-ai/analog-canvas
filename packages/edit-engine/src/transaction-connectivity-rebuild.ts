import {
  routeEndpoints,
  type Net,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  ConnectionGraph,
  deriveDocumentContactEvidence,
  endpointKey,
  netEndpoints,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import type { EditTransaction } from "./edit-schema.js";
import {
  addEndpointToNet,
  endpointOwnerNetId,
  netEndpointGroups,
} from "./transaction-routing.js";
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
      changed.add(terminal.id);
    }
  }
  retargetOwnerEvidenceAfterSplit(draft, net.id, changed);
  propagateSpiceSourceEvidenceAfterSplit(draft, net.id, ids, changed);
  retargetMosBulkDefaultsAfterSplit(draft, net.id, ids, identity, changed);
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
  const endpoints = new Map<string, RouteEndpoint>();
  const remember = (e: RouteEndpoint) => {
    const key = endpointKey(e);
    endpoints.set(key, e);
    graph.add(key);
    return key;
  };
  for (const net of draft.nets)
    for (const e of netEndpoints(draft, net)) remember(e);
  for (const route of draft.routes)
    graph.join(routeEndpoints(route).map(remember));
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
        ? before.routes.filter((r) => r.id === edit.routeId).map((r) => r.netId)
        : [],
    ),
  );
  const beforeContacts = resolver
    ? deriveDocumentContactEvidence(before, resolver)
    : undefined;
  // Legacy/imported Nets can contain intentional, not-yet-routed components.
  // Preserve a bridge between their surviving representatives, not between
  // every member: doing the latter would resurrect a deleted physical wire.
  for (const net of before.nets) {
    if (cutNetIds.has(net.id)) continue;
    const groups = netEndpointGroups(before, net.id, resolver, beforeContacts);
    const representatives = groups.flatMap((group) => {
      const key = group.find((key) => {
        const e = endpoints.get(key);
        return e && endpointOwnerNetId(draft, e) !== null;
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
          netEndpoints(before, net)
            .map(endpointKey)
            .filter((key) => endpoints.has(key)),
        );
      }
    }
    if (edit.kind === "connect_endpoints") {
      // A later disconnect/removal in this transaction owns the final state.
      // Do not replay an earlier logical request over that completed edit.
      const pair = [edit.from, edit.to];
      if (pair.every((e) => endpointOwnerNetId(draft, e) !== null)) {
        graph.join(pair.map(remember));
      }
    }
    if (edit.kind === "remove_route_geometry") {
      const route = before.routes.find((r) => r.id === edit.routeId);
      if (route)
        graph.join(
          routeEndpoints(route)
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
          .flatMap((n) => netEndpoints(before, n))
          .map(endpointKey)
          .filter((key) => endpoints.has(key)),
      );
    }
  }
  for (const net of [...draft.nets]) {
    const keys = netEndpoints(draft, net).map(endpointKey);
    const groups = graph.groups(keys);
    // Retain the original identity on the authored cut's start side.
    const cutRoute = transaction.edits.flatMap((edit) =>
      edit.kind === "cut_connection"
        ? before.routes.filter(
            (r) => r.id === edit.routeId && r.netId === net.id,
          )
        : [],
    )[0];
    const preferredKeys = cutRoute
      ? routeEndpoints(cutRoute).map(endpointKey)
      : net.terminals.map((t) => endpointKey({ kind: "terminal", ...t }));
    const primary = preferredKeys
      .map((key) => groups.findIndex((group) => group.includes(key)))
      .find((index) => index >= 0);
    if (primary !== undefined && primary > 0)
      groups.unshift(...groups.splice(primary, 1));
    partitionNet(draft, net, groups, changed);
  }
  // Existing Net IDs choose stable identities only after the graph is known.
  // Two unconnected paths carrying the same stale hint remain separate.
  const occupiedHints = new Set(draft.nets.map((n) => n.id));
  for (const keys of graph.groups([...endpoints.keys()])) {
    const groupEndpoints = keys.map((key) => endpoints.get(key)!);
    const owners = [
      ...new Set(
        groupEndpoints
          .map((e) => endpointOwnerNetId(draft, e))
          .filter((id): id is string => id !== null),
      ),
    ];
    const routes = draft.routes.filter(
      (r) => graph.root(endpointKey(r.start)) === graph.root(keys[0]!),
    );
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
      netId = target;
    }
    if (!netId) {
      const hint = routes[0]!.netId;
      netId = occupiedHints.has(hint)
        ? uniquePhysicalContactId(draft, "net", keys[0]!)
        : hint;
      occupiedHints.add(netId);
      draft.nets.push({ id: netId, terminals: [] });
      changed.add(netId);
    }
    for (const e of groupEndpoints) {
      if (endpointOwnerNetId(draft, e) !== netId) {
        addEndpointToNet(draft, netId, e);
        changed.add(netId);
      }
      removeNoConnectForEndpoint(draft, e, changed);
    }
    for (const route of routes) {
      if (route.netId !== netId) {
        route.netId = netId;
        changed.add(route.id);
      }
    }
  }
  // Route-owned names and formal interfaces follow their final conductor.
  for (const net of draft.nets)
    retargetOwnerEvidenceAfterSplit(draft, net.id, changed);
  return { ok: true };
}
