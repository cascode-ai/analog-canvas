import type { GridRect, Point } from "@icm/model";

import type { EditorTool } from "../interaction/interaction-state";
import { cameraDeltaFromScreen } from "./fit-view";

export interface BoxPreview {
  start: Point;
  end: Point;
  pointerId: number;
  intent: "select" | "zoom";
  /** Shift or Ctrl/Cmd was held: the box adds to the selection. */
  additive?: boolean;
}

export interface PanPreview {
  clientStart: Point;
  viewBoxStart: GridRect;
  pointerId: number;
  dragged: boolean;
}

export type CanvasGestureStart = "pan" | "select" | "zoom" | null;

export interface CanvasGestureStartContext {
  button: number;
  altKey: boolean;
  ctrlKey?: boolean;
  interactionKind: string;
  targetIsCanvas: boolean;
  placementPending: boolean;
  vddRailMode: boolean;
  copyPlacementPending: boolean;
  tool: EditorTool;
}

/** Decide which viewport gesture, if any, owns a pointer press. */
export function classifyCanvasGestureStart({
  button,
  altKey,
  ctrlKey = false,
  interactionKind,
  targetIsCanvas,
  placementPending,
  vddRailMode,
  copyPlacementPending,
  tool,
}: CanvasGestureStartContext): CanvasGestureStart {
  if (interactionKind === "moving-selection") return null;
  if (button === 1) return "pan";

  // macOS WebKit can report Control+left-press as button 2 with ctrlKey held.
  // Keep plain right-drag as frame-zoom while letting Ctrl+drag stay select.
  const ctrlSecondarySelect = button === 2 && ctrlKey && !altKey;
  const frameZoomDrag =
    (button === 2 && !ctrlSecondarySelect) || (button === 0 && altKey);
  const placementOwnsClick =
    placementPending || vddRailMode || copyPlacementPending;
  const draftingOwnsClick =
    tool === "wire" ||
    tool === "construction-line" ||
    tool === "arrow" ||
    tool === "polyline" ||
    tool === "rectangle" ||
    tool === "circle" ||
    tool === "arc";
  if (frameZoomDrag) {
    return !placementOwnsClick && !draftingOwnsClick && targetIsCanvas
      ? "zoom"
      : null;
  }
  if (
    (button !== 0 && !ctrlSecondarySelect) ||
    placementOwnsClick ||
    !targetIsCanvas
  )
    return null;
  return draftingOwnsClick ? null : "select";
}

export interface PanUpdate {
  preview: PanPreview;
  viewBox: GridRect;
}

/** Advance a middle-button pan only after its screen-space slop is crossed. */
export function updateCanvasPan(
  preview: PanPreview,
  client: Point,
  viewportSize: { width: number; height: number },
  thresholdPx: number,
): PanUpdate | null {
  const clientDx = client.x - preview.clientStart.x;
  const clientDy = client.y - preview.clientStart.y;
  const moved = Math.hypot(clientDx, clientDy) >= thresholdPx;
  if (!moved && !preview.dragged) return null;
  const delta = cameraDeltaFromScreen(
    preview.viewBoxStart,
    { x: clientDx, y: clientDy },
    viewportSize,
  );
  if (!delta) return null;
  return {
    preview: preview.dragged ? preview : { ...preview, dragged: true },
    viewBox: {
      ...preview.viewBoxStart,
      x: Math.round(preview.viewBoxStart.x - delta.x),
      y: Math.round(preview.viewBoxStart.y - delta.y),
    },
  };
}
