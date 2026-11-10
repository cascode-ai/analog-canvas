import { describe, expect, it } from "vitest";

import {
  schematicRoundPeriodFontFaceCss,
  schematicRoundPeriodFontFaceCssFor,
  withSchematicRoundPeriodFont,
} from "./schematic-font.js";

describe("schematic round-period face", () => {
  it("covers only the canonical full stop in every house text style", () => {
    expect(schematicRoundPeriodFontFaceCss).toContain("unicode-range:U+002E");
    expect(schematicRoundPeriodFontFaceCss.match(/@font-face/gu)).toHaveLength(
      4,
    );
    expect(schematicRoundPeriodFontFaceCss).toContain(
      "font-weight:700;font-style:italic",
    );
  });

  it("embeds in a drawing only the faces its text uses (#2214)", () => {
    const faces = (markup: string) =>
      schematicRoundPeriodFontFaceCssFor(markup).match(/@font-face/gu)
        ?.length ?? 0;
    // No full stop in any text: no face, whatever the attributes say.
    expect(faces('<text x="1.5" font-style="italic">R1</text>')).toBe(0);
    expect(faces('<text x="1.5">1.2k</text>')).toBe(1);
    expect(faces('<text font-style="italic">1.2k</text>')).toBe(2);
    expect(
      faces('<text style="font-weight:700;font-style:italic">1.2k</text>'),
    ).toBe(4);
    // The glyph's data is written once per face, never more.
    const css = schematicRoundPeriodFontFaceCssFor("<text>1.2k</text>");
    expect(css.split("base64,").length - 1).toBe(1);
  });

  it("prepends the face without replacing the calibrated fallback stack", () => {
    expect(withSchematicRoundPeriodFont("'DejaVu Sans',Arial")).toBe(
      "'ICM Round Period','DejaVu Sans',Arial",
    );
  });
});
