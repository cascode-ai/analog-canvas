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

function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

describe("production entrances (Deployment rationale)", () => {
  it("deploys unlabeled merges directly and promotes tags or selected refs", () => {
    expect(workflow).toMatch(/branches:\s*\n\s*- main/u);
    expect(workflow).toMatch(/tags:\s*\n\s*- "v\*"/u);
    expect(workflow).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*ref:/u);
    expect(workflow).toContain('default: "main"');
    // The route is the pull request's `preview` label, read from GitHub;
    // a labeled merge stays on Preview until it is promoted.
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain(
      'node scripts/release-route.mjs --sha "$GITHUB_SHA" --github-output',
    );
    expect(workflow).toContain("needs.route.outputs.target == 'production'");
    expect(workflow).toContain("needs.route.result == 'success'");
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/')");
  });

  it("resolves the selected ref once and deploys that exact commit", () => {
    expect(workflow).toContain("ref: ${{ inputs.ref || github.ref }}");
    expect(workflow).toContain("git rev-parse 'HEAD^{commit}'");
    expect(workflow).toContain(
      "DIRECT_RELEASE: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    );
  });

  it("releases only commits that are already on main", () => {
    // A labeled pull request deploys its unmerged head to Preview; that
    // candidate must never become a way to ship unmerged code.
    const resolve = step("Resolve the release commit");
    expect(workflow).toContain("fetch-depth: 0");
    expect(resolve).toContain(
      'git merge-base --is-ancestor "$release_sha" origin/main',
    );
    expect(resolve).toContain("is not on main");
  });

  it("refuses to promote a commit the preview never proved", () => {
    // A promotion is only as good as the Preview run behind it. Releasing a
    // commit with no green preview deploy is the 2026-09-01 outage waiting to
    // happen again.
    const gate = step("The release must have a green preview deploy");
    expect(gate).toContain("if: env.DIRECT_RELEASE != 'true'");
    expect(gate).toContain("--workflow deploy-preview.yml");
    expect(gate).toContain("--status success");
    expect(gate).toContain("No successful preview deploy exists");
  });

  it("promotes the exact candidate preserved by that successful Preview run", () => {
    const download = step("Download the accepted Preview candidate");
    expect(download).toContain("if: env.DIRECT_RELEASE != 'true'");
    expect(download).toContain("actions/download-artifact@v4");
    expect(download).toContain(
      "preview-candidate-${{ steps.release.outputs.release_sha }}",
    );
    expect(download).toContain("run-id: ${{ steps.preview.outputs.run_id }}");
    expect(workflow).toContain("deployment-candidate.mjs verify");
    expect(workflow).toContain("--no-bundle");
    expect(workflow).toContain('--assets "$CANDIDATE_DIR/editor"');
    expect(workflow).not.toContain("playwright install");
  });

  it("builds a direct release once, with the action Preview uses", () => {
    // The only build in this workflow is the shared action, and only for a
    // direct release; a promotion deploys Preview's bytes unchanged.
    const build = step("Build the merged commit's deployment candidate");
    expect(build).toContain("if: env.DIRECT_RELEASE == 'true'");
    expect(build).toContain(
      "uses: ./.github/actions/build-deployment-candidate",
    );
    expect(build).toContain("wrangler-config: wrangler.jsonc");
    expect(build).toContain(
      "release-sha: ${{ steps.release.outputs.release_sha }}",
    );
    expect(workflow).not.toContain("pnpm install --frozen-lockfile");
    expect(workflow).not.toContain("wrangler.preview.jsonc");
    expect(
      workflow.indexOf("Build the merged commit's deployment candidate"),
    ).toBeLessThan(workflow.indexOf("Verify the deployment candidate"));
    expect(workflow.indexOf("Verify the deployment candidate")).toBeLessThan(
      workflow.indexOf("id: deploy_worker"),
    );
  });

  it("keeps production verification independent of an installed workspace", () => {
    expect(workflow).toContain(
      "https://analog-canvas.tokenzhang.com --production-smoke",
    );
    expect(workflow).not.toContain(
      "preview-simulation-smoke.mjs https://analog-canvas.tokenzhang.com\n",
    );
  });

  it("has no staging job and deploys no environment", () => {
    // env.staging inherited the production custom domain on 2026-09-03 and
    // took the public site down; the preview replaced it (Deployment rationale).
    expect(workflow).not.toContain("Deploy staging");
    expect(workflow).not.toContain("--env");
    expect(workflow).not.toContain("STAGING_ACCESS_KEY");
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

  it("rolls back post-deploy failures, including secret sync and verification", () => {
    const rollback = workflow.indexOf("Roll back a failed deployment");
    const deploy = workflow.indexOf("id: deploy_worker");
    const secrets = workflow.indexOf("name: Sync worker secrets");
    const verify = workflow.indexOf("id: verify");
    expect(deploy).toBeGreaterThan(-1);
    expect(secrets).toBeGreaterThan(deploy);
    expect(verify).toBeGreaterThan(secrets);
    expect(rollback).toBeGreaterThan(verify);
    // A failed sync skips verification but still leaves a changed Worker.
    // A failure before deployment must not roll back the serving version.
    expect(workflow.slice(rollback)).toMatch(
      /if:\s*failure\(\)\s*&&\s*steps\.deploy_worker\.outcome\s*==\s*'success'/u,
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

  it("verifies package integrity before deploy and the serving declaration afterwards", () => {
    const precheck = step("Verify the pinned MCP release before deployment");
    expect(precheck).toContain(
      "node scripts/verify-agent-manifest.mjs --asset-only",
    );
    expect(workflow.indexOf(precheck)).toBeLessThan(
      workflow.indexOf("- name: Deploy the verified candidate"),
    );
    const verifySection = workflow.slice(
      workflow.indexOf("Verify production deployment"),
      workflow.indexOf("Roll back a failed deployment"),
    );
    expect(verifySection).toContain(
      "node scripts/verify-agent-manifest.mjs https://analog-canvas.tokenzhang.com --manifest-only",
    );
  });
});
