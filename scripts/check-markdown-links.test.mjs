import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function check({
  name = "simulation.md",
  title = "Simulation",
  status = "accepted",
  indexed = true,
  broken = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "icm-doc-contract-"));
  try {
    for (const dir of ["scripts", "docs/adr", "docs/specs"])
      mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(
      "scripts/check-markdown-links.mjs",
      join(root, "scripts/check-markdown-links.mjs"),
    );
    writeFileSync(join(root, "README.md"), "# Fixture\n");
    writeFileSync(join(root, "docs/specs/README.md"), "# Specs\n");
    writeFileSync(
      join(root, "docs/adr/README.md"),
      indexed ? `[Topic](${name})\n` : "# Rationale\n",
    );
    writeFileSync(join(root, "docs/adr/adr.template.md"), "# Topic Title\n");
    writeFileSync(
      join(root, "docs/adr", name),
      `# ${title}\n\nStatus: ${status}\n${broken ? "[Missing](missing.md)" : ""}\n`,
    );
    try {
      return {
        code: 0,
        output: execFileSync(
          process.execPath,
          [join(root, "scripts/check-markdown-links.mjs")],
          { encoding: "utf8", stdio: "pipe" },
        ),
      };
    } catch (error) {
      return { code: error.status, output: String(error.stderr) };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("topic rationale documentation contracts", () => {
  it("accepts named topics and excludes the template", () =>
    expect(check().code).toBe(0));
  it.each([
    [{ name: "0055-simulation.md" }, "without a numeric prefix"],
    [{ title: "0055 - Simulation" }, "unnumbered topic title"],
    [{ indexed: false }, "missing from docs/adr/README.md"],
    [{ status: "superseded" }, "Status: accepted or proposed"],
    [{ broken: true }, "missing.md"],
  ])("rejects invalid topic contracts: %j", (options, message) => {
    const result = check(options);
    expect(result.code).toBe(1);
    expect(result.output).toContain(message);
  });
});
