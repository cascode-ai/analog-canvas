import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("CI workflow", () => {
  it("validates each current pull-request candidate once", () => {
    expect(workflow).toContain("  pull_request:\n");
    expect(workflow).not.toContain("merge_group");
  });

  it("uses runner Chrome for one core and one affected-browser job", () => {
    for (const name of ["Core contracts", "Browser tests"])
      expect(workflow).toContain(`name: ${name}`);
    expect(workflow).toContain(
      "if: github.event_name == 'pull_request' && needs.changes.outputs.browser == 'true'",
    );
    expect(workflow).toContain(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/google-chrome",
    );
    expect(workflow).not.toContain("mcr.microsoft.com/playwright");
    expect(workflow).not.toContain("playwright install --with-deps chromium");
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

  it("keeps scheduled and manual audits on complete validation", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("force_args+=(--force-full)");
    expect(workflow).toContain("Full browser audit (${{ matrix.shard }})");
    for (const shard of ["1/4", "2/4", "3/4", "4/4"])
      expect(workflow).toContain(shard);
  });
});
