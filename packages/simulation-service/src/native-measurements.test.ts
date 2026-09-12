import { describe, expect, it } from "vitest";
import { nativeMeasurementResults } from "./native-measurements.js";
import { SimulationOutputDataSchema } from "./contract.js";

describe("native measurement reports", () => {
  const files = [
    {
      path: "run.cir",
      text: "* test\n.control\nmeas tran peak MAX v(out)\nmeas ac bandwidth WHEN v(out)=1\n.endc\n",
    },
  ];
  it("preserves repeated reports without inventing a raw-plot association or recalculating", () => {
    const result = nativeMeasurementResults(
      files,
      "run.cir",
      "noise = 4\npeak = 1.2e-3 at=2e-6\npeak = 2.4e-3 at=3e-6\n",
    );
    expect(result).toMatchObject([
      { name: "peak", occurrence: 1, value: 0.0012, logLine: 2 },
      { name: "peak", occurrence: 2, value: 0.0024, logLine: 3 },
      { name: "bandwidth", status: "unavailable" },
    ]);
    expect(
      SimulationOutputDataSchema.safeParse({
        schemaVersion: 1,
        analyses: [],
        diagnostics: [],
        nativeMeasurements: result,
      }).success,
    ).toBe(true);
  });
  it("does not fabricate zero from missing or nonfinite evidence", () => {
    const result = nativeMeasurementResults(
      files,
      "run.cir",
      "peak = nan\nbandwidth = 1e999",
    );
    expect(result.every((item) => item.status === "unavailable")).toBe(true);
  });
});
