import { describe, expect, it } from "vitest";

import {
  createEmptyProject,
  type CircuitProject,
  type InductorCoupling,
} from "@icm/model";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

type Coupling = Omit<InductorCoupling, "id"> & { id?: string };

/**
 * Inductors in Cell `dut`, each between two of its own Cell Pins, coupled
 * as given.
 */
function coupledProject(
  inductors: readonly (readonly [id: string, symbolId: string])[],
  couplings: readonly Coupling[],
): CircuitProject {
  const project = createEmptyProject("coupled", "Coupled", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  for (const [id, symbolId] of inductors) {
    document.instances.push({
      id,
      symbolId,
      placement: null,
      reference: id,
      netlist: { parameters: { value: "1u" } },
    });
    const pins = symbolId === "variable-inductor" ? ["P1", "P2"] : ["1", "2"];
    for (const [index, pin] of pins.entries()) {
      const node = `${id.toLowerCase()}${index ? "b" : "a"}`;
      document.instances.push({ id: node, symbolId: "port", placement: null });
      document.nets.push({
        id: node,
        terminals: [
          { instanceId: id, pinName: pin },
          { instanceId: node, pinName: "P" },
        ],
      });
      document.netlist!.terminals.push({
        id: `terminal-${node}`,
        name: node,
        netId: node,
        direction: "inout",
        interfaceInstanceIds: [node],
      });
    }
  }
  document.inductorCouplings = couplings.map((coupling, index) => ({
    id: `coupling-${index + 1}`,
    ...coupling,
  }));
  return project;
}

function exported(project: CircuitProject, format: "spice" | "spectre") {
  const result = createDesignNetlistExport(project, { format });
  expect(
    result.diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  if (result.status !== "ready") throw new Error("export blocked");
  return result.file.text;
}

const pair = (dotPin = "1"): CircuitProject =>
  coupledProject(
    [
      ["L1", "inductor"],
      ["L2", "variable-inductor"],
    ],
    [
      {
        name: "TF1",
        members: [
          { instanceId: "L1", dotPin },
          { instanceId: "L2", dotPin: "P1" },
        ],
        k: "0.9",
      },
    ],
  );

describe("inductor couplings", () => {
  it("writes a K over the two inductors after the Cell's cards", () => {
    const text = exported(pair(), "spice");
    expect(text).toContain(
      [
        ".subckt dut l1a l1b l2a l2b",
        "L1 l1a l1b 1u",
        "L2 l2a l2b 1u",
        "KTF1 L1 L2 0.9",
        ".ends dut",
      ].join("\n"),
    );
    expect(exported(pair(), "spectre")).toContain(
      [
        "L1 (l1a l1b) inductor l=1u",
        "L2 (l2a l2b) inductor l=1u",
        "TF1 mutual_inductor coupling=0.9 ind1=L1 ind2=L2",
        "ends dut",
      ].join("\n"),
    );
  });

  it("starts each inductor's card at its dotted end", () => {
    const text = exported(pair("2"), "spice");
    expect(text).toContain("L1 l1b l1a 1u");
    expect(text).toContain("KTF1 L1 L2 0.9");
  });

  it("negates k for a coupling that dots an inductor's other end", () => {
    const project = coupledProject(
      [
        ["L1", "inductor"],
        ["L2", "inductor"],
        ["L3", "inductor-compact"],
      ],
      [
        {
          name: "K12",
          members: [
            { instanceId: "L1", dotPin: "1" },
            { instanceId: "L2", dotPin: "1" },
          ],
          k: "0.5",
        },
        {
          name: "TF2",
          members: [
            { instanceId: "L1", dotPin: "2" },
            { instanceId: "L3", dotPin: "1" },
          ],
          k: "{kx}",
        },
      ],
    );
    project.documents[0]!.netlist!.formalParameters = [
      { name: "kx", defaultValue: "0.3" },
    ];
    const text = exported(project, "spice");
    // The first coupling fixes L1's dot at pin 1; a name already starting
    // with K is kept as written.
    expect(text).toContain("L1 l1a l1b 1u");
    expect(text).toContain("K12 L1 L2 0.5");
    expect(text).toContain("KTF2 L1 L3 { -(kx) }");
    const spectre = exported(project, "spectre");
    expect(spectre).toContain(
      "TF2 mutual_inductor coupling=(-(kx)) ind1=L1 ind2=L3",
    );
  });

  it("keeps each coupling's printed name unique in its Cell", () => {
    const project = coupledProject(
      [
        ["L1", "inductor"],
        ["L2", "inductor"],
        ["L3", "inductor"],
      ],
      [
        {
          name: "TF1",
          members: [
            { instanceId: "L1", dotPin: "1" },
            { instanceId: "L2", dotPin: "1" },
          ],
          k: "0.5",
        },
        {
          name: "KTF1",
          members: [
            { instanceId: "L2", dotPin: "1" },
            { instanceId: "L3", dotPin: "1" },
          ],
          k: "0.6",
        },
      ],
    );
    const text = exported(project, "spice");
    expect(text).toContain("KTF1 L1 L2 0.5");
    expect(text).toContain("KTF1_2 L2 L3 0.6");
  });

  it("refuses a k beyond one and a member that is not an inductor", () => {
    const project = pair();
    project.documents[0]!.inductorCouplings![0]!.k = "1.5";
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("blocked");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "INDUCTOR_COUPLING_OUT_OF_RANGE",
    );
    const resistor = pair();
    resistor.documents[0]!.instances.find(
      (instance) => instance.id === "L2",
    )!.symbolId = "resistor";
    const refused = createDesignNetlistExport(resistor);
    expect(refused.diagnostics.map((item) => item.code)).toContain(
      "INDUCTOR_COUPLING_MEMBER_INVALID",
    );
  });

  it("writes native VACASK couplings as |k| with an inductor turned for a negative one", () => {
    const project = pair();
    project.documents[0]!.inductorCouplings![0]!.k = "-0.4";
    const analysis = analyzeDesignNetlist(project);
    const printed = printVacaskWithLocations(analysis.ir!);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    expect(printed.text).toContain("model __icm_mutual mutual");
    expect(printed.text).toMatch(/L1 \(l1a l1b\) /u);
    expect(printed.text).toMatch(/L2 \(l2b l2a\) /u);
    expect(printed.text).toContain(
      'KTF1 () __icm_mutual k=0.4 ind1="L1" ind2="L2"',
    );
  });
});
