import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { environmentTestLanes } from "./lib/environment-test-lanes.mjs";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

function prepareEnvironment(lane, name) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(lane.values ?? {})) {
    if (env[key] !== value) throw new Error(`${key}=${value} is required`);
  }
  if (lane.platform && process.platform !== lane.platform)
    throw new Error(
      `${name} requires ${lane.platform}, got ${process.platform}`,
    );
  for (const key of lane.filesFromEnv ?? []) {
    if (!env[key]) throw new Error(`${key} is required`);
    if (!statSync(env[key], { throwIfNoEntry: false })?.isFile())
      throw new Error(`${key} is not a file: ${env[key]}`);
  }
  for (const key of lane.directoriesFromEnv ?? []) {
    if (!env[key]) throw new Error(`${key} is required`);
    if (!statSync(env[key], { throwIfNoEntry: false })?.isDirectory())
      throw new Error(`${key} is not a directory: ${env[key]}`);
  }
  for (const path of lane.files ?? []) {
    if (!statSync(resolve(root, path), { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `Required file is missing: ${path}; build the lane's dependencies first`,
      );
  }
  if (lane.filesFromEnv?.includes("VACASK_BIN")) {
    env.SIM_MODULE_PATH = env.VACASK_MODULES;
    delete env.VACASK_WSL_BIN;
  }
  for (const [command, ...args] of lane.commands ?? []) {
    const result = spawnSync(command, args, {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    if (result.error || result.status !== 0)
      throw new Error(`Required command failed: ${command} ${args.join(" ")}`);
    process.stdout.write(result.stdout);
  }
  if (name === "ngspice") {
    // This invocation proves the committed SKY130 library only.
    env.ICM_STD_CELL_SPICE = resolve(
      root,
      "containers/ngspice/cells/sky130_fd_sc_hd.spice",
    );
  }
  return env;
}

function browserAssertions(report) {
  if (!report.config?.rootDir) throw new Error("Browser report has no rootDir");
  function visit(suite, ancestors = []) {
    const titles = [...ancestors, suite.title ?? ""];
    return [
      ...(suite.specs ?? []).flatMap((spec) =>
        (spec.tests ?? []).map((test) => ({
          file: resolve(report.config.rootDir, spec.file),
          fullName: [...titles, spec.title].join(" "),
          status:
            test.expectedStatus === "passed" && test.status === "expected"
              ? test.results?.at(-1)?.status
              : test.status,
        })),
      ),
      ...(suite.suites ?? []).flatMap((child) => visit(child, titles)),
    ];
  }
  return (report.suites ?? []).flatMap((suite) => visit(suite));
}

function verifyEvidence(lane, report) {
  if (report.success === false || report.errors?.length)
    throw new Error("Test report contains execution errors");
  const results =
    lane.runner === "playwright"
      ? browserAssertions(report)
      : (report.testResults ?? []).flatMap((file) =>
          (file.assertionResults ?? []).map((test) => ({
            ...test,
            file: resolve(file.name),
          })),
        );
  let count = 0;
  for (const check of lane.checks) {
    const assertions = results.filter(
      (test) => test.file === resolve(check.file),
    );
    for (const target of check.targets) {
      const selected = assertions.filter((test) =>
        test.fullName.includes(target),
      );
      if (!selected.length)
        throw new Error(`Target not found: ${check.file}: ${target}`);
      for (const test of selected) {
        if (test.status !== "passed")
          throw new Error(
            `Target did not pass: ${check.file}: ${test.fullName} (${test.status})`,
          );
      }
      count += selected.length;
    }
  }
  if (!count) throw new Error("Empty environment test selection");
  return count;
}

try {
  const [name, action, path] = process.argv.slice(2);
  const lane = environmentTestLanes[name];
  if (!lane) throw new Error(`Unknown environment test lane: ${name}`);
  let reportPath;
  if (action === "--verify" && path) {
    reportPath = resolve(path);
  } else {
    if (action) throw new Error("Expected <lane> [--verify <report.json>]");
    const env = prepareEnvironment(lane, name);
    reportPath = resolve(root, `output/environment-tests/${name}.json`);
    mkdirSync(dirname(reportPath), { recursive: true });
    rmSync(reportPath, { force: true });
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = reportPath;
    const args =
      lane.runner === "playwright"
        ? [
            resolve(root, "node_modules/@playwright/test/cli.js"),
            "test",
            ...lane.checks.map((check) => check.file),
            "--workers=1",
            "--retries=0",
            "--reporter=line,json",
          ]
        : [
            resolve(root, "node_modules/vitest/vitest.mjs"),
            "run",
            ...lane.checks.map((check) => check.file),
            "--maxWorkers=1",
            "--reporter=default",
            "--reporter=json",
            `--outputFile.json=${reportPath}`,
          ];
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${name} test process failed: ${result.status}`);
  }
  const count = verifyEvidence(
    lane,
    JSON.parse(readFileSync(reportPath, "utf8")),
  );
  process.stdout.write(`${name}: ${count} targeted assertions passed\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
