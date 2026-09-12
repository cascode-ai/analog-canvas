import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { readSimulationData, simulationAnalysisToCsv } from "./result-data.js";
const source = readFileSync(
  new URL(
    "../../../fixtures/ngspice-rawfile/native-scalars-ac.raw",
    import.meta.url,
  ),
  "utf8",
);
describe("captured scalar cardinality", () => {
  it("separates explicit singletons, preserving signed/complex values and constant waveforms", () => {
    const result = readSimulationData(source);
    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    const a = result.data.analyses[0]!;
    if (a.analysis !== "ac") throw Error("AC expected");
    expect(a.probes.map((p) => p.name)).toEqual(["gain_db", "v(reference)"]);
    expect(a.probes[1]?.real).toEqual([1, 1, 1]);
    expect(a.scalars).toMatchObject([
      { name: "peak_gain_db", value: 4, imaginary: 0 },
      { name: "scalar_phasor", value: 3, imaginary: 4 },
    ]);
    const csv = simulationAnalysisToCsv(a);
    expect(csv.split("\n")[0]).not.toContain("peak_gain_db");
    expect(csv).toContain("peak_gain_db,4,0,");
    expect(csv).toContain("scalar_phasor,3,4,");
  });
  it("does not infer a scalar from zero padding without a declaration", () => {
    const r = readSimulationData(source.replaceAll(" dims=1", ""));
    if (r.status !== "read") throw Error("read expected");
    expect(r.data.analyses[0]?.scalars).toBeUndefined();
  });
  it("does not mistake a captured frequency for a second frequency axis", () => {
    const r = readSimulationData(
      source.replace("peak_gain_db notype", "peak_frequency frequency"),
    );
    if (r.status !== "read") throw Error(JSON.stringify(r));
    expect(r.data.analyses[0]?.scalars?.[0]).toMatchObject({
      name: "peak_frequency",
      value: 4,
      unit: "Hz",
    });
  });
  it("preserves a negative singleton without taking magnitude", () => {
    const r = readSimulationData(source.replace("4,0\n 3,4", "-4,0\n 3,4"));
    if (r.status !== "read") throw Error("read expected");
    expect(r.data.analyses[0]?.scalars?.[0]?.value).toBe(-4);
  });
  it("keeps an unqualified one-point AC acquisition as a waveform", () => {
    const onePoint = source
      .slice(0, source.indexOf("\n 1 200"))
      .replace("No. Points: 3", "No. Points: 1");
    const r = readSimulationData(onePoint);
    if (r.status !== "read") throw Error("read expected");
    const a = r.data.analyses[0];
    if (a?.analysis !== "ac") throw Error("AC expected");
    expect(a.probes.map((p) => p.name)).toEqual(["gain_db", "v(reference)"]);
  });
  it.each(["dims=2", "dims=99", "dims=x", "dims=1 dims=1", "dims=1,3"])(
    "refuses ambiguous or unsupported axis alignment: %s",
    (dims) => {
      const r = readSimulationData(source.replace("dims=1", dims));
      expect(r.status).toBe("unusable");
      expect(r.diagnostics.length).toBeGreaterThan(0);
    },
  );
  it("keeps repeated captured values attached to their raw plot", () => {
    const r = readSimulationData(
      source + "\n" + source.replace("4,0\n 3,4", "7,0\n 3,4"),
    );
    if (r.status !== "read") throw Error("read expected");
    expect(
      r.data.analyses.map((a) => [a.rawPlotOrdinals, a.scalars?.[0]?.value]),
    ).toEqual([
      [[0], 4],
      [[1], 7],
    ]);
  });
  it.each([
    ["Transient Analysis", "time", "time", "tran"],
    ["DC transfer characteristic", "v-sweep", "voltage", "dc"],
  ])(
    "separates real scalar padding in %s",
    (plotName, axis, quantity, kind) => {
      const raw = `Title: synthetic real scalar\nPlotname: ${plotName}\nFlags: real\nNo. Variables: 2\nNo. Points: 2\nVariables:\n0 ${axis} ${quantity}\n1 captured voltage dims=1\nValues:\n0 0\n-2\n\n1 1\n0\n\n`;
      const r = readSimulationData(raw);
      if (r.status !== "read") throw Error(JSON.stringify(r));
      expect(r.data.analyses[0]).toMatchObject({
        analysis: kind,
        probes: [],
        scalars: [{ name: "captured", value: -2, unit: "V" }],
      });
    },
  );
});
