import type { ResolvedRouteGeometry } from "@icm/derived";
import type {
  Annotation,
  DerivedPoint,
  Point,
  RouteBranch,
  SchematicDocument,
} from "@icm/model";
import { snapGridPoint } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { clamp, closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  dragNetLabelAttachmentAtPoint,
  dragRouteAttachmentAtPoint,
  effectiveRouteAttachment,
  isRoutedMarker,
  NET_LABEL_MAX_NORMAL_OFFSET,
} from "../wiring/route-interaction-geometry";

export interface AnnotationDragGeometryContext {
  document: SchematicDocument;
  /** Rounding pitch for dragged labels; 1-unit precision is valid. */
  annotationGrid: number;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly {
    route: RouteBranch;
    geometry: ResolvedRouteGeometry;
  }[];
}

function constrainAnnotationPosition(
  {
    document,
    annotationGrid,
    resolver,
    routeGeometryRecords,
  }: AnnotationDragGeometryContext,
  annotation: Annotation,
  candidate: DerivedPoint,
): Point {
  if (
    (annotation.kind === "instance-label" ||
      annotation.kind === "instance-value") &&
    annotation.anchor.kind === "object"
  ) {
    const anchor = annotation.anchor;
    const instance = document.instances.find(
      (item) => item.id === anchor.objectId,
    );
    if (instance?.placement) {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      const radius = Math.ceil(
        Math.max(
          resolved?.definition.viewBox.width ?? 60,
          resolved?.definition.viewBox.height ?? 60,
        ) /
          2 +
          30,
      );
      return snapGridPoint(
        {
          x: clamp(
            candidate.x,
            instance.placement.position.x - radius,
            instance.placement.position.x + radius,
          ),
          y: clamp(
            candidate.y,
            instance.placement.position.y - radius,
            instance.placement.position.y + radius,
          ),
        },
        annotationGrid,
      );
    }
  }
  if (annotation.kind === "net-label" && annotation.netId) {
    const candidates = routeGeometryRecords
      .filter(({ route }) => route.netId === annotation.netId)
      .flatMap(({ geometry }) =>
        geometry.centerline
          .slice(0, -1)
          .map((from, index) =>
            closestPointOnSegment(
              candidate,
              from,
              geometry.centerline[index + 1]!,
            ),
          ),
      );
    const closest = candidates.sort((left, right) => {
      const leftDistance =
        (left.x - candidate.x) ** 2 + (left.y - candidate.y) ** 2;
      const rightDistance =
        (right.x - candidate.x) ** 2 + (right.y - candidate.y) ** 2;
      return leftDistance - rightDistance;
    })[0];
    if (closest) {
      return snapGridPoint(
        {
          x: clamp(
            candidate.x,
            closest.x - NET_LABEL_MAX_NORMAL_OFFSET,
            closest.x + NET_LABEL_MAX_NORMAL_OFFSET,
          ),
          y: clamp(
            candidate.y,
            closest.y - NET_LABEL_MAX_NORMAL_OFFSET,
            closest.y + NET_LABEL_MAX_NORMAL_OFFSET,
          ),
        },
        annotationGrid,
      );
    }
  }
  return snapGridPoint(candidate, annotationGrid);
}

/** Resolve the persisted annotation produced by one completed drag gesture. */
export function draggedAnnotationAtPosition(
  context: AnnotationDragGeometryContext,
  annotation: Annotation,
  candidate: DerivedPoint,
): Annotation {
  const { document, routeGeometryRecords } = context;
  const currentAttachment = effectiveRouteAttachment(annotation);
  if (isRoutedMarker(annotation) && currentAttachment) {
    const attached = dragRouteAttachmentAtPoint(
      routeGeometryRecords,
      candidate,
      currentAttachment,
    );
    if (!attached) return annotation;
    const anchor =
      annotation.anchor.kind === "route"
        ? {
            ...annotation.anchor,
            legId: attached.routeAttachment.legId,
            t: attached.routeAttachment.t,
            normalOffset: attached.routeAttachment.normalOffset,
            direction: attached.routeAttachment.direction,
            fallbackPosition: attached.position,
          }
        : annotation.anchor;
    return { ...annotation, anchor };
  }
  if (annotation.kind === "net-label" && annotation.anchor.kind === "route") {
    const attached = dragNetLabelAttachmentAtPoint(
      routeGeometryRecords,
      candidate,
      annotation.anchor.routeId,
    );
    if (!attached) return annotation;
    return {
      ...annotation,
      anchor: {
        ...annotation.anchor,
        legId: attached.legId,
        t: attached.t,
        normalOffset: attached.normalOffset,
        fallbackPosition: attached.labelPosition,
      },
    };
  }

  const position = constrainAnnotationPosition(context, annotation, candidate);
  if (annotation.anchor.kind === "object") {
    const anchor = annotation.anchor;
    const instance = document.instances.find(
      (item) => item.id === anchor.objectId,
    );
    if (instance?.placement) {
      return {
        ...annotation,
        anchor: {
          ...annotation.anchor,
          localOffset: {
            x: position.x - instance.placement.position.x,
            y: position.y - instance.placement.position.y,
          },
          fallbackPosition: position,
        },
      };
    }
  }
  return {
    ...annotation,
    anchor:
      annotation.anchor.kind === "free"
        ? { kind: "free", position }
        : { ...annotation.anchor, fallbackPosition: position },
  };
}
