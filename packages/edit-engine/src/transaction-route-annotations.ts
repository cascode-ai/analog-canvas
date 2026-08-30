import type { Annotation, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveRouteEditPath } from "./route-operations.js";

export interface NetLabelRouteAnchor {
  annotationId: string;
  routeId: string;
  segmentIndex: number;
  segmentCount: number;
  t: number;
  normalOffset: number;
  arcFraction: number;
  /** Conductor point of the anchor at capture time (world coordinates). */
  position: Point;
}

export interface RouteMarkerAnchor {
  annotationId: string;
  routeId: string;
  segmentIndex: number;
  segmentCount: number;
  t: number;
  position: Point;
  direction: Point;
  routeStart: Point;
  routeEnd: Point;
}

export function closestRouteMarkerAnchor(
  points: readonly Point[],
  position: Point,
  preferredDirection: Point,
): { segmentIndex: number; t: number; distanceSquared: number } | null {
  const candidates = points.slice(0, -1).flatMap((from, segmentIndex) => {
    const to = points[segmentIndex + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return [];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          lengthSquared,
      ),
    );
    const anchor = { x: from.x + dx * t, y: from.y + dy * t };
    const direction = { x: Math.sign(dx), y: Math.sign(dy) };
    return [
      {
        segmentIndex,
        t,
        distanceSquared:
          (position.x - anchor.x) ** 2 + (position.y - anchor.y) ** 2,
        directionPenalty:
          direction.x === preferredDirection.x &&
          direction.y === preferredDirection.y
            ? 0
            : direction.x === -preferredDirection.x &&
                direction.y === -preferredDirection.y
              ? 1
              : 2,
      },
    ];
  });
  const closest = candidates.sort(
    (left, right) =>
      left.distanceSquared - right.distanceSquared ||
      left.directionPenalty - right.directionPenalty ||
      left.segmentIndex - right.segmentIndex,
  )[0];
  return closest
    ? {
        segmentIndex: closest.segmentIndex,
        t: closest.t,
        distanceSquared: closest.distanceSquared,
      }
    : null;
}

function routeMarkerAttachment(annotation: Annotation) {
  if (annotation.kind !== "route-marker") return null;
  if (annotation.anchor.kind === "route") {
    return {
      routeId: annotation.anchor.routeId,
      legId: annotation.anchor.legId,
      t: annotation.anchor.t,
      direction: annotation.anchor.direction,
      normalOffset: annotation.anchor.normalOffset,
    };
  }
  return null;
}

function closestRouteAnchor(
  points: readonly Point[],
  position: Point,
):
  | (Omit<
      NetLabelRouteAnchor,
      "annotationId" | "routeId" | "segmentCount" | "position"
    > & {
      distanceSquared: number;
    })
  | null {
  const lengths = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (totalLength === 0) return null;
  let traversed = 0;
  const candidates = lengths.flatMap((length, segmentIndex) => {
    const from = points[segmentIndex]!;
    const to = points[segmentIndex + 1]!;
    if (length === 0) return [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          (length * length),
      ),
    );
    const anchor = { x: from.x + dx * t, y: from.y + dy * t };
    const delta = {
      x: position.x - anchor.x,
      y: position.y - anchor.y,
    };
    const candidate = {
      segmentIndex,
      t,
      normalOffset: delta.x * (-dy / length) + delta.y * (dx / length),
      arcFraction: (traversed + t * length) / totalLength,
      distanceSquared: delta.x * delta.x + delta.y * delta.y,
    };
    traversed += length;
    return [candidate];
  });
  return (
    candidates.sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.segmentIndex - right.segmentIndex,
    )[0] ?? null
  );
}

export function captureNetLabelRouteAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeIds?: ReadonlySet<string>,
): NetLabelRouteAnchor[] {
  const polylines = document.routes.flatMap((route) => {
    if (routeIds && !routeIds.has(route.id)) return [];
    const polyline = resolveRouteEditPath(document, resolver, route);
    return polyline ? [{ route, polyline }] : [];
  });
  return document.annotations.flatMap((annotation) => {
    const annotationAnchor = annotation.anchor;
    if (
      (annotation.kind !== "net-label" && annotation.kind !== "power-label") ||
      annotationAnchor.kind !== "route"
    ) {
      return [];
    }
    const entry = polylines.find(
      ({ route }) => route.id === annotationAnchor.routeId,
    );
    if (!entry) return [];
    // Persisted-first: the stored legId/t/normalOffset are the anchor's
    // source of truth. Re-projecting from the grid-snapped fallbackPosition
    // quantized the anchor a little further on every routing transaction.
    const legIndex = entry.route.legs.findIndex(
      (leg) => leg.id === annotationAnchor.legId,
    );
    if (legIndex >= 0 && legIndex < entry.polyline.points.length - 1) {
      const from = entry.polyline.points[legIndex]!;
      const to = entry.polyline.points[legIndex + 1]!;
      return [
        {
          annotationId: annotation.id,
          routeId: entry.route.id,
          segmentIndex: legIndex,
          segmentCount: entry.polyline.points.length - 1,
          t: annotationAnchor.t,
          normalOffset: annotationAnchor.normalOffset,
          arcFraction: arcFractionAt(
            entry.polyline.points,
            legIndex,
            annotationAnchor.t,
          ),
          position: {
            x: from.x + (to.x - from.x) * annotationAnchor.t,
            y: from.y + (to.y - from.y) * annotationAnchor.t,
          },
        },
      ];
    }
    const anchor = closestRouteAnchor(
      entry.polyline.points,
      annotationAnchor.fallbackPosition,
    );
    if (!anchor) return [];
    const { distanceSquared: _distanceSquared, ...rest } = anchor;
    const from = entry.polyline.points[rest.segmentIndex]!;
    const to = entry.polyline.points[rest.segmentIndex + 1]!;
    return [
      {
        ...rest,
        annotationId: annotation.id,
        routeId: entry.route.id,
        segmentCount: entry.polyline.points.length - 1,
        position: {
          x: from.x + (to.x - from.x) * rest.t,
          y: from.y + (to.y - from.y) * rest.t,
        },
      },
    ];
  });
}

function arcFractionAt(
  points: readonly Point[],
  segmentIndex: number,
  t: number,
): number {
  const lengths = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return 0;
  const before = lengths
    .slice(0, segmentIndex)
    .reduce((sum, length) => sum + length, 0);
  return (before + (lengths[segmentIndex] ?? 0) * t) / total;
}

export function captureRouteMarkerAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeIds?: ReadonlySet<string>,
): RouteMarkerAnchor[] {
  return document.annotations.flatMap((annotation) => {
    const attachment = routeMarkerAttachment(annotation);
    if (!attachment) return [];
    if (routeIds && !routeIds.has(attachment.routeId)) return [];
    const route = document.routes.find(
      (candidate) => candidate.id === attachment.routeId,
    );
    if (!route) return [];
    const polyline = resolveRouteEditPath(document, resolver, route);
    if (!polyline) return [];
    const segmentIndex = route.legs.findIndex(
      (leg) => leg.id === attachment.legId,
    );
    if (segmentIndex < 0) return [];
    const from = polyline.points[segmentIndex];
    const to = polyline.points[segmentIndex + 1];
    const routeStart = polyline.points[0];
    const routeEnd = polyline.points.at(-1);
    if (!from || !to || !routeStart || !routeEnd) return [];
    return [
      {
        annotationId: annotation.id,
        routeId: route.id,
        segmentIndex,
        segmentCount: polyline.points.length - 1,
        t: attachment.t,
        position: {
          x: from.x + (to.x - from.x) * attachment.t,
          y: from.y + (to.y - from.y) * attachment.t,
        },
        direction: { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) },
        routeStart,
        routeEnd,
      },
    ];
  });
}

export function pointAtArcFraction(
  points: readonly Point[],
  fraction: number,
): { segmentIndex: number; t: number } | null {
  const lengths = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]!;
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return null;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let traversed = 0;
  for (const [segmentIndex, length] of lengths.entries()) {
    if (length === 0) continue;
    if (traversed + length >= target || segmentIndex === lengths.length - 1) {
      return {
        segmentIndex,
        t: Math.max(0, Math.min(1, (target - traversed) / length)),
      };
    }
    traversed += length;
  }
  return null;
}
