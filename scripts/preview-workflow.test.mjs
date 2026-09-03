import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The preview pipeline's own contract (ADR 0057). The preview is where every
 * merge lands and where the simulation feature is tried; these assertions
 * keep it from ever becoming a second way to reach production.
 */
const preview = readFileSync(".github/workflows/deploy-preview.yml", "utf8");
const production = readFileSync(".github/workflows/cloudflare.yml", "utf8");

describe("the preview deploy", () => {
  it("deploys the preview configuration file and nothing else", () => {
    expect(preview).toContain("deploy --config wrangler.preview.jsonc");
    // Never an environment of the production file, never the production
    // file itself, and never the production hostname.
    expect(preview).not.toContain("--env");
    expect(preview).not.toContain("analog-canvas.tokenzhang.com");
    expect(preview).toContain("analog-canvas-preview.tokenzhang.com");
  });

  it("pins the model files it bakes into the container image", () => {
    expect(preview).toMatch(/SKY130_TAG: sky130-[0-9a-f]{40}/u);
    expect(preview).toMatch(/SKY130_COMMON_SHA256: [0-9a-f]{64}/u);
    expect(preview).toMatch(/SKY130_FD_PR_SHA256: [0-9a-f]{64}/u);
    expect(preview).toContain("sha256sum --check");
    expect(preview).toContain("sky130.lib.spice");
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
    expect(preview).toContain("/api/simulate");
    expect(preview).toContain("hosted-container");
    // A 200 with a timed-out outcome is not a simulation.
    expect(preview).toContain('"status":"completed"');
    // The domain is created by the deploy and takes time to resolve.
    expect(preview).toMatch(/for _ in \$\(seq 1 \d+\); do\s*\n\s*if curl/u);
  });

  it("does not leak into the production workflow", () => {
    expect(production).not.toContain("wrangler.preview.jsonc");
  });
});
