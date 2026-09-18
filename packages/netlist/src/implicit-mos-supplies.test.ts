import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  createSimulationFolder,
} from "@icm/model";
import { createDesignNetlistExport } from "./export.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

function pair(second: "nmos" | "pmos" = "nmos") {
  const project = createEmptyProject("implicit-body", "Implicit body", "leaf");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const [id, symbolId] of [
    ["M1", "nmos"],
    ["M2", second],
  ] as const)
    document.instances.push({
      id,
      reference: id,
      symbolId,
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "mos",
          name: symbolId.toUpperCase(),
        },
        parameters: { w: "1u", l: "150n" },
      },
    });
  for (const pinName of ["D", "G", "S"])
    document.nets.push({
      id: pinName,
      terminals: ["M1", "M2"].map((instanceId) => ({ instanceId, pinName })),
    });
  return project;
}

describe("implicit schematic MOS body supplies", () => {
  it.each(["spice", "spectre"] as const)(
    "exports an unpowered NMOS pair in %s without changing its drawing",
    (format) => {
      const project = pair();
      const before = structuredClone(project);
      const result = createDesignNetlistExport(project, { format });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.file.text).toContain(
        format === "spice" ? ".subckt dut VDD VSS\n" : "subckt dut (VDD VSS)\n",
      );
      expect(result.file.text).not.toMatch(/global/iu);
      for (const id of ["M1", "M2"])
        expect(result.file.text).toMatch(
          new RegExp(`${id} \\(?\\S+ \\S+ \\S+ VSS\\)? NMOS`),
        );
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      expect(project).toEqual(before);
    },
  );

  it("defaults a PMOS to VDD while keeping NoConnect and explicit body overrides", () => {
    const project = pair("pmos");
    let result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toMatch(/M2 \S+ \S+ \S+ VDD PMOS/u);
    project.documents[0]!.noConnects.push({
      id: "floating-body",
      endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
    });
    project.documents[0]!.nets.find((net) => net.id === "S")!.terminals.push({
      instanceId: "M2",
      pinName: "B",
    });
    result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toMatch(/M1 \S+ \S+ \S+ NC\d+ NMOS/u);
    expect(result.file.text).toMatch(/M2 \S+ \S+ (\S+) \1 PMOS/u);
  });

  it("also defaults legacy imported bodies without hiding missing signal pins", () => {
    const project = pair();
    project.documents[0]!.instances[0]!.importProvenance = {
      kind: "model",
      sourceMasterName: "NMOS",
      sourceTarget: "NMOS",
    };
    const result = createDesignNetlistExport(project);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    delete project.documents[0]!.instances[0]!.importProvenance;
    project.documents[0]!.nets = project.documents[0]!.nets.filter(
      (net) => net.id !== "G",
    );
    const missingGate = createDesignNetlistExport(project);
    expect(missingGate.status).toBe("blocked");
    expect(missingGate.diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("M1.G") }),
    );
  });

  it("propagates the default supply interface through callers and a flat simulation root", () => {
    const project = pair("pmos");
    for (const [id, child] of [
      ["parent", "leaf"],
      ["top", "parent"],
    ]) {
      const document = createEmptyDocument(id!, id!);
      document.instances.push({
        id: `X_${id}`,
        reference: `X_${id}`,
        symbolId: "cell-symbol",
        placement: null,
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: child! },
          parameters: {},
        },
      });
      project.documents.unshift(document);
    }
    project.topDocumentId = "top";
    const before = structuredClone(project);
    const result = createDesignNetlistExport(project);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("X_parent VDD VSS dut");
    expect(result.file.text).toContain("X_top VDD VSS parent");
    const folder = createSimulationFolder({
      id: "sim",
      name: "Simulation",
      profileId: "test",
      engine: "ngspice",
      documentId: "top",
    });
    const simulation = compileNgspiceSourceSimulation(project, folder);
    expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
    if (simulation.ok) {
      expect(simulation.generated[0]!.text).toContain("X_top VDD 0 parent");
      expect(simulation.generated[0]!.text).toContain("X_parent VDD VSS dut");
    }
    expect(project).toEqual(before);
  });
});

it("passes default ground to a child even when its VDD pin was already explicitly wired", () => {
  const project = pair();
  const leaf = project.documents[0]!;
  const top = createEmptyDocument("top", "top");
  for (const document of [leaf, top]) {
    document.instances.push({
      id: "power-pin",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "supply",
      terminals: [{ instanceId: "power-pin", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "supply-port",
      name: "VDD",
      netId: "supply",
      direction: "inout",
      interfaceInstanceIds: ["power-pin"],
    });
  }
  top.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: "cell-symbol",
    placement: null,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: leaf.id },
      parameters: {},
    },
  });
  top.nets[0]!.terminals.push({ instanceId: "X1", pinName: "VDD" });
  project.documents.unshift(top);
  project.topDocumentId = top.id;
  const folder = createSimulationFolder({
    id: "sim",
    name: "Simulation",
    profileId: "test",
    engine: "ngspice",
    documentId: top.id,
  });
  const result = compileNgspiceSourceSimulation(project, folder);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.generated[0]!.text).toContain("X1 VDD 0 dut");
});
