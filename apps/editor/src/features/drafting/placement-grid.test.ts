import { describe, expect, it } from "vitest";

import { draftingPlacementGrid } from "./placement-grid";

describe("drafting placement grid", () => {
  it("leaves every other drawn object on the annotation pitch", () => {
    // This is where placing between grid points earns its keep: a label
    // beside a device, an arrow head at the exact spot it points to.
    for (const kind of ["text", "arrow", "line", "circle", "callout", null])
      expect(draftingPlacementGrid(kind, 5, 10)).toBe(5);
  });
});
