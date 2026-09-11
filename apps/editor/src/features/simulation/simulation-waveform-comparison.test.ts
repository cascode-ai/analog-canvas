import { describe, expect, it } from "vitest";

import type { SimulationComparisonRun } from "./simulation-run-comparison";
import { buildComparisonWaveforms } from "./simulation-waveform-comparison";

function run(
  id: string,
  domain: readonly number[],
  scale: number,
): SimulationComparisonRun {
  return {
    id,
    label: `Run ${id}`,
    inputRevision: `revision-${id}`,
    environment: { profileId: "sky130", corner: id },
    current: id === "ff",
    measurements: [],
    outputData: {
      schemaVersion: 1,
      diagnostics: [],
      analyses: [
        {
          analysis: "tran",
          plotName: "Transient",
          domain: { name: "Time", unit: "s", values: [...domain] },
          outputs: [
            {
              id: "vout",
              label: "Vout",
              unit: "V",
              values: domain.map((value) => value * scale),
            },
          ],
        },
      ],
    },
  };
}

describe("buildComparisonWaveforms", () => {
  it("requires a concrete record for repeated analyses rather than matching Plotname", () => {
    const first = run("tt", [0, 1], 1),
      second = run("ff", [0, 1], 2);
    const repeated = {
      ...first,
      outputData: {
        ...first.outputData,
        analyses: [
          ...first.outputData.analyses,
          ...run("other", [0, 1], 3).outputData.analyses,
        ],
      },
    };
    expect(buildComparisonWaveforms([repeated, second]).scalar).toEqual([]);
    const selected = buildComparisonWaveforms([
      { ...repeated, records: { tran: 1 } },
      second,
    ]);
    expect(selected.scalar[0]?.traces.map((trace) => trace.values)).toEqual([
      [0, 3],
      [0, 2],
    ]);
  });
  it("overlays matching outputs from separate runs with run-qualified labels", () => {
    const result = buildComparisonWaveforms([
      run("tt", [0, 1, 2], 1),
      run("ff", [0, 1, 2], 2),
    ]);
    expect(result.complex).toEqual([]);
    expect(result.scalar).toHaveLength(1);
    expect(result.scalar[0]?.traces).toHaveLength(2);
    expect(result.scalar[0]?.traces.map((trace) => trace.label)).toEqual([
      "Vout — Run tt · TT",
      "Vout — Run ff · FF",
    ]);
  });

  it("does not place incompatible sampled domains on one axis", () => {
    const result = buildComparisonWaveforms([
      run("short", [0, 1], 1),
      run("long", [0, 1, 2], 1),
    ]);
    expect(result.scalar).toEqual([]);
  });
});
