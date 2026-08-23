import { describe, expect, it } from "vitest";

import { foldNetName } from "./net-name.js";

describe("Net name identity", () => {
  it("folds only the comparison key and preserves the authored spelling", () => {
    expect(foldNetName("  VdD  ")).toBe("vdd");
  });
});
