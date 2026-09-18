import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

function copiedExternalMosProject() {
  const project = createEmptyProject("project", "Copied SKY130", "dut");
  const document = project.documents[0]!;
  const definitionId = "sky130-nfet";
  project.externalSubcircuitDefinitions.push({
    id: definitionId,
    name: "sky130_fd_pr__nfet_01v8",
    interfaceStatus: "declared",
    terminals: ["D", "G", "S", "B"].map((name) => ({
      id: `${definitionId}-${name}`,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [],
  });
  for (const [id, reference] of [
    ["original", "XM1"],
    ["copy", "X1"],
  ] as const) {
    document.instances.push({
      id,
      reference,
      symbolId: "nmos",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId },
        parameters: { l: "0.15", w: "1", nf: "1", m: "1" },
      },
    });
    document.noConnects.push(
      ...["D", "G", "S", "B"].map((pinName) => ({
        id: `${id}-${pinName}`,
        endpoint: { kind: "terminal" as const, instanceId: id, pinName },
      })),
    );
  }
  const folder = createSimulationFolder({
    id: "simulation",
    name: "Simulation",
    profileId: "sky130-test",
    engine: "ngspice",
    documentId: document.id,
  });
  return { project, folder };
}

function instanceCards(text: string): string[] {
  return text.split(/\r?\n/u).filter((line) => /^X(?:1|M1)\s/u.test(line));
}

describe("canonical design-netlist authority", () => {
  it("keeps copied external-subcircuit identity identical in direct export and simulation", () => {
    const { project, folder } = copiedExternalMosProject();
    const direct = createDesignNetlistExport(project, { format: "spice" });
    const simulation = compileNgspiceSourceSimulation(project, folder);

    expect(direct.status, JSON.stringify(direct.diagnostics)).toBe("ready");
    expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
    if (direct.status !== "ready" || !simulation.ok) return;

    const exportedCards = instanceCards(direct.file.text);
    const simulatedCards = instanceCards(simulation.generated[0]!.text);
    expect(exportedCards).toEqual(simulatedCards);
    expect(exportedCards).toHaveLength(2);
    expect(exportedCards[0]).toMatch(/^X1\s.+\ssky130_fd_pr__nfet_01v8\s/u);
    expect(exportedCards[1]).toMatch(/^XM1\s.+\ssky130_fd_pr__nfet_01v8\s/u);
    expect(direct.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "EXPORT_REFERENCE_CONFLICT" }),
    );
  });
});
