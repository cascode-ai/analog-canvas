import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";

import { createDesignNetlistExport } from "./export.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

/** One terminal on a Net, the Net made when it is new. */
function connect(
  document: SchematicDocument,
  netId: string,
  instanceId: string,
  pinName: string,
) {
  const net = document.nets.find((candidate) => candidate.id === netId);
  if (net) net.terminals.push({ instanceId, pinName });
  else document.nets.push({ id: netId, terminals: [{ instanceId, pinName }] });
}

/** A Cell Pin: its Port on a Net of the same name. */
function cellPin(document: SchematicDocument, name: string) {
  const id = `pin-${name}`;
  document.instances.push({ id, symbolId: "port", placement: null });
  connect(document, name, id, "P");
  document.netlist!.terminals.push({
    id: `terminal-${name}`,
    name,
    netId: name,
    direction: "inout",
    interfaceInstanceIds: [id],
  });
}

function mos(
  document: SchematicDocument,
  id: string,
  kind: "nmos" | "pmos",
  [d, g, s, b]: readonly [string, string, string, string],
) {
  document.instances.push({
    id,
    reference: id,
    symbolId: kind,
    placement: null,
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: kind.toUpperCase() },
      parameters: { w: "1u", l: "1u" },
    },
  });
  for (const [pinName, netId] of [
    ["D", d],
    ["G", g],
    ["S", s],
    ["B", b],
  ] as const)
    connect(document, netId, id, pinName);
}

/**
 * A NOR2 drawn with four transistors in Cell nor2, its Pins spelled a, b and
 * y, its supplies VDD and VSS Pins or, with `globalSupplies`, a global VDD
 * marker and ground. The top Cell's nor-gate X1 is bound to it, its inputs
 * and output on the top Cell's Pins IN1, IN2 and OUT.
 */
function norOverCell(globalSupplies = false): CircuitProject {
  const project = createEmptyProject("gate-cell", "Gate cell", "top");
  const top = project.documents[0]!;
  top.netlist!.name = "top";
  const cell = createEmptyDocument("nor2", "nor2");
  cell.netlist!.name = "nor2";
  for (const name of ["a", "b", "y"]) cellPin(cell, name);
  if (globalSupplies) {
    cell.instances.push(
      { id: "rail", symbolId: "vdd-port", placement: null },
      { id: "gnd", symbolId: "ground", placement: null },
    );
    connect(cell, "VDD", "rail", "P");
    connect(cell, "VSS", "gnd", "0");
    cell.connectivityEvidence.push({
      id: "rail-claim",
      kind: "name-claim",
      netId: "VDD",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "rail" },
    });
  } else {
    cellPin(cell, "VDD");
    cellPin(cell, "VSS");
  }
  mos(cell, "MP1", "pmos", ["mid", "a", "VDD", "VDD"]);
  mos(cell, "MP2", "pmos", ["y", "b", "mid", "VDD"]);
  mos(cell, "MN1", "nmos", ["y", "a", "VSS", "VSS"]);
  mos(cell, "MN2", "nmos", ["y", "b", "VSS", "VSS"]);
  project.documents.push(cell);
  top.instances.push({
    id: "gate",
    symbolId: "nor-gate",
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: cell.id },
      parameters: {},
    },
  });
  for (const [name, pinName] of [
    ["IN1", "A"],
    ["IN2", "B"],
    ["OUT", "Y"],
  ] as const) {
    cellPin(top, name);
    connect(top, name, "gate", pinName);
  }
  return project;
}

function exported(project: CircuitProject) {
  const result = createDesignNetlistExport(project, { format: "spice" });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result.file.text;
}

/** A global VDD marker in the top Cell, on a Net of that name. */
function drawTopSupply(project: CircuitProject, name: string) {
  const top = project.documents[0]!;
  top.instances.push({ id: name, symbolId: "vdd-port", placement: null });
  connect(top, `net-${name}`, name, "P");
  top.connectivityEvidence.push({
    id: `${name}-claim`,
    kind: "name-claim",
    netId: `net-${name}`,
    name,
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: name },
  });
}

describe("a Library gate bound to a Cell of its Project (#1450)", () => {
  it("calls the Cell, its Pins met by name in any case and its rails on the gate's supplies", () => {
    const project = norOverCell();
    drawTopSupply(project, "VDDA");
    const text = exported(project);
    expect(text).toContain(".subckt nor2 VDD VSS a b y\n");
    // The gate's A, B and Y on the Cell's a, b and y; its VDD on the one
    // drawn supply, its VSS on ground, which the export writes as VSS.
    expect(text).toMatch(/^X1 VDDA VSS IN1 IN2 OUT nor2$/mu);
    expect(text).not.toContain("nor_gate");

    // A Net chosen for the gate's VDD in Properties wins.
    drawTopSupply(project, "VDDB");
    project.documents[0]!.nets.find(
      (net) => net.id === "net-VDDB",
    )!.terminals.push({ instanceId: "gate", pinName: "VDD" });
    expect(exported(project)).toMatch(/^X1 VDDB VSS IN1 IN2 OUT nor2$/mu);
  });

  it("takes the conventional supply where the gate's Cell drew none", () => {
    const text = exported(norOverCell());
    expect(text).toContain(".subckt top VDD VSS IN1 IN2 OUT\n");
    expect(text).toMatch(/^X1 VDD VSS IN1 IN2 OUT nor2$/mu);
  });

  it("calls a Cell that takes its supplies globally with its signals alone", () => {
    const text = exported(norOverCell(true));
    // Ground still becomes each Cell's VSS pin, as for any Cell.
    expect(text).toContain(".subckt nor2 VSS a b y\n");
    expect(text).toMatch(/^X1 VSS IN1 IN2 OUT nor2$/mu);
    expect(text).toMatch(/^\.global VDD$/mu);
  });

  it("refuses a call to a Cell whose Pins no longer fit the gate", () => {
    const project = norOverCell();
    const cell = project.documents[1]!;
    cell.netlist!.terminals = cell.netlist!.terminals.filter(
      (terminal) => terminal.name !== "b",
    );
    cellPin(cell, "EN");
    const result = createDesignNetlistExport(project, { format: "spice" });
    expect(result.status).toBe("blocked");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GATE_CELL_PIN_MISMATCH",
        message:
          "Cell nor2 does not fit the nor-gate: it has no Pin B, and its Pin EN is not one of the gate's. Its Pins must be A, B and Y, in any letter case, and VDD and VSS unless the Cell takes its supplies globally. X1 is bound to it: fix the Cell's Pins, or clear X1's model",
      }),
    );
  });

  it("puts the Cell's transistors in an ngspice simulation", () => {
    const project = norOverCell();
    const folder = createSimulationFolder({
      id: "nor-probe",
      name: "NOR probe",
      profileId: "local",
      documentId: project.topDocumentId,
    });
    folder.input.files.find((file) => file.path === folder.input.entry)!.text =
      "NOR probe\n.include circuit.spice\n.control\nop\n.endc\n.end\n";
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(
      compiled.ok,
      JSON.stringify(compiled.ok ? [] : compiled.diagnostics),
    ).toBe(true);
    if (!compiled.ok) return;
    const circuit = compiled.files.find(
      (file) => file.path === "circuit.spice",
    )!.text;
    expect(circuit).toMatch(/^\.subckt nor2 VDD VSS a b y$/mu);
    expect(circuit).toMatch(/^MN1 y a VSS VSS NMOS l=1u w=1u$/mu);
    expect(circuit).toMatch(/^X1 VDD 0 IN1 IN2 OUT nor2$/mu);
  });
});

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())(
  "a gate bound to a transistor-level Cell under ngspice",
  () => {
    it("computes NOR from the Cell's transistors", () => {
      const circuit = exported(norOverCell());
      const directory = mkdtempSync(join(tmpdir(), "icm-gate-cell-"));
      try {
        const levels = ([a, b]: readonly [number, number]) => {
          writeFileSync(
            join(directory, "deck.cir"),
            [
              "* NOR over a Cell",
              circuit.replace(/^\.end\s*$/mu, ""),
              ".model NMOS NMOS (level=1 vto=0.5 kp=200u)",
              ".model PMOS PMOS (level=1 vto=-0.5 kp=100u)",
              "VS vdd 0 1.8",
              `VA in1 0 ${a}`,
              `VB in2 0 ${b}`,
              "XT vdd 0 in1 in2 out top",
              ".control",
              "op",
              "print v(out)",
              ".endc",
              ".end",
            ].join("\n"),
            "utf8",
          );
          const output = execFileSync("ngspice", ["-b", "deck.cir"], {
            cwd: directory,
            encoding: "utf8",
          });
          return Number(/v\(out\)\s*=\s*(\S+)/u.exec(output)?.[1]);
        };
        expect(levels([0, 0])).toBeGreaterThan(1.7);
        for (const inputs of [
          [1.8, 0],
          [0, 1.8],
          [1.8, 1.8],
        ] as const)
          expect(levels(inputs)).toBeLessThan(0.1);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);
