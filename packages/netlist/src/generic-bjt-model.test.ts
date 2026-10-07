import { describe, expect, it } from "vitest";

import { createEmptyProject, createSimulationFolder } from "@icm/model";

import { createDesignNetlistExport, designExtractsNetlist } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

const NPN_CARD = ".model NPN NPN(IS=1e-16 BF=100 VAF=100)";
const PNP_CARD = ".model PNP PNP(IS=1e-16 BF=50 VAF=50)";

/** A Cell `dut` of transistors in parallel, each bound as a placed one is. */
function bjtProject(
  transistors: ReadonlyArray<{
    id: string;
    reference: string;
    symbolId?: "npn" | "pnp";
    model?: string;
  }>,
) {
  const project = createEmptyProject("bjts", "BJTs", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const transistor of transistors)
    document.instances.push({
      id: transistor.id,
      symbolId: transistor.symbolId ?? "npn",
      reference: transistor.reference,
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "bjt",
          name:
            transistor.model ?? (transistor.symbolId === "pnp" ? "PNP" : "NPN"),
        },
        parameters: { m: "1" },
      },
    });
  for (const [pinName, name] of [
    ["C", "collector"],
    ["B", "base"],
    ["E", "emitter"],
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

function spice(project: ReturnType<typeof bjtProject>) {
  const result = createDesignNetlistExport(project, { includeLocations: true });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const genericFindings = (result: ReturnType<typeof spice>) =>
  result.diagnostics.filter((item) => item.code === "GENERIC_BJT_MODEL");

describe("the generic bipolar models (#1420)", () => {
  it("defines NPN and PNP once in the Cell of placed transistors, and says so", () => {
    const project = bjtProject([
      { id: "q3", reference: "Q3", symbolId: "pnp" },
      { id: "q2", reference: "Q2" },
      { id: "q1", reference: "Q1" },
    ]);
    const result = spice(project);
    const text = result.file.text;
    expect(text).toContain("Q1 collector base emitter NPN m=1");
    expect(text).toContain("Q3 collector base emitter PNP m=1");
    for (const card of [NPN_CARD, PNP_CARD]) {
      expect(text.split(card)).toHaveLength(2);
      // Inside the Cell's body, ahead of the cards that use it.
      expect(text.indexOf(card)).toBeGreaterThan(text.indexOf(".subckt dut"));
      expect(text.indexOf(card)).toBeLessThan(text.indexOf("Q1 collector"));
    }
    expect(genericFindings(result)).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["q1", "q2", "q3"],
        message:
          "Q1 and Q2 use the generic bipolar model NPN (IS=1e-16, BF=100, VAF=100), Q3 uses the generic bipolar model PNP (IS=1e-16, BF=50, VAF=50); set a model for a real device",
      }),
    ]);
    // Information gates nothing: the Gallery still marks it a netlist.
    expect(designExtractsNetlist(project)).toBe(true);
    // The name stays the author's: naming another model there replaces it.
    expect(
      result.locations.fields.find(
        (field) => field.instanceId === "q1" && field.kind === "target",
      )?.rawValue,
    ).toBe("NPN");
  });

  it("leaves a transistor bound to any other model as it was", () => {
    const result = spice(
      bjtProject([{ id: "q1", reference: "Q1", model: "Q2N3904" }]),
    );
    expect(result.file.text).toContain("Q1 collector base emitter Q2N3904");
    expect(result.file.text).not.toContain(".model");
    expect(genericFindings(result)).toEqual([]);
  });

  it("leaves NPN to a model the run's own files or the imported SPICE define", () => {
    const project = bjtProject([{ id: "q1", reference: "Q1" }]);
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
      folder("tb", ".model NPN NPN(IS=2e-16 BF=200)"),
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
    expect(deck("tb")).toContain("Q1 collector base emitter NPN");
    expect(deck("tb")).not.toContain(".model");
    expect(deck("other")).toContain(NPN_CARD);
    expect(spice(project).file.text).toContain(NPN_CARD);
    project.source.files.push({
      id: "deck",
      path: "deck.cir",
      hash: "deck",
      content: {
        text: "Q1 collector base emitter NPN\n.MODEL npn npn(BF=80)\n",
        encoding: "utf-8",
      },
    });
    const imported = spice(project);
    expect(imported.file.text).not.toContain(".model");
    expect(genericFindings(imported)).toEqual([]);
  });

  it("prints the cards in SPICE only: Spectre still names NPN alone", () => {
    const result = createDesignNetlistExport(
      bjtProject([{ id: "q1", reference: "Q1" }]),
      { format: "spectre" },
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain("Q1 (collector base emitter) NPN");
    expect(result.file.text).not.toMatch(/^\s*model\b/mu);
    expect(
      result.diagnostics.filter((item) => item.code === "GENERIC_BJT_MODEL"),
    ).toEqual([]);
  });

  it("writes the same transistors for VACASK", () => {
    const ir = analyzeDesignNetlist(
      bjtProject([
        { id: "q1", reference: "Q1" },
        { id: "q2", reference: "Q2", symbolId: "pnp" },
      ]),
    ).ir!;
    const printed = printVacaskWithLocations(ir, false);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    expect(printed.text).toContain('load "spice/bjt.osdi"');
    expect(printed.text).toContain(
      "model NPN sp_bjt type=1 is=1e-16 bf=100 vaf=100",
    );
    expect(printed.text).toContain(
      "model PNP sp_bjt type=-1 is=1e-16 bf=50 vaf=50",
    );
    expect(printed.text).toContain("Q1 (collector base emitter) NPN");
    expect(printed.text).toContain("Q2 (collector base emitter) PNP");
  });
});
