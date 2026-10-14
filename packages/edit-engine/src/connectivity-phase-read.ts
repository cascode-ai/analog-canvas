import type { Net, RouteEndpoint, SchematicDocument } from "@icm/model";
import { endpointKey } from "@icm/derived";

/** Private synchronous read phase. Rebuild after any membership mutation. */
export function prepareConnectivityPhaseRead(document: SchematicDocument) {
  const netsById = new Map<string, Net>();
  const terminalOwners = new Map<string, Map<string, string>>();
  for (const net of document.nets) {
    if (!netsById.has(net.id)) netsById.set(net.id, net);
    for (const terminal of net.terminals) {
      let pins = terminalOwners.get(terminal.instanceId);
      if (!pins) terminalOwners.set(terminal.instanceId, (pins = new Map()));
      if (!pins.has(terminal.pinName)) pins.set(terminal.pinName, net.id);
    }
  }
  const junctionOwners = new Map<string, string>();
  const junctionsByNet = new Map<string, RouteEndpoint[]>();
  for (const junction of document.junctions) {
    if (!junctionOwners.has(junction.id))
      junctionOwners.set(junction.id, junction.netId);
    const endpoints = junctionsByNet.get(junction.netId) ?? [];
    endpoints.push({ kind: "junction", junctionId: junction.id });
    junctionsByNet.set(junction.netId, endpoints);
  }
  const routesByNet = new Map<string, SchematicDocument["routes"]>();
  for (const route of document.routes) {
    const routes = routesByNet.get(route.netId) ?? [];
    routes.push(route);
    routesByNet.set(route.netId, routes);
  }
  const endpointsByNet = new Map<Net, RouteEndpoint[]>();
  for (const net of document.nets) {
    endpointsByNet.set(
      net,
      [
        ...net.terminals.map((terminal) => ({
          kind: "terminal" as const,
          ...terminal,
        })),
        ...(junctionsByNet.get(net.id) ?? []),
      ].sort((left, right) =>
        endpointKey(left).localeCompare(endpointKey(right), "en"),
      ),
    );
  }
  return {
    netsById,
    routesByNet,
    netEndpoints: (net: Net): readonly RouteEndpoint[] =>
      endpointsByNet.get(net) ?? [],
    ownerOf: (endpoint: RouteEndpoint): string | null =>
      endpoint.kind === "terminal"
        ? (terminalOwners.get(endpoint.instanceId)?.get(endpoint.pinName) ??
          null)
        : (junctionOwners.get(endpoint.junctionId) ?? null),
  };
}
