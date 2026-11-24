import type { Point, SchematicDocument } from "@icm/model";

import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";
import { segmentBounds, type DocumentSpatialIndex } from "./spatial-index.js";

type DrawnRoute = {
  route: SchematicDocument["routes"][number];
  geometry: ResolvedRouteGeometry;
};

function spansOverlap(a: number, b: number, c: number, d: number) {
  const start = Math.max(Math.min(a, b), Math.min(c, d));
  const end = Math.min(Math.max(a, b), Math.max(c, d));
  return start < end;
}

function sharesCollinearSpan(left: readonly Point[], right: readonly Point[]) {
  for (let i = 1; i < left.length; i++) {
    const a = left[i - 1]!;
    const b = left[i]!;
    for (let j = 1; j < right.length; j++) {
      const c = right[j - 1]!;
      const d = right[j]!;
      // Only a positive-length shared horizontal or vertical span is overlap.
      if (
        a.y === b.y &&
        c.y === d.y &&
        a.y === c.y &&
        spansOverlap(a.x, b.x, c.x, d.x)
      )
        return true;
      if (
        a.x === b.x &&
        c.x === d.x &&
        a.x === c.x &&
        spansOverlap(a.y, b.y, c.y, d.y)
      )
        return true;
    }
  }
  return false;
}

function* sameNetPairs(
  routes: readonly DrawnRoute[],
  segments: DocumentSpatialIndex["routeSegments"] | undefined,
): Generator<readonly [DrawnRoute, DrawnRoute]> {
  if (!segments) {
    // Exhaustive comparison remains the independent broad-phase oracle.
    for (const [i, left] of routes.entries())
      for (let j = i + 1; j < routes.length; j++)
        if (left.route.netId === routes[j]!.route.netId)
          yield [left, routes[j]!];
    return;
  }
  const positionsByNet = new Map<string, Map<string, number>>();
  for (const [i, { route }] of routes.entries()) {
    let positions = positionsByNet.get(route.netId);
    if (!positions) {
      positions = new Map();
      positionsByNet.set(route.netId, positions);
    }
    if (!positions.has(route.id)) positions.set(route.id, i);
  }
  for (const [i, left] of routes.entries()) {
    const positions = positionsByNet.get(left.route.netId)!;
    if (positions.size < 2) continue;
    // Several legs can intersect the same Route. Compare it once and in the
    // same drawing order as the exhaustive check, independent of bucket order.
    const rightIndices = new Set<number>();
    for (const { from, to } of left.geometry.segments) {
      for (const hit of segments.queryBounds(segmentBounds(from, to))) {
        if (hit.netId !== left.route.netId) continue;
        const j = positions.get(hit.routeId);
        if (j !== undefined && j > i) rightIndices.add(j);
      }
    }
    for (const j of [...rightIndices].sort((a, b) => a - b))
      yield [left, routes[j]!];
  }
}

/** Distinct Routes sharing a drawn span, grouped by physical Base Net. */
export function sameNetRouteOverlaps(
  routes: readonly DrawnRoute[],
  segments: DocumentSpatialIndex["routeSegments"] | undefined,
) {
  const overlaps = new Map<string, Set<string>>();
  for (const [left, right] of sameNetPairs(routes, segments)) {
    if (
      !sharesCollinearSpan(left.geometry.centerline, right.geometry.centerline)
    )
      continue;
    const ids = overlaps.get(left.route.netId) ?? new Set<string>();
    ids.add(left.route.id);
    ids.add(right.route.id);
    overlaps.set(left.route.netId, ids);
  }
  return overlaps;
}
