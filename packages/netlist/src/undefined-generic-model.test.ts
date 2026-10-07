import { describe, expect, it } from "vitest";

import { createEmptyProject, createSimulationFolder } from "@icm/model";

import { createDesignNetlistExport, designExtractsNetlist } from "./export.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

/** A Cell `dut` of transistors in parallel, bound to the given targets. */
function mosProject(
  transistors: ReadonlyArray<{
    id: string;
    symbolId: "nmos" | "pmos";
    model: string;
  }>,
) {
  const project = createEmptyProject("mos", "MOS", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const transistor of transistors)
    document.instances.push({
      id: transistor.id,
      symbolId: transistor.symbolId,
      reference: transistor.id.toUpperCase(),
      placement: null,
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: transistor.model },
        parameters: { w: "1u", l: "150n" },
      },
    });
  for (const [pinName, name] of [
    ["D", "drain"],
    ["G", "gate"],
    ["S", "source"],
    ["B", "body"],
  ] as const) {
    document.nets.push({
      id: name,
      terminals: transistors.map((item) => ({ instanceId: item.id, pinName })),
    });
    document.connectivityEvidence.push({
      id: `${name}-name`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  return project;
}

const undefinedFindings = (
  diagnostics: ReadonlyArray<{ code: string; message: string }>,
) => diagnostics.filter((item) => item.code === "GENERIC_MODEL_UNDEFINED");

describe("a generic target the netlist does not define (#1420)", () => {
  it("says the SPICE netlist needs NMOS, PMOS and SW cards, as information", () => {
    const project = mosProject([
      { id: "m2", symbolId: "nmos", model: "NMOS" },
      { id: "m1", symbolId: "nmos", model: "NMOS" },
      // SPICE reads model names in any case.
      { id: "m3", symbolId: "pmos", model: "pmos" },
      { id: "m4", symbolId: "nmos", model: "nch_mac" },
    ]);
    // A voltage-controlled switch takes SW in every process.
    const document = project.documents[0]!;
    document.instances.push({
      id: "s1",
      symbolId: "voltage-controlled-switch",
      reference: "S1",
      placement: null,
      netlist: {
        binding: { kind: "model", deviceClass: "switch", name: "SW" },
        parameters: {},
      },
    });
    for (const [pinName, netId] of [
      ["P", "drain"],
      ["N", "source"],
      ["CP", "gate"],
      ["CN", "body"],
    ] as const)
      document.nets
        .find((net) => net.id === netId)!
        .terminals.push({ instanceId: "s1", pinName });
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // Nothing is invented: the netlist names the targets as before.
    expect(result.file.text).toContain("M1 drain gate source body NMOS");
    expect(result.file.text).not.toContain(".model");
    expect(undefinedFindings(result.diagnostics)).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["m1", "m2", "m3", "s1"],
        message:
          "M1 and M2 name NMOS, M3 names PMOS and S1 names SW, generic models the netlist does not define: add .model cards for NMOS, PMOS and SW to the simulation folder before simulating, or set a real model",
      }),
    ]);
    expect(designExtractsNetlist(project)).toBe(true);
    // Spectre netlists run against model includes: nothing to say there.
    const spectre = createDesignNetlistExport(project, { format: "spectre" });
    expect(undefinedFindings(spectre.diagnostics)).toEqual([]);
  });

  it("is quiet about a card the imported SPICE or the run's own files define", () => {
    const project = mosProject([
      { id: "m1", symbolId: "nmos", model: "NMOS" },
      { id: "m2", symbolId: "pmos", model: "PMOS" },
    ]);
    project.source.files.push({
      id: "deck",
      path: "deck.cir",
      hash: "deck",
      content: { text: ".MODEL nmos nmos(level=1)\n", encoding: "utf-8" },
    });
    expect(
      undefinedFindings(createDesignNetlistExport(project).diagnostics),
    ).toEqual([
      expect.objectContaining({
        message:
          "M2 names PMOS, a generic model the netlist does not define: add a .model PMOS card to the simulation folder before simulating, or set a real model",
      }),
    ]);
    const folder = (id: string, card?: string) => {
      const created = createSimulationFolder({
        id,
        name: id,
        profileId: "test",
        engine: "ngspice",
        documentId: "dut",
      });
      const run = created.input.files.find((file) => file.path === "run.cir")!;
      if (card) run.text = run.text.replace(".control", `${card}\n.control`);
      project.simulationFolders.push(created);
      const compiled = compileNgspiceSourceSimulation(project, created);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      return undefinedFindings(compiled.warnings);
    };
    expect(folder("tb", ".model PMOS PMOS(level=1)")).toEqual([]);
    expect(folder("other")).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/^M2 names PMOS/u),
      }),
    ]);
  });
});
