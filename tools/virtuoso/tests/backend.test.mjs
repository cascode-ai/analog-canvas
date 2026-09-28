import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fixture } from "./fixture.mjs";
import * as core from "../../../packages/virtuoso-import/dist/core/index.js";
import {
  loadCatalog,
  convertDesign,
} from "../../../packages/virtuoso-import/dist/adapter/index.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = { root: fileURLToPath(new URL("../../../", import.meta.url)) };
const catalog = await loadCatalog(runtime);
const builtin = JSON.parse(
  await fs.readFile(new URL("../rules/builtin/common.json", import.meta.url)),
);
function proposal(s = fixture(), personal) {
  return core.recommendMappings(core.scanDesign(s), builtin, catalog, personal);
}
function approved(s = fixture()) {
  const p = proposal(s),
    decisions = core.decisionTemplate(p);
  decisions.reviewedBy = "synthetic-test-reviewer";
  for (const d of decisions.decisions) {
    d.action = "approve";
    d.candidateId = p.items.find((i) => i.itemId === d.itemId).candidates[0].id;
  }
  return core.confirmMappings(p, decisions, catalog, {
    name: "synthetic-test",
    now: "2026-01-01T00:00:00.000Z",
  }).package;
}

test("scan preserves source, instance expressions and simulator evidence", () => {
  const s = fixture(),
    before = structuredClone(s),
    inventory = core.scanDesign(s);
  assert.deepEqual(s, before);
  assert.equal(inventory.items.length, 1);
  const item = inventory.items[0];
  assert.deepEqual(item.componentNames, ["resistor"]);
  assert.deepEqual(item.termOrders, [
    { simulator: "spectre", pins: ["PLUS", "MINUS"] },
  ]);
  assert(item.instances[0].parameters.some((p) => p.value === "Rbias"));
  assert.deepEqual(core.scanDesign(s), inventory);
});
test("old snapshots explicitly report missing model evidence", () => {
  const s = fixture();
  for (const i of s.instances) delete i.simulationInfo;
  assert.equal(core.scanDesign(s).items[0].evidenceStatus, "unavailable");
});
test("inconsistent connectivity and duplicate net memberships fail", () => {
  const s = fixture();
  s.nets[0].terminals = [];
  assert.throws(() => core.scanDesign(s), { code: "CONNECTIVITY_MISMATCH" });
  const duplicate = fixture();
  duplicate.nets[0].terminals.push(duplicate.nets[0].terminals[0]);
  assert.throws(() => core.scanDesign(duplicate), { code: "DUPLICATE_ID" });
});
test("missing instance symbol data reports the affected master", () => {
  const s = fixture();
  s.symbols = [];
  assert.throws(
    () => core.validateSnapshot(s),
    (error) =>
      error.code === "MASTER_MISSING" &&
      error.details.instanceId === "R1" &&
      error.details.master.library === "analogLib" &&
      error.details.master.cell === "res",
  );
});
test("parameter values and model evidence do not change device identity", () => {
  const s = fixture(),
    before = core.scanDesign(s).items[0].signature;
  s.instances[0].properties[0].value = "2*Rbias";
  assert.equal(core.scanDesign(s).items[0].signature, before);
  s.instances[0].simulationInfo.simulators[0].modelName = "another_model";
  assert.equal(
    core.scanDesign(s).items.find((i) => i.instances.some((x) => x.id === "R1"))
      .signature,
    before,
  );
});
test("extra master pins block candidates even when absent from instTerms", () => {
  const s = fixture();
  s.symbols[0].terminals.push({ name: "B", pins: [] });
  const p = proposal(s);
  assert.equal(p.items[0].status, "unknown");
  assert(p.items[0].warnings.some((w) => w.code === "CANDIDATE_REJECTED"));
});
test("exact builtins still require confirmation; pending cannot become an approved rule", () => {
  const p = proposal();
  assert.equal(p.items[0].status, "needs-review");
  const d = core.decisionTemplate(p);
  assert.equal(d.decisions[0].action, "pending");
  assert.throws(() => core.confirmMappings(p, d, catalog, { name: "test" }), {
    code: "REVIEWER_REQUIRED",
  });
  d.reviewedBy = "tester";
  const r = core.confirmMappings(p, d, catalog, { name: "test" });
  assert.equal(r.package.entries.length, 0);
  assert.equal(r.unresolved.length, 1);
});
test("confirmation is explicit, reusable and personal rules take precedence", () => {
  const pkg = approved(),
    p = proposal(fixture(), pkg);
  assert.equal(p.items[0].status, "confirmed");
  assert.equal(p.items[0].candidates[0].origin, "personal");
  assert.equal(
    core.resolveMappings(core.scanDesign(fixture()), pkg, catalog).get("R1")
      .symbol,
    "resistor",
  );
});
test("model and view changes reuse the library/cell mapping", () => {
  const s = fixture(),
    pkg = approved();
  s.instances[0].simulationInfo.simulators[0].modelName = "new";
  s.instances[0].view = "symbolr";
  assert.equal(proposal(s, pkg).items[0].status, "confirmed");
  assert.equal(core.resolveMappings(core.scanDesign(s), pkg, catalog).size, 2);
});
test("proposal edits and cross-proposal decisions are rejected", () => {
  const p = proposal(),
    d = core.decisionTemplate(p);
  d.reviewedBy = "tester";
  p.items[0].candidates[0].mapping.symbol = "capacitor";
  assert.throws(() => core.confirmMappings(p, d, catalog, { name: "test" }), {
    code: "STALE_PROPOSAL",
  });
});
test("custom mapping validation blocks missing, duplicate and unknown pin targets", () => {
  const item = core.scanDesign(fixture()).items[0];
  assert.throws(
    () =>
      core.validateMapping(
        item,
        { symbol: "resistor", pins: { PLUS: "1" }, parameters: {} },
        catalog,
      ),
    { code: "PIN_COVERAGE" },
  );
  assert.throws(
    () =>
      core.validateMapping(
        item,
        { symbol: "resistor", pins: { PLUS: "1", MINUS: "1" }, parameters: {} },
        catalog,
      ),
    { code: "DUPLICATE_ID" },
  );
  assert.throws(
    () =>
      core.validateMapping(
        item,
        { symbol: "resistor", pins: { PLUS: "1", MINUS: "X" }, parameters: {} },
        catalog,
      ),
    { code: "UNKNOWN_TARGET_PIN" },
  );
});
test("unknown master can be manually mapped without executing scripts", () => {
  const s = fixture();
  for (const i of s.instances) {
    i.cell = "custom";
    delete i.simulationInfo;
  }
  const p = proposal(s);
  assert.equal(p.items[0].status, "unknown");
  const d = core.decisionTemplate(p);
  d.reviewedBy = "tester";
  d.decisions[0] = {
    itemId: p.items[0].itemId,
    action: "approve",
    mapping: {
      symbol: "resistor",
      pins: { PLUS: "1", MINUS: "2" },
      parameters: { r: "r" },
    },
  };
  assert.equal(
    core.confirmMappings(p, d, catalog, { name: "custom" }).package.entries
      .length,
    1,
  );
});
test("rejecting an existing rule revokes that signature", () => {
  const pkg = approved(),
    p = proposal(fixture(), pkg),
    d = core.decisionTemplate(p);
  d.reviewedBy = "tester";
  d.decisions[0].action = "reject";
  assert.equal(
    core.confirmMappings(p, d, catalog, { name: "test", existing: pkg }).package
      .entries.length,
    0,
  );
});
test("core cancellation and progress use caller hooks", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() =>
    core.scanDesign(fixture(), { signal: controller.signal }),
  );
  const events = [];
  core.scanDesign(fixture(), { onProgress: (p) => events.push(p) });
  assert.equal(events.at(-1).completed, 2);
});
test("same library/cell merges models and instance property storage variants", () => {
  const s = fixture();
  s.instances[1].simulationInfo.simulators[0].modelName = "another_resistor";
  s.instances[1].properties.push({
    name: "derived",
    type: "string",
    value: "1",
  });
  const inventory = core.scanDesign(s);
  assert.equal(inventory.items.length, 1);
  assert(inventory.items[0].parameterNames.includes("derived"));
  assert(inventory.items[0].modelNames.includes("another_resistor"));
  const pkg = approved(s);
  assert.equal(pkg.entries.length, 1);
  assert.equal(core.resolveMappings(inventory, pkg, catalog).size, 2);
});
test("per-instance missing pins still block mapping reuse", () => {
  const s = fixture(),
    pkg = approved();
  const inventory = core.scanDesign(s);
  inventory.items[0].instances[0].pinNames = ["PLUS"];
  assert.throws(() => core.resolveMappings(inventory, pkg, catalog), {
    code: "INSTANCE_MAPPING_MISMATCH",
  });
});
test("different libraries and cells remain separate device classes", () => {
  const s = fixture();
  s.instances[1].library = "anotherLib";
  assert.equal(core.scanDesign(s).items.length, 2);
  s.instances[1].library = s.instances[0].library;
  s.instances[1].cell = "anotherCell";
  assert.equal(core.scanDesign(s).items.length, 2);
});
test("personal override can intentionally change a reviewed target parameter map", () => {
  const pkg = approved();
  pkg.entries[0].mapping.parameters = { r: "r" };
  const p = proposal(fixture(), pkg);
  assert.equal(p.items[0].candidates.length, 1);
  assert.deepEqual(p.items[0].candidates[0].mapping.parameters, { r: "r" });
});
test("custom mapping rejects unknown parameter names and executable fields", () => {
  const item = core.scanDesign(fixture()).items[0];
  assert.throws(
    () =>
      core.validateMapping(
        item,
        {
          symbol: "resistor",
          pins: { PLUS: "1", MINUS: "2" },
          parameters: { missing: "r" },
        },
        catalog,
      ),
    { code: "UNKNOWN_PARAMETER" },
  );
  assert.throws(() =>
    core.validateMapping(
      item,
      {
        symbol: "resistor",
        pins: { PLUS: "1", MINUS: "2" },
        parameters: {},
        script: "anything",
      },
      catalog,
    ),
  );
});
test("CDF component evidence suggests a two-terminal PDK resistor, but never approves it", () => {
  const s = fixture();
  for (const i of s.instances) {
    i.library = "syntheticPDK";
    i.cell = "device";
  }
  const p = proposal(s);
  assert.equal(p.items[0].status, "needs-review");
  assert.equal(p.items[0].candidates[0].mapping.symbol, "resistor");
  assert.equal(p.items[0].candidates[0].origin, "heuristic");
});
test("candidate IDs cannot be applied to a different item", () => {
  const s = fixture();
  s.instances[1].cell = "another_resistor";
  const p = proposal(s),
    d = core.decisionTemplate(p);
  d.reviewedBy = "tester";
  d.decisions[0].action = "approve";
  d.decisions[0].candidateId = p.items[1].candidates[0].id;
  assert.throws(() => core.confirmMappings(p, d, catalog, { name: "test" }), {
    code: "UNKNOWN_CANDIDATE",
  });
});
test("approved mapping converts offline; source parameters/connectivity survive native validation", async () => {
  const result = await convertDesign(fixture(), approved(), { runtime });
  assert.equal(result.report.sourceConnectivityVerified, true);
  assert.deepEqual(result.validation.erc, []);
  assert.deepEqual(result.validation.visual, []);
  const instance = result.project.documents[0].instances.find(
    (i) => i.reference === "R1",
  );
  assert.equal(instance.netlist.parameters.r, "Rbias");
  assert(!("layoutOnly" in instance.netlist.parameters));
  const document = result.project.documents[0];
  const generatedPorts = result.report.endpointMarkers.filter(
    (marker) => marker.kind === "port",
  );
  assert.equal(generatedPorts.length, 2);
  assert.equal(document.netlist.terminals.length, generatedPorts.length);
  const vinNetId = document.netlist.terminals.find(
    (terminal) => terminal.name === "VIN",
  ).netId;
  assert(
    !document.annotations.some(
      (annotation) =>
        annotation.kind === "net-label" && annotation.netId === vinNetId,
    ),
  );
  assert(
    result.report.replacedNetLabels.some(
      (label) => label.sourceId === "label-in",
    ),
  );
  assert(
    document.annotations.some(
      (annotation) =>
        annotation.kind === "net-label" && annotation.netId !== vinNetId,
    ),
  );
  assert(
    !document.drafting.objects.some(
      (object) =>
        object.kind === "floating-symbol" && object.symbolId === "port",
    ),
  );
  for (const marker of generatedPorts) {
    assert(
      document.instances.some(
        (candidate) =>
          candidate.id === marker.id && candidate.symbolId === "port",
      ),
    );
    const cellTerminal = document.netlist.terminals.find(
      (terminal) => terminal.interfaceInstanceIds[0] === marker.id,
    );
    assert.equal(cellTerminal?.name, "VIN");
    assert(
      document.nets.some((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === marker.id && terminal.pinName === "P",
        ),
      ),
    );
    assert(
      document.routes.some((route) =>
        [route.start, route.legs.at(-1).to.endpoint].some(
          (endpoint) =>
            endpoint.kind === "terminal" &&
            endpoint.instanceId === marker.id &&
            endpoint.pinName === "P",
        ),
      ),
    );
    assert(
      document.annotations.some(
        (annotation) =>
          annotation.binding?.kind === "cell-terminal-name" &&
          annotation.binding.terminalId === cellTerminal.id,
      ),
    );
  }
  assert(result.svg.includes("<svg"));
  assert.equal(
    result.filteredSnapshot.instances[0].properties.some(
      (p) => p.name === "layoutOnly",
    ),
    false,
  );
});
test("unconfirmed mappings and unsupported buses are blocked before converter execution", async () => {
  await assert.rejects(
    convertDesign(
      fixture(),
      {
        format: "virtuoso-canvas.mapping-package",
        version: 1,
        name: "empty",
        entries: [],
      },
      { runtime },
    ),
    { code: "UNCONFIRMED_MASTER" },
  );
  const s = fixture();
  s.nets[0].numBits = 2;
  await assert.rejects(convertDesign(s, approved(), { runtime }), {
    code: "BUS_UNSUPPORTED",
  });
});
test("CLI workflow publishes separate bundles and refuses overwrite", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-cli-test-"));
  const cli = path.join(root, "dist/cli/main.js");
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    return result;
  };
  try {
    const source = path.join(dir, "source.json");
    await fs.writeFile(source, JSON.stringify(fixture()));
    const scan = path.join(dir, "scan"),
      review = path.join(dir, "review"),
      pkg = path.join(dir, "package");
    assert.equal(run("scan", source, "--out", scan).status, 0);
    assert.equal(run("scan", source, "--out", scan).status, 1);
    assert.equal(
      run("recommend", path.join(scan, "inventory.json"), "--out", review)
        .status,
      0,
    );
    const d = JSON.parse(
      await fs.readFile(path.join(review, "decisions.json")),
    );
    d.reviewedBy = "cli-test";
    d.decisions[0].action = "approve";
    const file = path.join(dir, "decisions.json");
    await fs.writeFile(file, JSON.stringify(d));
    assert.equal(
      run(
        "confirm",
        path.join(review, "proposal.json"),
        "--decisions",
        file,
        "--name",
        "test",
        "--out",
        pkg,
      ).status,
      0,
    );
    const result = run(
      "convert",
      source,
      "--package",
      path.join(pkg, "mapping-package.json"),
      "--out",
      path.join(dir, "output"),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal(run("scan", source, "--bogus", "x").status, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
