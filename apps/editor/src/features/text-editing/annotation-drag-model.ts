import {
  resolveAnchorTargetPosition,
  resolveRouteAttachment,
  resolveVisualAnchor,
  type ResolvedRouteGeometry,
  type ResolvedDocumentRoutingGeometry,
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
  routingGeometry?: ResolvedDocumentRoutingGeometry;
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
  {
    document,
    resolver,
    routeGeometryRecords,
    routingGeometry,
  }: AnnotationDragGeometryContext,
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
  return resolveVisualAnchor(
    document,
    resolver,
    annotation.anchor,
    routingGeometry,
  ).position;
}

/** How far from its own wire a dropped Net Label still stands on it. */
const NET_LABEL_KEEP_ON_WIRE = 20;

/**
 * Where on its own Route a Net Label dropped at `position` stands: the
 * segment its point projects onto within the segment's length, and the
 * signed distance across it, if that is at most NET_LABEL_KEEP_ON_WIRE.
 * The projection is the exact inverse of how a Route anchor resolves, so
 * the label draws where it was dropped.
 */
function netLabelOnItsWire(
  routeGeometryRecords: AnnotationDragGeometryContext["routeGeometryRecords"],
  routeId: string,
  position: Point,
): { legId: string; t: number; normalOffset: number } | null {
  const record = routeGeometryRecords.find(({ route }) => route.id === routeId);
  if (!record) return null;
  let best: { legId: string; t: number; normalOffset: number } | null = null;
  // An anchor addresses a leg by its first segment, as resolveRouteAttachment
  // reads it back.
  const seen = new Set<string>();
  for (const { address, from, to } of record.geometry.segments) {
    if (seen.has(address.legId)) continue;
    seen.add(address.legId);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const t =
      ((position.x - from.x) * dx + (position.y - from.y) * dy) / lengthSquared;
    if (t < 0 || t > 1) continue;
    const length = Math.sqrt(lengthSquared);
    const normalOffset =
      (position.x - from.x) * (-dy / length) +
      (position.y - from.y) * (dx / length);
    if (Math.abs(normalOffset) > NET_LABEL_KEEP_ON_WIRE) continue;
    if (!best || Math.abs(normalOffset) < Math.abs(best.normalOffset))
      best = { legId: address.legId, t, normalOffset };
  }
  return best;
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
    const position = snapGridPoint(candidate, context.annotationGrid);
    // Dropped beside its own wire, the label stays on it: closer or further,
    // along it, or across to the other side, it keeps following that wire
    // (#1300).
    const kept = netLabelOnItsWire(
      routeGeometryRecords,
      annotation.anchor.routeId,
      position,
    );
    if (kept)
      return {
        ...annotation,
        anchor: {
          ...annotation.anchor,
          ...kept,
          fallbackPosition: position,
        },
      };
    // The Route anchor identifies the electrical owner at creation time, but
    // it cannot represent an arbitrary text position: it only stores distance
    // along one segment and an offset normal to it. Dragging beyond either end
    // of a short wire therefore snapped the label back. The Net binding is the
    // electrical truth, so after direct placement the label can use a free
    // visual anchor without changing which Net it names.
    return {
      ...annotation,
      anchor: { kind: "free", position },
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
