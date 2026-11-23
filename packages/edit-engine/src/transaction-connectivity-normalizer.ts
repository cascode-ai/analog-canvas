import { routeEndpoints } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import {
  buildBoundsSpatialIndex,
  buildDocumentSpatialIndex,
  buildEndpointObjectLookup,
  drawingHasOpaqueFill,
  endpointKey,
  findRouteSegmentsAtPoint,
  isVisibleEndpoint,
  pointOnSegment,
  resolveRouteGeometry,
  SEGMENT_QUERY_PADDING,
  segmentNeedsExactPointQuery,
  resolveDocumentRoutingGeometry,
  resolveDrawingScene,
  resolveEndpointConnection,
} from "@icm/derived";
import type { EndpointObjectLookup, ResolvedRouteGeometry } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import {
  physicalContactPointKey,
  type PhysicalContactLicense,
} from "./transaction-connectivity.js";
import { endpointOwnerNetId } from "./transaction-routing.js";
import { signalEndpointMembers } from "./signal-endpoint.js";

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
  lookup?: EndpointObjectLookup,
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
      if (signalEndpointMembers(document, resolver, endpoint, lookup))
        return [];
      return isVisibleEndpoint(document, resolver, endpoint, lookup)
        ? [endpoint]
        : [];
    });
  });
  return [
    ...terminals,
    ...document.junctions
      .filter((junction) => !junction.members)
      .map((junction): RouteEndpoint => ({
        kind: "junction",
        junctionId: junction.id,
      })),
  ].sort((left, right) =>
    endpointKey(left).localeCompare(endpointKey(right), "en"),
  );
}

function contactSegments(
  route: SchematicDocument["routes"][number],
  geometry?: ResolvedRouteGeometry | null,
) {
  if (
    route.members ||
    route.presentation === "bulk-dashed" ||
    route.presentation === "power-rail"
  )
    return [];
  return (
    geometry?.segments.filter((segment) => segment.mode !== "escape") ?? []
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
  options: {
    excludeInstanceIds?: ReadonlySet<string>;
    excludeJunctionIds?: ReadonlySet<string>;
    /** Internal planner read for this exact, unchanged source Document. */
    beforeGeometry?: ReturnType<typeof resolveDocumentRoutingGeometry>;
  } = {},
): NewlyTouchedRouteEndpoint[] {
  if (routeIds.size === 0) return [];
  // New Routes are reconciled by their authoring planner. Only existing
  // conductors can have moved onto a previously separate endpoint.
  const beforeRoutes = new Map(before.routes.map((route) => [route.id, route]));
  const moved = after.routes.filter(
    (route) => routeIds.has(route.id) && beforeRoutes.has(route.id),
  );
  if (!moved.length) return [];
  const lookup = buildEndpointObjectLookup(after);
  const beforeLookup = options.beforeGeometry
    ? undefined
    : buildEndpointObjectLookup(before);
  const positioned = visibleEndpoints(after, resolver, lookup).flatMap(
    (endpoint) => {
      if (
        endpoint.kind === "terminal"
          ? options.excludeInstanceIds?.has(endpoint.instanceId)
          : options.excludeJunctionIds?.has(endpoint.junctionId)
      )
        return [];
      const point = resolveEndpointConnection(
        after,
        resolver,
        endpoint,
        lookup,
      )?.contactPoint;
      return point ? [{ endpoint, point }] : [];
    },
  );
  const endpoints = buildBoundsSpatialIndex(
    positioned.map((value) => ({
      bounds: { ...value.point, width: 0, height: 0 },
      value,
    })),
    Math.max(80, after.presentation.grid * 8),
  );
  const drawing = drawingHasOpaqueFill(after)
    ? resolveDrawingScene(after, resolver)
    : undefined;
  const touchedByEndpoint = new Map<RouteEndpoint, string[]>();
  for (const route of moved) {
    const old = beforeRoutes.get(route.id)!;
    const previous = contactSegments(
      old,
      options.beforeGeometry
        ? options.beforeGeometry.routes.get(old.id)
        : resolveRouteGeometry(before, resolver, old, undefined, beforeLookup),
    );
    const ownEnds = new Set(routeEndpoints(route).map(endpointKey));
    const seen = new Set<RouteEndpoint>();
    for (const { from, to } of contactSegments(
      route,
      resolveRouteGeometry(after, resolver, route, undefined, lookup),
    )) {
      // Match findRouteSegmentsAtPoint's conservative tolerance for short segments.
      const padding = SEGMENT_QUERY_PADDING;
      const candidates = segmentNeedsExactPointQuery(from, to)
        ? positioned
        : endpoints.queryBounds({
            x: Math.min(from.x, to.x) - padding,
            y: Math.min(from.y, to.y) - padding,
            width: Math.abs(to.x - from.x) + 2 * padding,
            height: Math.abs(to.y - from.y) + 2 * padding,
          });
      for (const { endpoint, point } of candidates) {
        const key = endpointKey(endpoint);
        if (
          seen.has(endpoint) ||
          ownEnds.has(key) ||
          !pointOnSegment(point, from, to)
        )
          continue;
        seen.add(endpoint);
        if (
          previous.some((segment) =>
            pointOnSegment(point, segment.from, segment.to),
          )
        )
          continue;
        if (
          drawing &&
          (!drawing.isEndpointVisibleAt(endpoint, point) ||
            !drawing.isVisibleAt({ kind: "electrical" }, point))
        )
          continue;
        const touched = touchedByEndpoint.get(endpoint) ?? [];
        touched.push(route.id);
        touchedByEndpoint.set(endpoint, touched);
      }
    }
  }
  // visibleEndpoints defines the original traversal order, including ties
  // between distinct endpoints whose display keys happen to compare equal.
  return positioned.flatMap(({ endpoint, point }) =>
    (touchedByEndpoint.get(endpoint) ?? [])
      .sort((a, b) => a.localeCompare(b, "en"))
      .map((routeId) => ({ endpoint, point: { ...point }, routeId })),
  );
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
  const lookup = buildEndpointObjectLookup(document);
  const endpoints = visibleEndpoints(document, resolver, lookup).filter(
    (endpoint) => !suppressedEndpointKeys.has(endpointKey(endpoint)),
  );
  const drawing = drawingHasOpaqueFill(document)
    ? resolveDrawingScene(document, resolver)
    : undefined;
  const positioned = endpoints.flatMap((endpoint) => {
    const point = resolveEndpointConnection(
      document,
      resolver,
      endpoint,
      lookup,
    )?.contactPoint;
    if (
      point &&
      drawing &&
      !license.endpointKeys.has(endpointKey(endpoint)) &&
      !drawing.isEndpointVisibleAt(endpoint, point)
    )
      return [];
    return point ? [{ endpoint, point }] : [];
  });

  const positionedByPoint = new Map<string, typeof positioned>();
  function pointKeys(byRoute: ReadonlyMap<string, Set<string>>) {
    const keys = new Set<string>();
    for (const points of byRoute.values())
      for (const point of points) keys.add(point);
    return keys;
  }
  const changedPoints = pointKeys(license.routeGeometryPoints);
  for (const entry of positioned) {
    const key = physicalContactPointKey(entry.point);
    const entries = positionedByPoint.get(key) ?? [];
    entries.push(entry);
    positionedByPoint.set(key, entries);
  }
  for (const coincident of positionedByPoint.values()) {
    const point = coincident[0]?.point;
    const changedRouteLandedHere =
      point !== undefined && changedPoints.has(physicalContactPointKey(point));
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

  // Only the exact licensed locations may attach a terminal to a conductor.
  // Junctions can also attach anywhere on an introduced Route.
  const typedPoints = pointKeys(license.routePoints);
  const licensedRoutes = document.routes.filter(
    (route) =>
      license.objectIds.has(route.id) ||
      license.routePoints.has(route.id) ||
      license.routeGeometryPoints.has(route.id),
  );
  const introducedRoute = licensedRoutes.some((route) =>
    license.objectIds.has(route.id),
  );
  const licensedJunction = positioned.some(
    ({ endpoint }) =>
      endpoint.kind === "junction" && endpointLicensed(endpoint),
  );
  const segmentCandidates = positioned.filter(({ endpoint, point }) => {
    if (endpoint.kind === "junction")
      return (
        endpointLicensed(endpoint) ||
        introducedRoute ||
        changedPoints.has(physicalContactPointKey(point)) ||
        typedPoints.has(physicalContactPointKey(point))
      );
    const key = physicalContactPointKey(point);
    return (
      changedPoints.has(key) ||
      (endpointLicensed(endpoint) && typedPoints.has(key))
    );
  });
  if (!segmentCandidates.length) return null;
  // An explicitly licensed Junction may land on any conductor. Otherwise
  // only Routes named by this transaction can satisfy the exact test below.
  const routeDocument = licensedJunction
    ? document
    : { ...document, routes: licensedRoutes };
  const routesById = new Map(
    routeDocument.routes.map((route) => [route.id, route]),
  );
  const geometry = resolveDocumentRoutingGeometry(
    routeDocument,
    resolver,
    undefined,
    lookup,
  );
  // A draft can split/merge Routes without advancing its revision. Keep this
  // broad phase local to this normalization round, never to that revision.
  const spatialIndex = buildDocumentSpatialIndex(routeDocument, geometry);
  for (const { endpoint, point } of segmentCandidates) {
    const endpointIsLicensed = endpointLicensed(endpoint);
    for (const address of findRouteSegmentsAtPoint(
      geometry,
      point,
      spatialIndex,
    )) {
      const route = routesById.get(address.routeId);
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
        !typedRoutePointLicensed &&
        drawing &&
        !drawing.isVisibleAt({ kind: "electrical" }, point)
      )
        continue;
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
