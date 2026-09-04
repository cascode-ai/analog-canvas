import { useReducer, useRef } from "react";
import type { SetStateAction } from "react";

import type { Mirror, Point } from "@icm/model";
import type {
  WireCornerOrder,
  WireDraftStep,
  WireRoutingMode,
  WireSource,
} from "@icm/edit-engine";

import {
  reflectOrientation,
  type PlacementOrientationOperation,
  type ScreenFlip,
} from "./shortcut-orientation";

export type { WireSource } from "@icm/edit-engine";

/**
 * Where the far end of an in-flight wire draft currently rests.
 *
 * The pointer resolves to one of exactly three things, and the commit builds a
 * different `WireSource` for each. Keeping only the resolved POINT meant the
 * preview had to invent a far end whose contact point, grid landing, and
 * escape path were all that one point — true of a free grid anchor and of
 * nothing else — so the drawn wire and the committed wire were two answers to
 * one question. The session keeps the target; `features/wiring` owns every
 * reading of it.
 */
export type WireDraftTarget =
  | {
      readonly kind: "endpoint";
      readonly point: Point;
      readonly source: WireSource;
    }
  | {
      readonly kind: "route";
      readonly point: Point;
      readonly routeId: string;
      readonly segmentIndex: number;
    }
  | { readonly kind: "free"; readonly point: Point };

/** A plain grid point: what an empty-canvas hover or a fixed step resolves to. */
export function freeWireDraftTarget(point: Point): WireDraftTarget {
  return { kind: "free", point };
}

export type EditorTool =
  "pointer" | "wire" | "construction-line" | "arrow" | "rectangle" | "circle";

export type DrawingTool = Extract<
  EditorTool,
  "construction-line" | "arrow" | "rectangle" | "circle"
>;

export type InteractionMode = InteractionState<unknown>["kind"];

export interface PendingComponentPlacement {
  kind:
    | "symbol"
    | "cell"
    | "external-subcircuit"
    | "cell-pin"
    | "retained-instance"
    | "drafting-text";
  symbolId: string;
  parameters: Record<string, string>;
  initialRotation: 0 | 90 | 180 | 270;
  showReference: boolean;
  referenceText: string | null;
  showValue: boolean;
  childDocumentId?: string;
  cellName?: string;
  definitionId?: string;
  masterName?: string;
  portName?: string;
  direction?: "input" | "output" | "inout" | "passive";
  polarity?: "both" | "positive" | "negative";
  /** Fixed initial content for a catalog drafting-text preset. */
  text?: string;
  /** Existing unplaced Instance being returned from the Placement Tray. */
  instanceId?: string;
}

export interface CopyPlacement<TClipboard> {
  clipboard: TClipboard;
  anchor: Point;
  sequence: number;
  previewPoint: Point | null;
  orientationOperations: PlacementOrientationOperation[];
}

export type InteractionState<TClipboard = never> =
  | { kind: "idle" }
  | {
      kind: "placing-component";
      placement: PendingComponentPlacement;
      rotation: 0 | 90 | 180 | 270;
      mirror: Mirror;
      previewPoint: Point | null;
    }
  | {
      kind: "placing-vdd-rail";
      netName: string;
      start: Point | null;
      previewPoint: Point | null;
    }
  | {
      kind: "copy-placement";
      copy: CopyPlacement<TClipboard>;
    }
  | { kind: "moving-selection" }
  | {
      kind: "wire";
      source: WireSource | null;
      sourceRevision: number | null;
      preview: WireDraftTarget | null;
      steps: WireDraftStep[];
      routingMode: WireRoutingMode;
      cornerOrder: WireCornerOrder;
    }
  | {
      kind: "drawing";
      tool: DrawingTool;
      source: Point | null;
      hover: Point | null;
      waypoints: Point[];
      snapPoint: Point | null;
    };

export type InteractionAction<TClipboard = never> =
  | { type: "activate-tool"; tool: EditorTool }
  | { type: "place-component"; placement: PendingComponentPlacement }
  | { type: "set-component-preview"; point: Point | null }
  | { type: "rotate-component"; deltaDegrees: 90 | -90 }
  | { type: "mirror-component"; direction: ScreenFlip }
  | { type: "begin-vdd-rail"; netName: string }
  | { type: "set-vdd-rail-start"; point: Point | null }
  | { type: "set-vdd-rail-preview"; point: Point | null }
  | { type: "complete-vdd-rail" }
  | {
      type: "begin-copy-placement";
      clipboard: TClipboard;
      anchor: Point;
    }
  | { type: "set-copy-preview"; point: Point | null }
  | { type: "advance-copy-placement" }
  | { type: "rotate-copy"; deltaDegrees: 90 | -90 }
  | { type: "mirror-copy"; direction: ScreenFlip }
  | { type: "begin-selection-move" }
  | {
      type: "set-wire-source";
      source: WireSource | null;
      sourceRevision: number | null;
    }
  | { type: "set-wire-preview"; target: WireDraftTarget | null }
  | { type: "set-wire-steps"; update: SetStateAction<WireDraftStep[]> }
  /** Compatibility adapter for existing callers; new code owns authored steps. */
  | { type: "set-wire-waypoints"; update: SetStateAction<Point[]> }
  | { type: "set-wire-routing-mode"; mode: WireRoutingMode }
  | { type: "set-wire-corner-order"; cornerOrder: WireCornerOrder }
  | { type: "complete-wire" }
  | { type: "set-drawing-source"; point: Point | null }
  | { type: "set-drawing-hover"; point: Point | null }
  | { type: "set-drawing-waypoints"; update: SetStateAction<Point[]> }
  | { type: "set-drawing-snap"; point: Point | null }
  | { type: "clear-drawing" }
  | { type: "cancel" };

export const IDLE_INTERACTION_STATE: InteractionState = { kind: "idle" };

function drawingState<TClipboard>(
  tool: DrawingTool,
): InteractionState<TClipboard> {
  return {
    kind: "drawing",
    tool,
    source: null,
    hover: null,
    waypoints: [],
    snapPoint: null,
  };
}

export function activateInteractionTool<TClipboard>(
  tool: EditorTool,
): InteractionState<TClipboard> {
  switch (tool) {
    case "pointer":
      return IDLE_INTERACTION_STATE;
    case "wire":
      return {
        kind: "wire",
        source: null,
        sourceRevision: null,
        preview: null,
        steps: [],
        routingMode: "orthogonal",
        cornerOrder: "auto",
      };
    case "arrow":
    case "construction-line":
    case "rectangle":
    case "circle":
      return drawingState(tool);
  }
}

function sameComponentPlacement(
  left: PendingComponentPlacement,
  right: PendingComponentPlacement,
): boolean {
  if (
    left.kind !== right.kind ||
    left.symbolId !== right.symbolId ||
    left.initialRotation !== right.initialRotation ||
    left.showReference !== right.showReference ||
    left.referenceText !== right.referenceText ||
    left.showValue !== right.showValue ||
    left.childDocumentId !== right.childDocumentId ||
    left.cellName !== right.cellName ||
    left.definitionId !== right.definitionId ||
    left.masterName !== right.masterName ||
    left.direction !== right.direction ||
    left.polarity !== right.polarity ||
    left.instanceId !== right.instanceId
  ) {
    return false;
  }
  const leftEntries = Object.entries(left.parameters);
  const rightEntries = Object.entries(right.parameters);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right.parameters[key] === value)
  );
}

function applyUpdate<T>(value: T, update: SetStateAction<T>): T {
  return typeof update === "function"
    ? (update as (current: T) => T)(value)
    : update;
}

export function interactionReducer<TClipboard>(
  state: InteractionState<TClipboard>,
  action: InteractionAction<TClipboard>,
): InteractionState<TClipboard> {
  switch (action.type) {
    case "activate-tool":
      if (action.tool === "wire" && state.kind === "wire") return state;
      if (state.kind === "drawing" && state.tool === action.tool) return state;
      return activateInteractionTool<TClipboard>(action.tool);
    case "place-component":
      if (
        state.kind === "placing-component" &&
        sameComponentPlacement(state.placement, action.placement)
      ) {
        return state;
      }
      return {
        kind: "placing-component",
        placement: action.placement,
        rotation: action.placement.initialRotation,
        mirror: "none",
        previewPoint: null,
      };
    case "set-component-preview":
      return state.kind === "placing-component"
        ? { ...state, previewPoint: action.point }
        : state;
    case "rotate-component":
      return state.kind === "placing-component"
        ? {
            ...state,
            rotation: ((state.rotation + action.deltaDegrees + 360) % 360) as
              0 | 90 | 180 | 270,
          }
        : state;
    case "mirror-component":
      if (state.kind !== "placing-component") return state;
      return {
        ...state,
        ...reflectOrientation(
          { rotation: state.rotation, mirror: state.mirror },
          action.direction,
        ),
      };
    case "begin-vdd-rail":
      return state.kind === "placing-vdd-rail" &&
        state.netName === action.netName
        ? state
        : {
            kind: "placing-vdd-rail",
            netName: action.netName,
            start: null,
            previewPoint: null,
          };
    case "set-vdd-rail-start":
      return state.kind === "placing-vdd-rail"
        ? { ...state, start: action.point }
        : state;
    case "set-vdd-rail-preview":
      return state.kind === "placing-vdd-rail"
        ? { ...state, previewPoint: action.point }
        : state;
    case "complete-vdd-rail":
      return state.kind === "placing-vdd-rail"
        ? (IDLE_INTERACTION_STATE as InteractionState<TClipboard>)
        : state;
    case "begin-copy-placement":
      if (state.kind === "copy-placement") return state;
      return {
        kind: "copy-placement",
        copy: {
          clipboard: action.clipboard,
          anchor: action.anchor,
          sequence: 1,
          previewPoint: null,
          orientationOperations: [],
        },
      };
    case "set-copy-preview":
      if (state.kind !== "copy-placement") return state;
      if (
        state.copy.previewPoint?.x === action.point?.x &&
        state.copy.previewPoint?.y === action.point?.y
      ) {
        return state;
      }
      return { ...state, copy: { ...state.copy, previewPoint: action.point } };
    case "advance-copy-placement":
      return state.kind === "copy-placement"
        ? {
            ...state,
            copy: { ...state.copy, sequence: state.copy.sequence + 1 },
          }
        : state;
    case "rotate-copy":
      return state.kind === "copy-placement"
        ? {
            ...state,
            copy: {
              ...state.copy,
              orientationOperations: [
                ...state.copy.orientationOperations,
                { kind: "rotate", deltaDegrees: action.deltaDegrees },
              ],
            },
          }
        : state;
    case "mirror-copy":
      return state.kind === "copy-placement"
        ? {
            ...state,
            copy: {
              ...state.copy,
              orientationOperations: [
                ...state.copy.orientationOperations,
                { kind: "reflect", direction: action.direction },
              ],
            },
          }
        : state;
    case "begin-selection-move":
      return state.kind === "moving-selection"
        ? state
        : { kind: "moving-selection" };
    case "set-wire-source":
      return state.kind === "wire"
        ? {
            ...state,
            source: action.source,
            sourceRevision: action.source ? action.sourceRevision : null,
          }
        : state;
    case "set-wire-preview":
      return state.kind === "wire"
        ? { ...state, preview: action.target }
        : state;
    case "set-wire-steps":
      return state.kind === "wire"
        ? { ...state, steps: applyUpdate(state.steps, action.update) }
        : state;
    case "set-wire-waypoints":
      return state.kind === "wire"
        ? {
            ...state,
            steps: applyUpdate(
              state.steps.map((step) => step.point),
              action.update,
            ).map((point) => ({
              point,
              routingMode: state.routingMode,
              cornerOrder: state.cornerOrder,
            })),
          }
        : state;
    case "set-wire-routing-mode":
      return state.kind === "wire"
        ? { ...state, routingMode: action.mode }
        : state;
    case "set-wire-corner-order":
      return state.kind === "wire"
        ? { ...state, cornerOrder: action.cornerOrder }
        : state;
    case "complete-wire":
      return state.kind === "wire"
        ? {
            kind: "wire",
            source: null,
            sourceRevision: null,
            preview: null,
            steps: [],
            routingMode: state.routingMode,
            cornerOrder: state.cornerOrder,
          }
        : state;
    case "set-drawing-source":
      return state.kind === "drawing"
        ? { ...state, source: action.point }
        : state;
    case "set-drawing-hover":
      return state.kind === "drawing"
        ? { ...state, hover: action.point }
        : state;
    case "set-drawing-waypoints":
      return state.kind === "drawing"
        ? { ...state, waypoints: applyUpdate(state.waypoints, action.update) }
        : state;
    case "set-drawing-snap":
      return state.kind === "drawing"
        ? { ...state, snapPoint: action.point }
        : state;
    case "clear-drawing":
      return state.kind === "drawing" ? drawingState(state.tool) : state;
    case "cancel":
      return IDLE_INTERACTION_STATE;
  }
}

export function interactionTool<TClipboard>(
  state: InteractionState<TClipboard>,
): EditorTool {
  switch (state.kind) {
    case "idle":
    case "placing-component":
    case "placing-vdd-rail":
    case "copy-placement":
    case "moving-selection":
      return "pointer";
    case "wire":
      return "wire";
    case "drawing":
      return state.tool;
  }
}

export function useInteractionState<TClipboard>() {
  const [state, reactDispatch] = useReducer(
    interactionReducer<TClipboard>,
    IDLE_INTERACTION_STATE as InteractionState<TClipboard>,
  );
  // React may batch two native key events before rendering the first reducer
  // transition. Keep the reducer's authoritative current value available to
  // command arbitration synchronously, while React owns render publication.
  // Queued actions are reduced in the same order on both paths.
  const currentStateRef = useRef(state);
  currentStateRef.current = state;
  const dispatch = (action: InteractionAction<TClipboard>): void => {
    currentStateRef.current = interactionReducer(
      currentStateRef.current,
      action,
    );
    reactDispatch(action);
  };
  const componentPlacement = state.kind === "placing-component" ? state : null;
  const vddRailPlacement = state.kind === "placing-vdd-rail" ? state : null;
  const copyPlacement = state.kind === "copy-placement" ? state.copy : null;
  return {
    state,
    getCurrentState: () => currentStateRef.current,
    tool: interactionTool(state),
    pendingSymbolId: componentPlacement?.placement.symbolId ?? null,
    pendingComponentPlacement: componentPlacement?.placement ?? null,
    componentPlacementRotation: componentPlacement?.rotation ?? 0,
    componentPlacementMirror: componentPlacement?.mirror ?? "none",
    componentPreviewPoint:
      componentPlacement?.previewPoint ??
      vddRailPlacement?.previewPoint ??
      null,
    vddRailMode: vddRailPlacement !== null,
    vddRailNetName: vddRailPlacement?.netName ?? null,
    vddRailStart: vddRailPlacement?.start ?? null,
    copyPlacement,
    wireSource: state.kind === "wire" ? state.source : null,
    wireSourceRevision: state.kind === "wire" ? state.sourceRevision : null,
    wirePreviewPoint:
      state.kind === "wire" ? (state.preview?.point ?? null) : null,
    wirePreviewTarget: state.kind === "wire" ? state.preview : null,
    wireWaypoints:
      state.kind === "wire" ? state.steps.map((step) => step.point) : [],
    wireDraftSteps: state.kind === "wire" ? state.steps : [],
    wireRoutingMode: state.kind === "wire" ? state.routingMode : "orthogonal",
    wireCornerOrder: state.kind === "wire" ? state.cornerOrder : "auto",
    draftingSource: state.kind === "drawing" ? state.source : null,
    draftingHover: state.kind === "drawing" ? state.hover : null,
    draftingWaypoints: state.kind === "drawing" ? state.waypoints : [],
    draftingSnapPoint: state.kind === "drawing" ? state.snapPoint : null,
    setTool: (tool: EditorTool) => dispatch({ type: "activate-tool", tool }),
    beginComponentPlacement: (placement: PendingComponentPlacement) =>
      dispatch({ type: "place-component", placement }),
    setComponentPreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-component-preview", point }),
    rotateComponentPlacement: (deltaDegrees: 90 | -90) =>
      dispatch({ type: "rotate-component", deltaDegrees }),
    mirrorComponentPlacement: (direction: ScreenFlip) =>
      dispatch({ type: "mirror-component", direction }),
    beginVddRailPlacement: (netName: string) =>
      dispatch({ type: "begin-vdd-rail", netName }),
    setVddRailStart: (point: Point | null) =>
      dispatch({ type: "set-vdd-rail-start", point }),
    setVddRailPreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-vdd-rail-preview", point }),
    completeVddRailPlacement: () => dispatch({ type: "complete-vdd-rail" }),
    beginCopyPlacement: (clipboard: TClipboard, anchor: Point) =>
      dispatch({ type: "begin-copy-placement", clipboard, anchor }),
    setCopyPreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-copy-preview", point }),
    advanceCopyPlacement: () => dispatch({ type: "advance-copy-placement" }),
    rotateCopyPlacement: (deltaDegrees: 90 | -90) =>
      dispatch({ type: "rotate-copy", deltaDegrees }),
    mirrorCopyPlacement: (direction: ScreenFlip) =>
      dispatch({ type: "mirror-copy", direction }),
    beginSelectionMove: () => dispatch({ type: "begin-selection-move" }),
    setWireSource: (source: WireSource | null, sourceRevision: number | null) =>
      dispatch({ type: "set-wire-source", source, sourceRevision }),
    setWirePreview: (target: WireDraftTarget | null) =>
      dispatch({ type: "set-wire-preview", target }),
    setWireDraftSteps: (update: SetStateAction<WireDraftStep[]>) =>
      dispatch({ type: "set-wire-steps", update }),
    setWireWaypoints: (update: SetStateAction<Point[]>) =>
      dispatch({ type: "set-wire-waypoints", update }),
    setWireRoutingMode: (mode: WireRoutingMode) =>
      dispatch({ type: "set-wire-routing-mode", mode }),
    setWireCornerOrder: (cornerOrder: WireCornerOrder) =>
      dispatch({ type: "set-wire-corner-order", cornerOrder }),
    completeWire: () => dispatch({ type: "complete-wire" }),
    setDraftingSource: (point: Point | null) =>
      dispatch({ type: "set-drawing-source", point }),
    setDraftingHover: (point: Point | null) =>
      dispatch({ type: "set-drawing-hover", point }),
    setDraftingWaypoints: (update: SetStateAction<Point[]>) =>
      dispatch({ type: "set-drawing-waypoints", update }),
    setDraftingSnapPoint: (point: Point | null) =>
      dispatch({ type: "set-drawing-snap", point }),
    clearDraftingCreate: () => dispatch({ type: "clear-drawing" }),
    cancelInteraction: () => dispatch({ type: "cancel" }),
  };
}
