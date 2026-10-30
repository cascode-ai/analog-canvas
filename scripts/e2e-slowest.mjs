#!/usr/bin/env node
/**
 * Where browser-test time goes, read from Playwright JSON reports.
 *
 *   pnpm e2e:slowest [-- --top 25] [report.json ...]
 *
 * Without paths it reads test-results/e2e-report.json, which every local
 * `playwright test` run writes. Several reports (one per batch) are merged.
 */
import { readFileSync } from "node:fs";

import { summarizeE2eReports } from "./lib/e2e-durations.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const topIndex = args.indexOf("--top");
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 25;
const paths = args.filter(
  (value, index) =>
    value !== "--top" && (topIndex < 0 || index !== topIndex + 1),
);
const reports = (paths.length ? paths : ["test-results/e2e-report.json"]).map(
  (path) => JSON.parse(readFileSync(path, "utf8")),
);
const summary = summarizeE2eReports(reports);
const seconds = (ms) => (ms / 1000).toFixed(1).padStart(7) + " s";

process.stdout.write(
  `${summary.tests.length} cases, ${seconds(summary.totalMs).trim()} cumulative attempt time (not wall time); retries: ${seconds(summary.retryMs).trim()}\n` +
    "Elapsed per report (runs may overlap; runner queue excluded):\n" +
    summary.runDurationsMs
      .map(
        (ms, index) =>
          `  ${paths[index] ?? "test-results/e2e-report.json"}: ${ms === null ? "unavailable" : seconds(ms).trim()}`,
      )
      .join("\n") +
    "\n\n" +
    "By spec file:\n" +
    summary.files
      .map(
        (file) =>
          `${seconds(file.ms)}  ${String(file.cases).padStart(4)} cases  ${file.file}`,
      )
      .join("\n") +
    `\n\nSlowest ${Math.min(top, summary.tests.length)} cases:\n` +
    summary.tests
      .slice(0, top)
      .map(
        (test) =>
          `${seconds(test.ms)} total; ${seconds(test.maxAttemptMs)} max; ${seconds(test.retryMs)} retries (${test.attempts} attempts)  ${test.file}:${test.line} › ${test.title}`,
      )
      .join("\n") +
    "\n",
);
