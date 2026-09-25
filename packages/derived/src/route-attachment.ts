import type { Point, Rotation, RouteAnnotationAttachment } from "@icm/model";

import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";

export interface ResolvedRouteAttachment {
  conductorPoint: Point;
  labelPoint: Point;
  rotation: Rotation;
}

/** Resolve a persisted route attachment against canonical route geometry. */
export function resolveRouteAttachment(
  geometry: ResolvedRouteGeometry,
  attachment: RouteAnnotationAttachment,
): ResolvedRouteAttachment | null {
  const segment = geometry.segments.find(
    (candidate) => candidate.address.legId === attachment.legId,
  );
  if (!segment) return null;
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const conductorPoint = {
    x: segment.from.x + dx * attachment.t,
    y: segment.from.y + dy * attachment.t,
  };
  const normal = { x: -dy / length, y: dx / length };
  const direction = attachment.direction === "forward" ? 1 : -1;
  const angle = Math.round(
    (Math.atan2(dy * direction, dx * direction) * 180) / Math.PI,
  );
  const rotation = ((angle % 360) + 360) % 360;
  if (![0, 45, 90, 135, 180, 225, 270, 315].includes(rotation)) {
    return null;
  }
  return {
    conductorPoint,
    labelPoint: {
      x: conductorPoint.x + normal.x * attachment.normalOffset,
      y: conductorPoint.y + normal.y * attachment.normalOffset,
    },
    rotation: rotation as Rotation,
  };
}

/**
 * The normal offset that puts a Net Label on its wire's standard side,
 * whichever way the wire was drawn. The label goes above a horizontal
 * segment and right of a vertical one. A slanted segment counts as the
 * nearer of the two. `resolveRouteAttachment` places the label at
 * conductor + normal × offset, with normal = (−dy, dx) / length.
 */
export function netLabelSideOffset(
  from: Point,
  to: Point,
  distance: number,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  return along > 0 ? -distance : distance;
}

/** Whether a segment runs closer to vertical than to horizontal. */
export function isNearVerticalSegment(from: Point, to: Point): boolean {
  return Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
}
