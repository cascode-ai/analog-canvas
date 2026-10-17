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
    expect(of("#f8f8f8")).toBe("#f8f8f8");
    expect(of(undefined, "#fefefe")).toBe("#fefefe");
    // Any channel below 0xF8 is a color the sheet shows: a pale panel such
    // as #F0FDFA is drawn on purpose (2026-10-17).
    expect(of(undefined, "#f0fdfa")).toBeNull();
    expect(of("#f0f0f0")).toBeNull();
    expect(of("#f7ffff")).toBeNull();
    expect(of("#e0e0e0")).toBeNull();
    expect(of("#000000", "#ffcc00")).toBeNull();
    expect(of()).toBeNull();
    expect(draftingCoverColor(undefined)).toBeNull();
  });
});
