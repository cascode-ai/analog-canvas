import { describe, it, expect } from "vitest";
import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { createSimulationStarter } from "@icm/netlist";
import ota from "../../examples/five-transistor-ota-sky130.icproj.json";
import { sourceProbeChoices } from "./source-probe-choices";

const project = CircuitProjectSchema.parse({
  ...ota,
  schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  simulationSetups: [],
});
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
    const input = result.setup.input;
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
    result.setup.input.files.find((f) => f.path === "run.cir")!.text =
      "* raw\nVIN in 0 1\nR1 in out 1k\nC1 out 0 1n\n.end\n";
    expect(
      sourceProbeChoices(project, result.setup.input).map((c) => c.label),
    ).toEqual(expect.arrayContaining(["v(in)", "v(out)", "i(VIN)"]));
  });
});
