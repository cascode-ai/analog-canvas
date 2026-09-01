import { describe, expect, it } from "vitest";

import { rollbackTargetFrom } from "./deploy-rollback-target.mjs";

/** Shape wrangler prints for `deployments list --json`, newest first. */
const deployment = (...versionIds) => ({
  id: `deployment-${versionIds.join("-")}`,
  versions: versionIds.map((id) => ({ version_id: id, percentage: 100 })),
});

describe("rollback target selection", () => {
  it("picks the version that was live before the deploy just made", () => {
    expect(
      rollbackTargetFrom([deployment("broken"), deployment("good")]),
    ).toEqual({ ok: true, versionId: "good" });
  });

  it("skips another slice of the same broken deploy", () => {
    // A gradual rollout puts two versions in one deployment. Taking "the
    // second entry" would roll back to the other half of what just broke.
    expect(
      rollbackTargetFrom([
        deployment("broken", "good"),
        deployment("broken"),
        deployment("older"),
      ]),
    ).toEqual({ ok: true, versionId: "older" });
  });

  it("refuses rather than guessing when nothing precedes the deploy", () => {
    // A first-ever deploy has nothing to restore. Reporting success here
    // would leave production broken while claiming the pipeline recovered.
    expect(rollbackTargetFrom([deployment("only")])).toEqual({
      ok: false,
      reason: "no earlier version to roll back to",
    });
    expect(rollbackTargetFrom([])).toEqual({
      ok: false,
      reason: "no deployments reported",
    });
  });

  it("refuses when the current deployment reports no version id", () => {
    expect(rollbackTargetFrom([{ id: "d1", versions: [] }])).toEqual({
      ok: false,
      reason: "current deployment reports no version id",
    });
  });

  it("reads the id field wrangler uses when version_id is absent", () => {
    expect(
      rollbackTargetFrom([
        { id: "d1", versions: [{ id: "broken" }] },
        { id: "d0", versions: [{ id: "good" }] },
      ]),
    ).toEqual({ ok: true, versionId: "good" });
  });
});
