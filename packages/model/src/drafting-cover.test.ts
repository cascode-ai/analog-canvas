import { describe, expect, it } from "vitest";

import { draftingCoverColor } from "./drafting-cover.js";

describe("drafting that would cover the drawing (2026-10-13)", () => {
  it("is drawn in the white sheet's own color, stroke or fill", () => {
    const of = (color?: string, fillColor?: string) =>
      draftingCoverColor({
        styleOverride: {
          ...(color ? { color } : {}),
          ...(fillColor ? { fillColor } : {}),
        },
      });
    expect(of("#ffffff")).toBe("#ffffff");
    expect(of("#FFF")).toBe("#FFF");
    expect(of("#f0f0f0")).toBe("#f0f0f0");
    expect(of(undefined, "#fefefe")).toBe("#fefefe");
    // Any channel below 0xF0 is a color the sheet shows.
    expect(of("#efffff")).toBeNull();
    expect(of("#e0e0e0")).toBeNull();
    expect(of("#000000", "#ffcc00")).toBeNull();
    expect(of()).toBeNull();
    expect(draftingCoverColor(undefined)).toBeNull();
  });
});
