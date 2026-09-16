import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("CI workflow", () => {
  it("validates each current pull-request candidate once", () => {
    expect(workflow).toContain("  pull_request:\n");
    expect(workflow).not.toContain("merge_group");
  });

  it("retains all seven required check names", () => {
    for (const name of [
      "Static contracts",
      "Unit and integration tests",
      "Release contracts",
      "Browser tests (${{ matrix.shard }})",
    ])
      expect(workflow).toContain(`name: ${name}`);
    expect(workflow).toContain("1/4");
    expect(workflow).toContain("2/4");
    expect(workflow).toContain("3/4");
    expect(workflow).toContain("4/4");
  });

  it("keeps scheduled and manual audits on complete validation", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("force_args+=(--force-full)");
  });
});
