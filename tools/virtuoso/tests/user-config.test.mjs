import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";
import {
  resolveUserConfig,
  projectMappings,
} from "../../../packages/virtuoso-import/dist/core/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("personal config fills stable defaults and rejects ambiguous settings", () => {
  const config = resolveUserConfig({
    version: 1,
    presentation: { showInstanceNames: false },
    conversion: { scale: 140 },
  });
  assert.equal(config.conversion.scale, 140);
  assert.equal(config.conversion.busMode, "reject");
  assert.equal(config.conversion.isolatedPorts, "omit");
  assert.equal(config.presentation.showInstanceNames, false);
  assert(config.presentation.powerNets.includes("VDD"));
  assert.throws(() => resolveUserConfig({ version: 1, unknown: true }), {
    code: "INVALID_CONFIG",
  });
  assert.throws(
    () =>
      resolveUserConfig({
        version: 1,
        presentation: { powerNets: ["VDD"], groundNets: ["vdd"] },
      }),
    { code: "INVALID_CONFIG" },
  );
});

test("isolated-port and unmapped-device policies are explicit", () => {
  const source = fixture();
  const port = {
    ...structuredClone(source.instances[0]),
    id: "PIN",
    name: "PIN",
    library: "basic",
    cell: "iopin",
    symbolId: "port-symbol",
    position: [20, 20],
    terminals: [],
  };
  source.instances.push(port);
  source.symbols.push({ id: "port-symbol", terminals: [], shapes: [] });
  source.terminals.push({
    id: "VIN",
    name: "VIN",
    netId: "VIN",
    direction: "input",
    pins: [{ instanceId: "PIN", worldCenter: [20, 20], localCenter: [0, 0] }],
  });
  const empty = { version: 1, devices: {} };
  const kept = projectMappings(source, empty, [], { isolatedPorts: "keep" });
  assert(kept.snapshot.instances.some((i) => i.id === "PIN"));
  assert.deepEqual(kept.report.isolatedPorts, []);
  assert.throws(
    () => projectMappings(fixture(), empty, [], { unmappedDevices: "error" }),
    { code: "UNMAPPED_DEVICE" },
  );
  assert.doesNotThrow(() =>
    projectMappings(
      fixture(),
      {
        version: 1,
        devices: {
          "analogLib/res": {
            symbol: "generic-box",
            pins: {},
            parameters: {},
            omitPins: [],
          },
        },
      },
      [],
      { unmappedDevices: "error" },
    ),
  );
});

test("CLI loads personal config, CLI flags override it, and mappings stay separate", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-config-test-"));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(root, "dist/cli/main.js"), ...args],
      { encoding: "utf8" },
    );
  try {
    const source = path.join(dir, "source.json"),
      configFile = path.join(dir, "config.json");
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        conversion: { scale: 140 },
        presentation: { showInstanceNames: false },
      }),
    );
    let r = run("config", configFile);
    assert.equal(r.status, 0, r.stderr);
    const shown = JSON.parse(r.stdout).result;
    assert.equal(shown.conversion.scale, 140);
    assert.equal(shown.conversion.busMode, "reject");
    const out = path.join(dir, "converted");
    r = run(
      "convert",
      source,
      "--config",
      configFile,
      "--scale",
      "150",
      "--out",
      out,
      "--debug",
    );
    assert.equal(r.status, 0, r.stderr);
    const effective = JSON.parse(
      await fs.readFile(path.join(out, "config.json")),
    );
    const report = JSON.parse(await fs.readFile(path.join(out, "report.json")));
    assert.equal(effective.conversion.scale, 150);
    assert.equal(effective.presentation.showInstanceNames, false);
    assert.equal(report.options.scale, 150);
    assert(!Object.hasOwn(effective, "mappings"));
    const invalid = path.join(dir, "invalid.json");
    await fs.writeFile(
      invalid,
      JSON.stringify({ version: 1, mappings: "embedded" }),
    );
    r = run(
      "convert",
      source,
      "--config",
      invalid,
      "--out",
      path.join(dir, "invalid-out"),
    );
    assert.equal(r.status, 1);
    const failure = JSON.parse(
      r.stderr.slice(r.stderr.lastIndexOf('{\n  "ok"')),
    );
    assert.equal(failure.error.code, "INVALID_CONFIG");
    assert.equal(failure.error.category, "INVALID_CONFIG");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
