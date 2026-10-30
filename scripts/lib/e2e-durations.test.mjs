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
  it("keeps per-run elapsed time separate from concurrent test cost and empty attempts", () => {
    const input = report("parallel.spec.ts", [
      ["one", [1000]],
      ["two", [1000]],
      ["skipped", []],
    ]);
    input.stats = { duration: 1200 };
    const summary = summarizeE2eReports([input]);
    expect(summary.runDurationsMs).toEqual([1200]);
    expect(summary.totalMs).toBe(2000);
    expect(summary.tests.at(-1)).toMatchObject({
      ms: 0,
      attempts: 0,
      retryMs: 0,
    });
  });
  it("ranks cumulative execution cost, including every retry without counting extra cases", () => {
    const summary = summarizeE2eReports([
      report("a.spec.ts", [
        ["quick", [500]],
        ["retried", [9000, 4000]],
      ]),
      report("b.spec.ts", [["slow", [12000]]]),
    ]);
    expect(summary.tests.map((test) => [test.title, test.ms])).toEqual([
      ["retried", 13000],
      ["slow", 12000],
      ["quick", 500],
    ]);
    expect(summary.files).toEqual([
      { file: "a.spec.ts", ms: 13500, retryMs: 4000, cases: 2 },
      { file: "b.spec.ts", ms: 12000, retryMs: 0, cases: 1 },
    ]);
    expect(summary.totalMs).toBe(25500);
    expect(summary.retryMs).toBe(4000);
    expect(summary.tests[0]).toMatchObject({
      attempts: 2,
      maxAttemptMs: 9000,
      retryMs: 4000,
    });
  });
});
