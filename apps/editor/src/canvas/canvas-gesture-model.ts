import type { GridRect, Point } from "@icm/model";

import type { EditorTool } from "../interaction/interaction-state";
import { cameraDeltaFromScreen } from "./fit-view";

export interface BoxPreview {
  start: Point;
  end: Point;
  pointerId: number;
  intent: "select" | "zoom";
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
  interactionKind,
  targetIsCanvas,
  placementPending,
  vddRailMode,
  copyPlacementPending,
  tool,
}: CanvasGestureStartContext): CanvasGestureStart {
  if (interactionKind === "moving-selection") return null;
  if (button === 1) return "pan";

  const frameZoomDrag = button === 2 || (button === 0 && altKey);
  const placementOwnsClick =
    placementPending || vddRailMode || copyPlacementPending;
  const draftingOwnsClick =
    tool === "wire" ||
    tool === "construction-line" ||
    tool === "arrow" ||
    tool === "polyline" ||
    tool === "rectangle" ||
    tool === "circle";
  if (frameZoomDrag) {
    return !placementOwnsClick && !draftingOwnsClick && targetIsCanvas
      ? "zoom"
      : null;
  }
  if (button !== 0 || placementOwnsClick || !targetIsCanvas) return null;
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
