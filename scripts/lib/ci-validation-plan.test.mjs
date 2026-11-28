import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  browserShardMatrix,
  countSpecTests,
  locateSpecTest,
  planCiValidation,
  unitShardMatrix,
} from "./ci-validation-plan.mjs";
import { loadGateCatalog, planValidation } from "./validation-gates.mjs";

const catalog = await loadGateCatalog();
// The general editing workflows, one spec per feature (#1537).
const editingSpecs = [
  "circuit-authoring",
  "copy-paste",
  "drawing-style",
  "editor-shell",
  "label-editing",
  "label-typography",
  "move-and-drag",
  "rotate-and-mirror",
  "selection-and-find",
  "wire-drawing",
  "wire-editing",
].map((name) => `apps/editor/e2e/${name}.spec.ts`);
// The Gallery workflows: the wall, accounts, moderation, publishing, history
// and duplicates (#1646).
const gallerySpecs = [
  "account",
  "duplicates",
  "history",
  "moderation",
  "publish",
  "wall",
].map((name) => `apps/editor/e2e/gallery-${name}.spec.ts`);
gallerySpecs.unshift("apps/editor/e2e/boards-regional-retry.spec.ts");
gallerySpecs.push("apps/editor/e2e/local-examples.spec.ts");
gallerySpecs.push("apps/editor/e2e/regional-review.spec.ts");

function ciPlan(paths, options) {
  return planCiValidation(planValidation(paths, catalog), options);
}

const properties = "apps/editor/e2e/component-property-workflows.spec.ts";
const netlist = "apps/editor/e2e/netlist-workflows.spec.ts";
const conversion = "apps/editor/e2e/netlist-conversion.spec.ts";
const rnl = "apps/editor/e2e/rnl-interchange.spec.ts";

// The browser smoke for unmapped product paths: crash recovery and two
// component-insert cases located by their titles.
const placementSmoke = locateSpecTest(
  "apps/editor/e2e/component-insert.spec.ts",
  "a part set down beside a pin is pulled onto it and connects",
);
const newCircuitSmoke = locateSpecTest(
  "apps/editor/e2e/component-insert.spec.ts",
  "new circuits open Library and Netlist, keep the saved preference, and mirror Library annotations in the menu",
);
const fallbackSpecs = [
  placementSmoke,
  newCircuitSmoke,
  "apps/editor/e2e/runtime-crash-safety.spec.ts",
];

describe("CI validation planning", () => {
  it("plans opt-in browser evidence separately from ordinary CI coverage", () => {
    for (const [spec, workflow, job] of [
      ["sg13g2-simulation", ".github/workflows/sg13g2-tests.yml", "qualify"],
      ["performance", ".github/workflows/performance.yml", "measure"],
    ]) {
      const path = `apps/editor/e2e/${spec}.spec.ts`;
      const plan = planValidation([path], catalog);
      expect(plan.selectedGates.flatMap((gate) => gate.command)).not.toContain(
        path,
      );
      expect(planCiValidation(plan).e2eArgs).not.toContain(path);
      expect(plan.manualChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workflow, job, specs: [path] }),
        ]),
      );
    }
  });

  it("keeps the configured viewport check for a fixture used only by the manual performance lane", () => {
    const path = "apps/editor/e2e/performance-fixture.ts";
    const plan = planValidation(
      [path, "apps/editor/e2e/regional-auth-fixture.ts"],
      catalog,
    );
    expect(plan.manualChecks.map(({ id }) => id)).toContain(
      "browser-performance",
    );
    expect(planCiValidation(plan).e2eArgs).toEqual([
      "apps/editor/e2e/gallery-account.spec.ts",
      "apps/editor/e2e/task-canvas.spec.ts",
      "apps/editor/e2e/wheel-behavior.spec.ts",
    ]);
  });

  it("sizes the browser shards to the tests selected, from two to eight", () => {
    const shards = (counts, mode = "focused") =>
      browserShardMatrix(
        { mode, e2eArgs: Object.keys(counts) },
        (spec) => counts[spec] ?? 0,
      );
    // A small selection still uses two runners ...
    expect(shards({ "a.spec.ts": 10 })).toEqual(["1/2", "2/2"]);
    // ... and a few tests, such as the fallback smoke, one.
    expect(shards({ "a.spec.ts": 8 })).toEqual(["1/1"]);
    expect(browserShardMatrix(ciPlan(["worker/arena.ts"]))).toEqual(["1/1"]);
    // About 25 tests to a shard: 43 + 73 + 5 selected tests take five.
    expect(
      shards({ "a.spec.ts": 43, "b.spec.ts": 73, "c.spec.ts": 5 }),
    ).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    // Arguments that are not spec files select nothing to count.
    expect(shards({ "--grep=x": 500, "a.spec.ts": 9 })).toHaveLength(2);
    // A spec file and line selects one test.
    expect(
      browserShardMatrix(
        {
          mode: "fallback",
          e2eArgs: Array.from({ length: 51 }, (_, line) => `a.spec.ts:${line}`),
        },
        () => 500,
      ),
    ).toHaveLength(3);
    // Every spec is capped at eight.
    expect(
      browserShardMatrix({ mode: "full", e2eArgs: [] }, () => 100),
    ).toHaveLength(8);
    // The counts are read from the spec sources.
    const gallery = browserShardMatrix(ciPlan(["worker/gallery.ts"]));
    expect(gallery.length).toBeGreaterThanOrEqual(2);
    expect(gallery.length).toBeLessThanOrEqual(8);
    expect(
      gallerySpecs.reduce((sum, spec) => sum + countSpecTests(spec), 0),
    ).toBeGreaterThan(25);
  });

  // Validation-policy documentation forces full gates locally, but is still
  // documentation to CI.
  it.each(["docs/user/getting-started.md", "docs/testing/README.md"])(
    "skips implementation jobs for documentation-only work (%s)",
    (path) => {
      expect(ciPlan([path])).toMatchObject({
        heavy: false,
        browser: false,
        mode: "documentation",
        e2eArgs: [],
      });
    },
  );

  it("scopes optional core jobs and unit shards to affected paths", () => {
    const workerOnly = ciPlan(["worker/gallery-wall.ts"]);
    expect(workerOnly).toMatchObject({
      heavy: true,
      build: false,
      unitBuilt: false,
      performance: false,
      release: false,
      regionalPython: false,
      browserNeedsMcp: false,
      unitMode: "affected",
      unitArgs: ["worker/gallery-wall.ts"],
    });
    expect(unitShardMatrix(workerOnly)).toEqual(["1/1"]);

    // Worker DO/sync/simulation files still run standalone built-package tests.
    for (const path of [
      "worker/resource-sync.ts",
      "worker/simulation-control-do.ts",
    ]) {
      expect(ciPlan([path]), path).toMatchObject({
        build: true,
        unitBuilt: true,
        performance: false,
        release: false,
      });
    }

    // Subprocess-tested script pulls its sibling test; skips heavy build jobs.
    const scriptOnly = ciPlan(["scripts/gallery-dataset.mjs"]);
    expect(scriptOnly).toMatchObject({
      build: false,
      unitMode: "affected",
      unitArgs: [
        "scripts/gallery-dataset.mjs",
        "scripts/gallery-dataset.test.mjs",
      ],
      unitStrict: true,
    });

    // Standalone-only test routes to core_unit_built, not core_unit.
    const standaloneOnly = ciPlan(["scripts/resource-seed-runtime.test.mjs"]);
    expect(standaloneOnly).toMatchObject({
      build: true,
      unitBuilt: true,
      unitMode: "none",
    });

    const regional = ciPlan(["worker/regional-entry.ts"]);
    expect(regional).toMatchObject({
      regionalPython: true,
      unitBuilt: false,
      build: false,
      performance: false,
      release: false,
      unitMode: "affected",
    });

    // Unclassified container paths fail closed to full core checks.
    const container = ciPlan(["containers/canvas-cn/formal/sync_tick.py"]);
    expect(container).toMatchObject({
      regionalPython: true,
      unitBuilt: true,
      build: true,
      performance: true,
      release: true,
      releaseDesktop: true,
      releaseEditor: true,
      releaseGolden: true,
      releaseAgentArtifacts: true,
      releaseMcp: true,
      unitMode: "full",
    });
    expect(unitShardMatrix(container)).toHaveLength(5);

    const canvas = ciPlan(["apps/editor/src/canvas/fit-view.ts"]);
    expect(canvas).toMatchObject({
      build: true,
      release: true,
      releaseDesktop: true,
      releaseEditor: true,
      releaseGolden: false,
      releaseAgentArtifacts: false,
      releaseMcp: false,
      performance: true,
      unitBuilt: false,
      regionalPython: false,
      browserNeedsMcp: false,
      unitMode: "affected",
    });

    // Pure MCP edits skip editor/desktop/golden checks and request MCP browser build.
    expect(ciPlan(["apps/mcp-server/src/server.ts"])).toMatchObject({
      release: true,
      releaseDesktop: false,
      releaseEditor: false,
      releaseGolden: false,
      releaseAgentArtifacts: true,
      releaseMcp: true,
      browserNeedsMcp: true,
    });

    // Netlist edits do not trigger edit-performance budgets or rendering goldens.
    expect(ciPlan(["packages/netlist/src/extract.ts"])).toMatchObject({
      build: true,
      unitBuilt: true,
      performance: false,
      release: true,
      releaseEditor: true,
      releaseGolden: false,
      releaseMcp: true,
      browserNeedsMcp: false,
    });

    // Simulation runner package runs standalone tests without triggering release packaging.
    expect(ciPlan(["packages/spice-run/src/rawfile.ts"])).toMatchObject({
      build: true,
      unitBuilt: true,
      performance: false,
      release: false,
    });

    const e2eOnly = ciPlan(["apps/editor/e2e/wheel-behavior.spec.ts"]);
    expect(e2eOnly).toMatchObject({
      build: false,
      unitMode: "none",
    });

    // Non-spec e2e helpers remain traceable for unit tests that import them.
    const e2eHelper = ciPlan(["apps/editor/e2e/bipolar-project.ts"]);
    expect(e2eHelper.unitMode).toBe("affected");
    expect(e2eHelper.unitArgs).toContain("apps/editor/e2e/bipolar-project.ts");

    // Deleted sources fall back to full unit shards.
    const deleted = planCiValidation(
      planValidation(["worker/gallery-wall.ts"], catalog),
      { exists: () => false },
    );
    expect(deleted.unitMode).toBe("full");
  });

  it("routes Gallery sources, Shelf, snapshot history, duplicate correspondence and project sessions to their actual browser workflows (#1646)", () => {
    for (const path of [
      "apps/editor/src/gallery-client.ts",
      "apps/editor/src/gallery-filters.ts",
      "apps/editor/src/gallery-search.ts",
      "apps/editor/src/components/gallery-tag-sidebar.tsx",
      "apps/editor/src/components/account-page.tsx",
      "apps/editor/src/features/editor-shell/examples-panel-tags.tsx",
      "apps/editor/src/features/editor-shell/project-shelf.tsx",
      "apps/editor/src/app/use-gallery-publishing.ts",
      "worker/gallery-curation.ts",
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
      expect(plan.e2eArgs, path).toEqual(expect.arrayContaining(gallerySpecs));
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
    for (const [path, specs] of [
      [
        "apps/editor/src/components/recovery-banners.tsx",
        ["apps/editor/e2e/recovery-hardening.spec.ts"],
      ],
      [
        "apps/editor/src/features/editor-shell/document-settings-code-assists.ts",
        editingSpecs,
      ],
      [
        "apps/editor/src/features/editor-shell/document-settings-code.ts",
        editingSpecs,
      ],
      [
        "apps/editor/src/features/editor-shell/document-settings-section.tsx",
        editingSpecs,
      ],
      ["packages/derived/src/annotation-text.ts", editingSpecs],
      [
        "packages/derived/src/connectivity-index.ts",
        ["apps/editor/e2e/wiring-semantics.spec.ts"],
      ],
      [
        "packages/derived/src/connectivity.ts",
        ["apps/editor/e2e/wiring-semantics.spec.ts"],
      ],
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual(expect.arrayContaining(specs));
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
        "apps/editor/e2e/simulation-batch.spec.ts",
        "apps/editor/e2e/simulation-code-editor.spec.ts",
        "apps/editor/e2e/simulation-evidence-benchmark.spec.ts",
        "apps/editor/e2e/simulation-profile-probes.spec.ts",
        "apps/editor/e2e/simulation-setup.spec.ts",
        "apps/editor/e2e/simulation-spec-results.spec.ts",
        "apps/editor/e2e/simulation-storage.spec.ts",
        "apps/editor/e2e/simulation-workspace.spec.ts",
        "apps/editor/e2e/testbench-panel.spec.ts",
      ],
    });
  });

  it("runs only the kit-reading workflows for generated Agent docs", () => {
    // The kit, guidance and MCP resources are generated from docs/agent. In
    // the browser, agent-connection checks the kit's text and agent-simulation
    // places parts from its authoring catalog; no other spec reads them.
    for (const path of [
      "apps/mcp-server/src/guidance.generated.ts",
      "apps/mcp-server/src/resources.generated.ts",
      "packages/agent-adapter/src/agent-docs.generated.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual([
        "apps/editor/e2e/agent-connection.spec.ts",
        "apps/editor/e2e/agent-simulation.spec.ts",
      ]);
    }
    expect(ciPlan(["apps/mcp-server/src/server.ts"]).e2eArgs).toEqual(
      expect.arrayContaining([
        "apps/editor/e2e/agent-connection.spec.ts",
        "apps/editor/e2e/web-agent-session.spec.ts",
        "apps/editor/e2e/task-canvas.spec.ts",
      ]),
    );
  });

  it("selects the Agent and simulation specs for their shared run fixtures (#1646)", () => {
    const path = "apps/editor/e2e/simulation-e2e-fixtures.ts";
    const plan = ciPlan([path]);
    expect(plan.mode, path).toBe("focused");
    expect(plan.e2eArgs, path).toEqual(
      expect.arrayContaining([
        "apps/editor/e2e/agent-simulation.spec.ts",
        "apps/editor/e2e/gui-native-simulation.spec.ts",
        "apps/editor/e2e/simulation-batch.spec.ts",
      ]),
    );
  });

  it("requires named manual SG13G2 MCP evidence for MCP implementation and spec edits", () => {
    for (const path of [
      "apps/mcp-server/src/main.ts",
      "apps/editor/e2e/sg13g2-simulation.spec.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).not.toContain(
        "apps/editor/e2e/sg13g2-simulation.spec.ts",
      );
      expect(
        planValidation([path], catalog).manualChecks.map((check) => check.id),
      ).toContain("mcp-sg13g2");
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
        ...gallerySpecs,
      ].sort(),
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
      for (const spec of editingSpecs)
        expect(plan.e2eArgs, path).not.toContain(spec);
    }
    // Editor-wide code is left to the editing workflows; the property and
    // netlist workflows run for their own features and fixtures.
    for (const path of [
      "apps/editor/src/app/App.tsx",
      "apps/editor/src/canvas/editor-canvas-surface.tsx",
      "apps/editor/src/features/text-editing/canvas-text-editor.tsx",
      "apps/editor/src/features/drafting/drafting-properties-panel.tsx",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual(expect.arrayContaining(editingSpecs));
      for (const spec of [properties, netlist, conversion, rnl])
        expect(plan.e2eArgs, path).not.toContain(spec);
    }
    const fixturePlan = ciPlan(["apps/editor/e2e/manual-editor-fixtures.ts"]);
    expect(fixturePlan.mode).toBe("focused");
    expect(fixturePlan.e2eArgs).toEqual(
      expect.arrayContaining([properties, netlist, rnl, ...editingSpecs]),
    );
    for (const path of [
      "apps/editor/src/app/editor-properties-dock.tsx",
      "apps/editor/src/features/instance-display/instance-parameter-display.ts",
      "apps/editor/src/features/component-insert/component-parameters.ts",
    ])
      expect(ciPlan([path]).e2eArgs, path).toContain(properties);
  });

  it("runs the RNL workflows alone for the RNL package and its fixtures", () => {
    for (const path of [
      "packages/rnl/src/place.ts",
      "apps/editor/e2e/label-census.ts",
      "apps/editor/e2e/bipolar-project.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual([rnl]);
    }
    const panel = ciPlan([
      "apps/editor/src/features/netlist-export/netlist-code-panel.tsx",
    ]);
    expect(panel.e2eArgs).toEqual(
      expect.arrayContaining([properties, netlist, conversion, rnl]),
    );
    // The editor glue only these workflows drive: File > Import > RNL… and
    // File > Export > Netlist… (menus), Netlist Settings… (chrome) and the
    // RNL file input (file menu).
    for (const [path, specs] of [
      ["apps/editor/src/app/editor-menus.tsx", [netlist, conversion, rnl]],
      ["apps/editor/src/app/editor-app-chrome.tsx", [netlist, conversion]],
      [
        "apps/editor/src/features/editor-shell/file-command-menu.tsx",
        [netlist, conversion, rnl],
      ],
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("focused");
      expect(plan.e2eArgs, path).toEqual(
        expect.arrayContaining([
          ...specs,
          "apps/editor/e2e/netlist-code-edit.spec.ts",
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

  it("runs the hierarchy contract only for Cell and hierarchy code (#1646)", () => {
    for (const path of [
      "packages/model/src/schema/project.ts",
      "packages/model/src/cell-interface-projection.ts",
      "packages/edit-engine/src/hierarchy-planner.ts",
      "packages/edit-engine/src/cell-pin-planner.ts",
      "packages/edit-engine/src/project-cell-import.ts",
      "packages/symbols/src/hierarchical-block.ts",
      "packages/symbols/src/resolver.ts",
      "packages/render-svg/src/symbol-render.ts",
      "packages/edit-engine/src/project-transaction.ts",
      "packages/edit-engine/src/model-source-planner.ts",
    ])
      expect(ciPlan([path]).e2eArgs, path).toContain(
        "apps/editor/e2e/hierarchy.spec.ts",
      );
    for (const path of [
      "packages/render-svg/src/route-render.ts",
      "packages/symbols/src/razavi-catalog.ts",
      "packages/edit-engine/src/transaction.ts",
      "packages/project-protocol/src/load.ts",
    ])
      expect(ciPlan([path]).e2eArgs, path).not.toContain(
        "apps/editor/e2e/hierarchy.spec.ts",
      );
  });

  it("routes shared dialog styles and SPICE language sources to their owning browser contracts", () => {
    const dialogPlan = ciPlan(["apps/editor/src/styles/editor-dialogs.css"]);
    expect(dialogPlan.mode).toBe("focused");
    expect(dialogPlan.e2eArgs).toEqual(expect.arrayContaining(editingSpecs));

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

  it("does not allocate a browser runner for non-shipping tests and manifests", () => {
    expect(
      ciPlan([
        "apps/editor/src/app/App.test.tsx",
        "apps/editor/package.json",
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
    expect(plan.e2eArgs).toEqual(
      [
        placementSmoke,
        newCircuitSmoke,
        ...gallerySpecs,
        "apps/editor/e2e/runtime-crash-safety.spec.ts",
      ].sort(),
    );
    expect(plan.reasons).toContain(
      "uncovered browser impact: apps/editor/src/lib/new-helper.ts",
    );
  });

  it.each([
    [
      "apps/editor/e2e/component-property-workflows.spec.ts",
      ["apps/editor/e2e/component-property-workflows.spec.ts"],
    ],
    ["worker/gallery.ts", gallerySpecs],
    ["apps/editor/src/lib/new-helper.ts", fallbackSpecs],
  ])(
    "does not let non-shipping tests widen browser impact for %s",
    (path, specs) => {
      expect(
        ciPlan([
          path,
          "apps/editor/src/app/App.test.tsx",
          "packages/derived/src/performance-parity.test.ts",
          "packages/model/src/schema/object-locator.test.ts",
          "apps/editor/package.json",
        ]),
      ).toMatchObject({ heavy: true, browser: true, e2eArgs: specs });
    },
  );

  it("retains a production owner's browser coverage when its unit tests also change", () => {
    const product = [
      "apps/editor/src/app/App.tsx",
      "apps/editor/e2e/component-property-workflows.spec.ts",
    ];
    const base = ciPlan(product);
    expect(
      ciPlan([...product, "apps/editor/src/app/App.test.tsx"]),
    ).toMatchObject({
      heavy: base.heavy,
      browser: base.browser,
      mode: base.mode,
      e2eArgs: base.e2eArgs,
      reasons: base.reasons,
      build: base.build,
      release: base.release,
      performance: base.performance,
      unitBuilt: base.unitBuilt,
      regionalPython: base.regionalPython,
    });
  });

  it("runs crash recovery and two located smoke cases for unmapped engine, worker and netlist paths", () => {
    for (const path of [
      "packages/edit-engine/src/transaction.ts",
      "packages/derived/src/connection-graph.ts",
      "worker/arena.ts",
      "packages/netlist/src/ir.ts",
      "packages/spice/src/expression.ts",
    ]) {
      const plan = ciPlan([path]);
      expect(plan.mode, path).toBe("fallback");
      expect(plan.e2eArgs, path).toEqual(fallbackSpecs);
    }
  });

  it("locates a smoke case by its title and refuses a missing one", () => {
    const source = [
      'import { test } from "@playwright/test";',
      "",
      'test("first", async () => {});',
      'test("second case", async ({',
      "  page,",
      "}) => {});",
    ].join("\r\n");
    expect(locateSpecTest("a.spec.ts", "second case", () => source)).toBe(
      "a.spec.ts:4",
    );
    expect(() => locateSpecTest("a.spec.ts", "second", () => source)).toThrow(
      'a.spec.ts declares no test "second"',
    );
  });

  it("deduplicates fallback specs already selected by a mixed batch", () => {
    const plan = ciPlan([
      "apps/editor/e2e/component-insert.spec.ts",
      "apps/editor/e2e/gallery-wall.spec.ts",
      "apps/editor/src/lib/new-helper.ts",
    ]);
    expect(plan.mode).toBe("fallback");
    expect(plan.e2eArgs).toContain("apps/editor/e2e/gallery-wall.spec.ts");
    expect(plan.e2eArgs).toContain(
      "apps/editor/e2e/runtime-crash-safety.spec.ts",
    );
    // The whole spec runs, so its single cases are not added again.
    expect(
      plan.e2eArgs.filter((arg) =>
        arg.startsWith("apps/editor/e2e/component-insert.spec.ts"),
      ),
    ).toEqual(["apps/editor/e2e/component-insert.spec.ts"]);
  });

  it("runs the specs that use a shared fixture and keeps its manual checks", () => {
    const path = "apps/editor/e2e/canvas-fixtures.ts";
    const plan = planValidation([path], catalog);
    const specNames = planCiValidation(plan).e2eArgs;
    expect(specNames).toEqual(
      expect.arrayContaining([
        "apps/editor/e2e/diagnostics-surfacing.spec.ts",
        "apps/editor/e2e/runtime-crash-safety.spec.ts",
        "apps/editor/e2e/wheel-behavior.spec.ts",
      ]),
    );
    expect(specNames).not.toContain("apps/editor/e2e/gallery-wall.spec.ts");
    expect(plan.manualChecks.map((check) => check.id)).toEqual(["mcp-sg13g2"]);
  });

  it("follows fixtures through another fixture and the page-module registry", () => {
    expect(
      ciPlan(["apps/editor/e2e/regional-auth-fixture.ts"]).e2eArgs,
    ).toEqual([
      "apps/editor/e2e/gallery-account.spec.ts",
      "apps/editor/e2e/task-canvas.spec.ts",
    ]);
    expect(
      ciPlan(["apps/editor/e2e/helpers/simulation-code-harness.tsx"]).e2eArgs,
    ).toEqual([
      "apps/editor/e2e/simulation-code-editor.spec.ts",
      "apps/editor/e2e/simulation-evidence-benchmark.spec.ts",
      "apps/editor/e2e/simulation-spec-results.spec.ts",
      "apps/editor/e2e/simulation-storage.spec.ts",
    ]);
    expect(ciPlan(["apps/editor/e2e/gallery-fixtures.ts"]).e2eArgs).toContain(
      "apps/editor/e2e/gallery-request-failures.spec.ts",
    );
  });

  it("checks all ordinary specs for an unresolved browser fixture", () => {
    const plan = ciPlan(["apps/editor/e2e/helpers/unknown-fixture.ts"]);
    expect(plan.e2eArgs).toEqual(
      [
        ...new Set(catalog.gates.flatMap((gate) => gate.ci?.e2eArgs ?? [])),
      ].sort(),
    );
    for (const check of catalog.manualChecks)
      for (const spec of check.specs) expect(plan.e2eArgs).not.toContain(spec);
  });

  it("keeps every browser spec reachable through a focused or named manual route", async () => {
    const directory = new URL("../../apps/editor/e2e/", import.meta.url);
    const specs = (await readdir(directory))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => `apps/editor/e2e/${name}`)
      .sort();

    for (const spec of specs) {
      const plan = ciPlan([spec]);
      const manual = planValidation([spec], catalog).manualChecks.some(
        (check) => check.specs.includes(spec),
      );
      if (manual) {
        expect(plan.e2eArgs, spec).not.toContain(spec);
        continue;
      }
      expect(plan.mode, spec).toBe("focused");
      expect(plan.e2eArgs, spec).toContain(spec);
    }
  });

  it.each(["playwright.config.ts", "scripts/build-e2e-editor.mjs"])(
    "runs the browser smoke when %s changes",
    (path) => {
      expect(ciPlan([path])).toMatchObject({
        heavy: true,
        browser: true,
        mode: "fallback",
        e2eArgs: fallbackSpecs,
      });
    },
  );

  it("keeps workflow-only changes out of the browser runner", () => {
    expect(ciPlan([".github/workflows/ci.yml"])).toMatchObject({
      heavy: true,
      browser: false,
      mode: "non-browser",
      e2eArgs: [],
    });
  });

  it("forces complete validation when asked to", () => {
    expect(
      ciPlan(["docs/user/getting-started.md"], { forceFull: true }),
    ).toMatchObject({
      heavy: true,
      browser: true,
      mode: "full",
      e2eArgs: [],
    });
  });
});
