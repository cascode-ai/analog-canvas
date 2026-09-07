import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The preview pipeline's own contract (ADR 0057). The preview is where every
 * merge lands and where the simulation feature is tried; these assertions
 * keep it from ever becoming a second way to reach production.
 */
const preview = readFileSync(".github/workflows/deploy-preview.yml", "utf8");
const production = readFileSync(".github/workflows/cloudflare.yml", "utf8");
const agentJourney = readFileSync(
  "scripts/preview-agent-simulation-journey.mjs",
  "utf8",
);

describe("the preview deploy", () => {
  it("deploys the preview configuration file and nothing else", () => {
    expect(preview).toContain("deploy --config wrangler.preview.jsonc");
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
    expect(preview).toContain(
      'node scripts/preview-simulation-smoke.mjs "$PREVIEW_URL"',
    );
    expect(preview).toContain("VITE_ICM_AGENT_UI: enabled");
    expect(preview).toContain("pnpm --filter @icm/mcp-server... build");
    expect(preview).toContain("playwright install --with-deps chromium");
    expect(preview).toContain(
      'node scripts/preview-agent-simulation-journey.mjs "$PREVIEW_URL"',
    );
    expect(preview).toContain("preview-agent-simulation-${{ github.sha }}");
    // The reusable smoke is responsible for explicit transport selection,
    // numeric validation, and environment parity; the workflow must not
    // quietly restore an inline, default-executor-only probe.
    expect(preview).not.toContain('"${PREVIEW_URL}/api/simulate"');
    // The domain is created by the deploy and takes time to resolve.
    expect(preview).toMatch(/for _ in \$\(seq 1 \d+\); do\s*\n\s*if curl/u);
  });

  it("does not leak into the production workflow", () => {
    expect(production).not.toContain("wrangler.preview.jsonc");
    expect(production).not.toContain("VITE_ICM_AGENT_UI: enabled");
    expect(production).not.toContain("preview-agent-simulation-journey.mjs");
  });

  it("injects its recoverable failure through the current authored-output contract", () => {
    expect(agentJourney).toContain("invalidSetup.input.outputs[0]");
    expect(agentJourney).toContain("firstOutput.expression.anchor");
    expect(agentJourney).not.toContain("invalidSetup.input.probes");
  });
});
