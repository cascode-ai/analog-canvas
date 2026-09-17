import { describe, expect, it } from "vitest";
import { formatSpecValues } from "./simulation-spec-format";

describe("Spec engineering presentation", () => {
  it.each([
    [36270500, "Ohm", "36.2705", "MΩ"],
    [4.38775e-15, "F", "4.38775", "fF"],
    [-1.25e-6, "A", "-1.25", "µA"],
    [0, "V", "0", "V"],
    [0.99999999, "V", "1", "V"],
    [1e-9, "V/s", "1e-9", "V/s"],
    [1e-9, "1", "1e-9", "1"],
    [0.2, "dB", "0.2", "dB"],
    [2, "", "2", "?"],
    [1e-300, "V", "1e-300", "V"],
    [1e300, "V", "1e+300", "V"],
  ])(
    "formats %s %s without guessing a quantity",
    (value, unit, result, displayUnit) => {
      expect(formatSpecValues(value, null, unit)).toEqual({
        result,
        condition: "—",
        unit: displayUnit,
      });
    },
  );
  it("uses one scale for result and condition, and never converts missing to zero", () => {
    expect(
      formatSpecValues(
        1.2e-6,
        { kind: "range", minimum: 1e-6, maximum: 2e-6 },
        "s",
      ),
    ).toEqual({ result: "1.2", condition: "[1, 2]", unit: "µs" });
    expect(
      formatSpecValues(
        null,
        { kind: "limit", operator: "<", value: 1e-6 },
        "s",
      ),
    ).toEqual({ result: "—", condition: "< 1", unit: "µs" });
    expect(
      formatSpecValues(
        1e6,
        { kind: "target", value: 1e6, tolerance: 1e3 },
        "Hz",
      ).condition,
    ).toBe("1 ± 0.001");
  });
  it("does not overflow or erase a finite condition when scales are far apart", () => {
    expect(
      formatSpecValues(
        1e18,
        { kind: "limit", operator: "<", value: 1e-320 },
        "V",
      ).condition,
    ).toBe("< 1e-320");
    expect(
      formatSpecValues(
        1e-18,
        { kind: "limit", operator: "<", value: 1e308 },
        "V",
      ).condition,
    ).toBe("< 1e+308");
  });
});
