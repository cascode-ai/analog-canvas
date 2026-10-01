import { describe, expect, it } from "vitest";

import { validateDeviceParameters } from "./parameter-validation.js";
import { deviceDescriptor } from "./registry.js";

const source = deviceDescriptor("voltage-source")!;
const issues = (parameters: Record<string, string>) =>
  validateDeviceParameters(source, parameters);

describe("device parameter values (#1268)", () => {
  it("takes the SPICE numbers and expressions the exporter writes", () => {
    for (const value of [
      "1k",
      "2.5n",
      "-0.5",
      "1e-3",
      "5ns",
      "1meg",
      // ngspice 46 reads trailing unit letters and reads 9kΩ as 9k.
      "9kΩ",
      "{vdd/2}",
      "'vdd/2'",
      "",
    ])
      expect(issues({ frequency: value }), value).toEqual([]);
  });

  it("refuses a quantity that is neither", () => {
    for (const value of ["banana", "1 k", "0.5*vdd", "vdd", "1µ"])
      expect(issues({ frequency: value }), value).toEqual([
        { kind: "number", name: "frequency", value },
      ]);
  });

  it("leaves a point list to the source compiler", () => {
    expect(issues({ pwlPoints: "0s 0, 1ns 0, 2ns 1" })).toEqual([]);
  });

  it("names the parameter a misspelled one most likely meant", () => {
    expect(issues({ freq: "2k" })).toEqual([
      { kind: "unknown", name: "freq", suggestion: "frequency" },
    ]);
    expect(issues({ amplitdue: "1" })).toEqual([
      { kind: "unknown", name: "amplitdue", suggestion: "amplitude" },
    ]);
    expect(issues({ banana: "1" })).toEqual([
      { kind: "unknown", name: "banana" },
    ]);
  });
});
