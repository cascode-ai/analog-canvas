import { describe, expect, it } from "vitest";

import {
  OVERBAR_GAP_EM,
  OVERBAR_THICKNESS_EM,
  overbarGlyphTopEm,
  overbarLine,
  overbarLineSvg,
} from "./overbar.js";

describe("the shared overbar (#2619)", () => {
  it("is a solid bar about a stem thick, 1.5 units clear at label size", () => {
    // Label text is 15.116 units tall: a 1.2-unit bar, 1.5 units above the
    // capitals, where the font's overline was a 0.3-unit hairline.
    const line = overbarLine({
      left: 2,
      right: 12,
      top: -10,
      fontSize: 15.116,
    });
    expect(line.thickness).toBeCloseTo(1.209, 3);
    expect(OVERBAR_THICKNESS_EM * 15.116).toBeGreaterThan(1);
    expect(-10 - line.thickness / 2 - line.y).toBeCloseTo(
      OVERBAR_GAP_EM * 15.116,
      9,
    );
    expect(OVERBAR_GAP_EM * 15.116).toBeCloseTo(1.5, 1);
    expect([line.x1, line.x2]).toEqual([2, 12]);
  });

  it.each([
    ["CLK", 0.69],
    ["Φ", 0.69],
    ["PHIA", 0.69],
    ["S2", 0.69],
    ["Vout", 0.72],
    ["ϕ", 0.72],
    ["β", 0.72],
    ["φ", 0.53],
    ["x", 0.53],
    ["en", 0.53],
  ])("clears the tallest glyph of %s", (text, top) => {
    expect(overbarGlyphTopEm(text)).toBe(top);
  });

  it("fills a rectangle in its group's paint when given none", () => {
    expect(overbarLineSvg({ x1: 1, x2: 5, y: -12.5, thickness: 1.2 })).toBe(
      '<rect data-text-decoration="overbar" x="1" y="-13.1" width="4" height="1.2"/>',
    );
  });

  it("draws as one SVG line in the given paint", () => {
    expect(
      overbarLineSvg({ x1: 1, x2: 5, y: -12.5, thickness: 1.2 }, "#123456"),
    ).toBe(
      '<line data-text-decoration="overbar" x1="1" y1="-12.5" x2="5" y2="-12.5" stroke="#123456" stroke-width="1.2"/>',
    );
  });
});
