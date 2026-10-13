import { buildBoundsSpatialIndex, type BoundsSpatialIndex } from "@icm/derived";
import type { Point, Rect } from "@icm/model";
import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import type { SnapAnchor } from "../../snap/engine";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";

interface Segment {
  route: RouteGeometryRecord["route"];
  from: Point;
  to: Point;
  segmentIndex: number;
  order: number;
}

const CELL = 80;
function boundedQuery(bounds: Rect) {
  const coordinates = [
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height,
  ].map((v) => Math.floor(v / CELL));
  return (
    coordinates.every(Number.isSafeInteger) &&
    (coordinates[2]! - coordinates[0]! + 1) *
      (coordinates[3]! - coordinates[1]! + 1) <=
      4096
  );
}

/** Nearest conductor projections in the original route/segment order. Long
 * or exceptional geometry stays in a bounded linear fallback, never billions
 * of spatial buckets. Filtering movement ownership belongs to the caller. */
export function prepareMoveRouteTargets(
  records: readonly RouteGeometryRecord[],
) {
  const entries = records.flatMap(({ route, geometry }, order) =>
    geometry.centerline.slice(0, -1).map((from, segmentIndex) => {
      const to = geometry.centerline[segmentIndex + 1]!;
      // The existing interpolation can round an endpoint slightly outside its
      // mathematical box. Pad only the broad phase; exact distance is unchanged.
      const padding =
        Math.max(
          1,
          Math.abs(from.x),
          Math.abs(from.y),
          Math.abs(to.x),
          Math.abs(to.y),
        ) *
        Number.EPSILON *
        16;
      return {
        bounds: {
          x: Math.min(from.x, to.x) - padding,
          y: Math.min(from.y, to.y) - padding,
          width: Math.abs(to.x - from.x) + padding * 2,
          height: Math.abs(to.y - from.y) + padding * 2,
        },
        value: { route, from, to, segmentIndex, order },
      };
    }),
  );
  const wide = entries
    .filter((e) => !boundedQuery(e.bounds))
    .map((e) => e.value);
  const index: BoundsSpatialIndex<Segment> = buildBoundsSpatialIndex(
    entries.filter((e) => boundedQuery(e.bounds)),
    CELL,
  );
  return (
    moving: SnapAnchor,
    delta: Point,
    tolerance: number,
  ): SnapAnchor[] => {
    if (moving.electrical?.kind !== "endpoint") return [];
    const point = { x: moving.point.x + delta.x, y: moving.point.y + delta.y };
    const bounds = {
      x: point.x - tolerance,
      y: point.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    };
    const candidates =
      Number.isFinite(tolerance) && tolerance >= 0 && boundedQuery(bounds)
        ? [...index.queryBounds(bounds), ...wide].sort(
            (a, b) => a.order - b.order || a.segmentIndex - b.segmentIndex,
          )
        : entries.map((e) => e.value);
    return candidates.flatMap((s) => {
      const closest = closestPointOnSegment(point, s.from, s.to);
      if (Math.hypot(closest.x - point.x, closest.y - point.y) > tolerance)
        return [];
      return [
        {
          id: `move-route:${moving.id}:${s.route.id}:${s.segmentIndex}`,
          point: closest,
          kind: "route" as const,
          acceptsMovingAnchorId: moving.id,
          electrical: {
            kind: "route" as const,
            routeId: s.route.id,
            segmentIndex: s.segmentIndex,
            netId: s.route.netId,
          },
        },
      ];
    });
  };
}
