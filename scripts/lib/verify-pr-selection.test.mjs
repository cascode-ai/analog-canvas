import { describe, expect, it } from "vitest";

import {
  censusPaths,
  formattedPaths,
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
  "config/validation-gates.json",
  "fixtures/ngspice-failures/parallel-sources.log",
];

describe("verify:pr selection", () => {
  it("formats code, JSON and YAML, not Markdown or logs", () => {
    expect(formattedPaths(changed)).toEqual([
      "packages/netlist/src/extract.ts",
      "packages/netlist/src/extract.test.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
      "apps/editor/e2e/gallery.spec.ts",
      "apps/mcp-server/src/resources.generated.ts",
      "scripts/verify-pr.mjs",
      "config/validation-gates.json",
    ]);
  });

  it("traces unit tests from workspace code, not browser specs or generated files", () => {
    expect(unitSourcePaths(changed)).toEqual([
      "packages/netlist/src/extract.ts",
      "packages/netlist/src/extract.test.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
      "scripts/verify-pr.mjs",
    ]);
  });

  it("names the census for placement and netlist code, not their tests", () => {
    expect(censusPaths(changed)).toEqual([
      "packages/netlist/src/extract.ts",
      "apps/editor/src/features/component-insert/use-component-placement.ts",
    ]);
  });
});
