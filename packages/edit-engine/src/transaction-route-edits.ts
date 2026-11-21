import {
  routeElectricalConnections,
  routeEndpoints,
  type RouteEndpoint,
  type RouteBranch,
  type SchematicDocument,
} from "@icm/model";
import { endpointKey } from "@icm/derived";

import type { EditTransaction } from "./edit-schema.js";
import { physicalContactLicenseForTransaction } from "./transaction-connectivity.js";
import { endpointOwnerNetId } from "./transaction-routing.js";

export interface AuthoredRoutePath {
  readonly routeId: string;
  readonly ends: readonly RouteEndpoint[];
}

export type RouteConductor = ReturnType<
  typeof routeElectricalConnections
>[number];

const conductorPairKey = ({ endpoints }: RouteConductor) =>
  JSON.stringify(endpoints.map(endpointKey).sort());

/** A pending Route's Net hint never authorizes cutting a Net. Prefer its
 * currently owned ends, otherwise the same lane of the committed Route. */
export function cutConductors(
  draft: SchematicDocument,
  route: RouteBranch,
  original?: RouteBranch,
): RouteConductor[] {
  const previous = original ? routeElectricalConnections(original) : [];
  return routeElectricalConnections(route).flatMap((edge) => {
    const [start, end] = edge.endpoints;
    const owner = endpointOwnerNetId(draft, start);
    if (owner && endpointOwnerNetId(draft, end) === owner)
      return [{ ...edge, netId: owner }];
    const committed = previous.find(
      ({ memberId }) => memberId === edge.memberId,
    );
    return committed && draft.nets.some(({ id }) => id === committed.netId)
      ? [committed]
      : [];
  });
}

export function readRouteEdits(transaction: EditTransaction) {
  const paths = new Map<string, AuthoredRoutePath>();
  const authoredRouteIds = new Set<string>();
  const movedJunctionIds = new Set<string>();
  const cutRouteByNet = new Map<string, string>();
  const cutEndsByNet = new Map<string, string[]>();
  const unroutedByPair = new Map<string, RouteConductor>();
  const connections: Array<readonly RouteEndpoint[]> = [];
  const disconnected = new Map<string, RouteEndpoint>();
  const unplaced = new Set<string>();
  const merges: Array<readonly [string, string]> = [];
  const boundProperties = new Set<string>();
  let rebuild = false;
  for (const edit of transaction.edits) {
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- these edits affect route connectivity
    switch (edit.kind) {
      case "set_route_path":
        authoredRouteIds.add(edit.route.id);
        paths.set(edit.route.id, {
          routeId: edit.route.id,
          ends: routeEndpoints(edit.route),
        });
        rebuild = true;
        break;
      case "route_orthogonal":
        authoredRouteIds.add(edit.routeId);
        paths.set(edit.routeId, {
          routeId: edit.routeId,
          ends: [edit.from, edit.to],
        });
        rebuild = true;
        break;
      case "move_junction":
        movedJunctionIds.add(edit.junctionId);
        rebuild = true;
        break;
      case "cut_connection":
        paths.delete(edit.routeId);
        rebuild = true;
        break;
      case "remove_route_geometry":
        paths.delete(edit.routeId);
        authoredRouteIds.add(edit.routeId);
        rebuild = true;
        break;
      case "connect_endpoints":
        connections.push([edit.from, edit.to]);
        rebuild = true;
        break;
      case "disconnect_endpoint":
        disconnected.set(endpointKey(edit.endpoint), edit.endpoint);
        rebuild = true;
        break;
      case "merge_nets":
        merges.push([edit.sourceNetId, edit.targetNetId]);
        break;
      case "unplace_instance":
        unplaced.add(edit.instanceId);
        break;
      case "set_property_terminal_net":
        if (edit.netId !== null)
          boundProperties.add(
            endpointKey({
              kind: "terminal",
              instanceId: edit.instanceId,
              pinName: edit.pinName,
            }),
          );
        break;
    }
  }
  // Capture the actual removed conductor, which can be a split product of a
  // preceding edit. Independent cuts choose the same start side in any order.
  const recordCut = (route: RouteBranch, edges: readonly RouteConductor[]) => {
    // The same electrical pair may have been redrawn under a different ID.
    for (const edge of routeElectricalConnections(route))
      unroutedByPair.delete(conductorPairKey(edge));
    const cut = new Map<string, string[]>();
    for (const edge of edges) {
      const ends = cut.get(edge.netId) ?? [];
      ends.push(...edge.endpoints.map(endpointKey));
      cut.set(edge.netId, ends);
    }
    for (const [netId, ends] of cut) {
      const first = cutRouteByNet.get(netId);
      if (first !== undefined && first <= route.id) continue;
      cutRouteByNet.set(netId, route.id);
      cutEndsByNet.set(netId, ends);
    }
  };
  return {
    rebuild,
    paths: [...paths.values()],
    authoredRouteIds,
    movedJunctionIds,
    cutEndsByNet,
    get keptUnrouted() {
      return [...unroutedByPair.values()];
    },
    recordCut,
    recordUnroute: (route: RouteBranch) => {
      for (const edge of routeElectricalConnections(route))
        unroutedByPair.set(conductorPairKey(edge), edge);
    },
    connections,
    disconnected,
    unplaced,
    merges,
    boundProperties,
    contactLicense: physicalContactLicenseForTransaction(transaction),
  };
}

export type RouteEdits = ReturnType<typeof readRouteEdits>;
