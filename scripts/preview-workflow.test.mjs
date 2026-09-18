import { readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * The preview pipeline's own contract (Deployment rationale). The preview is
 * where labeled pull requests and their merges land, where manual debugging
 * happens, and where the simulation feature is tried; these assertions keep it
 * from ever becoming a second way to reach production.
 */
const preview = readFileSync(".github/workflows/deploy-preview.yml", "utf8");
const production = readFileSync(".github/workflows/cloudflare.yml", "utf8");
const buildAction = readFileSync(
  ".github/actions/build-deployment-candidate/action.yml",
  "utf8",
);
const agentJourney = readFileSync(
  "scripts/preview-agent-simulation-journey.mjs",
  "utf8",
);
const crossProjectJourney = readFileSync(
  "scripts/preview-cross-project-simulation-journey.mjs",
  "utf8",
);
const sourceGuiJourney = readFileSync(
  "scripts/preview-source-gui-journey.mjs",
  "utf8",
);
const acceptanceRunner = readFileSync(
  "scripts/run-preview-acceptance.mjs",
  "utf8",
);

describe("the preview deploy", () => {
  it("deploys the preview configuration file and nothing else", () => {
    expect(preview).toContain("--config wrangler.preview.jsonc");
    // Never an environment of the production file, never the production
    // file itself, and never the production hostname.
    expect(preview).not.toContain("--env");
    expect(preview).not.toContain("analog-canvas.tokenzhang.com");
    expect(preview).toContain("analog-canvas-preview.tokenzhang.com");
  });

  it("stages nothing for the image: the benchmark base image carries the models", () => {
    // The Dockerfile's FROM is the environment lock (see
    // worker/preview-config.test.ts); the workflow has no model download
    // to pin or verify any more.
    expect(preview).not.toContain("SKY130_TAG");
    expect(preview).not.toContain("sha256sum");
    expect(preview).not.toContain("volare");
  });

  it("reconciles the preview's bounded queue and artifact store before deploy", () => {
    const resources = preview.indexOf("Reconcile managed simulation resources");
    const deploy = preview.indexOf("Deploy to preview");
    expect(resources).toBeGreaterThanOrEqual(0);
    expect(deploy).toBeGreaterThan(resources);
    expect(preview).toContain("analog-canvas-simulation-preview-dlq");
    expect(preview).toContain("--message-retention-period-secs");
    expect(preview).toMatch(
      /queues update[\s\S]+queues create[\s\S]+queues update/u,
    );
    expect(preview).toContain(
      'r2 bucket create "$bucket" || $wrangler r2 bucket info',
    );
    expect(preview).toContain("simulation-artifact-retention");
    expect(preview).toContain("--expire-days 1");
  });

  it("verifies what a preview is for", () => {
    expect(preview).toContain("/api/channel");
    expect(preview).toContain('"preview"');
    // A page-shaped 200 is not a page: follow the shell to its script.
    expect(preview).toContain("references no script; it cannot boot");
    expect(preview).toMatch(/200\*javascript\*/u);
    expect(preview).toContain("must answer 404");
    expect(preview).toContain("Disallow: /");
    expect(preview).toContain("noindex");
    expect(preview).toContain("must read the production gallery");
    expect(preview).toContain("must be refused");
    expect(preview).toContain("PREVIEW_GOOGLE_CLIENT_ID");
    expect(preview).toContain("PREVIEW_GOOGLE_CLIENT_SECRET");
    expect(preview).toContain("/api/auth/providers");
    expect(preview).toContain("keeping human login dark");
    expect(preview).toContain(
      "Anonymous Preview Projects must require sign-in",
    );
    expect(preview).toContain(
      'node scripts/run-preview-acceptance.mjs "$PREVIEW_URL" --mode "$ACCEPTANCE_MODE"',
    );
    expect(buildAction).toContain("VITE_ICM_SIMULATION_UI: enabled");
    expect(buildAction).toContain("VITE_ICM_AGENT_UI: enabled");
    expect(buildAction).toContain("VITE_ICM_SIMULATION_TRANSPORT: managed");
    expect(buildAction).toContain("--filter @icm/mcp-server... build");
    expect(preview).toContain(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/google-chrome",
    );
    expect(preview).not.toContain("playwright install --with-deps chromium");
    expect(preview).toContain("Plan hosted acceptance depth");
    expect(preview).toContain("preview-acceptance-plan.mjs");
    expect(acceptanceRunner).toContain(
      'script: "scripts/preview-simulation-smoke.mjs"',
    );
    expect(acceptanceRunner).toContain(
      'script: "scripts/preview-agent-simulation-journey.mjs"',
    );
    expect(acceptanceRunner).toContain(
      'script: "scripts/preview-source-gui-journey.mjs"',
    );
    expect(acceptanceRunner).toContain(
      'script: "scripts/preview-cross-project-simulation-journey.mjs"',
    );
    expect(preview).toContain("PREVIEW_ACCEPTANCE_TOKEN");
    expect(preview).toContain("preview-acceptance-${{ env.RELEASE_SHA }}");
    // The reusable smoke is responsible for explicit transport selection,
    // numeric validation, and environment parity; the workflow must not
    // quietly restore an inline, default-executor-only probe.
    expect(preview).not.toContain('"${PREVIEW_URL}/api/simulate"');
    // The domain is created by the deploy and takes time to resolve.
    expect(preview).toMatch(/for _ in \$\(seq 1 \d+\); do\s*\n\s*if curl/u);
  });

  it("preserves only a fully accepted candidate for Production", () => {
    const build = preview.indexOf("Build immutable deployment candidate");
    const deploy = preview.indexOf("Deploy to preview");
    const lastAcceptance = preview.indexOf(
      "Run risk-selected Preview acceptance",
    );
    const preserve = preview.indexOf("Preserve accepted deployment candidate");
    expect(build).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(build);
    expect(lastAcceptance).toBeGreaterThan(deploy);
    expect(preserve).toBeGreaterThan(lastAcceptance);
    expect(preview).toContain(
      "uses: ./.github/actions/build-deployment-candidate",
    );
    expect(buildAction).toContain("deployment-candidate.mjs create");
    // Packaging validates its inputs while creating the candidate; the
    // destination checks provenance/inventory once before deployment.
    expect(buildAction).not.toContain("deployment-candidate.mjs verify");
    expect(production).toContain("deployment-candidate.mjs verify");
    expect(preview).toContain("preview-candidate-${{ env.RELEASE_SHA }}");
    expect(preview).toContain("--no-bundle");
  });

  it("promotes released capabilities while preserving the channel data boundary", () => {
    expect(production).not.toContain("wrangler.preview.jsonc");
    expect(buildAction).toContain("VITE_ICM_SIMULATION_UI: enabled");
    expect(buildAction).toContain("VITE_ICM_AGENT_UI: enabled");
    expect(buildAction).toContain("VITE_ICM_SIMULATION_TRANSPORT: managed");
    expect(buildAction).toContain("VITE_ICM_TIMING_UI: disabled");
    expect(production).toContain("Download the accepted Preview candidate");
    expect(production).toContain("Deploy the verified candidate");
    expect(production).not.toContain("pnpm --filter @icm/editor... build");
    expect(production).not.toContain("PREVIEW_ACCEPTANCE_TOKEN");
    expect(production).not.toContain(
      "preview-cross-project-simulation-journey.mjs",
    );
    expect(production).not.toContain("analog-canvas-simulation-preview");
    // UI release controls do not retire the shared machine contracts.
    expect(production).toContain("/api/agent/mcp-manifest.json");
  });

  it("prepares production resources and credentials before exposing simulation", () => {
    const resources = production.indexOf(
      "Reconcile production simulation resources",
    );
    const deploy = production.indexOf("id: deploy_worker");
    expect(resources).toBeGreaterThanOrEqual(0);
    expect(deploy).toBeGreaterThan(resources);
    expect(
      production.indexOf('test -n "$SIMULATION_UPSTREAM_TOKEN"'),
    ).toBeLessThan(deploy);
    expect(production).toContain("analog-canvas-simulation-production-dlq");
    expect(production).toContain(
      "analog-canvas-simulation-artifacts-production",
    );
    expect(production).toContain("--expire-days 1");
    expect(production).toContain(
      "SIMULATION_UPSTREAM_TOKEN: ${{ secrets.SIMULATION_UPSTREAM_TOKEN }}",
    );
  });

  it("verifies the accepted bytes and public simulation within rollback protection", () => {
    const verify = production.indexOf("id: verify");
    const rollback = production.indexOf("name: Roll back a failed deployment");
    for (const commandText of [
      "preview-simulation-smoke.mjs",
      "deployment-candidate.mjs verify-live",
    ]) {
      const command = production.indexOf(commandText);
      expect(command).toBeGreaterThan(verify);
      expect(command).toBeLessThan(rollback);
    }
    expect(production).not.toContain("preview-agent-simulation-journey.mjs");
    expect(production).not.toContain("preview-source-gui-journey.mjs");
    expect(production).toContain("Production Agent session cleanup answered");
    expect(production).toContain("circuit.snapshot");
    expect(production).toContain(
      "failure() && steps.deploy_worker.outcome == 'success'",
    );
    expect(production).toContain("Record the version to roll back to");
  });

  it("injects its recoverable failure through the current authored-output contract", () => {
    expect(agentJourney).toContain("invalidConfig.outputs[0]");
    expect(agentJourney).toContain("replaceSimulationExperimentConfig(");
    expect(agentJourney).toContain("firstOutput.expression.anchor");
    expect(agentJourney).not.toContain("invalidSetup.input.probes");
    expect(agentJourney).not.toContain("invalidSetup.input.outputs");
  });

  it("separates GUI output downloads from complete diagnostic exports", () => {
    expect(sourceGuiJourney).not.toContain("More code actions");
    expect(sourceGuiJourney).not.toContain("Advanced configuration");
    expect(sourceGuiJourney).toContain('name: "Simulation files"');
    expect(sourceGuiJourney).toContain('getByRole("menuitem", { name: action');
    expect(sourceGuiJourney).toContain('"Export diagnostic bundle…"');
    expect(sourceGuiJourney).toContain(
      'downloadArtifactGroup("Run", "run.zip")',
    );
    expect(sourceGuiJourney).not.toContain('getByRole("tab", { name: "Files"');
    expect(sourceGuiJourney).toContain(
      'entryFromZip(diagnosticEntries, "prepared.json")',
    );
    expect(sourceGuiJourney).toContain(
      'entryFromZip(diagnosticEntries, "result.json")',
    );
  });

  it("opens the icon-only Netlist menu through its accessible name", () => {
    expect(
      sourceGuiJourney.match(/summary\[aria-label="Netlist"\]/gu),
    ).toHaveLength(2);
    expect(sourceGuiJourney).not.toContain("hasText: /^Netlist$/u");
  });

  it("imports a Cloud Project Cell before compiling the cross-Project Testbench", () => {
    expect(crossProjectJourney).toContain('action: "list-projects"');
    expect(crossProjectJourney).toContain('action: "list-cells"');
    expect(crossProjectJourney).toContain('action: "import-cell"');
    expect(crossProjectJourney).toContain('kind: "add_document"');
    expect(crossProjectJourney).toContain('kind: "upsert_simulation_folder"');
    expect(crossProjectJourney).toContain("nativeImportedTestbench(");
    expect(crossProjectJourney).toContain("collectNativeRunEvidence({");
    expect(crossProjectJourney).toContain('"op-0.csv"');
    expect(crossProjectJourney).toContain("downloadPublishedMcp");
    expect(crossProjectJourney).toContain(
      "config/vacask-preview-environment.json",
    );
    expect(crossProjectJourney).toContain("expectedEnvironment");
    expect(crossProjectJourney).toContain('probe.name === "vout"');
    expect(crossProjectJourney).toContain('operation: "prepare"');
    expect(crossProjectJourney).toContain('operation: "start"');
    expect(crossProjectJourney).toContain('operation: "read"');
    expect(crossProjectJourney).toContain("acceptance-report.json");
  });

  it("refuses missing or shared migration targets before starting cross-Project acceptance", () => {
    execSync(
      "pnpm --filter @icm/project-protocol... --filter @icm/spice-run build",
      { stdio: "pipe", timeout: 180000 },
    );
    for (const url of [
      undefined,
      "https://analog-canvas-preview.tokenzhang.com",
      "https://analog-canvas.tokenzhang.com",
    ]) {
      const args = url
        ? [
            "--url",
            url,
            "--mcp-bundle",
            "does-not-exist.mjs",
            "--mcp-sha256",
            "a".repeat(64),
            "--environment",
            "does-not-exist.json",
          ]
        : [];
      let failure;
      try {
        execFileSync(
          process.execPath,
          ["scripts/preview-cross-project-simulation-journey.mjs", ...args],
          {
            encoding: "utf8",
            stdio: "pipe",
            timeout: 15000,
            windowsHide: true,
          },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure?.status).toBe(1);
      expect(failure?.stderr).toContain(
        url
          ? "Do not run migration acceptance on Production or shared Preview"
          : "Supply --url",
      );
      expect(failure?.stderr).not.toContain("ENOENT");
      expect(failure?.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    }
  }, 190000);
});

describe("label-routed releases (Deployment rationale)", () => {
  it("deploys a same-repository pull request while it carries the preview label", () => {
    expect(preview).toMatch(
      /pull_request:\s*\n\s*types: \[opened, labeled, synchronize, reopened\]/u,
    );
    expect(preview).toContain(
      "contains(github.event.pull_request.labels.*.name, 'preview')",
    );
    expect(preview).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    // Adding some other label must not redeploy the pull request.
    expect(preview).toContain(
      "(github.event.action != 'labeled' || github.event.label.name == 'preview')",
    );
    // The pull request's own head is deployed, not GitHub's merge preview.
    expect(preview).toContain(
      "RELEASE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    );
    expect(preview).toContain("ref: ${{ env.RELEASE_SHA }}");
    expect(preview).toContain('--base "$PULL_REQUEST_BASE_SHA"');
  });

  it("deploys a merge to Preview only when its pull request was labeled", () => {
    expect(preview).toContain("pull-requests: read");
    expect(preview).toContain(
      'node scripts/release-route.mjs --sha "$GITHUB_SHA" --github-output',
    );
    expect(preview).toContain("needs.route.outputs.target == 'preview'");
    expect(preview).toContain("needs.route.result == 'success'");
    // A manual run still deploys any selected branch.
    expect(preview).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("builds both channels' candidates through one action", () => {
    expect(preview).toContain("wrangler-config: wrangler.preview.jsonc");
    expect(production).toContain("wrangler-config: wrangler.jsonc");
    expect(buildAction).toContain("using: composite");
    expect(buildAction).toContain('--config "$WRANGLER_CONFIG"');
    expect(buildAction).toContain("--dry-run");
    expect(buildAction).toContain("pnpm install --frozen-lockfile");
    expect(buildAction).toContain(
      '"$CANDIDATE_DIR" "$RELEASE_SHA" "$WORKER_BUNDLE_DIR"',
    );
    expect(buildAction).not.toContain("GITHUB_SHA");
  });
});
