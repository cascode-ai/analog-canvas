import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulationAnalysisToCsv } from "./result-data.js";
import { SimulationResultDataSchema } from "./result-schema.js";
import { parseVacaskRawfile } from "./vacask-rawfile.js";
import {
  readVacaskSimulationData,
  type VacaskPlotProjection,
} from "./vacask-result-data.js";

const fixture = (directory: string, file: string) =>
  readFileSync(
    new URL(`../../../netlists/${directory}/${file}`, import.meta.url),
    "utf8",
  );
const op = fixture("vacask-divider", "divider_op.raw");
const dc = fixture("vacask-divider", "divider_dc.raw");
const ac = fixture("vacask-rc", "rc_ac.raw");
const tran = fixture("vacask-rc", "result_tran.raw");
const output = { name: "output", quantity: "voltage", unit: "V" };
const plan = (rest: Partial<VacaskPlotProjection> = {}): VacaskPlotProjection =>
  ({
    artifactPath: "op.raw",
    plotOrdinal: 0,
    analysis: "op",
    probes: [output],
    ...rest,
  }) as VacaskPlotProjection;
function read(
  artifacts: Parameters<typeof readVacaskSimulationData>[0],
  plans: readonly VacaskPlotProjection[],
) {
  const result = readVacaskSimulationData(artifacts, plans);
  if (result.status !== "read") throw Error(JSON.stringify(result));
  expect(SimulationResultDataSchema.safeParse(result.data).success).toBe(true);
  return result;
}
function original(text: string) {
  const parsed = parseVacaskRawfile(text);
  if (!parsed.ok) throw Error(parsed.error.message);
  return parsed.plots[0]!;
}

describe("native numerical result projection", () => {
  it("joins separately collected records without losing their source identity", () => {
    const result = read(
      [
        { path: "bias.raw", text: op },
        { path: "sweep.raw", text: dc },
        { path: "freq.raw", text: ac },
        { path: "time.raw", text: tran },
      ],
      [
        plan({ artifactPath: "bias.raw" }),
        {
          artifactPath: "sweep.raw",
          plotOrdinal: 0,
          analysis: "dc",
          axis: { name: "supply", quantity: "voltage", unit: "V" },
          probes: [output],
        },
        {
          artifactPath: "freq.raw",
          plotOrdinal: 0,
          analysis: "ac",
          axis: "frequency",
          probes: [output],
        },
        {
          artifactPath: "time.raw",
          plotOrdinal: 0,
          analysis: "tran",
          axis: "time",
          probes: [output],
        },
      ],
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.data.analyses.map((a) => a.analysis)).toEqual([
      "op",
      "dc",
      "ac",
      "tran",
    ]);
    expect(result.data.analyses.map((a) => a.rawPlotOrdinals)).toEqual([
      [0],
      [1],
      [2],
      [3],
    ]);
    expect(
      result.data.rawPlots?.map((p) => [
        p.artifactPath,
        p.artifactPlotOrdinal,
        p.analysisIndex,
      ]),
    ).toEqual([
      ["bias.raw", 0, 0],
      ["sweep.raw", 0, 1],
      ["freq.raw", 0, 2],
      ["time.raw", 0, 3],
    ]);
    const dcResult = result.data.analyses[1]!;
    if (dcResult.analysis !== "dc") throw Error("Expected DC");
    // VACASK calls this plot Operating Point, even though it has seven samples.
    expect(dcResult.plotName).toBe("Operating Point");
    expect(dcResult.sweep.values).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(simulationAnalysisToCsv(dcResult)).toContain("supply [V]");
  });

  it("retains native signs and untyped vectors, and resolves names case-sensitively", () => {
    const result = read([{ path: "op.raw", text: op }], [plan()]);
    const analysis = result.data.analyses[0]!;
    if (analysis.analysis !== "op") throw Error("Expected OP");
    expect(analysis.probes).toEqual([
      { name: "V1:flow(br)", quantity: "notype", unit: null, value: -0.001 },
      { name: "input", quantity: "notype", unit: null, value: 3 },
      { ...output, value: 2 },
    ]);
    const missing = readVacaskSimulationData(
      [{ path: "op.raw", text: op }],
      [plan({ probes: [{ ...output, name: "Output" }] })],
    );
    expect(missing.status).toBe("unusable");
    expect(missing.diagnostics[0]?.text).toContain('"Output" is missing');
  });

  it("preserves both AC components and original nonuniform transient samples in CSV", () => {
    const result = read(
      [
        { path: "ac.raw", text: ac },
        { path: "tran.raw", text: tran },
      ],
      [
        {
          artifactPath: "ac.raw",
          plotOrdinal: 0,
          analysis: "ac",
          axis: "frequency",
        },
        {
          artifactPath: "tran.raw",
          plotOrdinal: 0,
          analysis: "tran",
          axis: "time",
        },
      ],
    );
    const [a, t] = result.data.analyses;
    if (a?.analysis !== "ac" || t?.analysis !== "tran")
      throw Error("Expected AC/TRAN");
    const nativeAc = original(ac).vectors.find(
      (v) => v.variable.name === "output",
    )!;
    expect(a.probes.find((p) => p.name === "output")).toMatchObject({
      real: nativeAc.real,
      imag: nativeAc.imag,
    });
    const nativeTime = original(tran).vectors.find(
      (v) => v.variable.name === "time",
    )!.real;
    expect(nativeTime).toHaveLength(63);
    expect(t.timeSeconds).toEqual(nativeTime);
    expect(
      new Set(nativeTime.slice(1).map((v, i) => v - nativeTime[i]!)).size,
    ).toBeGreaterThan(3);
    const csv = simulationAnalysisToCsv(t).trim().split("\n");
    expect(csv.slice(1).map((line) => Number(line.split(",")[0]))).toEqual(
      nativeTime,
    );
    expect(createHash("sha256").update(tran).digest("hex")).toBe(
      "ec268571b788d4b115891cf8eab552e9e9011da36eb329506405f2bd12609d96",
    );
  });

  it("keeps two plots in one artifact distinct", () => {
    const result = read(
      [{ path: "op.raw", text: op + op }],
      [plan(), plan({ plotOrdinal: 1 })],
    );
    expect(result.data.rawPlots?.map((p) => p.artifactPlotOrdinal)).toEqual([
      0, 1,
    ]);
    expect(result.data.analyses.map((a) => a.rawPlotOrdinals)).toEqual([
      [0],
      [1],
    ]);
  });

  it("requires complete native provenance while accepting historical single-file records", () => {
    const { data } = read([{ path: "op.raw", text: op }], [plan()]);
    const record = data.rawPlots![0]!;
    for (const incomplete of [
      { ...record, artifactPath: undefined },
      { ...record, artifactPlotOrdinal: undefined },
    ])
      expect(
        SimulationResultDataSchema.safeParse({
          ...data,
          rawPlots: [incomplete],
        }).success,
      ).toBe(false);
    expect(
      SimulationResultDataSchema.safeParse({
        ...data,
        rawPlots: [
          {
            ...record,
            artifactPath: undefined,
            artifactPlotOrdinal: undefined,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["swept OP", dc, plan(), "cannot be collapsed"],
    ["complex OP", ac, plan(), "one real sample"],
    [
      "wrong axis",
      dc,
      {
        ...plan(),
        analysis: "dc",
        axis: { name: "absent", quantity: "native", unit: null },
      },
      "absent",
    ],
    [
      "wrong flags",
      op,
      { ...plan(), analysis: "ac", axis: "input" },
      "real/complex",
    ],
    [
      "complex axis",
      ac,
      { ...plan(), analysis: "ac", axis: "output" },
      "not a real",
    ],
    [
      "duplicate probes",
      op,
      plan({ probes: [output, output] }),
      "Duplicate acquisition",
    ],
  ] as const)(
    "rejects %s without inventing a valid result",
    (_label, text, projection, message) => {
      const result = readVacaskSimulationData(
        [{ path: "op.raw", text }],
        [projection],
      );
      expect(result.status).toBe("unusable");
      expect(result.diagnostics[0]?.text).toContain(message);
    },
  );

  it("keeps usable records alongside explicit errors, never interpreting partial data as run success", () => {
    const result = read(
      [
        { path: "op.raw", text: op },
        { path: "broken.raw", text: ac.slice(0, -100) },
      ],
      [
        plan(),
        {
          artifactPath: "broken.raw",
          plotOrdinal: 0,
          analysis: "ac",
          axis: "frequency",
        },
        plan({ artifactPath: "lost.raw" }),
      ],
    );
    expect(result.data.analyses).toHaveLength(1);
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
    expect(result.diagnostics.map((d) => d.text).join("\n")).toContain(
      "lost.raw",
    );
  });

  it("does not assign noise semantics without an explicit projection", () => {
    const result = read(
      [
        { path: "op.raw", text: op },
        {
          path: "noise.raw",
          text: fixture("vacask-resistor-noise", "resistor_noise.raw"),
        },
      ],
      [plan()],
    );
    expect(result.data.rawPlots?.[1]).toMatchObject({
      artifactPath: "noise.raw",
      variables: ["frequency", "onoise", "gain", "n(R1)"],
    });
    expect(result.data.rawPlots?.[1]?.analysisIndex).toBeUndefined();
    expect(result.diagnostics[0]?.text).toContain(
      "no qualified numerical projection",
    );
  });

  it("refuses ambiguous collection identity and missing output", () => {
    expect(
      readVacaskSimulationData(
        [
          { path: "op.raw", text: op },
          { path: "op.raw", text: op },
        ],
        [plan()],
      ).status,
    ).toBe("unusable");
    expect(
      readVacaskSimulationData([{ path: "op.raw", text: op }], [plan(), plan()])
        .status,
    ).toBe("unusable");
    expect(readVacaskSimulationData([], [plan()]).status).toBe("unusable");
    expect(readVacaskSimulationData([], []).status).toBe("unusable");
    expect(
      readVacaskSimulationData(
        [{ path: "op.raw", text: op }],
        [plan({ plotOrdinal: -1 })],
      ).status,
    ).toBe("unusable");
  });
});
