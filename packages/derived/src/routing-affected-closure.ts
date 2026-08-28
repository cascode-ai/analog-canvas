import { routeEnd } from "@icm/model";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";

import { deriveInternalGroupSelection } from "./routing-components.js";

export interface RoutingSelectionSeed {
  readonly instanceIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly junctionIds: readonly string[];
  readonly annotationIds?: readonly string[];
}

export interface RoutingAffectedClosure {
  readonly instances: readonly string[];
  readonly internalRoutes: readonly string[];
  readonly boundaryRoutes: readonly string[];
  readonly externalRoutes: readonly string[];
  readonly internalJunctions: readonly string[];
  readonly boundaryJunctions: readonly string[];
  readonly electricalAnnotationIds: readonly string[];
  readonly protectedObjectIds: readonly string[];
}

export interface RoutingAffectedClosureOptions {
  /**
   * Expand selected Instances to Route components whose terminal endpoints
   * are all selected. Move/delete use that connected-subgraph behavior. An
   * explicit clipboard selection disables it so unselected Wire never enters
   * a copy merely because it ends at a selected part.
   */
  readonly includeImplicitInstanceRoutes?: boolean;
}

function stable(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function junctionDegree(
  document: SchematicDocument,
  junctionId: string,
): number {
  return document.routes.reduce((degree, route) => {
    const endpoints = [route.start, routeEnd(route)];
    return (
      degree +
      endpoints.filter(
        (endpoint) =>
          endpoint.kind === "junction" && endpoint.junctionId === junctionId,
      ).length
    );
  }, 0);
}

function isInside(
  endpoint: RouteEndpoint,
  instanceIds: ReadonlySet<string>,
  junctionIds: ReadonlySet<string>,
): boolean {
  return endpoint.kind === "terminal"
    ? instanceIds.has(endpoint.instanceId)
    : junctionIds.has(endpoint.junctionId);
}

/**
 * Derive the electrical closure of one visual selection without inspecting
 * pointer geometry. A marquee may seed stable object IDs, but a Route merely
 * passing through it never becomes selected by this read model.
 */
export function deriveRoutingAffectedClosure(
  document: SchematicDocument,
  seed: RoutingSelectionSeed,
  options: RoutingAffectedClosureOptions = {},
): RoutingAffectedClosure {
  const knownInstances = new Set(document.instances.map((item) => item.id));
  const knownJunctions = new Set(document.junctions.map((item) => item.id));
  const knownRoutes = new Set(document.routes.map((item) => item.id));
  const instances = stable(
    seed.instanceIds.filter((id) => knownInstances.has(id)),
  );
  const instanceIds = new Set(instances);
  const internal =
    options.includeImplicitInstanceRoutes === false
      ? { netIds: [], routeIds: [], junctionIds: [] }
      : deriveInternalGroupSelection(document, instances);
  const internalRouteIds = new Set(internal.routeIds);
  const internalJunctionIds = new Set(internal.junctionIds);

  for (const junctionId of seed.junctionIds) {
    if (knownJunctions.has(junctionId)) internalJunctionIds.add(junctionId);
  }

  // A Route the person selected travels with the selection, and the Junctions
  // on its ends travel with it.
  //
  // What pins a Route is a terminal it cannot take along: a Terminal endpoint
  // belongs to an Instance, so a Route reaching an unselected Instance has to
  // stay attached and stretch. A Junction endpoint pins nothing — it is an
  // anchor, free to move, and the unselected Routes meeting it stretch to
  // follow. Requiring every endpoint to be inside instead stranded the
  // Junction where two columns share a bus: the selected wires grew doglegs
  // bending back to a connection point that stayed behind.
  for (const routeId of seed.routeIds) {
    if (!knownRoutes.has(routeId) || internalRouteIds.has(routeId)) continue;
    const route = document.routes.find((item) => item.id === routeId)!;
    const ends = [route.start, routeEnd(route)];
    const heldByUnselectedInstance = ends.some(
      (endpoint) =>
        endpoint.kind === "terminal" && !instanceIds.has(endpoint.instanceId),
    );
    if (heldByUnselectedInstance) continue;
    internalRouteIds.add(route.id);
    for (const endpoint of ends) {
      if (endpoint.kind === "junction") {
        internalJunctionIds.add(endpoint.junctionId);
      }
    }
  }

  const boundaryRouteIds = new Set<string>();
  const externalRouteIds = new Set<string>();
  const boundaryJunctionIds = new Set<string>();
  for (const route of document.routes) {
    if (internalRouteIds.has(route.id)) continue;
    const end = routeEnd(route);
    const startInside = isInside(route.start, instanceIds, internalJunctionIds);
    const endInside = isInside(end, instanceIds, internalJunctionIds);
    if (startInside !== endInside) {
      boundaryRouteIds.add(route.id);
      for (const endpoint of [route.start, end]) {
        if (
          endpoint.kind === "junction" &&
          !internalJunctionIds.has(endpoint.junctionId)
        ) {
          boundaryJunctionIds.add(endpoint.junctionId);
        }
      }
    } else {
      externalRouteIds.add(route.id);
    }
  }

  const explicitlySelectedAnnotations = new Set(seed.annotationIds ?? []);
  const electricalAnnotationIds = stable(
    document.annotations.flatMap((annotation) => {
      const electricalKind =
        annotation.kind === "net-label" ||
        annotation.kind === "power-label" ||
        annotation.kind === "route-marker";
      const followsObject =
        annotation.anchor.kind === "object" &&
        (instanceIds.has(annotation.anchor.objectId) ||
          internalJunctionIds.has(annotation.anchor.objectId));
      const followsRoute =
        annotation.anchor.kind === "route" &&
        internalRouteIds.has(annotation.anchor.routeId);
      return electricalKind &&
        (followsObject ||
          followsRoute ||
          explicitlySelectedAnnotations.has(annotation.id))
        ? [annotation.id]
        : [];
    }),
  );

  const protectedObjectIds = new Set<string>();
  for (const route of document.routes) {
    if (
      route.legs.some((leg) => leg.mode === "locked" || leg.mode === "trunk")
    ) {
      protectedObjectIds.add(route.id);
    }
  }
  for (const annotation of document.annotations) {
    if (annotation.locked) protectedObjectIds.add(annotation.id);
  }
  for (const owner of [...document.layoutGroups, ...document.constraints]) {
    if (!owner.locked) continue;
    for (const objectId of owner.objectIds) protectedObjectIds.add(objectId);
  }

  return {
    instances,
    internalRoutes: stable(internalRouteIds),
    boundaryRoutes: stable(boundaryRouteIds),
    externalRoutes: stable(externalRouteIds),
    internalJunctions: stable(internalJunctionIds),
    boundaryJunctions: stable(boundaryJunctionIds),
    electricalAnnotationIds,
    protectedObjectIds: stable(protectedObjectIds),
  };
}
