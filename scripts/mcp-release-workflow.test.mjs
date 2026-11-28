import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/mcp-release.yml", "utf8");
const steps = workflow.split(/\r?\n      - /u).slice(1);
const find = (text) => steps.findIndex((step) => step.includes(text));

describe("MCP release publication", () => {
  it("checks every candidate before upload and never restamps a published build", () => {
    const stamp = find("run: pnpm mcp:release:bump -- --stamp");
    const check = find("run: pnpm mcp:distribution:check");
    const upload = find("uses: actions/upload-artifact@v4");
    expect(check).toBeGreaterThan(stamp);
    expect(upload).toBeGreaterThan(check);
    expect(steps[check]).not.toContain("if:");
    expect(steps[stamp]).toMatch(/^if: inputs.package_only\r?\n/u);
    for (const text of [
      "run: pnpm mcp:release:package",
      "name: Publish immutable GitHub Release",
    ])
      expect(steps[find(text)]).toContain("if: ${{ !inputs.package_only }}");
  });

  it("publishes the plugin interfaces beside the assets SHA256SUMS.txt lists", () => {
    expect(steps[find("name: Publish immutable GitHub Release")]).toContain(
      '"output/mcp/interfaces.json"',
    );
  });
});
