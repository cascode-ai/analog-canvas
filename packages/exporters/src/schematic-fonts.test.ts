import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";

const BOLD = fileURLToPath(
  new URL("../fonts/ICMSchematic-Bold.ttf", import.meta.url),
);

/** The drawn width of one bold line in the shipped schematic face. */
function inkWidth(text: string): number {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200"><text x="10" y="150" font-family="ICM Schematic" font-weight="bold" font-size="100">${text}</text></svg>`;
  const box = new Resvg(svg, {
    font: { fontFiles: [BOLD], loadSystemFonts: false },
  }).innerBBox();
  return box?.width ?? 0;
}

describe("the schematic face", () => {
  it("gives the underscore its own width, so CMD_P does not draw it under the P", () => {
    // Metropolis kerns the underscore by a third of an em on each side; the
    // shipped faces map it to an unkerned copy. Width: about 0.68 em.
    expect(inkWidth("CMD_P") - inkWidth("CMDP")).toBeGreaterThan(60);
  });
});

const FACES = ["Regular", "Bold", "RegularItalic", "BoldItalic"].map((style) =>
  fileURLToPath(new URL(`../fonts/ICMSchematic-${style}.ttf`, import.meta.url)),
);

/** The ink box of `text` at 100 units in one shipped schematic face. */
function ink(text: string, face: string, weight: string, style: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="50" y="200" font-family="ICM Schematic" font-weight="${weight}" font-style="${style}" font-size="100">${text}</text></svg>`;
  const box = new Resvg(svg, {
    font: { fontFiles: [face], loadSystemFonts: false },
  }).innerBBox();
  if (!box) throw new Error(`${text} draws nothing`);
  return { top: 200 - box.y, bottom: box.y + box.height - 200 };
}

describe("Metropolis's Greek (#2619)", () => {
  it.each([
    [FACES[0]!, "normal", "normal"],
    [FACES[1]!, "bold", "normal"],
    [FACES[2]!, "normal", "italic"],
    [FACES[3]!, "bold", "italic"],
  ])("stands on Metropolis's lines in %s", (face, weight, style) => {
    // Capitals at the cap height, lower case at the x height, a descender
    // no deeper than p's: within a unit at 100.
    const latin = (text: string) => ink(text, face, weight, style);
    expect(ink("Φ", face, weight, style).top).toBeCloseTo(latin("H").top, 0);
    expect(ink("κ", face, weight, style).top).toBeCloseTo(latin("x").top, 0);
    expect(ink("φ", face, weight, style).bottom).toBeLessThanOrEqual(
      latin("p").bottom + 1,
    );
    expect(ink("ϕ", face, weight, style).bottom).toBeLessThanOrEqual(
      latin("p").bottom + 1,
    );
  });
});
