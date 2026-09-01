import { routeEnd, type SchematicDocument } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { endpointOwnerNetId } from "./transaction-routing.js";

export interface DirectContactRouteNormalizationResult {
  changed: boolean;
  removedRouteIds: ReadonlySet<string>;
  protectedRouteIds: ReadonlySet<string>;
}

function routeHasExternalOwner(
  document: SchematicDocument,
  routeId: string,
): boolean {
  return (
    document.annotations.some(
      (annotation) =>
        (annotation.anchor.kind === "route" &&
          annotation.anchor.routeId === routeId) ||
        (annotation.anchor.kind === "object" &&
          annotation.anchor.objectId === routeId),
    ) ||
    document.connectivityEvidence.some(
      (evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker" &&
        evidence.owner.objectId === routeId,
    ) ||
    document.layoutGroups.some((group) => group.objectIds.includes(routeId)) ||
    document.constraints.some((constraint) =>
      constraint.objectIds.includes(routeId),
    )
  );
}

/**
 * Remove legacy ordinary-Wire geometry that now resolves to one exact point.
 *
 * Symbol terminal anchors are part of persisted Route geometry even though a
 * Route stores endpoint identity instead of endpoint coordinates. A library
 * correction can therefore collapse an old one-cell Route after resolution.
 * When both endpoints still belong to the Route's Base Net, that geometry is
 * redundant: the coincident endpoints already represent the same direct
 * electrical contact. Route-owned presentation is never discarded here.
 */
export function normalizeRedundantDirectContactRoutes(
  document: SchematicDocument,
  resolver: SymbolResolver,
): DirectContactRouteNormalizationResult {
  const removedRouteIds = new Set<string>();
  const protectedRouteIds = new Set<string>();

  for (const route of document.routes) {
    if (
      (route.presentation ?? "wire") !== "wire" ||
      route.legs.some((leg) => leg.mode === "locked")
    ) {
      continue;
    }
    const geometry = resolveRouteGeometry(document, resolver, route);
    const contactPoint = geometry?.centerline[0];
    if (
      !geometry ||
      !contactPoint ||
      !geometry.centerline.every(
        (point) => point.x === contactPoint.x && point.y === contactPoint.y,
      )
    ) {
      continue;
    }
    const fromNetId = endpointOwnerNetId(document, route.start);
    const toNetId = endpointOwnerNetId(document, routeEnd(route));
    if (fromNetId !== route.netId || toNetId !== route.netId) continue;
    if (routeHasExternalOwner(document, route.id)) {
      protectedRouteIds.add(route.id);
      continue;
    }
    removedRouteIds.add(route.id);
  }

  if (removedRouteIds.size > 0) {
    document.routes = document.routes.filter(
      (route) => !removedRouteIds.has(route.id),
    );
  }
  return {
    changed: removedRouteIds.size > 0,
    removedRouteIds,
    protectedRouteIds,
  };
}
