import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  browserShardMatrix,
  formatCiValidationPlan,
  planCiValidation,
} from "./ci-validation-plan.mjs";
import { loadGateCatalog, planValidation } from "./validation-gates.mjs";

const catalog = await loadGateCatalog();

function ciPlan(paths, options) {
  return planCiValidation(planValidation(paths, catalog), options);
}

describe("CI validation planning", () => {
  it("uses two shards for bounded changes and four for broad affected coverage", () => {
    expect(browserShardMatrix(ciPlan(["worker/gallery.ts"]))).toEqual([
      "1/2",
      "2/2",
    ]);
    const broad = ciPlan([
      "apps/editor/src/app/App.tsx",
      "apps/editor/src/features/simulation/spice-simulation-surface.tsx",
    ]);
    expect(broad.mode).toBe("focused");
    expect(browserShardMatrix(broad)).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    expect(
      browserShardMatrix(ciPlan(["apps/editor/src/lib/unmapped.ts"])),
    ).toEqual(["1/2", "2/2"]);
  });

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

  it("routes Shelf, snapshot history, duplicate correspondence and project sessions to their actual browser workflows", () => {
    for (const path of [
      "worker/gallery-do.ts",
      "apps/editor/src/components/shelf-wall.tsx",
      "apps/editor/src/components/gallery-version-diff.ts",
      "apps/editor/src/components/gallery-version-project.ts",
      "apps/editor/src/components/version-history-comparison.tsx",
      "apps/editor/src/components/version-history-dialog.css",
      "apps/editor/src/features/editor-shell/cloud-projects.ts",
      "apps/editor/src/features/editor-shell/gallery-topology-comparison.tsx",
      "apps/editor/src/features/editor-shell/gallery-topology-task.ts",
      "apps/editor/src/features/editor-shell/publish-gallery-dialog.css",
      "apps/editor/src/gallery-topology-match.ts",
      "apps/editor/src/gallery.css",
      "packages/netlist/src/equivalence.ts",
      "packages/netlist/src/index.ts",
      "packages/netlist/src/topology-correspondence.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toContain("apps/editor/e2e/gallery.spec.ts");
    }
    for (const path of [
      "apps/editor/src/features/editor-shell/project-tabs.tsx",
      "apps/editor/src/features/editor-shell/project-tabs.css",
      "apps/editor/src/features/project-code/project-code-panel.tsx",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toContain(
        "apps/editor/e2e/project-tabs.spec.ts",
      );
      expect(plan.e2eArgs, path).toContain(
        "apps/editor/e2e/project-file.spec.ts",
      );
    }
  });

  it("maps label naming, circuit settings and recovery changes to their browser contracts", () => {
    for (const [path, spec] of [
      ["apps/editor/src/components/recovery-banners.tsx", "recovery-hardening"],
      [
        "apps/editor/src/features/editor-shell/document-settings-code-assists.ts",
        "manual-editor",
      ],
      [
        "apps/editor/src/features/editor-shell/document-settings-code.ts",
        "manual-editor",
      ],
      [
        "apps/editor/src/features/editor-shell/document-settings-section.tsx",
        "manual-editor",
      ],
      ["packages/derived/src/annotation-text.ts", "manual-editor"],
      ["packages/derived/src/connectivity-index.ts", "wiring-semantics"],
      ["packages/derived/src/connectivity.ts", "wiring-semantics"],
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toContain(`apps/editor/e2e/${spec}.spec.ts`);
    }
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
        "apps/editor/e2e/simulation-storage.spec.ts",
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

  it.each([
    "apps/editor/src/features/wiring/wire-edit-controller.ts",
    // The contact resolver decides which conductor a wire click captures.
    "packages/derived/src/contact-target.ts",
  ])("keeps wire editing on its dedicated browser contract (%s)", (path) => {
    const plan = ciPlan([path]);
    expect(plan.mode).toBe("focused");
    expect(plan.e2eArgs).toEqual(["apps/editor/e2e/wiring-semantics.spec.ts"]);
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
      "apps/editor/src/features/properties/component-property-code.ts",
      "apps/editor/src/features/netlist-export/netlist-authoring.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual(
        expect.arrayContaining([properties, netlist, conversion]),
      );
      expect(plan.e2eArgs, path).not.toContain(
        "apps/editor/e2e/manual-editor.spec.ts",
      );
    }
    for (const path of [
      "apps/editor/src/app/App.tsx",
      "apps/editor/src/canvas/editor-canvas-surface.tsx",
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

  it("keeps editable netlists and bundled examples on their browser regressions", () => {
    const spec = "apps/editor/e2e/netlist-code-edit.spec.ts";
    const paths = [
      spec,
      "apps/editor/e2e/editor-fixtures.ts",
      "apps/editor/src/examples/two-stage-op-amp.icproj.json",
      "apps/editor/src/features/project-code/project-text-editor.tsx",
      "packages/netlist/src/export.ts",
      "packages/netlist/src/printed-netlist.ts",
      "packages/netlist/src/printers.ts",
    ];
    for (const changed of [...paths.map((path) => [path]), paths]) {
      const plan = ciPlan(changed);
      expect(plan.mode, changed.join(", ")).toBe("focused");
      expect(plan.e2eArgs).toContain(spec);
      expect(plan.e2eArgs).toContain(
        "apps/editor/e2e/netlist-workflows.spec.ts",
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

  it("routes shared dialog styles and SPICE language sources to their owning browser contracts", () => {
    const dialogPlan = ciPlan(["apps/editor/src/styles/editor-dialogs.css"]);
    expect(dialogPlan.mode).toBe("focused");
    expect(dialogPlan.e2eArgs).toContain(
      "apps/editor/e2e/manual-editor.spec.ts",
    );

    const languagePlan = ciPlan(["packages/spice/src/simulation-language.ts"]);
    expect(languagePlan.mode).toBe("focused");
    expect(languagePlan.e2eArgs).toContain(
      "apps/editor/e2e/simulation-code-editor.spec.ts",
    );

    const syntaxPlan = ciPlan(["packages/spice/src/syntax.ts"]);
    expect(syntaxPlan.mode).toBe("focused");
    expect(syntaxPlan.e2eArgs).toEqual(
      expect.arrayContaining([
        "apps/editor/e2e/netlist-conversion.spec.ts",
        "apps/editor/e2e/simulation-code-editor.spec.ts",
      ]),
    );
  });

  it("uses the small browser fallback for an unmapped product path", () => {
    const plan = ciPlan(["apps/editor/src/lib/new-helper.ts"]);
    expect(plan.mode).toBe("fallback");
    expect(plan.e2eArgs).toEqual([
      "apps/editor/e2e/component-insert.spec.ts",
      "apps/editor/e2e/runtime-crash-safety.spec.ts",
    ]);
  });

  it("does not allocate a browser runner for non-shipping tests and manifests", () => {
    expect(
      ciPlan([
        "apps/editor/src/app/App.test.tsx",
        "apps/local-host/src/local-host.test.ts",
        "apps/editor/package.json",
        "packages/platform-node/package.json",
        "package.json",
      ]),
    ).toMatchObject({
      heavy: true,
      browser: false,
      mode: "non-browser",
      e2eArgs: [],
    });
  });

  it("does not hide an unmapped path behind another focused selection", () => {
    const plan = ciPlan([
      "worker/gallery.ts",
      "apps/editor/src/lib/new-helper.ts",
    ]);
    expect(plan.mode).toBe("fallback");
    expect(plan.e2eArgs).toEqual([
      "apps/editor/e2e/component-insert.spec.ts",
      "apps/editor/e2e/gallery.spec.ts",
      "apps/editor/e2e/runtime-crash-safety.spec.ts",
    ]);
    expect(plan.reasons).toContain(
      "uncovered browser impact: apps/editor/src/lib/new-helper.ts",
    );
  });

  it("deduplicates fallback specs already selected by a mixed batch", () => {
    const plan = ciPlan([
      "apps/editor/e2e/component-insert.spec.ts",
      "apps/editor/e2e/gallery.spec.ts",
      "apps/editor/src/lib/new-helper.ts",
    ]);
    expect(plan.e2eArgs).toContain("apps/editor/e2e/gallery.spec.ts");
    expect(
      plan.e2eArgs.filter(
        (arg) => arg === "apps/editor/e2e/component-insert.spec.ts",
      ),
    ).toHaveLength(1);
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
