import {
  routeElectricalConnections,
  junctionElectricalEndpoints,
  type CircuitProject,
  type Net,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  ConnectionGraph,
  deriveDocumentContactEvidence,
  endpointKey,
  indexJunctionsByNet,
  netEndpoints,
  resolveEndpointPoint,
} from "@icm/derived";
import { createProjectSymbolResolver, type SymbolResolver } from "@icm/symbols";

type Endpoint = ({ terminal: [string, string] } | { junction: string }) & {
  memberId?: string;
};
type Identity = { id: string; at: Endpoint | null };
export interface SourceConnectivity {
  nets: Identity[];
  connections: { contacts: Endpoint[][]; unrouted: Endpoint[][] };
}
const encode = (e: RouteEndpoint): Endpoint =>
  e.kind === "terminal"
    ? {
        terminal: [e.instanceId, e.pinName],
        ...(e.memberId ? { memberId: e.memberId } : {}),
      }
    : {
        junction: e.junctionId,
        ...(e.memberId ? { memberId: e.memberId } : {}),
      };
function decode(e: Endpoint): RouteEndpoint {
  if (
    !e ||
    typeof e !== "object" ||
    Object.keys(e).some(
      (key) => !["terminal", "junction", "memberId"].includes(key),
    ) ||
    "terminal" in e === "junction" in e ||
    (e.memberId !== undefined &&
      (typeof e.memberId !== "string" || !e.memberId))
  )
    throw new Error("A connection endpoint specifies one terminal or junction");
  if (
    "terminal" in e &&
    Array.isArray(e.terminal) &&
    e.terminal.length === 2 &&
    e.terminal.every((v) => typeof v === "string")
  )
    return {
      kind: "terminal",
      instanceId: e.terminal[0],
      pinName: e.terminal[1],
      ...(e.memberId ? { memberId: e.memberId } : {}),
    };
  if ("junction" in e && typeof e.junction === "string")
    return {
      kind: "junction",
      junctionId: e.junction,
      ...(e.memberId ? { memberId: e.memberId } : {}),
    };
  throw new Error("Invalid connection endpoint");
}

/** Capture only edges absent from the drawn paths; never repeat wire membership. */
export function captureSourceConnectivity(
  project: CircuitProject,
): SourceConnectivity[] {
  const resolver = createProjectSymbolResolver(project, []);
  return project.documents.map((document) => {
    const graph = new ConnectionGraph();
    const nodes = new Map<string, RouteEndpoint>();
    const junctionsByNet = indexJunctionsByNet(document.junctions);
    const memberships = document.nets.map((net) => ({
      net,
      endpoints: netEndpoints(document, net, junctionsByNet.get(net.id) ?? []),
    }));
    for (const { endpoints } of memberships)
      for (const e of endpoints) {
        nodes.set(endpointKey(e), e);
        graph.add(endpointKey(e));
      }
    for (const route of document.routes)
      for (const edge of routeElectricalConnections(route))
        graph.join(edge.endpoints.map(endpointKey));
    const contacts: Endpoint[][] = [];
    for (const contact of deriveDocumentContactEvidence(document, resolver)
      .contacts) {
      const keys = contact.endpoints.map(endpointKey);
      if (graph.groups(keys).length < 2) continue;
      contacts.push(contact.endpoints.map(encode));
      graph.join(keys);
    }
    const unrouted: Endpoint[][] = [];
    const nets = memberships.map(({ net, endpoints }) => {
      const groups = graph.groups(endpoints.map(endpointKey));
      if (groups.length > 1) {
        const link = groups.map((g) => nodes.get(g[0]!)!);
        unrouted.push(link.map(encode));
        graph.join(link.map(endpointKey));
      }
      const primary = [...net.terminals].sort((a, b) =>
        endpointKey({ kind: "terminal", ...a }).localeCompare(
          endpointKey({ kind: "terminal", ...b }),
          "en",
        ),
      )[0];
      return {
        id: net.id,
        at: primary
          ? encode({ kind: "terminal", ...primary })
          : endpoints[0]
            ? encode(endpoints[0])
            : null,
      };
    });
    return { nets, connections: { contacts, unrouted } };
  });
}

/** Materialize compatibility indexes using the same graph kernel as wire commits. */
export function materializeSourceConnectivity(
  document: SchematicDocument,
  source: SourceConnectivity,
  resolver: SymbolResolver,
): void {
  if (
    !source.connections ||
    Object.keys(source.connections).some(
      (k) => !["contacts", "unrouted"].includes(k),
    )
  )
    throw new Error("connections contains contacts and unrouted links only");
  const graph = new ConnectionGraph();
  const endpoints = new Map<string, RouteEndpoint>();
  const instances = new Set(document.instances.map((i) => i.id));
  const junctions = new Set(document.junctions.map((j) => j.id));
  const add = (e: RouteEndpoint) => {
    if (
      e.kind === "terminal"
        ? !instances.has(e.instanceId)
        : !junctions.has(e.junctionId)
    )
      throw new Error(`Unknown connection endpoint: ${endpointKey(e)}`);
    const key = endpointKey(e);
    graph.add(key);
    endpoints.set(key, e);
    return key;
  };
  const identityKeys = new Map<string, string>();
  for (const identity of source.nets) {
    if (
      !identity ||
      typeof identity.id !== "string" ||
      Object.keys(identity).some((k) => !["id", "at"].includes(k)) ||
      identityKeys.has(identity.id)
    )
      throw new Error(
        "Each Net identity needs a unique id and one at anchor; membership is derived",
      );
    const key =
      identity.at === null
        ? `empty-net:${identity.id}`
        : add(decode(identity.at));
    graph.add(key);
    identityKeys.set(identity.id, key);
  }
  // Interface and implicit-body owners keep their endpoint identity even when
  // a source edit removes the last physical path. These add nodes, never edges.
  for (const terminal of document.netlist?.terminals ?? [])
    for (const instanceId of terminal.interfaceInstanceIds)
      if (terminal.signal && terminal.signal.members.length > 1) {
        for (const member of terminal.signal.members)
          add({
            kind: "terminal",
            instanceId,
            pinName: "P",
            memberId: member.id,
          });
      } else add({ kind: "terminal", instanceId, pinName: "P" });
  for (const instance of document.instances)
    if (instance.mosBulkBinding)
      add({ kind: "terminal", instanceId: instance.id, pinName: "B" });
  for (const junction of document.junctions)
    for (const member of junctionElectricalEndpoints(junction))
      add(member.endpoint);
  for (const route of document.routes)
    for (const edge of routeElectricalConnections(route))
      graph.join(edge.endpoints.map(add));
  for (const kind of ["contacts", "unrouted"] as const) {
    if (!Array.isArray(source.connections[kind]))
      throw new Error(`connections.${kind} must be an array`);
    for (const link of source.connections[kind]) {
      if (!Array.isArray(link) || link.length < 2)
        throw new Error("A connection link needs at least two endpoints");
      const decoded = link.map(decode);
      if (kind === "unrouted") graph.join(decoded.map(add));
      else {
        // Direct contact is conditional on geometry; moving either endpoint
        // away must release it, unlike an explicit unrouted logical link.
        const atPoint = new Map<string, string[]>();
        for (const endpoint of decoded) {
          const key = add(endpoint);
          const point = resolveEndpointPoint(document, resolver, endpoint);
          if (!point) continue;
          const location = `${point.x},${point.y}`;
          const keys = atPoint.get(location) ?? [];
          keys.push(key);
          atPoint.set(location, keys);
        }
        for (const keys of atPoint.values()) graph.join(keys);
      }
    }
  }
  const netForRoot = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const [id, key] of identityKeys) {
    const root = graph.root(key);
    const target = netForRoot.get(root) ?? id;
    netForRoot.set(root, target);
    aliases.set(id, target);
  }
  const occupied = new Set([
    ...identityKeys.keys(),
    ...document.instances.map((i) => i.id),
    ...document.junctions.map((j) => j.id),
    ...document.routes.map((r) => r.id),
    ...document.annotations.map((a) => a.id),
  ]);
  const assign = (key: string, seed: string) => {
    const root = graph.root(key);
    if (!netForRoot.has(root)) {
      const base = `net-${seed}`;
      let id = base,
        index = 1;
      while (occupied.has(id)) id = `${base}-${index++}`;
      occupied.add(id);
      netForRoot.set(root, id);
    }
    return netForRoot.get(root)!;
  };
  for (const route of document.routes) {
    const edges = routeElectricalConnections(route);
    for (const edge of edges) {
      const netId = assign(
        endpointKey(edge.endpoints[0]),
        edge.memberId ?? route.id,
      );
      const member = route.members?.find((item) => item.id === edge.memberId);
      if (member) member.netId = netId;
    }
    route.netId = assign(endpointKey(edges[0]!.endpoints[0]), route.id);
  }
  const netByEndpoint = new Map<string, string>();
  const terminalsByNet = new Map<
    string,
    [string, Net["terminals"][number]][]
  >();
  for (const [key, endpoint] of endpoints) {
    const id = assign(key, key.replaceAll(":", "-"));
    netByEndpoint.set(key, id);
    if (endpoint.kind === "terminal") {
      const { kind: _, ...terminal } = endpoint;
      const members = terminalsByNet.get(id) ?? [];
      members.push([key, terminal]);
      terminalsByNet.set(id, members);
    }
  }
  document.nets = [...netForRoot.values()].map((id) => ({
    id,
    terminals: (terminalsByNet.get(id) ?? [])
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([, terminal]) => terminal),
  }));
  for (const junction of document.junctions) {
    if (junction.members) {
      for (const member of junction.members)
        member.netId = netByEndpoint.get(
          endpointKey({
            kind: "junction",
            junctionId: junction.id,
            memberId: member.id,
          }),
        )!;
      junction.netId = junction.members[0]!.netId;
    } else
      junction.netId = netByEndpoint.get(
        endpointKey({ kind: "junction", junctionId: junction.id }),
      )!;
  }
  const alias = (id: string) => aliases.get(id) ?? id;
  // Names and interfaces attach to stable network anchors, independently of
  // visual label placement. A historical label may deliberately be positioned
  // beside a different conductor; loading must never silently rewire it.
  for (const annotation of document.annotations) {
    if (annotation.netId) annotation.netId = alias(annotation.netId);
    if (annotation.binding?.kind === "net-name")
      annotation.binding.netId = alias(annotation.binding.netId);
  }
  for (const terminal of document.netlist?.terminals ?? []) {
    const owner = terminal.interfaceInstanceIds[0];
    if (terminal.signal) {
      for (const member of terminal.signal.members)
        member.netId =
          (owner
            ? netByEndpoint.get(
                endpointKey({
                  kind: "terminal",
                  instanceId: owner,
                  pinName: "P",
                  ...(terminal.signal.members.length > 1
                    ? { memberId: member.id }
                    : {}),
                }),
              )
            : undefined) ?? alias(member.netId);
      terminal.netId = terminal.signal.members[0]!.netId;
      continue;
    }
    terminal.netId =
      (owner
        ? netByEndpoint.get(
            endpointKey({ kind: "terminal", instanceId: owner, pinName: "P" }),
          )
        : undefined) ?? alias(terminal.netId);
  }
  for (const evidence of document.connectivityEvidence) {
    evidence.netId = alias(evidence.netId);
    if (evidence.kind === "name-claim" && evidence.signal) {
      for (const member of evidence.signal.members)
        member.netId = alias(member.netId);
      evidence.netId = evidence.signal.members[0]!.netId;
    }
  }
  for (const instance of document.instances)
    if (instance.mosBulkBinding)
      instance.mosBulkBinding.netId =
        netByEndpoint.get(
          endpointKey({
            kind: "terminal",
            instanceId: instance.id,
            pinName: "B",
          }),
        ) ?? alias(instance.mosBulkBinding.netId);
  for (const key of ["nmosNetId", "pmosNetId"] as const)
    if (document.mosBulkDefaults?.[key])
      document.mosBulkDefaults[key] = alias(document.mosBulkDefaults[key]);
  for (const owner of [...document.layoutGroups, ...document.constraints])
    owner.objectIds = [...new Set(owner.objectIds.map(alias))];
}

/** Runtime terminal-array order is an index, not an authored circuit property. */
export function canonicalConnectionIndexes(
  project: CircuitProject,
): CircuitProject {
  const result = structuredClone(project);
  for (const d of result.documents)
    for (const n of d.nets)
      n.terminals.sort((a, b) =>
        endpointKey({ kind: "terminal", ...a }).localeCompare(
          endpointKey({ kind: "terminal", ...b }),
          "en",
        ),
      );
  return result;
}
