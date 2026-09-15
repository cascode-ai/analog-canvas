import { describe, expect, it } from "vitest";
import { sourceCircuitContext } from "./source-circuit-context";
import { createSimulationExample } from "../../examples/simulation-examples";

describe("source circuit context", () => {
  it("distinguishes a textual OTA testbench from the Canvas testbench", () => {
    const project = createSimulationExample("ota");
    const closed = project.simulationFolders.find(
      (folder) => folder.id === "ota-closed",
    )!;
    const context = sourceCircuitContext(project, closed.input);
    expect(context.label).toContain("ota_5t (subcircuit)");
    expect(context.label).not.toContain("Testbench");
    expect(context.paths).toContain("testbench.spice");
    closed.input.files.find((file) => file.path === closed.input.entry)!.text =
      "Text only\nground 0\nmodel r resistor\nR1 (a 0) r r=1k\n";
    expect(sourceCircuitContext(project, closed.input).label).toBe(
      "Text circuit · no Canvas source",
    );
  });
  it("does not claim complete source knowledge when includes are broken", () => {
    const project = createSimulationExample("rc");
    const input = project.simulationFolders[0]!.input;
    input.files.find((file) => file.path === input.entry)!.text =
      'Broken\ninclude "missing.sim"\n';
    expect(sourceCircuitContext(project, input).uncertain).toBe(true);
  });
  it("shows a per-experiment parameter override", () => {
    const project = createSimulationExample("rlc");
    expect(
      sourceCircuitContext(project, project.simulationFolders[0]!.input)
        .overrides,
    ).toBe(true);
  });
  it("does not mistake comments or unreachable files for alterations", () => {
    const project = createSimulationExample("rc");
    const input = project.simulationFolders[0]!.input;
    input.files.find((file) => file.path === input.entry)!.text =
      'No alteration\n// alter instance("R1") r=2k\ninclude "circuit.spice"\n';
    input.files.push({
      path: "unused.sim",
      text: 'alter instance("R1") r=2k\n',
    });
    const context = sourceCircuitContext(project, input);
    expect(context.overrides).toBe(false);
    expect(context.documentIds.size).toBeGreaterThan(0);
    expect(context.paths).not.toContain("unused.sim");
  });
});
