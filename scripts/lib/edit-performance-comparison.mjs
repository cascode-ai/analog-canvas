import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "vite";
import { editBudgets } from "./edit-performance.mjs";

// Retained by the performance-edit-baseline-v1 tag; never follows main or HEAD.
const editBaselineCommit = "fbe77864e1d4b9ec49fdea3c471372bc7c9ba67d";
const names = ["rotate", "undo", "paste", "wireCommit"];

async function bundle(root, output) {
  await build({
    root,
    configFile: false,
    logLevel: "error",
    resolve: { conditions: ["development"] },
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ["development"],
        externalConditions: ["development"],
      },
    },
    build: {
      ssr: resolve(root, "apps/editor/benchmarks/edit-workloads.ts"),
      outDir: output,
      emptyOutDir: false,
      target: "node24",
      minify: false,
      rollupOptions: {
        output: { entryFileNames: "edit-workloads.mjs", codeSplitting: false },
      },
    },
  });
  return join(output, "edit-workloads.mjs");
}

function measure(bundlePath, budgets, slowEdit) {
  const child = spawnSync(
    process.execPath,
    [
      resolve("scripts/measure-edit-workloads.mjs"),
      bundlePath,
      JSON.stringify(budgets),
      ...(slowEdit ? [slowEdit] : []),
    ],
    { encoding: "utf8", timeout: 180_000 },
  );
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    /* A crash is not a rejection. */
  }
  const accepted = slowEdit
    ? child.status === 1 &&
      result?.passed === false &&
      result.failures.length === 1 &&
      result.failures[0][0] === slowEdit
    : child.status === 0 && result?.passed === true;
  return {
    workload: slowEdit ?? "normal",
    exitCode: child.status,
    accepted,
    result,
    ...(accepted ? {} : { error: child.error?.message ?? child.stderr }),
  };
}

/** Rebuild both versions, then measure them on this machine in fresh processes. */
export async function compareEditPerformance(
  output,
  verifyRejection,
  slowEdit,
) {
  try {
    execFileSync("git", ["cat-file", "-e", `${editBaselineCommit}^{commit}`], {
      stdio: "ignore",
    });
  } catch {
    execFileSync(
      "git",
      ["fetch", "--no-tags", "--depth=1", "origin", editBaselineCommit],
      { stdio: "inherit" },
    );
  }
  const temporary = await mkdtemp(join(tmpdir(), "icm-edit-baseline-"));
  try {
    const archive = join(temporary, "source.tar");
    execFileSync("git", [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      editBaselineCommit,
    ]);
    execFileSync("tar", ["-xf", archive, "-C", temporary]);
    // Install the baseline's own frozen dependencies; current dependency changes
    // must not silently change the baseline. This is outside every timed sample.
    execFileSync(
      process.platform === "win32" ? process.env.ComSpec : "pnpm",
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            "pnpm install --frozen-lockfile --prefer-offline --ignore-scripts",
          ]
        : [
            "install",
            "--frozen-lockfile",
            "--prefer-offline",
            "--ignore-scripts",
          ],
      { cwd: temporary, stdio: "pipe", timeout: 300_000 },
    );
    // The exact same workload definitions and sampler exercise both versions.
    await copyFile(
      resolve("apps/editor/benchmarks/edit-workloads.ts"),
      join(temporary, "apps/editor/benchmarks/edit-workloads.ts"),
    );
    const baselineBundle = await bundle(
      temporary,
      join(temporary, "benchmark"),
    );
    const candidateBundle = await bundle(process.cwd(), output);
    const baseline = measure(baselineBundle, {});
    if (!baseline.accepted)
      throw new Error(
        `Baseline measurement failed: ${JSON.stringify(baseline)}`,
      );
    const budgets = editBudgets(baseline.result.editWorkloads, names);
    const runs = [measure(candidateBundle, budgets, slowEdit)];
    if (verifyRejection && runs[0].accepted)
      for (const name of names)
        runs.push(measure(candidateBundle, budgets, name));
    return {
      baselineCommit: editBaselineCommit,
      baseline: baseline.result,
      budgets,
      runs,
      passed:
        runs.every((run) => run.accepted) &&
        (!verifyRejection || runs.length === names.length + 1),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}
