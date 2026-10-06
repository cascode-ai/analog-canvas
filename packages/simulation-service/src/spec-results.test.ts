import { describe, expect, it } from "vitest";
import { ngspiceMeasurementResults } from "./ngspice-measurements.js";
import { simulationSpecReport, simulationSpecsToCsv } from "./spec-results.js";
import {
  SimulationOutputDataSchema,
  simulationSpecAnnotationDiagnostics,
} from "./contract.js";
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
    [
      'group=""',
      'Group "" is empty; write group=Name or group="Display name".',
    ],
    ['group="unterminated', 'Group "unterminated is not a closed JSON string'],
    ["group=a group=b", "Group is declared 2 times; keep one group="],
    ['group="\\u000a"', 'Group "\\u000a" is empty'],
    [`group=${"a".repeat(81)}`, "is longer than 80 characters."],
  ])("rejects invalid group metadata and says why: %s", (group, detail) => {
    expect(evaluate(`* @spec peak <= 2 ${group}`).results[0]).toMatchObject({
      judgment: "not-evaluated",
      reason: "invalid-spec",
      detail: expect.stringContaining(detail),
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
    ["* @spec peak", '"peak" has no condition; add one such as <= 1.8'],
    ['* @spec peak label=""', 'Label "" is empty; write label="Text".'],
    ["* @spec peak <= 2 label={bad}", "Label {bad} is not JSON"],
    [
      '* @spec peak <= 2 label={"runs":[{"kind":"html","value":"<img>"}]}',
      'Label run 1, {"kind":"html","value":"<img>"}, is not a text, bold,',
    ],
    [
      '* @spec peak <= 2 label={"runs":[{"kind":"math","latex":"\\\\href{https://evil}{x}","display":"inline"}]}',
      "is not a supported label",
    ],
    [
      "* @spec peak unit=V unit=A",
      '"unit=V" is out of place; declare the unit once, after the condition.',
    ],
    [
      '* @spec peak label={"runs":[{"kind":"text","value":"x"},{"kind":"math","latex":"x","display":"inline"}]}',
      "is not a supported label",
    ],
    [
      '* @spec peak label={"runs":[{"kind":"line-break"}]}',
      'Label run 1, {"kind":"line-break"}, is not a text',
    ],
    ["* @spec peak unit=m/s^2", 'Unit "m/s^2" contains "^"'],
    ['* @spec peak unit="V"', "Write the unit without quotes: unit=V."],
    ["* @spec 2peak <= 2", 'Name "2peak" is not a measurement name'],
  ])(
    "rejects malformed presentation metadata instead of showing Pass: %s",
    (source, detail) => {
      expect(evaluate(source).results[0]).toMatchObject({
        judgment: "not-evaluated",
        reason: "invalid-spec",
        detail: expect.stringContaining(detail),
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
    ["<= 1m", 'Bound "1m" is not a decimal or scientific number; write 1e-3.'],
    [
      "< 2.5MEG",
      'Bound "2.5MEG" is not a decimal or scientific number; write 2.5e6.',
    ],
    ["> 10kOhm", "write 10e3."],
    ["<= 1M", "write 1e-3 (SPICE reads M as milli) or 1e6 for mega."],
    // Every suffix the SPICE reader knows, atto included.
    ["<= 5a", 'Bound "5a" is not a decimal or scientific number; write 5e-18.'],
    ["<= NaN", 'Bound "NaN" is not a decimal or scientific number such as'],
    ["<= 1e999", 'Bound "1e999" is too large to be a finite number.'],
    [
      "range 2 1",
      "Range 2 1 has its minimum above its maximum; write range 1 2.",
    ],
    [
      "target 1 tol -1",
      "Tolerance -1 is negative; write the absolute tolerance 1.",
    ],
    ["target 1 +- 0.1", 'Condition "target 1 +- 0.1" is not target VALUE'],
    ["<= eval(1)", 'Bound "eval(1)" is not a decimal or scientific number'],
    ["<=1.8", 'Condition "<=1.8" needs a space after <=: write <= 1.8.'],
    ["<=", 'Condition "<=" is not <= N; write one bound after <=.'],
    ["== 1.8", '"==" does not start a condition; use < N, <= N'],
  ])(
    "rejects malformed rule %s without inventing a failed circuit",
    (rule, detail) => {
      expect(evaluate(`* @spec peak ${rule}`).results[0]).toMatchObject({
        reason: "invalid-spec",
        detail: expect.stringContaining(detail),
      });
    },
  );
  it("names a SPICE-suffixed bound in the run, in specs.csv and on save (#1311)", () => {
    const rule =
      '* @spec per10 range 9.0m 11.1m unit=s label="ten periods of the Wien-bridge oscillator"';
    const detail =
      'Bound "9.0m" is not a decimal or scientific number; write 9.0e-3. ' +
      'Bound "11.1m" is not a decimal or scientific number; write 11.1e-3.';
    const files = [
      {
        path: "run.cir",
        text: `* wien\n${rule}\n.control\ntran 1u 40m\nmeas tran per10 TRIG v(out) VAL=0 RISE=2 TARG v(out) VAL=0 RISE=12\n.endc\n.end\n`,
      },
    ];
    const report = simulationSpecReport(
      files,
      "run.cir",
      ngspiceMeasurementResults(
        files,
        "run.cir",
        "per10               =  1.014310e-02 targ=  3.014310e-02 trig=  2.000000e-02",
      ),
      identity,
      true,
    );
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      name: "per10",
      value: 0.0101431,
      judgment: "not-evaluated",
      reason: "invalid-spec",
      detail,
    });
    const [header, row] = simulationSpecsToCsv(report).split("\n");
    expect(header!.split(",").at(-1)).toBe('"detail"');
    expect(row!.endsWith(`"${detail.replaceAll('"', '""')}"`)).toBe(true);
    // Saving the file reports the same words on that line, before any run.
    const text = `* test\r\n${rule}\r\n* @spec peak <= 2 unit=V\r\n`;
    expect(simulationSpecAnnotationDiagnostics("run.cir", text)).toEqual([
      {
        code: "SIMULATION_SPEC_INVALID",
        severity: "warning",
        message: detail,
        path: "run.cir",
        sourceRef: {
          fileId: "run.cir",
          start: { offset: 8, line: 2, column: 1 },
          end: { offset: 8 + rule.length, line: 2, column: rule.length + 1 },
        },
      },
    ]);
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
