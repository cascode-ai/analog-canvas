import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { headlessFontPlan } from "../../packages/exporters/src/headless-text.ts";
import { headlessRasterAssetFiles } from "./headless-bundle.mjs";

describe("headless bundle raster assets", () => {
  it("carries every font a local PNG may be drawn in, and resvg's module", () => {
    const { wasm, fonts } = headlessRasterAssetFiles();
    expect(existsSync(wasm)).toBe(true);
    // Every face a Document may choose, and the default one.
    const faces = ["metropolis", "serif", "sans", "latin-modern"].flatMap(
      (face) =>
        headlessFontPlan(
          `<svg xmlns="http://www.w3.org/2000/svg" data-text-face="${face}"/>`,
        ).files,
    );
    for (const font of faces) {
      const path = fonts[`${font.source}/${font.file}`];
      expect(path, `${font.source}/${font.file}`).toBeDefined();
      expect(existsSync(path)).toBe(true);
    }
  });
});
