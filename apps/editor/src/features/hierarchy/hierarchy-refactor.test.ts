import { describe, expect, it } from "vitest";
import { visibleInstanceBounds } from "@icm/derived";
import {
  planSetDeviceModelTarget,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  createEmptyDocument,
  createEmptyProject,
  flattenRichText,
  plainNameDocument,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import { EditorDocumentController } from "../../document/document-controller";
import {
  cellFromSelectionRefusal,
  cellUses,
  planCellFromSelection,
  planFlattenInstance,
  planMakeUniqueCell,
  planReplaceCell,
  replacementCandidates,
  selectionCellPins,
} from "./hierarchy-refactor";

const XP_IN_AMPLIFIER = { documentId: "amplifier", instanceId: "XP" };

function commit(
  controller: EditorDocumentController,
  edits: ProjectStructureEdit[],
) {
  const result = controller.dispatchProjectTransaction({
    projectId: controller.project.id,
    expectedStructureRevision: controller.project.structureRevision,
    transactionId: `refactor-${controller.project.structureRevision}`,
    actor: { kind: "human", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result).slice(0, 1200)).toBe(true);
}

const cell = (controller: EditorDocumentController, id: string) =>
  controller.project.documents.find((item) => item.id === id)!;
const binding = (
  controller: EditorDocumentController,
  documentId: string,
  instanceId: string,
) =>
  cell(controller, documentId).instances.find((item) => item.id === instanceId)
    ?.netlist?.binding;
const netOf = (
  controller: EditorDocumentController,
  documentId: string,
  instanceId: string,
  pinName: string,
) =>
  cell(controller, documentId)
    .nets.find((net) =>
      net.terminals.some(
        (item) => item.instanceId === instanceId && item.pinName === pinName,
      ),
    )
    ?.terminals.map((item) => `${item.instanceId}.${item.pinName}`)
    .sort();

describe("hierarchy refactoring", () => {
  it("gives one instance its own copy of its Cell, undone in one step", () => {
    const controller = new EditorDocumentController(
      hierarchyNavigationFixture(),
    );
    const plan = planMakeUniqueCell(
      controller.project,
      { documentId: "channel", instanceId: "XA" },
      "amplifier-copy",
    );
    expect(plan.name).toBe("Amplifier_2");
    commit(controller, plan.edits);
    expect(binding(controller, "channel", "XA")).toEqual({
      kind: "subcircuit",
      childDocumentId: "amplifier-copy",
    });
    expect(
      cell(controller, "channel").instances.find((item) => item.id === "XA")
        ?.symbolId,
    ).toBe(hierarchicalSymbolId("Amplifier_2"));
    // The copy keeps the Pins and calls the same child.
    expect(netOf(controller, "channel", "XA", "IN")).toContain("XA.IN");
    expect(binding(controller, "amplifier-copy", "XP")).toEqual({
      kind: "subcircuit",
      childDocumentId: "pair",
    });
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(cell(controller, "amplifier-copy")).toBeUndefined();
    expect(binding(controller, "channel", "XA")).toEqual({
      kind: "subcircuit",
      childDocumentId: "amplifier",
    });
  });

  it("numbers a copy after its source and never reuses the bare stem", () => {
    const project = hierarchyNavigationFixture();
    const amplifier = project.documents.find(
      (item) => item.id === "amplifier",
    )!;
    amplifier.name = amplifier.netlist!.name = "stage_1";
    expect(
      planMakeUniqueCell(
        project,
        { documentId: "channel", instanceId: "XA" },
        "copy",
      ).name,
    ).toBe("stage_2");
  });

  it("refuses, in the plan itself, a replacement whose Pins differ", () => {
    const project = hierarchyNavigationFixture();
    const unused = project.documents.find((item) => item.id === "unused")!;
    unused.netlist!.terminals = unused.netlist!.terminals.filter(
      (pin) => pin.name !== "OUT",
    );
    const use = { documentId: project.topDocumentId, instanceId: "X1" };
    expect(
      replacementCandidates(project, [use], "channel").find(
        (item) => item.cell.id === "unused",
      )?.issue,
    ).toBe("Pins differ: no OUT");
    expect(() => planReplaceCell(project, [use], "unused")).toThrow(
      /Pins differ: no OUT/u,
    );
  });

  it("switches one or every use to a Cell with the same Pins, refusing cycles", () => {
    const controller = new EditorDocumentController(
      hierarchyNavigationFixture(),
    );
    const top = controller.project.topDocumentId;
    const candidates = replacementCandidates(
      controller.project,
      [{ documentId: top, instanceId: "X1" }],
      "channel",
    );
    const issue = (id: string) =>
      candidates.find((item) => item.cell.id === id)?.issue;
    expect(issue("unused")).toBeUndefined();
    expect(issue(top)).toMatch(/cannot contain itself/u);
    commit(
      controller,
      planReplaceCell(
        controller.project,
        [{ documentId: top, instanceId: "X1" }],
        "unused",
      ),
    );
    expect(binding(controller, top, "X1")).toEqual({
      kind: "subcircuit",
      childDocumentId: "unused",
    });
    expect(binding(controller, top, "X2")).toEqual({
      kind: "subcircuit",
      childDocumentId: "channel",
    });
    commit(
      controller,
      planReplaceCell(
        controller.project,
        cellUses(controller.project, "channel"),
        "amplifier",
      ),
    );
    expect(binding(controller, top, "X2")).toEqual({
      kind: "subcircuit",
      childDocumentId: "amplifier",
    });
    expect(netOf(controller, top, "X2", "OUT")).toContain("X2.OUT");
  });

  it("moves selected parts into a new Cell whose Pins join the Nets they left", () => {
    const controller = new EditorDocumentController(
      hierarchyNavigationFixture(),
    );
    const pins = selectionCellPins(controller.project, "pair", ["R1"]);
    expect(pins.map((pin) => pin.name)).toEqual(["IN", "OUT"]);
    const plan = planCellFromSelection(
      controller.project,
      "pair",
      ["R1"],
      "resistor-cell",
      "resistor_cell",
      pins,
      1,
    );
    commit(controller, plan.edits);
    const child = cell(controller, "resistor-cell");
    expect(child.netlist?.terminals.map((pin) => pin.name)).toEqual([
      "IN",
      "OUT",
    ]);
    // The part's parameter reference stays live, passed through the new Cell.
    expect(child.netlist?.formalParameters.map((item) => item.name)).toEqual([
      "gain",
    ]);
    const pair = cell(controller, "pair");
    expect(pair.instances.some((item) => item.id === "R1")).toBe(false);
    expect(binding(controller, "pair", plan.instanceId)).toEqual({
      kind: "subcircuit",
      childDocumentId: "resistor-cell",
    });
    expect(
      pair.instances.find((item) => item.id === plan.instanceId)?.netlist
        ?.parameters,
    ).toEqual({ gain: "{gain}" });
    expect(netOf(controller, "pair", plan.instanceId, "IN")).toEqual(
      ["P_IN.P", `${plan.instanceId}.IN`].sort(),
    );
    expect(netOf(controller, "pair", plan.instanceId, "OUT")).toEqual(
      ["P_OUT.P", `${plan.instanceId}.OUT`].sort(),
    );
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(cell(controller, "resistor-cell")).toBeUndefined();
    expect(
      cell(controller, "pair").instances.some((item) => item.id === "R1"),
    ).toBe(true);
  });

  it("flattens an instance into its parent with its parameter values", () => {
    const controller = new EditorDocumentController(
      hierarchyNavigationFixture(),
    );
    const plan = planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1);
    expect(plan.childName).toBe("Pair");
    commit(controller, plan.edits);
    const amplifier = cell(controller, "amplifier");
    expect(amplifier.instances.some((item) => item.id === "XP")).toBe(false);
    const resistor = amplifier.instances.find(
      (item) => item.symbolId === "resistor",
    );
    expect(resistor?.netlist?.parameters).toEqual({ value: "{gain}" });
    // Nothing else is placed there, so the part stays where the block was.
    expect(plan.instanceIds).toEqual([resistor!.id]);
    expect(resistor?.placement?.position).toEqual({ x: 200, y: 200 });
    expect(netOf(controller, "amplifier", resistor!.id, "1")).toEqual(
      ["P_IN.P", `${resistor!.id}.1`].sort(),
    );
    expect(netOf(controller, "amplifier", resistor!.id, "2")).toEqual(
      ["P_OUT.P", `${resistor!.id}.2`].sort(),
    );
    // Other uses of the flattened Cell keep calling it.
    expect(binding(controller, "unused", "XP")).toEqual({
      kind: "subcircuit",
      childDocumentId: "pair",
    });
    expect(controller.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(binding(controller, "amplifier", "XP")).toEqual({
      kind: "subcircuit",
      childDocumentId: "pair",
    });
  });

  describe("a rebound instance keeps its look", () => {
    /** A nor-gate X1 in Top bound to Cell nor2; nor2b has the same Pins. */
    const gateProject = () => {
      const project = createEmptyProject("gates", "Gates", "top");
      const top = project.documents[0]!;
      top.instances.push({
        id: "X1",
        reference: "X1",
        symbolId: "nor-gate",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "unresolved-subcircuit", name: "nor_gate" },
          parameters: {},
        },
      });
      top.nets.push(
        ...["A", "B", "Y", "VDD"].map((pin) => ({
          id: `net-${pin}`,
          terminals: [{ instanceId: "X1", pinName: pin }],
        })),
      );
      for (const id of ["nor2", "nor2b"]) {
        const cell = createEmptyDocument(id, id);
        cell.netlist!.name = id;
        for (const pin of ["a", "b", "y", "VDD", "VSS"]) {
          cell.instances.push({
            id: `${id}-${pin}`,
            symbolId: "port",
            placement: null,
          });
          cell.nets.push({
            id: `${id}-net-${pin}`,
            terminals: [{ instanceId: `${id}-${pin}`, pinName: "P" }],
          });
          cell.netlist!.terminals.push({
            id: `${id}-t-${pin}`,
            name: pin,
            netId: `${id}-net-${pin}`,
            direction: "inout",
            interfaceInstanceIds: [`${id}-${pin}`],
          });
        }
        project.documents.push(cell);
      }
      const controller = new EditorDocumentController(project);
      commit(
        controller,
        planSetDeviceModelTarget(controller.project, "top", "X1", "nor2"),
      );
      return controller;
    };
    const gate = (controller: EditorDocumentController) =>
      cell(controller, "top").instances.find((item) => item.id === "X1")!;

    it("keeps a Library gate's symbol through Make unique copy and Replace", () => {
      const controller = gateProject();
      expect(gate(controller).symbolId).toBe("nor-gate");
      const use = { documentId: "top", instanceId: "X1" };
      commit(controller, planReplaceCell(controller.project, [use], "nor2b"));
      expect(gate(controller)).toMatchObject({
        symbolId: "nor-gate",
        netlist: { binding: { childDocumentId: "nor2b" } },
      });
      commit(
        controller,
        planMakeUniqueCell(controller.project, use, "nor2b-copy").edits,
      );
      expect(gate(controller)).toMatchObject({
        symbolId: "nor-gate",
        netlist: { binding: { childDocumentId: "nor2b-copy" } },
      });
    });

    it("shows the new Cell's name beside a block", () => {
      const project = hierarchyNavigationFixture();
      project.documents
        .find((item) => item.id === "channel")!
        .annotations.push({
          id: "instance-master-XA",
          kind: "instance-value",
          content: plainNameDocument("Amplifier"),
          anchor: {
            kind: "object",
            objectId: "XA",
            localOffset: { x: 0, y: 40 },
            fallbackPosition: { x: 200, y: 240 },
          },
          alignment: "middle",
          rotation: 0,
          locked: false,
        });
      const controller = new EditorDocumentController(project);
      const plan = planMakeUniqueCell(
        controller.project,
        { documentId: "channel", instanceId: "XA" },
        "amplifier-copy",
      );
      commit(controller, plan.edits);
      const label = cell(controller, "channel").annotations.find(
        (item) => item.id === "instance-master-XA",
      );
      expect(flattenRichText(label!.content!)).toBe("Amplifier_2");
    });
  });

  describe("Nets the child joins by name", () => {
    /** A resistor between two new Nets of `cell`, placed at `x`. */
    const resistor = (
      target: SchematicDocument,
      id: string,
      x: number,
      nets: [string, string],
    ) => {
      target.instances.push({
        id,
        reference: id,
        symbolId: "resistor",
        placement: { position: { x, y: 400 }, rotation: 0, mirror: "none" },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      });
      nets.forEach((netId, index) => {
        const net = target.nets.find((item) => item.id === netId);
        const terminal = { instanceId: id, pinName: String(index + 1) };
        if (net) net.terminals.push(terminal);
        else target.nets.push({ id: netId, terminals: [terminal] });
      });
    };
    /** A label naming `netId`, as the canvas draws one. */
    const label = (
      target: SchematicDocument,
      netId: string,
      name: string,
      scope: "local" | "global" = "local",
      powerDomain?: "vdd" | "ground",
    ) => {
      const annotationId = `label-${netId}-${target.annotations.length}`;
      target.annotations.push({
        id: annotationId,
        kind: powerDomain ? "power-label" : "net-label",
        netId,
        binding: { kind: "net-name", netId },
        anchor: { kind: "free", position: { x: 300, y: 340 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      target.connectivityEvidence.push({
        id: `claim-${annotationId}`,
        kind: "name-claim",
        netId,
        name,
        owner: { kind: "net-label", annotationId },
        scope,
        ...(powerDomain ? { powerDomain } : {}),
      });
    };
    /** The node each listed device's first pin is on, in `cellName`. */
    const firstNodes = (project: CircuitProject, cellName: string) => {
      const exported = createDesignNetlistExport(project);
      if (exported.status !== "ready")
        throw new Error(JSON.stringify(exported));
      const body = exported.file.text.split(`.subckt ${cellName} `)[1]!;
      return Object.fromEntries(
        body
          .split(`.ends ${cellName}`)[0]!
          .split("\n")
          .slice(1)
          .flatMap((line) => {
            const [reference, node] = line.trim().split(/\s+/u);
            return reference && node ? [[reference, node]] : [];
          }),
      );
    };
    const flatten = (project: CircuitProject) => {
      const controller = new EditorDocumentController(project);
      commit(
        controller,
        planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1).edits,
      );
      return controller.project;
    };

    it("stay one Net, renamed where the parent has the name", () => {
      const project = hierarchyNavigationFixture();
      const pair = project.documents.find((item) => item.id === "pair")!;
      resistor(pair, "R2", 300, ["a", "IN"]);
      resistor(pair, "R3", 400, ["b", "IN"]);
      label(pair, "a", "MID");
      label(pair, "b", "MID");
      const amplifier = project.documents.find(
        (item) => item.id === "amplifier",
      )!;
      resistor(amplifier, "R9", 600, ["m", "IN"]);
      label(amplifier, "m", "MID");
      expect(firstNodes(project, "Pair")).toMatchObject({
        R2: "MID",
        R3: "MID",
      });

      const nodes = firstNodes(flatten(project), "Amplifier");
      // Both parts stay on one Net, which keeps the child's name apart from
      // the parent's own MID.
      expect(nodes["R9"]).toBe("MID");
      expect(
        Object.entries(nodes).filter(([, node]) => node === "XP_MID"),
      ).toHaveLength(2);
    });

    it("join the parent's Net where the name is also a Pin's", () => {
      const project = hierarchyNavigationFixture();
      const pair = project.documents.find((item) => item.id === "pair")!;
      resistor(pair, "R2", 300, ["a", "OUT"]);
      label(pair, "a", "IN");
      const nodes = firstNodes(flatten(project), "Amplifier");
      expect(Object.values(nodes).filter((node) => node === "IN")).toHaveLength(
        2,
      );
    });

    it("keep a global supply name", () => {
      const project = hierarchyNavigationFixture();
      const pair = project.documents.find((item) => item.id === "pair")!;
      resistor(pair, "R2", 300, ["v", "IN"]);
      label(pair, "v", "VDD", "global", "vdd");
      const before = firstNodes(project, "Pair")["R2"];
      const nodes = firstNodes(flatten(project), "Amplifier");
      expect(Object.values(nodes)).toContain(before);
    });
  });

  it("keeps an inner Net's name, prefixed where the parent has it", () => {
    const project = hierarchyNavigationFixture();
    const pair = project.documents.find((item) => item.id === "pair")!;
    // IN - R1 - mid - R2 - OUT
    pair.nets[1]!.terminals = [
      { instanceId: "P_OUT", pinName: "P" },
      { instanceId: "R2", pinName: "2" },
    ];
    pair.nets.push({
      id: "MID",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    pair.instances.push({
      id: "R2",
      reference: "R2",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    const hint = (netId: string) => ({
      id: `hint-${netId}`,
      kind: "net-name-hint" as const,
      netId,
      sourceName: "mid",
      origin: "spice-import" as const,
    });
    pair.connectivityEvidence.push(hint("MID"));
    project.documents
      .find((item) => item.id === "amplifier")!
      .connectivityEvidence.push(hint("IN"));
    const controller = new EditorDocumentController(project);
    commit(
      controller,
      planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1).edits,
    );
    const amplifier = cell(controller, "amplifier");
    const named = amplifier.connectivityEvidence.find(
      (item) => item.kind === "net-name-hint" && item.sourceName === "XP_mid",
    );
    expect(
      amplifier.nets
        .find((net) => net.id === named?.netId)
        ?.terminals.map((item) => item.pinName)
        .sort(),
    ).toEqual(["1", "2"]);
  });

  it("puts flattened parts beside the parent's own parts, not on them", () => {
    const project = hierarchyNavigationFixture();
    project.documents
      .find((item) => item.id === "amplifier")!
      .instances.push({
        id: "R9",
        reference: "R9",
        symbolId: "resistor",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { parameters: { value: "1k" } },
      });
    const controller = new EditorDocumentController(project);
    const plan = planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1);
    commit(controller, plan.edits);
    const [part] = cell(controller, "amplifier").instances.filter((item) =>
      plan.instanceIds.includes(item.id),
    );
    expect(part?.symbolId).toBe("resistor");
    const boxes = visibleInstanceBounds(
      cell(controller, "amplifier"),
      createProjectSymbolResolver(controller.project, builtInSymbols),
    );
    const box = (id: string) => boxes.find((item) => item.id === id)!.bounds;
    expect(box(part!.id).x).toBeGreaterThan(box("R9").x + box("R9").width);
  });

  it("binds a quoted expression to the instance's value when flattening", () => {
    const project = hierarchyNavigationFixture();
    const pair = project.documents.find((item) => item.id === "pair")!;
    pair.instances.find((item) => item.id === "R1")!.netlist!.parameters = {
      value: "'2*gain'",
    };
    project.documents
      .find((item) => item.id === "amplifier")!
      .instances.find((item) => item.id === "XP")!.netlist!.parameters = {
      gain: "5",
    };
    const controller = new EditorDocumentController(project);
    commit(
      controller,
      planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1).edits,
    );
    expect(
      cell(controller, "amplifier").instances.find(
        (item) => item.symbolId === "resistor",
      )?.netlist?.parameters,
    ).toEqual({ value: "'2*(5)'" });
  });

  describe("with coupled inductors in the child", () => {
    const coupledFixture = () => {
      const project = hierarchyNavigationFixture();
      const pair = project.documents.find((item) => item.id === "pair")!;
      for (const [id, x] of [
        ["L1", 300],
        ["L2", 400],
      ] as const)
        pair.instances.push({
          id,
          reference: id,
          symbolId: "inductor",
          placement: { position: { x, y: 300 }, rotation: 0, mirror: "none" },
          netlist: { parameters: { value: "1u" } },
        });
      pair.inductorCouplings = [
        {
          id: "k1",
          name: "K1",
          members: [
            { instanceId: "L1", dotPin: "1" },
            { instanceId: "L2", dotPin: "1" },
          ],
          k: "{gain}",
        },
      ];
      return project;
    };

    it("flattening brings the coupling, with the instance's values", () => {
      const controller = new EditorDocumentController(coupledFixture());
      commit(
        controller,
        planFlattenInstance(controller.project, XP_IN_AMPLIFIER, 1).edits,
      );
      const amplifier = cell(controller, "amplifier");
      const [coupling] = amplifier.inductorCouplings ?? [];
      // XP passes {gain} on, so the coupling still reads the parent's gain.
      expect(coupling?.k).toBe("{gain}");
      expect(
        coupling!.members.map(
          (member) =>
            amplifier.instances.find((item) => item.id === member.instanceId)
              ?.symbolId,
        ),
      ).toEqual(["inductor", "inductor"]);
    });

    it("a new Cell from a selection refuses to split the coupling", () => {
      expect(() =>
        planCellFromSelection(
          coupledFixture(),
          "pair",
          ["L1"],
          "half",
          "half",
          [],
          1,
        ),
      ).toThrow(/both inductors of K1/u);
    });

    it("says before planning why parts cannot become a Cell", () => {
      const project = coupledFixture();
      expect(cellFromSelectionRefusal(project, "pair", ["L1"])).toMatch(
        /both inductors of K1/u,
      );
      expect(cellFromSelectionRefusal(project, "pair", ["P_IN"])).toBe(
        "Select the parts to move into the new Cell",
      );
      expect(cellFromSelectionRefusal(project, "pair", ["R1"])).toBeUndefined();
    });
  });
});
