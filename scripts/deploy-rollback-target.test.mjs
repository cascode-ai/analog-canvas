import { describe, expect, it } from "vitest";

import { rollbackTargetFrom } from "./deploy-rollback-target.mjs";

/** Shape wrangler prints for `deployments list --json`: oldest first. */
const deployment = (createdOn, ...versions) => ({
  id: `deployment-${createdOn}`,
  created_on: `2026-10-08T${createdOn}.000Z`,
  versions: versions.map(([id, percentage = 100]) => ({
    version_id: id,
    percentage,
  })),
});

describe("rollback target selection", () => {
  it("picks the version serving now: the newest deployment's, whatever order wrangler lists them in", () => {
    // Read before the deploy, the newest deployment is what is live. On
    // 2026-10-08 the old reading took the head of an oldest-first list and
    // restored a version from a deploy two releases back.
    const listed = [
      deployment("16:23:10", ["older"]),
      deployment("16:23:15", ["older-sync"]),
      deployment("16:34:50", ["live"]),
    ];
    expect(rollbackTargetFrom(listed)).toEqual({ ok: true, versionId: "live" });
    expect(rollbackTargetFrom([...listed].reverse())).toEqual({
      ok: true,
      versionId: "live",
    });
  });

  it("takes the slice carrying most traffic in a gradual rollout", () => {
    expect(
      rollbackTargetFrom([
        deployment("16:30:00", ["earlier"]),
        deployment("16:34:50", ["canary", 10], ["live", 90]),
      ]),
    ).toEqual({ ok: true, versionId: "live" });
  });

  it("reads the id field wrangler uses when version_id is absent", () => {
    expect(
      rollbackTargetFrom([
        {
          id: "d1",
          created_on: "2026-10-08T16:34:50.000Z",
          versions: [{ id: "live", percentage: 100 }],
        },
      ]),
    ).toEqual({ ok: true, versionId: "live" });
  });

  it("refuses rather than guessing", () => {
    // Reporting success here would leave production broken while claiming
    // the pipeline recovered.
    expect(rollbackTargetFrom([])).toEqual({
      ok: false,
      reason: "no deployments reported",
    });
    expect(
      rollbackTargetFrom([
        { id: "d1", created_on: "2026-10-08T16:34:50.000Z", versions: [] },
      ]),
    ).toEqual({
      ok: false,
      reason: "current deployment reports no version id",
    });
    // Without creation times the newest cannot be told apart.
    expect(
      rollbackTargetFrom([{ id: "d1", versions: [{ version_id: "x" }] }]),
    ).toEqual({ ok: false, reason: "deployments carry no creation time" });
  });
});
