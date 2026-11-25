import { describe, expect, it } from "vitest";

import { schematicLatinModernTextMetrics } from "../packages/derived/src/schematic-latin-modern-text-metrics.generated.ts";
import { schematicSansTextMetrics } from "../packages/derived/src/schematic-sans-text-metrics.generated.ts";
import { schematicSerifTextMetrics } from "../packages/derived/src/schematic-serif-text-metrics.generated.ts";
import { schematicTextMetrics } from "../packages/derived/src/schematic-text-metrics.generated.ts";
import { SCHEMATIC_FONT_UNICODE_RANGE } from "../packages/exporters/src/browser-fonts.ts";
import { SCHEMATIC_FONT_UNICODES } from "./generate-schematic-fonts.mjs";
import { greekGlyphs } from "../packages/exporters/src/greek-coverage.generated.ts";

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
    ["the sans", schematicSansTextMetrics],
    ["Latin Modern", schematicLatinModernTextMetrics],
  ])("holds every character %s label measurement measures", (_, table) => {
    const served = ranges(SCHEMATIC_FONT_UNICODE_RANGE);
    const missing = [...table.glyphs].filter((glyph) => {
      const point = glyph.codePointAt(0);
      return !served.some(([first, last]) => point >= first && point <= last);
    });
    expect(missing).toEqual([]);
  });
});

describe("Metropolis's Greek in the label tables (#2619)", () => {
  const advance = (glyph, style) =>
    schematicTextMetrics[style].advances[
      [...schematicTextMetrics.glyphs].indexOf(glyph)
    ];

  it("measures the variant letterforms a label may set, the variant phi among them", () => {
    for (const glyph of "ϑϕϖϰϱϵ") {
      expect(schematicTextMetrics.glyphs).toContain(glyph);
      expect(greekGlyphs).toContain(glyph);
    }
  });

  it("measures Greek in ICM Greek, drawn to Metropolis's size", () => {
    // DejaVu Sans Bold sets Φ 0.850 em wide and φ 0.782; ICM Greek scales
    // them to Metropolis's cap and x heights.
    expect(advance("Φ", "bold")).toBeCloseTo(0.801, 3);
    expect(advance("φ", "boldItalic")).toBeCloseTo(0.739, 3);
    expect(advance("ϕ", "plain")).toBeCloseTo(0.624, 3);
    // Latin stays Metropolis's own.
    expect(advance("P", "bold")).toBeCloseTo(0.672, 3);
  });
});
