import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  formatCiValidationPlan,
  planCiValidation,
} from "./ci-validation-plan.mjs";
import { loadGateCatalog, planValidation } from "./validation-gates.mjs";

const catalog = await loadGateCatalog();

function ciPlan(paths, options) {
  return planCiValidation(planValidation(paths, catalog), options);
}

describe("CI validation planning", () => {
  it("skips implementation jobs for documentation-only work", () => {
    expect(ciPlan(["docs/user/getting-started.md"])).toMatchObject({
      heavy: false,
      browser: false,
      mode: "documentation",
      e2eArgs: [],
    });
  });

  it("selects the Gallery browser contract without unrelated editor specs", () => {
    expect(ciPlan(["worker/gallery.ts"])).toMatchObject({
      heavy: true,
      browser: true,
      mode: "focused",
      e2eArgs: ["apps/editor/e2e/gallery.spec.ts"],
    });
  });

  it("selects the existing Analog Simulation browser contract", () => {
    expect(
      ciPlan(["packages/simulation-service/src/service.ts"]),
    ).toMatchObject({
      heavy: true,
      mode: "focused",
      e2eArgs: [
        "apps/editor/e2e/agent-simulation.spec.ts",
        "apps/editor/e2e/gui-native-simulation.spec.ts",
        "apps/editor/e2e/mcp-native-simulation.spec.ts",
        "apps/editor/e2e/simulation-batch.spec.ts",
        "apps/editor/e2e/simulation-code-editor.spec.ts",
        "apps/editor/e2e/simulation-profile-probes.spec.ts",
        "apps/editor/e2e/simulation-setup.spec.ts",
        "apps/editor/e2e/simulation-spec-results.spec.ts",
        "apps/editor/e2e/simulation-workspace.spec.ts",
      ],
    });
  });

  it("selects native GUI coverage for simulation implementation and spec edits", () => {
    for (const path of [
      "apps/editor/src/features/simulation/spice-simulation-surface.tsx",
      "apps/editor/e2e/gui-native-simulation.spec.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toContain(
        "apps/editor/e2e/gui-native-simulation.spec.ts",
      );
    }
  });

  it("selects native MCP acceptance for MCP implementation and spec edits", () => {
    for (const path of [
      "apps/mcp-server/src/main.ts",
      "apps/editor/e2e/mcp-native-simulation.spec.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toContain(
        "apps/editor/e2e/mcp-native-simulation.spec.ts",
      );
    }
  });

  it("combines fixed browser contracts for a bounded cross-feature change", () => {
    expect(
      ciPlan([
        "worker/gallery.ts",
        "apps/editor/src/features/component-insert/symbol-catalog.ts",
      ]),
    ).toMatchObject({
      mode: "focused",
      e2eArgs: [
        "apps/editor/e2e/component-insert.spec.ts",
        "apps/editor/e2e/component-properties-catalog.spec.ts",
        "apps/editor/e2e/component-property-workflows.spec.ts",
        "apps/editor/e2e/gallery.spec.ts",
      ],
    });
  });

  it("keeps wire editing focused while retaining connected-edit integration checks", () => {
    const plan = ciPlan([
      "apps/editor/src/features/wiring/wire-edit-controller.ts",
    ]);
    expect(plan.mode).toBe("focused");
    expect(plan.e2eArgs).toContain("apps/editor/e2e/manual-editor.spec.ts");
    expect(plan.e2eArgs).toContain("apps/editor/e2e/wiring-semantics.spec.ts");
    for (const name of [
      "component-property-workflows",
      "netlist-workflows",
      "netlist-conversion",
    ])
      expect(plan.e2eArgs).not.toContain(`apps/editor/e2e/${name}.spec.ts`);
  });

  it("selects the extracted workflows from their production owners and shared dependencies", () => {
    const properties = "apps/editor/e2e/component-property-workflows.spec.ts";
    const netlist = "apps/editor/e2e/netlist-workflows.spec.ts";
    const conversion = "apps/editor/e2e/netlist-conversion.spec.ts";
    expect(
      ciPlan(["apps/editor/src/features/properties/component-property-code.ts"])
        .e2eArgs,
    ).toContain(properties);
    const exportPlan = ciPlan([
      "apps/editor/src/features/netlist-export/netlist-authoring.ts",
    ]);
    expect(exportPlan.e2eArgs).toEqual(
      expect.arrayContaining([netlist, conversion]),
    );
    for (const path of [
      "apps/editor/src/app/App.tsx",
      "apps/editor/src/canvas/editor-canvas-surface.tsx",
      "apps/editor/src/features/properties/component-property-code.ts",
      "apps/editor/src/features/netlist-export/netlist-authoring.ts",
      "apps/editor/src/features/text-editing/canvas-text-editor.tsx",
      "apps/editor/src/features/drafting/drafting-properties-panel.tsx",
      "apps/editor/e2e/manual-editor-fixtures.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual(
        expect.arrayContaining([
          properties,
          netlist,
          conversion,
          "apps/editor/e2e/manual-editor.spec.ts",
        ]),
      );
    }
  });

  it("keeps shared model changes on their mapped browser contracts", () => {
    const plan = ciPlan(["packages/model/src/schema/document.ts"]);
    expect(plan).toMatchObject({
      heavy: true,
      browser: true,
      mode: "focused",
    });
    expect(plan.e2eArgs).toEqual(
      expect.arrayContaining([
        "apps/editor/e2e/hierarchy.spec.ts",
        "apps/editor/e2e/project-file.spec.ts",
      ]),
    );
  });

  it("uses the small browser fallback for an unmapped product path", () => {
    const plan = ciPlan(["apps/editor/src/lib/new-helper.ts"]);
    expect(plan.mode).toBe("fallback");
    expect(plan.e2eArgs).toEqual([
      "apps/editor/e2e/manual-editor.spec.ts",
      "apps/editor/e2e/runtime-crash-safety.spec.ts",
      "apps/editor/e2e/web-agent-session.spec.ts",
    ]);
  });

  it("does not hide an unmapped path behind another focused selection", () => {
    const plan = ciPlan([
      "worker/gallery.ts",
      "apps/editor/src/lib/new-helper.ts",
    ]);
    expect(plan.mode).toBe("fallback");
    expect(plan.reasons).toContain(
      "uncovered browser impact: apps/editor/src/lib/new-helper.ts",
    );
  });

  it("keeps every browser spec reachable through a focused route", async () => {
    const directory = new URL("../../apps/editor/e2e/", import.meta.url);
    const specs = (await readdir(directory))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => `apps/editor/e2e/${name}`)
      .sort();

    for (const spec of specs) {
      const plan = ciPlan([spec]);
      expect(plan.mode, spec).toBe("focused");
      expect(plan.e2eArgs, spec).toContain(spec);
    }
  });

  it("does not turn validation-policy documentation into implementation CI", () => {
    expect(ciPlan(["docs/testing/README.md"])).toMatchObject({
      heavy: false,
      browser: false,
      mode: "documentation",
      e2eArgs: [],
    });
  });

  it("keeps workflow-only changes out of the browser runner", () => {
    expect(ciPlan([".github/workflows/ci.yml"])).toMatchObject({
      heavy: true,
      browser: false,
      mode: "non-browser",
      e2eArgs: [],
    });
  });

  it("forces complete validation for scheduled and manual events", () => {
    expect(
      ciPlan(["docs/user/getting-started.md"], { forceFull: true }),
    ).toMatchObject({
      heavy: true,
      browser: true,
      mode: "full",
      e2eArgs: [],
    });
  });

  it("renders the browser choice for job logs", () => {
    expect(formatCiValidationPlan(ciPlan(["worker/auth.ts"]))).toContain(
      "Browser selection: apps/editor/e2e/gallery.spec.ts",
    );
  });
});
