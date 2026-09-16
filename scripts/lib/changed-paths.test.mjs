import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  collectChangedPaths,
  loadGateCatalog,
  planValidation,
} from "./validation-gates.mjs";
import { assessTestImpact } from "./test-impact.mjs";

it("accounts for committed, staged and unstaged deletions in gates and test impact", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "icm-deletion-impact-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const paths = [
    "packages/model/src/retired.ts",
    "packages/model/src/retired.test.ts",
    "packages/model/src/other-retired.test.ts",
  ];
  try {
    git("init", "--quiet");
    git("config", "user.name", "Gate test");
    git("config", "user.email", "gate-test@example.invalid");
    mkdirSync(join(cwd, "packages/model/src"), { recursive: true });
    for (const path of paths) writeFileSync(join(cwd, path), "export {};\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
    const base = git("rev-parse", "HEAD");
    git("rm", paths[0]);
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "retire code",
    );
    git("rm", paths[1]);
    rmSync(join(cwd, paths[2]));

    const changed = collectChangedPaths(base, { cwd });
    expect(changed.sort()).toEqual([...paths].sort());
    expect(
      planValidation(changed, await loadGateCatalog()).gates.map(
        (gate) => gate.id,
      ),
    ).toContain("full-delivery");
    expect(
      assessTestImpact(changed, [{ valid: true, decision: "tests-updated" }])
        .ok,
    ).toBe(true);
    expect(
      assessTestImpact(changed, [
        { valid: true, decision: "no-test-change", evidence: "unchanged" },
      ]).ok,
    ).toBe(false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
