import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checker = readFileSync(
  new URL("./check-markdown-links.mjs", import.meta.url),
);
const fixtures = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true });
});

function check({
  adrName,
  adrText,
  index = "# Decisions\n",
  specText,
  readme = "# Project\n",
}) {
  const root = mkdtempSync(join(tmpdir(), "analog-canvas-docs-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  mkdirSync(join(root, "docs", "specs"));
  writeFileSync(join(root, "scripts", "check-markdown-links.mjs"), checker);
  writeFileSync(join(root, "README.md"), readme);
  writeFileSync(join(root, "docs", "adr", "README.md"), index);
  writeFileSync(
    join(root, "docs", "adr", "adr.template.md"),
    "A template is not an accepted topic.\n",
  );
  writeFileSync(
    join(root, "docs", "specs", "README.md"),
    "# Specs\n\n[Model](model.md)\n",
  );
  if (adrName) writeFileSync(join(root, "docs", "adr", adrName), adrText);
  writeFileSync(
    join(root, "docs", "specs", "model.md"),
    specText ?? "# Model\n\nStatus: accepted\n\nOwners: model\n",
  );
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "check-markdown-links.mjs")],
    { encoding: "utf8" },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("documentation checker CLI", () => {
  it("retains rejection of numbered titles on unnumbered topic files", () => {
    const result = check({
      adrName: "storage-owner.md",
      adrText: "# 0055 - Storage\n\nStatus: accepted\n",
      index: "[Storage](storage-owner.md)\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("unnumbered topic title");
  });

  it("retains the accepted/proposed status contract on topic files", () => {
    const result = check({
      adrName: "storage-owner.md",
      adrText: "# Storage\n\nStatus: superseded\n",
      index: "[Storage](storage-owner.md)\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Status: accepted or proposed");
  });

  it("retains missing-link checks inside ADR content", () => {
    const result = check({
      adrName: "storage-owner.md",
      adrText: "# Storage\n\nStatus: accepted\n\n[Missing](missing.md)\n",
      index: "[Storage](storage-owner.md)\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("missing.md");
  });

  it("accepts an original numbered ADR with only a title and decision paragraph", () => {
    const result = check({
      adrName: "0001-storage-owner.md",
      adrText:
        "# Storage ownership\n\nEach Project owns its stored data so callers share one authority.\n",
    });
    expect(result.output).toContain("Validated local Markdown links");
    expect(result.status).toBe(0);
  });

  it("accepts optional superseded status without requiring an index entry", () => {
    const result = check({
      adrName: "0002-storage-owner.md",
      adrText:
        "---\nstatus: superseded by ADR-0003\n---\n\n# Storage ownership\n\nThe replacement decision owns the changed boundary.\n",
    });
    expect(result.status).toBe(0);
  });

  it("retains indexed accepted topic explanations", () => {
    const result = check({
      adrName: "storage-owner.md",
      adrText:
        "# Storage ownership\n\nStatus: accepted\n\nThe Project owns this boundary.\n",
      index: "# Decisions\n\n[Storage](storage-owner.md)\n",
    });
    expect(result.status).toBe(0);
  });

  it("retains status and index protection for existing topic explanations", () => {
    const result = check({
      adrName: "storage-owner.md",
      adrText: "# Storage ownership\n\nThe Project owns this boundary.\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("must have Status");
    expect(result.output).toContain("missing from docs/adr/README.md");
  });

  it("rejects malformed decision filenames", () => {
    const result = check({
      adrName: "0001_bad_name.md",
      adrText: "# Storage ownership\n\nA real decision.\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("filename");
  });

  it("requires a title for a numbered decision", () => {
    const result = check({
      adrName: "0001-storage-owner.md",
      adrText: "A decision without a title.\n",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("must have a title");
  });

  it("still rejects missing local links", () => {
    const result = check({ readme: "# Project\n\n[Absent](docs/absent.md)\n" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs/absent.md");
  });

  it("still requires ownership for accepted product specs", () => {
    const result = check({ specText: "# Model\n\nStatus: accepted\n" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("model.md must state ownership");
  });
});
