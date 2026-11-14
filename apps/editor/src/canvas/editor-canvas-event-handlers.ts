import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type {
  Annotation,
  DraftingObject,
  Point,
  SchematicDocument,
} from "@icm/model";
import type { WireSource } from "@icm/edit-engine";
import type { ResolvedDrawingScene } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditorTool } from "../interaction/interaction-state";
import type { SelectionPolicy } from "../features/selection/selection-filter";
import {
  canvasHitFromElement,
  isCanvasHitVisible,
  rankCanvasHits,
} from "./canvas-hit-resolver";
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
    selectionPolicy: SelectionPolicy;
    drawingScene: ResolvedDrawingScene;
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
      suppressSnap: boolean,
    ) => void;
    clearDraftingSelection: () => void;
    /**
     * Whether the pressed element belongs to the current selection, so the
     * press is about to act on that selection (drag it as one body, open its
     * context menu) rather than replace it.
     */
    pressActsOnSelection: (target: Element) => boolean;
    handleCanvasHitPointerDown: (event: CanvasPointerEvent) => void;
    openInstance: (instance: SchematicDocument["instances"][number]) => void;
    openContextMenu: (
      target: Element,
      clientX: number,
      clientY: number,
    ) => void;
  };
  placement: {
    pendingSymbolId: string | null;
    pendingComponentPlacement: boolean;
    vddRailMode: boolean;
    snapPlacementPoint: (point: Point, svg: SVGSVGElement) => Point;
    commitCopyPlacement: (point: Point, canvas: SVGSVGElement) => void;
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
    onDrop: (event: ReactDragEvent<SVGSVGElement>) => void;
  };
  drafting: {
    clearHover: () => void;
    selected: DraftingObject | null | undefined;
    sourceActive: boolean;
    beginCreatePointer?: (event: CanvasPointerEvent) => boolean;
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
    clearHover: () => void;
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
  netLabelPlacement: {
    active: boolean;
    placeAt: (position: Point, svg: SVGSVGElement) => void;
    clearHover: () => void;
  };
  noConnectPlacement?: {
    active: boolean;
    placeAt: (point: { x: number; y: number }, svg: SVGSVGElement) => void;
    hoverAt: (point: { x: number; y: number }, svg: SVGSVGElement) => void;
    clearHover: () => void;
  };
  report: (status: string) => void;
  /**
   * Read-and-clear flag for the click that belongs to an armed-verb pickup;
   * true means this click already did its work on pointerdown.
   */
  consumePickupClick?: () => boolean;
}

/** DOM event boundary for the editor canvas; domain mutations stay injected. */
export function createEditorCanvasEventHandlers({
  model: { tool, document, resolver, selectionPolicy, drawingScene },
  session: { interactionKind, cellSymbolLayoutEnabled },
  coordinates: {
    pointFromClient,
    logicalRadiusForPixels,
    snapCaptureRadiusPixels,
  },
  selection: {
    commitCommandMove,
    clearDraftingSelection,
    pressActsOnSelection,
    handleCanvasHitPointerDown,
    openInstance,
    openContextMenu,
  },
  placement: {
    pendingSymbolId,
    pendingComponentPlacement,
    vddRailMode,
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
    onDrop,
  },
  drafting: {
    clearHover: clearDraftingHover,
    selected: selectedDrafting,
    sourceActive: draftingSourceActive,
    beginCreatePointer,
    handleCanvasClick: handleDraftingCanvasClick,
    beginAnnotationTextEditing,
    beginTextEditing: beginDraftingTextEditing,
    nextRectangleLabelId,
    upsertObject: upsertDraftingObject,
    finishCreate: finishDraftingCreate,
    cancelCreate: cancelDraftingCreate,
  },
  wiring: {
    clearHover: clearWireHover,
    source: wireSource,
    draftStepCount: wireDraftStepCount,
    applyCanvasPoint: applyWireCanvasPoint,
    resolveCanvasSnap: resolveWireCanvasSnap,
    complete: completeWire,
    cancel: cancelWire,
  },
  netLabelPlacement,
  noConnectPlacement,
  report: setStatus,
  consumePickupClick,
}: CanvasEventHandlerDependencies) {
  const rawPoint = (event: CanvasMouseEvent) =>
    pointFromClient(event.clientX, event.clientY, event.currentTarget, false);
  const hitsAt = (event: CanvasMouseEvent, intent: "edit" | "context-menu") =>
    rankCanvasHits(
      event.currentTarget.ownerDocument.elementsFromPoint(
        event.clientX,
        event.clientY,
      ),
      (hit) => selectionPolicy.allowsCanvasHit(hit, intent),
      {
        scene: drawingScene,
        point: rawPoint(event),
      },
    );
  return {
    onClickCapture(event: CanvasMouseEvent) {
      if (noConnectPlacement?.active) {
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0 && event.detail === 1)
          noConnectPlacement.placeAt(
            { x: event.clientX, y: event.clientY },
            event.currentTarget,
          );
        return;
      }
      const kind = interactionKind();
      if (netLabelPlacement.active) {
        event.preventDefault();
        event.stopPropagation();
        netLabelPlacement.placeAt(
          pointFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
            false,
          ),
          event.currentTarget,
        );
        return;
      }
      // One electrical picker owns Pin, Route and background clicks. Resolve
      // before child hit elements can stop propagation; commit only once,
      // after pointerup, so replacing a hit element cannot create a second
      // background click from the same gesture.
      if (
        tool === "wire" &&
        event.button === 0 &&
        !(event.target as Element).closest(
          'foreignObject, [data-testid="flightline-hit"]',
        )
      ) {
        event.stopPropagation();
        if (event.detail === 1) {
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
        }
        return;
      }
      // The pointerdown that just picked something up (an armed Copy/Move
      // verb consuming its target) must not also place it: its click would
      // otherwise commit at the pickup point with zero displacement.
      if (
        (kind === "moving-selection" || kind === "copy-placement") &&
        consumePickupClick?.()
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (kind === "moving-selection") {
        if (event.detail === 1) {
          event.preventDefault();
          event.stopPropagation();
          commitCommandMove(
            pointFromClient(
              event.clientX,
              event.clientY,
              event.currentTarget,
              false,
            ),
            { x: event.clientX, y: event.clientY },
            event.currentTarget,
            event.altKey,
          );
        }
        return;
      }
      if (kind === "copy-placement") {
        if (event.detail > 1) return;
        event.preventDefault();
        event.stopPropagation();
        commitCopyPlacement(
          pointFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
            false,
          ),
          event.currentTarget,
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
          event.currentTarget,
        ),
      );
    },
    onPointerDownCapture(event: CanvasPointerEvent) {
      const target = event.target as Element;
      if (target.closest('[data-testid="canvas-text-editor"]')) return;
      if (noConnectPlacement?.active && event.button === 0) {
        event.currentTarget.focus({ preventScroll: true });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (netLabelPlacement.active) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // The canvas is the keyboard-command surface. Explicitly take focus on
      // pointer entry so an earlier toolbar or Project-name input cannot keep
      // swallowing canvas shortcuts after the user returns to the drawing.
      event.currentTarget.focus({ preventScroll: true });
      if (beginCreatePointer?.(event)) return;
      if (
        cellSymbolLayoutEnabled &&
        target.closest('[data-testid="cell-symbol-layout-overlay"]')
      )
        return;
      if (cellSymbolLayoutEnabled && event.button === 0 && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (interactionKind() === "moving-selection") {
        event.stopPropagation();
        return;
      }
      // Outline shapes are stroke-only hits, so a press "inside" one lands on
      // the canvas; this deselect gives them plain-click-outside dismissal.
      // It must stand down for an additive press (the click is composing a
      // selection, not replacing one) and for a press on any member of the
      // current selection (the press is about to drag it or open its menu).
      if (
        event.button === 0 &&
        selectedDrafting &&
        (selectedDrafting.kind === "arrow" ||
          selectedDrafting.kind === "construction-line" ||
          selectedDrafting.kind === "rectangle" ||
          selectedDrafting.kind === "circle") &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !target.closest(
          `[data-testid="drafting-hit-${selectedDrafting.id}"]`,
        ) &&
        !target.closest(
          `[data-testid="drafting-handles-${selectedDrafting.id}"]`,
        ) &&
        !pressActsOnSelection(target)
      ) {
        clearDraftingSelection();
      }
      handleCanvasHitPointerDown(event);
    },
    onPointerDown: beginCanvasGesture,
    onPointerMove(event: CanvasPointerEvent) {
      if (
        noConnectPlacement?.active &&
        !event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        noConnectPlacement.hoverAt(
          { x: event.clientX, y: event.clientY },
          event.currentTarget,
        );
        return;
      }
      continueCanvasGesture(event);
    },
    onPointerLeave(event: CanvasPointerEvent) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const kind = interactionKind();
      clearDraftingHover();
      clearWireHover();
      noConnectPlacement?.clearHover();
      if (netLabelPlacement.active) netLabelPlacement.clearHover();
      if (pendingSymbolId) clearComponentPreview();
      if (vddRailMode) clearVddRailPreview();
      if (kind === "copy-placement") clearCopyPreview();
    },
    onPointerUp: finishCanvasGesture,
    onPointerCancel: finishCanvasGesture,
    onClick(event: CanvasMouseEvent) {
      const target = event.target as Element;
      const acceptsDraftingPoint = !target.closest(
        '[data-testid="canvas-text-editor"]',
      );
      if (
        (tool === "arrow" ||
          tool === "polyline" ||
          tool === "construction-line" ||
          tool === "rectangle" ||
          tool === "circle") &&
        event.detail === 1 &&
        acceptsDraftingPoint
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
    },
    onContextMenuCapture(event: CanvasMouseEvent) {
      if (tool !== "pointer" || interactionKind() !== "idle") return;
      const target = event.target as Element;
      if (
        target.closest(
          "foreignObject, .endpoint-hit, .draft-handle, .route-handle",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(
        hitsAt(event, "context-menu")[0]?.element ?? event.currentTarget,
        event.clientX,
        event.clientY,
      );
    },
    onDoubleClickCapture(event: CanvasMouseEvent) {
      const target = event.target as Element;
      if (
        tool !== "pointer" ||
        cellSymbolLayoutEnabled ||
        target.closest("foreignObject, .draft-handle, .route-handle")
      )
        return;
      const direct = canvasHitFromElement(target);
      const presentation = { scene: drawingScene, point: rawPoint(event) };
      const directVisible = direct && isCanvasHitVisible(direct, presentation);
      if (directVisible && direct.kind === "drafting") return;
      const hit =
        directVisible &&
        !drawingScene.hasOcclusion &&
        !document.drawingOrder &&
        (direct.kind === "instance" || direct.kind === "annotation") &&
        selectionPolicy.allowsCanvasHit(direct, "edit")
          ? direct
          : hitsAt(event, "edit").find(
              (candidate) =>
                candidate.kind === "instance" ||
                candidate.kind === "annotation",
            );
      if (
        direct &&
        !directVisible &&
        hit?.kind !== "annotation" &&
        hit?.kind !== "instance"
      ) {
        event.stopPropagation();
        return;
      }
      if (hit?.kind === "instance") {
        const instance = document.instances.find(
          (candidate) => candidate.id === hit.id,
        );
        if (!instance) return;
        event.preventDefault();
        event.stopPropagation();
        cancelCanvasDrag();
        openInstance(instance);
      } else if (hit?.kind === "annotation") {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === hit.id,
        );
        if (!annotation) return;
        event.preventDefault();
        event.stopPropagation();
        cancelCanvasDrag();
        beginAnnotationTextEditing(annotation);
      }
    },
    onDoubleClick(event: CanvasMouseEvent) {
      if (cellSymbolLayoutEnabled) {
        event.preventDefault();
        return;
      }
      const target = event.target as Element;
      if (tool === "pointer") {
        const pointHits = hitsAt(event, "edit");
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
          : rectangleInteriorAt(
              document,
              resolver,
              interiorPoint,
              drawingScene,
            );
        if (rectangle && selectionPolicy.allowsDrafting(rectangle, "edit")) {
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
        tool === "polyline" ||
        tool === "construction-line" ||
        tool === "rectangle" ||
        tool === "circle"
      ) {
        if (target.closest('[data-testid="canvas-text-editor"]')) return;
        finishDraftingCreate();
        return;
      }
      if (tool !== "wire") return;
      if (!wireSource) {
        // The first click already committed a captured endpoint/route. The
        // second click must finish quietly rather than opening another run.
        setStatus("Wire finished · Esc exits");
        return;
      }
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
        tool === "polyline" ||
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
      if (tool === "pointer" && interactionKind() === "idle") {
        const hit = hitsAt(event, "context-menu")[0];
        openContextMenu(
          hit?.element ?? event.currentTarget,
          event.clientX,
          event.clientY,
        );
      }
    },
    onDragOver(event: ReactDragEvent<SVGSVGElement>) {
      event.preventDefault();
    },
    onDrop,
  };
}
