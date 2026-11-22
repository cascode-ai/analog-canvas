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
  it.each([
    [
      "a numbered title on an unnumbered topic file",
      {
        adrName: "storage-owner.md",
        adrText: "# 0055 - Storage\n\nStatus: accepted\n",
        index: "[Storage](storage-owner.md)\n",
      },
      ["unnumbered topic title"],
    ],
    [
      "a topic file outside the accepted/proposed status contract",
      {
        adrName: "storage-owner.md",
        adrText: "# Storage\n\nStatus: superseded\n",
        index: "[Storage](storage-owner.md)\n",
      },
      ["Status: accepted or proposed"],
    ],
    [
      "a missing link inside ADR content",
      {
        adrName: "storage-owner.md",
        adrText: "# Storage\n\nStatus: accepted\n\n[Missing](missing.md)\n",
        index: "[Storage](storage-owner.md)\n",
      },
      ["missing.md"],
    ],
    [
      "an existing topic explanation without status or index entry",
      {
        adrName: "storage-owner.md",
        adrText: "# Storage ownership\n\nThe Project owns this boundary.\n",
      },
      ["must have Status", "missing from docs/adr/README.md"],
    ],
    [
      "a malformed decision filename",
      {
        adrName: "0001_bad_name.md",
        adrText: "# Storage ownership\n\nA real decision.\n",
      },
      ["filename"],
    ],
    [
      "a numbered decision without a title",
      {
        adrName: "0001-storage-owner.md",
        adrText: "A decision without a title.\n",
      },
      ["must have a title"],
    ],
    [
      "a missing local link",
      { readme: "# Project\n\n[Absent](docs/absent.md)\n" },
      ["docs/absent.md"],
    ],
    [
      "an accepted product spec without ownership",
      { specText: "# Model\n\nStatus: accepted\n" },
      ["model.md must state ownership"],
    ],
  ])("rejects %s", (_, input, messages) => {
    const result = check(input);
    expect(result.status).toBe(1);
    for (const message of messages) expect(result.output).toContain(message);
  });

  it.each([
    [
      "an original numbered ADR with only a title and decision paragraph",
      {
        adrName: "0001-storage-owner.md",
        adrText:
          "# Storage ownership\n\nEach Project owns its stored data so callers share one authority.\n",
      },
    ],
    [
      "optional superseded status without requiring an index entry",
      {
        adrName: "0002-storage-owner.md",
        adrText:
          "---\nstatus: superseded by ADR-0003\n---\n\n# Storage ownership\n\nThe replacement decision owns the changed boundary.\n",
      },
    ],
    [
      "an indexed accepted topic explanation",
      {
        adrName: "storage-owner.md",
        adrText:
          "# Storage ownership\n\nStatus: accepted\n\nThe Project owns this boundary.\n",
        index: "# Decisions\n\n[Storage](storage-owner.md)\n",
      },
    ],
  ])("accepts %s", (_, input) => {
    const result = check(input);
    expect(result.output).toContain("Validated local Markdown links");
    expect(result.status).toBe(0);
  });
});
