import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  ComponentDefinitionSchema,
  type CircuitProject,
} from "@icm/model";
import { executeProjectTransaction } from "./project-transaction.js";
import { prepareLegacyCircuitRepair } from "./legacy-circuit-repair.js";
function legacyDefinition() {
  return ComponentDefinitionSchema.parse({
    symbol: {
      schemaVersion: 1,
      id: "legacy",
      name: "Legacy",
      viewBox: { x: -40, y: -30, width: 80, height: 60 },
      pins: [
        {
          name: "IN",
          role: "input",
          at: { x: -40, y: 0 },
          direction: "west",
          presentation: { visibility: "visible" },
        },
        {
          name: "OUT",
          role: "output",
          at: { x: 40, y: 0 },
          direction: "east",
          presentation: { visibility: "visible" },
        },
      ],
      primitives: [{ kind: "circle", center: { x: 0, y: 0 }, radius: 20 }],
      variants: [],
    },
    subcircuit: {
      id: "legacy",
      symbolId: "legacy",
      target: "custom_block",
      ports: [
        { name: "VDD", supply: "VDD", direction: "inout" },
        { name: "VSS", supply: "VSS", direction: "inout" },
        { name: "IN", pinName: "IN", direction: "input" },
        { name: "OUT", pinName: "OUT", direction: "output" },
      ],
    },
  });
}

describe("legacy authoring candidates", () => {
  it("limits an explicit selected-instance capture to that instance while preserving a wired legacy peer", () => {
    const baseline = legacyDefinition();
    const project = createEmptyProject("selected-repair", "Selected repair");
    project.componentDefinitions = [baseline];
    for (const id of ["X1", "X2"])
      project.documents[0]!.instances.push({
        id,
        reference: id,
        symbolId: baseline.symbol.id,
        placement: null,
        netlist: {
          parameters: {},
          binding: { kind: "unresolved-subcircuit", name: "custom_block" },
        },
      });
    project.documents[0]!.noConnects.push({
      id: "peer-in",
      endpoint: { kind: "terminal", instanceId: "X2", pinName: "IN" },
    });
    const repair = prepareLegacyCircuitRepair(project, baseline, "selected");
    const candidate = structuredClone(
      repair.project.componentDefinitions!.find(
        (definition) => definition.symbol.id === repair.symbolId,
      )!,
    );
    candidate.symbol.pins = candidate.symbol.pins.filter(
      (pin) => pin.name !== "IN",
    );
    candidate.circuitBinding!.terminals =
      candidate.circuitBinding!.terminals.filter(
        (mapping) => !("pinName" in mapping) || mapping.pinName !== "IN",
      );
    const applied = prepareLegacyCircuitRepair(project, baseline, "selected", {
      selected: { documentId: project.topDocumentId, instanceId: "X1" },
      implementation: {
        kind: "apply_model_source",
        source: {
          id: "native",
          language: "spice",
          revision: 0,
          entry: "model.spice",
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt custom_block VDD VSS OUT\nR1 OUT VSS 1k\n.ends custom_block\n",
            },
          ],
        },
        definitions: [
          {
            definitionId: repair.definitionId,
            entry: "custom_block",
            symbol: candidate,
            portMap: { IN: null },
          },
        ],
      },
    });
    expect(
      applied.project.documents[0]!.instances[0]!.netlist!.binding!.kind,
    ).toBe("external-subcircuit");
    expect(applied.project.documents[0]!.instances[1]).toEqual(
      project.documents[0]!.instances[1],
    );
    expect(applied.project.documents[0]!.noConnects).toEqual(
      project.documents[0]!.noConnects,
    );
  });
  it("requires explicit disconnection of a removed legacy terminal and clears its No Connect atomically", () => {
    const baseline = legacyDefinition();
    const project = createEmptyProject(
      "legacy-disconnect",
      "Legacy disconnect",
    );
    project.componentDefinitions = [baseline];
    project.documents[0]!.instances.push({
      id: "X1",
      symbolId: baseline.symbol.id,
      reference: "X1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: {},
        binding: { kind: "unresolved-subcircuit", name: "custom_block" },
      },
    });
    project.documents[0]!.noConnects.push({
      id: "nc-in",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "IN" },
    });
    const repair = prepareLegacyCircuitRepair(project, baseline, "disconnect");
    const candidate = structuredClone(
      repair.project.componentDefinitions!.find(
        (d) => d.symbol.id === repair.symbolId,
      )!,
    );
    candidate.symbol.pins = candidate.symbol.pins.filter(
      (pin) => pin.name !== "IN",
    );
    candidate.circuitBinding!.terminals =
      candidate.circuitBinding!.terminals.filter(
        (mapping) => !("pinName" in mapping) || mapping.pinName !== "IN",
      );
    const implementation = {
      kind: "apply_model_source" as const,
      source: {
        id: "repair-source",
        revision: 0,
        language: "spice" as const,
        entry: "model.spice",
        files: [
          {
            path: "model.spice",
            text: ".subckt custom_block VDD VSS OUT\nR1 OUT VSS 1k\n.ends custom_block\n",
          },
        ],
        dependencies: [],
      },
      definitions: [
        {
          definitionId: repair.definitionId,
          entry: "custom_block",
          symbol: candidate,
          portMap: { IN: null },
        },
      ],
    };
    expect(() =>
      prepareLegacyCircuitRepair(project, baseline, "disconnect", {
        implementation,
      }),
    ).toThrow("Connected legacy port IN");
    const applied = prepareLegacyCircuitRepair(
      project,
      baseline,
      "disconnect",
      { implementation, disconnectPorts: ["IN"] },
    );
    expect(applied.project.documents[0]!.noConnects).toEqual([]);
    expect(
      applied.project.documents[0]!.instances[0]!.netlist!.binding!.kind,
    ).toBe("external-subcircuit");
    expect(project.documents[0]!.noConnects).toHaveLength(1);
  });
  it("uses the captured baseline for concurrency while applying a four-to-six terminal candidate", () => {
    const baseline = legacyDefinition();
    const project = createEmptyProject("legacy-author", "Legacy author");
    project.componentDefinitions = [baseline];
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: baseline.symbol.id,
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        parameters: { gain: "17" },
        binding: {
          kind: "unresolved-subcircuit",
          name: baseline.subcircuit!.target,
        },
      },
    });
    const model = executeProjectTransaction(
      createEmptyProject("models", "Models"),
      {
        projectId: "models",
        expectedStructureRevision: 0,
        transactionId: "model",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "source",
              language: "spice",
              revision: 0,
              entry: "model.spice",
              dependencies: [],
              files: [
                {
                  path: "model.spice",
                  text: ".subckt amp INP INN REF OUT VDD VSS params: gain=20\nE1 OUT REF INP INN {gain}\n.ends amp\n",
                },
              ],
            },
            definitions: [{ definitionId: "amp", entry: "amp" }],
          },
        ],
      },
    );
    if (!model.ok) throw Error(model.error.message);
    const candidate = structuredClone(baseline);
    candidate.symbol.name = "Repaired amplifier";
    for (const [index, name] of ["INN", "REF"].entries()) {
      candidate.symbol.pins.push({
        name,
        role: "input",
        at: { x: -40, y: 10 + index * 10 },
        direction: "west",
        presentation: { visibility: "visible" },
      });
      candidate.subcircuit!.ports.push({
        name,
        pinName: name,
        direction: "input",
      });
    }
    const owner = model.project.externalSubcircuitDefinitions[0]!;
    const names: Record<string, string> = {
      VDD: "VDD",
      VSS: "VSS",
      IN: "INP",
      OUT: "OUT",
      INN: "INN",
      REF: "REF",
    };
    const symbol = {
      symbol: { ...candidate.symbol, id: "candidate-artwork" },
      circuitBinding: {
        definitionId: owner.id,
        terminals: candidate.subcircuit!.ports.map((port) => ({
          terminalId: owner.terminals.find((t) => t.name === names[port.name])!
            .id,
          ...("pinName" in port
            ? { pinName: port.pinName }
            : { supply: port.supply }),
        })),
      },
    };
    const implementation = {
      kind: "apply_model_source" as const,
      source: model.project.modelSources![0]!,
      definitions: [{ definitionId: owner.id, entry: owner.name, symbol }],
    };
    const repaired = prepareLegacyCircuitRepair(
      project,
      baseline,
      "candidate",
      { implementation },
    );
    const instance = repaired.project.documents[0]!.instances[0]!;
    expect(instance.netlist).toMatchObject({
      binding: {
        kind: "external-subcircuit",
        definitionId: repaired.definitionId,
      },
      parameters: { gain: "17" },
    });
    const captured = repaired.project.componentDefinitions!.find(
      (d) => d.symbol.id === repaired.symbolId,
    )!;
    expect(captured.symbol.name).toBe("Repaired amplifier");
    expect(captured.circuitBinding!.terminals).toHaveLength(6);
    expect(project.componentDefinitions).toEqual([baseline]);
    const stale = structuredClone(project) as CircuitProject;
    stale.componentDefinitions![0]!.symbol.name = "Concurrent change";
    expect(() =>
      prepareLegacyCircuitRepair(stale, baseline, "candidate", {
        implementation,
      }),
    ).toThrow("captured component changed");
  });
});
