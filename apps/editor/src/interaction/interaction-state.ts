import { useReducer, useRef } from "react";
import type { SetStateAction } from "react";

import type { Mirror, Point } from "@icm/model";
import type { WireSource } from "@icm/edit-engine";

import {
  reflectOrientation,
  type PlacementOrientationOperation,
  type ScreenFlip,
} from "./shortcut-orientation";

export type { WireSource } from "@icm/edit-engine";

export type EditorTool =
  "pointer" | "wire" | "construction-line" | "arrow" | "rectangle";

export type DrawingTool = Extract<
  EditorTool,
  "construction-line" | "arrow" | "rectangle"
>;

export type InteractionMode = InteractionState<unknown>["kind"];

export interface PendingComponentPlacement {
  symbolId: string;
  properties: Record<string, string>;
  initialRotation: 0 | 90 | 180 | 270;
  showReference: boolean;
  referenceText: string | null;
}

export interface CopyPlacement<TClipboard> {
  clipboard: TClipboard;
  anchor: Point;
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
      start: Point | null;
      previewPoint: Point | null;
    }
  | {
      kind: "copy-placement";
      copy: CopyPlacement<TClipboard>;
    }
  | {
      kind: "wire";
      source: WireSource | null;
      sourceRevision: number | null;
      previewPoint: Point | null;
      waypoints: Point[];
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
  | { type: "begin-vdd-rail" }
  | { type: "set-vdd-rail-start"; point: Point | null }
  | { type: "set-vdd-rail-preview"; point: Point | null }
  | { type: "complete-vdd-rail" }
  | {
      type: "begin-copy-placement";
      clipboard: TClipboard;
      anchor: Point;
    }
  | { type: "set-copy-preview"; point: Point | null }
  | { type: "rotate-copy"; deltaDegrees: 90 | -90 }
  | { type: "mirror-copy"; direction: ScreenFlip }
  | {
      type: "set-wire-source";
      source: WireSource | null;
      sourceRevision: number | null;
    }
  | { type: "set-wire-preview"; point: Point | null }
  | { type: "set-wire-waypoints"; update: SetStateAction<Point[]> }
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
        previewPoint: null,
        waypoints: [],
      };
    case "arrow":
    case "construction-line":
    case "rectangle":
      return drawingState(tool);
  }
}

function sameComponentPlacement(
  left: PendingComponentPlacement,
  right: PendingComponentPlacement,
): boolean {
  if (
    left.symbolId !== right.symbolId ||
    left.initialRotation !== right.initialRotation ||
    left.showReference !== right.showReference ||
    left.referenceText !== right.referenceText
  ) {
    return false;
  }
  const leftEntries = Object.entries(left.properties);
  const rightEntries = Object.entries(right.properties);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right.properties[key] === value)
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
      return state.kind === "placing-vdd-rail"
        ? state
        : { kind: "placing-vdd-rail", start: null, previewPoint: null };
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
          previewPoint: null,
          orientationOperations: [],
        },
      };
    case "set-copy-preview":
      return state.kind === "copy-placement"
        ? { ...state, copy: { ...state.copy, previewPoint: action.point } }
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
        ? { ...state, previewPoint: action.point }
        : state;
    case "set-wire-waypoints":
      return state.kind === "wire"
        ? { ...state, waypoints: applyUpdate(state.waypoints, action.update) }
        : state;
    case "complete-wire":
      return state.kind === "wire"
        ? {
            kind: "wire",
            source: null,
            sourceRevision: null,
            previewPoint: null,
            waypoints: [],
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
    vddRailStart: vddRailPlacement?.start ?? null,
    copyPlacement,
    wireSource: state.kind === "wire" ? state.source : null,
    wireSourceRevision: state.kind === "wire" ? state.sourceRevision : null,
    wirePreviewPoint: state.kind === "wire" ? state.previewPoint : null,
    wireWaypoints: state.kind === "wire" ? state.waypoints : [],
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
    beginVddRailPlacement: () => dispatch({ type: "begin-vdd-rail" }),
    setVddRailStart: (point: Point | null) =>
      dispatch({ type: "set-vdd-rail-start", point }),
    setVddRailPreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-vdd-rail-preview", point }),
    completeVddRailPlacement: () => dispatch({ type: "complete-vdd-rail" }),
    beginCopyPlacement: (clipboard: TClipboard, anchor: Point) =>
      dispatch({ type: "begin-copy-placement", clipboard, anchor }),
    setCopyPreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-copy-preview", point }),
    rotateCopyPlacement: (deltaDegrees: 90 | -90) =>
      dispatch({ type: "rotate-copy", deltaDegrees }),
    mirrorCopyPlacement: (direction: ScreenFlip) =>
      dispatch({ type: "mirror-copy", direction }),
    setWireSource: (source: WireSource | null, sourceRevision: number | null) =>
      dispatch({ type: "set-wire-source", source, sourceRevision }),
    setWirePreviewPoint: (point: Point | null) =>
      dispatch({ type: "set-wire-preview", point }),
    setWireWaypoints: (update: SetStateAction<Point[]>) =>
      dispatch({ type: "set-wire-waypoints", update }),
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
