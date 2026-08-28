import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { SchematicEdit } from "@icm/edit-engine";
import { resolveRouteAttachment } from "@icm/derived";
import {
  snapGridPoint,
  type Annotation,
  type DerivedPoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../../canvas/canvas-drag-visual";
import {
  effectiveRouteAttachment,
  isRoutedMarker,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import { draggedAnnotationAtPosition } from "./annotation-drag-model";

type TransactionResult = { ok: boolean };

export function createAnnotationDragController({
  document,
  annotationGrid,
  resolver,
  routeGeometryRecords,
  dragSessionRef,
  dragThresholdPx,
  pointFromClient,
  onCompositeMove,
  selectAnnotation,
  clearSelectedEndpoint,
  transact,
  setStatus,
}: {
  document: SchematicDocument;
  /** Rounding pitch for dragged labels. */
  annotationGrid: number;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  dragSessionRef: MutableRefObject<CanvasDragSession | null>;
  dragThresholdPx: number;
  pointFromClient: (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) => DerivedPoint;
  onCompositeMove: (
    event: ReactPointerEvent<SVGElement>,
    hitTarget: SVGElement,
  ) => boolean;
  selectAnnotation: (id: string) => void;
  clearSelectedEndpoint: () => void;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
}) {
  const beginDrag = (
    event: ReactPointerEvent<SVGElement>,
    annotation: Annotation,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (event.button !== 0) return;
    if (onCompositeMove(event, hitTarget)) return;
    event.stopPropagation();
    selectAnnotation(annotation.id);
    clearSelectedEndpoint();
    if (annotation.locked) {
      setStatus("Selected locked annotation");
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setStatus(`Selected annotation ${annotation.id}`);
      return;
    }
    dragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const pointerStart = pointFromClient(event.clientX, event.clientY, svg);
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
    const originalPosition = {
      ...(isRoutedMarker(annotation) && markerPlacement
        ? markerPlacement.labelPoint
        : annotation.anchor.kind === "free"
          ? annotation.anchor.position
          : annotation.anchor.fallbackPosition),
    };
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [annotation.id]));
    const positionAt = (clientX: number, clientY: number): DerivedPoint => {
      const pointer = pointFromClient(clientX, clientY, svg);
      return {
        x: originalPosition.x + pointer.x - pointerStart.x,
        y: originalPosition.y + pointer.y - pointerStart.y,
      };
    };
    dragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: dragThresholdPx,
      onPreview: (client) => {
        const position = positionAt(client.x, client.y);
        dragVisual().translate({
          x: position.x - originalPosition.x,
          y: position.y - originalPosition.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        dragSessionRef.current = null;
        visual?.restore();
        if (!dragged) return;
        const latest = document.annotations.find(
          (candidate) => candidate.id === annotation.id,
        );
        if (!latest) return;
        transact([
          {
            kind: "upsert_schematic_annotation",
            annotation: draggedAnnotationAtPosition(
              { document, annotationGrid, resolver, routeGeometryRecords },
              latest,
              snapGridPoint(positionAt(client.x, client.y), annotationGrid),
            ),
          },
        ]);
      },
      onCancel: () => {
        dragSessionRef.current = null;
        visual?.restore();
      },
    });
  };

  return { beginDrag };
}
