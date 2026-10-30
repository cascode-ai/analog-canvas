/**
 * Flatten Playwright JSON reports into per-case and per-file durations.
 * Cumulative attempt time is execution cost, not elapsed wall time: workers
 * run concurrently. Keep retries and the slowest attempt separately.
 */
export function summarizeE2eReports(reports) {
  const tests = [];
  const visit = (suite, file) => {
    const owner = suite.file ?? file;
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const durations = (test.results ?? []).map(
          (result) => result.duration ?? 0,
        );
        const ms = durations.reduce((sum, duration) => sum + duration, 0);
        tests.push({
          file: spec.file ?? owner,
          line: spec.line,
          title: spec.title,
          ms,
          attempts: durations.length,
          maxAttemptMs: Math.max(0, ...durations),
          retryMs: durations
            .slice(1)
            .reduce((sum, duration) => sum + duration, 0),
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
    const entry = byFile.get(test.file) ?? {
      file: test.file,
      ms: 0,
      retryMs: 0,
      cases: 0,
    };
    entry.ms += test.ms;
    entry.retryMs += test.retryMs;
    entry.cases += 1;
    byFile.set(test.file, entry);
  }
  return {
    tests,
    files: [...byFile.values()].sort((left, right) => right.ms - left.ms),
    totalMs: tests.reduce((sum, test) => sum + test.ms, 0),
    retryMs: tests.reduce((sum, test) => sum + test.retryMs, 0),
    runDurationsMs: reports.map((report) => report.stats?.duration ?? null),
  };
}
