import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import type {
  Annotation,
  DraftingObject,
  Point,
  SchematicDocument,
} from "@icm/model";
import type { WireSource } from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";

import type { EditorTool } from "../interaction/interaction-state";
import { rankCanvasHits } from "./canvas-hit-resolver";
import {
  proposeRectangleLabel,
  rectangleInteriorAt,
  rectangleLabelFor,
} from "../features/drafting/rectangle-label";

type CanvasMouseEvent = ReactMouseEvent<SVGSVGElement>;
type CanvasPointerEvent = ReactPointerEvent<SVGSVGElement>;
type DraftingTextObject = Extract<DraftingObject, { kind: "text" }>;
interface PointFromClient {
  (clientX: number, clientY: number, canvas: SVGSVGElement, snap?: true): Point;
  (clientX: number, clientY: number, canvas: SVGSVGElement, snap: false): Point;
}

interface CanvasEventHandlerDependencies {
  model: {
    tool: EditorTool;
    document: SchematicDocument;
    resolver: SymbolResolver;
  };
  session: {
    interactionKind: () => string;
    cellSymbolLayoutEnabled: boolean;
    exitCellSymbolLayout: () => void;
  };
  coordinates: {
    pointFromClient: PointFromClient;
    logicalRadiusForPixels: (canvas: SVGSVGElement, pixels: number) => number;
    snapCaptureRadiusPixels: number;
  };
  selection: {
    commitCommandMove: (
      point: Point,
      clientPoint: Point,
      canvas: SVGSVGElement,
    ) => void;
    clearDraftingSelection: () => void;
    handleCanvasHitPointerDown: (event: CanvasPointerEvent) => void;
  };
  placement: {
    pendingSymbolId: string | null;
    pendingComponentPlacement: boolean;
    vddRailMode: boolean;
    copyPlacementActive: boolean;
    snapPlacementPoint: (point: Point) => Point;
    commitCopyPlacement: (point: Point) => void;
    commitPendingPlacement: (point: Point) => void;
    clearComponentPreview: () => void;
    clearVddRailPreview: () => void;
    clearCopyPreview: () => void;
  };
  gesture: {
    begin: (event: CanvasPointerEvent) => void;
    continue: (event: CanvasPointerEvent) => void;
    finish: (event: CanvasPointerEvent) => void;
    cancelDrag: () => void;
    onWheel: (event: ReactWheelEvent<SVGSVGElement>) => void;
    onDrop: (event: ReactDragEvent<SVGSVGElement>) => void;
  };
  drafting: {
    selected: DraftingObject | null | undefined;
    sourceActive: boolean;
    handleCanvasClick: (
      point: Point,
      alternate: boolean,
      additive: boolean,
      logicalRadius: number,
    ) => void;
    beginAnnotationTextEditing: (annotation: Annotation) => void;
    beginTextEditing: (object: DraftingTextObject) => void;
    nextRectangleLabelId: () => string;
    upsertObject: (object: DraftingObject) => boolean;
    finishCreate: () => void;
    cancelCreate: () => void;
  };
  wiring: {
    source: WireSource | null;
    draftStepCount: number;
    applyCanvasPoint: (
      point: Point,
      canvas: SVGSVGElement,
      alternate: boolean,
      finish: boolean,
    ) => void;
    resolveCanvasSnap: (
      point: Point,
      canvas: SVGSVGElement,
      alternate: boolean,
    ) => { point: Point };
    complete: () => void;
    cancel: () => void;
  };
  report: (status: string) => void;
}

/** DOM event boundary for the editor canvas; domain mutations stay injected. */
export function createEditorCanvasEventHandlers({
  model: { tool, document, resolver },
  session: { interactionKind, cellSymbolLayoutEnabled, exitCellSymbolLayout },
  coordinates: {
    pointFromClient,
    logicalRadiusForPixels,
    snapCaptureRadiusPixels,
  },
  selection: {
    commitCommandMove,
    clearDraftingSelection,
    handleCanvasHitPointerDown,
  },
  placement: {
    pendingSymbolId,
    pendingComponentPlacement,
    vddRailMode,
    copyPlacementActive,
    snapPlacementPoint,
    commitCopyPlacement,
    commitPendingPlacement,
    clearComponentPreview,
    clearVddRailPreview,
    clearCopyPreview,
  },
  gesture: {
    begin: beginCanvasGesture,
    continue: continueCanvasGesture,
    finish: finishCanvasGesture,
    cancelDrag: cancelCanvasDrag,
    onWheel,
    onDrop,
  },
  drafting: {
    selected: selectedDrafting,
    sourceActive: draftingSourceActive,
    handleCanvasClick: handleDraftingCanvasClick,
    beginAnnotationTextEditing,
    beginTextEditing: beginDraftingTextEditing,
    nextRectangleLabelId,
    upsertObject: upsertDraftingObject,
    finishCreate: finishDraftingCreate,
    cancelCreate: cancelDraftingCreate,
  },
  wiring: {
    source: wireSource,
    draftStepCount: wireDraftStepCount,
    applyCanvasPoint: applyWireCanvasPoint,
    resolveCanvasSnap: resolveWireCanvasSnap,
    complete: completeWire,
    cancel: cancelWire,
  },
  report: setStatus,
}: CanvasEventHandlerDependencies) {
  return {
    onWheel,
    onClickCapture(event: CanvasMouseEvent) {
      const kind = interactionKind();
      if (kind === "moving-selection") {
        if (event.detail === 1) {
          event.preventDefault();
          event.stopPropagation();
          commitCommandMove(
            pointFromClient(event.clientX, event.clientY, event.currentTarget),
            { x: event.clientX, y: event.clientY },
            event.currentTarget,
          );
        }
        return;
      }
      if (kind === "copy-placement") {
        if (event.detail > 1) return;
        event.preventDefault();
        event.stopPropagation();
        commitCopyPlacement(
          snapPlacementPoint(
            pointFromClient(
              event.clientX,
              event.clientY,
              event.currentTarget,
              false,
            ),
          ),
        );
        return;
      }
      if (!vddRailMode && (!pendingSymbolId || !pendingComponentPlacement))
        return;
      if (event.detail > 1) return;
      event.stopPropagation();
      commitPendingPlacement(
        snapPlacementPoint(
          pointFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
            false,
          ),
        ),
      );
    },
    onPointerDownCapture(event: CanvasPointerEvent) {
      const target = event.target as Element;
      if (target.closest('[data-testid="canvas-text-editor"]')) return;
      if (
        cellSymbolLayoutEnabled &&
        target.closest('[data-testid="cell-symbol-layout-overlay"]')
      )
        return;
      if (cellSymbolLayoutEnabled) exitCellSymbolLayout();
      if (interactionKind() === "moving-selection") {
        event.stopPropagation();
        return;
      }
      if (
        selectedDrafting &&
        (selectedDrafting.kind === "arrow" ||
          selectedDrafting.kind === "construction-line" ||
          selectedDrafting.kind === "rectangle" ||
          selectedDrafting.kind === "circle") &&
        !target.closest(
          `[data-testid="drafting-hit-${selectedDrafting.id}"]`,
        ) &&
        !target.closest(
          `[data-testid="drafting-handles-${selectedDrafting.id}"]`,
        )
      ) {
        clearDraftingSelection();
      }
      handleCanvasHitPointerDown(event);
    },
    onPointerDown: beginCanvasGesture,
    onPointerMove: continueCanvasGesture,
    onPointerLeave() {
      const kind = interactionKind();
      if (pendingSymbolId) clearComponentPreview();
      if (vddRailMode) clearVddRailPreview();
      if (kind === "copy-placement") clearCopyPreview();
    },
    onPointerUp: finishCanvasGesture,
    onPointerCancel: finishCanvasGesture,
    onClick(event: CanvasMouseEvent) {
      const target = event.target as Element;
      const onBackground =
        target === event.currentTarget || target.tagName === "rect";
      if (
        (tool === "arrow" ||
          tool === "construction-line" ||
          tool === "rectangle" ||
          tool === "circle") &&
        event.detail === 1 &&
        onBackground
      ) {
        handleDraftingCanvasClick(
          // Raw pointer: the drafting controller rounds by the annotation
          // grid, which can be finer than the Document grid.
          pointFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
            false,
          ),
          event.altKey,
          event.shiftKey,
          logicalRadiusForPixels(event.currentTarget, snapCaptureRadiusPixels),
        );
        return;
      }
      if (tool !== "wire" || event.detail !== 1) return;
      applyWireCanvasPoint(
        pointFromClient(
          event.clientX,
          event.clientY,
          event.currentTarget,
          false,
        ),
        event.currentTarget,
        event.altKey,
        false,
      );
    },
    onDoubleClick(event: CanvasMouseEvent) {
      const target = event.target as Element;
      if (tool === "pointer") {
        const pointHits = rankCanvasHits(
          event.currentTarget.ownerDocument.elementsFromPoint(
            event.clientX,
            event.clientY,
          ),
        );
        const annotationHit = pointHits.find(
          (hit) => hit.kind === "annotation",
        );
        const annotation = annotationHit
          ? document.annotations.find(
              (candidate) => candidate.id === annotationHit.id,
            )
          : undefined;
        if (annotation) {
          event.preventDefault();
          event.stopPropagation();
          cancelCanvasDrag();
          beginAnnotationTextEditing(annotation);
          return;
        }
        const electricalHit = pointHits.some(
          (hit) =>
            hit.kind !== "annotation" &&
            hit.kind !== "instance-label" &&
            hit.kind !== "drafting",
        );
        const interiorPoint = pointFromClient(
          event.clientX,
          event.clientY,
          event.currentTarget,
        );
        const rectangle = electricalHit
          ? null
          : rectangleInteriorAt(document, resolver, interiorPoint);
        if (rectangle) {
          event.preventDefault();
          event.stopPropagation();
          cancelCanvasDrag();
          const existingLabel = rectangleLabelFor(document, rectangle.id);
          if (existingLabel) {
            beginDraftingTextEditing(existingLabel);
            return;
          }
          const label = proposeRectangleLabel(
            rectangle,
            nextRectangleLabelId(),
          );
          if (upsertDraftingObject(label)) {
            beginDraftingTextEditing(label);
            setStatus(`Editing label of ${rectangle.id}`);
          }
          return;
        }
      }
      if (
        tool === "arrow" ||
        tool === "construction-line" ||
        tool === "rectangle" ||
        tool === "circle"
      ) {
        if (target !== event.currentTarget && target.tagName !== "rect") return;
        finishDraftingCreate();
        return;
      }
      if (tool !== "wire") return;
      if (wireSource && wireDraftStepCount === 0) {
        completeWire();
        setStatus("Wire finished · Esc exits");
        return;
      }
      if (target !== event.currentTarget && target.tagName !== "rect") return;
      const point = pointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
        false,
      );
      const resolved = resolveWireCanvasSnap(
        point,
        event.currentTarget,
        event.altKey,
      );
      if (
        wireSource &&
        wireDraftStepCount === 0 &&
        wireSource.connection.contactPoint.x === resolved.point.x &&
        wireSource.connection.contactPoint.y === resolved.point.y
      ) {
        completeWire();
        setStatus("Wire finished · Esc exits");
        return;
      }
      if (
        wireSource?.endpoint.kind === "junction" &&
        wireSource.preludeEdits.some(
          (edit) => edit.kind === "add_junction" && edit.createNet,
        ) &&
        wireSource.connection.contactPoint.x === resolved.point.x &&
        wireSource.connection.contactPoint.y === resolved.point.y
      ) {
        setStatus("Wire finished · Esc exits");
        completeWire();
        return;
      }
      applyWireCanvasPoint(point, event.currentTarget, event.altKey, true);
    },
    onContextMenu(event: CanvasMouseEvent) {
      event.preventDefault();
      if (
        tool === "arrow" ||
        tool === "construction-line" ||
        tool === "rectangle" ||
        tool === "circle"
      ) {
        if (draftingSourceActive) {
          cancelDraftingCreate();
          setStatus("Drawing cancelled");
        }
        return;
      }
      if (tool === "wire") cancelWire();
    },
    onDragOver(event: ReactDragEvent<SVGSVGElement>) {
      event.preventDefault();
    },
    onDrop,
  };
}
