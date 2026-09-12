import { describe, expect, it } from "vitest";

import type { Instance } from "@icm/model";

import {
  componentInputPolarity,
  componentInternalMark,
  symbolForInputPolarity,
  symbolForInternalMark,
} from "./component-visual-variants";

const instance = (symbolId: string, formula?: string): Instance => ({
  id: "X1",
  symbolId,
  placement: null,
  ...(formula ? { signalFlowParameters: { formula } } : {}),
});

describe("merged component visual variants", () => {
  it.each([
    ["opamp", "opamp-lettered"],
    ["opamp-inputs-swapped", "opamp-lettered-inputs-swapped"],
    ["opamp-differential", "opamp-differential-lettered"],
    [
      "opamp-differential-inputs-swapped",
      "opamp-differential-lettered-inputs-swapped",
    ],
    ["opamp-differential-crossed", "opamp-differential-crossed-lettered"],
    [
      "opamp-differential-crossed-inputs-swapped",
      "opamp-differential-crossed-lettered-inputs-swapped",
    ],
    ["voltage-amplifier", "voltage-amplifier-lettered"],
  ])("maps %s and %s through one internal-mark property", (plain, marked) => {
    expect(componentInternalMark(instance(plain))).toBe("none");
    expect(componentInternalMark(instance(marked))).toBe("A");
    expect(componentInternalMark(instance(marked, "G"))).toBe("G");
    expect(symbolForInternalMark(plain, "A")).toBe(marked);
    expect(symbolForInternalMark(plain, "G")).toBe(marked);
    expect(symbolForInternalMark(marked, "none")).toBe(plain);
  });

  it.each([
    ["comparator", "comparator-unmarked"],
    ["comparator-inputs-swapped", "comparator-unmarked-inputs-swapped"],
  ])("maps %s and %s through one polarity property", (marked, unmarked) => {
    expect(componentInputPolarity(marked)).toBe(true);
    expect(componentInputPolarity(unmarked)).toBe(false);
    expect(symbolForInputPolarity(marked, false)).toBe(unmarked);
    expect(symbolForInputPolarity(unmarked, true)).toBe(marked);
  });
});
