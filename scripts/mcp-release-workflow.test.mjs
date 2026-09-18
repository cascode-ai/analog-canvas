import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/mcp-release.yml", "utf8");
const steps = workflow.split(/\r?\n      - /u).slice(1);

describe("MCP release candidate and publication ordering", () => {
  it("stamps candidates before validation and upload, without weakening publication", () => {
    const candidate = steps.findIndex((step) =>
      step.includes("run: pnpm mcp:package"),
    );
    const stamp = steps.findIndex((step) =>
      step.includes("run: pnpm mcp:release:bump -- --stamp"),
    );
    const check = steps.findIndex((step) =>
      step.includes("run: pnpm mcp:distribution:check"),
    );
    const upload = steps.findIndex((step) =>
      step.includes("uses: actions/upload-artifact@v4"),
    );
    expect(candidate).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(candidate);
    expect(check).toBeGreaterThan(stamp);
    expect(upload).toBeGreaterThan(check);
    expect(steps[stamp]).toMatch(/^if: inputs.package_only\r?\n/u);
    expect(steps[check]).not.toContain("if:");
    expect(
      steps.find((step) => step.includes("run: pnpm mcp:release:package")),
    ).toContain("if: ${{ !inputs.package_only }}");
    expect(
      steps.find((step) =>
        step.includes("name: Publish immutable GitHub Release"),
      ),
    ).toContain("if: ${{ !inputs.package_only }}");
  });
});
