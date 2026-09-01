import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { hierarchicalSymbolId } from "@icm/symbols";

import { evaluateSimulatability } from "./simulatability.js";

/** A Sky130 MOS: the shape the reference OTA netlist instantiates six times. */
function mos(
  id: string,
  reference: string,
  name = "sky130_fd_pr__nfet_01v8",
): SchematicDocument["instances"][number] {
  return {
    id,
    symbolId: "nmos",
    placement: null,
    reference,
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name },
      parameters: { w: "96", l: "1.0" },
    },
  };
}

function subcircuitCall(
  id: string,
  reference: string,
  childDocumentId: string,
): SchematicDocument["instances"][number] {
  return {
    id,
    symbolId: hierarchicalSymbolId("Stage"),
    placement: null,
    reference,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId },
      parameters: {},
    },
  };
}

function projectWithChild(child: SchematicDocument): CircuitProject {
  const project = createEmptyProject("project", "Project");
  project.documents.push(child);
  return project;
}

describe("simulatability", () => {
  it("accepts a flat all-transistor circuit", () => {
    const project = createEmptyProject("project", "Project");
    const top = project.documents[0]!;
    top.instances.push(
      mos("m1", "M1"),
      mos("m2", "M2"),
      mos("m3", "M3", "sky130_fd_pr__pfet_01v8"),
    );

    expect(evaluateSimulatability(project)).toEqual({
      simulatable: true,
      blockers: [],
    });
  });

  // The ADR's recursive rule, in the owner's words: a subcircuit whose
  // contents are transistors is simulatable, and so is one nested inside
  // another.
  it("accepts hierarchy whose leaves are all transistors", () => {
    const leaf = createEmptyDocument("leaf", "Leaf");
    leaf.instances.push(mos("m1", "M1"), mos("m2", "M2"));
    const middle = createEmptyDocument("middle", "Middle");
    middle.instances.push(subcircuitCall("x1", "X1", leaf.id));
    const project = projectWithChild(leaf);
    project.documents.push(middle);
    project.documents[0]!.instances.push(subcircuitCall("x9", "X9", middle.id));

    expect(evaluateSimulatability(project)).toEqual({
      simulatable: true,
      blockers: [],
    });
  });

  // Ground and VDD markers are not devices and must not be mistaken for
  // abstract blocks, or every real circuit would be refused.
  it("ignores net markers and formal Cell Pins", () => {
    const project = createEmptyProject("project", "Project");
    const top = project.documents[0]!;
    top.netlist!.terminals.push({
      id: "terminal-out",
      name: "VOUT",
      netId: "net-out",
      direction: "output",
      interfaceInstanceIds: ["p1"],
    });
    top.instances.push(
      mos("m1", "M1"),
      { id: "gnd", symbolId: "ground", placement: null },
      { id: "vdd", symbolId: "vdd-port", placement: null },
      { id: "p1", symbolId: "port", placement: null },
    );

    expect(evaluateSimulatability(project).simulatable).toBe(true);
  });

  // The shape the owner's own benchmark actually imports as. A Sky130 device
  // is not a SPICE `M` primitive: `XM1 ... sky130_fd_pr__nfet_01v8` is an X
  // call to a master the PDK model library defines, so the importer binds it
  // as an external subcircuit. Refusing those would refuse the five-transistor
  // OTA the ADR names as the acceptance circuit.
  it("accepts PDK devices bound as external subcircuit calls", () => {
    const project = createEmptyProject("project", "Project");
    project.externalSubcircuitDefinitions.push({
      id: "external-nfet",
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    project.documents[0]!.instances.push({
      id: "XM1",
      symbolId: "nmos",
      placement: null,
      reference: "XM1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-nfet" },
        parameters: { w: "96", l: "1.0" },
      },
    });

    expect(evaluateSimulatability(project).simulatable).toBe(true);
  });

  it("refuses a signal-flow block and names it", () => {
    const project = createEmptyProject("project", "Project");
    const top = project.documents[0]!;
    top.instances.push(mos("m1", "M1"), {
      id: "sum",
      symbolId: "adder",
      placement: null,
      reference: "A1",
    });

    const verdict = evaluateSimulatability(project);
    expect(verdict.simulatable).toBe(false);
    expect(verdict.blockers).toEqual([
      expect.objectContaining({
        instanceId: "sum",
        symbolId: "adder",
        reason: "abstract-block",
        documentId: "document-main",
      }),
    ]);
  });

  // A refusal that names only the first offender sends the person back for a
  // second refusal. Every blocker is reported at once.
  it("names every blocking instance, not just the first", () => {
    const project = createEmptyProject("project", "Project");
    const top = project.documents[0]!;
    top.instances.push(
      { id: "sum", symbolId: "adder", placement: null, reference: "A1" },
      mos("m1", "M1"),
      { id: "amp", symbolId: "opamp", placement: null, reference: "U1" },
      {
        id: "sw",
        symbolId: "ideal-switch",
        placement: null,
        reference: "S1",
        netlist: { parameters: {} },
      },
      {
        id: "m9",
        symbolId: "pmos",
        placement: null,
        reference: "M9",
        netlist: { parameters: {} },
      },
    );

    const verdict = evaluateSimulatability(project);
    expect(verdict.simulatable).toBe(false);
    // Ordered by the designator on the sheet, not by internal id, so the list
    // reads in the order someone would hunt the parts down.
    expect(
      verdict.blockers.map((blocker) => [blocker.reference, blocker.reason]),
    ).toEqual([
      ["A1", "abstract-block"],
      ["M9", "missing-device-model"],
      ["S1", "not-simulatable-device"],
      ["U1", "abstract-block"],
    ]);
  });

  // A block buried in a child cell is still the thing to fix, so the verdict
  // has to say which cell it is in and how to reach it.
  it("names a blocker inside a child cell with the path to it", () => {
    const leaf = createEmptyDocument("leaf", "Leaf");
    leaf.instances.push(mos("m1", "M1"), {
      id: "q",
      symbolId: "quantizer",
      placement: null,
      reference: "Q1",
    });
    const project = projectWithChild(leaf);
    project.documents[0]!.instances.push(subcircuitCall("x1", "X1", leaf.id));

    const verdict = evaluateSimulatability(project);
    expect(verdict.simulatable).toBe(false);
    expect(verdict.blockers).toEqual([
      expect.objectContaining({
        instanceId: "q",
        documentId: "leaf",
        reason: "abstract-block",
        hierarchyPath: ["x1"],
      }),
    ]);
  });

  it("reports a subcircuit call whose cell is missing", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push(
      subcircuitCall("x1", "X1", "no-such-cell"),
    );

    const verdict = evaluateSimulatability(project);
    expect(verdict.simulatable).toBe(false);
    expect(verdict.blockers[0]).toEqual(
      expect.objectContaining({
        instanceId: "x1",
        reason: "missing-subcircuit",
      }),
    );
  });

  // A cycle must end the walk with a diagnosis rather than run forever.
  it("reports a hierarchy cycle instead of recursing without end", () => {
    const child = createEmptyDocument("child", "Child");
    const project = projectWithChild(child);
    project.documents[0]!.instances.push(subcircuitCall("x1", "X1", child.id));
    child.instances.push(subcircuitCall("x2", "X2", project.documents[0]!.id));

    const verdict = evaluateSimulatability(project);
    expect(verdict.simulatable).toBe(false);
    expect(verdict.blockers.map((blocker) => blocker.reason)).toContain(
      "hierarchy-cycle",
    );
  });

  // The same child cell used twice is one thing to fix, not two.
  it("reports one blocker per offending instance however often its cell is used", () => {
    const leaf = createEmptyDocument("leaf", "Leaf");
    leaf.instances.push({
      id: "q",
      symbolId: "quantizer",
      placement: null,
      reference: "Q1",
    });
    const project = projectWithChild(leaf);
    project.documents[0]!.instances.push(
      subcircuitCall("x1", "X1", leaf.id),
      subcircuitCall("x2", "X2", leaf.id),
    );

    expect(evaluateSimulatability(project).blockers).toHaveLength(1);
  });

  it("never mutates the Project it reads", () => {
    const leaf = createEmptyDocument("leaf", "Leaf");
    leaf.instances.push(mos("m1", "M1"), {
      id: "sum",
      symbolId: "adder",
      placement: null,
      reference: "A1",
    });
    const project = projectWithChild(leaf);
    project.documents[0]!.instances.push(subcircuitCall("x1", "X1", leaf.id));
    const before = structuredClone(project);

    evaluateSimulatability(project);

    expect(project).toEqual(before);
  });
});
