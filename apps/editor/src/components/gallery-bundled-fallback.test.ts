import { describe, expect, it } from "vitest";

import { libraryProjectExamples } from "../examples/library-examples";
import { loadBundledGalleryTiles } from "./gallery-bundled-fallback";

describe("bundled Gallery starter tiles", () => {
  it("renders every bundled example, hierarchical Cells included", () => {
    // A Cell instance's artwork is derived from its Project, so a tile built
    // with the built-in library alone throws `Unresolved symbol` on the first
    // example that ships a subcircuit call.
    const tiles = loadBundledGalleryTiles();
    expect(tiles.map((tile) => tile.id)).toEqual(
      libraryProjectExamples.map((example) => example.id),
    );
    for (const tile of tiles) {
      expect(tile.svg, tile.id).toMatch(/^<svg\b/u);
      expect(tile.name.trim(), tile.id).not.toBe("");
    }
    expect(
      libraryProjectExamples.some((example) =>
        example.project.documents.some((document) =>
          document.instances.some(
            (instance) => instance.netlist?.binding?.kind === "subcircuit",
          ),
        ),
      ),
      "a hierarchical bundled example keeps this check honest",
    ).toBe(true);
  });
});
