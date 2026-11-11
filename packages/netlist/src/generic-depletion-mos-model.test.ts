import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";

const NMOS_DEP_CARD = ".model NMOS_DEP nmos level=54 vth0=-1";
const PMOS_DEP_CARD = ".model PMOS_DEP pmos level=54 vth0=1";

/** A Cell `dut` of depletion MOS in parallel, each bound as a placed one is. */
function depletionProject(
  transistors: ReadonlyArray<{
    id: string;
    symbolId: "depletion-nmos" | "depletion-pmos";
    model?: string;
  }>,
) {
  const project = createEmptyProject("depletion", "Depletion", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const transistor of transistors)
    document.instances.push({
      id: transistor.id,
      symbolId: transistor.symbolId,
      reference: transistor.id.toUpperCase(),
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "mos",
          name:
            transistor.model ??
            (transistor.symbolId === "depletion-pmos"
              ? "PMOS_DEP"
              : "NMOS_DEP"),
        },
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
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

function exported(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, { format });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const pair = () =>
  depletionProject([
    { id: "m2", symbolId: "depletion-pmos" },
    { id: "m1", symbolId: "depletion-nmos" },
  ]);

describe("the generic depletion MOS models", () => {
  it("exports a placed depletion MOS on NMOS_DEP or PMOS_DEP, carried once and said", () => {
    const result = exported(pair(), "spice");
    const text = result.file.text;
    expect(text).toContain("M1 drain gate source body NMOS_DEP");
    expect(text).toContain("M2 drain gate source body PMOS_DEP");
    for (const card of [NMOS_DEP_CARD, PMOS_DEP_CARD])
      expect(text.split(card)).toHaveLength(2);
    expect(
      result.diagnostics.filter(
        (item) => item.code === "GENERIC_DEPLETION_MOS_MODEL",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "info",
        objectIds: ["m1", "m2"],
        message:
          "M1 uses the generic depletion MOS model NMOS_DEP (BSIM4, level=54, vth0=-1), M2 uses the generic depletion MOS model PMOS_DEP (BSIM4, level=54, vth0=1); set a model for a real device",
      }),
    ]);
  });

  it("prints Spectre's BSIM4 with the moved threshold", () => {
    const text = exported(pair(), "spectre").file.text;
    expect(text).toContain("model NMOS_DEP bsim4 type=n vth0=-1");
    expect(text).toContain("model PMOS_DEP bsim4 type=p vth0=1");
  });

  it("leaves a depletion MOS bound to any other model, or to a Project's own NMOS_DEP, as it was", () => {
    const own = exported(
      depletionProject([
        { id: "m1", symbolId: "depletion-nmos", model: "my_dep" },
      ]),
      "spice",
    );
    expect(own.file.text).toContain("M1 drain gate source body my_dep");
    expect(own.file.text).not.toContain(".model");
    const project = depletionProject([
      { id: "m1", symbolId: "depletion-nmos" },
    ]);
    project.source.files.push({
      id: "deck",
      path: "deck.cir",
      hash: "deck",
      content: {
        text: "M1 d g s b NMOS_DEP\n.model NMOS_DEP nmos level=1 vto=-2\n",
        encoding: "utf-8",
      },
    });
    const replaced = exported(project, "spice");
    expect(replaced.file.text).not.toContain(".model");
    expect(
      replaced.diagnostics.filter(
        (item) => item.code === "GENERIC_DEPLETION_MOS_MODEL",
      ),
    ).toEqual([]);
  });
});
