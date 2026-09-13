import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimulationOutputData } from "@icm/simulation-service/contract";
import { unrepresentedConsoleMeasurements } from "./measurement-presentation";
import { SimulationOutputResults } from "./simulation-output-results";

function fixture(): SimulationOutputData {
  return {
    schemaVersion: 1,
    diagnostics: [],
    analyses: [
      {
        analysis: "tran",
        plotName: "Transient Analysis",
        rawPlotOrdinals: [0],
        domain: { name: "Time", unit: "s", values: [0, 0.001] },
        outputs: [],
        scalars: [
          {
            id: "native:at_one_tau",
            label: "at_one_tau",
            value: 0.3678778,
            unit: "",
          },
        ],
      },
    ],
    nativeMeasurements: [
      {
        name: "at_one_tau",
        occurrence: 1,
        status: "available",
        value: 0.367878,
        logLine: 10,
        detail: "at_one_tau = 3.67878e-01",
      },
    ],
  };
}
describe("measurement presentation", () => {
  it("shows the high-pass Step scalar once while retaining its original Console evidence", () => {
    const data = fixture();
    const before = structuredClone(data);
    expect(unrepresentedConsoleMeasurements(data)).toEqual([]);
    const html = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="hp-step"
        data={data}
        outputs={[]}
        view="waveform"
      />,
    );
    expect(html.match(/>at_one_tau</gu)).toHaveLength(1);
    expect(html).toContain("0.3678778");
    expect(html).not.toContain("Code measurements");
    expect(html).not.toContain("These are not samples");
    expect(data).toEqual(before);
  });
  it("keeps Console-only and failed measurements available", () => {
    const data = fixture();
    data.analyses[0]!.scalars = [];
    data.nativeMeasurements!.push({
      name: "failed",
      occurrence: 0,
      status: "unavailable",
      detail: "No crossing",
    });
    expect(unrepresentedConsoleMeasurements(data)).toEqual(
      data.nativeMeasurements,
    );
    const html = renderToStaticMarkup(
      <SimulationOutputResults resultKey="reports" data={data} outputs={[]} />,
    );
    expect(html).toContain("at_one_tau");
    expect(html).toContain("Unavailable");
  });
  it.each([
    "changed",
    "complex",
    "repeated reports",
    "repeated records",
    "insufficient precision",
  ])("does not merge %s", (kind) => {
    const data = fixture();
    if (kind === "changed") data.analyses[0]!.scalars![0]!.value = 0.5;
    if (kind === "complex") data.analyses[0]!.scalars![0]!.imaginary = 1;
    if (kind === "repeated reports")
      data.nativeMeasurements!.push({
        ...data.nativeMeasurements![0]!,
        occurrence: 2,
      } as NonNullable<SimulationOutputData["nativeMeasurements"]>[number]);
    if (kind === "repeated records")
      data.analyses.push({ ...data.analyses[0]!, rawPlotOrdinals: [1] });
    if (kind === "insufficient precision")
      data.nativeMeasurements![0]!.detail = "at_one_tau = 0.36787800";
    expect(unrepresentedConsoleMeasurements(data)).toEqual(
      data.nativeMeasurements,
    );
  });
  it("does not show TRAN reports or captures in an empty or populated OP view", () => {
    const data = fixture();
    data.diagnostics = [
      {
        analysisIndex: 0,
        outputId: "tran-only",
        code: "UNAVAILABLE",
        message: "Transient-only diagnostic",
      },
    ];
    data.nativeMeasurements!.push({
      name: "console_only",
      occurrence: 1,
      status: "available",
      value: 2,
      logLine: 11,
      detail: "console_only = 2",
    });
    for (const addOp of [false, true]) {
      if (addOp)
        data.analyses.push({
          analysis: "op",
          plotName: "Operating Point",
          outputs: [
            { id: "v(out)", label: "v(out)", unit: "V", values: [0.1] },
          ],
        });
      const html = renderToStaticMarkup(
        <SimulationOutputResults
          resultKey="op-view"
          data={data}
          outputs={[]}
          view="op"
        />,
      );
      expect(html).not.toContain("at_one_tau");
      expect(html).not.toContain("console_only");
      expect(html).not.toContain("Transient-only diagnostic");
      if (addOp) expect(html).toContain("v(out)");
    }
  });
  it("retains original record indices when the waveform view hides OP", () => {
    const data = fixture();
    data.analyses.unshift({
      analysis: "op",
      plotName: "Operating Point",
      outputs: [],
    });
    const html = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="mixed"
        data={data}
        outputs={[]}
        view="waveform"
      />,
    );
    expect(html).toContain('aria-label="Captured scalars record 2"');
    expect(html).not.toContain('aria-label="OP results"');
  });
});
