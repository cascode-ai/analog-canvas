import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vitestConfig from "../vitest.config.ts";
import { permitsCondition, workflow } from "./test-support/workflow.mjs";

const { jobs } = await workflow(".github/workflows/ci.yml");
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const dependencies = (job) => [job.needs].flat().sort();
const stepRunning = (job, command) =>
  job.steps.find((step) => step.run?.trim() === command);

function enabled(job, event, changes, successful = true) {
  return permitsCondition(
    job.if,
    { github: { event_name: event }, needs: { changes } },
    { successful },
  );
}

describe("CI workflow", () => {
  it("keeps the required check names branch protection depends on", () => {
    expect(jobs.core.name).toBe("Core contracts");
    expect(jobs.browser.name).toBe("Browser tests");
  });

  it("fails each required check when the job it aggregates fails", () => {
    expect(dependencies(jobs.core)).toEqual([
      "changes",
      "core_build",
      "core_performance",
      "core_release",
      "core_static",
      "core_unit",
      "core_unit_built",
    ]);
    expect(
      stepRunning(jobs.core, "node scripts/check-core-results.mjs").env,
    ).toMatchObject({ CORE_NEEDS: "${{ toJSON(needs) }}" });
    expect(dependencies(jobs.browser)).toEqual(["browser_shard", "changes"]);
    expect(
      stepRunning(jobs.browser, 'test "$SHARD_RESULT" = "success"').env,
    ).toMatchObject({ SHARD_RESULT: "${{ needs.browser_shard.result }}" });
    const changes = {
      result: "success",
      outputs: { heavy: "true", browser: "true" },
    };
    for (const job of [jobs.core, jobs.browser])
      expect(enabled(job, "merge_group", changes, false)).toBe(true);
    expect(enabled(jobs.browser, "pull_request", changes)).toBe(false);
    expect(
      enabled(jobs.browser, "merge_group", { outputs: { browser: "false" } }),
    ).toBe(false);
  });

  it("runs the aggregate for a broken plan but skips PRs and confirmed documentation", () => {
    const permits = (event, result, outputs) =>
      enabled(jobs.core, event, { result, outputs }, result === "success");
    expect(permits("pull_request", "success", { heavy: "true" })).toBe(false);
    expect(
      permits("merge_group", "success", {
        heavy: "false",
        mode: "documentation",
      }),
    ).toBe(false);
    for (const result of ["failure", "cancelled", "skipped"])
      expect(permits("merge_group", result, {})).toBe(true);
    expect(permits("merge_group", "success", {})).toBe(true);
    expect(permits("merge_group", "success", { heavy: "true" })).toBe(true);
  });

  it("starts static, shared build and unit shards with the plan; built-package consumers after the build", () => {
    for (const id of ["core_static", "core_build", "core_unit"])
      expect(dependencies(jobs[id])).toEqual(["changes"]);
    for (const id of ["core_unit_built", "core_performance", "core_release"]) {
      expect(dependencies(jobs[id])).toEqual(["changes", "core_build"]);
      expect(
        jobs[id].steps.find(
          (step) => step.uses === "actions/download-artifact@v4",
        ).with,
      ).toMatchObject({
        "artifact-ids": "${{ needs.core_build.outputs.artifact_id }}",
      });
    }
    expect(
      jobs.core_static.steps.find((step) => step.uses === "actions/checkout@v4")
        .with["fetch-depth"],
    ).toBe("0");
    expect(stepRunning(jobs.core_static, "pnpm ci:static").env).toMatchObject({
      FORMAT_BASE_SHA: "${{ github.event.merge_group.base_sha }}",
    });
    // Core release and Core performance together run every built release
    // check exactly once, the editing budgets beside the rest.
    const checks = ["core_release", "core_performance"].flatMap((id) =>
      jobs[id].steps.filter(
        (step) =>
          step.run?.startsWith("node scripts/") &&
          !step.run.startsWith("node scripts/ci-package-build"),
      ),
    );
    expect(checks.map((step) => step.run.trim()).toSorted()).toEqual(
      scripts["release:verify:built"].split(" && ").toSorted(),
    );
    expect(
      stepRunning(
        jobs.core_performance,
        "node scripts/performance-baseline.mjs",
      ),
    ).toBeDefined();
    expect(
      stepRunning(
        jobs.core_performance,
        "node scripts/ci-package-build.mjs verify",
      ),
    ).toBeDefined();
    for (const step of [
      ...checks,
      stepRunning(jobs.core_release, "pnpm test:desktop-build"),
    ])
      expect(step["timeout-minutes"]).toBe("5");
  });

  it("retains each browser shard report on failure without hiding its result", () => {
    const report = jobs.browser_shard.steps.find(
      (step) => step.uses === "actions/upload-artifact@v4",
    );
    for (const state of [
      { successful: true },
      { successful: false },
      { successful: true, cancelled: true },
    ])
      expect(permitsCondition(report.if, {}, state)).toBe(true);
    expect(report.with).toMatchObject({
      path: "test-results/e2e-report.json",
      name: "browser-report-${{ strategy.job-index }}-${{ github.run_attempt }}",
    });
    for (const item of [jobs.browser_shard, ...jobs.browser_shard.steps])
      expect([undefined, "false"]).toContain(item["continue-on-error"]);
  });

  it("retains the successful producer's artifact when only failed consumers rerun", () => {
    expect(jobs.core_build.outputs.artifact_id).toBe(
      "${{ steps.shared_build.outputs.artifact-id }}",
    );
    const producer = jobs.core_build.steps.find(
      (step) => step.id === "shared_build",
    );
    expect(producer.uses).toBe("actions/upload-artifact@v4");
    expect(producer.with.name).toBe(
      "core-packages-${{ github.sha }}-${{ github.run_attempt }}",
    );
    for (const id of ["core_unit_built", "core_performance", "core_release"])
      expect(
        jobs[id].steps.find(
          (step) => step.uses === "actions/download-artifact@v4",
        ).with,
      ).toMatchObject({
        "artifact-ids": "${{ needs.core_build.outputs.artifact_id }}",
        "merge-multiple": "true",
      });
  });

  it("runs every unit shard and the built-entry tests without masking a failure", () => {
    const unit = jobs.core_unit;
    expect(unit.strategy.matrix.shard).toEqual([
      "1/5",
      "2/5",
      "3/5",
      "4/5",
      "5/5",
    ]);
    expect(unit.strategy["fail-fast"]).toBe("false");
    const built = jobs.core_unit_built;
    for (const item of [unit, ...unit.steps, built, ...built.steps])
      expect([undefined, "false"]).toContain(item["continue-on-error"]);
    // Shards resolve sources: no shared build to wait for or to trust.
    expect(
      stepRunning(unit, "pnpm ci:unit --shard=${{ matrix.shard }}").env,
    ).toBeUndefined();
    expect(
      unit.steps.some((step) => step.uses === "actions/download-artifact@v4"),
    ).toBe(false);
    expect(stepRunning(built, "pnpm ci:unit:built").env).toMatchObject({
      ICM_CI_PACKAGE_BUILD: "1",
    });
    expect(
      stepRunning(built, "node scripts/ci-package-build.mjs verify"),
    ).toBeDefined();
  });

  it("runs every Vitest project once, the built-entry project only on the shared build", () => {
    const projects = (script) =>
      [...script.matchAll(/--project (\S+)/gu)].map((match) => match[1]);
    const sharded = projects(scripts["ci:unit"]);
    const built = projects(scripts["ci:unit:built"]);
    expect(built).toEqual(["standalone"]);
    expect([...sharded, ...built].sort()).toEqual(
      vitestConfig.test.projects.map((project) => project.test.name).sort(),
    );
    const standalone = vitestConfig.test.projects.find(
      (project) => project.test.name === "standalone",
    );
    expect(standalone.test.globalSetup).toEqual([
      "./scripts/test-standalone-setup.mjs",
    ]);
  });
});
