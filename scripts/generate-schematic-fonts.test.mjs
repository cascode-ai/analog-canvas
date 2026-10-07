import { describe, expect, it } from "vitest";

import { SCHEMATIC_MEASURED_GLYPHS } from "../packages/derived/src/fraction-text-metrics.ts";
import { SCHEMATIC_FONT_UNICODE_RANGE } from "../packages/exporters/src/browser-fonts.ts";
import { SCHEMATIC_FONT_UNICODES } from "./generate-schematic-fonts.mjs";

/** The [first, last] code points of a CSS unicode-range list. */
function ranges(list) {
  return list.split(",").map((range) => {
    const [first, last = first] = range.trim().slice(2).split("-");
    return [Number.parseInt(first, 16), Number.parseInt(last, 16)];
  });
}

describe("the served schematic font (#1413)", () => {
  it("declares the characters its generator subsets", () => {
    expect(SCHEMATIC_FONT_UNICODE_RANGE).toBe(
      SCHEMATIC_FONT_UNICODES.join(","),
    );
  });

  it("holds every character label measurement measures", () => {
    const served = ranges(SCHEMATIC_FONT_UNICODE_RANGE);
    const missing = [...SCHEMATIC_MEASURED_GLYPHS].filter((glyph) => {
      const point = glyph.codePointAt(0);
      return !served.some(([first, last]) => point >= first && point <= last);
    });
    expect(missing).toEqual([]);
  });
});
