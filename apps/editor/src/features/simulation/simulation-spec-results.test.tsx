import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SimulationSpecReport } from "@icm/simulation-service/contract";
import { SimulationSpecResults } from "./simulation-spec-results";

const report: SimulationSpecReport = {
  schemaVersion: 1,
  runId: "r",
  preparedId: "p",
  inputDigest: "captured",
  results: [
    {
      id: "peak:1",
      name: "peak",
      occurrence: 1,
      source: { path: "run.cir", line: 3, text: "* @spec peak <= 1.8 unit=V" },
      value: 1.2,
      unit: "V",
      expected: { kind: "limit", operator: "<=", value: 1.8 },
      judgment: "pass",
      reason: "satisfied",
      detail: "Within limit",
      logLine: 8,
    },
    {
      id: "delay:1",
      name: "delay",
      occurrence: 1,
      source: { path: "run.cir", line: 4, text: "* @spec delay < 1e-6 unit=s" },
      value: null,
      unit: "s",
      expected: { kind: "limit", operator: "<", value: 1e-6 },
      judgment: "not-evaluated",
      reason: "measurement-missing",
      detail: "Measurement was not recorded",
      logLine: null,
    },
  ],
};
describe("Specification results", () => {
  it("groups authored names and prioritizes issues without mutating captured order", () => {
    const results = [
      { ...report.results[0]!, group: "Bias" },
      { ...report.results[1]!, group: "Bias" },
      {
        ...report.results[0]!,
        id: "bad",
        name: "bad",
        expected: null,
        judgment: "not-evaluated" as const,
        reason: "invalid-spec" as const,
      },
    ];
    const html = renderToStaticMarkup(
      <SimulationSpecResults
        report={{ ...report, results }}
        hasRun
        stale={false}
        onSource={() => {}}
      />,
    );
    expect(html).toContain('scope="rowgroup">Bias');
    expect(html.indexOf("delay ·")).toBeLessThan(html.indexOf("peak ·"));
    expect(html).toContain("Ungrouped");
    expect(html).not.toContain("<details");
    expect(results.map((r) => r.name)).toEqual(["peak", "delay", "bad"]);
  });
  it("shows the shared judgments, missing value and source provenance without reevaluating", () => {
    const html = renderToStaticMarkup(
      <SimulationSpecResults
        report={report}
        hasRun
        stale
        onSource={() => {}}
      />,
    );
    for (const value of [
      "Spec</th>",
      "Sim result",
      "Expected",
      "Judgment",
      '1.2 <span class="simulation-spec-unit">V</span>',
      "Pass",
      "Not evaluated",
      "Measurement was not recorded",
      "run.cir:3",
      "Previous run",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("0 s");
  });
  it("does not treat a legacy report's absence as passing", () => {
    const html = renderToStaticMarkup(
      <SimulationSpecResults
        report={undefined}
        hasRun
        stale={false}
        onSource={() => {}}
      />,
    );
    expect(html).toContain("No specification report");
    expect(html).not.toContain("Pass");
  });
  it("renders authored rich names safely, aligns values and distinguishes unknown units", () => {
    const html = renderToStaticMarkup(
      <SimulationSpecResults
        report={{
          ...report,
          results: [
            {
              ...report.results[0]!,
              unit: "",
              expected: null,
              judgment: "unconstrained",
              label: {
                runs: [
                  { kind: "text", value: "Z" },
                  {
                    kind: "span",
                    style: "subscript",
                    children: [{ kind: "text", value: "in" }],
                  },
                  { kind: "text", value: "<script>" },
                ],
              },
            },
          ],
        }}
        hasRun
        stale={false}
        onSource={() => {}}
      />,
    );
    expect(html).toContain("Z<sub>in</sub>&lt;script&gt;");
    expect(html).toContain("Measured only");
    expect(html).toContain("unit not declared");
    expect(html).not.toContain('class="simulation-spec-unit"');
    expect(html).toContain("Other measurements (1)");
    expect(html).not.toContain("<details open");
    expect(html).toContain('class="simulation-spec-number"');
    expect(html).toContain("peak · run.cir:3");
    expect(html).toContain('scope="row"');
    expect(html).not.toContain("<script>");
  });
});
