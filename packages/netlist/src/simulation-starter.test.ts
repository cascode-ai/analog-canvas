import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../netlists/native-ota-library/legacy-source.icproj.json";
import { createSimulationStarter } from "./simulation-starter.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { analyzeDesignNetlist } from "./extract.js";
import { vacaskCircuitScopes } from "./vacask-source-scopes.js";

const project = parseProject(JSON.stringify(ota));
const options = {
  id: "experiment",
  name: "Experiment",
  profileId: "test",
  documentId: "document-ota-5t",
};
describe("simulation starting points", () => {
  it.each(["circuit", "dut", "text"] as const)(
    "creates a genuine ngspice %s starter without VACASK syntax",
    (mode) => {
      const result = createSimulationStarter(project, {
        ...options,
        mode,
        engine: "ngspice",
        template: "ac",
      });
      if (!result.ok) throw new Error(result.message);
      const source = result.folder.input.files.find(
        (f) => f.path === result.folder.input.entry,
      )!.text;
      expect(source).toContain(".control\nset filetype=ascii");
      expect(source).toContain("ac dec 20 1 1G");
      expect(source).not.toContain("ground 0");
      const compiled = compileNgspiceSourceSimulation(project, result.folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    },
  );
  it.each(["circuit", "dut", "text"] as const)(
    "preserves the selected analysis template for a %s folder",
    (mode) => {
      const result = createSimulationStarter(project, {
        ...options,
        mode,
        template: "ac",
      });
      if (!result.ok) throw new Error(result.message);
      expect(
        result.folder.input.files.find((f) => f.path === "run.cir")!.text,
      ).toContain('analysis ac ac from=1 to=1G mode="dec" points=20');
      const compiled = compileSourceSimulation(project, result.folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    },
  );
  it("preserves a drawn top-level circuit and allows text without any Canvas binding", () => {
    const drawn = createSimulationStarter(project, {
      ...options,
      mode: "circuit",
    });
    expect(drawn.ok && drawn.folder.input.circuitBindings[0]?.emission).toBe(
      "top-level",
    );
    expect(
      drawn.ok &&
        drawn.folder.input.files.some((f) => f.path === "testbench.spice"),
    ).toBe(false);
    const text = createSimulationStarter(project, { ...options, mode: "text" });
    expect(text.ok && text.folder.input.circuitBindings).toEqual([]);
    expect(
      text.ok &&
        text.folder.input.files.find((f) => f.path === "run.cir")!.text,
    ).not.toContain(".include");
  });
  it("uses the exported DUT name and ordered ports for a textual TB without creating a Cell", () => {
    const before = JSON.stringify(project);
    const result = createSimulationStarter(project, {
      ...options,
      mode: "dut",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const binding = result.folder.input.circuitBindings[0]!;
    expect(binding.emission).toBe("subcircuit");
    expect(compileSourceSimulation(project, result.folder).ok).toBe(true);
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      groundPin: "pin",
      rootDocumentId: options.documentId,
    }).ir!;
    const root = ir.cells.find((cell) => cell.id === ir.topCellId)!;
    expect(
      result.folder.input.files.find((file) => file.path === "testbench.spice")!
        .text,
    ).toContain(
      `XDUT (${root.ports.map((port) => `'${port.netName}'`).join(" ")}) '${root.name}'`,
    );
    const scopes = vacaskCircuitScopes(
      inspectVacaskSourceGraph(result.folder.input),
      binding,
      ir,
    ).list();
    expect(scopes).toEqual([{ bindingId: "circuit", callPath: ["XDUT"] }]);
    expect(JSON.stringify(project)).toBe(before);
  });
});
