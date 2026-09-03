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

describe("staging before production", () => {
  it("puts a staging job in front of the production one", () => {
    expect(workflow).toContain("Deploy staging");
    expect(workflow).toMatch(
      /deploy:\s*\n\s*name: Deploy Worker\s*\n\s*needs: staging/u,
    );
  });

  it("does not block production when staging is not provisioned yet", () => {
    // This lands before the Cloudflare environment exists. If an unprovisioned
    // staging blocked deploys, it would jam the pipeline for everyone — the
    // exact failure this repository spent a night recovering from.
    expect(workflow).toContain("Staging is not provisioned yet");
    expect(workflow).toMatch(/needs\.staging\.result == 'success'/u);
  });

  it("refuses to reach production when staging actually failed", () => {
    // always() alone would run production regardless. The result check is
    // what makes staging a gate rather than a decoration.
    const gate = workflow.slice(workflow.indexOf("needs: staging"));
    expect(gate).toContain("always() && needs.staging.result == 'success'");
  });

  it("checks staging with the same paths production is checked with", () => {
    const stagingJob = workflow.slice(
      workflow.indexOf("Verify staging"),
      workflow.indexOf("deploy:\n"),
    );
    for (const path of ["/editor", "/analytics", "mcp-manifest.json"]) {
      expect(stagingJob).toContain(path);
    }
    expect(stagingJob).toContain("must answer 404");
  });

  it("puts the gate in front of every staging path, not just the API", () => {
    // The gate runs inside the Worker. Cloudflare's asset layer answers
    // before the Worker on any path outside `run_worker_first`, so with
    // production's narrow list staging refused anonymous callers on
    // `/api/*` and served them `/` and `/editor` at 200 -- the entire
    // unreleased application, public on a workers.dev hostname. Production
    // has no gate to lose, so it keeps the narrow list; staging must not.
    const config = readFileSync("wrangler.jsonc", "utf8");
    const stagingBlock = config.slice(config.indexOf('"staging": {'));
    expect(stagingBlock).toMatch(/"run_worker_first":\s*true/u);
    expect(stagingBlock).not.toMatch(/"run_worker_first":\s*\[/u);
  });

  it("keeps staging off production's domain", () => {
    // `routes` is an inheritable wrangler key. Without an override the staging
    // environment inherits production's custom domain and binds it to the
    // staging Worker -- which then refuses anonymous callers, so the live site
    // answers its own script requests with 401 and users get a blank page.
    // That happened on 2026-09-04. An empty array is the override; omitting
    // the key inherits.
    const config = readFileSync("wrangler.jsonc", "utf8");
    const stagingBlock = config.slice(config.indexOf('"staging": {'));
    expect(stagingBlock).toMatch(/"routes":\s*\[\s*\]/u);
  });

  it("checks production still owns its domain after staging deploys", () => {
    expect(workflow).toContain("Check production still owns its own domain");
    expect(workflow).toContain("analog-canvas.tokenzhang.com");
  });

  it("waits for the gate to be live before believing what staging says", () => {
    // Putting the secret publishes a new version; the old one answers for a
    // few seconds after. Verifying across that window fails staging, and a
    // failed staging freezes production deploys for the whole repository.
    expect(workflow).toContain("Wait for the access key to take effect");
    expect(workflow).toMatch(/The gate is live/u);
  });

  it("fails the deploy if staging is reachable without the key", () => {
    // A staging anyone can open is a second public site showing half-built
    // work. Being unlisted is not being private.
    expect(workflow).toContain("Staging must refuse an anonymous caller");
  });
});

describe("Cloudflare deploy workflow", () => {
  it("records the rollback target before the production deploy", () => {
    // Scoped to the production job: the staging job deploys too, and a naive
    // search finds its deploy first. Staging deliberately has no rollback —
    // nothing public is serving from it, so a bad staging deploy is a failed
    // gate rather than an outage.
    const productionJob = workflow.slice(workflow.indexOf("  deploy:\n"));
    const capture = productionJob.indexOf("Record the version to roll back to");
    const deploy = productionJob.indexOf("wrangler@4.120.1 deploy");
    expect(capture).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
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
