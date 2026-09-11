import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import {
  createSimulationStarter,
  simulationSignalNames,
  simulationSignals,
} from "@icm/netlist";
import { resolveSimulationVoltageProbeNetId } from "./simulation-probe-options";
import ota from "../../examples/five-transistor-ota-sky130.icproj.json";
import { sourceProbeChoices } from "./source-probe-choices";

const project = parseProject(JSON.stringify(ota));
describe("source Probe discovery", () => {
  it("maps native vectors back to valid Canvas nets through the same naming traversal", () => {
    const input = project.simulationFolders[0]!.input;
    const signals = simulationSignals(project, input);
    expect(Object.keys(signals).length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(
        Object.entries(signals).map(([vector, signal]) => [
          vector,
          signal.label,
        ]),
      ),
    ).toEqual(simulationSignalNames(project, input));
    for (const signal of Object.values(signals))
      for (const target of signal.targets) {
        expect(
          resolveSimulationVoltageProbeNetId(project, {
            kind: "voltage",
            documentId: target.documentId,
            occurrence: target.occurrence,
            anchor: { kind: "base-net", netId: target.netId },
          }),
        ).toBeDefined();
      }
    expect(
      Object.values(signals).some((signal) =>
        signal.targets.some((target) => target.occurrence.length > 0),
      ),
    ).toBe(true);
  });
  it("addresses multiple DUT occurrences rather than silently choosing the first", () => {
    const result = createSimulationStarter(project, {
      id: "test",
      name: "Test",
      profileId: "test",
      documentId: "document-ota-5t",
      mode: "dut",
    });
    if (!result.ok) throw new Error(result.message);
    const input = result.folder.input;
    const tb = input.files.find((f) => f.path === "testbench.spice")!;
    tb.text +=
      "\n" +
      tb.text
        .split("\n")
        .find((line) => line.startsWith("XDUT "))!
        .replace("XDUT ", "XSECOND ");
    const choices = sourceProbeChoices(project, input);
    const names = simulationSignalNames(project, input);
    expect(Object.keys(names).every((name) => name.startsWith("v("))).toBe(
      true,
    );
    expect(Object.values(names).some((name) => name.includes("XDUT/"))).toBe(
      true,
    );
    const callNodes = tb.text
      .split("\n")
      .find((line) => line.startsWith("XDUT "))!
      .trim()
      .split(/\s+/u)
      .slice(1, -1);
    for (const node of callNodes)
      expect(names[`v(${node.toLowerCase()})`]).toBeDefined();
    expect(names["v(xdut.0)"]).toBeUndefined();
    expect(
      choices
        .filter((c) => c.kind === "voltage")
        .every((c) => c.expression.kind === "vector"),
    ).toBe(true);
    expect(
      choices.some((c) => c.kind === "voltage" && c.label.startsWith("XDUT ·")),
    ).toBe(true);
    expect(
      choices.some(
        (c) => c.kind === "current" && c.label.startsWith("XSECOND ·"),
      ),
    ).toBe(true);
  });
  it("offers native text-only nodes and voltage-source branch current", () => {
    const result = createSimulationStarter(project, {
      id: "test",
      name: "Test",
      profileId: "test",
      mode: "text",
    });
    if (!result.ok) throw new Error(result.message);
    result.folder.input.files.find((f) => f.path === "run.cir")!.text =
      "* raw\nVIN in 0 1\nR1 in out 1k\nC1 out 0 1n\n.end\n";
    expect(
      sourceProbeChoices(project, result.folder.input).map((c) => c.label),
    ).toEqual(expect.arrayContaining(["v(in)", "v(out)", "i(VIN)"]));
  });
});
