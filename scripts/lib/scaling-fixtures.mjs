import assert from "node:assert/strict";

import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";

/** The arrays use the same grid and MOS names at every scale. */
function place(cell, id, symbolId, x, y, binding) {
  cell.instances.push({
    id,
    reference: id,
    symbolId,
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
    netlist: { binding, parameters: {} },
  });
  cell.annotations.push({
    id: "label-" + id,
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: id },
    anchor: {
      kind: "object",
      objectId: id,
      localOffset: { x: 32, y: -5 },
      fallbackPosition: { x: x + 32, y: y - 5 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
}

function addPairs(cell, pairs, columns) {
  for (let i = 0; i < pairs; i++) {
    const x = 100 + (i % columns) * 170;
    const y = 100 + Math.floor(i / columns) * 240;
    const p = "M" + (2 * i + 1);
    const n = "M" + (2 * i + 2);
    place(cell, p, "pmos", x, y, {
      kind: "model",
      deviceClass: "mos",
      name: "pmos",
    });
    place(cell, n, "nmos", x, y + 100, {
      kind: "model",
      deviceClass: "mos",
      name: "nmos",
    });
    for (const pinName of ["G", "D"]) {
      const netId = "net-" + pinName + i;
      const terminals = [
        { instanceId: p, pinName },
        { instanceId: n, pinName },
      ];
      cell.nets.push({ id: netId, terminals });
      cell.routes.push(
        createRoutePath({
          id: "wire-" + pinName + i,
          netId,
          start: { kind: "terminal", ...terminals[0] },
          end: { kind: "terminal", ...terminals[1] },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
  }
}

export function createScalingInputs() {
  const inputs = new Map();
  for (const count of [128, 512, 2048]) {
    const name = "flat-" + count;
    const project = createEmptyProject(name, name, "top");
    addPairs(project.documents[0], count / 2, Math.sqrt(count / 2));
    inputs.set(name, serializeProject(project));
  }
  const name = "hier-2048";
  const project = createEmptyProject(name, name, "top");
  const leaf = createEmptyDocument("bank", "bank");
  addPairs(leaf, 32, 8);
  project.documents.push(leaf);
  for (let i = 0; i < 32; i++) {
    place(
      project.documents[0],
      "X" + (i + 1),
      hierarchicalSymbolId("bank"),
      100 + (i % 8) * 170,
      100 + Math.floor(i / 8) * 240,
      { kind: "subcircuit", childDocumentId: "bank" },
    );
  }
  inputs.set(name, serializeProject(project));
  return inputs;
}

export async function createSharedSupplyInput(importSpiceSources) {
  const path = "loads.cir";
  const calls = Array.from(
    { length: 128 },
    (_, i) => "X" + (i + 1) + " sig" + (i + 1) + " load",
  );
  const deck = [
    "* Repeated load, common VDD",
    ".global VDD",
    ".subckt load out",
    "R1 VDD out 1k",
    ".ends load",
    "Rtop VDD 0 10k",
    ...calls,
    ".end",
    "",
  ].join("\n");
  const imported = await importSpiceSources(
    [{ path, bytes: new TextEncoder().encode(deck) }],
    path,
  );
  assert.ok(
    imported.successful && imported.project,
    JSON.stringify(imported.diagnostics),
  );
  return serializeProject(imported.project);
}

/** Check the portable files, including both independent terminals of every drawn Route. */
export function verifyScalingInput(name, body) {
  const project = parseProject(body);
  const top = project.documents.find(
    (cell) => cell.id === project.topDocumentId,
  );
  assert.ok(top, name + " top Cell");
  if (name === "high-fanout") {
    assert.equal(project.documents.length, 2);
    assert.equal(
      top.instances.filter((i) => i.netlist.binding.kind === "subcircuit")
        .length,
      128,
    );
    assert.ok(top.instances.some((i) => i.reference === "Rtop"));
    return;
  }

  const hierarchical = name === "hier-2048";
  const cell = hierarchical
    ? project.documents.find((d) => d.id === "bank")
    : top;
  const count = hierarchical ? 64 : Number(name.slice(5));
  assert.equal(project.documents.length, hierarchical ? 2 : 1);
  if (hierarchical) {
    assert.equal(top.instances.length, 32);
    assert.equal(top.routes.length, 0);
    assert.deepEqual(
      top.instances
        .map((i) => [i.reference, i.netlist.binding.childDocumentId])
        .sort(),
      Array.from({ length: 32 }, (_, i) => ["X" + (i + 1), "bank"]).sort(),
    );
  }
  assert.equal(cell.instances.length, count);
  assert.equal(cell.annotations.length, count);
  assert.equal(cell.nets.length, count);
  assert.equal(cell.routes.length, count);
  const byId = (items) => new Map(items.map((item) => [item.id, item]));
  const instances = byId(cell.instances),
    labels = byId(cell.annotations);
  const nets = byId(cell.nets),
    routes = byId(cell.routes);
  for (let i = 0; i < count / 2; i++) {
    const pair = ["M" + (2 * i + 1), "M" + (2 * i + 2)];
    for (const [index, id] of pair.entries()) {
      assert.equal(instances.get(id)?.reference, id);
      assert.equal(instances.get(id)?.symbolId, index ? "nmos" : "pmos");
      assert.deepEqual(labels.get("label-" + id)?.anchor.localOffset, {
        x: 32,
        y: -5,
      });
    }
    for (const pinName of ["G", "D"]) {
      const netId = "net-" + pinName + i;
      const expected = pair.map((instanceId) => ({ instanceId, pinName }));
      assert.deepEqual(
        nets.get(netId)?.terminals,
        expected.toSorted((a, b) => a.instanceId.localeCompare(b.instanceId)),
      );
      const route = routes.get("wire-" + pinName + i);
      assert.equal(route?.netId, netId);
      assert.deepEqual(
        [route.start, route.legs.at(-1).to.endpoint],
        expected.map((e) => ({ kind: "terminal", ...e })),
      );
    }
  }
}
