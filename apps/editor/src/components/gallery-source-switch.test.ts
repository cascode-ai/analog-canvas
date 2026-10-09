import { describe, expect, it } from "vitest";

import { offeredGallerySources } from "./gallery-source-switch";

describe("offeredGallerySources", () => {
  const sources = [
    { key: "analoggenie", count: 51 },
    { key: "circuitthink", count: 0 },
    { key: "amsnet", count: 0 },
  ];
  const keys = (items: { key: string }[]) => items.map((item) => item.key);

  it("offers a reader only the datasets that hold circuits, the Owner every one (#1510)", () => {
    expect(keys(offeredGallerySources(sources, null, false))).toEqual([
      "analoggenie",
    ]);
    expect(keys(offeredGallerySources(sources, "amsnet", false))).toEqual([
      "analoggenie",
      "amsnet",
    ]);
    expect(keys(offeredGallerySources(sources, null, true))).toEqual([
      "analoggenie",
      "circuitthink",
      "amsnet",
    ]);
  });
});
