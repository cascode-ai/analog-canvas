import { describe, expect, it } from "vitest";

import {
  censusPaths,
  browserSpecPaths,
  censusChecks,
  changedBrowserCases,
  changedLines,
  formattedPaths,
  lintPaths,
  strictUnitRun,
  testStartLines,
  unitSourcePaths,
} from "./verify-pr-selection.mjs";

const changed = [
  "packages/netlist/src/extract.ts",
  "packages/netlist/src/extract.test.ts",
  "apps/editor/src/features/component-insert/use-component-placement.ts",
  "apps/editor/e2e/gallery.spec.ts",
  "apps/mcp-server/src/resources.generated.ts",
  "scripts/verify-pr.mjs",
  "docs/agent/shared/authoring.md",
  "docs/agent/distribution.generated.json",
  "config/validation-gates.json",
  "fixtures/ngspice-failures/parallel-sources.log",
];

describe("verify:pr selection", () => {
  it("checks the files format:check reads, and no others", () => {
    // config/, docs/, fixtures/ and worker/ are outside format:check's
    // globs: generated artifacts there keep their generator's layout.
    expect(
      formattedPaths([
        ...changed,
        "fixtures/agent-api/agent-circuit.openapi.json",
        "worker/agent-session-do.ts",
        "references/manifest.json",
        "package.json",
      ]),
    ).toEqual([
      "packages/netlist/src/extract.ts",
      "packages/netlist/src/extract.test.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
      "apps/editor/e2e/gallery.spec.ts",
      "apps/mcp-server/src/resources.generated.ts",
      "scripts/verify-pr.mjs",
      "references/manifest.json",
      "package.json",
    ]);
  });

  it("traces unit tests from workspace code, not browser specs or generated files", () => {
    expect(unitSourcePaths(changed)).toEqual([
      "packages/netlist/src/extract.ts",
      "packages/netlist/src/extract.test.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
      "scripts/verify-pr.mjs",
    ]);
    // A changed test file runs strictly, so a describe its edit emptied
    // fails here as it would in the merge queue.
    expect(strictUnitRun(unitSourcePaths(changed))).toBe(true);
    expect(strictUnitRun(["scripts/verify-pr.mjs"])).toBe(false);
  });

  it("lints workspace code, tests and specs, and everything when the rules or types change", () => {
    // .oxlintrc.json skips the generated file, as a whole-repo run does.
    expect(lintPaths([...changed, "worker/agent-session-do.ts"])).toEqual([
      "packages/netlist/src/extract.ts",
      "packages/netlist/src/extract.test.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
      "apps/editor/e2e/gallery.spec.ts",
      "apps/mcp-server/src/resources.generated.ts",
      "scripts/verify-pr.mjs",
      "worker/agent-session-do.ts",
    ]);
    for (const config of [
      ".oxlintrc.json",
      "tsconfig.json",
      "tsconfig.base.json",
      "packages/model/tsconfig.json",
    ])
      expect(lintPaths(["docs/README.md", config])).toEqual([
        "apps",
        "packages",
        "worker",
        "scripts",
      ]);
  });

  it("names the census for placement and netlist code, not their tests", () => {
    expect(censusPaths(changed)).toEqual([
      "packages/netlist/src/extract.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
    ]);
  });

  it("asks the census only for the checks the change touches", () => {
    expect(censusChecks(changed)).toEqual(["copy", "netlist"]);
    expect(
      censusChecks([
        "packages/derived/src/instance-label-placement.ts",
        "packages/netlist/src/extract.test.ts",
      ]),
    ).toEqual(["transform"]);
    expect(censusChecks(["apps/editor/src/app/App.tsx"])).toEqual([]);
  });

  it("does not require Gallery drawings for simulation source, assertion and result changes", () => {
    expect(
      censusChecks([
        "packages/netlist/src/simulation-source-vacask.ts",
        "packages/netlist/src/vacask-language.ts",
        "packages/netlist/src/vacask-postprocess.ts",
        "packages/netlist/src/simulation-diagnostic.ts",
      ]),
    ).toEqual([]);
    expect(
      censusChecks([
        "packages/netlist/src/printers.ts",
        "packages/netlist/src/unknown-design-helper.ts",
        "apps/editor/src/features/editor-shell/gallery-import.ts",
        "apps/editor/src/agent/browser-agent-project-host.ts",
      ]),
    ).toEqual(["copy", "netlist"]);
  });

  it("runs only the browser cases a change adds or edits", () => {
    expect(browserSpecPaths(changed)).toEqual([
      "apps/editor/e2e/gallery.spec.ts",
    ]);
    const spec = [
      'import { test } from "@playwright/test";', // 1
      "function helper() {}", // 2
      'test("first", async () => {', // 3
      '  test.skip(process.env.CI !== undefined, "local only");', // 4
      "  test.slow();", // 5
      "});", // 6
      'test.describe("group", () => {', // 7
      "  test(`second ${1}`, async () => {", // 8
      "    helper();", // 9
      "  });", // 10
      "});", // 11
    ].join("\n");
    expect(testStartLines(spec)).toEqual([3, 8]);
    expect(changedLines("@@ -4,0 +5,2 @@\n+a\n+b\n@@ -9 +11 @@\n")).toEqual([
      5, 6, 11,
    ]);
    expect(changedLines("@@ -20,3 +19,0 @@\n")).toEqual([19]);
    const file = "apps/editor/e2e/example.spec.ts";
    expect(changedBrowserCases(file, spec, [4, 5])).toEqual([`${file}:3`]);
    expect(changedBrowserCases(file, spec, [9, 5])).toEqual([
      `${file}:3`,
      `${file}:8`,
    ]);
    // A change the tests share runs the whole file.
    expect(changedBrowserCases(file, spec, [2, 9])).toEqual([file]);
    expect(changedBrowserCases(file, spec, [])).toEqual([]);
  });
});
