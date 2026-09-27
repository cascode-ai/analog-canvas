import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { SchematicEdit } from "@icm/edit-engine";
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
import { type RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import {
  annotationDragPosition,
  draggedAnnotationAtPosition,
} from "./annotation-drag-model";

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
  selectAnnotation: (id: string, additive: boolean) => void;
  clearSelectedEndpoint: () => void;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
}) {
  const beginDrag = (
    event: ReactPointerEvent<SVGElement>,
    annotation: Annotation,
    hitTarget: SVGElement = event.currentTarget,
    options: {
      /**
       * The press only picks the label up once it moves: until then it is a
       * click, which is left to whoever owns the canvas (a part being placed).
       * Called as the drag begins, before the label is selected.
       */
      onDragStart?: () => void;
    } = {},
  ): void => {
    if (event.button !== 0) return;
    const deferred = options.onDragStart !== undefined;
    if (!deferred && onCompositeMove(event, hitTarget)) return;
    event.stopPropagation();
    const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
    const select = () => {
      selectAnnotation(annotation.id, additiveSelection);
      clearSelectedEndpoint();
    };
    if (annotation.locked || (!deferred && additiveSelection)) {
      if (deferred) return;
      select();
      setStatus(
        annotation.locked
          ? "Selected locked annotation"
          : `Selected annotation ${annotation.id}`,
      );
      return;
    }
    if (!deferred) select();
    dragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const pointerStart = pointFromClient(event.clientX, event.clientY, svg);
    const geometryContext = {
      document,
      annotationGrid,
      resolver,
      routeGeometryRecords,
    };
    const originalPosition = annotationDragPosition(
      geometryContext,
      annotation,
    );
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () => {
      if (!visual && deferred) {
        options.onDragStart!();
        select();
      }
      return (visual ??= startCanvasDragVisual(svg, [annotation.id]));
    };
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
              geometryContext,
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
