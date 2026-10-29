import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
function job(id) {
  return workflow.split(`\n  ${id}:\n`)[1]?.split(/\n  [a-z_]+:\n/u)[0];
}

describe("CI workflow", () => {
  it("keeps the required check names branch protection depends on", () => {
    for (const name of ["Core contracts", "Browser tests"])
      expect(workflow).toContain(`name: ${name}\n`);
  });

  it("fails each required check when the job it aggregates fails", () => {
    // Without always() a failed shard skips the aggregate, and GitHub
    // counts a skipped required check as passing.
    expect(workflow).toContain(
      "if: always() && github.event_name == 'merge_group' && !(needs.changes.result == 'success' && needs.changes.outputs.heavy == 'false' && needs.changes.outputs.mode == 'documentation')",
    );
    expect(workflow).toContain(
      "needs: [changes, core_build, core_static, core_unit, core_release]",
    );
    expect(workflow).toContain("CORE_NEEDS: ${{ toJSON(needs) }}");
    expect(workflow).toContain("run: node scripts/check-core-results.mjs");
    expect(workflow).toContain(
      "if: always() && github.event_name == 'merge_group' && needs.changes.outputs.browser == 'true'",
    );
    expect(workflow).toContain('test "$SHARD_RESULT" = "success"');
  });

  it("runs the aggregate for a broken plan but skips PRs and confirmed documentation", () => {
    const condition = job("core").match(/    if: (.+)/u)[1];
    const enabled = (event, result, outputs) =>
      runInNewContext(condition, {
        always: () => true,
        github: { event_name: event },
        needs: { changes: { result, outputs } },
      });
    expect(enabled("pull_request", "success", { heavy: "true" })).toBe(false);
    expect(
      enabled("merge_group", "success", {
        heavy: "false",
        mode: "documentation",
      }),
    ).toBe(false);
    for (const result of ["failure", "cancelled", "skipped"])
      expect(enabled("merge_group", result, {})).toBe(true);
    expect(enabled("merge_group", "success", {})).toBe(true);
    expect(enabled("merge_group", "success", { heavy: "true" })).toBe(true);
  });

  it("allows static and shared build together, then unit and release together", () => {
    for (const id of ["core_static", "core_build"])
      expect(job(id).match(/    needs: (.+)/u)[1]).toBe("changes");
    for (const id of ["core_unit", "core_release"]) {
      expect(job(id).match(/    needs: (.+)/u)[1]).toBe(
        "[changes, core_build]",
      );
      expect(job(id)).toContain("actions/download-artifact@v4");
      expect(job(id)).toContain(
        "artifact-ids: ${{ needs.core_build.outputs.artifact_id }}",
      );
      expect(job(id)).not.toContain("github.run_attempt");
    }
    expect(job("core_static")).toContain("fetch-depth: 0");
    expect(job("core_static")).toContain(
      "FORMAT_BASE_SHA: ${{ github.event.merge_group.base_sha }}",
    );
    expect(job("core_static")).toContain("run: pnpm ci:static");
    expect(job("core_unit")).toContain("run: pnpm ci:unit");
    expect(job("core_release")).toContain("run: pnpm release:verify:built");
  });

  it("retains the successful producer's artifact when only failed consumers rerun", () => {
    expect(job("core_build")).toContain(
      "artifact_id: ${{ steps.shared_build.outputs.artifact-id }}",
    );
    expect(job("core_build")).toContain(
      "- id: shared_build\n        uses: actions/upload-artifact@v4",
    );
    expect(job("core_build")).toContain(
      "core-packages-${{ github.sha }}-${{ github.run_attempt }}",
    );
    for (const id of ["core_unit", "core_release"])
      expect(job(id)).toContain("merge-multiple: true");
  });

  it("runs every unit shard without filtering tests or masking a failed shard", () => {
    const unit = job("core_unit");
    expect(unit).toContain("shard: [1/3, 2/3, 3/3]");
    expect(unit).toContain("fail-fast: false");
    expect(unit).not.toContain("continue-on-error:");
    expect(unit.match(/        run: pnpm ci:unit.*$/mu)[0].trim()).toBe(
      "run: pnpm ci:unit --shard=${{ matrix.shard }}",
    );
    expect(unit).toContain('ICM_CI_PACKAGE_BUILD: "1"');
    expect(unit).toContain("run: node scripts/ci-package-build.mjs verify");
    expect(job("core")).toContain(
      "needs: [changes, core_build, core_static, core_unit, core_release]",
    );
  });
});
