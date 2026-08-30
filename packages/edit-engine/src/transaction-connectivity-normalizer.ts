import { routeEndpoints } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  endpointKey,
  findRouteSegmentsAtPoint,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import {
  physicalContactPointKey,
  type PhysicalContactLicense,
} from "./transaction-connectivity.js";
import { endpointOwnerNetId } from "./transaction-routing.js";

export type PhysicalContactOperation =
  | {
      kind: "connect-endpoints";
      left: RouteEndpoint;
      right: RouteEndpoint;
    }
  | {
      kind: "attach-endpoint-to-route";
      endpoint: RouteEndpoint;
      routeId: string;
      segmentIndex: number;
      point: Point;
    };

function endpointObjectId(endpoint: RouteEndpoint): string {
  return endpoint.kind === "terminal"
    ? endpoint.instanceId
    : endpoint.junctionId;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function visibleEndpoints(
  document: SchematicDocument,
  resolver: SymbolResolver,
): RouteEndpoint[] {
  const terminals = document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    const symbol = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!symbol) return [];
    return symbol.definition.pins.flatMap((pin): RouteEndpoint[] => {
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      return isVisibleEndpoint(document, resolver, endpoint) ? [endpoint] : [];
    });
  });
  return [
    ...terminals,
    ...document.junctions.map((junction): RouteEndpoint => ({
      kind: "junction",
      junctionId: junction.id,
    })),
  ].sort((left, right) =>
    endpointKey(left).localeCompare(endpointKey(right), "en"),
  );
}

/**
 * Return one deterministic physical-contact operation for the current draft.
 * The transaction applies it and asks again, so route splits and Net merges
 * are always evaluated against fresh geometry instead of stale segment IDs.
 *
 * Only contacts the transaction licensed are normalized. Route-interior
 * crossings are deliberately absent. This module handles direct endpoint
 * contacts and explicit Junction-on-route contacts; snapped pin-to-route
 * attachment remains a typed gesture intent.
 */
export function nextPhysicalContactOperation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  license: PhysicalContactLicense,
  suppressedEndpointKeys: ReadonlySet<string> = new Set(),
): PhysicalContactOperation | null {
  // A transaction without an explicit physical-contact license cannot
  // normalize any contact. Most geometry and presentation edits are in this
  // category; avoid resolving every visible endpoint and comparing the whole
  // Document only to reject every candidate below.
  if (
    license.objectIds.size === 0 &&
    license.endpointKeys.size === 0 &&
    license.routePoints.size === 0
  ) {
    return null;
  }
  const endpointLicensed = (endpoint: RouteEndpoint): boolean =>
    license.objectIds.has(endpointObjectId(endpoint)) ||
    license.endpointKeys.has(endpointKey(endpoint));
  const endpoints = visibleEndpoints(document, resolver).filter(
    (endpoint) => !suppressedEndpointKeys.has(endpointKey(endpoint)),
  );
  const positioned = endpoints.flatMap((endpoint) => {
    const point = resolveEndpointConnection(
      document,
      resolver,
      endpoint,
    )?.contactPoint;
    return point ? [{ endpoint, point }] : [];
  });

  const positionedByPoint = new Map<string, typeof positioned>();
  for (const entry of positioned) {
    const key = physicalContactPointKey(entry.point);
    const entries = positionedByPoint.get(key) ?? [];
    entries.push(entry);
    positionedByPoint.set(key, entries);
  }
  for (const coincident of positionedByPoint.values()) {
    if (!coincident.some(({ endpoint }) => endpointLicensed(endpoint))) {
      continue;
    }
    for (let leftIndex = 0; leftIndex < coincident.length; leftIndex += 1) {
      const left = coincident[leftIndex]!;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < coincident.length;
        rightIndex += 1
      ) {
        const right = coincident[rightIndex]!;
        if (
          !endpointLicensed(left.endpoint) &&
          !endpointLicensed(right.endpoint)
        ) {
          continue;
        }
        const leftOwner = endpointOwnerNetId(document, left.endpoint);
        const rightOwner = endpointOwnerNetId(document, right.endpoint);
        if (leftOwner !== null && leftOwner === rightOwner) continue;
        return {
          kind: "connect-endpoints",
          left: left.endpoint,
          right: right.endpoint,
        };
      }
    }
  }

  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  for (const { endpoint, point } of positioned) {
    // Pin-to-route attachment is a gesture-level intent because it may split
    // a selected Route and therefore needs the caller's snapped target. The
    // transaction still validates and applies that typed intent. Junctions,
    // by contrast, are explicit topology objects: a Junction on a conductor
    // is unambiguously a physical contact and is normalized here.
    if (endpoint.kind !== "junction") continue;
    const junctionLicensed = endpointLicensed(endpoint);
    for (const address of findRouteSegmentsAtPoint(geometry, point)) {
      const route = document.routes.find(
        (candidate) => candidate.id === address.routeId,
      );
      const segment = geometry.routes
        .get(address.routeId)
        ?.segments.find(
          (candidate) =>
            candidate.address.segmentIndex === address.segmentIndex,
        );
      if (!route || !segment) continue;
      if (route.presentation === "bulk-dashed") continue;
      // Escape segments are derived artwork-to-grid leads, not independently
      // authored wire geometry. Treating a symbol's other pins as contacts on
      // that lead can short pins inside the symbol and destabilize the Route
      // whenever the symbol moves.
      if (segment.mode === "escape") continue;
      // A wholesale license (introduced conductor) bonds anywhere along the
      // Route; a typed attach only bonds at the exact point it named.
      const routeLicensed =
        license.objectIds.has(route.id) ||
        license.routePoints
          .get(route.id)
          ?.has(physicalContactPointKey(point)) === true;
      if (!junctionLicensed && !routeLicensed) continue;
      if (
        routeEndpoints(route).some(
          (candidate) => endpointKey(candidate) === endpointKey(endpoint),
        )
      ) {
        continue;
      }
      // Endpoint-to-endpoint coincidence is handled above. Splitting is only
      // meaningful for a real segment interior.
      if (samePoint(point, segment.from) || samePoint(point, segment.to)) {
        continue;
      }
      return {
        kind: "attach-endpoint-to-route",
        endpoint,
        routeId: route.id,
        segmentIndex: address.segmentIndex,
        point,
      };
    }
  }
  return null;
}
