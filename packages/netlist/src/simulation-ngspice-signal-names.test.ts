import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import fixture from "../../../netlists/ngspice-ota-qualification/source.icproj.json";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import { ngspiceSignals } from "./simulation-ngspice-signal-names.js";
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
