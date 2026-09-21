import {
  resolveAnchorTargetPosition,
  resolveRouteAttachment,
  resolveVisualAnchor,
  type ResolvedRouteGeometry,
} from "@icm/derived";
import type {
  Annotation,
  DerivedPoint,
  Point,
  RouteBranch,
  SchematicDocument,
} from "@icm/model";
import { snapGridPoint } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  dragRouteAttachmentAtPoint,
  effectiveRouteAttachment,
  isRoutedMarker,
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

/**
 * Resolve the visual point from which a label drag starts. Single-label and
 * composite movement must use the same origin or an object/route anchor will
 * preview from one point and commit from another.
 */
export function annotationDragPosition(
  { document, resolver, routeGeometryRecords }: AnnotationDragGeometryContext,
  annotation: Annotation,
): Point {
  const currentAttachment = effectiveRouteAttachment(annotation);
  const record = currentAttachment
    ? routeGeometryRecords.find(
        ({ route }) => route.id === currentAttachment.routeId,
      )
    : undefined;
  const markerPlacement =
    record && currentAttachment
      ? resolveRouteAttachment(record.geometry, currentAttachment)
      : null;
  if (isRoutedMarker(annotation) && markerPlacement) {
    return markerPlacement.labelPoint;
  }
  return resolveVisualAnchor(document, resolver, annotation.anchor).position;
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
    // The Route anchor identifies the electrical owner at creation time, but
    // it cannot represent an arbitrary text position: it only stores distance
    // along one segment and an offset normal to it. Dragging beyond either end
    // of a short wire therefore snapped the label back. The Net binding is the
    // electrical truth, so after direct placement the label can use a free
    // visual anchor without changing which Net it names.
    return {
      ...annotation,
      anchor: {
        kind: "free",
        position: snapGridPoint(candidate, context.annotationGrid),
      },
    };
  }

  // Attachment records ownership, not a limit on where its label may be drawn.
  const position = snapGridPoint(candidate, context.annotationGrid);
  if (annotation.anchor.kind === "object") {
    // Rendering resolves an object anchor as target position + localOffset, so
    // localOffset is what a drag has to carry. Ask the resolver's own lookup
    // rather than only for an Instance: a power rail's label hangs off its
    // Junction, and a drafting label off its rectangle, and updating just
    // fallbackPosition would leave both rendering where they already were.
    const target = resolveAnchorTargetPosition(
      document,
      annotation.anchor.objectId,
    );
    if (target) {
      return {
        ...annotation,
        anchor: {
          ...annotation.anchor,
          localOffset: {
            x: position.x - target.x,
            y: position.y - target.y,
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
