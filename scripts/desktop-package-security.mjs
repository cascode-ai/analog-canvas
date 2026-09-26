import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  inspectDistributionDirectory,
  publicFinding,
} from "./lib/distribution-security.mjs";

const root = resolve(import.meta.dirname, "..");
const suppliedDirectory = process.argv[2];
const manifest = suppliedDirectory
  ? null
  : JSON.parse(await readFile(join(root, "plan/preview-package.json"), "utf8"));
const directory = resolve(suppliedDirectory ?? manifest.output);
const plan = join(root, "plan/desktop-security-gate");
const report = join(plan, "scanner-redacted.json");
await mkdir(plan, { recursive: true });
await rm(join(directory, "SECURITY.json"), { force: true });
const inventory = await inspectDistributionDirectory(directory);
const scanner = process.env.GITLEAKS_BINARY || "gitleaks";
const version = execFileSync(scanner, ["version"], { encoding: "utf8" }).trim();
if (version !== "8.30.1")
  throw new Error("Use reviewed Gitleaks version 8.30.1");
await rm(report, { force: true });
const result = spawnSync(
  scanner,
  [
    "dir",
    directory,
    "--config",
    join(root, ".gitleaks.toml"),
    "--gitleaks-ignore-path",
    join(plan, "no-ignore-file"),
    "--ignore-gitleaks-allow",
    "--max-archive-depth",
    "2",
    "--redact=100",
    "--no-banner",
    "--report-format",
    "json",
    "--report-path",
    report,
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);
if (result.error || ![0, 1].includes(result.status))
  throw new Error("Credential scanner failed; distribution is blocked");
const findings = JSON.parse(await readFile(report, "utf8")).map(publicFinding);
await writeFile(join(plan, "findings.json"), JSON.stringify(findings, null, 2));
if (result.status !== 0 || findings.length) {
  for (const finding of findings) console.error(JSON.stringify(finding));
  throw new Error(
    "Credential findings block distribution; inspect redacted report",
  );
}
const build = await readFile(join(directory, "BUILD.txt"), "utf8");
const source = build.match(/^Source commit: ([a-f0-9]{40})$/mu)?.[1];
if (!source || (manifest && source !== manifest.commit))
  throw new Error("Distribution source record is missing or inconsistent");
await writeFile(
  join(directory, "SECURITY.json"),
  JSON.stringify(
    {
      status: "passed",
      source,
      scanner: `gitleaks ${version}`,
      ...inventory,
      checks: [
        "private-paths",
        "source-archive-paths",
        "runtime-and-source-credentials",
      ],
      limitations:
        "Pattern scanning is not proof that every possible secret is absent. Server-side authorization remains required.",
    },
    null,
    2,
  ),
);
console.log(
  `Distribution security checks passed (${inventory.files} files; ${inventory.sourceEntries} source entries).`,
);
