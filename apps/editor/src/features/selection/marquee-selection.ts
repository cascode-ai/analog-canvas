import {
  isSchematicAnnotationVisible,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type { Point, Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  circleBoundaryIntersectsRect,
  pointInRect,
  polylineInRect,
  rectContainsRect,
  rectangleBoundaryIntersectsRect,
  rectsIntersect,
  segmentIntersectsRect,
} from "../../canvas/canvas-geometry";
import {
  annotationAnchor,
  annotationHitBox,
  instanceHitBox,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import {
  DEFAULT_SELECTION_FILTER,
  selectionFilterAllowsAnnotation,
  selectionFilterAllowsDrafting,
  type SelectionFilter,
} from "./selection-filter";

/**
 * Classic drafting-tool marquee semantics: dragging left-to-right is a
 * `window` (an object is selected only when fully contained), dragging
 * right-to-left is a `crossing` (touching the rectangle is enough).
 */
export type MarqueeMode = "window" | "crossing";

export function marqueeMode(start: Point, end: Point): MarqueeMode {
  return end.x < start.x ? "crossing" : "window";
}

export interface MarqueeSelectionSet {
  instanceIds: string[];
  routeIds: string[];
  junctionIds: string[];
  annotationIds: string[];
  draftingIds: string[];
}

/**
 * The complete marquee selection for one normalized rectangle. Only geometry
 * decides membership: a junction is its point in both modes; every other
 * object needs full containment under `window` and any overlap under
 * `crossing`. Route membership tests the actual centerline, never a bounding
 * box, so a distant bend cannot join the selection.
 */
export function marqueeSelection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeGeometryRecords: readonly RouteGeometryRecord[],
  styleProfile: SchematicStyleProfile,
  rect: Rect,
  mode: MarqueeMode,
  filter: SelectionFilter = DEFAULT_SELECTION_FILTER,
): MarqueeSelectionSet {
  const window = mode === "window";
  const boxSelected = (bounds: Rect): boolean =>
    window ? rectContainsRect(rect, bounds) : rectsIntersect(bounds, rect);

  return {
    instanceIds: (filter.instance ? document.instances : [])
      .filter((instance) => {
        const bounds = instanceHitBox(instance, resolver);
        return bounds !== null && boxSelected(bounds);
      })
      .map((instance) => instance.id),
    routeIds: (filter.route ? routeGeometryRecords : [])
      .filter(({ geometry }) =>
        window
          ? polylineInRect(geometry.centerline, rect)
          : geometry.centerline
              .slice(0, -1)
              .some((from, index) =>
                segmentIntersectsRect(
                  from,
                  geometry.centerline[index + 1]!,
                  rect,
                ),
              ),
      )
      .map(({ route }) => route.id),
    junctionIds: (filter.junction ? document.junctions : [])
      .filter((junction) => pointInRect(junction.position, rect))
      .map((junction) => junction.id),
    annotationIds: document.annotations
      .filter(
        (annotation) =>
          selectionFilterAllowsAnnotation(filter, annotation) &&
          isSchematicAnnotationVisible(document, annotation) &&
          boxSelected(
            annotationHitBox(
              document,
              annotation,
              annotationAnchor(
                document,
                resolver,
                annotation,
                routeGeometryRecords,
                styleProfile,
              ),
              routeGeometryRecords,
              styleProfile,
            ),
          ),
      )
      .map((annotation) => annotation.id),
    draftingIds: (document.drafting?.objects ?? [])
      .filter((object) => {
        if (!selectionFilterAllowsDrafting(filter, object)) return false;
        const geometry = resolveDraftingObjectGeometry(
          document,
          resolver,
          object,
        );
        if (geometry.kind === "rectangle") {
          // An outline rectangle is its border: a window must swallow all
          // four corners; a crossing must actually touch the boundary, so a
          // marquee wholly inside an empty box selects its contents only.
          return window
            ? geometry.corners.every((corner) => pointInRect(corner, rect))
            : rectangleBoundaryIntersectsRect(geometry.corners, rect);
        }
        if (geometry.kind === "circle") {
          const radius = geometry.radius;
          if (window) {
            return (
              pointInRect(
                {
                  x: geometry.center.x - radius,
                  y: geometry.center.y - radius,
                },
                rect,
              ) &&
              pointInRect(
                {
                  x: geometry.center.x + radius,
                  y: geometry.center.y + radius,
                },
                rect,
              )
            );
          }
          return circleBoundaryIntersectsRect(geometry.center, radius, rect);
        }
        return boxSelected(geometry.bounds);
      })
      .map((object) => object.id),
  };
}
