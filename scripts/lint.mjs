#!/usr/bin/env node
/**
 * The type-aware lint (oxlint with tsgolint) for bugs the types let through:
 * floating and misused promises, React hook rules and switches that miss a
 * union member fail; effect dependencies and non-null assertions warn.
 * .oxlintrc.json holds the rules.
 *
 *   pnpm lint [-- --quiet]          the whole repository
 *   pnpm lint -- --base <ref> <files…>
 *                                   those files, as `pnpm verify:pr` runs it:
 *                                   every error, and the warnings on lines
 *                                   changed since the merge base with <ref>
 *
 * A type-aware rule reads each file through its nearest tsconfig.json, where
 * an @icm/* import resolves to that package's dist/ types, so the packages
 * are built first (a second or two when nothing changed). Without them a call
 * into another package has no type, and its promise goes unchecked.
 */
import { execFileSync, spawnSync } from "node:child_process";

import {
  formatDiagnostic,
  lintReport,
  touchedLinesByFile,
} from "./lib/lint-report.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : null;
const quiet = args.includes("--quiet");
const paths = args.filter(
  (value, index) =>
    value !== "--quiet" &&
    value !== "--base" &&
    (baseIndex < 0 || index !== baseIndex + 1),
);
const shell = process.platform === "win32";

const git = (gitArgs) =>
  execFileSync("git", gitArgs, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

/** Lines changed since the merge base; null for a file new since then. */
function touchedLinesSince(ref) {
  const mergeBase = git(["merge-base", ref, "HEAD"]).trim();
  const changed = touchedLinesByFile(
    git([
      "diff",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      mergeBase,
    ]),
  );
  const untracked = new Set(
    git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  );
  return (file) =>
    untracked.has(file) ? null : (changed.get(file) ?? new Set());
}

// The exit status is set, not forced: process.exit() could cut off a long
// report still being written to a pipe.
function main() {
  const build = spawnSync("pnpm", ["--filter", "./packages/**", "build"], {
    encoding: "utf8",
    shell,
  });
  if (build.status !== 0) {
    process.stdout.write(build.stdout + build.stderr);
    return build.status ?? 1;
  }

  const lint = spawnSync(
    "pnpm",
    [
      "exec",
      "oxlint",
      "--format=json",
      "--no-error-on-unmatched-pattern",
      ...(quiet ? ["--quiet"] : []),
      ...(paths.length ? paths : ["apps", "packages", "worker", "scripts"]),
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell },
  );
  let report;
  try {
    report = JSON.parse(lint.stdout);
  } catch {
    process.stdout.write(lint.stdout + lint.stderr);
    return lint.status || 1;
  }

  const { shown, errors, warnings, quietWarnings } = lintReport(
    report.diagnostics,
    base ? touchedLinesSince(base) : undefined,
  );
  const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  process.stdout.write(
    shown.map((item) => `${formatDiagnostic(item)}\n`).join("") +
      `oxlint: ${count(report.number_of_files, "file")}, ${count(errors, "error")}, ${count(warnings, "warning")}${
        base ? " on changed lines" : ""
      }${quietWarnings ? ` (${quietWarnings} more on lines this change left alone)` : ""}\n`,
  );
  return errors ? 1 : 0;
}

process.exitCode = main();
