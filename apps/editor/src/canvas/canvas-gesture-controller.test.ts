import { describe, expect, it } from "vitest";

import {
  wheelEventIsMouseDetent,
  wheelEventLooksLikeTrackpad,
} from "./canvas-gesture-controller";

describe("wheelEventLooksLikeTrackpad", () => {
  it("classifies wheel sources by delta shape", () => {
    // Discrete mouse detents: integer verticals, no horizontal component.
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 0, deltaX: 0, deltaY: 120 }),
    ).toBe(false);
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 1, deltaX: 0, deltaY: 3 }),
    ).toBe(false);
    // Trackpads: horizontal component, fractional, or gentle steps.
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 0, deltaX: 4, deltaY: 12 }),
    ).toBe(true);
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 0, deltaX: 0, deltaY: 33.4 }),
    ).toBe(true);
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 0, deltaX: 0, deltaY: 8 }),
    ).toBe(true);
  });

  it("reads a detent-quantized wheelDeltaY as a mouse despite small deltas", () => {
    // macOS scroll acceleration shrinks a slow mouse detent's deltaY under
    // the small-step threshold, but Chromium/WebKit still stamp the detent
    // as wheelDeltaY = n*120 without the trackpad's 3:1 pixel ratio.
    expect(
      wheelEventLooksLikeTrackpad({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 4,
        wheelDeltaY: -120,
      }),
    ).toBe(false);
    expect(
      wheelEventIsMouseDetent({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 16,
        wheelDeltaY: -240,
      }),
    ).toBe(true);
    // A trackpad step that happens to land on 120 keeps the 3:1 ratio and
    // is not claimed as a detent.
    expect(
      wheelEventIsMouseDetent({
        deltaMode: 0,
        deltaX: 0,
        deltaY: 40,
        wheelDeltaY: -120,
      }),
    ).toBe(false);
    // A horizontal component is trackpad evidence regardless of quantizing.
    expect(
      wheelEventLooksLikeTrackpad({
        deltaMode: 0,
        deltaX: 4,
        deltaY: 40,
        wheelDeltaY: -120,
      }),
    ).toBe(true);
    // Firefox never exposes wheelDeltaY; the small-step reading holds.
    expect(
      wheelEventLooksLikeTrackpad({ deltaMode: 0, deltaX: 0, deltaY: 4 }),
    ).toBe(true);
  });
});
