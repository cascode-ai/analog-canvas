import { describe, it, expect } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { createSimulationStarter } from "@icm/netlist";
import ota from "../../examples/five-transistor-ota-sky130.icproj.json";
import { sourceProbeChoices } from "./source-probe-choices";

const project = parseProject(JSON.stringify(ota));
describe("source Probe discovery", () => {
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
