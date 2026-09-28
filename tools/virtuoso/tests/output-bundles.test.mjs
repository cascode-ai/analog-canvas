import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fixture } from "./fixture.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
test("CLI separates ordinary/debug outputs and persists repeatable failures", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-output-test-"));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(root, "dist/cli/main.js"), ...args],
      { encoding: "utf8" },
    );
  try {
    const source = path.join(dir, "source.json");
    await fs.writeFile(source, JSON.stringify(fixture()));
    const normal = path.join(dir, "normal");
    let r = run("convert", source, "--out", normal);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, "success");
    assert.deepEqual((await fs.readdir(normal)).sort(), [
      "project.icproj.json",
      "report.json",
    ]);
    const preview = path.join(dir, "preview");
    r = run("convert", source, "--out", preview, "--preview");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual((await fs.readdir(preview)).sort(), [
      "preview.svg",
      "project.icproj.json",
      "report.json",
    ]);
    const debug = path.join(dir, "debug");
    r = run("convert", source, "--out", debug, "--debug");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual((await fs.readdir(debug)).sort(), [
      "config.json",
      "filtered.snapshot.json",
      "mappings.json",
      "presentation.json",
      "preview.svg",
      "project.icproj.json",
      "refinement.json",
      "report.json",
      "source.snapshot.json",
      "validation.json",
    ]);
    const saved = await fs.readFile(path.join(normal, "project.icproj.json"));
    assert.equal(run("convert", source, "--out", normal).status, 1);
    assert.deepEqual(
      await fs.readFile(path.join(normal, "project.icproj.json")),
      saved,
    );
    const fail = path.join(dir, "bad");
    for (let n = 0; n < 2; n++) {
      r = run("convert", path.join(dir, "missing.json"), "--out", fail);
      assert.equal(r.status, 1);
      const folder = fail + ".failed" + (n ? "-1" : "");
      const error = JSON.parse(
        await fs.readFile(path.join(folder, "error.json")),
      );
      assert.equal(error.status, "error");
      assert.equal(error.error.code, "INPUT_NOT_FOUND");
      assert.equal(error.error.stage, "input");
      assert(!(await fs.readdir(folder)).includes("project.icproj.json"));
      assert(!(await fs.readdir(folder)).includes("preview.svg"));
    }
    await assert.rejects(fs.stat(fail), { code: "ENOENT" });
    const missingMappingOut = path.join(dir, "missing-mapping");
    r = run(
      "convert",
      source,
      "--mappings",
      path.join(dir, "absent-mapping.json"),
      "--out",
      missingMappingOut,
    );
    assert.equal(r.status, 1);
    let failure = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{\n  "ok"')));
    assert.equal(failure.error.code, "MAPPING_NOT_FOUND");
    assert.equal(failure.error.category, "INVALID_MAPPING");
    assert(
      !(await fs.readdir(missingMappingOut + ".failed")).includes(
        "preview.svg",
      ),
    );
    const invalidMapping = path.join(dir, "invalid-mapping.json");
    await fs.writeFile(
      invalidMapping,
      JSON.stringify({
        version: 1,
        devices: {
          "analogLib/res": {
            symbol: "resistor",
            pins: { PLUS: "1" },
            parameters: { r: "r" },
            omitPins: [],
          },
        },
      }),
    );
    const mappingOut = path.join(dir, "mapping-failure");
    r = run(
      "convert",
      source,
      "--mappings",
      invalidMapping,
      "--out",
      mappingOut,
    );
    assert.equal(r.status, 1);
    failure = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{\n  "ok"')));
    assert.equal(failure.status, "error");
    assert.equal(failure.error.category, "INVALID_MAPPING");
    assert(!(await fs.readdir(mappingOut + ".failed")).includes("preview.svg"));
    const blockedParent = path.join(dir, "not-a-directory");
    await fs.writeFile(blockedParent, "x");
    r = run("convert", source, "--out", path.join(blockedParent, "result"));
    assert.equal(r.status, 1);
    failure = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{\n  "ok"')));
    assert.equal(failure.error.code, "OUTPUT_NOT_WRITABLE");
    assert.equal(failure.error.category, "OUTPUT");
    assert.equal(typeof failure.diagnosticsWriteError, "string");
    const bad = fixture();
    bad.instances[1].name = bad.instances[0].name;
    await fs.writeFile(source, JSON.stringify(bad));
    const native = path.join(dir, "native-failure");
    r = run("convert", source, "--out", native, "--debug");
    assert.equal(r.status, 1, r.stdout);
    failure = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{\n  "ok"')));
    assert.equal(failure.status, "error");
    assert.equal(failure.error.code, "VALIDATION_FAILED");
    const files = await fs.readdir(native + ".failed");
    assert(!files.includes("preview.svg"));
    assert(files.includes("validation.json"));
    assert(files.includes("process.log"));
    assert(files.includes("source.snapshot.json"));
    assert(!files.includes("project.icproj.json"));
    await assert.rejects(fs.stat(native), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
