import { describe, expect, it } from "vitest";

import { schematicSerifTextMetrics } from "../packages/derived/src/schematic-serif-text-metrics.generated.ts";
import { schematicTextMetrics } from "../packages/derived/src/schematic-text-metrics.generated.ts";
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

  it.each([
    ["Metropolis", schematicTextMetrics],
    ["the serif", schematicSerifTextMetrics],
  ])("holds every character %s label measurement measures", (_, table) => {
    const served = ranges(SCHEMATIC_FONT_UNICODE_RANGE);
    const missing = [...table.glyphs].filter((glyph) => {
      const point = glyph.codePointAt(0);
      return !served.some(([first, last]) => point >= first && point <= last);
    });
    expect(missing).toEqual([]);
  });
});
