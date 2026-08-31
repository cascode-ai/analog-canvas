import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  globPattern,
  loadGateCatalog,
  matchesAny,
  planValidation,
  renderCommand,
  windowsCommandLine,
} from "./validation-gates.mjs";

const catalog = await loadGateCatalog();
const rootPackage = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

function ids(paths) {
  return planValidation(paths, catalog).gates.map((gate) => gate.id);
}

describe("validation gate planning", () => {
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
    ]);
  });

  it("expands shared protocol changes to hierarchy and persistence", () => {
    const selected = ids(["packages/project-protocol/src/persistence.ts"]);
    expect(selected).toEqual(["test-impact", "full-delivery"]);
  });

  it("maps Gallery and account changes to their dedicated browser workflow", () => {
    const selected = ids(["worker/auth.ts", "worker/gallery.ts"]);
    expect(selected).toContain("workspace-unit");
    expect(selected).toContain("gallery-browser");
    expect(selected).not.toContain("editor-browser");
    expect(selected).not.toContain("full-delivery");
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
    ).toContain("placement-near-miss-browser");
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
