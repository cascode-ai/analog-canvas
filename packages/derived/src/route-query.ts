import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointKey, resolveEndpointPoint } from "./endpoint.js";
import {
  intersectSegments,
  pointOnSegment,
  projectPointToSegment,
} from "./segment-geometry.js";

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

export function findRouteSegmentsAtPoint(
  geometry: ResolvedDocumentRoutingGeometry,
  point: Point,
): RouteSegmentAddress[] {
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
  const routes = [...document.routes].sort((left, right) =>
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
        right.maxY < left.minY
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
  return result.sort(
    (left, right) =>
      left.routeAId.localeCompare(right.routeAId, "en") ||
      left.routeBId.localeCompare(right.routeBId, "en") ||
      left.point.x - right.point.x ||
      left.point.y - right.point.y,
  );
}
