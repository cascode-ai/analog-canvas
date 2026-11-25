import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  buildEndpointObjectLookup,
  endpointKey,
  resolveEndpointPoint,
} from "./endpoint.js";
import {
  intersectSegments,
  pointOnSegment,
  projectPointToSegment,
  SEGMENT_QUERY_PADDING,
} from "./segment-geometry.js";
import type { DocumentDerivedContext } from "./document-derived-context.js";
import { segmentBounds, type DocumentSpatialIndex } from "./spatial-index.js";

import type {
  ResolvedDocumentRoutingGeometry,
  ResolvedRouteGeometry,
  ResolvedRouteSegment,
  RouteSegmentAddress,
} from "./resolved-route-geometry.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";

export interface RouteSegmentHit {
  address: RouteSegmentAddress;
  point: Point;
  t: number;
  distanceSquared: number;
}

export interface Crossing {
  routeAId: string;
  routeBId: string;
  netAId: string;
  netBId: string;
  point: Point;
  kind: "crossing" | "overlap";
}

interface CrossingSegmentCandidate {
  route: RouteBranch;
  routeOrder: number;
  segment: ResolvedRouteSegment;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function projectPointToRouteSegment(
  point: Point,
  segment: ResolvedRouteSegment,
): RouteSegmentHit | null {
  const projected = projectPointToSegment(point, segment.from, segment.to);
  if (!projected) return null;
  return {
    address: segment.address,
    point: projected.point,
    t: projected.t,
    distanceSquared: projected.distanceSquared,
  };
}

export function nearestRouteSegment(
  geometry: ResolvedRouteGeometry,
  point: Point,
): RouteSegmentHit | null {
  return (
    geometry.segments
      .flatMap((segment) => {
        const hit = projectPointToRouteSegment(point, segment);
        return hit ? [hit] : [];
      })
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.address.segmentIndex - right.address.segmentIndex,
      )[0] ?? null
  );
}

/**
 * Preserve the editor's bend-first route hit behavior. A bend belongs to the
 * preceding segment; otherwise the nearest in-tolerance segment
 * wins, with the lower segment index as the deterministic tie-break.
 */
export function resolveRouteTap(
  geometry: ResolvedRouteGeometry,
  pointer: Point,
  tolerance: number,
): RouteSegmentHit | null {
  const toleranceSquared = tolerance * tolerance;
  const vertex = geometry.vertices
    .slice(1, -1)
    .map((candidate) => {
      const distanceSquared =
        (pointer.x - candidate.point.x) ** 2 +
        (pointer.y - candidate.point.y) ** 2;
      return {
        address: geometry.segments[candidate.index - 1]!.address,
        point: { ...candidate.point },
        t: 1,
        distanceSquared,
      };
    })
    .filter((candidate) => candidate.distanceSquared <= toleranceSquared)
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.address.segmentIndex - right.address.segmentIndex,
    )[0];
  if (vertex) return vertex;

  return (
    geometry.segments
      .flatMap((segment) => {
        const hit = projectPointToRouteSegment(pointer, segment);
        return hit && hit.distanceSquared <= toleranceSquared ? [hit] : [];
      })
      .sort(
        (left, right) =>
          left.distanceSquared - right.distanceSquared ||
          left.address.segmentIndex - right.address.segmentIndex,
      )[0] ?? null
  );
}

/**
 * Every Route segment the point lies on.
 *
 * `spatialIndex` is optional. Without it this scans every segment of the
 * Document, which is what a multi-select delete does tens of thousands of
 * times. With it the box query is only a broad phase; the exact predicate
 * below still decides.
 *
 * The exact predicate tolerates cross/dot products, not coordinate distances.
 * At length >= 2, each coordinate's tolerance is bounded by
 * sqrt(2) * SEGMENT_EPSILON / length. A 2*epsilon box is conservative there;
 * shorter segments are always checked exactly. Older/custom indexes lacking
 * the short-segment list use the original scan.
 */
export function findRouteSegmentsAtPoint(
  geometry: ResolvedDocumentRoutingGeometry,
  point: Point,
  spatialIndex?: DocumentSpatialIndex,
): RouteSegmentAddress[] {
  if (spatialIndex) {
    if (
      spatialIndex.documentId !== geometry.documentId ||
      spatialIndex.documentRevision !== geometry.documentRevision
    ) {
      throw new Error("Route query received a stale spatial index");
    }
  }
  if (spatialIndex?.shortRouteSegments) {
    const addresses: RouteSegmentAddress[] = [];
    const padding = SEGMENT_QUERY_PADDING;
    const widened = {
      x: point.x - padding,
      y: point.y - padding,
      width: padding * 2,
      height: padding * 2,
    };
    const candidates = new Set([
      ...spatialIndex.routeSegments.queryBounds(widened),
      ...spatialIndex.shortRouteSegments,
    ]);
    for (const entry of candidates) {
      // The segment is read from the geometry, not from the index entry, so
      // the predicate and the address it yields come from one source.
      const segment = geometry.routes.get(entry.routeId)?.segments[
        entry.segmentIndex
      ];
      if (segment && pointOnSegment(point, segment.from, segment.to)) {
        addresses.push(segment.address);
      }
    }
    return addresses.sort(
      (left, right) =>
        left.routeId.localeCompare(right.routeId, "en") ||
        left.segmentIndex - right.segmentIndex,
    );
  }
  return [...geometry.routes.values()]
    .flatMap((route) =>
      route.segments
        .filter((segment) => pointOnSegment(point, segment.from, segment.to))
        .map((segment) => segment.address),
    )
    .sort(
      (left, right) =>
        left.routeId.localeCompare(right.routeId, "en") ||
        left.segmentIndex - right.segmentIndex,
    );
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function sharedExplicitEndpoint(
  left: RouteBranch,
  right: RouteBranch,
): RouteEndpoint | null {
  for (const leftEndpoint of [left.start, routeEnd(left)]) {
    for (const rightEndpoint of [right.start, routeEnd(right)]) {
      if (endpointKey(leftEndpoint) === endpointKey(rightEndpoint)) {
        return leftEndpoint;
      }
    }
  }
  return null;
}

export function deriveCrossings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
): Crossing[] {
  return crossingsAmong(document, resolver, routingGeometry, document.routes);
}

function compareCrossings(left: Crossing, right: Crossing): number {
  return (
    left.routeAId.localeCompare(right.routeAId, "en") ||
    left.routeBId.localeCompare(right.routeBId, "en") ||
    left.point.x - right.point.x ||
    left.point.y - right.point.y
  );
}

function crossingsAmong(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  included: readonly RouteBranch[],
  changed?: ReadonlySet<string>,
): Crossing[] {
  const routes = [...included].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  const routeOrder = new Map(
    routes.map((route, index) => [route.id, index] as const),
  );
  const candidates: CrossingSegmentCandidate[] = routes
    .flatMap((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      return (geometry?.segments ?? []).map((segment) => ({
        route,
        routeOrder: routeOrder.get(route.id)!,
        segment,
        minX: Math.min(segment.from.x, segment.to.x),
        maxX: Math.max(segment.from.x, segment.to.x),
        minY: Math.min(segment.from.y, segment.to.y),
        maxY: Math.max(segment.from.y, segment.to.y),
      }));
    })
    .sort(
      (left, right) =>
        left.minX - right.minX ||
        left.maxX - right.maxX ||
        left.minY - right.minY ||
        left.routeOrder - right.routeOrder ||
        left.segment.address.segmentIndex - right.segment.address.segmentIndex,
    );
  const result: Crossing[] = [];
  const sharedPointByRoutePair = new Map<string, Point | null>();
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const right = candidates[rightIndex]!;
      if (right.minX > left.maxX) break;
      if (
        left.route.id === right.route.id ||
        right.minY > left.maxY ||
        right.maxY < left.minY ||
        (changed && !changed.has(left.route.id) && !changed.has(right.route.id))
      ) {
        continue;
      }
      const intersection = intersectSegments(
        left.segment.from,
        left.segment.to,
        right.segment.from,
        right.segment.to,
      );
      if (!intersection) continue;
      const routeA =
        left.routeOrder < right.routeOrder ? left.route : right.route;
      const routeB = routeA === left.route ? right.route : left.route;
      const pairKey = `${routeA.id}\0${routeB.id}`;
      let sharedPoint = sharedPointByRoutePair.get(pairKey);
      if (sharedPoint === undefined) {
        const shared = sharedExplicitEndpoint(routeA, routeB);
        sharedPoint = shared
          ? resolveEndpointPoint(document, resolver, shared)
          : null;
        sharedPointByRoutePair.set(pairKey, sharedPoint);
      }
      if (sharedPoint && samePoint(sharedPoint, intersection.point)) continue;
      result.push({
        routeAId: routeA.id,
        routeBId: routeB.id,
        netAId: routeA.netId,
        netBId: routeB.netId,
        point: intersection.point,
        kind: intersection.kind,
      });
    }
  }
  return result.sort(compareCrossings);
}

const reusableGeometry = new WeakMap<ResolvedRouteGeometry, boolean>();

function supportsLocalCrossings(route: ResolvedRouteGeometry): boolean {
  const cached = reusableGeometry.get(route);
  if (cached !== undefined) return cached;
  // Stable IDs admit arbitrary strings. Keep the original sweep for collation
  // ties and ambiguous endpoint keys (including bus member syntax). Its
  // shared endpoint resolves against the Document independently of geometry.
  const simpleEndpoint = ({
    endpoint,
  }: ResolvedRouteGeometry["endpointConnections"]["from"]) =>
    !endpoint.memberId &&
    (endpoint.kind === "junction"
      ? !endpoint.junctionId.includes(":")
      : !endpoint.instanceId.includes(":") && !endpoint.pinName.includes(":"));
  const supported =
    /^[a-zA-Z0-9._:-]+$/u.test(route.routeId) &&
    simpleEndpoint(route.endpointConnections.from) &&
    simpleEndpoint(route.endpointConnections.to) &&
    route.segments.every(({ from, to }) => {
      // queryBounds represents the maximum as an origin plus a span. If that
      // sum rounds inward, a touching segment could escape the local query.
      const bounds = segmentBounds(from, to);
      return (
        bounds.x + bounds.width >= Math.max(from.x, to.x) &&
        bounds.y + bounds.height >= Math.max(from.y, to.y)
      );
    });
  reusableGeometry.set(route, supported);
  return supported;
}

export interface CommittedCrossingSnapshot {
  document: SchematicDocument;
  resolver: SymbolResolver;
  geometry: ResolvedDocumentRoutingGeometry;
  crossings: Crossing[];
}

/** Unusual IDs and coordinates can still retain every record after blank placement.
 * With the original Route objects in their original order, the full sweep depends
 * only on resolved centerlines and the contact point of a shared authored endpoint.
 */
function unchangedSweepInputs(
  document: SchematicDocument,
  resolver: SymbolResolver,
  geometry: ResolvedDocumentRoutingGeometry,
  previous: CommittedCrossingSnapshot,
): boolean {
  if (
    previous.document.routes !== document.routes ||
    previous.geometry.routes.size !== geometry.routes.size
  )
    return false;
  let oldLookup, newLookup;
  for (const route of document.routes) {
    const before = previous.geometry.routes.get(route.id);
    const after = geometry.routes.get(route.id);
    if (!before || !after) {
      if (before !== after) return false;
      continue;
    }
    if (
      before !== after &&
      (before.centerline.length !== after.centerline.length ||
        before.centerline.some(
          (point, i) => !samePoint(point, after.centerline[i]!),
        ))
    )
      return false;
    if (supportsLocalCrossings(before) && supportsLocalCrossings(after))
      continue;
    // The indexed effective endpoint may alias another authored endpoint.
    // Shared-endpoint suppression in deriveCrossings resolves the authored
    // point directly, even when the indexed centerline stayed in place.
    oldLookup ??= buildEndpointObjectLookup(previous.document);
    newLookup ??= buildEndpointObjectLookup(document);
    for (const endpoint of [route.start, routeEnd(route)]) {
      const oldPoint = resolveEndpointPoint(
        previous.document,
        previous.resolver,
        endpoint,
        oldLookup,
      );
      const point = resolveEndpointPoint(
        document,
        resolver,
        endpoint,
        newLookup,
      );
      if (
        oldPoint !== point &&
        (!oldPoint || !point || !samePoint(oldPoint, point))
      )
        return false;
    }
  }
  return true;
}

/** Only for canonical immutable editor snapshots, after resolving both revisions. */
export function updateCommittedCrossings(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: Pick<DocumentDerivedContext, "routingGeometry" | "spatialIndex">,
  previous: CommittedCrossingSnapshot,
): Crossing[] {
  const { routingGeometry: geometry, spatialIndex: spatial } = context;
  const { crossings } = previous;
  const checkedSweep = () =>
    unchangedSweepInputs(document, resolver, geometry, previous)
      ? crossings
      : deriveCrossings(document, resolver, geometry);
  const changed = new Set<string>();
  for (const [id, route] of previous.geometry.routes) {
    if (!supportsLocalCrossings(route)) return checkedSweep();
    if (geometry.routes.get(id) !== route) changed.add(id);
  }
  for (const [id, route] of geometry.routes) {
    if (previous.geometry.routes.get(id) === route) continue;
    if (!supportsLocalCrossings(route)) return checkedSweep();
    changed.add(id);
  }
  if (!changed.size) return crossings;

  // Remove the old positions, even for deleted Routes with no new bounds.
  const retained = crossings.filter(
    (c) => !changed.has(c.routeAId) && !changed.has(c.routeBId),
  );
  const neighbors = new Set<string>();
  for (const id of changed) {
    const route = geometry.routes.get(id);
    if (!route) continue;
    neighbors.add(id);
    for (const segment of route.segments) {
      const bounds = segmentBounds(segment.from, segment.to);
      for (const neighbor of spatial.routeSegments.queryBounds(bounds))
        neighbors.add(neighbor.routeId);
    }
  }
  if (neighbors.size < 2) return retained;
  const local = crossingsAmong(
    document,
    resolver,
    geometry,
    document.routes.filter((r) => neighbors.has(r.id)),
    changed,
  );
  // Retained pairs and recalculated pairs are disjoint. The original sweep
  // still controls overlap orientation and stable ties within each Route pair.
  return local.length
    ? [...retained, ...local].sort(compareCrossings)
    : retained;
}
