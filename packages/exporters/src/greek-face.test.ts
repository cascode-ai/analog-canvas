import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { greekGlyphs } from "./greek-coverage.generated.js";
import { metropolisGlyphs } from "./metropolis-coverage.generated.js";
import {
  METROPOLIS_UNICODE_RANGE,
  SCHEMATIC_GREEK_UNICODE_RANGE,
  schematicWebFontFaceCss,
} from "./browser-fonts.js";

/** A name record as a Windows face stores it: UTF-16 big-endian. */
function utf16(text: string): Buffer {
  return Buffer.from([...text].flatMap((char) => [0, char.charCodeAt(0)]));
}

describe("ICM Greek, Metropolis's Greek (#2619)", () => {
  it("serves Greek in the browser from the faces the PDF and PNG draw", () => {
    const rules = schematicWebFontFaceCss.split("@font-face").slice(1);
    const metropolis = rules.filter((rule) =>
      rule.includes('font-family:"Metropolis"'),
    );
    const greek = metropolis.filter((rule) => rule.includes("ICMGreek"));
    // Four styles each: Latin from Metropolis, Greek from ICM Greek, so the
    // browser never falls back to DejaVu Sans for Metropolis's Greek.
    expect(greek).toHaveLength(4);
    for (const rule of greek)
      expect(rule).toContain(`unicode-range:${SCHEMATIC_GREEK_UNICODE_RANGE}}`);
    for (const rule of metropolis.filter((rule) => !greek.includes(rule)))
      expect(rule).toContain(`unicode-range:${METROPOLIS_UNICODE_RANGE}}`);
    expect(METROPOLIS_UNICODE_RANGE).not.toContain("U+0370");
  });

  it("holds the Greek Metropolis lacks, the variant phi among it", () => {
    expect(greekGlyphs).toContain("ϕ");
    expect(greekGlyphs).toContain("φ");
    expect(greekGlyphs).toContain("Φ");
    expect(
      [...greekGlyphs].filter((g) => metropolisGlyphs.includes(g)),
    ).toEqual([]);
  });

  it.each(["Regular", "Bold", "Italic", "BoldItalic"])(
    "keeps DejaVu's copyright and licence under its own name in %s",
    (style) => {
      for (const file of [`ICMGreek-${style}.ttf`]) {
        const bytes = readFileSync(
          new URL(`../fonts/${file}`, import.meta.url),
        );
        expect(bytes.includes(utf16("ICM Greek"))).toBe(true);
        expect(bytes.includes(utf16("Bitstream Vera"))).toBe(true);
        expect(
          bytes.includes(utf16("DejaVu changes are in public domain")),
        ).toBe(true);
      }
    },
  );
});
