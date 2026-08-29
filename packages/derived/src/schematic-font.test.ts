import { describe, expect, it } from "vitest";

import {
  schematicRoundPeriodFontFaceCss,
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

  it("prepends the face without replacing the calibrated fallback stack", () => {
    expect(withSchematicRoundPeriodFont("'DejaVu Sans',Arial")).toBe(
      "'ICM Round Period','DejaVu Sans',Arial",
    );
  });
});
