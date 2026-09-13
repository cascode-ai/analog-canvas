import { describe, expect, it } from "vitest";

import type { Instance } from "@icm/model";

import {
  componentInputPolarity,
  componentInputsSwapped,
  componentInternalMark,
  componentOutputsSwapped,
  symbolForInputPolarity,
  symbolForInputsSwapped,
  symbolForInternalMark,
  symbolForOutputsSwapped,
} from "./component-visual-variants";

const instance = (symbolId: string, formula?: string): Instance => ({
  id: "X1",
  symbolId,
  placement: null,
  ...(formula ? { signalFlowParameters: { formula } } : {}),
});

describe("merged component visual variants", () => {
  it.each([
    "opamp",
    "opamp-lettered",
    "comparator",
    "comparator-unmarked",
    "differential-transconductance",
    "opamp-differential",
    "opamp-differential-lettered",
    "opamp-differential-crossed",
    "opamp-differential-crossed-lettered",
  ])(
    "reads and sets both input states for %s without changing outputs",
    (normal) => {
      const swapped = `${normal}-inputs-swapped`;
      expect(componentInputsSwapped(normal)).toBe(false);
      expect(componentInputsSwapped(swapped)).toBe(true);
      for (const source of [normal, swapped]) {
        expect(symbolForInputsSwapped(source, false)).toBe(normal);
        expect(symbolForInputsSwapped(source, true)).toBe(swapped);
      }
      expect(componentOutputsSwapped(swapped)).toBe(
        componentOutputsSwapped(normal),
      );
    },
  );

  it.each([
    ["opamp-differential", "opamp-differential-crossed"],
    ["opamp-differential-lettered", "opamp-differential-crossed-lettered"],
    [
      "opamp-differential-inputs-swapped",
      "opamp-differential-crossed-inputs-swapped",
    ],
    [
      "opamp-differential-lettered-inputs-swapped",
      "opamp-differential-crossed-lettered-inputs-swapped",
    ],
  ])(
    "reads and sets both output states for %s without changing inputs",
    (normal, swapped) => {
      expect(componentOutputsSwapped(normal)).toBe(false);
      expect(componentOutputsSwapped(swapped)).toBe(true);
      for (const source of [normal, swapped]) {
        expect(symbolForOutputsSwapped(source, false)).toBe(normal);
        expect(symbolForOutputsSwapped(source, true)).toBe(swapped);
      }
      expect(componentInputsSwapped(swapped)).toBe(
        componentInputsSwapped(normal),
      );
    },
  );

  it.each([
    "resistor",
    "voltage-amplifier",
    "custom-inputs-swapped",
    "custom-crossed",
  ])("does not infer swap capabilities from the name %s", (symbolId) => {
    expect(componentInputsSwapped(symbolId)).toBeUndefined();
    expect(componentOutputsSwapped(symbolId)).toBeUndefined();
    for (const state of [false, true]) {
      expect(symbolForInputsSwapped(symbolId, state)).toBeUndefined();
      expect(symbolForOutputsSwapped(symbolId, state)).toBeUndefined();
    }
  });

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
