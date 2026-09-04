import { describe, expect, it } from "vitest";

import { libraryProjectExamples } from "../examples/library-examples";
import { loadBundledGalleryTiles } from "./gallery-bundled-fallback";

describe("bundled Gallery starter tiles", () => {
  it("renders every bundled example, hierarchical Cells included", () => {
    // A Cell's block Symbol is derived from the Project that declares it, so
    // rendering a bundled example against the built-in catalogue alone throws
    // `Unresolved symbol`. That failure reaches a visitor as an empty
    // Gallery, which is why every example is rendered here rather than one.
    const tiles = loadBundledGalleryTiles();
    expect(tiles.map((tile) => tile.id)).toEqual(
      libraryProjectExamples.map((example) => example.id),
    );
    for (const tile of tiles) {
      expect(tile.svg, tile.id).toContain("<svg");
      expect(tile.name, tile.id).not.toBe("");
    }
    expect(
      libraryProjectExamples.some((example) =>
        example.project.documents.some((document) =>
          document.instances.some(
            (instance) => instance.netlist?.binding?.kind === "subcircuit",
          ),
        ),
      ),
      "a hierarchical example keeps this case honest",
    ).toBe(true);
  });
});
