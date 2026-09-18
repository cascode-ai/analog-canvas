import { routeEndpoints } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  buildDocumentSpatialIndex,
  endpointKey,
  findRouteSegmentsAtPoint,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import type { DocumentSpatialIndex } from "@icm/derived";
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

function routeContainsAuthoredPoint(
  document: SchematicDocument,
  geometry: ReturnType<typeof resolveDocumentRoutingGeometry>,
  routeId: string,
  point: Point,
  spatialIndex?: DocumentSpatialIndex,
): boolean {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  // Power rails own a dedicated contact planner which keeps off-grid artwork
  // tips connected through grid-aligned taps. Generic Route contact repair
  // would split the rail at the artwork tip and create a second topology.
  if (
    !route ||
    route.presentation === "bulk-dashed" ||
    route.presentation === "power-rail"
  )
    return false;
  return findRouteSegmentsAtPoint(geometry, point, spatialIndex).some(
    (address) => {
      if (address.routeId !== routeId) return false;
      const segment = geometry.routes
        .get(routeId)
        ?.segments.find(
          (candidate) =>
            candidate.address.segmentIndex === address.segmentIndex,
        );
      return segment !== undefined && segment.mode !== "escape";
    },
  );
}

export interface NewlyTouchedRouteEndpoint {
  readonly endpoint: RouteEndpoint;
  readonly routeId: string;
  readonly point: Point;
}

/**
 * Exact endpoint contacts introduced by authored Route geometry.
 *
 * Comparing the projected result with the source avoids bonding a pin that
 * was already parked on an untouched part of the same Route. A Junction is a
 * real wire endpoint, so moving a segment onto it connects; two Route
 * interiors crossing still never enter this detector.
 */
export function newlyTouchedRouteEndpoints(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
  routeIds: ReadonlySet<string>,
): NewlyTouchedRouteEndpoint[] {
  if (routeIds.size === 0) return [];
  const beforeGeometry = resolveDocumentRoutingGeometry(before, resolver);
  const afterGeometry = resolveDocumentRoutingGeometry(after, resolver);
  // One broad phase per Document for the whole nested sweep below. Neither
  // geometry changes while this runs, and the sweep asks
  // `routeContainsAuthoredPoint` twice per endpoint-and-Route pair, so an
  // unwidened scan of every segment there ran tens of thousands of times for
  // one multi-select delete.
  const beforeIndex = buildDocumentSpatialIndex(before, beforeGeometry);
  const afterIndex = buildDocumentSpatialIndex(after, afterGeometry);
  const result: NewlyTouchedRouteEndpoint[] = [];
  for (const endpoint of visibleEndpoints(after, resolver)) {
    const point = resolveEndpointConnection(
      after,
      resolver,
      endpoint,
    )?.contactPoint;
    if (!point) continue;
    for (const routeId of [...routeIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    )) {
      // A newly pasted/drawn Route is handled by its authoring planner. This
      // detector is for an existing conductor whose geometry moved onto a
      // previously separate pin; treating every new Route as a drag also
      // connected copied circuits to unrelated objects under the paste ghost.
      if (!before.routes.some((candidate) => candidate.id === routeId)) {
        continue;
      }
      const route = after.routes.find((candidate) => candidate.id === routeId);
      if (!route) continue;
      if (
        routeEndpoints(route).some(
          (candidate) => endpointKey(candidate) === endpointKey(endpoint),
        )
      ) {
        continue;
      }
      if (
        !routeContainsAuthoredPoint(
          after,
          afterGeometry,
          routeId,
          point,
          afterIndex,
        )
      ) {
        continue;
      }
      if (
        routeContainsAuthoredPoint(
          before,
          beforeGeometry,
          routeId,
          point,
          beforeIndex,
        )
      ) {
        continue;
      }
      result.push({ endpoint, routeId, point: { ...point } });
    }
  }
  return result;
}

/**
 * Return one deterministic physical-contact operation for the current draft.
 * The transaction applies it and asks again, so route splits and Net merges
 * are always evaluated against fresh geometry instead of stale segment IDs.
 *
 * Only contacts the transaction licensed are normalized. Route-interior
 * crossings are deliberately absent. This module handles direct endpoint
 * contacts, explicit Junction-on-route contacts, and exact endpoint points
 * newly touched by edited Route geometry. A Route crossing another Route is
 * never a contact here because neither interior supplies an endpoint.
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
    license.routePoints.size === 0 &&
    license.routeGeometryPoints.size === 0
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
    const point = coincident[0]?.point;
    const changedRouteLandedHere =
      point !== undefined &&
      [...license.routeGeometryPoints.values()].some((points) =>
        points.has(physicalContactPointKey(point)),
      );
    if (
      !changedRouteLandedHere &&
      !coincident.some(({ endpoint }) => endpointLicensed(endpoint))
    ) {
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
          !changedRouteLandedHere &&
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
    const endpointIsLicensed = endpointLicensed(endpoint);
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
      // Introduced conductors license explicit Junction incidence. Terminal
      // interiors require either the exact point newly covered by a moved
      // Route or the typed endpoint/point pair supplied by an attach planner.
      const introducedRouteLicensed = license.objectIds.has(route.id);
      const typedRoutePointLicensed =
        license.routePoints
          .get(route.id)
          ?.has(physicalContactPointKey(point)) === true;
      const changedRoutePointLicensed =
        license.routeGeometryPoints
          .get(route.id)
          ?.has(physicalContactPointKey(point)) === true;
      const contactLicensed =
        endpoint.kind === "junction"
          ? endpointIsLicensed ||
            introducedRouteLicensed ||
            typedRoutePointLicensed ||
            changedRoutePointLicensed
          : changedRoutePointLicensed ||
            (endpointIsLicensed && typedRoutePointLicensed);
      if (!contactLicensed) continue;
      if (
        routeEndpoints(route).some(
          (candidate) => endpointKey(candidate) === endpointKey(endpoint),
        )
      ) {
        continue;
      }
      // Endpoint-to-endpoint coincidence is handled above. An internal bend,
      // however, is a valid split vertex and splitRoute partitions it without
      // creating a zero-length leg.
      const routeSegments = geometry.routes.get(route.id)?.segments ?? [];
      const pointIsRouteBoundary =
        samePoint(point, routeSegments[0]?.from ?? point) ||
        samePoint(point, routeSegments.at(-1)?.to ?? point);
      if (pointIsRouteBoundary) continue;
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
