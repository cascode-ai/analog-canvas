import type { Net, RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  junctionElectricalEndpoints,
  routeElectricalConnections,
} from "@icm/model";
import { endpointKey } from "@icm/derived";

import type { ConductorRows } from "./wire-subgraph.js";

/** Private synchronous read phase. Rebuild after any membership mutation. */
export function prepareConnectivityPhaseRead(document: ConductorRows) {
  const netsById = new Map<string, Net>();
  const terminalOwners = new Map<string, Map<string, string>>();
  for (const net of document.nets) {
    if (!netsById.has(net.id)) netsById.set(net.id, net);
    for (const terminal of net.terminals) {
      let pins = terminalOwners.get(terminal.instanceId);
      if (!pins) terminalOwners.set(terminal.instanceId, (pins = new Map()));
      const key = `${terminal.pinName}\u0000${terminal.memberId ?? ""}`;
      if (!pins.has(key)) pins.set(key, net.id);
    }
  }
  const junctionOwners = new Map<string, string>();
  const junctionsByNet = new Map<string, RouteEndpoint[]>();
  for (const junction of document.junctions) {
    for (const member of junctionElectricalEndpoints(junction)) {
      // A newly authored aggregate may carry only identity hints for lanes
      // that the completed connection graph has not materialized yet.
      if (!junction.members || netsById.has(member.netId))
        junctionOwners.set(endpointKey(member.endpoint), member.netId);
      const endpoints = junctionsByNet.get(member.netId) ?? [];
      endpoints.push(member.endpoint);
      junctionsByNet.set(member.netId, endpoints);
    }
  }
  const readRoutes = () => {
    const routesByNet = new Map<string, SchematicDocument["routes"]>();
    for (const route of document.routes) {
      for (const edge of routeElectricalConnections(route)) {
        const routes = routesByNet.get(edge.netId) ?? [];
        routes.push(route);
        routesByNet.set(edge.netId, routes);
      }
    }
    return routesByNet;
  };
  let routesByNet: ReturnType<typeof readRoutes> | undefined;
  const endpointsByNet = new Map<Net, RouteEndpoint[]>();
  // Ownership lookup needs every Net; only the affected conductors need
  // their ordered terminal/Junction lists during this synchronous phase.
  const netEndpoints = (net: Net): readonly RouteEndpoint[] => {
    const cached = endpointsByNet.get(net);
    if (cached) return cached;
    const endpoints = [
      ...net.terminals.map((terminal) => ({
        kind: "terminal" as const,
        ...terminal,
      })),
      ...(junctionsByNet.get(net.id) ?? []),
    ].sort((left, right) =>
      endpointKey(left).localeCompare(endpointKey(right), "en"),
    );
    endpointsByNet.set(net, endpoints);
    return endpoints;
  };
  return {
    netsById,
    get routesByNet() {
      return (routesByNet ??= readRoutes());
    },
    netEndpoints,
    ownerOf: (endpoint: RouteEndpoint): string | null =>
      endpoint.kind === "terminal"
        ? (terminalOwners
            .get(endpoint.instanceId)
            ?.get(`${endpoint.pinName}\u0000${endpoint.memberId ?? ""}`) ??
          null)
        : (junctionOwners.get(endpointKey(endpoint)) ?? null),
  };
}
