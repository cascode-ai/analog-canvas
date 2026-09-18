import { describe, expect, it } from "vitest";

import { draftingPlacementGrid } from "./placement-grid";

describe("drafting placement grid", () => {
  it("places a rectangle on the electrical grid", () => {
    // A rectangle is a block outline somebody wires to. An edge half a cell
    // off the wire grid cannot be met by a wire at all: the wire lands on its
    // own grid and leaves a visible stub inside the outline.
    expect(draftingPlacementGrid("rectangle", 5, 10)).toBe(10);
    expect(draftingPlacementGrid("rectangle", 1, 20)).toBe(20);
  });

  it("leaves every other drawn object on the annotation pitch", () => {
    // This is where placing between grid points earns its keep: a label
    // beside a device, an arrow head at the exact spot it points to.
    for (const kind of ["text", "arrow", "line", "circle", "callout", null])
      expect(draftingPlacementGrid(kind, 5, 10)).toBe(5);
  });
});
