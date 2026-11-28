import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import fixture from "../../../netlists/ngspice-ota-qualification/source.icproj.json";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import {
  ngspiceSignals,
  ngspiceVoltageAcquisition,
} from "./simulation-ngspice-signal-names.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { ngspiceAcquisitionEdit } from "./simulation-ngspice-save-edit.js";

it("retains real OTA Canvas voltage mapping on the ngspice path", () => {
  const project = parseProject(JSON.stringify(fixture));
  const folder = project.simulationFolders[0]!;
  expect(compileNgspiceSourceSimulation(project, folder).ok).toBe(true);
  const signals = ngspiceSignals(project, folder.input);
  expect(Object.keys(signals).length).toBeGreaterThan(0);
  for (const [vector, signal] of Object.entries(signals)) {
    expect(vector).toMatch(/^v\(.+\)$/);
    expect(signal.targets.length).toBeGreaterThan(0);
    for (const target of signal.targets)
      expect(project.documents.some((d) => d.id === target.documentId)).toBe(
        true,
      );
  }
});

it("inserts ngspice acquisitions without native control syntax and without duplicating saves", () => {
  const a = ngspiceAcquisitionEdit(
    "Title\n.control\nop\n.endc\n.end\n",
    0,
    ["v(out)"],
    true,
  );
  expect(a.text).toContain(".control\nsave v(out)\nop");
  const b = ngspiceAcquisitionEdit(
    a.text,
    a.text.indexOf("save") + 5,
    ["v(out)"],
    true,
  );
  expect(b.text).toBe(a.text);
});

it("resolves mixed-case calls to the same voltage targets within a binding", () => {
  const project = parseProject(JSON.stringify(fixture));
  const original = project.simulationFolders[0]!.input;
  const binding = {
    ...original.circuitBindings[0]!,
    emission: "subcircuit" as const,
  };
  const ir = analyzeDesignNetlist(project, {
    format: "spice",
    rootDocumentId: binding.documentId,
    ...SIMULATION_DECK_GROUND,
    rootAsTopLevel: false,
  }).ir!;
  const root = ir.cells.find((c) => c.id === ir.topCellId)!;
  const args = [...root.ports.map((_, i) => `n${i}`), root.name].join(" ");
  const text = `* testbench\n.include "${binding.path}"\nXDUT ${args}\n.end\n`;
  const input = {
    ...original,
    entry: "test.cir",
    files: [{ path: "test.cir", text }],
    circuitBindings: [binding],
  };
  const signals = (id: string, name: string) =>
    ngspiceSignals(project, input, { bindingId: id, callPath: [name] });
  const expected = signals(binding.id, "XDUT");
  expect(Object.keys(expected).length).toBeGreaterThan(0);
  expect(signals(binding.id, "xdut")).toEqual(expected);
  expect(signals("another-binding", "xdut")).toEqual({});
});

it("resolves ngspice voltage acquisitions across port aliases and terminal/base-net anchors and rejects invalid scopes", () => {
  const project = parseProject(JSON.stringify(fixture));
  const original = project.simulationFolders[0]!.input;
  const binding = {
    ...original.circuitBindings[0]!,
    emission: "subcircuit" as const,
  };
  const doc = project.documents.find((d) => d.id === binding.documentId)!;
  const ir = analyzeDesignNetlist(project, {
    format: "spice",
    rootDocumentId: binding.documentId,
    ...SIMULATION_DECK_GROUND,
    rootAsTopLevel: false,
  }).ir!;
  const root = ir.cells.find((c) => c.id === ir.topCellId)!;
  const portArgs = root.ports.map((_, i) => `ext_port_${i}`);
  const text = `* testbench\n.include "${binding.path}"\nXDUT ${[...portArgs, root.name].join(" ")}\n.end\n`;
  const input = {
    ...original,
    entry: "test.cir",
    files: [{ path: "test.cir", text }],
    circuitBindings: [binding],
  };
  const scope = { bindingId: binding.id, callPath: ["XDUT"] };

  // Formal-port alias resolves to the external call-site argument vector.
  const firstPort = root.ports[0]!;
  const portNet = root.nets.find((n) => n.name === firstPort.netName)!;
  expect(
    ngspiceVoltageAcquisition(project, input, {
      kind: "voltage",
      documentId: doc.id,
      anchor: { kind: "base-net", netId: portNet.id },
      occurrence: [],
      circuit: scope,
    }),
  ).toEqual({ ok: true, vector: "v(ext_port_0)", save: "v(ext_port_0)" });

  // Internal net resolves identically via base-net anchor and terminal anchor.
  const portNetNames = new Set(root.ports.map((p) => p.netName));
  const internalIrNet = root.nets.find(
    (n) =>
      n.scope !== "global" &&
      !portNetNames.has(n.name) &&
      doc.nets.some((d) => d.id === n.id && d.terminals.length > 0),
  )!;
  const internalDocNet = doc.nets.find((d) => d.id === internalIrNet.id)!;
  const expectedInternal = `v(xdut.${internalIrNet.name.toLowerCase()})`;
  expect(
    ngspiceVoltageAcquisition(project, input, {
      kind: "voltage",
      documentId: doc.id,
      anchor: { kind: "base-net", netId: internalDocNet.id },
      occurrence: [],
      circuit: scope,
    }),
  ).toEqual({ ok: true, vector: expectedInternal, save: expectedInternal });
  const terminal = internalDocNet.terminals[0]!;
  expect(
    ngspiceVoltageAcquisition(project, input, {
      kind: "voltage",
      documentId: doc.id,
      anchor: {
        kind: "terminal",
        instanceId: terminal.instanceId,
        pinName: terminal.pinName,
      },
      occurrence: [],
      circuit: scope,
    }),
  ).toEqual({ ok: true, vector: expectedInternal, save: expectedInternal });

  // Rejects deleted/unknown anchor.
  expect(
    ngspiceVoltageAcquisition(project, input, {
      kind: "voltage",
      documentId: doc.id,
      anchor: { kind: "base-net", netId: "deleted-net-id" },
      occurrence: [],
      circuit: scope,
    }),
  ).toEqual({
    ok: false,
    message: "The selected voltage anchor no longer belongs to a Net",
  });

  // Rejects missing/unknown bindingId, unknown callPath, and wrong occurrence.
  for (const invalidTarget of [
    {
      kind: "voltage" as const,
      documentId: doc.id,
      anchor: { kind: "base-net" as const, netId: internalDocNet.id },
      occurrence: [],
      circuit: { bindingId: "missing-binding", callPath: ["XDUT"] },
    },
    {
      kind: "voltage" as const,
      documentId: doc.id,
      anchor: { kind: "base-net" as const, netId: internalDocNet.id },
      occurrence: [],
      circuit: { bindingId: binding.id, callPath: ["XUNKNOWN"] },
    },
    {
      kind: "voltage" as const,
      documentId: doc.id,
      anchor: { kind: "base-net" as const, netId: internalDocNet.id },
      occurrence: [],
      circuit: scope,
    },
  ].map((target, index) =>
    index === 2 ? { ...target, occurrence: ["nonexistent-instance"] } : target,
  )) {
    expect(ngspiceVoltageAcquisition(project, input, invalidTarget)).toEqual({
      ok: false,
      message:
        "The selected Net has no unique reachable circuit occurrence; choose its exact DUT call path",
    });
  }
});
