import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  globPattern,
  formatGatePlan,
  formatGatePlanMarkdown,
  loadGateCatalog,
  matchesAny,
  planValidation,
  renderCommand,
  windowsCommandLine,
  executionGates,
} from "./validation-gates.mjs";

const catalog = await loadGateCatalog();
const rootPackage = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const trackedPaths = execFileSync("git", ["ls-files"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const specArgument = /^apps\/editor\/e2e\/.+\.spec\.ts$/u;

function ids(paths) {
  return planValidation(paths, catalog).gates.map((gate) => gate.id);
}

describe("validation gate planning", () => {
  it("keeps a build between browser batches in execution order", () => {
    const commands = [
      ["pnpm", "test:e2e:local", "apps/editor/e2e/group-mirror.spec.ts"],
      ["pnpm", "test:editor-build"],
      ["pnpm", "test:e2e:local", "apps/editor/e2e/copy-paste.spec.ts"],
    ];
    const plan = {
      gates: commands.map((command, index) => ({
        id: String(index),
        stage: "affected",
        command,
        reasons: ["selected"],
      })),
    };
    expect(
      executionGates(plan, "affected").map((gate) => gate.command),
    ).toEqual(commands);
  });

  it("runs overlapping browser gates once while keeping their reasons and other checks", () => {
    const plan = planValidation(
      ["apps/editor/e2e/canvas-fixtures.ts"],
      catalog,
    );
    const runs = executionGates(plan, "affected");
    const browser = runs.filter((gate) => gate.command[1] === "test:e2e:local");
    expect(browser).toHaveLength(1);
    const specs = browser[0].command.slice(2);
    expect(specs).toContain("apps/editor/e2e/component-insert.spec.ts");
    expect(specs).toContain("apps/editor/e2e/group-mirror.spec.ts");
    expect(specs.length).toBe(new Set(specs).size);
    expect(formatGatePlan(plan).match(/pnpm test:e2e:local/gu)).toHaveLength(1);
    expect(
      formatGatePlanMarkdown(plan).match(/pnpm test:e2e:local/gu),
    ).toHaveLength(1);
    expect(browser[0].reasons).toContain(
      "componentInsert: apps/editor/e2e/canvas-fixtures.ts",
    );
    expect(runs.some((gate) => gate.id === "workspace-unit")).toBe(true);
    expect(executionGates(plan, "preflight")).toEqual(
      plan.gates.filter((gate) => gate.stage === "preflight"),
    );
  });

  it("rejects an opt-in spec advertised as an ordinary executable gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-gates-"));
    const path = join(directory, "catalog.json");
    try {
      const invalid = structuredClone(catalog);
      invalid.gates[0].command.push("apps/editor/e2e/performance.spec.ts");
      await writeFile(path, JSON.stringify(invalid));
      await expect(loadGateCatalog(path)).rejects.toThrow(
        "manual spec in ordinary gate",
      );
    } finally {
      await rm(path, { force: true });
      await rmdir(directory);
    }
  });

  it("shows the workflow and prerequisites for manual evidence without making it an executable gate", () => {
    const plan = planValidation(
      ["apps/editor/e2e/mcp-native-simulation.spec.ts"],
      catalog,
    );
    for (const text of [formatGatePlan(plan), formatGatePlanMarkdown(plan)]) {
      expect(text).toContain("Manual evidence");
      expect(text).toContain(".github/workflows/simulator-host.yml");
      expect(text).toContain("vacask-compat-build");
      expect(text).toContain("ICM_E2E_VACASK_REAL=1");
    }
    expect(plan.gates.map((gate) => gate.id)).not.toContain("mcp-native");
  });

  it("references only declared pnpm scripts", () => {
    const missing = catalog.gates
      .filter((gate) => gate.command[0] === "pnpm")
      .map((gate) => gate.command[1])
      .filter((script) => !Object.hasOwn(rootPackage.scripts, script));

    expect(missing).toEqual([]);
  });

  it("keeps the complete delivery gate as the single owner of covered work", () => {
    const full = catalog.gates.find((gate) => gate.id === "full-delivery");
    const covered = catalog.gates
      .filter((gate) => gate.stage !== "final" && gate.id !== "test-impact")
      .map((gate) => gate.id)
      .sort();

    expect([...full.supersedes].sort()).toEqual(covered);
  });

  it("matches repository globs without treating a single star as a slash", () => {
    expect(
      globPattern("apps/**/src/**").test("apps/editor/src/app/App.tsx"),
    ).toBe(true);
    expect(matchesAny("docs/testing/README.md", ["**/*.md"])).toBe(true);
    expect(
      globPattern("scripts/package-*.mjs").test("scripts/package-mcp.mjs"),
    ).toBe(true);
  });

  it("keeps documentation-only work on the cheap link gate", () => {
    const plan = planValidation(["docs/user/getting-started.md"], catalog);
    expect(plan.docsOnly).toBe(true);
    expect(plan.requiresFull).toBe(false);
    expect(ids(["docs/user/getting-started.md"])).toEqual([
      "documentation-links",
    ]);
  });

  it("selects focused component placement browser coverage", () => {
    expect(
      ids([
        "apps/editor/src/features/component-insert/placement-connectivity.ts",
      ]),
    ).toEqual([
      "static-contracts",
      "test-impact",
      "workspace-unit",
      "component-insert-browser",
      "editor-build",
    ]);
  });

  it("expands shared protocol changes to persistence, and Cell code to hierarchy", () => {
    const plan = planValidation(
      ["packages/project-protocol/src/persistence.ts"],
      catalog,
    );
    expect(plan.gates.map((gate) => gate.id)).toEqual([
      "test-impact",
      "full-delivery",
    ]);
    const selected = plan.selectedGates.map((gate) => gate.id);
    expect(selected).toContain("project-file-browser");
    expect(selected).not.toContain("hierarchy-browser");
    expect(
      planValidation(
        ["packages/edit-engine/src/hierarchy-planner.ts"],
        catalog,
      ).selectedGates.map((gate) => gate.id),
    ).toContain("hierarchy-browser");
  });

  it("keeps canonical component definitions on the shared-core delivery gate", () => {
    expect(ids(["packages/components/definitions/nmos.json"])).toEqual([
      "test-impact",
      "full-delivery",
    ]);
  });

  it("maps Gallery and account changes to their dedicated browser workflow", () => {
    const selected = ids(["worker/auth.ts", "worker/gallery.ts"]);
    expect(selected).toContain("workspace-unit");
    expect(selected).toContain("gallery-browser");
    expect(selected).not.toContain("editor-browser");
    expect(selected).not.toContain("full-delivery");
  });

  it("maps Analog Simulation changes to the existing simulation workflow", () => {
    for (const path of [
      "packages/simulation-service/src/service.ts",
      "packages/spice-run/src/rawfile.ts",
      "apps/editor/src/features/simulation/spice-simulation-surface.tsx",
    ]) {
      const selected = ids([path]);
      expect(selected, path).toContain("analog-simulation-browser");
      expect(selected, path).not.toContain("editor-browser");
    }

    expect(ids(["apps/editor/e2e/agent-simulation.spec.ts"])).not.toContain(
      "analog-simulation-browser",
    );
  });

  it("selects release verification for package scripts", () => {
    expect(ids(["scripts/package-mcp.mjs"])).toContain("release-verification");
  });

  it("forces a conservative branch and full gate for gate policy changes", () => {
    const plan = planValidation([".github/workflows/ci.yml"], catalog);
    expect(plan.requiresFull).toBe(true);
    expect(plan.fullReasons).toContain(
      "gate contract changed: .github/workflows/ci.yml",
    );
    expect(plan.gates.map((gate) => gate.id)).toEqual([
      "test-impact",
      "full-delivery",
    ]);
  });

  it("runs static contracts for documentation that defines the gate contract", () => {
    const plan = planValidation(["docs/testing/README.md"], catalog);
    expect(plan.docsOnly).toBe(true);
    expect(plan.requiresFull).toBe(true);
    expect(plan.gates.map((gate) => gate.id)).toEqual(["full-delivery"]);
  });

  it("forces a full fallback for an unclassified implementation path", () => {
    const plan = planValidation(["tooling/new-runner.toml"], catalog);
    expect(plan.unknownPaths).toEqual(["tooling/new-runner.toml"]);
    expect(plan.requiresFull).toBe(true);
    expect(plan.gates.map((gate) => gate.id)).toEqual([
      "test-impact",
      "full-delivery",
    ]);
  });

  it("routes specialized editor behavior to its dedicated browser contracts", () => {
    expect(ids(["apps/editor/src/canvas/diagnostic-markers.ts"])).toContain(
      "editor-diagnostics-browser",
    );
    expect(
      ids(["apps/editor/src/features/component-insert/placement-near-miss.ts"]),
    ).toContain("component-insert-browser");
    expect(ids(["apps/editor/src/canvas/canvas-hit-resolver.ts"])).toContain(
      "thin-target-hit-browser",
    );
  });

  it("ignores local stores and renders the selected base", () => {
    expect(planValidation([".pnpm-store/cache.bin"], catalog).paths).toEqual(
      [],
    );
    expect(
      renderCommand(
        ["pnpm", "test:impact", "--", "--base", "{base}"],
        "origin/trunk",
      ),
    ).toEqual(["pnpm", "test:impact", "--", "--base", "origin/trunk"]);
  });

  it("builds a constrained Windows command line without shell metacharacters", () => {
    expect(
      windowsCommandLine([
        "pnpm",
        "test:impact",
        "--",
        "--base",
        "origin/main",
      ]),
    ).toBe("pnpm test:impact -- --base origin/main");
    expect(() => windowsCommandLine(["pnpm", "test", "main & whoami"])).toThrow(
      "unsafe validation-gate argument",
    );
  });
});

// The catalog is hand-maintained, so a path it names can outlive its target
// without anyone noticing: a pattern that matches nothing stops selecting its
// gate, and a named browser spec that no longer exists fails only in CI.
describe("validation gate catalog paths", () => {
  it("points every path group pattern at a tracked path", () => {
    // `packages/devices/src/descriptors/*switch*` was once added to a path
    // group two days after the directory it names was deleted, and never
    // matched.
    const dead = [];
    for (const [group, patterns] of Object.entries(catalog.pathGroups)) {
      for (const pattern of patterns) {
        const matches = globPattern(pattern);
        if (!trackedPaths.some((path) => matches.test(path))) {
          dead.push(`${group}: ${pattern}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it("names only browser specs that exist on disk", () => {
    const missing = [];
    for (const gate of catalog.gates) {
      const named = [
        ...gate.command.filter((value) => specArgument.test(value)),
        ...(gate.ci?.e2eArgs ?? []),
      ];
      for (const spec of named) {
        if (!existsSync(join(repositoryRoot, spec))) {
          missing.push(`${gate.id}: ${spec}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps every locally selected browser spec in the mapped CI run", () => {
    // The reverse direction is allowed: some browser specs are CI-only.
    const uncovered = [];
    for (const gate of catalog.gates) {
      const mapped = new Set(gate.ci?.e2eArgs ?? []);
      const local = gate.command.filter((value) => specArgument.test(value));
      for (const spec of local) {
        if (!mapped.has(spec)) uncovered.push(`${gate.id}: ${spec}`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("ignores worktree scratch directories left inside the repository", () => {
    // The planner collects untracked paths, so an unignored worktree checkout
    // escalates an unrelated plan to full delivery without saying so.
    for (const directory of [".worktrees", ".claude/worktrees"]) {
      expect(
        matchesAny(
          `${directory}/branch/packages/model/src/index.ts`,
          catalog.ignoredPaths ?? [],
        ),
        directory,
      ).toBe(true);
    }
  });
});
