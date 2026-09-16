import { describe, expect, it } from "vitest";
import { VACASK_MEASUREMENT_PREFIX as prefix } from "@icm/netlist";
import { vacaskMeasurementResults } from "./vacask-measurements.js";
import { SimulationOutputDataSchema } from "./contract.js";

const line = (report: unknown) => prefix + JSON.stringify(report);
const available = (name: string, value = 1) => ({
  name,
  status: "available",
  value,
  unit: "V",
});
describe("native VACASK postprocessor scalar evidence", () => {
  it("keeps exact names, units, repeated occurrences and log evidence", () => {
    const result = vacaskMeasurementResults(
      [
        "gain = 999",
        line(available("Gain")),
        line(available("gain", 2)),
        line(available("Gain", 3)),
        line({
          name: "missing",
          status: "unavailable",
          detail: "No crossing",
          unit: "s",
        }),
      ].join("\n"),
    );
    expect(result.measurements).toMatchObject([
      {
        name: "Gain",
        occurrence: 1,
        value: 1,
        logLine: 2,
        unit: "V",
        origin: "postprocessor",
      },
      { name: "gain", occurrence: 1, value: 2, logLine: 3 },
      { name: "Gain", occurrence: 2, value: 3, logLine: 4 },
      {
        name: "missing",
        occurrence: 0,
        status: "unavailable",
        detail: "No crossing",
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(
      SimulationOutputDataSchema.safeParse({
        schemaVersion: 1,
        analyses: [],
        nativeMeasurements: result.measurements,
        diagnostics: result.diagnostics,
      }).success,
    ).toBe(true);
  });
  it("does not let bad, nonfinite or truncated reports discard valid neighbors", () => {
    const result = vacaskMeasurementResults(
      [
        line(available("first")),
        prefix + '{"name":"broken"',
        line(available("infinite", Infinity)),
        line({ ...available("forged"), logLine: 1 }),
        prefix + "x".repeat(16384),
        line(available("last", 7)),
      ].join("\n"),
    );
    expect(result.measurements.map((m) => m.name)).toEqual(["first", "last"]);
    expect(result.diagnostics).toHaveLength(4);
    expect(result.diagnostics[0]?.message).toContain("Console line 2");
  });
  it("withholds scalar certification when electrical input was dropped", () => {
    const result = vacaskMeasurementResults(
      line(available("wrong-circuit", 42)),
      false,
    );
    expect(result.measurements).toEqual([
      {
        name: "wrong-circuit",
        status: "unavailable",
        occurrence: 0,
        unit: "V",
        origin: "postprocessor",
        detail: "Reported value withheld because the simulator dropped input.",
      },
    ]);
  });
});
