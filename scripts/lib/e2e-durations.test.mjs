import { describe, expect, it } from "vitest";

import { summarizeE2eReports } from "./e2e-durations.mjs";

const report = (file, cases) => ({
  suites: [
    {
      file,
      specs: [],
      suites: [
        {
          title: "group",
          specs: cases.map(([title, durations], index) => ({
            title,
            file,
            line: index + 1,
            tests: [
              {
                status: "expected",
                results: durations.map((duration) => ({ duration })),
              },
            ],
          })),
        },
      ],
    },
  ],
});

describe("browser test durations", () => {
  it("ranks cases and files across batch reports, counting a retry once", () => {
    const summary = summarizeE2eReports([
      report("a.spec.ts", [
        ["quick", [500]],
        ["retried", [9000, 4000]],
      ]),
      report("b.spec.ts", [["slow", [12000]]]),
    ]);
    expect(summary.tests.map((test) => [test.title, test.ms])).toEqual([
      ["slow", 12000],
      ["retried", 9000],
      ["quick", 500],
    ]);
    expect(summary.files).toEqual([
      { file: "b.spec.ts", ms: 12000, cases: 1 },
      { file: "a.spec.ts", ms: 9500, cases: 2 },
    ]);
    expect(summary.totalMs).toBe(21500);
  });
});
