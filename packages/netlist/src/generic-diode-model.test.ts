import { describe, expect, it } from "vitest";

import { createEmptyProject, createSimulationFolder } from "@icm/model";

import { createDesignNetlistExport, designExtractsNetlist } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

const CARD = ".model DIODE D(IS=1e-14 N=1)";

/** A Cell `dut` of diodes in parallel, each bound as a placed one is. */
function diodeProject(
  diodes: ReadonlyArray<{
    id: string;
    reference: string;
    symbolId?: "diode" | "zener-diode";
    model?: string;
  }>,
) {
  const project = createEmptyProject("diodes", "Diodes", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const diode of diodes)
    document.instances.push({
      id: diode.id,
      symbolId: diode.symbolId ?? "diode",
      reference: diode.reference,
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "diode",
          name: diode.model ?? "DIODE",
        },
        parameters: {},
      },
    });
  for (const [pinName, name] of [
    ["A", "anode"],
    ["K", "cathode"],
  ] as const) {
    document.nets.push({
      id: name,
      terminals: diodes.map((diode) => ({ instanceId: diode.id, pinName })),
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

function spice(project: ReturnType<typeof diodeProject>) {
  const result = createDesignNetlistExport(project, { includeLocations: true });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const genericFindings = (result: ReturnType<typeof spice>) =>
  result.diagnostics.filter((item) => item.code === "GENERIC_DIODE_MODEL");

describe("the generic diode model (#1310)", () => {
  it("defines DIODE once in the Cell of a placed diode, and says so", () => {
    const project = diodeProject([{ id: "d1", reference: "D1" }]);
    const result = spice(project);
    const text = result.file.text;
    expect(text).toContain("D1 anode cathode DIODE");
    expect(text.split(CARD)).toHaveLength(2);
    // Inside the Cell's body, ahead of the card that uses it.
    expect(text.indexOf(CARD)).toBeGreaterThan(text.indexOf(".subckt dut"));
    expect(text.indexOf(CARD)).toBeLessThan(text.indexOf("D1 anode"));
    expect(genericFindings(result)).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["d1"],
        message:
          "D1 uses the generic diode model DIODE (IS=1e-14, N=1); set a model for a real device",
      }),
    ]);
    // Information gates nothing: the Gallery still marks it a netlist.
    expect(designExtractsNetlist(project)).toBe(true);
    // The name stays the author's: naming another model there replaces it.
    expect(
      result.locations.fields.find(
        (field) => field.instanceId === "d1" && field.kind === "target",
      )?.rawValue,
    ).toBe("DIODE");
  });

  it("gives every diode on the name one shared card, a Zener's too", () => {
    const result = spice(
      diodeProject([
        { id: "d2", reference: "D2", symbolId: "zener-diode" },
        { id: "d1", reference: "D1" },
      ]),
    );
    expect(result.file.text.split(CARD)).toHaveLength(2);
    expect(genericFindings(result).map((item) => item.message)).toEqual([
      "D1 and D2 use the generic diode model DIODE (IS=1e-14, N=1); set a model for a real device. It has no breakdown, so D2 does not act as a Zener until given a Zener model",
    ]);
  });

  it("leaves a diode bound to any other model as it was", () => {
    const result = spice(
      diodeProject([{ id: "d1", reference: "D1", model: "D1N4148" }]),
    );
    expect(result.file.text).toContain("D1 anode cathode D1N4148");
    expect(result.file.text).not.toContain(".model");
    expect(genericFindings(result)).toEqual([]);
  });

  it("leaves DIODE to a model the run's own files define", () => {
    // The testbench's model is its run's: that deck carries no card, which
    // inside the Cell would shadow it. A second folder's run, and the design
    // export, still need the card; without it they stopped on the missing
    // model, as every run did before the card existed.
    const project = diodeProject([{ id: "d1", reference: "D1" }]);
    const folder = (id: string, model?: string) => {
      const created = createSimulationFolder({
        id,
        name: id,
        profileId: "test",
        engine: "ngspice",
        documentId: "dut",
      });
      const run = created.input.files.find((file) => file.path === "run.cir")!;
      if (model) run.text = run.text.replace(".control", `${model}\n.control`);
      return created;
    };
    project.simulationFolders.push(
      folder("tb", ".model DIODE D(IS=1e-14 N=1 RS=10m)"),
      folder("other"),
    );
    const deck = (id: string) => {
      const compiled = compileNgspiceSourceSimulation(
        project,
        project.simulationFolders.find((item) => item.id === id)!,
      );
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      return compiled.generated[0]!.text;
    };
    expect(deck("tb")).toContain("D1 anode cathode DIODE");
    expect(deck("tb")).not.toContain(".model");
    expect(deck("other")).toContain(CARD);
    const exported = spice(project);
    expect(exported.file.text).toContain(CARD);
    expect(genericFindings(exported)).toHaveLength(1);
  });

  it("keeps a DIODE model the SPICE it was imported from defines", () => {
    const fromImport = diodeProject([{ id: "d1", reference: "D1" }]);
    fromImport.source.files.push({
      id: "deck",
      path: "deck.cir",
      hash: "deck",
      content: {
        text: "D1 anode cathode DIODE\n.MODEL diode d\n",
        encoding: "utf-8",
      },
    });
    const result = spice(fromImport);
    expect(result.file.text).toContain("D1 anode cathode DIODE");
    expect(result.file.text).not.toContain(".model");
    expect(genericFindings(result)).toEqual([]);
    // A comment, or another name that starts the same, defines nothing.
    fromImport.source.files[0]!.content!.text =
      "* .model DIODE D(IS=2e-14)\n.model DIODE_FAST D(IS=2e-14)\n";
    expect(spice(fromImport).file.text).toContain(CARD);
  });

  it("prints the card in SPICE only: Spectre still names DIODE alone", () => {
    const result = createDesignNetlistExport(
      diodeProject([{ id: "d1", reference: "D1" }]),
      { format: "spectre" },
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("D1 (anode cathode) DIODE");
    expect(result.file.text).not.toMatch(/^\s*model\b/mu);
    expect(
      result.diagnostics.filter((item) => item.code === "GENERIC_DIODE_MODEL"),
    ).toEqual([]);
  });

  it("writes the same diode for VACASK", () => {
    const ir = analyzeDesignNetlist(
      diodeProject([{ id: "d1", reference: "D1" }]),
    ).ir!;
    const printed = printVacaskWithLocations(ir, false);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    expect(printed.text).toContain('load "spice/diode.osdi"');
    expect(printed.text).toContain("model DIODE sp_diode is=1e-14 n=1");
    expect(printed.text).toContain("D1 (anode cathode) DIODE");
  });
});
