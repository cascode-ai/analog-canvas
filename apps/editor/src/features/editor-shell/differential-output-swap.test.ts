import { describe, expect, it } from "vitest";

import { differentialOutputSibling } from "./differential-output-swap";

describe("differential output swap", () => {
  it.each([
    ["opamp-differential", "opamp-differential-crossed"],
    [
      "opamp-differential-inputs-swapped",
      "opamp-differential-crossed-inputs-swapped",
    ],
    ["opamp-differential-lettered", "opamp-differential-crossed-lettered"],
    [
      "opamp-differential-lettered-inputs-swapped",
      "opamp-differential-crossed-lettered-inputs-swapped",
    ],
  ] as const)("pairs %s with %s in both directions", (ordinary, crossed) => {
    expect(differentialOutputSibling(ordinary)).toBe(crossed);
    expect(differentialOutputSibling(crossed)).toBe(ordinary);
  });

  it("offers no output swap on a single-output part", () => {
    expect(differentialOutputSibling("opamp")).toBeUndefined();
    expect(differentialOutputSibling("resistor")).toBeUndefined();
  });
});
