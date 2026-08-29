import { describe, expect, it } from "vitest";

import { wheelEventLooksLikeTrackpad } from "./canvas-gesture-controller";

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
});
