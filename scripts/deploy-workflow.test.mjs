import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The deploy pipeline's own contract.
 *
 * On 2026-09-01 a bad deploy served 500s for twenty minutes. The pipeline
 * DETECTED it — six failed verification attempts — went red, and left
 * production broken, because detection was all it could do. These assertions
 * exist so the recovery path cannot quietly disappear the way it was quietly
 * absent, and because this file is one nobody exercises until the day it
 * matters.
 */
const workflow = readFileSync(".github/workflows/cloudflare.yml", "utf8");

describe("Cloudflare deploy workflow", () => {
  it("records the rollback target before the deploy changes anything", () => {
    const capture = workflow.indexOf("Record the version to roll back to");
    const deploy = workflow.indexOf("wrangler@4.120.1 deploy");
    expect(capture).toBeGreaterThan(-1);
    // Read after deploying, the "previous" version is the broken one.
    expect(capture).toBeLessThan(deploy);
  });

  it("rolls back when verification fails", () => {
    expect(workflow).toContain("Roll back a failed deployment");
    expect(workflow).toMatch(
      /if:\s*failure\(\)\s*&&\s*steps\.verify\.outcome/u,
    );
    expect(workflow).toContain("wrangler@4.120.1 rollback");
  });

  it("re-verifies after rolling back", () => {
    // A rollback that is not checked is just a second unverified deploy.
    const rollbackSection = workflow.slice(
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(rollbackSection).toContain("/editor");
    expect(rollbackSection).toContain("did not restore");
  });

  it("fails the job even when the rollback succeeds", () => {
    // Recovery is not success: a red run is how anyone learns this happened.
    const rollbackSection = workflow.slice(
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(rollbackSection).toContain("was rolled back");
    expect(rollbackSection.trimEnd().endsWith("exit 1")).toBe(true);
  });

  it("says so loudly when it cannot roll back at all", () => {
    // The one outcome worse than a failed deploy is a failed deploy nobody
    // can undo. It must not be reported the same way as a successful undo.
    expect(workflow).toContain("no rollback target was recorded");
    expect(workflow).toContain("needs a human");
  });

  it("requires a missing hashed asset to answer 404", () => {
    // This check once asserted the opposite: it required the shell at 200,
    // which was the #493 bug recorded as the expected answer. It then rolled
    // back the fix for that bug, correctly obeying a wrong instruction. The
    // assertion exists so the old expectation cannot come back quietly.
    const verifySection = workflow.slice(
      workflow.indexOf("Verify production deployment"),
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(verifySection).toContain("App-deploy-smoke-missing.js");
    expect(verifySection).toMatch(/"404 "\*\)/u);
    expect(verifySection).toContain("must answer 404");
  });

  it("still requires a client route to receive the shell", () => {
    // The other half of the boundary. Turning every miss into a 404 would
    // break /editor, which is the failure this whole area started from.
    const verifySection = workflow.slice(
      workflow.indexOf("Verify production deployment"),
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(verifySection).toContain("must receive the shell");
    expect(verifySection).toContain("doctype html");
  });

  it("verifies the editor route, which is what broke", () => {
    const verifySection = workflow.slice(
      workflow.indexOf("Verify production deployment"),
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(verifySection).toContain("analog-canvas.tokenzhang.com/editor");
  });
});
