import { describe, expect, it } from "vitest";
import { ngspiceMeasurementResults } from "./ngspice-measurements.js";
import { simulationSpecReport, simulationSpecsToCsv } from "./spec-results.js";
import { SimulationOutputDataSchema } from "./contract.js";
import { SimulationSpecReportSchema } from "./spec-contract.js";
const identity = { runId: "r", preparedId: "p", inputDigest: "captured" };
function evaluate(rule: string, log = "peak = 1.8", completed = true) {
  const files = [
    {
      path: "run.cir",
      text: `* test\n${rule}\n.control\nmeas tran peak MAX v(out)\n.endc\n.end\n`,
    },
  ];
  return simulationSpecReport(
    files,
    "run.cir",
    ngspiceMeasurementResults(files, "run.cir", log),
    identity,
    completed,
  );
}
describe("source Spec v1", () => {
  it("captures optional groups in the shared report and escaped CSV", () => {
    const report = evaluate(
      '* @spec peak <= 2 unit=V group="Bias checks" label="Output peak"',
    );
    expect(report.results[0]).toMatchObject({
      group: "Bias checks",
      judgment: "pass",
      unit: "V",
    });
    expect(SimulationSpecReportSchema.safeParse(report).success).toBe(true);
    expect(simulationSpecsToCsv(report)).toContain('"Bias checks"');
    expect(evaluate("* @spec peak group=Bias").results[0]).toMatchObject({
      group: "Bias",
      judgment: "unconstrained",
    });
    expect(
      simulationSpecsToCsv(evaluate('* @spec peak group="=unsafe"')),
    ).toContain('"\'=unsafe"');
    expect(
      evaluate('* @spec peak group="Bias label=not-metadata"').results[0],
    ).toMatchObject({
      group: "Bias label=not-metadata",
      judgment: "unconstrained",
    });
    expect(evaluate("").results[0]).not.toHaveProperty("group");
  });
  it.each([
    'group=""',
    'group="unterminated',
    "group=a group=b",
    'group="\\u000a"',
    `group=${"a".repeat(81)}`,
  ])("rejects invalid group metadata: %s", (group) => {
    expect(evaluate(`* @spec peak <= 2 ${group}`).results[0]).toMatchObject({
      judgment: "not-evaluated",
      reason: "invalid-spec",
    });
  });
  it("captures unit-only and rich labels without inventing acceptance limits", () => {
    const label = {
      runs: [
        { kind: "text", value: "V" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "out" }],
        },
      ],
    };
    const report = evaluate(
      `* @spec peak unit=V label=${JSON.stringify(label)}`,
    );
    expect(report.results[0]).toMatchObject({
      label,
      unit: "V",
      expected: null,
      judgment: "unconstrained",
      reason: "no-spec",
    });
    expect(SimulationSpecReportSchema.safeParse(report).success).toBe(true);
    expect(simulationSpecsToCsv(report)).toContain('"Vout"');
    expect(
      evaluate('* @spec peak label="Output peak"').results[0],
    ).toMatchObject({
      unit: "",
      label: { runs: [{ kind: "text", value: "Output peak" }] },
      judgment: "unconstrained",
    });
    expect(
      evaluate('* @spec peak <= 2 unit=V label="Output peak"').results[0]
        ?.judgment,
    ).toBe("pass");
    expect(evaluate("* @spec peak unit=V").results[0]?.judgment).toBe(
      "unconstrained",
    );
    expect(evaluate("").results[0]).not.toHaveProperty("label");
  });
  it.each([
    "* @spec peak",
    '* @spec peak label=""',
    "* @spec peak <= 2 label={bad}",
    '* @spec peak <= 2 label={"runs":[{"kind":"html","value":"<img>"}]}',
    '* @spec peak <= 2 label={"runs":[{"kind":"math","latex":"\\\\href{https://evil}{x}","display":"inline"}]}',
    "* @spec peak unit=V unit=A",
    '* @spec peak label={"runs":[{"kind":"text","value":"x"},{"kind":"math","latex":"x","display":"inline"}]}',
    '* @spec peak label={"runs":[{"kind":"line-break"}]}',
  ])(
    "rejects malformed presentation metadata instead of showing Pass: %s",
    (source) => {
      expect(evaluate(source).results[0]).toMatchObject({
        judgment: "not-evaluated",
        reason: "invalid-spec",
      });
    },
  );
  it("does not merge duplicate annotations and protects authored CSV labels", () => {
    expect(
      evaluate("* @spec peak <= 2\n* @spec peak unit=V").results.every(
        (row) => row.reason === "duplicate-spec",
      ),
    ).toBe(true);
    const report = evaluate('* @spec peak unit=V label="=HYPERLINK(1)"');
    expect(simulationSpecsToCsv(report)).toContain(`"'=HYPERLINK(1)"`);
    expect(SimulationSpecReportSchema.safeParse(evaluate("")).success).toBe(
      true,
    );
  });
  it.each([
    ["<= 1.8", "pass"],
    ["< 1.8", "failed"],
    [">= 1.8", "pass"],
    ["> 1.8", "failed"],
    ["range 1.7 1.9", "pass"],
    ["target 1.7 tol 0.2", "pass"],
    ["target 1 tol 0", "failed"],
  ])("evaluates %s with deterministic boundaries", (rule, judgment) => {
    const report = evaluate(`* @spec peak ${rule} unit=V`);
    expect(report.results[0]).toMatchObject({
      judgment,
      value: 1.8,
      unit: "V",
      source: { path: "run.cir", line: 2 },
      logLine: 1,
    });
    expect(
      SimulationOutputDataSchema.safeParse({
        schemaVersion: 1,
        analyses: [],
        diagnostics: [],
        specs: report,
      }).success,
    ).toBe(true);
  });
  it.each([
    "<= 1m",
    "<= NaN",
    "<= 1e999",
    "range 2 1",
    "target 1 tol -1",
    "<= eval(1)",
  ])("rejects malformed rule %s without inventing a failed circuit", (rule) => {
    expect(evaluate(`* @spec peak ${rule}`).results[0]?.reason).toBe(
      "invalid-spec",
    );
  });
  it("keeps missing, incomplete and unconstrained measurements distinct", () => {
    expect(evaluate("* @spec peak <= 2", "").results[0]).toMatchObject({
      value: null,
      judgment: "not-evaluated",
      reason: "measurement-missing",
    });
    expect(
      evaluate("* @spec peak <= 2", "peak = 1", false).results[0]?.reason,
    ).toBe("run-incomplete");
    expect(evaluate("").results[0]?.judgment).toBe("unconstrained");
    expect(evaluate("* @spec absent <= 2").results[0]?.reason).toBe(
      "measurement-missing",
    );
  });
  it("retains repeated reports and rejects duplicate or ambiguous names", () => {
    expect(
      evaluate("* @spec peak <= 2", "peak = 1\npeak = 3").results.map((r) => [
        r.occurrence,
        r.judgment,
      ]),
    ).toEqual([
      [1, "pass"],
      [2, "failed"],
    ]);
    expect(
      evaluate("* @spec peak <= 2\n* @spec peak >= 0").results.every(
        (r) => r.reason === "duplicate-spec",
      ),
    ).toBe(true);
    expect(
      evaluate("* @spec peak <= 2\n.meas tran peak MIN v(out)").results[0]
        ?.reason,
    ).toBe("ambiguous-measurement");
  });
  it("uses only reachable selected library sections and retains captured source", () => {
    const files = [
      { path: "run.cir", text: '* title\n.lib "rules.spice" tt\n.end' },
      {
        path: "rules.spice",
        text: '.lib tt\n* @spec peak <= 2 unit=V label="Captured peak"\n.meas tran peak MAX v(out)\n.endl\n.lib ff\n* @spec peak <= 0 label="Other corner"\n.endl',
      },
      { path: "unused.spice", text: "* @spec ghost <= 0" },
    ];
    const report = simulationSpecReport(
      files,
      "run.cir",
      ngspiceMeasurementResults(files, "run.cir", "peak = 1"),
      identity,
      true,
    );
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.judgment).toBe("pass");
    files[1]!.text = "* changed";
    expect(report.results[0]?.source.text).toBe(
      '* @spec peak <= 2 unit=V label="Captured peak"',
    );
    expect(report.results[0]?.label).toEqual({
      runs: [{ kind: "text", value: "Captured peak" }],
    });
    expect(simulationSpecsToCsv(report)).toContain('"r","p","captured"');
  });
});
