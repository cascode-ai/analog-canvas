import { describe, expect, it } from "vitest";

import {
  classifyWheelSource,
  WHEEL_PAN_HINT,
  wheelPanHint,
} from "./canvas-gesture-controller";

it("says once how to zoom when the wheel pans as a trackpad does (#1898)", () => {
  expect(wheelPanHint()).toBe(WHEEL_PAN_HINT);
  expect(WHEEL_PAN_HINT).toContain("Ctrl+wheel zooms");
  expect(wheelPanHint()).toBeNull();
});

/**
 * Signatures taken from what each engine actually reports. The point of
 * these cases is that no verdict rests on the size of a delta: a slowly
 * turned or high-resolution wheel emits exactly the small values a
 * trackpad does, which is why "unknown" is a permitted answer.
 */
describe("classifyWheelSource", () => {
  it("reads line and page modes as a wheel", () => {
    // Firefox reports a mouse wheel in lines, a trackpad in pixels.
    expect(classifyWheelSource({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(
      "mouse",
    );
    expect(classifyWheelSource({ deltaMode: 2, deltaX: 0, deltaY: 1 })).toBe(
      "mouse",
    );
  });

  it("reads a detent-quantized wheelDeltaY as a wheel however small its deltaY", () => {
    // Chromium/WebKit stamp a detent as a multiple of 120 even when macOS
    // acceleration shrinks the normalized deltaY to a handful of pixels.
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 4,
        wheelDeltaY: -120,
      }),
    ).toBe("mouse");
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 100,
        wheelDeltaY: -240,
      }),
    ).toBe("mouse");
  });

  it("reads the trackpad's fixed 3:1 ratio as a surface", () => {
    // A precise surface keeps wheelDeltaY = -3 * deltaY, including where
    // the product happens to land on a multiple of 120.
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 40,
        wheelDeltaY: -120,
      }),
    ).toBe("trackpad");
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 7,
        wheelDeltaY: -21,
      }),
    ).toBe("trackpad");
  });

  it("no longer reads a detent at another page zoom as a surface (#2169)", () => {
    // Chromium at 90% and 75% page zoom: deltaY = 100 / zoom, wheelDeltaY
    // derived from it at 1.2, so the detent is neither whole nor a multiple
    // of 120 — the case that read as a trackpad and panned. "unknown" zooms
    // unless a trackpad gesture is under way.
    for (const [deltaY, wheelDeltaY] of [
      [111.11111, -133],
      [133.33333, -160],
      [125, -150],
    ] as const)
      expect(
        classifyWheelSource({ deltaMode: 0, deltaX: 0, deltaY, wheelDeltaY }),
      ).toBe("unknown");
    // Small momentum steps and two-axis swipes near that ratio stay a
    // surface.
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 0.33,
        wheelDeltaY: -1,
      }),
    ).toBe("trackpad");
    expect(
      classifyWheelSource({
        deltaMode: 0,
        deltaX: 3,
        deltaY: 4.5,
        wheelDeltaY: -5,
      }),
    ).toBe("trackpad");
  });

  it("reads two axes or sub-pixel precision as a surface", () => {
    expect(classifyWheelSource({ deltaMode: 0, deltaX: 4, deltaY: 12 })).toBe(
      "trackpad",
    );
    expect(classifyWheelSource({ deltaMode: 0, deltaX: 0, deltaY: 33.4 })).toBe(
      "trackpad",
    );
  });

  it("admits it cannot tell when the engine offers no evidence", () => {
    // Firefox exposes no wheelDeltaY, so a plain vertical integer scroll
    // carries nothing that separates a high-resolution wheel from a
    // trackpad. Guessing "trackpad" here is what made a mouse pan.
    expect(classifyWheelSource({ deltaMode: 0, deltaX: 0, deltaY: 8 })).toBe(
      "unknown",
    );
    expect(classifyWheelSource({ deltaMode: 0, deltaX: 0, deltaY: 120 })).toBe(
      "unknown",
    );
    expect(classifyWheelSource({ deltaMode: 0, deltaX: 0, deltaY: 0 })).toBe(
      "unknown",
    );
  });
});
