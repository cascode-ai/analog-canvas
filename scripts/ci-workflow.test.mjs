import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("CI workflow", () => {
  it("runs the checks once, in the merge queue, planned by changed paths", () => {
    expect(workflow).toContain("  pull_request:\n");
    expect(workflow).toContain("  merge_group:\n");
    // A pull request only plans; its required checks skip, which counts as
    // passing, and the queue runs them on the candidate merged with main.
    expect(workflow).toContain(
      "if: github.event_name == 'merge_group' && needs.changes.outputs.heavy == 'true'\n",
    );
    expect(workflow).toContain(
      "if: always() && github.event_name == 'merge_group' && needs.changes.outputs.browser == 'true'",
    );
    // Test-Impact is still enforced where the checks run.
    expect(workflow).toContain(
      "BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}",
    );
    // A queued group is planned from the main it was queued on, not forced
    // full.
    expect(workflow).toContain('base="$MERGE_GROUP_BASE_SHA"');
    expect(workflow).not.toContain("--force-full");
  });

  it("uses runner Chrome for one core and one affected-browser job", () => {
    for (const name of ["Core contracts", "Browser tests"])
      expect(workflow).toContain(`name: ${name}`);
    expect(workflow).toContain(
      "if: github.event_name == 'merge_group' && needs.changes.outputs.browser == 'true'",
    );
    expect(workflow).toContain(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/google-chrome",
    );
    expect(workflow).not.toContain("mcr.microsoft.com/playwright");
    expect(workflow).not.toContain("playwright install --with-deps chromium");
  });

  it("avoids duplicate static work and builds only editor dependencies for browser tests", () => {
    expect(workflow).toContain(
      "if: steps.plan.outputs.mode == 'documentation'",
    );
    expect(packageJson.scripts["ci:static"]).toContain(
      "agent-docs:generated:check",
    );
    expect(packageJson.scripts["ci:static"]).not.toContain("agent-docs:check");
    expect(packageJson.scripts["ci:e2e"]).toContain("@icm/editor^...");
    expect(packageJson.scripts["ci:e2e"]).not.toContain("!@icm/editor");
  });

  it("uses the planner's shard count while aggregating every shard into the required check", () => {
    expect(workflow).toContain(
      "browser_shards: ${{ steps.plan.outputs.browser_shards }}",
    );
    expect(workflow).toContain(
      "shard: ${{ fromJSON(needs.changes.outputs.browser_shards) }}",
    );
    expect(workflow).toContain(
      "SHARD_RESULT: ${{ needs.browser_shard.result }}",
    );
    expect(workflow).toContain('test "$SHARD_RESULT" = "success"');
  });

  it("runs no scheduled, manual or full browser audit", () => {
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("cron:");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).not.toContain("Full browser audit");
    expect(workflow).not.toContain(
      "if: needs.changes.outputs.heavy == 'true'\n",
    );
  });
});
