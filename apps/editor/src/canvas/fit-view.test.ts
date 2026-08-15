import { describe, expect, it } from "vitest";

import {
  CAMERA_ZOOM_LIMITS,
  fitCameraToBounds,
  normalizeCameraRect,
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

  it("normalizes zoom, pan, and focus camera updates onto the grid", () => {
    expect(
      normalizeCameraRect(
        { x: 97.55, y: -43.2, width: 61.3, height: 16.7 },
        10,
      ),
    ).toEqual({ x: 100, y: -40, width: 60, height: 20 });
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

  it("clamps zoomed extents to the camera limits", () => {
    const shrunk = zoomCameraAtAnchor(
      { x: 0, y: 0, width: 100, height: 60 },
      0.5,
      { x: 0.5, y: 0.5 },
    );
    expect(shrunk.width).toBe(CAMERA_ZOOM_LIMITS.minWidth);
    expect(shrunk.height).toBe(CAMERA_ZOOM_LIMITS.minHeight);
    const grown = zoomCameraAtAnchor(
      { x: 0, y: 0, width: 4000, height: 3000 },
      4,
      { x: 0.5, y: 0.5 },
    );
    expect(grown.width).toBe(CAMERA_ZOOM_LIMITS.maxWidth);
    expect(grown.height).toBe(CAMERA_ZOOM_LIMITS.maxHeight);
  });
});
