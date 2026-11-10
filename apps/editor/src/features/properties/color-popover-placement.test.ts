import { describe, expect, it } from "vitest";

import { colorPopoverPlacement } from "./color-popover-placement";

// The issue's Text color settings: 188.5 × 130.9 under a swatch near the
// Properties panel's right edge.
const size = { width: 188.5, height: 130.9 };
const swatch = { left: 755, top: 330, right: 769, bottom: 346 };

describe("color settings placement (#2181)", () => {
  it("stands under the swatch, right edges aligned, while it fits", () => {
    expect(
      colorPopoverPlacement({
        anchor: swatch,
        size,
        viewport: { width: 900, height: 800 },
      }),
    ).toEqual({ left: 769 - 188.5, top: 352 });
  });

  it("stays inside a window that shrank to a landscape phone", () => {
    // 900×800 → 667×375: the panel reflows, its swatch now near the bottom.
    const placement = colorPopoverPlacement({
      anchor: { left: 640, top: 300, right: 654, bottom: 316 },
      size,
      viewport: { width: 667, height: 375 },
    })!;
    expect(placement.left + size.width).toBeLessThanOrEqual(667 - 8);
    expect(placement.top + size.height).toBeLessThanOrEqual(375 - 8);
    // Above the swatch, not over it.
    expect(placement.top + size.height).toBeLessThanOrEqual(300);
  });

  it("clamps into the margin when neither side has room", () => {
    expect(
      colorPopoverPlacement({
        anchor: { left: 100, top: 60, right: 114, bottom: 76 },
        size,
        viewport: { width: 150, height: 140 },
      }),
    ).toEqual({ left: 8, top: 8 });
  });

  it("closes when the swatch leaves the window or its scrolled panel", () => {
    expect(
      colorPopoverPlacement({
        anchor: swatch,
        size,
        viewport: { width: 667, height: 320 },
      }),
    ).toBeNull();
    expect(
      colorPopoverPlacement({
        anchor: swatch,
        size,
        viewport: { width: 900, height: 800 },
        visible: { left: 600, top: 400, right: 900, bottom: 800 },
      }),
    ).toBeNull();
  });
});
