#!/usr/bin/env node
// Run the Gallery census (apps/editor/census/gallery.census.ts) against a
// private Gallery snapshot, or compare two of its reports. The census reads
// user drawings, so it is a local check only: never wire it into CI, and
// keep its reports in the untracked plan/ directory.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where scripts/gallery-private-snapshot.mjs keeps its downloads. */
export const DEFAULT_SNAPSHOT_DIRECTORY = join(
  homedir(),
  "Library",
  "Application Support",
  "Analog Canvas",
  "gallery",
);

const CENSUS_CONFIG = "apps/editor/census/vitest.config.ts";
const HARNESS_FILES = [CENSUS_CONFIG, "apps/editor/census/gallery.census.ts"];

const USAGE = `Usage:
  pnpm gallery:census [--base REF | --ref REF] [--backup PATH]
                      [--status public|all] [--only ID,ID] [--limit N]
                      [--out PATH]
  pnpm gallery:census --compare BASE.json HEAD.json

Without --backup the newest snapshot from
\`node scripts/gallery-private-snapshot.mjs --cached\` is used. The census runs
on this checkout; --ref REF runs it on REF instead, in a temporary worktree
with this checkout's harness. --base REF runs both and compares them, as
--compare does for two saved reports: a drawing that newly fails, a netlist
whose text changed, or a label that stopped following its part is reported,
and the exit status is 1.`;

export function parseArguments(argv) {
  const options = { status: "public", only: [], limit: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`${flag} needs a value\n\n${USAGE}`);
      index += 1;
      return next;
    };
    if (flag === "--") continue;
    else if (flag === "--backup") options.backup = value();
    else if (flag === "--out") options.out = value();
    else if (flag === "--base") options.base = value();
    else if (flag === "--ref") options.ref = value();
    else if (flag === "--status") options.status = value();
    else if (flag === "--only")
      options.only = value().split(",").filter(Boolean);
    else if (flag === "--limit") options.limit = Number(value());
    else if (flag === "--compare") {
      options.compare = [value(), value()];
    } else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
  }
  if (!["public", "all"].includes(options.status))
    throw new Error(`--status is public or all\n\n${USAGE}`);
  if (!Number.isInteger(options.limit) || options.limit < 0)
    throw new Error(`--limit is a whole number\n\n${USAGE}`);
  if (options.base && options.ref)
    throw new Error(`--base and --ref do not combine\n\n${USAGE}`);
  return options;
}

/** The newest `gallery-<capture time>-<run>/gallery.sqlite` downloaded. */
export function newestSnapshot(directory = DEFAULT_SNAPSHOT_DIRECTORY) {
  if (!existsSync(directory)) return null;
  // Snapshot directories begin with their capture time, so names sort by it.
  const snapshots = readdirSync(directory)
    .filter((name) => name.startsWith("gallery-"))
    .sort()
    .map((name) => join(directory, name, "gallery.sqlite"))
    .filter((path) => existsSync(path));
  return snapshots.at(-1) ?? null;
}

/** What changed between two census reports of the same snapshot. */
export function compareReports(base, head) {
  const before = new Map(base.entries.map((entry) => [entry.id, entry]));
  const after = new Set(head.entries.map((entry) => entry.id));
  const findings = {
    newlyFailing: [],
    newlyPassing: [],
    changed: [],
    netlistChanged: [],
    labelsStoppedFollowing: [],
    missing: [...before.keys()].filter((id) => !after.has(id)),
    added: [],
  };
  for (const entry of head.entries) {
    const previous = before.get(entry.id);
    if (!previous) {
      findings.added.push(entry.id);
      continue;
    }
    for (const [check, value] of Object.entries(entry.checks)) {
      const old = previous.checks[check];
      if (old === undefined || old === value) continue;
      const finding = {
        id: entry.id,
        name: entry.name,
        check,
        before: old,
        after: value,
      };
      if (old === "ok") findings.newlyFailing.push(finding);
      else if (value === "ok") findings.newlyPassing.push(finding);
      else findings.changed.push(finding);
    }
    if (
      previous.netlistHash &&
      entry.netlistHash &&
      previous.netlistHash !== entry.netlistHash
    )
      findings.netlistChanged.push({ id: entry.id, name: entry.name });
    if (previous.labelsFollowing && entry.labelsFollowing) {
      const following = new Set(entry.labelsFollowing);
      const stopped = previous.labelsFollowing.filter(
        (label) => !following.has(label),
      );
      if (stopped.length)
        findings.labelsStoppedFollowing.push({
          id: entry.id,
          name: entry.name,
          labels: stopped,
        });
    }
  }
  return findings;
}

/**
 * The findings a reviewer must explain or fix before delivery: a drawing
 * that newly fails a check, a netlist whose text changed, or a label that no
 * longer follows its part when the part turns.
 */
export function blockingFindings(findings) {
  return (
    findings.newlyFailing.length +
    findings.netlistChanged.length +
    findings.labelsStoppedFollowing.length
  );
}

export function formatComparison(findings, limit = 12) {
  const lines = [];
  const list = (title, items, describe) => {
    if (!items.length) return;
    lines.push(`${title}: ${items.length}`);
    for (const item of items.slice(0, limit)) lines.push(`  ${describe(item)}`);
    if (items.length > limit)
      lines.push(`  … ${items.length - limit} more in the reports`);
  };
  const change = (item) =>
    `${item.id} ${item.check}: ${item.before} → ${item.after}`;
  list("Newly failing", findings.newlyFailing, change);
  list(
    "Netlist text changed",
    findings.netlistChanged,
    (item) => `${item.id} (${item.name})`,
  );
  list(
    "Labels that stopped following their part",
    findings.labelsStoppedFollowing,
    (item) => `${item.id}: ${item.labels.join(", ")}`,
  );
  list("Newly passing", findings.newlyPassing, change);
  list("Failing differently", findings.changed, change);
  list("Only in the base report", findings.missing, (id) => id);
  list("Only in the new report", findings.added, (id) => id);
  if (!lines.length) lines.push("No drawing behaves differently.");
  return lines.join("\n");
}

export function summarizeReport(report) {
  const checks = new Map();
  for (const entry of report.entries)
    for (const [check, value] of Object.entries(entry.checks)) {
      const tally = checks.get(check) ?? { ok: 0, failures: new Map() };
      if (value === "ok") tally.ok += 1;
      else {
        const key = value.slice(0, 100);
        tally.failures.set(key, (tally.failures.get(key) ?? 0) + 1);
      }
      checks.set(check, tally);
    }
  const lines = [
    `Gallery census of ${report.entries.length} drawings at ${report.commit ?? "unknown commit"}`,
  ];
  for (const [check, tally] of checks) {
    const failed = [...tally.failures.values()].reduce((a, b) => a + b, 0);
    lines.push(`  ${check.padEnd(14)} ${tally.ok} ok, ${failed} not`);
    for (const [message, count] of [...tally.failures]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3))
      lines.push(`      ${count} × ${message}`);
  }
  return lines.join("\n");
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitLabel(cwd, ref = "HEAD") {
  const sha = git(cwd, "rev-parse", "--short", ref);
  return ref === "HEAD" && git(cwd, "status", "--porcelain")
    ? `${sha}+dirty`
    : sha;
}

function runCensus(cwd, options, out, commit) {
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--config", CENSUS_CONFIG],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ICM_GALLERY_CENSUS_BACKUP: options.backup,
        ICM_GALLERY_CENSUS_OUT: out,
        ICM_GALLERY_CENSUS_STATUS: options.status,
        ICM_GALLERY_CENSUS_ONLY: options.only.join(","),
        ICM_GALLERY_CENSUS_LIMIT: String(options.limit),
        ICM_GALLERY_CENSUS_COMMIT: commit,
      },
    },
  );
  if (result.status !== 0)
    throw new Error(`The census did not complete in ${cwd}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

function reportPath(root, commit, out) {
  return resolve(out ?? join(root, "plan", `gallery-census-${commit}.json`));
}

/** The census on another commit, in a worktree that is removed after. */
function runCensusAt(root, options, ref, out) {
  const commit = commitLabel(root, ref);
  const directory = join(
    mkdtempSync(join(tmpdir(), "gallery-census-")),
    "checkout",
  );
  git(root, "worktree", "add", "--detach", directory, ref);
  try {
    // The commit may predate the census, so it runs this checkout's harness.
    for (const file of HARNESS_FILES) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    const install = spawnSync(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline"],
      { cwd: directory, stdio: "inherit" },
    );
    if (install.status !== 0)
      throw new Error(`Dependencies did not install for ${ref}`);
    return runCensus(directory, options, reportPath(root, commit, out), commit);
  } finally {
    git(root, "worktree", "remove", "--force", directory);
    rmSync(dirname(directory), { recursive: true, force: true });
  }
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.compare) {
    const [base, head] = options.compare.map((path) =>
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (base.backup !== head.backup)
      throw new Error("The reports come from different snapshots");
    const findings = compareReports(base, head);
    console.log(formatComparison(findings));
    return blockingFindings(findings) ? 1 : 0;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  options.backup = options.backup ? resolve(options.backup) : newestSnapshot();
  if (!options.backup || !existsSync(options.backup))
    throw new Error(
      "No Gallery snapshot: run `node scripts/gallery-private-snapshot.mjs --cached`, or pass --backup PATH",
    );
  console.log(`Snapshot: ${options.backup}`);
  const commit = options.ref
    ? commitLabel(root, options.ref)
    : commitLabel(root);
  const out = reportPath(root, commit, options.out);
  const head = options.ref
    ? runCensusAt(root, options, options.ref, options.out)
    : runCensus(root, options, out, commit);
  console.log(summarizeReport(head));
  console.log(`Report: ${out}`);
  if (!options.base) return 0;
  const base = runCensusAt(root, options, options.base);
  console.log(summarizeReport(base));
  console.log(`Report: ${reportPath(root, base.commit)}`);
  const findings = compareReports(base, head);
  console.log(`\nCompared with ${options.base} (${base.commit}):`);
  console.log(formatComparison(findings));
  return blockingFindings(findings) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
