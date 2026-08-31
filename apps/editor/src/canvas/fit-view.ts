import type { DerivedRect, GridRect } from "@icm/model";

export interface CameraRectInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts renderer-derived bounds into the editor camera's grid-domain Rect.
 *
 * Rendering bounds may be fractional (text metrics, curves, and rotated
 * geometry), while the camera is deliberately constrained to integer grid
 * coordinates. Rounding outward preserves every visible pixel of the formal
 * scene without letting derived floats enter editor state.
 */
function assertFinitePositiveRect(
  bounds: CameraRectInput,
  grid: number,
  operation: string,
): void {
  if (
    !Number.isInteger(grid) ||
    grid <= 0 ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error(
      `${operation} requires finite positive bounds and an integer grid`,
    );
  }
}

/**
 * Sanitizes an editor viewport update. The camera is transient and stays
 * continuous — quantizing it to the Document grid made wheel zoom step and
 * the cursor anchor drift. Snapped pointer conversion still lands edits on
 * the grid; only the viewport itself may sit between grid lines. Values are
 * rounded to a fine fixed precision so float noise never accumulates.
 */
export function normalizeCameraRect(
  rect: CameraRectInput,
  grid: number,
): GridRect {
  assertFinitePositiveRect(rect, grid, "Camera normalization");
  const precise = (value: number) => Math.round(value * 1000) / 1000;
  return {
    x: precise(rect.x),
    y: precise(rect.y),
    width: Math.max(1, precise(rect.width)),
    height: Math.max(1, precise(rect.height)),
  };
}

/**
 * Converts renderer-derived bounds into the editor camera's grid-domain Rect.
 * Unlike ordinary camera normalization, fit expands outward so no formal
 * visual geometry is clipped.
 */
export function fitCameraToBounds(bounds: DerivedRect, grid: number): GridRect {
  assertFinitePositiveRect(bounds, grid, "Fit View");

  const x = Math.floor(bounds.x / grid) * grid;
  const y = Math.floor(bounds.y / grid) * grid;
  const right = Math.ceil((bounds.x + bounds.width) / grid) * grid;
  const bottom = Math.ceil((bounds.y + bounds.height) / grid) * grid;
  return {
    x,
    y,
    width: Math.max(grid, right - x),
    height: Math.max(grid, bottom - y),
  };
}

/** Pixels of the canvas element hidden behind a floating panel, per side. */
export interface CanvasInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far floating panels reach in over each edge of the canvas.
 *
 * Only a panel anchored to an edge can be avoided by insetting: one floating
 * in the middle of the canvas would cost the whole drawing its width to dodge,
 * which is worse than being overlapped. Edge panels are the docks, and they
 * are the ones wide enough to hide work behind.
 */
export function canvasInsetsFromOverlays(
  canvas: { x: number; y: number; width: number; height: number },
  overlays: readonly { x: number; y: number; width: number; height: number }[],
): CanvasInsets {
  const insets: CanvasInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  const canvasRight = canvas.x + canvas.width;
  const canvasBottom = canvas.y + canvas.height;
  const touches = 1;
  for (const overlay of overlays) {
    if (overlay.width <= 0 || overlay.height <= 0) continue;
    const right = overlay.x + overlay.width;
    const bottom = overlay.y + overlay.height;
    if (right <= canvas.x || overlay.x >= canvasRight) continue;
    if (bottom <= canvas.y || overlay.y >= canvasBottom) continue;
    if (overlay.x <= canvas.x + touches) {
      insets.left = Math.max(insets.left, right - canvas.x);
    } else if (right >= canvasRight - touches) {
      insets.right = Math.max(insets.right, canvasRight - overlay.x);
    } else if (overlay.y <= canvas.y + touches) {
      insets.top = Math.max(insets.top, bottom - canvas.y);
    } else if (bottom >= canvasBottom - touches) {
      insets.bottom = Math.max(insets.bottom, canvasBottom - overlay.y);
    }
  }
  return insets;
}

/**
 * Fit the Document into the part of the canvas nobody is standing on.
 *
 * The canvas element spans the whole workspace and the Properties dock floats
 * over its right-hand side, so fitting to the element put a slice of the
 * drawing underneath the panel — the wider the panel, the more went missing.
 * Fit centres the Document in the unobscured region instead.
 *
 * The camera is given the element's aspect ratio, so `xMidYMid meet` adds no
 * letterboxing of its own and the offset below lands exactly where intended.
 */
export function fitCameraToVisibleBounds(
  bounds: DerivedRect,
  grid: number,
  viewport: { width: number; height: number },
  insets: CanvasInsets,
): GridRect {
  assertFinitePositiveRect(bounds, grid, "Fit View");
  const visibleWidth = viewport.width - insets.left - insets.right;
  const visibleHeight = viewport.height - insets.top - insets.bottom;
  // Nothing to centre in: fall back to fitting the element itself rather than
  // inventing a camera from a non-positive region.
  if (
    !Number.isFinite(visibleWidth) ||
    !Number.isFinite(visibleHeight) ||
    visibleWidth <= 0 ||
    visibleHeight <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return fitCameraToBounds(bounds, grid);
  }

  // Pixels per Document unit that shows the whole drawing inside the region.
  const scale = Math.min(
    visibleWidth / bounds.width,
    visibleHeight / bounds.height,
  );
  const cameraWidth = viewport.width / scale;
  const cameraHeight = viewport.height / scale;
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  const cameraX = centreX - (insets.left + visibleWidth / 2) / scale;
  const cameraY = centreY - (insets.top + visibleHeight / 2) / scale;
  // Fit is a named landing point, not a gesture: it keeps the historical
  // Document-grid camera (wheel zoom is the path that stays continuous),
  // so a fresh fit always yields a grid-aligned integer camera.
  const snap = (value: number) => Math.round(value / grid) * grid;
  return normalizeCameraRect(
    {
      x: snap(cameraX),
      y: snap(cameraY),
      width: Math.max(grid, snap(cameraWidth)),
      height: Math.max(grid, snap(cameraHeight)),
    },
    grid,
  );
}

export interface CameraZoomLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export const CAMERA_ZOOM_LIMITS: CameraZoomLimits = {
  minWidth: 120,
  maxWidth: 5000,
  minHeight: 80,
  maxHeight: 3500,
};

export type CameraPanDirection = "left" | "right" | "up" | "down";

/**
 * Moves the camera by a screen-space distance.
 *
 * Keyboard navigation is expected to feel constant at every zoom level, so
 * its public step is measured in CSS pixels and converted here to Document
 * units. Positive x/y moves the viewport toward the right/bottom of the
 * schematic, matching wheel and middle-button camera semantics.
 */
export function panCameraByScreenPixels(
  current: GridRect,
  direction: CameraPanDirection,
  pixels: number,
  viewport: { width: number; height: number },
): GridRect {
  if (
    !Number.isFinite(pixels) ||
    pixels < 0 ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return current;
  }
  const dx = (pixels * current.width) / viewport.width;
  const dy = (pixels * current.height) / viewport.height;
  switch (direction) {
    case "left":
      return { ...current, x: current.x - dx };
    case "right":
      return { ...current, x: current.x + dx };
    case "up":
      return { ...current, y: current.y - dy };
    case "down":
      return { ...current, y: current.y + dy };
  }
}

/**
 * Scales the camera rect around a viewport-relative anchor (0..1 in each
 * axis), the shared core of cursor-anchored wheel zoom and center-anchored
 * button zoom. The anchor point stays fixed in world space.
 */
export function zoomCameraAtAnchor(
  current: GridRect,
  factor: number,
  anchor: { x: number; y: number },
  limits: CameraZoomLimits = CAMERA_ZOOM_LIMITS,
): GridRect {
  // Clamp the scale once for both axes so hitting a limit never distorts
  // the aspect ratio, and keep everything continuous: rounding here made
  // the point under the cursor drift on every wheel step.
  const scale = Math.max(
    Math.min(
      factor,
      limits.maxWidth / current.width,
      limits.maxHeight / current.height,
    ),
    limits.minWidth / current.width,
    limits.minHeight / current.height,
  );
  const width = current.width * scale;
  const height = current.height * scale;
  const anchorX = current.x + anchor.x * current.width;
  const anchorY = current.y + anchor.y * current.height;
  return {
    x: anchorX - anchor.x * width,
    y: anchorY - anchor.y * height,
    width,
    height,
  };
}
