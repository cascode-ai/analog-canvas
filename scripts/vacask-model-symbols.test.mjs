import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("model symbols are derived from exact section bytes and never overwrite evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "vacask-model-symbols-"));
  temporaryDirectories.push(directory);
  const library = join(directory, "library.inc"),
    output = join(directory, "symbols.json");
  const text =
    "section tt\nmodel core sp_bsim4v8\nendsection\nsection ff\nmodel core resistor\nendsection\n";
  writeFileSync(library, text);
  const args = [
    "scripts/vacask-model-symbols.mjs",
    "--library",
    library,
    "--dependency-id",
    "model-fixture",
    "--master",
    "core",
    "--master",
    "Missing",
    "--section",
    "tt",
    "--output",
    output,
  ];
  const run = () =>
    spawnSync(process.execPath, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(report.status, "derived-not-qualified");
  assert.deepEqual(report.unresolved, ["Missing"]);
  assert.equal(
    report.library.sha256,
    createHash("sha256").update(text).digest("hex"),
  );
  assert.deepEqual(report.library.masters, [
    { name: "core", primitives: [{ path: [], module: "sp_bsim4v8" }] },
  ]);
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/u);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), report);
});
