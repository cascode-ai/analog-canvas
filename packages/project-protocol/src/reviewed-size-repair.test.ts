import { createEmptyProject, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { describe, expect, it } from "vitest";

import { tryParseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";

/**
 * From #1194 until #1484 a DMOS placed in a SKY130 circuit took the 16 V
 * device at the catalog's W 1 µm / L 0.15 µm, a size SKY130 has no model for:
 * no simulator could run it. These are the parts that left behind, beside
 * ones whose sizes SKY130 does model or an expression leaves open.
 */
function projectWithSixteenVoltParts(): CircuitProject {
  const project = createEmptyProject("dmos", "DMOS");
  for (const [id, name] of [
    ["n16", "sky130_fd_pr__nfet_g5v0d16v0"],
    ["p16", "sky130_fd_pr__pfet_g5v0d16v0"],
  ] as const)
    project.externalSubcircuitDefinitions.push({
      id,
      name,
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((pin) => ({
        id: `${id}-${pin}`,
        name: pin,
        direction: "passive" as const,
      })),
      formalParameters: [],
    });
  const part = (
    id: string,
    symbolId: "ndmos" | "pdmos",
    definitionId: string,
    parameters: Record<string, string>,
  ) => ({
    id,
    reference: id,
    symbolId,
    placement: null,
    netlist: {
      binding: { kind: "external-subcircuit" as const, definitionId },
      parameters,
    },
  });
  project.documents[0]!.instances.push(
    part("M1", "ndmos", "n16", { w: "1u", l: "150n", nf: "1", m: "1" }),
    part("M2", "pdmos", "p16", { w: "1u", l: "150n", nf: "1", m: "2" }),
    part("M3", "ndmos", "n16", { w: "20u", l: "1u", nf: "1", m: "1" }),
    part("M4", "ndmos", "n16", { w: "20u", l: "2.2u", nf: "1", m: "1" }),
    part("M5", "ndmos", "n16", { w: "{wd}", l: "700n", nf: "1", m: "1" }),
  );
  return project;
}

function open(project: CircuitProject): CircuitProject {
  const opened = tryParseProjectWithMetadata(serializeProject(project));
  if (!opened.ok)
    throw new Error(opened.diagnostics.map((item) => item.message).join("; "));
  return opened.project;
}

describe("a 16 V part at a size SKY130 does not model, on file open (#1485)", () => {
  it("opens at a size SKY130 models, changing as little as it can and leaving modelled and open ones alone", () => {
    const project = open(projectWithSixteenVoltParts());
    const size = (id: string) => {
      const { w, l, m } = project.documents[0]!.instances.find(
        (item) => item.id === id,
      )!.netlist!.parameters;
      return `${w} ${l} ${m}`;
    };
    expect(size("M1")).toBe("5u 700n 1");
    expect(size("M2")).toBe("5u 660n 2");
    // W 20 µm is a 16 V width at L 0.7 µm, so only L changes.
    expect(size("M3")).toBe("20u 700n 1");
    expect(size("M4")).toBe("20u 2.2u 1");
    expect(size("M5")).toBe("{wd} 700n 1");
    // The repaired lines carry no size SKY130 lacks.
    const exported = createDesignNetlistExport(project);
    expect(
      exported.diagnostics.filter(
        (diagnostic) => diagnostic.code === "REVIEWED_SIZE_UNMODELLED",
      ),
    ).toEqual([]);
    // A repaired file opens unchanged.
    expect(serializeProject(open(project))).toBe(serializeProject(project));
  });
});
