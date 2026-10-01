/**
 * Flatten Playwright JSON reports into per-case and per-file durations.
 * A case's time is its slowest attempt, so a retried case counts once.
 */
export function summarizeE2eReports(reports) {
  const tests = [];
  const visit = (suite, file) => {
    const owner = suite.file ?? file;
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const ms = Math.max(
          0,
          ...(test.results ?? []).map((result) => result.duration ?? 0),
        );
        tests.push({
          file: spec.file ?? owner,
          line: spec.line,
          title: spec.title,
          ms,
          status: test.status,
        });
      }
    for (const child of suite.suites ?? []) visit(child, owner);
  };
  for (const report of reports)
    for (const suite of report.suites ?? []) visit(suite, suite.file);
  tests.sort((left, right) => right.ms - left.ms);
  const byFile = new Map();
  for (const test of tests) {
    const entry = byFile.get(test.file) ?? { file: test.file, ms: 0, cases: 0 };
    entry.ms += test.ms;
    entry.cases += 1;
    byFile.set(test.file, entry);
  }
  return {
    tests,
    files: [...byFile.values()].sort((left, right) => right.ms - left.ms),
    totalMs: tests.reduce((sum, test) => sum + test.ms, 0),
  };
}
