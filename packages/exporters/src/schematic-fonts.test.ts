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
