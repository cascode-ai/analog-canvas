import { describe, expect, it } from "vitest";

import {
  CAMERA_ZOOM_LIMITS,
  canvasInsetsFromOverlays,
  fitCameraToBounds,
  fitCameraToVisibleBounds,
  normalizeCameraRect,
  panCameraByScreenPixels,
  zoomCameraAtAnchor,
} from "./fit-view";

describe("fitCameraToBounds", () => {
  it("rounds fractional visual bounds outward to the editor grid", () => {
    expect(
      fitCameraToBounds({ x: 97.55, y: -43.2, width: 61.3, height: 16.7 }, 10),
    ).toEqual({ x: 90, y: -50, width: 70, height: 30 });
  });

  it("preserves an already aligned camera rectangle", () => {
    expect(
      fitCameraToBounds({ x: -40, y: 20, width: 960, height: 640 }, 10),
    ).toEqual({ x: -40, y: 20, width: 960, height: 640 });
  });

  it("keeps camera updates continuous instead of snapping to the grid", () => {
    // Snapping the camera made wheel zoom step and the cursor anchor
    // drift; the viewport may sit between grid lines.
    expect(
      normalizeCameraRect(
        { x: 97.55, y: -43.2, width: 61.3, height: 16.7 },
        10,
      ),
    ).toEqual({ x: 97.55, y: -43.2, width: 61.3, height: 16.7 });
  });

  it("rounds camera updates to a fine precision so float noise cannot accumulate", () => {
    expect(
      normalizeCameraRect(
        { x: 29.999999999999996, y: 0.0001, width: 100.00049, height: 50 },
        10,
      ),
    ).toEqual({ x: 30, y: 0, width: 100, height: 50 });
  });
});

describe("zoomCameraAtAnchor", () => {
  it("keeps the anchor point fixed in world space while zooming", () => {
    const current = { x: 0, y: 0, width: 1000, height: 600 };
    expect(zoomCameraAtAnchor(current, 0.5, { x: 0.25, y: 0.5 })).toEqual({
      x: 125,
      y: 150,
      width: 500,
      height: 300,
    });
  });

  it("treats a centered anchor as ordinary center zoom", () => {
    const current = { x: 100, y: 60, width: 800, height: 480 };
    const center = { x: 0.5, y: 0.5 };
    expect(zoomCameraAtAnchor(current, 0.5, center)).toEqual({
      x: 300,
      y: 180,
      width: 400,
      height: 240,
    });
    expect(zoomCameraAtAnchor(current, 2, center)).toEqual({
      x: -300,
      y: -180,
      width: 1600,
      height: 960,
    });
  });

  it("clamps zoomed extents to the camera limits without distorting aspect", () => {
    const shrunk = zoomCameraAtAnchor(
      { x: 0, y: 0, width: 100, height: 60 },
      0.5,
      { x: 0.5, y: 0.5 },
    );
    // The tighter limit wins for both axes so aspect ratio is preserved:
    // height hits minHeight (60 -> 80, scale 4/3) and width follows.
    expect(shrunk.height).toBe(CAMERA_ZOOM_LIMITS.minHeight);
    expect(shrunk.width).toBeCloseTo((100 * 4) / 3, 10);
    const grown = zoomCameraAtAnchor(
      { x: 0, y: 0, width: 4000, height: 3000 },
      4,
      { x: 0.5, y: 0.5 },
    );
    // maxHeight (3000 -> 3500, scale 7/6) binds before maxWidth.
    expect(grown.height).toBe(CAMERA_ZOOM_LIMITS.maxHeight);
    expect(grown.width).toBeCloseTo((4000 * 7) / 6, 10);
  });
});

describe("panCameraByScreenPixels", () => {
  it("keeps the keyboard step constant in screen space across zoom levels", () => {
    const viewport = { width: 800, height: 400 };
    expect(
      panCameraByScreenPixels(
        { x: 100, y: 200, width: 800, height: 400 },
        "right",
        48,
        viewport,
      ),
    ).toEqual({ x: 148, y: 200, width: 800, height: 400 });
    expect(
      panCameraByScreenPixels(
        { x: 100, y: 200, width: 400, height: 200 },
        "down",
        48,
        viewport,
      ),
    ).toEqual({ x: 100, y: 224, width: 400, height: 200 });
  });

  it("moves each direction without changing zoom", () => {
    const current = { x: 100, y: 200, width: 800, height: 400 };
    const viewport = { width: 800, height: 400 };
    expect(panCameraByScreenPixels(current, "left", 40, viewport)).toEqual({
      ...current,
      x: 60,
    });
    expect(panCameraByScreenPixels(current, "up", 40, viewport)).toEqual({
      ...current,
      y: 160,
    });
  });
});

describe("fit around floating panels", () => {
  const canvas = { x: 0, y: 82, width: 760, height: 780 };

  it("insets only for panels anchored to an edge", () => {
    expect(
      canvasInsetsFromOverlays(canvas, [
        // The Properties dock, open, on the right edge.
        { x: 410, y: 82, width: 350, height: 780 },
        // A floating menu in the middle: dodging it would cost more width
        // than being overlapped by it.
        { x: 200, y: 300, width: 158, height: 40 },
      ]),
    ).toEqual({ left: 0, right: 350, top: 0, bottom: 0 });
  });

  it("ignores a panel that is closed away to nothing", () => {
    expect(
      canvasInsetsFromOverlays(canvas, [
        { x: 760, y: 82, width: 0, height: 780 },
      ]),
    ).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("centres the drawing in what is left, not under the panel", () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 };
    const camera = fitCameraToVisibleBounds(
      bounds,
      10,
      { width: 760, height: 780 },
      { left: 0, right: 350, top: 0, bottom: 0 },
    );
    // 410px of canvas for 400 units, so 1.025 px per unit; the camera spans
    // the whole element at that scale.
    expect(camera.width).toBeCloseTo(740, -1);
    // The drawing's centre lands at the centre of the visible strip (205px),
    // not at the element's centre (380px), so nothing sits under the dock.
    const scale = 410 / 400;
    const centreOnScreen = (200 - camera.x) * scale;
    expect(centreOnScreen).toBeCloseTo(205, 0);
  });

  it("falls back to fitting the element when nothing is visible", () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 };
    expect(
      fitCameraToVisibleBounds(
        bounds,
        10,
        { width: 760, height: 780 },
        { left: 400, right: 400, top: 0, bottom: 0 },
      ),
    ).toEqual(fitCameraToBounds(bounds, 10));
  });
});
