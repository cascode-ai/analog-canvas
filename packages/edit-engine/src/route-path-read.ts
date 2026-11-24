import { buildEndpointObjectLookup, resolveRouteGeometry } from "@icm/derived";
import {
  routeEndpoints,
  type SchematicDocument,
  type RouteBranch,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { RouteEditPath } from "./route-geometry-edit.js";

export function routeIdsByJunction(
  routes: readonly RouteBranch[],
): Map<string, string[]> {
  const idsByJunction = new Map<string, string[]>();
  for (const route of routes) {
    for (const endpoint of routeEndpoints(route)) {
      if (endpoint.kind !== "junction") continue;
      const ids = idsByJunction.get(endpoint.junctionId) ?? [];
      ids.push(route.id);
      idsByJunction.set(endpoint.junctionId, ids);
    }
  }
  return idsByJunction;
}

/** A synchronous read phase, never retained across mutations of a draft.
 * Route validation and attachment capture read the same exact geometry. */
export function routingEndpointLookup(document: SchematicDocument) {
  // Invalid legacy duplicate ids must retain find-first resolution until the
  // authoritative schema rejects them, rather than acquire Map's last winner.
  const unique = (items: readonly { id: string }[]) =>
    new Set(items.map((item) => item.id)).size === items.length;
  if (!unique(document.instances) || !unique(document.junctions))
    return undefined;
  const netsById = new Map<string, SchematicDocument["nets"][number]>();
  for (const net of document.nets) {
    if (!netsById.has(net.id)) netsById.set(net.id, net);
  }
  return { ...buildEndpointObjectLookup(document), netsById };
}

export function prepareRoutePathRead(
  document: SchematicDocument,
  resolver: SymbolResolver,
  lookup = routingEndpointLookup(document),
) {
  const paths = new Map<RouteBranch, RouteEditPath | null>();
  return (route: RouteBranch): RouteEditPath | null => {
    if (paths.has(route)) return paths.get(route)!;
    const geometry = resolveRouteGeometry(
      document,
      resolver,
      route,
      undefined,
      lookup,
    );
    const path = geometry
      ? {
          points: [...geometry.centerline],
          segmentModes: geometry.segments.map((segment) => segment.mode),
        }
      : null;
    paths.set(route, path);
    return path;
  };
}
