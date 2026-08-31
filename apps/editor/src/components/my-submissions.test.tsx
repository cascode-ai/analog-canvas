import { describe, expect, it } from "vitest";

import { recycledRemovalDate } from "./my-submissions";

describe("recycledRemovalDate", () => {
  it("names the day a withdrawn entry expires from the bin", () => {
    expect(recycledRemovalDate("2026-08-30T12:00:00.000Z")).toBe("2026-09-29");
  });
});
