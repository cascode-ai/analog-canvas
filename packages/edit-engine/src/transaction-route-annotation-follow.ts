import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveRouteEditPath } from "./route-operations.js";
import {
  closestRouteMarkerAnchor,
  pointAtArcFraction,
  type NetLabelRouteAnchor,
  type RouteMarkerAnchor,
} from "./transaction-route-annotations.js";
import { snapPointToDocumentGrid } from "./transaction-preflight.js";

export function followNetLabelsOnChangedRoutes(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly NetLabelRouteAnchor[],
  changedRouteIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    if (
      !changedRouteIds.has(captured.routeId) ||
      changedObjectIds.has(captured.annotationId)
    ) {
      continue;
    }
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    const route = draft.routes.find(
      (candidate) => candidate.id === captured.routeId,
    );
    if (!annotation || annotation.kind !== "net-label" || !route) continue;
    const polyline = resolveRouteEditPath(draft, resolver, route);
    if (!polyline) continue;
    const segmentCount = polyline.points.length - 1;
    const attachment =
      segmentCount === captured.segmentCount &&
      captured.segmentIndex < segmentCount
        ? { segmentIndex: captured.segmentIndex, t: captured.t }
        : pointAtArcFraction(polyline.points, captured.arcFraction);
    if (!attachment) continue;
    const from = polyline.points[attachment.segmentIndex]!;
    const to = polyline.points[attachment.segmentIndex + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const anchor = {
      x: from.x + dx * attachment.t,
      y: from.y + dy * attachment.t,
    };
    const normal = { x: -dy / length, y: dx / length };
    const offset = {
      x: normal.x * captured.normalOffset,
      y: normal.y * captured.normalOffset,
    };
    if (annotation.anchor.kind !== "route") continue;
    annotation.anchor = {
      ...annotation.anchor,
      legId: route.legs[attachment.segmentIndex]!.id,
      t: attachment.t,
      // The captured offset is the persisted truth; rounding a re-derived
      // projection drifted the label toward the coarse grid on every
      // transaction. The fallback rounds on the 1-unit annotation pitch.
      normalOffset: captured.normalOffset,
      fallbackPosition: snapPointToDocumentGrid(
        { x: anchor.x + offset.x, y: anchor.y + offset.y },
        1,
      ),
    };
    changedObjectIds.add(annotation.id);
  }
}

export function followRouteMarkersOnChangedRoutes(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly RouteMarkerAnchor[],
  changedRouteIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    if (
      !changedRouteIds.has(captured.routeId) ||
      changedObjectIds.has(captured.annotationId)
    ) {
      continue;
    }
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    const route = draft.routes.find(
      (candidate) => candidate.id === captured.routeId,
    );
    if (!annotation || annotation.kind !== "route-marker" || !route) continue;
    const polyline = resolveRouteEditPath(draft, resolver, route);
    if (!polyline) continue;
    const segmentCount = polyline.points.length - 1;
    let attachment =
      segmentCount === captured.segmentCount &&
      captured.segmentIndex < segmentCount
        ? { segmentIndex: captured.segmentIndex, t: captured.t }
        : null;
    if (!attachment) {
      const nextStart = polyline.points[0]!;
      const nextEnd = polyline.points.at(-1)!;
      const startDelta = {
        x: nextStart.x - captured.routeStart.x,
        y: nextStart.y - captured.routeStart.y,
      };
      const endDelta = {
        x: nextEnd.x - captured.routeEnd.x,
        y: nextEnd.y - captured.routeEnd.y,
      };
      const expectedPosition =
        startDelta.x === endDelta.x && startDelta.y === endDelta.y
          ? {
              x: captured.position.x + startDelta.x,
              y: captured.position.y + startDelta.y,
            }
          : captured.position;
      const closest = closestRouteMarkerAnchor(
        polyline.points,
        expectedPosition,
        captured.direction,
      );
      attachment = closest
        ? { segmentIndex: closest.segmentIndex, t: closest.t }
        : null;
    }
    if (!attachment) continue;
    const from = polyline.points[attachment.segmentIndex]!;
    const to = polyline.points[attachment.segmentIndex + 1]!;
    const position = snapPointToDocumentGrid(
      {
        x: from.x + (to.x - from.x) * attachment.t,
        y: from.y + (to.y - from.y) * attachment.t,
      },
      1,
    );
    if (annotation.anchor.kind === "route") {
      annotation.anchor = {
        ...annotation.anchor,
        legId: route.legs[attachment.segmentIndex]!.id,
        t: attachment.t,
        fallbackPosition: position,
      };
    }
    changedObjectIds.add(annotation.id);
  }
}

export function remapRouteMarkersAfterSplit(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly RouteMarkerAnchor[],
  splitRouteIds: readonly string[],
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    const closest = splitRouteIds
      .flatMap((routeId) => {
        const route = draft.routes.find(
          (candidate) => candidate.id === routeId,
        );
        const polyline = route
          ? resolveRouteEditPath(draft, resolver, route)
          : null;
        if (!route || !polyline) return [];
        const attachment = closestRouteMarkerAnchor(
          polyline.points,
          captured.position,
          captured.direction,
        );
        return attachment ? [{ route, polyline, attachment }] : [];
      })
      .sort(
        (left, right) =>
          left.attachment.distanceSquared - right.attachment.distanceSquared ||
          left.route.id.localeCompare(right.route.id, "en"),
      )[0];
    if (!closest) continue;
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    if (!annotation || annotation.kind !== "route-marker") continue;
    const { segmentIndex, t } = closest.attachment;
    const from = closest.polyline.points[segmentIndex]!;
    const to = closest.polyline.points[segmentIndex + 1]!;
    const position = snapPointToDocumentGrid(
      {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      },
      1,
    );
    if (annotation.anchor.kind === "route") {
      annotation.anchor = {
        ...annotation.anchor,
        routeId: closest.route.id,
        legId: closest.route.legs[segmentIndex]!.id,
        t,
        fallbackPosition: position,
      };
    }
    changedObjectIds.add(annotation.id);
  }
}

/**
 * Retarget net-label route anchors onto the split products. Splitting hands
 * both halves fresh identities (or reuses one), so a label anchored to the
 * original Route would otherwise fail final validation and make a labelled
 * wire untappable. The captured conductor point picks the half; the
 * persisted normal offset survives verbatim.
 */
export function remapNetLabelsAfterSplit(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  anchors: readonly NetLabelRouteAnchor[],
  splitRouteIds: readonly string[],
  changedObjectIds: Set<string>,
): void {
  for (const captured of anchors) {
    const annotation = draft.annotations.find(
      (candidate) => candidate.id === captured.annotationId,
    );
    if (
      !annotation ||
      (annotation.kind !== "net-label" && annotation.kind !== "power-label") ||
      annotation.anchor.kind !== "route"
    ) {
      continue;
    }
    const closest = splitRouteIds
      .flatMap((routeId) => {
        const route = draft.routes.find(
          (candidate) => candidate.id === routeId,
        );
        const polyline = route
          ? resolveRouteEditPath(draft, resolver, route)
          : null;
        if (!route || !polyline) return [];
        const lengths = polyline.points.slice(0, -1).map((from, index) => {
          const to = polyline.points[index + 1]!;
          return Math.hypot(to.x - from.x, to.y - from.y);
        });
        let best: {
          segmentIndex: number;
          t: number;
          distanceSquared: number;
        } | null = null;
        for (const [segmentIndex, length] of lengths.entries()) {
          if (length === 0) continue;
          const from = polyline.points[segmentIndex]!;
          const to = polyline.points[segmentIndex + 1]!;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((captured.position.x - from.x) * dx +
                (captured.position.y - from.y) * dy) /
                (length * length),
            ),
          );
          const px = from.x + dx * t;
          const py = from.y + dy * t;
          const distanceSquared =
            (captured.position.x - px) ** 2 + (captured.position.y - py) ** 2;
          if (!best || distanceSquared < best.distanceSquared) {
            best = { segmentIndex, t, distanceSquared };
          }
        }
        return best ? [{ route, polyline, best }] : [];
      })
      .sort(
        (left, right) =>
          left.best.distanceSquared - right.best.distanceSquared ||
          left.route.id.localeCompare(right.route.id, "en"),
      )[0];
    if (!closest) continue;
    const from = closest.polyline.points[closest.best.segmentIndex]!;
    const to = closest.polyline.points[closest.best.segmentIndex + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const normal = { x: -dy / length, y: dx / length };
    const anchorPoint = {
      x: from.x + dx * closest.best.t,
      y: from.y + dy * closest.best.t,
    };
    annotation.anchor = {
      ...annotation.anchor,
      routeId: closest.route.id,
      legId: closest.route.legs[closest.best.segmentIndex]!.id,
      t: closest.best.t,
      fallbackPosition: snapPointToDocumentGrid(
        {
          x: anchorPoint.x + normal.x * captured.normalOffset,
          y: anchorPoint.y + normal.y * captured.normalOffset,
        },
        1,
      ),
    };
    changedObjectIds.add(annotation.id);
  }
}
