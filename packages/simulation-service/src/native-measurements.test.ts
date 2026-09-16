import { describe, expect, it } from "vitest";
import {
  nativeMeasurementResults,
  nativeMeasurementsToCsv,
} from "./native-measurements.js";
import { SimulationOutputDataSchema } from "./contract.js";

describe("native measurement reports", () => {
  it("exports explicit units and unavailable values without inventing zero", () => {
    const csv = nativeMeasurementsToCsv([
      {
        name: 'peak,"quoted"',
        occurrence: 1,
        status: "available",
        value: 2.5,
        logLine: 4,
        detail: "source\nreport",
        unit: "V",
        origin: "postprocessor",
      },
      {
        name: "missing",
        occurrence: 0,
        status: "unavailable",
        detail: "no crossing",
        unit: "s",
      },
    ]);
    expect(csv).toContain(
      '"peak,""quoted""","1","available","2.5","V","postprocessor","4","source\nreport"',
    );
    expect(csv).toContain(
      '"missing","0","unavailable","","s","simulator","","no crossing"',
    );
  });
  it("exports formula-shaped text as literal text while retaining negative numbers", () => {
    const csv = nativeMeasurementsToCsv([
      {
        name: "=2+2",
        status: "available",
        value: -2.5,
        logLine: 1,
        occurrence: 1,
        detail: "report",
      },
    ]);
    expect(csv).toContain('"\'=2+2","1","available","-2.5"');
  });
  it("ignores unreachable measurement declarations and follows included source", () => {
    const result = nativeMeasurementResults(
      [
        { path: "run.cir", text: '* entry\n.include "active.spice"\n.end\n' },
        {
          path: "active.spice",
          text: ".control\nmeas ac peak MAX v(out)\n.endc\n",
        },
        {
          path: "unused.spice",
          text: ".control\nmeas ac ghost MAX v(out)\n.endc\n",
        },
      ],
      "run.cir",
      "peak = 4\nghost = 999\n",
    );
    expect(result).toMatchObject([{ name: "peak", value: 4 }]);
    expect(result).toHaveLength(1);
  });
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
