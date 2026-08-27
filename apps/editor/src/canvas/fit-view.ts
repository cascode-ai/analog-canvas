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
 * Quantizes an editor viewport to the current Document grid. Camera is
 * transient, but retaining the same grid contract prevents it from becoming a
 * covert float path into SVG rendering and pointer conversion.
 */
export function normalizeCameraRect(
  rect: CameraRectInput,
  grid: number,
): GridRect {
  assertFinitePositiveRect(rect, grid, "Camera normalization");
  const snap = (value: number) => Math.round(value / grid) * grid;
  return {
    x: snap(rect.x),
    y: snap(rect.y),
    width: Math.max(grid, snap(rect.width)),
    height: Math.max(grid, snap(rect.height)),
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
  return normalizeCameraRect(
    { x: cameraX, y: cameraY, width: cameraWidth, height: cameraHeight },
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
  const width = Math.max(
    limits.minWidth,
    Math.min(limits.maxWidth, Math.round(current.width * factor)),
  );
  const height = Math.max(
    limits.minHeight,
    Math.min(limits.maxHeight, Math.round(current.height * factor)),
  );
  const anchorX = current.x + anchor.x * current.width;
  const anchorY = current.y + anchor.y * current.height;
  return {
    x: Math.round(anchorX - anchor.x * width),
    y: Math.round(anchorY - anchor.y * height),
    width,
    height,
  };
}
