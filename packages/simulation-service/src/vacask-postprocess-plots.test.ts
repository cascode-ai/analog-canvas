import { describe, expect, it } from "vitest";
import { VACASK_PLOT_PREFIX } from "@icm/netlist";
import { vacaskPostprocessPlots } from "./vacask-postprocess-plots.js";

const record = {
  artifactPath: "derived/gain.raw",
  plotOrdinal: 0,
  analysis: "ac",
  axis: "frequency",
  probes: [{ name: "Gain", quantity: "transfer", unit: "1" }],
};
const frame = (value: unknown) => VACASK_PLOT_PREFIX + JSON.stringify(value);
describe("native postprocessor plot declarations", () => {
  it("retains explicit case-sensitive identities, author units and console evidence", () => {
    const read = vacaskPostprocessPlots(
      `ordinary output\n${frame(record)}`,
      [],
    );
    expect(read.diagnostics).toEqual([]);
    expect(read.projections).toEqual([
      { ...record, postprocessor: { logLine: 2 } },
    ]);
    expect(
      vacaskPostprocessPlots(JSON.stringify(record), []).projections,
    ).toEqual([]);
  });
  it.each([
    "../gain.raw",
    "/gain.raw",
    "a/./gain.raw",
    "a\\gain.raw",
    "C:/gain.raw",
    "a//gain.raw",
  ])("rejects noncanonical path %s without accessing it", (artifactPath) => {
    const read = vacaskPostprocessPlots(
      `${frame({ ...record, artifactPath })}\n${frame(record)}`,
      [],
    );
    expect(read.diagnostics).toHaveLength(1);
    expect(read.projections).toHaveLength(1);
  });
  it("does not overwrite solver mappings or choose a winner among repeated declarations", () => {
    const source = {
      artifactPath: "bias.raw",
      plotOrdinal: 0,
      analysis: "op" as const,
    };
    const read = vacaskPostprocessPlots(
      [
        frame({ ...source, probes: [] }),
        frame(record),
        frame(record),
        frame(record),
        frame({ ...record, artifactPath: "good.raw" }),
      ].join("\n"),
      [source],
    );
    expect(read.diagnostics).toHaveLength(3);
    expect(read.projections.map((p) => p.artifactPath)).toEqual([
      "bias.raw",
      "good.raw",
    ]);
  });
  it.each([
    { ...record, analysis: "noise" },
    { ...record, plotOrdinal: -1 },
    { ...record, extra: "ignored?" },
    { ...record, axis: null },
    { ...record, probes: [{ name: "x", unit: "V" }] },
  ])("rejects malformed/unsupported mappings", (value) => {
    expect(vacaskPostprocessPlots(frame(value), []).diagnostics).toHaveLength(
      1,
    );
  });
});
