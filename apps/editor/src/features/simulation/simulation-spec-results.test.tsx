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
      "1.2 V",
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
});
