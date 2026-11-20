import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { readRnlHeadless } from "./rnl";

const project = () =>
  parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "apps/editor/src/examples/simulation-rc.icproj.json",
      ),
      "utf8",
    ),
  );

describe("the headless RNL export", () => {
  it.each(["spice", "spectre"] as const)(
    "writes %s with the drawing as RNL comments",
    async (format) => {
      const result = await readRnlHeadless(project(), { format });
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        format,
        rnl: true,
        status: "ready",
      });
      expect(result.text).toContain('@RNL(type="header")');
      expect(result.text).toContain('@VERSION("0.4")');
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
    },
    60_000,
  );

  it("names the Cell it exported", async () => {
    const source = project();
    const result = await readRnlHeadless(source, { format: "spice" });
    expect(result.documentId).toBe(source.topDocumentId);
    expect(result.text).toMatch(/\.subckt\s+\w+/u);
  });
});
