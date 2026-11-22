import { describe, expect, it } from "vitest";

import { normalizedStyleOverrides, styleOverrideDraft } from "./style-knobs";

describe("style knobs", () => {
  it("treats a factor of 1 as the profile default and writes nothing", () => {
    expect(
      normalizedStyleOverrides({
        fontScale: 1,
        wireStrokeScale: 1,
        symbolStrokeScale: 1,
        annotationStrokeScale: 1,
        junctionRadiusScale: 1,
      }),
    ).toBeNull();
  });

  it("persists only the factors that moved", () => {
    expect(
      normalizedStyleOverrides({
        fontScale: 1.5,
        wireStrokeScale: 1,
        symbolStrokeScale: 1,
        annotationStrokeScale: 1,
        junctionRadiusScale: 0.5,
      }),
    ).toEqual({ fontScale: 1.5, junctionRadiusScale: 0.5 });
  });

  it("normalizes an absent override back to 1", () => {
    expect(styleOverrideDraft(undefined).fontScale).toBe(1);
    expect(styleOverrideDraft({ fontScale: 2 }).wireStrokeScale).toBe(1);
  });
});
