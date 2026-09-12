import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { readSimulationData } from "@icm/spice-run";
import {
  evaluateSimulationOutputs,
  simulationOutputAnalysisToCsv,
} from "./output-evaluation.js";
import { SimulationOutputDataSchema } from "./contract.js";
describe("scalar output projection", () => {
  it("never derives curve measurements from raw scalar padding and preserves scalars in export", () => {
    const raw = readFileSync(
      new URL(
        "../../../fixtures/ngspice-rawfile/native-scalars-ac.raw",
        import.meta.url,
      ),
      "utf8",
    );
    const r = readSimulationData(raw);
    if (r.status !== "read") throw Error("read expected");
    const data = evaluateSimulationOutputs(r.data, [], [], [], [], true);
    expect(SimulationOutputDataSchema.safeParse(data).success).toBe(true);
    const a = data.analyses[0]!;
    expect(a.outputs.map((o) => o.id)).toEqual([
      "native:gain_db",
      "native:v(reference)",
    ]);
    expect(a.scalars).toMatchObject([
      { label: "peak_gain_db", value: 4 },
      { label: "scalar_phasor", value: 3, imaginary: 4 },
    ]);
    expect(
      data.measurements?.some((m) => m.outputId === "native:peak_gain_db"),
    ).toBe(false);
    const csv = simulationOutputAnalysisToCsv(a);
    expect(csv.split("\n")[0]).not.toContain("peak_gain_db");
    expect(csv).toContain('"Captured scalar"');
    expect(csv).toContain('"peak_gain_db","4"');
    const contradictory = structuredClone(r.data);
    const phasor = contradictory.analyses[0]?.scalars?.[1];
    if (!phasor) throw Error("scalar expected");
    const changed = {
      ...contradictory,
      analyses: contradictory.analyses.map((analysis) => ({
        ...analysis,
        scalars: analysis.scalars?.map((s) =>
          s.name === "scalar_phasor"
            ? { ...s, quantity: "decibel", unit: "dB" }
            : s,
        ),
      })),
    };
    const projected = evaluateSimulationOutputs(changed, [], [], [], [], true);
    expect(projected.analyses[0]?.scalars?.[1]).toMatchObject({
      imaginary: 4,
      semantics: { valueKind: "unknown" },
    });
  });
});
