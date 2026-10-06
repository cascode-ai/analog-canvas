#!/usr/bin/env node
/**
 * The local check before a pull request, in one command:
 *
 *   pnpm verify:pr [-- --base origin/main] [--no-browser | --mapped]
 *
 * 1. typecheck;
 * 2. Prettier on the changed files it formats;
 * 3. every unit test that imports a changed file (`vitest related`): a leaf
 *    change runs a few, a core package most of the suite, so neither a guess
 *    at the "touched areas" nor the whole suite. A change to a test file runs
 *    strictly, so a describe its deletions emptied fails here, not in the
 *    merge queue;
 * 4. the browser cases the change adds or edits, by `file:line`, on the built
 *    editor with 4 workers (a change a spec file's tests share runs that
 *    file). `--mapped` runs every spec the merge queue maps instead.
 *
 * The merge queue owns ci:static, the full unit suite, release:verify and
 * the mapped specs on the candidate merged with main, in a few minutes, so
 * running the mapped specs here first only repeats them, slower. It stops
 * at the first failure, ends with each step's time, and names the Gallery
 * census, with the checks the change needs, when AGENTS.md calls for it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { planCiValidation } from "./lib/ci-validation-plan.mjs";
import {
  collectChangedPaths,
  loadGateCatalog,
  planValidation,
} from "./lib/validation-gates.mjs";
import {
  browserSpecPaths,
  censusChecks,
  censusPaths,
  changedBrowserCases,
  changedLines,
  formattedPaths,
  strictUnitRun,
  unitSourcePaths,
} from "./lib/verify-pr-selection.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";
const withBrowser = !args.includes("--no-browser");
const mapped = args.includes("--mapped");

const catalog = await loadGateCatalog();
const changed = collectChangedPaths(base, {
  ignoredPaths: catalog.ignoredPaths,
});
const present = changed.filter((path) => existsSync(path));
const ciPlan = planCiValidation(planValidation(changed, catalog));

const steps = [];
function step(name, command, commandArgs, env = {}) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}: ${[command, ...commandArgs].join(" ")}\n`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  const seconds = (Date.now() - started) / 1000;
  steps.push({ name, seconds, ok: result.status === 0 });
  if (result.status !== 0) finish(result.status ?? 1);
}
function skip(name, reason) {
  steps.push({ name, seconds: 0, ok: true, skipped: reason });
}
function finish(status) {
  process.stdout.write(
    `\nverify:pr against ${base} (${changed.length} changed paths)\n` +
      steps
        .map(
          (item) =>
            `  ${item.ok ? "✓" : "✗"} ${item.name.padEnd(10)} ${
              item.skipped
                ? `skipped: ${item.skipped}`
                : `${item.seconds.toFixed(0)} s`
            }`,
        )
        .join("\n") +
      "\n",
  );
  const census = censusPaths(changed);
  if (census.length)
    process.stdout.write(
      `\nAGENTS.md asks for the Gallery census (${census[0]}${
        census.length > 1 ? ` and ${census.length - 1} more` : ""
      }): pnpm gallery:census -- --base ${base} --checks ${censusChecks(
        changed,
      ).join(",")}\n`,
    );
  process.exit(status);
}

if (changed.length === 0) {
  process.stdout.write(`Nothing differs from ${base}.\n`);
  process.exit(0);
}

step("typecheck", "pnpm", ["typecheck"]);

const formatted = formattedPaths(present);
if (formatted.length)
  step("format", "pnpm", ["exec", "prettier", "--check", ...formatted]);
else skip("format", "no changed file Prettier formats");

const sources = unitSourcePaths(present);
if (sources.length)
  step("unit", "pnpm", [
    "exec",
    "vitest",
    "related",
    "--run",
    "--maxWorkers=2",
    strictUnitRun(sources) ? "--no-passWithNoTests" : "--passWithNoTests",
    ...sources,
  ]);
else skip("unit", "no changed source or test file");

/** The browser cases this change adds or edits, as `file:line` arguments. */
function changedCases() {
  const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], {
    encoding: "utf8",
  }).trim();
  return browserSpecPaths(present).flatMap((file) => {
    const known =
      spawnSync("git", ["cat-file", "-e", `${mergeBase}:${file}`]).status === 0;
    if (!known) return [file];
    const diff = execFileSync("git", ["diff", "-U0", mergeBase, "--", file], {
      encoding: "utf8",
    });
    return changedBrowserCases(
      file,
      readFileSync(file, "utf8"),
      changedLines(diff),
    );
  });
}

// test:e2e:local builds the workspace packages the specs' Node side loads
// first (a second or two when nothing changed), as ci:e2e does.
const browserEnv = {
  ICM_E2E_ISOLATED: "1",
  ICM_E2E_PORT: process.env.ICM_E2E_PORT ?? "4191",
};
const queued = ciPlan.browser
  ? ciPlan.e2eArgs.filter((arg) => arg.endsWith(".spec.ts")).length
  : 0;
if (!withBrowser) skip("browser", "--no-browser");
else if (mapped) {
  if (!ciPlan.browser)
    skip("browser", `the merge queue maps none (${ciPlan.mode})`);
  else
    step(
      "browser",
      "pnpm",
      ["test:e2e:local", "--workers=4", ...ciPlan.e2eArgs],
      browserEnv,
    );
} else {
  const cases = changedCases();
  if (!cases.length)
    skip(
      "browser",
      `no browser case changed; the merge queue runs ${queued} mapped spec file${queued === 1 ? "" : "s"}`,
    );
  else
    step(
      "browser",
      "pnpm",
      ["test:e2e:local", "--workers=4", ...cases],
      browserEnv,
    );
}

finish(0);
