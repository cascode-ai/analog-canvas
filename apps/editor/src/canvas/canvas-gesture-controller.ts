import type { PointerEvent as ReactPointerEvent } from "react";

import type { SchematicStyleProfile } from "@icm/derived";
import type {
  DerivedPoint,
  GridRect,
  Point,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { constrainedPowerRailEndpoint } from "../features/component-insert/vdd-rail";
import {
  marqueeMode,
  marqueeSelection,
} from "../features/selection/marquee-selection";
import {
  EMPTY_VISUAL_SELECTION,
  type VisualSelection,
} from "../features/selection/visual-selection";
import type { RouteGeometryRecord } from "../features/wiring/route-interaction-geometry";
import type { WireCanvasSnapResult } from "../features/wiring/wire-canvas-snap";
import type { EditorTool } from "../interaction/interaction-state";
import { snapCoordinate, type SnapGuideLine } from "../snap/engine";
import {
  classifyCanvasGestureStart,
  type BoxPreview,
  type PanPreview,
  updateCanvasPan,
} from "./canvas-gesture-model";
import { normalizedRect } from "./canvas-geometry";
import {
  fitCameraToBounds,
  fitCameraToVisibleBounds,
  zoomCameraAtAnchor,
  type CameraRectInput,
  type CanvasInsets,
} from "./fit-view";

// A stiff middle button drifts under the hand; keep a larger slop than an
// ordinary drag so a click can still cycle the active wire corner.
const PAN_START_DISTANCE_PX = 10;
const DRAFTING_SNAP_CAPTURE_RADIUS_PX = 7;

type SetViewBox = (
  next: GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput),
  grid?: number,
) => void;

export interface CanvasGestureControllerDependencies {
  model: {
    document: SchematicDocument;
    resolver: SymbolResolver;
    routeGeometryRecords: readonly RouteGeometryRecord[];
    styleProfile: SchematicStyleProfile;
  };
  viewport: {
    defaultViewBox: GridRect;
    contentBounds: GridRect | null | undefined;
    viewBox: GridRect;
    setViewBox: SetViewBox;
    pointFromClient: (
      clientX: number,
      clientY: number,
      svg: SVGSVGElement,
    ) => Point;
    rawPointFromClient: (
      clientX: number,
      clientY: number,
      svg: SVGSVGElement,
    ) => DerivedPoint;
    logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
    /** Live read: the person can change it between two wheel events. */
    wheelBehavior: () => WheelBehavior;
  };
  gestureSession: {
    boxPreview: BoxPreview | null;
    setBoxPreview: (preview: BoxPreview | null) => void;
    panPreview: PanPreview | null;
    setPanPreview: (preview: PanPreview | null) => void;
    getInteractionKind: () => string;
    paintSnapGuides: (guides: readonly SnapGuideLine[]) => void;
    noteCanvasPoint: (point: Point) => void;
    setStatus: (status: string) => void;
    /** Canvas size and how far floating docks reach over it; see fitView. */
    measureCanvasView?: () => {
      viewport: { width: number; height: number };
      insets: CanvasInsets;
    } | null;
  };
  selection: {
    updateCommandMovePreview: (
      point: Point,
      clientPoint: Point,
      svg: SVGSVGElement,
      suppressSnap: boolean,
    ) => void;
    replaceSelection: (selection: VisualSelection) => void;
    clearSelectedEndpoint: () => void;
  };
  placement: {
    componentPlacementPending: boolean;
    componentSymbolPending: boolean;
    /** Rounding pitch for the pending placement's ghost (annotation texts move finer than devices). */
    placementGrid: () => number;
    setComponentPreviewPoint: (point: Point) => void;
    vddRailMode: boolean;
    vddRailStart: Point | null;
    setVddRailPreviewPoint: (point: Point) => void;
    copyPlacementPending: boolean;
    setCopyPreviewPoint: (point: Point) => void;
    waveformPlacementPending: boolean;
    setWaveformPreviewPoint: (point: Point) => void;
  };
  drafting: {
    tool: EditorTool;
    draftingSource: Point | null;
    snapDraftingPoint: (
      point: DerivedPoint,
      altKey: boolean,
      shiftKey: boolean,
      origin: Point | undefined,
      tolerance: number,
    ) => { point: Point; snap: Point | null; guides: SnapGuideLine[] };
    setDraftingHover: (point: Point | null) => void;
    setDraftingSnapPoint: (point: Point | null) => void;
  };
  wiring: {
    wireActive: boolean;
    resolveWireCanvasSnap: (
      point: Point,
      svg: SVGSVGElement,
      suppressSnap: boolean,
    ) => WireCanvasSnapResult;
    setWirePreviewPoint: (point: Point | null) => void;
    cycleWireCornerShape: () => void;
  };
  cellSymbolLayout: {
    activeDragPointerId: number | null;
    cancelDrag: () => void;
    completeDrag: (event: ReactPointerEvent<SVGSVGElement>) => boolean;
  };
}

/**
 * Wheel-source inference. Trackpads scroll in pixel mode with a horizontal
 * component, fractional deltas, or gentle sub-detent steps; a discrete
 * mouse wheel reports line/page mode or large integer vertical detents.
 * Heuristic by necessity — the DOM never names the device.
 */
interface WheelSourceShape {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  /** Non-standard, Chromium/WebKit only; absent on Firefox. */
  wheelDeltaY?: number;
}

/**
 * What a wheel event proves about the device that produced it.
 *
 * The DOM never names the device, so this reports evidence rather than a
 * guess: "unknown" is a real answer, and the caller decides what a
 * device-less event should do. Nothing here infers a source from how large
 * a delta happens to be — a high-resolution or slowly turned wheel emits
 * exactly the small values a trackpad does.
 */
export type WheelSource = "mouse" | "trackpad" | "unknown";

/**
 * How the wheel should be read. "auto" trusts the evidence above; the two
 * explicit values exist because no evidence is available in every browser,
 * and a person who knows their own device should never be at the mercy of
 * a guess.
 */
export type WheelBehavior = "auto" | "zoom" | "pan";

export function classifyWheelSource(event: WheelSourceShape): WheelSource {
  // Firefox and older engines report a wheel in lines or pages; a precise
  // surface always reports pixels.
  if (event.deltaMode !== 0) return "mouse";
  // Chromium and WebKit carry the raw platform value alongside the
  // normalized one. A precise surface keeps the fixed 3:1 pixel ratio,
  // while a physical detent is quantized to multiples of 120 and breaks
  // that ratio however much pointer acceleration shrinks its deltaY.
  const wheelDeltaY = event.wheelDeltaY;
  if (typeof wheelDeltaY === "number" && wheelDeltaY !== 0) {
    if (Math.abs(wheelDeltaY) === 3 * Math.abs(event.deltaY)) return "trackpad";
    if (wheelDeltaY % 120 === 0) return "mouse";
  }
  // Two axes at once is a surface, not a wheel.
  if (event.deltaX !== 0) return "trackpad";
  // Sub-pixel precision comes from momentum, which a detent cannot produce.
  if (!Number.isInteger(event.deltaY)) return "trackpad";
  return "unknown";
}

const TRACKPAD_EVIDENCE_WINDOW_MS = 1500;
let lastTrackpadWheelAt = Number.NEGATIVE_INFINITY;

/** Own viewport gestures and canvas-background pointer progression. */
export function createCanvasGestureController({
  model: { document, resolver, routeGeometryRecords, styleProfile },
  viewport: {
    defaultViewBox,
    contentBounds,
    viewBox,
    setViewBox,
    pointFromClient,
    rawPointFromClient,
    logicalRadiusForPixels,
    wheelBehavior,
  },
  gestureSession: {
    boxPreview,
    setBoxPreview,
    panPreview,
    setPanPreview,
    getInteractionKind,
    paintSnapGuides,
    noteCanvasPoint,
    setStatus,
    measureCanvasView,
  },
  selection: {
    updateCommandMovePreview,
    replaceSelection,
    clearSelectedEndpoint,
  },
  placement: {
    componentPlacementPending,
    componentSymbolPending,
    placementGrid,
    setComponentPreviewPoint,
    vddRailMode,
    vddRailStart,
    setVddRailPreviewPoint,
    copyPlacementPending,
    setCopyPreviewPoint,
    waveformPlacementPending,
    setWaveformPreviewPoint,
  },
  drafting: {
    tool,
    draftingSource,
    snapDraftingPoint,
    setDraftingHover,
    setDraftingSnapPoint,
  },
  wiring: {
    wireActive,
    resolveWireCanvasSnap,
    setWirePreviewPoint,
    cycleWireCornerShape,
  },
  cellSymbolLayout: {
    activeDragPointerId: cellSymbolLayoutDragPointerId,
    cancelDrag: cancelCellSymbolLayoutDrag,
    completeDrag: completeCellSymbolLayoutDrag,
  },
}: CanvasGestureControllerDependencies) {
  const fitView = (options: { announce?: boolean } = {}): void => {
    const bounds = contentBounds ?? defaultViewBox;
    const grid = document.presentation.grid;
    // Below the layout's narrow breakpoint the Properties dock stops being a
    // column and floats over the canvas, so fitting to the element put part
    // of the drawing underneath it.
    const measured = measureCanvasView?.() ?? null;
    setViewBox(
      measured
        ? fitCameraToVisibleBounds(
            bounds,
            grid,
            measured.viewport,
            measured.insets,
          )
        : fitCameraToBounds(bounds, grid),
    );
    if (options.announce !== false) setStatus("Fit Document");
  };

  const zoomViewAtCenter = (factor: number): void => {
    setViewBox((current) =>
      zoomCameraAtAnchor(current, factor, { x: 0.5, y: 0.5 }),
    );
  };

  /** Cursor-anchored zoom shared by wheel, pinch, and Safari gestures. */
  const zoomAtClientPoint = (
    factor: number,
    clientX: number,
    clientY: number,
    element: SVGSVGElement,
  ): void => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const anchor = {
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height,
    };
    setViewBox((current) => zoomCameraAtAnchor(current, factor, anchor));
  };

  // Wheel map by device. A trackpad two-finger scroll pans in every
  // direction; a mouse wheel zooms at the cursor (its only axis earns the
  // richer gesture). Pinch — delivered as ctrl+wheel — and Cmd+scroll zoom
  // on both. Shift+wheel pans horizontally. Attached as a non-passive
  // native listener so preventDefault actually stops browser page zoom
  // and history-swipe navigation.
  const handleWheel = (event: WheelEvent, element: SVGSVGElement): void => {
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
    const deltaX = event.deltaX * unit;
    const deltaY = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      zoomAtClientPoint(
        Math.exp(deltaY * 0.01),
        event.clientX,
        event.clientY,
        element,
      );
      return;
    }
    const source = classifyWheelSource(event);
    if (source === "trackpad") lastTrackpadWheelAt = event.timeStamp;
    if (source === "mouse") lastTrackpadWheelAt = Number.NEGATIVE_INFINITY;
    // An explicit preference is the whole answer; "auto" reads the evidence
    // and, where a browser offers none, keeps the momentum tail of a recent
    // trackpad gesture panning before falling back to the wheel's zoom.
    const trackpad =
      wheelBehavior() === "pan" ||
      (wheelBehavior() === "auto" &&
        (source === "trackpad" ||
          (source === "unknown" &&
            event.timeStamp - lastTrackpadWheelAt <
              TRACKPAD_EVIDENCE_WINDOW_MS)));
    if (!trackpad) {
      if (event.shiftKey) {
        if (deltaY === 0) return;
        setViewBox((current) => ({
          ...current,
          x: current.x + (deltaY * current.width) / bounds.width,
        }));
        return;
      }
      if (deltaY === 0) return;
      zoomAtClientPoint(
        Math.exp(deltaY * 0.0012),
        event.clientX,
        event.clientY,
        element,
      );
      return;
    }
    const panX = event.shiftKey && deltaX === 0 ? deltaY : deltaX;
    const panY = event.shiftKey && deltaX === 0 ? 0 : deltaY;
    if (panX === 0 && panY === 0) return;
    setViewBox((current) => ({
      ...current,
      x: current.x + (panX * current.width) / bounds.width,
      y: current.y + (panY * current.height) / bounds.height,
    }));
  };

  const begin = (event: ReactPointerEvent<SVGSVGElement>): void => {
    // Visual objects own their context menu. Starting the background framing
    // gesture on any of these hit layers would capture the pointer and swallow
    // the later contextmenu event. Routes and endpoints keep their existing
    // canvas behavior until they expose the shared menu themselves.
    const contextMenuHitKind = (event.target as Element).getAttribute?.(
      "data-canvas-hit-kind",
    );
    if (
      event.button === 2 &&
      (contextMenuHitKind === "instance" ||
        contextMenuHitKind === "annotation" ||
        contextMenuHitKind === "drafting")
    ) {
      return;
    }
    const gesture = classifyCanvasGestureStart({
      button: event.button,
      altKey: event.altKey,
      interactionKind: getInteractionKind(),
      targetIsCanvas:
        event.target === event.currentTarget ||
        (event.target as Element).tagName === "rect",
      placementPending: componentPlacementPending || waveformPlacementPending,
      vddRailMode,
      copyPlacementPending,
      tool,
    });
    if (gesture === "pan") {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanPreview({
        clientStart: { x: event.clientX, y: event.clientY },
        viewBoxStart: viewBox,
        pointerId: event.pointerId,
        dragged: false,
      });
      return;
    }
    if (gesture === "zoom") {
      // Raw pointer: the framing rectangle tracks the cursor exactly
      // instead of jumping in Document-grid steps.
      const zoomStart = rawPointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      setBoxPreview({
        start: zoomStart,
        end: zoomStart,
        pointerId: event.pointerId,
        intent: "zoom",
      });
      return;
    }
    if (gesture !== "select") return;
    // Raw pointer: the marquee must not snap to the grid.
    const point = rawPointFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    setBoxPreview({
      start: point,
      end: point,
      pointerId: event.pointerId,
      intent: "select",
    });
  };

  const continueGesture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const interactionKind = getInteractionKind();
    if (interactionKind === "moving-selection") {
      updateCommandMovePreview(
        pointFromClient(event.clientX, event.clientY, event.currentTarget),
        { x: event.clientX, y: event.clientY },
        event.currentTarget,
        event.altKey,
      );
      return;
    }
    if (panPreview?.pointerId === event.pointerId) {
      const update = updateCanvasPan(
        panPreview,
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
        PAN_START_DISTANCE_PX,
      );
      if (!update) return;
      if (update.preview !== panPreview) setPanPreview(update.preview);
      setViewBox(update.viewBox);
      return;
    }
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    noteCanvasPoint(point);
    if (waveformPlacementPending) {
      setWaveformPreviewPoint(point);
      return;
    }
    if (vddRailMode) {
      const snapped = {
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      };
      setVddRailPreviewPoint(
        vddRailStart
          ? constrainedPowerRailEndpoint(vddRailStart, snapped)
          : snapped,
      );
      return;
    }
    if (componentSymbolPending) {
      const raw = rawPointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      setComponentPreviewPoint({
        x: snapCoordinate(raw.x, placementGrid()),
        y: snapCoordinate(raw.y, placementGrid()),
      });
      return;
    }
    if (interactionKind === "copy-placement") {
      setCopyPreviewPoint({
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      });
      return;
    }
    if (boxPreview?.pointerId === event.pointerId) {
      setBoxPreview({
        ...boxPreview,
        end: rawPointFromClient(
          event.clientX,
          event.clientY,
          event.currentTarget,
        ),
      });
    }
    if (
      (tool === "arrow" ||
        tool === "construction-line" ||
        tool === "rectangle" ||
        tool === "circle") &&
      draftingSource !== null
    ) {
      // Raw pointer: the drafting snapper rounds by the annotation grid,
      // which can be finer than the Document grid this handler's point uses.
      const snapped = snapDraftingPoint(
        rawPointFromClient(event.clientX, event.clientY, event.currentTarget),
        event.altKey,
        event.shiftKey,
        draftingSource,
        logicalRadiusForPixels(
          event.currentTarget,
          DRAFTING_SNAP_CAPTURE_RADIUS_PX,
        ),
      );
      setDraftingHover(snapped.point);
      setDraftingSnapPoint(snapped.snap);
      paintSnapGuides(snapped.guides);
    }
    if (tool === "wire" && wireActive) {
      const resolved = resolveWireCanvasSnap(
        rawPointFromClient(event.clientX, event.clientY, event.currentTarget),
        event.currentTarget,
        event.altKey,
      );
      setWirePreviewPoint(resolved.point);
      paintSnapGuides(resolved.guides);
    }
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (
      event.type === "pointercancel" &&
      cellSymbolLayoutDragPointerId === event.pointerId
    ) {
      cancelCellSymbolLayoutDrag();
      return;
    }
    if (completeCellSymbolLayoutDrag(event)) return;
    if (panPreview?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (!panPreview.dragged && getInteractionKind() === "wire") {
        cycleWireCornerShape();
      }
      setPanPreview(null);
      return;
    }
    if (boxPreview?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (boxPreview.intent === "zoom") {
      const rect = normalizedRect(boxPreview.start, boxPreview.end);
      setBoxPreview(null);
      if (
        rect.width > document.presentation.grid &&
        rect.height > document.presentation.grid
      ) {
        setViewBox(fitCameraToBounds(rect, document.presentation.grid));
        setStatus("Zoomed to framed region");
      }
      return;
    }
    const rect = normalizedRect(boxPreview.start, boxPreview.end);
    const clicked =
      rect.width <= document.presentation.grid &&
      rect.height <= document.presentation.grid;
    const selection = clicked
      ? EMPTY_VISUAL_SELECTION
      : marqueeSelection(
          document,
          resolver,
          routeGeometryRecords,
          styleProfile,
          rect,
          marqueeMode(boxPreview.start, boxPreview.end),
        );
    replaceSelection(selection);
    clearSelectedEndpoint();
    setBoxPreview(null);
    const count = Object.values(selection).reduce(
      (total, ids) => total + ids.length,
      0,
    );
    setStatus(count > 0 ? `Selected ${count} objects` : "Selection cleared");
  };

  return {
    fitView,
    zoomViewAtCenter,
    handleWheel,
    zoomAtClientPoint,
    beginCanvasGesture: begin,
    continueCanvasGesture: continueGesture,
    finishCanvasGesture: finish,
  };
}
