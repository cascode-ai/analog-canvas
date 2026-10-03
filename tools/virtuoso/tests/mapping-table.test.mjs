import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixture } from "./fixture.mjs";
import {
  prepareMappings,
  saveMappings,
  projectMappings,
} from "../../../packages/virtuoso-import/dist/core/index.js";
import {
  convertDesign,
  loadCatalog,
} from "../../../packages/virtuoso-import/dist/adapter/index.js";
const runtime = { root: fileURLToPath(new URL("../../../", import.meta.url)) };
const catalog = await loadCatalog(runtime);
const builtin = JSON.parse(
  await fs.readFile(new URL("../rules/builtin/mappings.json", import.meta.url)),
);
const rule = {
  symbol: "resistor",
  pins: { PLUS: "1", MINUS: "2" },
  parameters: { r: "r" },
};
const table = { version: 1, devices: { "analogLib/res": rule } };

test("unknown devices convert to native boxes with unchanged connectivity", async () => {
  const source = fixture(),
    before = structuredClone(source);
  const result = await convertDesign(
    source,
    { version: 1, devices: {} },
    { runtime },
  );
  assert.deepEqual(result.report.genericBoxes, ["R1", "R2"]);
  assert.equal(result.project.externalSubcircuitDefinitions.length, 2);
  assert.deepEqual(
    result.project.externalSubcircuitDefinitions[0].terminals.map(
      (t) => t.name,
    ),
    ["PLUS", "MINUS"],
  );
  assert.equal(result.report.sourceConnectivityVerified, true);
  assert.deepEqual(result.validation.erc, []);
  assert.deepEqual(result.validation.blockingVisual, []);
  assert.deepEqual(source, before);
});

test("box retains unconnected master pins", async () => {
  const source = fixture();
  source.symbols[0].terminals.push({ name: "NC", pins: [] });
  const result = await convertDesign(
    source,
    { version: 1, devices: {} },
    { runtime },
  );
  assert(
    result.project.externalSubcircuitDefinitions[0].terminals.some(
      (t) => t.name === "NC",
    ),
  );
  assert.equal(result.report.sourceConnectivityVerified, true);
  assert(result.validation.sourceUnconnectedBoxPins.length > 0);
  assert.deepEqual(result.validation.blockingErc, []);
});

test("builtins are ready without reviewer or IDs, unknown devices are first", () => {
  const s = fixture();
  let r = prepareMappings(s, builtin, catalog);
  assert.equal(r.items[0].status, "ready");
  assert.equal(r.settings.devices["analogLib/res"].symbol, "resistor");
  s.instances[1].library = "custom";
  r = prepareMappings(s, builtin, catalog);
  assert.equal(r.items[0].device, "custom/res");
  assert.equal(r.items[0].status, "ready");
  assert.equal(r.items[0].automaticBox, true);
  assert.equal(r.settings.devices["custom/res"], null);
  assert(r.items[0].suggestions.some((s) => s.symbol === "resistor"));
});
test("default table is copied exactly; incompatible defaults remain editable", () => {
  const s = fixture();
  const result = prepareMappings(s, builtin, catalog);
  assert.deepEqual(result.settings.devices["analogLib/res"].parameters, {
    r: "r",
  });
  s.symbols[0].terminals.push({ name: "ISO", pins: [] });
  const invalid = prepareMappings(s, builtin, catalog);
  assert.equal(invalid.items[0].status, "invalid");
  assert.equal(invalid.settings.devices["analogLib/res"].symbol, "resistor");
});
test("save merges personal rules, null selects automatic box, inputs unchanged", () => {
  const s = fixture(),
    before = structuredClone(table);
  const result = saveMappings(s, table, catalog, {
    version: 1,
    devices: { "other/res": rule },
  });
  assert.deepEqual(result.unresolved, []);
  assert.equal(Object.keys(result.table.devices).length, 2);
  assert.deepEqual(table, before);
  assert.doesNotThrow(() =>
    projectMappings(
      s,
      { version: 1, devices: { "analogLib/res": null } },
      catalog,
    ),
  );
  assert.equal(
    prepareMappings(s, builtin, catalog, {
      version: 1,
      devices: { "analogLib/res": null },
    }).items[0].status,
    "ready",
  );
});
test("generic box rejects pin remapping and implicit extra pin removal is blocked", () => {
  assert.throws(
    () =>
      projectMappings(
        fixture(),
        {
          version: 1,
          devices: { "analogLib/res": { ...rule, symbol: "generic-box" } },
        },
        catalog,
      ),
    { code: "INVALID_BOX_MAPPING" },
  );
  const s = fixture();
  s.symbols[0].terminals.push({ name: "ISO", pins: [] });
  assert.throws(() => projectMappings(s, table, catalog), {
    code: "PIN_COVERAGE",
  });
});
test("explicit pin omission keeps shared nets and original snapshot", async () => {
  const s = fixture();
  s.symbols[0].terminals.push({ name: "ISO", pins: [] });
  for (const i of s.instances) {
    i.terminals.push({
      name: "ISO",
      netId: "GND",
      pins: [{ worldCenter: [i.position[0] + 0.5, -0.5] }],
    });
    s.nets[1].terminals.push({ instanceId: i.id, pinName: "ISO" });
    s.shapes.push({
      id: "iso-" + i.id,
      netId: "GND",
      type: "line",
      layer: "wire",
      points: [
        [i.position[0], -0.5],
        [i.position[0] + 0.5, -0.5],
      ],
    });
  }
  const before = structuredClone(s),
    t = {
      version: 1,
      devices: { "analogLib/res": { ...rule, omitPins: ["ISO"] } },
    };
  const p = projectMappings(s, t, catalog);
  assert.equal(p.snapshot.nets[1].terminals.length, 2);
  assert.equal(p.report.affectedConnections.length, 2);
  assert.deepEqual(s, before);
  const result = await convertDesign(s, t, { runtime });
  assert.equal(result.report.sourceConnectivityVerified, false);
  assert.equal(result.report.retainedConnectivityVerified, true);
  assert.equal(result.report.simplification.simplified, true);
  assert.deepEqual(result.validation.erc, []);
});
test("explicit device omission projects net membership without removing peers", () => {
  const s = fixture();
  s.instances[1].cell = "unused";
  const p = projectMappings(
    s,
    {
      version: 1,
      devices: { "analogLib/res": rule, "analogLib/unused": { omit: true } },
    },
    catalog,
  );
  assert.deepEqual(
    p.snapshot.instances.map((i) => i.id),
    ["R1"],
  );
  assert(p.snapshot.nets.every((n) => n.terminals.length === 1));
  assert.deepEqual(p.report.omittedInstances, ["R2"]);
});
test("plain table converts without confirmation package", async () => {
  const r = await convertDesign(fixture(), table, { runtime });
  assert.equal(r.report.sourceConnectivityVerified, true);
  assert.deepEqual(r.validation.erc, []);
});
test("seven-pin MOS projects to four pins only with explicit omissions", () => {
  const s = fixture();
  const names = ["D", "G", "S", "B", "ISO", "PW", "NW"];
  s.symbols[0].terminals = names.map((name) => ({ name, pins: [] }));
  for (const n of s.nets) n.terminals = [];
  for (const i of s.instances) {
    i.cell = "isoMos";
    i.terminals = names.map((name) => ({ name, netId: "GND", pins: [] }));
    for (const name of names)
      s.nets[1].terminals.push({ instanceId: i.id, pinName: name });
  }
  const p = projectMappings(
    s,
    {
      version: 1,
      devices: {
        "analogLib/isoMos": {
          symbol: "nmos",
          pins: { D: "D", G: "G", S: "S", B: "B" },
          omitPins: ["ISO", "PW", "NW"],
        },
      },
    },
    catalog,
  );
  assert.equal(p.snapshot.instances[0].terminals.length, 4);
  assert.equal(p.snapshot.nets[1].terminals.length, 8);
  assert.equal(p.report.affectedConnections.length, 6);
});
test("new CLI prepares, saves, protects conflicts, and reuses personal rules", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-table-cli-"));
  const run = (...args) => {
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../dist/cli/main.js", import.meta.url)), ...args],
      { encoding: "utf8" },
    );
    assert.ifError(r.error);
    return r;
  };
  try {
    const snapshot = path.join(dir, "source.json"),
      settings = path.join(dir, "settings"),
      personal = path.join(dir, "personal.json");
    await fs.writeFile(snapshot, JSON.stringify(fixture()));
    assert.equal(
      run("prepare", snapshot, "--mappings", personal, "--out", settings)
        .status,
      0,
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(settings, "preview.txt"), "utf8"),
      /suggestions:/,
    );
    const edit = path.join(settings, "mappings.json");
    assert.equal(
      run("save-mappings", snapshot, "--settings", edit, "--mappings", personal)
        .status,
      0,
    );
    assert.equal(
      run(
        "convert",
        snapshot,
        "--mappings",
        personal,
        "--out",
        path.join(dir, "converted"),
      ).status,
      0,
    );
    const rules = JSON.parse(await fs.readFile(edit));
    rules.devices["analogLib/res"].parameters = {};
    await fs.writeFile(edit, JSON.stringify(rules));
    const conflict = run(
      "save-mappings",
      snapshot,
      "--settings",
      edit,
      "--mappings",
      personal,
    );
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /MAPPING_CONFLICT/);
    assert.equal(
      run(
        "save-mappings",
        snapshot,
        "--settings",
        edit,
        "--mappings",
        personal,
        "--replace",
      ).status,
      0,
    );
    assert.equal(
      JSON.parse(await fs.readFile(personal)).devices["analogLib/res"]
        .parameters.r,
      undefined,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
