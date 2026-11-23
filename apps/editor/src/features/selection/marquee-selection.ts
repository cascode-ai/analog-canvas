import {
  arcPointAt,
  isSchematicAnnotationVisible,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type {
  DocumentDerivedContext,
  SchematicStyleProfile,
} from "@icm/derived";
import { polylineIntersectsRect } from "@icm/model";
import type { Point, Rect, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { VisualSelection } from "./visual-selection";

import {
  circleBoundaryIntersectsRect,
  pointInRect,
  polylineInRect,
  rectContainsRect,
  rectangleBoundaryIntersectsRect,
  rectsIntersect,
} from "../../canvas/canvas-geometry";
import {
  annotationHitBox,
  instanceHitBox,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import {
  createSelectionPolicy,
  DEFAULT_SELECTION_FILTER,
  type SelectionPolicy,
} from "./selection-filter";

export interface MarqueeCandidates {
  instances: readonly SchematicDocument["instances"][number][];
  junctions: readonly SchematicDocument["junctions"][number][];
  annotations: readonly SchematicDocument["annotations"][number][];
  drafting: readonly NonNullable<
    SchematicDocument["drafting"]
  >["objects"][number][];
  routeGeometryRecords: readonly RouteGeometryRecord[];
}

/**
 * Classic drafting-tool marquee semantics: dragging left-to-right is a
 * `window` (an object is selected only when fully contained), dragging
 * right-to-left is a `crossing` (touching the rectangle is enough).
 */
export type MarqueeMode = "window" | "crossing";

export function marqueeMode(start: Point, end: Point): MarqueeMode {
  return end.x < start.x ? "crossing" : "window";
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
  policy: SelectionPolicy = createSelectionPolicy(
    document,
    DEFAULT_SELECTION_FILTER,
  ),
  read?: Pick<
    DocumentDerivedContext,
    "routingGeometry" | "logicalNetResolution"
  >,
  candidates?: MarqueeCandidates,
): VisualSelection {
  const window = mode === "window";
  const boxSelected = (bounds: Rect): boolean =>
    window ? rectContainsRect(rect, bounds) : rectsIntersect(bounds, rect);
  // One read for this query, never a revision cache on a mutable caller.
  let routing = read?.routingGeometry;
  let logical = read?.logicalNetResolution;
  const routingRead = () =>
    (routing ??= resolveDocumentRoutingGeometry(document, resolver));
  const logicalRead = () => (logical ??= resolveDocumentLogicalNets(document));

  return {
    instanceIds: (policy.allowsClass("instance", "select")
      ? (candidates?.instances ?? document.instances)
      : []
    )
      .filter((instance) => {
        if (
          !policy.allowsCanvasHit(
            { kind: "instance", id: instance.id },
            "select",
          )
        )
          return false;
        const bounds = instanceHitBox(instance, resolver);
        return bounds !== null && boxSelected(bounds);
      })
      .map((instance) => instance.id),
    routeIds: (policy.allowsClass("route", "select")
      ? (candidates?.routeGeometryRecords ?? routeGeometryRecords)
      : []
    )
      .filter(
        ({ route, geometry }) =>
          policy.allowsCanvasHit({ kind: "route", id: route.id }, "select") &&
          (window
            ? polylineInRect(geometry.centerline, rect)
            : polylineIntersectsRect(geometry.centerline, rect)),
      )
      .map(({ route }) => route.id),
    junctionIds: (policy.allowsClass("junction", "select")
      ? (candidates?.junctions ?? document.junctions)
      : []
    )
      .filter(
        (junction) =>
          policy.allowsCanvasHit(
            { kind: "junction", id: junction.id },
            "select",
          ) && pointInRect(junction.position, rect),
      )
      .map((junction) => junction.id),
    annotationIds: (candidates?.annotations ?? document.annotations)
      .filter(
        (annotation) =>
          policy.allowsAnnotation(annotation, "select") &&
          isSchematicAnnotationVisible(
            document,
            annotation,
            logicalRead(),
            undefined,
            resolver,
          ) &&
          boxSelected(
            annotationHitBox(
              document,
              resolver,
              annotation,
              routeGeometryRecords,
              styleProfile,
              routingRead(),
              logicalRead(),
            ),
          ),
      )
      .map((annotation) => annotation.id),
    draftingIds: (candidates?.drafting ?? document.drafting?.objects ?? [])
      .filter((object) => {
        if (!policy.allowsDrafting(object, "select")) return false;
        const geometry = resolveDraftingObjectGeometry(
          document,
          resolver,
          object,
          routingRead(),
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
        if (geometry.kind === "arc") {
          // An arc is its stroke: a window swallows all of it; a crossing
          // touches some of it.
          const steps = Math.max(
            4,
            Math.ceil(Math.abs(geometry.sweepAngle) / 5),
          );
          const samples = Array.from({ length: steps + 1 }, (_, index) =>
            arcPointAt(geometry, index / steps),
          );
          return window
            ? samples.every((point) => pointInRect(point, rect))
            : samples.some((point) => pointInRect(point, rect));
        }
        return boxSelected(geometry.bounds);
      })
      .map((object) => object.id),
  };
}
