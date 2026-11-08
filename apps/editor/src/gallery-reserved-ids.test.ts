import { describe, expect, it } from "vitest";

import { isReservedGalleryId } from "./gallery-reserved-ids";

describe("reserved Gallery ids", () => {
  it("are short ids of a fixed rule, never a UUID or a dataset's id", () => {
    expect(isReservedGalleryId("ww5fnfambz")).toBe(true);
    for (const id of [
      "ww5fnfambx",
      "2f4b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
      "ct-0001",
    ])
      expect(isReservedGalleryId(id)).toBe(false);
  });
});
