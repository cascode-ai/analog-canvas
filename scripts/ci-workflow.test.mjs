import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
      "core_release",
      "core_static",
      "core_unit",
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

  it("allows static and shared build together, then unit and release together", () => {
    for (const id of ["core_static", "core_build"])
      expect(dependencies(jobs[id])).toEqual(["changes"]);
    for (const id of ["core_unit", "core_release"]) {
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
    const checks = jobs.core_release.steps.filter(
      (step) =>
        step.run?.startsWith("node scripts/") &&
        !step.run.startsWith("node scripts/ci-package-build"),
    );
    expect(checks.map((step) => step.run.trim())).toEqual(
      scripts["release:verify:built"].split(" && "),
    );
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
    for (const id of ["core_unit", "core_release"])
      expect(
        jobs[id].steps.find(
          (step) => step.uses === "actions/download-artifact@v4",
        ).with,
      ).toMatchObject({
        "artifact-ids": "${{ needs.core_build.outputs.artifact_id }}",
        "merge-multiple": "true",
      });
  });

  it("runs every unit shard without filtering tests or masking a failed shard", () => {
    const unit = jobs.core_unit;
    expect(unit.strategy.matrix.shard).toEqual([
      "1/6",
      "2/6",
      "3/6",
      "4/6",
      "5/6",
      "6/6",
    ]);
    expect(unit.strategy["fail-fast"]).toBe("false");
    for (const item of [unit, ...unit.steps])
      expect([undefined, "false"]).toContain(item["continue-on-error"]);
    expect(
      stepRunning(unit, "pnpm ci:unit --shard=${{ matrix.shard }}").env,
    ).toMatchObject({ ICM_CI_PACKAGE_BUILD: "1" });
    expect(
      stepRunning(unit, "node scripts/ci-package-build.mjs verify"),
    ).toBeDefined();
  });
});
