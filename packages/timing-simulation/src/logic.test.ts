import { describe, expect, it } from "vitest";

import {
  logicAnd,
  logicNot,
  logicOr,
  logicXor,
  resolveDrivers,
} from "./logic.js";

describe("four-state digital logic", () => {
  it("uses controlling values while preserving unknown inputs", () => {
    expect(logicAnd(["0", "X"])).toBe("0");
    expect(logicAnd(["1", "Z"])).toBe("X");
    expect(logicOr(["1", "X"])).toBe("1");
    expect(logicOr(["0", "Z"])).toBe("X");
    expect(logicNot("Z")).toBe("X");
    expect(logicXor(["1", "1", "1"])).toBe("1");
  });

  it("resolves floating, agreeing, and conflicting drivers", () => {
    expect(resolveDrivers([])).toBe("Z");
    expect(resolveDrivers(["Z", "1", "1"])).toBe("1");
    expect(resolveDrivers(["0", "1"])).toBe("X");
    expect(resolveDrivers(["0", "X"])).toBe("X");
  });
});
