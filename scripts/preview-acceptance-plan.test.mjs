import { describe, expect, it } from "vitest";

import { planPreviewAcceptance } from "./preview-acceptance-plan.mjs";

describe("Preview acceptance planning", () => {
  it("keeps ordinary editor changes on the fast hosted smoke", () => {
    expect(
      planPreviewAcceptance([
        "apps/editor/src/features/wiring/use-wire-interaction.ts",
        "packages/edit-engine/src/routing-planner.ts",
      ]),
    ).toEqual({ mode: "fast", deepPaths: [] });
  });

  it("uses deep qualification for hosted simulation and Agent boundaries", () => {
    for (const path of [
      "apps/editor/src/agent/use-agent-session.ts",
      "apps/editor/src/features/simulation/code-workspace.tsx",
      "packages/netlist/src/simulation-compile.ts",
      "packages/spice-run/src/index.ts",
      "worker/simulation.ts",
      "scripts/preview-source-gui-journey.mjs",
      ".github/workflows/deploy-preview.yml",
    ]) {
      expect(planPreviewAcceptance([path]), path).toMatchObject({
        mode: "deep",
        deepPaths: [path],
      });
    }
  });

  it("lets manual recovery force deep acceptance", () => {
    expect(planPreviewAcceptance([], { forceDeep: true })).toMatchObject({
      mode: "deep",
    });
  });
});
