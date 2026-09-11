import { describe, it, expect } from "vitest";
import {
  CircuitProjectSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import { createSimulationStarter } from "./simulation-starter.js";
import { generateCircuitSource } from "./simulation-circuit-source.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import { analyzeDesignNetlist } from "./extract.js";
import { listAuthoredCircuitScopes } from "./simulation-source-scopes.js";

const project = CircuitProjectSchema.parse({
  ...ota,
  schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  simulationSetups: [],
});
const options = {
  id: "experiment",
  name: "Experiment",
  profileId: "test",
  documentId: "document-ota-5t",
};
describe("simulation starting points", () => {
  it("preserves a drawn top-level circuit and allows text without any Canvas binding", () => {
    const drawn = createSimulationStarter(project, {
      ...options,
      mode: "circuit",
    });
    expect(drawn.ok && drawn.setup.input.circuitBindings[0]?.emission).toBe(
      "top-level",
    );
    expect(
      drawn.ok &&
        drawn.setup.input.files.some((f) => f.path === "testbench.spice"),
    ).toBe(false);
    const text = createSimulationStarter(project, { ...options, mode: "text" });
    expect(text.ok && text.setup.input.circuitBindings).toEqual([]);
    expect(
      text.ok && text.setup.input.files.find((f) => f.path === "run.cir")!.text,
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
    const binding = result.setup.input.circuitBindings[0]!;
    expect(binding.emission).toBe("subcircuit");
    expect(generateCircuitSource(project, binding).ok).toBe(true);
    const ir = analyzeDesignNetlist(project, {
      format: "spice",
      rootDocumentId: options.documentId,
    }).ir!;
    const scopes = listAuthoredCircuitScopes(
      inspectSimulationSourceGraph(result.setup.input),
      binding,
      ir,
    );
    expect(scopes).toEqual([{ bindingId: "circuit", callPath: ["XDUT"] }]);
    expect(JSON.stringify(project)).toBe(before);
  });
});
