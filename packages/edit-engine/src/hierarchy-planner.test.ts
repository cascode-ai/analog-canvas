import { canonicalPortTextDocument, createRoutePath } from "@icm/model";
import {
  builtInModelDefaults,
  deviceDescriptor,
  subcircuitDescriptor,
} from "@icm/devices";
import { describe, expect, it } from "vitest";
import {
  analyzeDesignNetlist,
  createDesignNetlistExport,
  printVacaskWithLocations,
} from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import type { Annotation, RichTextDocument } from "@icm/model";
import {
  createHierarchicalBlockSymbol,
  createProjectHierarchicalSymbols,
  hierarchicalSymbolId,
} from "@icm/symbols";

import {
  createExternalSubcircuitInstance,
  createHierarchyInstance,
  planDeleteCell,
  planPlaceCellInstance,
  planRenameCell,
  planSetCellSymbolPins,
  planSetCellSymbolPresentation,
  planSetCellSymbolSize,
} from "./hierarchy-planner.js";
import {
  planCreateCellPin,
  planReorderCellPort,
  planReorderCellTerminal,
  planSetVddConnectionMode,
  planUpdateCellPortDirection,
} from "./cell-pin-planner.js";
import {
  planFormatCellTerminalAnnotations,
  planRemoveCellTerminal,
  planRenameCellTerminal,
} from "./cell-interface-change-planner.js";
import {
  gateCellTargets,
  gateExternalTargets,
  planSetDeviceModelTarget,
} from "./device-model-target-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import { planProjectCellImport } from "./project-cell-import.js";

describe("a Var Cap is a generic tunable capacitor (#1298)", () => {
  function varCapProject() {
    const project = createEmptyProject("varactor", "Varactor");
    const document = project.documents[0]!;
    document.instances.push({
      id: "CV1",
      reference: "CV1",
      symbolId: "variable-capacitor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "500f" },
      },
    });
    document.nets.push(
      { id: "net-tune", terminals: [{ instanceId: "CV1", pinName: "P1" }] },
      { id: "net-ground", terminals: [{ instanceId: "CV1", pinName: "P2" }] },
    );
    return project;
  }

  it("refuses the SKY130 varactor and says which part takes it", () => {
    const project = varCapProject();
    expect(() =>
      planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "CV1",
        "sky130_fd_pr__cap_var_lvt",
      ),
    ).toThrow(
      "sky130_fd_pr__cap_var_lvt is not compatible with the selected variable-capacitor: it is a capacitor model. Place a capacitor to use it.",
    );
  });

  it("clears the varactor from a Var Cap bound before #1298 and keeps it a Var Cap", () => {
    // The state #1272 left: bound, wired at P1/P2, substrate set to a Net.
    const project = varCapProject();
    project.externalSubcircuitDefinitions.push({
      id: "external-varactor",
      name: "sky130_fd_pr__cap_var_lvt",
      terminals: ["C0", "C1", "B"].map((name, index) => ({
        id: `external-varactor-${index}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
    const document = project.documents[0]!;
    document.instances[0]!.netlist = {
      binding: {
        kind: "external-subcircuit",
        definitionId: "external-varactor",
      },
      parameters: { w: "5u", l: "500n", vm: "1" },
    };
    document.nets[1]!.terminals.push({ instanceId: "CV1", pinName: "B" });

    const cleared = executeProjectTransaction(project, {
      transactionId: "clear-varactor",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "CV1",
        "",
      ),
    });

    if (!cleared.ok) throw new Error(cleared.error.message);
    const repaired = cleared.project.documents[0]!;
    expect(repaired.instances[0]).toMatchObject({
      symbolId: "variable-capacitor",
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: {},
      },
    });
    expect(repaired.nets.map((net) => net.terminals)).toEqual([
      [{ instanceId: "CV1", pinName: "P1" }],
      [{ instanceId: "CV1", pinName: "P2" }],
    ]);
  });
});

describe("a model's substrate pin takes the Cell's substrate default (#1619)", () => {
  /** R1 between `a` and `b` in a Cell whose ground is the Net `gnd`. */
  function groundedResistor() {
    const project = createEmptyProject("poly", "Poly");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    document.nets.push(
      { id: "net-a", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "net-b", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    return run(project, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          { kind: "create_base_net", netId: "gnd" },
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              id: "gnd-label",
              kind: "net-label",
              netId: "gnd",
              binding: { kind: "net-name", netId: "gnd" },
              visible: false,
              anchor: {
                kind: "object",
                objectId: "R1",
                localOffset: { x: 0, y: 0 },
                fallbackPosition: { x: 0, y: 0 },
              },
              alignment: "start",
              rotation: 0,
              locked: false,
            },
          },
          {
            kind: "upsert_connectivity_evidence",
            evidence: {
              id: "gnd-claim",
              kind: "name-claim",
              netId: "gnd",
              name: "0",
              scope: "global",
              powerDomain: "ground",
              owner: { kind: "net-label", annotationId: "gnd-label" },
            },
          },
        ],
      },
    ]);
  }
  function run(
    project: ReturnType<typeof createEmptyProject>,
    edits: ProjectStructureEdit[],
  ) {
    const result = executeProjectTransaction(project, {
      transactionId: "substrate-default",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  }
  const model = (
    project: ReturnType<typeof createEmptyProject>,
    name: string,
    options?: { substrateDefault?: boolean },
  ) =>
    planSetDeviceModelTarget(
      project,
      project.topDocumentId,
      "R1",
      name,
      options,
    );
  const substrateNet = (project: ReturnType<typeof createEmptyProject>) =>
    project.documents[0]!.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === "R1" && terminal.pinName === "B",
      ),
    )?.id;

  it("binds a poly resistor's B to ground, so the netlist exports", () => {
    const grounded = groundedResistor();
    const bound = run(grounded, model(grounded, "sky130_fd_pr__res_high_po"));
    expect(substrateNet(bound)).toBe("gnd");
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    expect(exported.file.text).toMatch(
      /^XR1 net0 net1 VSS sky130_fd_pr__res_high_po w=1 l=5\.5 mult=1$/mu,
    );
    // Another poly model keeps the B it has; the ideal resistor drops it.
    const swapped = run(bound, model(bound, "sky130_fd_pr__res_xhigh_po"));
    expect(substrateNet(swapped)).toBe("gnd");
    expect(substrateNet(run(swapped, model(swapped, "")))).toBeUndefined();
  });

  it("binds the larger vertical PNP as the smaller, C on the substrate (#1614)", () => {
    const project = createEmptyProject("pnp", "PNP");
    const document = project.documents[0]!;
    document.instances.push({
      id: "Q1",
      reference: "Q1",
      symbolId: "pnp",
      placement: null,
      netlist: {
        binding: { kind: "model", deviceClass: "bjt", name: "QP" },
        parameters: {},
      },
    });
    document.nets.push(
      ...["C", "B", "E"].map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "Q1", pinName: pin }],
      })),
    );
    const bound = run(
      project,
      planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "Q1",
        "sky130_fd_pr__pnp_05v5_W3p40L3p40",
      ),
    );
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // C, B, E in the PDK's order: net-c, net-b, net-e, numbered by id.
    expect(exported.file.text).toMatch(
      /^XQ1 net1 net0 net2 sky130_fd_pr__pnp_05v5_W3p40L3p40 m=1$/mu,
    );
  });

  it("leaves it to the Process, whose own rule may name another Net", () => {
    const grounded = groundedResistor();
    const edits = model(grounded, "sky130_fd_pr__res_high_po", {
      substrateDefault: false,
    });
    expect(substrateNet(run(grounded, edits))).toBeUndefined();
  });
});

describe("a Library gate takes a standard cell of its function (#1450)", () => {
  function norProject() {
    const project = createEmptyProject("gates", "Gates");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "nor-gate",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
        parameters: { vt: "10m", td: "10p" },
      },
    });
    document.nets.push(
      ...["A", "B", "Y"].map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }
  const apply = (
    project: ReturnType<typeof norProject>,
    model: string,
  ): ReturnType<typeof norProject> => {
    const result = executeProjectTransaction(project, {
      transactionId: `model-${model}`,
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "X1",
        model,
      ),
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  };

  it("calls the cell in its pin order with the gate's rails, and clears back to the ideal body", () => {
    const bound = apply(norProject(), "sky130_fd_sc_hd__nor2_1");
    expect(bound.documents[0]!.instances[0]).toMatchObject({
      symbolId: "nor-gate",
      netlist: { binding: { kind: "external-subcircuit" }, parameters: {} },
    });
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready") throw new Error(exported.status);
    // A, B, VGND VNB on the Cell's ground, VPB VPWR on its VDD, then Y.
    expect(exported.file.text).toContain(
      "X1 net0 net1 VSS VSS VDD VDD net2 sky130_fd_sc_hd__nor2_1\n",
    );
    expect(exported.file.text).not.toContain(".subckt nor_gate");

    const cleared = apply(bound, "");
    expect(cleared.documents[0]!.instances[0]!.netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
      parameters: { vt: "10m", td: "10p" },
    });
  });

  it("refuses another function's cell and a name that is no cell", () => {
    const project = norProject();
    expect(() =>
      planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "X1",
        "sg13g2_nand2_1",
      ),
    ).toThrow(
      "sg13g2_nand2_1 is not compatible with the selected nor-gate: it is a nand-gate model. Place a nand-gate to use it.",
    );
    expect(() =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", "nor2"),
    ).toThrow(
      "nor2 is not a Cell or external subcircuit of this Project, nor a reviewed standard cell for nor-gate; use sky130_fd_sc_hd__nor2_1, sg13g2_nor2_1, NR2D1BWP12T30P140",
    );
  });

  it("stays a gate through its definition's upsert and a Cell import, and keeps the cell's interface fixed", () => {
    const bound = apply(norProject(), "sky130_fd_sc_hd__nor2_1");
    const definition = bound.externalSubcircuitDefinitions[0]!;
    const upsert = (next: typeof definition) =>
      executeProjectTransaction(bound, {
        transactionId: "upsert-cell",
        projectId: bound.id,
        expectedStructureRevision: bound.structureRevision,
        actor: { kind: "agent", id: "test" },
        edits: [
          { kind: "upsert_external_subcircuit_definition", definition: next },
        ],
      });
    const same = upsert(structuredClone(definition));
    if (!same.ok) throw new Error(same.error.message);
    expect(same.project.documents[0]!.instances[0]!.symbolId).toBe("nor-gate");
    const forked = upsert({
      ...definition,
      formalParameters: [{ name: "foo", defaultValue: "1" }],
    });
    expect(!forked.ok && forked.error.message).toBe(
      "Reviewed PDK interfaces and implementations are fixed. Create a new definition for an explicit model fork.",
    );

    const imported = planProjectCellImport(
      createEmptyProject("destination", "Destination"),
      bound,
      bound.topDocumentId,
    );
    if (!imported.ok) throw new Error(imported.message);
    const placed = imported.edits.flatMap((edit) =>
      edit.kind === "add_document" ? edit.document.instances : [],
    );
    expect(placed.map((instance) => instance.symbolId)).toEqual(["nor-gate"]);
  });
});

describe("a Library gate, flip-flop, op-amp or comparator takes a Cell of its Project (#1450, #1689, #1878)", () => {
  /** A nor-gate X1 wired at A, B and Y, its VDD on Net net-vdda. */
  function gateProject() {
    const project = createEmptyProject("gates", "Gates");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "nor-gate",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
        parameters: { vt: "10m", td: "10p" },
      },
    });
    document.nets.push(
      ...["A", "B", "Y", "VDD"].map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }
  /** Cell `name`, with a Port and a Net for each Pin. */
  function addCell(
    project: ReturnType<typeof gateProject>,
    id: string,
    name: string,
    pins: readonly string[],
  ) {
    const cell = createEmptyDocument(id, name);
    cell.netlist!.name = name;
    for (const pin of pins) {
      cell.instances.push({
        id: `${id}-port-${pin}`,
        symbolId: "port",
        placement: null,
      });
      cell.nets.push({
        id: `${id}-net-${pin}`,
        terminals: [{ instanceId: `${id}-port-${pin}`, pinName: "P" }],
      });
      cell.netlist!.terminals.push({
        id: `${id}-${pin}`,
        name: pin,
        netId: `${id}-net-${pin}`,
        direction: "inout",
        interfaceInstanceIds: [`${id}-port-${pin}`],
      });
    }
    project.documents.push(cell);
    return cell;
  }
  const execute = (
    project: ReturnType<typeof gateProject>,
    edits: ProjectStructureEdit[],
  ) => {
    const result = executeProjectTransaction(project, {
      transactionId: "gate-cell",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  };
  const bind = (project: ReturnType<typeof gateProject>, model: string) =>
    execute(
      project,
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", model),
    );
  const gate = (project: ReturnType<typeof gateProject>) =>
    project.documents[0]!.instances.find((instance) => instance.id === "X1")!;
  const pinsOf = (project: ReturnType<typeof gateProject>) =>
    project.documents[0]!.nets.flatMap((net) =>
      net.terminals
        .filter((terminal) => terminal.instanceId === "X1")
        .map((terminal) => terminal.pinName),
    );

  it("binds by the Cell's name in any case, keeps the gate's symbol and pins, and clears back to the ideal body", () => {
    const project = gateProject();
    addCell(project, "nor2", "NOR2", ["a", "b", "y", "VDD", "VSS"]);
    const bound = bind(project, "nor2");
    expect(gate(bound)).toMatchObject({
      symbolId: "nor-gate",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "nor2" },
        parameters: {},
      },
    });
    // The Cell has a VDD Pin, so the gate's VDD Net stays.
    expect(pinsOf(bound)).toEqual(["A", "B", "Y", "VDD"]);
    expect(
      planSetDeviceModelTarget(bound, bound.topDocumentId, "X1", "NOR2"),
    ).toEqual([]);
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // In the Cell's order: VDD on the gate's Net, VSS on ground, then a, b
    // and y on the gate's A, B and Y.
    expect(exported.file.text).toMatch(/^X1 net2 VSS net0 net1 net3 NOR2$/mu);

    const cleared = bind(bound, "");
    expect(gate(cleared).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
      parameters: { vt: "10m", td: "10p" },
    });
  });

  it("refuses a Cell whose Pins do not fit, naming them, and offers the Cells that do", () => {
    const project = gateProject();
    addCell(project, "inv1", "inv1", ["A", "Y", "EN"]);
    addCell(project, "nor2", "nor2", ["A", "B", "Y"]);
    const plan = (model: string) =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", model);
    expect(() => plan("INV1")).toThrow(
      "Cell inv1 does not fit the nor-gate: it has no Pin B, and its Pin EN is not one of the gate's. Its Pins must be A, B and Y, in any letter case, and VDD and VSS unless the Cell takes its supplies globally",
    );
    expect(() => plan("nor3")).toThrow(
      "nor3 is not a Cell or external subcircuit of this Project, nor a reviewed standard cell for nor-gate; use nor2, sky130_fd_sc_hd__nor2_1, sg13g2_nor2_1, NR2D1BWP12T30P140",
    );
    expect(
      gateCellTargets(project, project.topDocumentId, "nor-gate").map(
        (cell) => cell.id,
      ),
    ).toEqual(["nor2"]);
  });

  it("binds a Delay Cell to A/Y transistor Cell pins and restores its formula parameters", () => {
    const project = gateProject();
    const instance = gate(project);
    instance.symbolId = "delay-cell";
    instance.netlist = {
      binding: { kind: "unresolved-subcircuit", name: "delay_cell" },
      parameters: { tpd: "100p", vt: "10m" },
    };
    project.documents[0]!.nets = project.documents[0]!.nets.filter(
      (net) => net.id !== "net-b",
    );
    addCell(project, "delay_cmos", "delay_cmos", ["a", "y", "VDD", "VSS"]);
    expect(
      gateCellTargets(project, project.topDocumentId, "delay-cell").map(
        (cell) => cell.id,
      ),
    ).toEqual(["delay_cmos"]);
    const bound = bind(project, "delay_cmos");
    expect(gate(bound)).toMatchObject({
      symbolId: "delay-cell",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "delay_cmos" },
        parameters: {},
      },
    });
    expect(pinsOf(bound)).toEqual(["A", "Y", "VDD"]);
    const restored = parseProject(serializeProject(bound));
    expect(gate(restored)).toEqual(gate(bound));
    expect(gate(bind(restored, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "delay_cell" },
      parameters: { vt: "10m", tpd: "10p" },
    });
  });

  it("refuses the Cell the gate is drawn in", () => {
    const project = gateProject();
    const cell = addCell(project, "nor2", "nor2", ["A", "B", "Y"]);
    cell.instances.push({
      id: "X9",
      reference: "X9",
      symbolId: "nor-gate",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
        parameters: {},
      },
    });
    expect(() =>
      planSetDeviceModelTarget(project, "nor2", "X9", "nor2"),
    ).toThrow("X9 is drawn in Cell nor2, which cannot call itself");
    expect(gateCellTargets(project, "nor2", "nor-gate")).toEqual([]);
  });

  it("clears Cell-owned Delay overrides even when a formal has the same name as a formula parameter", () => {
    const project = gateProject();
    gate(project).symbolId = "delay-cell";
    gate(project).netlist = {
      binding: { kind: "unresolved-subcircuit", name: "delay_cell" },
      parameters: { vt: "10m", tpd: "100p" },
    };
    project.documents[0]!.nets = project.documents[0]!.nets.filter(
      (net) => net.id !== "net-b",
    );
    const cell = addCell(project, "delay_cmos", "delay_cmos", [
      "A",
      "Y",
      "VDD",
      "VSS",
    ]);
    cell.netlist!.formalParameters = [
      { name: "cap", defaultValue: "100f" },
      { name: "tpd", defaultValue: "0" },
    ];
    const bound = bind(project, "delay_cmos");
    gate(bound).netlist!.parameters = { cap: "200f", tpd: "0" };
    expect(gate(bind(bound, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "delay_cell" },
      parameters: { vt: "10m", tpd: "10p" },
    });
  });

  it("clears the gate's VDD Net where the Cell takes its supplies globally", () => {
    const project = gateProject();
    addCell(project, "nor2", "nor2", ["A", "B", "Y"]);
    expect(pinsOf(bind(project, "nor2"))).toEqual(["A", "B", "Y"]);
  });

  /** A reset flip-flop X1 wired at every pin, its VDD on Net net-vdd. */
  function flipFlopProject() {
    const project = createEmptyProject("flip-flops", "Flip-flops");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "d-flip-flop-reset",
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: "d_flip_flop_reset" },
        parameters: { vt: "10m", td: "10p" },
      },
    });
    document.nets.push(
      ...["D", "CK", "RST", "Q", "QBAR", "VDD"].map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }

  it("binds a flip-flop to a transistor-level Cell as a gate, and clears it back to its ideal body (#1689)", () => {
    const project = flipFlopProject();
    addCell(project, "dffr", "dffr", [
      "d",
      "ck",
      "rst",
      "q",
      "qbar",
      "VDD",
      "VSS",
    ]);
    expect(
      gateCellTargets(project, project.topDocumentId, "d-flip-flop-reset").map(
        (cell) => cell.id,
      ),
    ).toEqual(["dffr"]);
    const bound = bind(project, "DFFR");
    expect(gate(bound)).toMatchObject({
      symbolId: "d-flip-flop-reset",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "dffr" },
        parameters: {},
      },
    });
    expect(pinsOf(bound)).toEqual(["D", "CK", "RST", "Q", "QBAR", "VDD"]);
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // The call goes to the Cell in its Pin order, each Pin on the
    // flip-flop's Net of its name: VDD on net5, then D, CK, RST, Q and QBAR
    // on net1, net0, net4, net2 and net3 (Nets are numbered by ID).
    expect(exported.file.text).toMatch(
      /^\.subckt dffr VDD VSS d ck rst q qbar$/mu,
    );
    expect(exported.file.text).toMatch(
      /^X1 net5 VSS net1 net0 net4 net2 net3 dffr$/mu,
    );

    const cleared = bind(bound, "");
    expect(gate(cleared).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "d_flip_flop_reset" },
      parameters: { vt: "10m", td: "10p" },
    });
  });

  it("refuses a Cell that does not fit a flip-flop, naming its Pins, and a name that is no Cell (#1689)", () => {
    const project = flipFlopProject();
    addCell(project, "dff", "dff", ["D", "CK", "Q", "QBAR"]);
    const plan = (model: string) =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", model);
    expect(() => plan("dff")).toThrow(
      "Cell dff does not fit the d-flip-flop-reset: it has no Pin RST. Its Pins must be D, CK, RST, Q and QBAR, in any letter case, and VDD and VSS unless the Cell takes its supplies globally",
    );
    expect(() => plan("dffr")).toThrow(
      "dffr is not a Cell or external subcircuit of this Project that fits d-flip-flop-reset",
    );
    addCell(project, "dffr", "dffr", ["D", "CK", "RST", "Q", "QBAR", "EN"]);
    expect(() => plan("dffr")).toThrow(
      "its Pin EN is not one of the flip-flop's",
    );
  });

  it("keeps a bound flip-flop's symbol through a Cell rename, and the Pins it uses (#1689)", () => {
    const project = flipFlopProject();
    addCell(project, "dffr", "dffr", ["D", "CK", "RST", "Q", "QBAR"]);
    const bound = bind(project, "dffr");
    // The Cell takes its supplies globally: the VDD Net is cleared.
    expect(pinsOf(bound)).toEqual(["D", "CK", "RST", "Q", "QBAR"]);
    const renamed = execute(bound, planRenameCell(bound, "dffr", "dff_cmos"));
    expect(gate(renamed).symbolId).toBe("d-flip-flop-reset");
    expect(() =>
      planRenameCellTerminal(renamed, "dffr", "dffr-RST", "clear"),
    ).toThrow("its RST would have no Pin");
  });

  /** An op-amp or comparator X1 wired at every pin, its VDD on Net net-vdd. */
  function amplifierProject(
    symbolId: string,
    binding: string,
    parameters: Record<string, string>,
  ) {
    const project = createEmptyProject("amplifiers", "Amplifiers");
    const document = project.documents[0]!;
    document.instances.push({
      id: "X1",
      reference: "X1",
      symbolId,
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: binding },
        parameters,
      },
    });
    const pins = symbolId.startsWith("opamp-differential")
      ? ["IN+", "IN-", "OUT+", "OUT-", "VDD"]
      : ["IN+", "IN-", "OUT", "VDD"];
    document.nets.push(
      ...pins.map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }

  it("binds an op-amp to a transistor-level Cell, keeping its triangle, and clears it back to the ideal op-amp (#1878)", () => {
    const project = amplifierProject("opamp", "opamp", {
      gain: "1e5",
      vhigh: "VDD",
      vlow: "VSS",
    });
    addCell(project, "ota", "ota", ["in+", "IN-", "out", "VDD", "VSS"]);
    expect(
      gateCellTargets(project, project.topDocumentId, "opamp").map(
        (cell) => cell.id,
      ),
    ).toEqual(["ota"]);
    const bound = bind(project, "OTA");
    expect(gate(bound)).toMatchObject({
      symbolId: "opamp",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "ota" },
        parameters: {},
      },
    });
    // The Cell has a VDD Pin, so the op-amp's VDD Net stays.
    expect(pinsOf(bound)).toEqual(["IN+", "IN-", "OUT", "VDD"]);
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // The call goes to the Cell in its Pin order: VDD on net3, VSS on
    // ground, then in+, IN- and out on the op-amp's IN+, IN- and OUT (net1,
    // net0 and net2; Nets are numbered by ID).
    expect(exported.file.text).toMatch(/^\.subckt ota VDD VSS in\+ IN- out$/mu);
    expect(exported.file.text).toMatch(/^X1 net3 VSS net1 net0 net2 ota$/mu);
    expect(exported.file.text).not.toContain("icm_opamp");

    // A Pin the op-amp uses cannot be renamed away.
    expect(() =>
      planRenameCellTerminal(bound, "ota", "ota-in+", "inp"),
    ).toThrow(
      "X1 in Cell dut is an opamp bound to this Cell, and its IN+ would have no Pin",
    );

    expect(gate(bind(bound, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "opamp" },
      parameters: { gain: "1e6", vhigh: "VDD", vlow: "VSS" },
    });
  });

  it("binds a comparator or a fully differential op-amp to a Cell, and clears each to its ideal body (#1878)", () => {
    const comparator = amplifierProject("comparator", "icm_ideal_comparator", {
      vhigh: "VDD",
      vlow: "0",
      vtransition: "1m",
    });
    addCell(comparator, "cmp", "cmp", ["IN+", "IN-", "OUT"]);
    const bound = bind(comparator, "cmp");
    expect(gate(bound)).toMatchObject({
      symbolId: "comparator",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "cmp" },
        parameters: {},
      },
    });
    // The Cell takes its supplies globally: the VDD Net is cleared.
    expect(pinsOf(bound)).toEqual(["IN+", "IN-", "OUT"]);
    // A comparator clears to the ideal comparator it is placed with, not
    // to the historical master its symbol names.
    expect(gate(bind(bound, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "icm_ideal_comparator" },
      parameters: { vhigh: "VDD", vlow: "0", vtransition: "1m" },
    });

    const differential = amplifierProject(
      "opamp-differential-crossed",
      "opamp_differential",
      { gain: "1e6" },
    );
    addCell(differential, "fda", "fda", [
      "IN+",
      "IN-",
      "OUT+",
      "OUT-",
      "VDD",
      "VSS",
    ]);
    const fda = bind(differential, "fda");
    expect(gate(fda)).toMatchObject({
      symbolId: "opamp-differential-crossed",
      netlist: { binding: { kind: "subcircuit", childDocumentId: "fda" } },
    });
    expect(gate(bind(fda, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "opamp_differential" },
      parameters: { gain: "1e6" },
    });
  });

  it("refuses a Cell that does not fit an op-amp, naming the pins it lacks (#1878)", () => {
    const project = amplifierProject("opamp", "opamp", {});
    // VIP and VIN are what the ideal op-amp's body calls its inputs; a Cell
    // implementing the op-amp takes the op-amp's own pin names.
    addCell(project, "half", "half", ["VIP", "VIN", "OUT"]);
    expect(() =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", "half"),
    ).toThrow(
      "Cell half does not fit the opamp: it has no Pins IN+ and IN-, and its Pins VIP and VIN are not of the op-amp's. Its Pins must be IN+, IN- and OUT, in any letter case, and VDD and VSS unless the Cell takes its supplies globally",
    );
    expect(() =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", "ota"),
    ).toThrow(
      "ota is not a Cell or external subcircuit of this Project that fits opamp",
    );
  });

  /** A Library part X1 with its default parameters, each pin on a Net of its own. */
  function partProject(symbolId: string, pins: readonly string[]) {
    const project = createEmptyProject("parts", "Parts");
    const target = subcircuitDescriptor(symbolId)!.target;
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId,
      placement: null,
      netlist: {
        binding: { kind: "unresolved-subcircuit", name: target },
        parameters: builtInModelDefaults(target),
      },
    });
    project.documents[0]!.nets.push(
      ...pins.map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }

  it("binds an adder to a transistor-level Cell by Pin name, and clears it back to its ideal body (#1928)", () => {
    const project = partProject("adder", ["A", "B", "Y", "VDD"]);
    addCell(project, "sum", "sum", ["y", "VDD", "VSS", "a", "b"]);
    expect(
      gateCellTargets(project, project.topDocumentId, "adder").map(
        (cell) => cell.id,
      ),
    ).toEqual(["sum"]);
    const bound = bind(project, "SUM");
    expect(gate(bound)).toMatchObject({
      symbolId: "adder",
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "sum" },
        parameters: {},
      },
    });
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // The Cell's supplies come first; its y, a and b take the adder's Y, A
    // and B (net3, net0 and net1; Nets are numbered by ID).
    expect(exported.file.text).toMatch(/^X1 net2 VSS net3 net0 net1 sum$/mu);
    // A Cell rename leaves it an adder.
    const renamed = execute(bound, planRenameCell(bound, "sum", "sum_cmos"));
    expect(gate(renamed).symbolId).toBe("adder");
    expect(gate(bind(bound, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "adder" },
      parameters: { signA: "+", signB: "+" },
    });
  });

  it.each([
    ["multiplier", ["A", "B", "Y"]],
    ["adc", ["IN", "OUT"]],
    ["dac", ["IN", "OUT"]],
    ["voltage-amplifier", ["IN", "OUT"]],
    ["transconductance", ["A", "Y"]],
    ["differential-transconductance", ["IN+", "IN-", "OUT"]],
    ["crystal", ["1", "2"]],
  ] as const)(
    "binds a %s to a Cell or an external definition whose Pins are its own, keeping its symbol (#1928)",
    (symbolId, pins) => {
      const project = partProject(symbolId, pins);
      addCell(project, "own", "own", [...pins].reverse());
      addExternal(project, "ext", [...pins].reverse());
      expect(
        gateCellTargets(project, project.topDocumentId, symbolId).map(
          (cell) => cell.id,
        ),
      ).toEqual(["own"]);
      expect(
        gateExternalTargets(project, symbolId).map(
          (definition) => definition.id,
        ),
      ).toEqual(["external-ext"]);
      for (const [model, binding] of [
        ["own", { kind: "subcircuit", childDocumentId: "own" }],
        ["ext", { kind: "external-subcircuit", definitionId: "external-ext" }],
      ] as const) {
        const bound = bind(project, model);
        expect(gate(bound)).toMatchObject({ symbolId, netlist: { binding } });
        for (const format of ["spice", "spectre"] as const) {
          const exported = createDesignNetlistExport(bound, { format });
          if (exported.status !== "ready")
            throw new Error(JSON.stringify(exported.diagnostics));
          expect(exported.file.text).toMatch(
            format === "spice"
              ? new RegExp(`^X1 .* ${model}$`, "mu")
              : new RegExp(`^X1 \\(.*\\) ${model}\\b`, "mu"),
          );
        }
      }
    },
  );

  /**
   * An external definition `name` declaring `terminals`, in that order, and
   * implemented by a model source of the Project.
   */
  function addExternal(
    project: ReturnType<typeof gateProject>,
    name: string,
    terminals: readonly string[],
    interfaceStatus: "declared" | "inferred-positional" = "declared",
  ) {
    const sourceId = `source-${name}`;
    (project.modelSources ??= []).push({
      id: sourceId,
      language: "spice",
      revision: 1,
      entry: `${name}.spice`,
      dependencies: [],
      files: [
        {
          path: `${name}.spice`,
          text: `.subckt ${name} ${terminals.join(" ")}\nR1 ${terminals[0]} ${terminals[1]} 1k\n.ends ${name}\n`,
        },
      ],
    });
    project.externalSubcircuitDefinitions.push({
      id: `external-${name}`,
      name,
      interfaceStatus,
      formalParameters: [],
      terminals: terminals.map((terminal) => ({
        id: `external-${name}-${terminal}`,
        name: terminal,
        direction: "inout" as const,
      })),
      implementation: { kind: "source", sourceId, entry: name },
    });
  }

  it("binds an op-amp to an external definition of its Project by Pin name, in the definition's order (#1928)", () => {
    const project = amplifierProject("opamp", "opamp", {
      gain: "1e5",
      vhigh: "VDD",
      vlow: "VSS",
    });
    addExternal(project, "ota", ["out", "VSS", "in-", "VDD", "in+"]);
    const bound = bind(project, "OTA");
    expect(gate(bound)).toMatchObject({
      symbolId: "opamp",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });
    // The definition has a VDD Pin, so the op-amp's VDD Net stays.
    expect(pinsOf(bound)).toEqual(["IN+", "IN-", "OUT", "VDD"]);
    const exported = createDesignNetlistExport(bound, { format: "spice" });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // out, VSS, in-, VDD and in+ take OUT (net2), ground, IN- (net0), VDD
    // (net3) and IN+ (net1).
    expect(exported.file.text).toMatch(/^X1 net2 VSS net0 net3 net1 ota$/mu);
    expect(exported.file.text).not.toContain("icm_opamp");
    // The definition's ID names it as well as its name.
    expect(
      planSetDeviceModelTarget(
        bound,
        bound.topDocumentId,
        "X1",
        "external-ota",
      ),
    ).toEqual([]);
    expect(gate(bind(bound, "")).netlist).toEqual({
      binding: { kind: "unresolved-subcircuit", name: "opamp" },
      parameters: { gain: "1e6", vhigh: "VDD", vlow: "VSS" },
    });
  });

  it("refuses an external definition that does not fit, or declares its ports only by position (#1928)", () => {
    const project = amplifierProject("opamp", "opamp", {});
    addExternal(project, "half", ["VIP", "VIN", "OUT"]);
    addExternal(project, "imported", ["1", "2", "3"], "inferred-positional");
    addExternal(project, "ota", ["IN+", "IN-", "OUT"]);
    const plan = (model: string) =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", model);
    expect(() => plan("half")).toThrow(
      "External subcircuit half does not fit the opamp: it has no Pins IN+ and IN-, and its Pins VIP and VIN are not of the op-amp's. Its Pins must be IN+, IN- and OUT, in any letter case, and VDD and VSS unless the subcircuit takes its supplies globally",
    );
    expect(() => plan("imported")).toThrow(
      "External subcircuit imported names its ports only by position; name them IN+, IN- and OUT to bind the opamp to it",
    );
    expect(() => plan("amp")).toThrow(
      "amp is not a Cell or external subcircuit of this Project that fits opamp; use ota",
    );
  });

  /**
   * A chopper or magnetic part X1 as placed: no binding, its parameters at
   * their defaults, each pin on a Net of its own.
   */
  function deviceProject(symbolId: string, pins: readonly string[]) {
    const project = createEmptyProject("devices", "Devices");
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId,
      placement: null,
      netlist: {
        parameters: Object.fromEntries(
          deviceDescriptor(symbolId)!.parameters.flatMap((parameter) =>
            parameter.defaultValue === undefined
              ? []
              : [[parameter.name, parameter.defaultValue]],
          ),
        ),
      },
    });
    project.documents[0]!.nets.push(
      ...pins.map((pin) => ({
        id: `net-${pin.toLowerCase()}`,
        terminals: [{ instanceId: "X1", pinName: pin }],
      })),
    );
    return project;
  }

  it.each([
    ["tcoil", ["1", "2", "3"]],
    ["xfmr", ["P-", "P+", "S-", "S+"]],
    ["center-tap-inductor", ["1", "2", "3"]],
    ["chopper", ["INP", "INN", "OUTP", "OUTN"]],
  ] as const)(
    "binds a %s, whose call goes to a generated body too, to a Cell or an external definition whose Pins are its own (#1928)",
    (symbolId, pins) => {
      const project = deviceProject(symbolId, pins);
      const placed = structuredClone(gate(project).netlist);
      addCell(project, "own", "own", [...pins].reverse());
      addExternal(project, "ext", [...pins].reverse());
      expect(
        gateCellTargets(project, project.topDocumentId, symbolId).map(
          (cell) => cell.id,
        ),
      ).toEqual(["own"]);
      expect(
        gateExternalTargets(project, symbolId).map(
          (definition) => definition.id,
        ),
      ).toEqual(["external-ext"]);
      for (const [model, binding] of [
        ["own", { kind: "subcircuit", childDocumentId: "own" }],
        ["ext", { kind: "external-subcircuit", definitionId: "external-ext" }],
      ] as const) {
        const bound = bind(project, model);
        // Neither declares a parameter, so the part's own give way.
        expect(gate(bound)).toMatchObject({
          symbolId,
          netlist: { binding, parameters: {} },
        });
        for (const format of ["spice", "spectre"] as const) {
          const exported = createDesignNetlistExport(bound, { format });
          if (exported.status !== "ready")
            throw new Error(JSON.stringify(exported.diagnostics));
          expect(exported.file.text).toMatch(
            format === "spice"
              ? new RegExp(`^X1 .* ${model}$`, "mu")
              : new RegExp(`^X1 \\(.*\\) ${model}\\b`, "mu"),
          );
          // Nothing calls the generated body, so it is not written.
          expect(exported.file.text).not.toMatch(
            /subckt (?:tcoil|xfmr|ct_inductor|ideal_chopper)\b/u,
          );
        }
        const vacask = printVacaskWithLocations(
          analyzeDesignNetlist(bound).ir!,
        );
        if (!vacask.ok) throw new Error(JSON.stringify(vacask));
        expect(vacask.text).toMatch(new RegExp(`\\) ${model}\\b`, "u"));
        expect(vacask.text).not.toMatch(
          /subckt (?:tcoil|xfmr|ct_inductor|ideal_chopper)\b/u,
        );
        // Clearing the model returns the part as it was placed.
        expect(gate(bind(bound, "")).netlist).toEqual(placed);
      }
    },
  );

  it("gives a bound chopper's clock to the Pin CK of its Cell (#1928)", () => {
    const project = deviceProject("chopper", ["INP", "INN", "OUTP", "OUTN"]);
    gate(project).reference = "CH1";
    addCell(project, "chop", "chop", ["ck", "OUTN", "OUTP", "INN", "INP"]);
    const exported = createDesignNetlistExport(bind(project, "chop"), {
      format: "spice",
    });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    // The clock is the phase the chopper's label names, CH1 while it shows
    // its reference; INN, INP, OUTN and OUTP are net0 to net3.
    expect(exported.file.text).toMatch(/^XCH1 CH1 net2 net3 net0 net1 chop$/mu);
  });

  it("refuses a Cell that does not fit a chopper or a T-coil, naming what it lacks (#1928)", () => {
    const plan = (project: ReturnType<typeof gateProject>, model: string) =>
      planSetDeviceModelTarget(project, project.topDocumentId, "X1", model);
    const chopper = deviceProject("chopper", ["INP", "INN", "OUTP", "OUTN"]);
    addCell(chopper, "half", "half", ["INP", "INN", "OUTP"]);
    expect(() => plan(chopper, "half")).toThrow(
      "Cell half does not fit the chopper: it has no Pin OUTN. Its Pins must be INP, INN, OUTP and OUTN, in any letter case, and CK for the clock its label names unless the Cell takes its clock globally",
    );
    const tcoil = deviceProject("tcoil", ["1", "2", "3"]);
    addCell(tcoil, "pair", "pair", ["1", "2"]);
    expect(() => plan(tcoil, "pair")).toThrow(
      "Cell pair does not fit the tcoil: it has no Pin 3. Its Pins must be 1, 2 and 3, in any letter case",
    );
    expect(() => plan(tcoil, "ota")).toThrow(
      "ota is not a Cell or external subcircuit of this Project that fits tcoil",
    );
    // A definition that names its ports only by position fits neither.
    addExternal(
      chopper,
      "imported",
      ["1", "2", "3", "4", "5"],
      "inferred-positional",
    );
    expect(() => plan(chopper, "imported")).toThrow(
      "External subcircuit imported names its ports only by position; name them INP, INN, OUTP and OUTN to bind the chopper to it",
    );
    addExternal(tcoil, "imported", ["a", "b", "c"], "inferred-positional");
    expect(() => plan(tcoil, "imported")).toThrow(
      "External subcircuit imported names its ports only by position; name them 1, 2 and 3 to bind the tcoil to it",
    );
  });

  it("stays a gate through a Cell rename, and keeps the Pins it uses", () => {
    const project = gateProject();
    addCell(project, "nor2", "nor2", ["a", "b", "y", "VDD", "VSS"]);
    const bound = bind(project, "nor2");
    const renamed = execute(bound, planRenameCell(bound, "nor2", "nor_cmos"));
    expect(gate(renamed).symbolId).toBe("nor-gate");
    // A new spelling of the same Pin leaves the gate as it is.
    const recased = execute(
      renamed,
      planRenameCellTerminal(renamed, "nor2", "nor2-b", "B"),
    );
    expect(gate(recased).symbolId).toBe("nor-gate");
    expect(pinsOf(recased)).toEqual(["A", "B", "Y", "VDD"]);
    expect(() =>
      planRenameCellTerminal(recased, "nor2", "nor2-b", "in2"),
    ).toThrow(
      "X1 in Cell dut is a nor-gate bound to this Cell, and its B would have no Pin; clear X1's model first, or keep the Pin",
    );
    expect(() => planRemoveCellTerminal(recased, "nor2", "nor2-VDD")).toThrow(
      "its VDD would have no Pin",
    );
    // Its VSS is Auto: the Cell may take ground globally instead.
    expect(
      planRemoveCellTerminal(recased, "nor2", "nor2-VSS").length,
    ).toBeGreaterThan(0);
  });
});

describe("hierarchy domain planners", () => {
  function railProject(scope: "local" | "global" = "global") {
    const project = createEmptyProject("rail-mode", "Rail mode");
    const document = project.documents[0]!;
    const result = executeProjectTransaction(project, {
      transactionId: "rail",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits: [
            {
              kind: "add_power_rail",
              netId: "supply",
              routeId: "rail",
              startJunctionId: "left",
              endJunctionId: "right",
              labelId: "supply-label",
              netName: "VCC",
              scope,
              powerDomain: "vdd",
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
            },
          ],
        },
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.project;
  }

  function switchSupply(
    project: ReturnType<typeof createEmptyProject>,
    mode: "cell-pin" | "global",
    id = "rail",
  ) {
    const result = executeProjectTransaction(project, {
      transactionId: `switch-${mode}`,
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetVddConnectionMode(project, project.topDocumentId, id, mode),
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.project;
  }

  it.each(["global", "local"] as const)(
    "roundtrips a %s Rail role without changing drawing or Net membership",
    (scope) => {
      let project = railProject(scope);
      const original = structuredClone(project.documents[0]!);
      const modes =
        scope === "global"
          ? (["cell-pin", "global"] as const)
          : (["global", "cell-pin"] as const);
      for (const mode of modes) {
        project = switchSupply(project, mode);
        const document = project.documents[0]!;
        expect(document.routes).toEqual(original.routes);
        expect(document.junctions).toEqual(original.junctions);
        expect(document.nets).toEqual(original.nets);
        expect(document.instances).toEqual(original.instances);
        const { binding: _before, ...before } = original.annotations[0]!;
        const { binding: _after, ...after } = document.annotations[0]!;
        expect(after).toEqual(before);
        if (mode === "cell-pin") {
          expect(document.netlist!.terminals).toEqual([
            expect.objectContaining({
              name: "VCC",
              netId: "supply",
              interfaceInstanceIds: [],
              interfaceAnnotationId: "supply-label",
            }),
          ]);
          expect(document.annotations[0]!.binding?.kind).toBe(
            "cell-terminal-name",
          );
          // A Cell no parent has placed draws its supply on top (#1257).
          expect(document.presentation.cellSymbol?.pinPlacements).toEqual([
            {
              terminalId: document.netlist!.terminals[0]!.id,
              side: "north",
              offset: 0,
            },
          ]);
        } else {
          expect(document.netlist!.terminals).toEqual([]);
          expect(document.connectivityEvidence).toEqual([
            expect.objectContaining({
              name: "VCC",
              scope: "global",
              owner: { kind: "power-marker", objectId: "supply-label" },
            }),
          ]);
        }
        expect(
          planSetVddConnectionMode(project, document.id, "rail", mode),
        ).toEqual([]);
        for (const format of ["spice", "spectre"] as const) {
          const exported = createDesignNetlistExport(project, { format });
          expect(exported.status).toBe("ready");
          if (exported.status !== "ready") continue;
          expect(/(?:\.global|global) VCC/.test(exported.file.text)).toBe(
            mode === "global",
          );
          expect(
            (format === "spice"
              ? /\.subckt dut VCC/
              : /subckt dut \(VCC\)/
            ).test(exported.file.text),
          ).toBe(mode === "cell-pin");
        }
      }
    },
  );

  it("recovers an unlabeled legacy Rail's route/junction claims without adding visible artwork", () => {
    let project = railProject();
    const original = project.documents[0]!;
    original.annotations = [];
    original.connectivityEvidence = ["rail", "right"].map((id) => ({
      id: `claim-${id}`,
      kind: "name-claim",
      netId: "supply",
      name: "VCC",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: id },
    }));
    project = switchSupply(project, "cell-pin");
    const document = project.documents[0]!;
    expect(document.routes).toEqual(original.routes);
    expect(document.nets).toEqual(original.nets);
    expect(document.annotations).toHaveLength(1);
    expect(document.annotations[0]!.visible).toBe(false);
    expect(document.netlist!.terminals[0]!.interfaceAnnotationId).toBe(
      document.annotations[0]!.id,
    );
    expect(document.connectivityEvidence).toEqual([
      expect.objectContaining({
        scope: "local",
        owner: { kind: "power-marker", objectId: document.annotations[0]!.id },
      }),
    ]);
    const global = switchSupply(project, "global").documents[0]!;
    expect(global.connectivityEvidence).toHaveLength(1);
    expect(global.annotations[0]!.visible).toBe(false);
  });

  it.each(["rail", "VDD1"])(
    "switches mixed Rail and Port ownership together from %s",
    (id) => {
      const project = railProject();
      const document = project.documents[0]!;
      document.instances.push({
        id: "VDD1",
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets[0]!.terminals.push({ instanceId: "VDD1", pinName: "P" });
      document.connectivityEvidence.push({
        id: "port-claim",
        kind: "name-claim",
        name: "VCC",
        scope: "global",
        netId: "supply",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
      });
      const local = switchSupply(project, "cell-pin", id);
      expect(local.documents[0]!.netlist!.terminals).toHaveLength(2);
      const global = switchSupply(local, "global", id);
      expect(global.documents[0]!.netlist!.terminals).toEqual([]);
      expect(global.documents[0]!.nets).toEqual(document.nets);
      expect(global.documents[0]!.connectivityEvidence).toHaveLength(2);
    },
  );

  it("does not consume another owner's Global declaration", () => {
    const project = railProject();
    project.documents[0]!.connectivityEvidence.push({
      id: "other",
      kind: "name-claim",
      netId: "supply",
      name: "VCC",
      scope: "global",
      owner: { kind: "net-label", annotationId: "other-label" },
    });
    expect(() =>
      planSetVddConnectionMode(
        project,
        project.topDocumentId,
        "rail",
        "cell-pin",
      ),
    ).toThrow("another Global declaration");
  });

  it("preserves attached PMOS bulk policy and controlled-source references", () => {
    let project = railProject();
    const original = project.documents[0]!;
    original.mosBulkDefaults = { pmosNetId: "supply" };
    original.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        symbolVariantId: "textbook-3terminal",
        placement: null,
        mosBulkBinding: { netId: "supply", origin: "cell-default" },
      },
      {
        id: "G1",
        reference: "G1",
        symbolId: "vccs",
        placement: null,
        netlist: {
          parameters: { gm: "1m" },
          control: {
            kind: "voltage",
            positiveNetId: "supply",
            negativeNetId: "return",
          },
        },
      },
    );
    original.nets[0]!.terminals.push(
      { instanceId: "M1", pinName: "S" },
      { instanceId: "M1", pinName: "B" },
      { instanceId: "G1", pinName: "+" },
    );
    original.nets.push({
      id: "return",
      terminals: [{ instanceId: "G1", pinName: "-" }],
    });
    for (const mode of ["cell-pin", "global"] as const) {
      project = switchSupply(project, mode);
      expect(project.documents[0]!.mosBulkDefaults).toEqual(
        original.mosBulkDefaults,
      );
      expect(project.documents[0]!.instances).toEqual(original.instances);
      expect(project.documents[0]!.nets).toEqual(original.nets);
    }
  });

  it("formats every ordinary and power Cell Port label in one transaction", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.netlist!.terminals.push(
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-vdd",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: [],
        interfaceAnnotationId: "label-vdd",
      },
    );
    document.annotations.push(
      {
        id: "label-in",
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-in" },
        formatOverride: { runs: [{ kind: "text", value: "IN" }] },
        anchor: {
          kind: "object",
          objectId: "P1",
          localOffset: { x: 2, y: 3 },
          fallbackPosition: { x: 4, y: 5 },
        },
        alignment: "end",
        rotation: 90,
        locked: false,
      },
      {
        id: "label-vdd",
        kind: "power-label",
        binding: {
          kind: "cell-terminal-name",
          terminalId: "terminal-vdd",
        },
        netId: "net-vdd",
        anchor: {
          kind: "object",
          objectId: "VDD1",
          localOffset: { x: 0, y: -10 },
          fallbackPosition: { x: 0, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );

    const edits = planFormatCellTerminalAnnotations(project, document.id);

    expect(edits).toEqual([
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              ...document.annotations[0],
              formatOverride: canonicalPortTextDocument("IN"),
            },
          },
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              ...document.annotations[1],
              formatOverride: canonicalPortTextDocument("VDD"),
            },
          },
        ],
      },
    ]);
    expect(
      document.netlist!.terminals.map((terminal) => terminal.name),
    ).toEqual(["IN", "VDD"]);
    expect(document.annotations[0]?.anchor).toEqual({
      kind: "object",
      objectId: "P1",
      localOffset: { x: 2, y: 3 },
      fallbackPosition: { x: 4, y: 5 },
    });

    document.annotations = document.annotations.map((annotation, index) => ({
      ...annotation,
      formatOverride: canonicalPortTextDocument(index === 0 ? "IN" : "VDD"),
    }));
    expect(planFormatCellTerminalAnnotations(project, document.id)).toEqual([]);
  });

  it("applies an explicit suffix case and placement without renaming Ports", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.netlist!.terminals.push({
      id: "terminal-out",
      name: "VoUt",
      netId: "net-out",
      direction: "output",
      interfaceInstanceIds: ["P1"],
    });
    document.annotations.push({
      id: "label-out",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-out" },
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const options = {
      suffixCase: "lowercase",
      suffixPlacement: "baseline",
    } as const;

    const edits = planFormatCellTerminalAnnotations(
      project,
      document.id,
      options,
    );

    expect(edits[0]).toMatchObject({
      edits: [
        {
          annotation: {
            formatOverride: canonicalPortTextDocument("VoUt", options),
          },
        },
      ],
    });
    expect(document.netlist!.terminals[0]!.name).toBe("VoUt");
  });

  it("rejects deleting a referenced Cell before Project commit", () => {
    const project = createEmptyProject("project", "Project", "top");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      createHierarchyInstance("X1", child, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );

    expect(() => planDeleteCell(project, child.id)).toThrow(
      "Cell child is still referenced by top.X1",
    );
  });

  it("constructs one canonical caller from the child interface", () => {
    const child = createEmptyDocument("child", "Stage");
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });

    expect(
      createHierarchyInstance("X1", child, {
        position: { x: 100, y: 80 },
        rotation: 90,
        mirror: "horizontal",
      }),
    ).toMatchObject({
      id: "X1",
      placement: { rotation: 90, mirror: "horizontal" },
      reference: "X1",
      netlist: {
        binding: { childDocumentId: "child" },
      },
    });
  });

  it("places a Cell caller through one parent transaction", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Stage");
    project.documents.push(child);
    const instance = createHierarchyInstance("X1", child, {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    });
    const result = executeProjectTransaction(project, {
      transactionId: "place-cell",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: planPlaceCellInstance(project, project.topDocumentId, instance),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.documents.find(
        (document) => document.id === project.topDocumentId,
      )?.instances,
    ).toEqual([expect.objectContaining({ id: "X1" })]);
  });

  it("permits a hierarchy reference independent from the stable instance id", () => {
    const child = createEmptyDocument("child", "Stage");
    expect(
      createHierarchyInstance(
        "X2-copy-1",
        child,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        "X2",
      ),
    ).toMatchObject({ id: "X2-copy-1", reference: "X2" });
  });

  it("keeps the block a new Cell shows when it is first placed (#1319, #1327)", () => {
    // An inverter Cell: a VDDA_1V8 supply on top, in drawn left and out
    // right. Unplaced, its block puts in and out on those sides, one row
    // below the middle, so the supply's name stands above them instead of
    // reading "in V_DDout" on one row, and is wide enough for that name.
    // Placed, it would derive the automatic layout again.
    const transact = (
      source: ReturnType<typeof createEmptyProject>,
      id: string,
      edits: ReturnType<typeof planPlaceCellInstance>,
    ) => {
      const result = executeProjectTransaction(source, {
        transactionId: id,
        projectId: source.id,
        expectedStructureRevision: source.structureRevision,
        actor: { kind: "human", id: "test" },
        edits,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.project;
    };
    let project = createEmptyProject("project", "inv");
    for (const [id, symbolId, name, direction, x] of [
      ["P1", "vdd-port", "VDDA_1V8", "inout", 0],
      ["P2", "port", "in", "input", -40],
      ["P3", "port", "out", "output", 80],
    ] as const)
      project = transact(
        project,
        `pin-${id}`,
        planCreateCellPin(project, project.topDocumentId, {
          instance: {
            id,
            symbolId,
            placement: {
              position: { x, y: 20 },
              rotation: 0,
              mirror: "none",
            },
          },
          connectionEdits: [
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: id, pinName: "P" },
              to: { kind: "terminal", instanceId: id, pinName: "P" },
              newNetId: `net-${id}`,
            },
          ],
          terminal: {
            id: `terminal-${id}`,
            name,
            netId: `net-${id}`,
            direction,
            interfaceInstanceIds: [id],
          },
        }),
      );
    const vddAt = (source: typeof project) =>
      createProjectHierarchicalSymbols(source)
        .flatMap((symbol) => symbol.pins)
        .find((pin) => pin.name === "VDDA_1V8")!.at;
    expect(vddAt(project)).toEqual({ x: 0, y: -40 });

    const parent = createEmptyDocument("ring", "Ring");
    project = { ...project, documents: [...project.documents, parent] };
    const cell = project.documents[0]!;
    const place = (source: typeof project, id: string) =>
      planPlaceCellInstance(
        source,
        parent.id,
        createHierarchyInstance(id, source.documents[0]!, {
          position: { x: 100 * id.length, y: 0 },
          rotation: 0,
          mirror: "none",
        }),
      );
    const first = place(project, "X1");
    expect(first[0]).toMatchObject({
      kind: "transact_document",
      documentId: cell.id,
      edits: [
        {
          kind: "set_cell_symbol_presentation",
          presentation: {
            minimumBodySize: { width: 100, height: 60 },
            pinPlacements: [
              ...cell.presentation.cellSymbol!.pinPlacements!,
              { terminalId: "terminal-P2", side: "west", offset: 10 },
              { terminalId: "terminal-P3", side: "east", offset: 10 },
            ],
          },
        },
      ],
    });
    project = transact(project, "place-X1", first);
    // Placed, the block is the one it showed: VDD's pin has not moved.
    expect(vddAt(project)).toEqual({ x: 0, y: -40 });
    // A second placement leaves the Cell as it is.
    expect(place(project, "X12")).toHaveLength(1);
  });
  it("puts a new Cell's supply pins on the block's top and bottom, and leaves a placed Cell's layout alone (#1257)", () => {
    const pinOf = (
      source: ReturnType<typeof createEmptyProject>,
      id: string,
      symbolId: string,
      name: string,
      x: number,
    ) =>
      planCreateCellPin(source, source.topDocumentId, {
        instance: {
          id,
          symbolId,
          placement: {
            position: { x, y: 20 },
            rotation: 0 as const,
            mirror: "none" as const,
          },
        },
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: id, pinName: "P" },
            to: { kind: "terminal", instanceId: id, pinName: "P" },
            newNetId: `net-${id}`,
          },
        ],
        terminal: {
          id: `terminal-${id}`,
          name,
          netId: `net-${id}`,
          direction: symbolId === "vdd-port" ? "inout" : "input",
          interfaceInstanceIds: [id],
        },
      });
    const add = (
      source: ReturnType<typeof createEmptyProject>,
      ...pin: [string, string, string, number]
    ) => {
      const result = executeProjectTransaction(source, {
        transactionId: `add-${pin[0]}`,
        projectId: source.id,
        expectedStructureRevision: source.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: pinOf(source, ...pin),
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.project;
    };
    let project = createEmptyProject("project", "Stage");
    project = add(project, "P1", "vdd-port", "VDD", 0);
    project = add(project, "P2", "port", "VSS", 40);
    project = add(project, "P3", "port", "IN", 80);
    project = add(project, "P4", "port", "VDDA", 120);
    const cell = project.documents[0]!;
    expect(cell.presentation.cellSymbol?.pinPlacements).toEqual([
      { terminalId: "terminal-P1", side: "north", offset: 0 },
      { terminalId: "terminal-P2", side: "south", offset: 0 },
      { terminalId: "terminal-P4", side: "north", offset: 20 },
    ]);
    // The generated block draws them there: VDD above the body, VSS below.
    const symbol = createHierarchicalBlockSymbol(cell)!;
    const y = (name: string) =>
      symbol.pins.find((pin) => pin.name === name)!.at.y;
    expect(y("VDD")).toBeLessThan(y("IN"));
    expect(y("VSS")).toBeGreaterThan(y("IN"));

    // Once a parent has placed the Cell, a new supply pin takes the old
    // automatic slot, so drawings made with the symbol do not move.
    const parent = createEmptyDocument("parent", "Top");
    parent.instances.push({
      id: "X1",
      symbolId: "hierarchical-stage",
      reference: "X1",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: cell.id },
        parameters: {},
      },
    });
    const placed = { ...project, documents: [...project.documents, parent] };
    expect(
      pinOf(placed, "P5", "port", "VCC", 160)
        .flatMap((edit) =>
          edit.kind === "transact_document" ? edit.edits : [],
        )
        .some((edit) => edit.kind === "set_cell_symbol_presentation"),
    ).toBe(false);
  });

  it("creates a repeated Cell Pin name as an independent interface", () => {
    const project = createEmptyProject("project", "Project");
    const port = (id: string, x: number) => ({
      id,
      symbolId: "port",
      placement: {
        position: { x, y: 20 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    });
    const first = executeProjectTransaction(project, {
      transactionId: "add-port",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(project, project.topDocumentId, {
        instance: port("P1", 40),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "P1", pinName: "P" },
            newNetId: "net-in",
          },
        ],
        terminal: {
          id: "terminal-in",
          name: "IN",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      }),
    });
    expect(first.ok).toBe(true);

    if (!first.ok) throw new Error(first.error.message);
    const second = executeProjectTransaction(first.project, {
      transactionId: "add-independent-port",
      projectId: project.id,
      expectedStructureRevision: first.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planCreateCellPin(first.project, project.topDocumentId, {
        instance: port("P2", 200),
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P2", pinName: "P" },
            to: { kind: "terminal", instanceId: "P2", pinName: "P" },
            newNetId: "net-marker-p2",
          },
        ],
        terminal: {
          id: "terminal-in-copy",
          name: "in",
          netId: "net-marker-p2",
          direction: "output",
          interfaceInstanceIds: ["P2"],
        },
      }),
    });
    expect(second).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            netlist: {
              terminals: [
                {
                  id: "terminal-in",
                  name: "IN",
                  interfaceInstanceIds: ["P1"],
                  netId: "net-in",
                },
                {
                  id: "terminal-in-copy",
                  name: "in",
                  direction: "output",
                  interfaceInstanceIds: ["P2"],
                  netId: "net-marker-p2",
                },
              ],
            },
            nets: [
              {
                id: "net-in",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
              {
                id: "net-marker-p2",
                terminals: [{ instanceId: "P2", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
    if (!second.ok) throw new Error(second.error.message);
    const removedCopy = executeProjectTransaction(second.project, {
      transactionId: "remove-independent-port",
      projectId: project.id,
      expectedStructureRevision: second.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRemoveCellTerminal(
        second.project,
        project.topDocumentId,
        "terminal-in-copy",
        [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "P2", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "P2" },
        ],
      ),
    });
    expect(removedCopy).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            instances: [{ id: "P1" }],
            netlist: {
              terminals: [{ id: "terminal-in", interfaceInstanceIds: ["P1"] }],
            },
            nets: [
              {
                id: "net-in",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
  });

  it("switches VDD Power between one physical Cell interface and Global ownership", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "VDD1", symbolId: "vdd-port", placement: null },
      { id: "VDD2", symbolId: "vdd-port", placement: null },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "VDD1", pinName: "P" },
        { instanceId: "VDD2", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push(
      {
        id: "terminal-vdd1",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: ["VDD1"],
      },
      {
        id: "terminal-vdd2",
        name: "VDD",
        netId: "net-vdd",
        direction: "inout",
        interfaceInstanceIds: ["VDD2"],
      },
    );
    document.annotations.push(
      {
        id: "power-label-vdd1",
        kind: "power-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd1" },
        netId: "net-vdd",
        anchor: {
          kind: "object",
          objectId: "VDD1",
          localOffset: { x: 0, y: -10 },
          fallbackPosition: { x: 0, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
      {
        id: "power-label-vdd2",
        kind: "power-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd2" },
        netId: "net-vdd",
        anchor: {
          kind: "object",
          objectId: "VDD2",
          localOffset: { x: 0, y: -10 },
          fallbackPosition: { x: 0, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );

    const global = executeProjectTransaction(project, {
      transactionId: "vdd-global",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetVddConnectionMode(project, document.id, "VDD1", "global"),
    });
    expect(global.ok).toBe(true);
    if (!global.ok) return;
    const globalDocument = global.project.documents[0]!;
    expect(globalDocument.netlist?.terminals).toEqual([]);
    expect(globalDocument.connectivityEvidence).toEqual([
      expect.objectContaining({
        kind: "name-claim",
        name: "VDD",
        scope: "global",
        owner: { kind: "power-marker", objectId: "VDD1" },
      }),
      expect.objectContaining({
        kind: "name-claim",
        name: "VDD",
        scope: "global",
        owner: { kind: "power-marker", objectId: "VDD2" },
      }),
    ]);
    expect(
      globalDocument.annotations.map((annotation) => annotation.binding),
    ).toEqual([
      { kind: "net-name", netId: "net-vdd" },
      { kind: "net-name", netId: "net-vdd" },
    ]);

    const local = executeProjectTransaction(global.project, {
      transactionId: "vdd-local",
      projectId: project.id,
      expectedStructureRevision: global.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetVddConnectionMode(
        global.project,
        document.id,
        "VDD1",
        "cell-pin",
      ),
    });
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const localDocument = local.project.documents[0]!;
    expect(localDocument.connectivityEvidence).toEqual([]);
    expect(localDocument.netlist?.terminals).toEqual([
      expect.objectContaining({
        name: "VDD",
        netId: "net-vdd",
        interfaceInstanceIds: ["VDD1"],
      }),
      expect.objectContaining({
        name: "VDD",
        netId: "net-vdd",
        interfaceInstanceIds: ["VDD2"],
      }),
    ]);
    expect(
      localDocument.annotations.map((annotation) => annotation.binding?.kind),
    ).toEqual(["cell-terminal-name", "cell-terminal-name"]);
  });

  it("returns no reorder transaction at an interface boundary", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    expect(
      planReorderCellTerminal(
        project,
        project.topDocumentId,
        "terminal-in",
        -1,
      ),
    ).toEqual([]);
  });

  it("updates and reorders a projected Port as one group", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
      { id: "P3", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-out",
        terminals: [
          { instanceId: "P1", pinName: "P" },
          { instanceId: "P3", pinName: "P" },
        ],
      },
      {
        id: "net-in",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-out-a",
        name: "OUT",
        netId: "net-out",
        direction: "passive",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
      {
        id: "terminal-out-b",
        name: "out",
        netId: "net-out",
        direction: "passive",
        interfaceInstanceIds: ["P3"],
      },
    );

    const directionEdits = planUpdateCellPortDirection(
      project,
      document.id,
      "terminal-out-a",
      "output",
    );
    expect(directionEdits).toEqual([
      expect.objectContaining({
        kind: "transact_document",
        edits: [
          expect.objectContaining({ terminalId: "terminal-out-a" }),
          expect.objectContaining({ terminalId: "terminal-out-b" }),
        ],
      }),
    ]);
    const directionResult = executeProjectTransaction(project, {
      transactionId: "set-port-direction",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: directionEdits,
    });
    expect(directionResult.ok).toBe(true);
    expect(directionResult.project.documents[0]!.netlist!.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "terminal-out-a", direction: "output" }),
        expect.objectContaining({ id: "terminal-out-b", direction: "output" }),
      ]),
    );

    const reorderEdits = planReorderCellPort(
      project,
      document.id,
      "terminal-in",
      -1,
    );
    expect(reorderEdits).toEqual([
      expect.objectContaining({
        kind: "transact_document",
        edits: [
          {
            kind: "reorder_cell_terminals",
            terminalIds: ["terminal-in", "terminal-out-a", "terminal-out-b"],
          },
        ],
      }),
    ]);
    const reorderResult = executeProjectTransaction(project, {
      transactionId: "reorder-port",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: reorderEdits,
    });
    expect(reorderResult.ok).toBe(true);
    expect(
      reorderResult.project.documents[0]!.netlist!.terminals.map(
        (terminal) => terminal.id,
      ),
    ).toEqual(["terminal-in", "terminal-out-a", "terminal-out-b"]);
  });

  it("keeps a Pin's display alias through a rename, and binds an older label that reads its name", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    for (const [pin, name] of [
      ["P1", "V_ref"],
      ["P2", "B"],
    ] as const) {
      document.instances.push({ id: pin, symbolId: "port", placement: null });
      document.nets.push({
        id: `net-${pin}`,
        terminals: [{ instanceId: pin, pinName: "P" }],
      });
      document.netlist!.terminals.push({
        id: `terminal-${pin}`,
        name,
        netId: `net-${pin}`,
        direction: "input",
        interfaceInstanceIds: [pin],
      });
    }
    const written = (
      id: string,
      objectId: string,
      runs: RichTextDocument["runs"],
    ): Annotation => ({
      id,
      kind: "instance-label",
      content: { runs },
      anchor: {
        kind: "object",
        objectId,
        localOffset: { x: 10, y: 0 },
        fallbackPosition: { x: 10, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.annotations.push(
      // An older label, written V with a subscript ref: V_ref's own name.
      written("label-P1", "P1", [
        { kind: "text", value: "V" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "ref" }],
        },
      ]),
      // Text of its own: B's display alias.
      written("label-P2", "P2", [{ kind: "text", value: "Bias" }]),
    );
    const childEdits = (terminalId: string, name: string) => {
      const [edit] = planRenameCellTerminal(
        project,
        document.id,
        terminalId,
        name,
      );
      return edit?.kind === "transact_document" ? edit.edits : [];
    };
    expect(childEdits("terminal-P1", "V_bias")).toEqual([
      {
        kind: "update_cell_terminal",
        terminalId: "terminal-P1",
        name: "V_bias",
      },
      {
        kind: "upsert_schematic_annotation",
        annotation: expect.objectContaining({
          id: "label-P1",
          binding: { kind: "cell-terminal-name", terminalId: "terminal-P1" },
        }),
      },
    ]);
    expect(childEdits("terminal-P2", "C")).toEqual([
      { kind: "update_cell_terminal", terminalId: "terminal-P2", name: "C" },
    ]);
  });

  it("renames a Cell Pin to an existing name without merging identity or Net", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-in-a",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-in-b",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.netlist!.terminals.push(
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-alias",
        name: "ALIAS",
        netId: "net-in-b",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
    );

    const result = executeProjectTransaction(project, {
      transactionId: "merge-cell-pins",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRenameCellTerminal(
        project,
        document.id,
        "terminal-alias",
        "in",
      ),
    });

    expect(result).toMatchObject({
      ok: true,
      project: {
        documents: [
          {
            netlist: {
              terminals: [
                {
                  id: "terminal-in",
                  name: "IN",
                  netId: "net-in-a",
                  interfaceInstanceIds: ["P1"],
                },
                {
                  id: "terminal-alias",
                  name: "in",
                  netId: "net-in-b",
                  interfaceInstanceIds: ["P2"],
                },
              ],
            },
            nets: [
              {
                id: "net-in-a",
                terminals: [{ instanceId: "P1", pinName: "P" }],
              },
              {
                id: "net-in-b",
                terminals: [{ instanceId: "P2", pinName: "P" }],
              },
            ],
          },
        ],
      },
    });
  });
});

describe("reviewed external MOS model targets", () => {
  function projectWithNmos() {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "M1",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "generic_nmos" },
        parameters: { w: "2u", l: "150n", m: "2" },
      },
    });
    document.nets.push({
      id: "net-drain",

      terminals: [{ instanceId: "M1", pinName: "D" }],
    });
    document.junctions.push({
      id: "junction-drain",
      netId: "net-drain",
      position: { x: 0, y: -40 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-drain",
        netId: "net-drain",
        start: { kind: "terminal", instanceId: "M1", pinName: "D" },
        end: { kind: "junction", junctionId: "junction-drain" },
        bends: [],
        modes: ["auto"],
      }),
    );
    document.noConnects.push({
      id: "open-bulk",
      endpoint: { kind: "terminal", instanceId: "M1", pinName: "B" },
    });
    return project;
  }

  it("creates a SKY130 interface and atomically adopts its ngspice X reference", () => {
    const project = projectWithNmos();
    const edits = planSetDeviceModelTarget(
      project,
      project.topDocumentId,
      "M1",
      "sky130_fd_pr__nfet_01v8",
    );
    const result = executeProjectTransaction(project, {
      transactionId: "set-sky130-model",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const instance = result.project.documents[0]!.instances[0]!;
    expect(result.project.externalSubcircuitDefinitions[0]).toMatchObject({
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
      formalParameters: [
        { name: "w", defaultValue: "1" },
        { name: "l", defaultValue: "0.15" },
        { name: "nf", defaultValue: "1" },
        { name: "m", defaultValue: "1" },
      ],
    });
    expect(instance).toMatchObject({
      symbolId: "nmos",
      reference: "M1",
      netlist: {
        parameters: { w: "2u", l: "150n", m: "2" },
        binding: { kind: "external-subcircuit" },
      },
    });
    expect(result.project.documents[0]!.nets[0]!.terminals).toEqual([
      { instanceId: "M1", pinName: "D" },
    ]);
    expect(result.project.documents[0]!.routes[0]!.start).toEqual({
      kind: "terminal",
      instanceId: "M1",
      pinName: "D",
    });
    expect(result.project.documents[0]!.noConnects[0]!.endpoint).toEqual({
      kind: "terminal",
      instanceId: "M1",
      pinName: "B",
    });
  });

  it("places a reviewed external master with canonical MOS artwork", () => {
    const project = projectWithNmos();
    const result = executeProjectTransaction(project, {
      transactionId: "create-sky130-definition",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      createExternalSubcircuitInstance(
        "X2",
        result.project.externalSubcircuitDefinitions[0]!,
        {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      ),
    ).toMatchObject({
      symbolId: "nmos",
      netlist: {
        binding: { kind: "external-subcircuit" },
      },
    });
  });

  it("returns a reviewed SKY130 X call to an ordinary MOS model without deleting its interface", () => {
    const source = projectWithNmos();
    const externalResult = executeProjectTransaction(source, {
      transactionId: "set-sky130-model",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        source,
        source.topDocumentId,
        "M1",
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    expect(externalResult.ok).toBe(true);
    if (!externalResult.ok) return;
    const project = externalResult.project;
    const result = executeProjectTransaction(project, {
      transactionId: "set-generic-model",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "generic_nmos",
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "nmos",
      reference: "M1",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "generic_nmos" },
      },
    });
    expect(result.project.externalSubcircuitDefinitions).toHaveLength(1);
  });

  it("rejects a PFET master on an NMOS symbol", () => {
    const project = projectWithNmos();
    expect(() =>
      planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "M1",
        "sky130_fd_pr__pfet_01v8",
      ),
    ).toThrow(/not compatible/u);
  });

  it("gives a DMOS the 16 V device's size only when SKY130 has no model at its own (#1483)", () => {
    for (const fixture of [
      // W 1 µm / L 0.15 µm is no 16 V size: the device's own W 5 µm and
      // L 0.7 µm (N) or 0.66 µm (P) replace it; the count stays.
      {
        symbolId: "ndmos",
        target: "sky130_fd_pr__nfet_g5v0d16v0",
        parameters: { w: "1u", l: "150n", nf: "1", m: "2" },
        expected: { w: "5u", l: "700n", nf: "1", m: "2" },
      },
      {
        symbolId: "pdmos",
        target: "sky130_fd_pr__pfet_g5v0d16v0",
        parameters: { w: "1u", l: "150n", nf: "1", m: "1" },
        expected: { w: "5u", l: "660n", nf: "1", m: "1" },
      },
      // Sizes SKY130 does model stay: N W 20 µm at L 2.2 µm, P W 30 µm at L 2.16 µm.
      {
        symbolId: "ndmos",
        target: "sky130_fd_pr__nfet_g5v0d16v0",
        parameters: { w: "20u", l: "2.2u", nf: "1", m: "1" },
        expected: { w: "20u", l: "2.2u", nf: "1", m: "1" },
      },
      {
        symbolId: "pdmos",
        target: "sky130_fd_pr__pfet_g5v0d16v0",
        parameters: { w: "30u", l: "2.16u", nf: "1", m: "1" },
        expected: { w: "30u", l: "2.16u", nf: "1", m: "1" },
      },
      // A W expression with L 0.7 µm may be one of them, so both stay; with
      // L 0.15 µm no W is, so L becomes the device's own and the W
      // expression stays.
      {
        symbolId: "ndmos",
        target: "sky130_fd_pr__nfet_g5v0d16v0",
        parameters: { w: "{wd}", l: "700n", nf: "1", m: "1" },
        expected: { w: "{wd}", l: "700n", nf: "1", m: "1" },
      },
      {
        symbolId: "ndmos",
        target: "sky130_fd_pr__nfet_g5v0d16v0",
        parameters: { w: "{wd}", l: "150n", nf: "1", m: "1" },
        expected: { w: "{wd}", l: "700n", nf: "1", m: "1" },
      },
    ] as const) {
      const project = createEmptyProject("project", "Project");
      project.documents[0]!.instances.push({
        id: "M1",
        symbolId: fixture.symbolId,
        placement: null,
        reference: "M1",
        netlist: { parameters: { ...fixture.parameters } },
      });
      const result = executeProjectTransaction(project, {
        transactionId: "set-16v-model",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          project,
          project.topDocumentId,
          "M1",
          fixture.target,
        ),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.project.documents[0]!.instances[0]!.netlist).toEqual({
        binding: {
          kind: "external-subcircuit",
          definitionId: result.project.externalSubcircuitDefinitions[0]!.id,
        },
        parameters: fixture.expected,
      });
    }
  });

  it("reuses frozen passive symbols and replaces scalar values with reviewed geometry", () => {
    for (const fixture of [
      {
        symbolId: "resistor",
        reference: "R1",
        target: "sky130_fd_pr__res_high_po",
        terminalNames: ["R0", "R1", "B"],
        parameters: { w: "1u", l: "5.5u", mult: "1" },
      },
      {
        symbolId: "capacitor",
        reference: "C1",
        target: "sky130_fd_pr__cap_mim_m3_1",
        terminalNames: ["C0", "C1"],
        parameters: { w: "5u", l: "5u", mf: "1" },
      },
    ] as const) {
      const project = createEmptyProject("project", "Project");
      project.documents[0]!.instances.push({
        id: fixture.reference,
        symbolId: fixture.symbolId,
        placement: null,
        reference: fixture.reference,
        netlist: {
          binding: {
            kind: "primitive",
            deviceClass: fixture.symbolId,
          },
          parameters: { value: "10k" },
        },
      });
      const result = executeProjectTransaction(project, {
        transactionId: `set-${fixture.symbolId}-target`,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          project,
          project.topDocumentId,
          fixture.reference,
          fixture.target,
        ),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.project.documents[0]!.instances[0]).toMatchObject({
        symbolId: fixture.symbolId,
        reference: fixture.reference,
        netlist: {
          binding: { kind: "external-subcircuit" },
          parameters: fixture.parameters,
        },
      });
      expect(
        result.project.externalSubcircuitDefinitions[0]!.terminals.map(
          (terminal) => terminal.name,
        ),
      ).toEqual(fixture.terminalNames);

      const cleared = executeProjectTransaction(result.project, {
        transactionId: `clear-${fixture.symbolId}-target`,
        projectId: result.project.id,
        expectedStructureRevision: result.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          result.project,
          result.project.topDocumentId,
          fixture.reference,
          "",
        ),
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) continue;
      expect(cleared.project.documents[0]!.instances[0]).toMatchObject({
        symbolId: fixture.symbolId,
        reference: fixture.reference,
        netlist: {
          binding: { kind: "primitive", deviceClass: fixture.symbolId },
          parameters: {},
        },
      });
    }
  });

  it("keeps a BJT's parallel count through its SKY130 wrapper and back (#1251)", () => {
    // A bandgap's 1:8 emitter ratio is this count; dropping it silently
    // describes a different circuit.
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push(
      {
        id: "Q2",
        symbolId: "pnp",
        placement: null,
        reference: "Q2",
        netlist: { parameters: { m: "8" } },
      },
      {
        id: "Q3",
        symbolId: "npn",
        placement: null,
        reference: "Q3",
        netlist: {
          binding: { kind: "model", deviceClass: "bjt", name: "generic_npn" },
          parameters: {},
        },
      },
    );
    const bind = (
      source: typeof project,
      instanceId: string,
      model: string,
    ) => {
      const result = executeProjectTransaction(source, {
        transactionId: `bind-${instanceId}-${model}`,
        projectId: source.id,
        expectedStructureRevision: source.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetDeviceModelTarget(
          source,
          source.topDocumentId,
          instanceId,
          model,
        ),
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.project;
    };
    const parameters = (source: typeof project, id: string) =>
      source.documents[0]!.instances.find((instance) => instance.id === id)!
        .netlist!.parameters;
    const external = bind(
      bind(project, "Q2", "sky130_fd_pr__pnp_05v5_W0p68L0p68"),
      "Q3",
      "sky130_fd_pr__npn_05v5_W1p00L1p00",
    );
    expect(parameters(external, "Q2")).toEqual({ m: "8" });
    // A device given no count takes the one it means.
    expect(parameters(external, "Q3")).toEqual({ m: "1" });
    expect(parameters(bind(external, "Q2", "generic_pnp"), "Q2")).toEqual({
      m: "8",
    });
  });

  it("switches the ordinary PNP between a primitive model and its exact SKY130 wrapper", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push({
      id: "Q1",
      symbolId: "pnp",
      placement: null,
      reference: "Q1",
      netlist: {
        binding: { kind: "model", deviceClass: "bjt", name: "generic_pnp" },
        parameters: {},
      },
    });
    const external = executeProjectTransaction(project, {
      transactionId: "set-sky130-pnp",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        project.topDocumentId,
        "Q1",
        "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      ),
    });
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(external.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "pnp",
      reference: "Q1",
      netlist: {
        binding: { kind: "external-subcircuit" },
        parameters: {},
      },
    });
    expect(external.project.externalSubcircuitDefinitions[0]).toMatchObject({
      name: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      terminals: [{ name: "C" }, { name: "B" }, { name: "E" }],
    });

    const ordinary = executeProjectTransaction(external.project, {
      transactionId: "set-generic-pnp",
      projectId: external.project.id,
      expectedStructureRevision: external.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        external.project,
        external.project.topDocumentId,
        "Q1",
        "generic_pnp",
      ),
    });
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) return;
    expect(ordinary.project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "pnp",
      reference: "Q1",
      netlist: {
        binding: { kind: "model", deviceClass: "bjt", name: "generic_pnp" },
        parameters: {},
      },
    });
  });
});

describe("arranging a Cell's block Pins by name (#1320)", () => {
  type Project = ReturnType<typeof createEmptyProject>;
  function commit(project: Project, edits: readonly ProjectStructureEdit[]) {
    const result = executeProjectTransaction(project, {
      transactionId: "edit",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  }
  /**
   * An SRAM cell drawn as a textbook draws it: bl and wl on the left, blb on
   * the right, VDD above and VSS below. Unplaced, its block shows VDD north
   * 0, VSS south 0, bl west -10, wl west 10 and blb east 0 (#1319).
   */
  function sram(): Project {
    const empty = createEmptyProject("project", "Array");
    let project: Project = {
      ...empty,
      documents: [...empty.documents, createEmptyDocument("sram6t", "sram6t")],
    };
    for (const [id, symbolId, name, x, y] of [
      ["P-VDD", "vdd-port", "VDD", 100, 0],
      ["P-VSS", "port", "VSS", 100, 300],
      ["P-bl", "port", "bl", 0, 100],
      ["P-blb", "port", "blb", 200, 100],
      ["P-wl", "port", "wl", 0, 200],
    ] as const)
      project = commit(
        project,
        planCreateCellPin(project, "sram6t", {
          instance: {
            id,
            symbolId,
            placement: { position: { x, y }, rotation: 0, mirror: "none" },
          },
          connectionEdits: [
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: id, pinName: "P" },
              to: { kind: "terminal", instanceId: id, pinName: "P" },
              newNetId: `net-${name}`,
            },
          ],
          terminal: {
            id: `terminal-${name}`,
            name,
            netId: `net-${name}`,
            direction: "inout",
            interfaceInstanceIds: [id],
          },
        }),
      );
    return project;
  }
  function placed(): Project {
    const project = sram();
    return commit(
      project,
      planPlaceCellInstance(
        project,
        project.topDocumentId,
        createHierarchyInstance("X1", project.documents[1]!, {
          position: { x: 400, y: 400 },
          rotation: 0,
          mirror: "none",
        }),
      ),
    );
  }
  /** The block's Pins by name: the side each faces and its offset. */
  const block = (project: Project) =>
    Object.fromEntries(
      createProjectHierarchicalSymbols(project)
        .find((symbol) => symbol.id === hierarchicalSymbolId("sram6t"))!
        .pins.map((pin) => [
          pin.name,
          `${pin.direction} ${
            pin.direction === "west" || pin.direction === "east"
              ? pin.at.y
              : pin.at.x
          }`,
        ]),
    );
  const pins = (
    project: Project,
    request: Parameters<typeof planSetCellSymbolPins>[2],
  ) => planSetCellSymbolPins(project, "sram6t", request);

  it("swaps two Pins' sides on a placed Cell and leaves the rest where they stood", () => {
    const project = placed();
    expect(block(project)).toEqual({
      VDD: "north 0",
      VSS: "south 0",
      bl: "west -10",
      blb: "east 0",
      wl: "west 10",
    });
    const swapped = commit(
      project,
      pins(project, [
        { name: "bl", side: "east", offset: 0 },
        { name: "blb", side: "west", offset: -10 },
      ]),
    );
    expect(block(swapped)).toEqual({
      VDD: "north 0",
      VSS: "south 0",
      bl: "east 0",
      blb: "west -10",
      wl: "west 10",
    });
    // Every Pin is stored, so no later rule moves the ones not named.
    expect(
      swapped.documents[1]!.presentation.cellSymbol!.pinPlacements,
    ).toHaveLength(5);
  });

  it("gives a Pin with no offset the first free slot on its new side, and keeps one that stays on its side", () => {
    // Unplaced, the layout its first placement would store is kept.
    const project = sram();
    // The east side is empty, so bl takes 0. West 0 lies half a row from
    // wl at 10, so blb takes -20, a full row from it; wl stays.
    expect(
      block(
        commit(
          project,
          pins(project, [
            { name: "bl", side: "east" },
            { name: "blb", side: "west" },
            { name: "wl", side: "west" },
          ]),
        ),
      ),
    ).toEqual({
      VDD: "north 0",
      VSS: "south 0",
      bl: "east 0",
      blb: "west -20",
      wl: "west 10",
    });
    // An offset given takes its slot before the free ones are handed out.
    expect(
      block(
        commit(
          project,
          pins(project, [
            { name: "bl", side: "east" },
            { name: "wl", side: "east", offset: -20 },
          ]),
        ),
      ),
    ).toMatchObject({ blb: "east 0", wl: "east -20", bl: "east 20" });
    // Naming Pins where they already stand changes nothing.
    expect(
      pins(project, [
        { name: "bl", side: "west" },
        { name: "BLB", side: "east" },
      ]),
    ).toEqual([]);
  });

  it("refuses an unknown name, a shared slot, a Pin named twice and an offset off the grid", () => {
    const project = placed();
    expect(() => pins(project, [{ name: "bll", side: "west" }])).toThrow(
      'sram6t has no Pin "bll"; its Pins: VDD, VSS, bl, blb, wl. Nothing was changed.',
    );
    expect(() =>
      pins(project, [{ name: "blb", side: "west", offset: 10 }]),
    ).toThrow(
      "blb and wl would stand on one slot, west 10. Free on west, in the order a Pin with no offset takes them: -40, 40, -60, 60. Nothing was changed.",
    );
    expect(() =>
      pins(project, [
        { name: "bl", side: "east", offset: 20 },
        { name: "wl", side: "east", offset: 20 },
      ]),
    ).toThrow(
      "wl and bl would stand on one slot, east 20. Free on east, in the order a Pin with no offset takes them: -20, -40, 40, -60. Nothing was changed.",
    );
    expect(() =>
      pins(project, [
        { name: "bl", side: "east" },
        { name: "BL", side: "west" },
      ]),
    ).toThrow("Pin bl is named twice. Nothing was changed.");
    expect(() =>
      pins(project, [{ name: "bl", side: "east", offset: 15 }]),
    ).toThrow("bl's offset 15 is not a multiple of 10. Nothing was changed.");
  });

  describe("sizing the block (#1879)", () => {
    /** The block's body, from its drawn polygon. */
    const body = (project: Project) => {
      const polygon = createProjectHierarchicalSymbols(project)
        .find((symbol) => symbol.id === hierarchicalSymbolId("sram6t"))!
        .primitives.find((primitive) => primitive.kind === "polygon")!;
      const points = polygon.kind === "polygon" ? polygon.points : [];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
    };
    const size = (project: Project, width: number, height: number) =>
      planSetCellSymbolSize(project, "sram6t", { width, height });

    it("offers only off-grid neighbours that fit (#1879)", () => {
      // Placed, the block is 80 x 100: VDD and VSS have room for their names.
      expect(() => size(placed(), 70, 100)).toThrow(
        "sram6t's block is centred on its origin, so a width of 70 puts its edges off the 10-unit grid: use a multiple of 20, such as 80. Nothing was changed.",
      );
      expect(() => size(placed(), 80, 130)).toThrow(
        "such as 120 or 140. Nothing was changed.",
      );
    });

    it("moves explicit edges from their top-left corner, as far in as the Pins allow (#1879)", () => {
      let project = placed();
      const stored = project.documents[1]!.presentation.cellSymbol!;
      project = commit(
        project,
        planSetCellSymbolPresentation(project, "sram6t", {
          pinPlacements: stored.pinPlacements,
          bodyBounds: { left: -40, right: 40, top: -50, bottom: 50 },
        }),
      );
      // Explicit edges take any multiple of 10.
      expect(() => size(project, 95, 70)).toThrow(
        "sram6t's block keeps its edges on the 10-unit grid: a width of 95 is not a multiple of 10. Nothing was changed.",
      );
      // VDD at 0 on top stands 10 from the corner at a right edge of 10; wl
      // at 10 on the left, at a bottom edge of 20.
      expect(() => size(project, 40, 70)).toThrow(
        "sram6t's Pins need a body at least 50 wide and 70 high; 40 x 70 is too small. Nothing was changed.",
      );
      project = commit(project, size(project, 50, 70));
      expect(body(project)).toEqual({
        left: -40,
        right: 10,
        top: -50,
        bottom: 20,
      });
      expect(block(project)).toMatchObject({ wl: "west 10", VDD: "north 0" });
      expect(size(project, 50, 70)).toEqual([]);
    });
  });
});
