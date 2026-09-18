import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { ngspiceSimulationDevices } from "./simulation-ngspice-devices.js";

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

it("projects SPICE names without changing canvas names and reserves authored X names", () => {
  const { project, folder } = copiedExternalMosProject();
  const document = project.documents[0]!;
  document.instances[0]!.reference = "M1";
  document.instances[1]!.reference = "xm1";
  const before = structuredClone(project);
  const spice = createDesignNetlistExport(project, {
    format: "spice",
    includeLocations: true,
  });
  const spectre = createDesignNetlistExport(project, { format: "spectre" });
  const simulation = compileNgspiceSourceSimulation(project, folder);
  expect(spice.status, JSON.stringify(spice.diagnostics)).toBe("ready");
  expect(spectre.status).toBe("ready");
  expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
  if (spice.status !== "ready" || spectre.status !== "ready" || !simulation.ok)
    return;
  expect(spice.file.text).toMatch(/^XM1_2 .*sky130_fd_pr__nfet_01v8/mu);
  expect(spice.file.text).toMatch(/^xm1 .*sky130_fd_pr__nfet_01v8/mu);
  expect(spectre.file.text).toMatch(/^M1 \(/mu);
  expect(spectre.file.text).toMatch(/^xm1 \(/mu);
  const cards = (text: string) =>
    text.split("\n").filter((line) => /^xm1(?:_2)? /iu.test(line));
  expect(cards(simulation.generated[0]!.text)).toEqual(cards(spice.file.text));
  const field = spice.locations.fields.find(
    (f) => f.instanceId === "original" && f.kind === "reference",
  )!;
  expect(spice.file.text.slice(field.startOffset, field.endOffset)).toBe(
    "XM1_2",
  );
  expect(field.rawValue).toBe("XM1_2");
  const devices = ngspiceSimulationDevices(project, folder.input);
  expect(
    devices.find((device) => device.instanceId === "original")?.nativeDevice,
  ).toBe("m.xm1_2.msky130_fd_pr__nfet_01v8");
  expect(
    devices.find((device) => device.instanceId === "copy")?.nativeDevice,
  ).toBe("m.xm1.msky130_fd_pr__nfet_01v8");
  expect(project).toEqual(before);
});
