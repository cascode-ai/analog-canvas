import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  type SchematicDocument,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  withProjectComponentDefinitions,
  createBlockSymbol,
  hierarchicalBlockLabelWarnings,
} from "@icm/symbols";
import { proposeBlockSymbolLayout } from "./cell-symbol-layout.js";
import { analyzeDesignNetlist } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import {
  planReorderCellTerminal,
  planCreateCellPin,
} from "./cell-pin-planner.js";
import {
  planSetCellSymbolPins,
  planSetCellSymbolPresentation,
} from "./hierarchy-planner.js";
import {
  planRenameCellTerminal,
  planRemoveCellTerminal,
} from "./cell-interface-change-planner.js";

function addPorts(document: SchematicDocument) {
  for (const name of ["A", "B"]) {
    const marker = `marker-${name}`;
    document.instances.push({
      id: marker,
      symbolId: "port",
      placement: {
        position: { x: name === "A" ? 0 : 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: name,
      terminals: [{ instanceId: marker, pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: `port-${name}`,
      name,
      netId: name,
      direction: "passive",
      interfaceInstanceIds: [marker],
    });
  }
}

function nestedProject() {
  const project = createEmptyProject(
    "nested-contract",
    "Nested contract",
    "root",
  );
  const root = project.documents[0]!;
  const middle = createEmptyDocument("middle", "middle"),
    leaf = createEmptyDocument("leaf", "leaf");
  project.documents.push(middle, leaf);
  for (const document of project.documents) addPorts(document);
  for (const [caller, child] of [
    [root, middle],
    [middle, leaf],
  ] as const) {
    caller.instances.push({
      id: "call",
      reference: "X1",
      symbolId: hierarchicalSymbolId(child.id),
      placement: { position: { x: 50, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    for (const name of ["A", "B"])
      caller.nets
        .find((net) => net.id === name)!
        .terminals.push({ instanceId: "call", pinName: name });
  }
  leaf.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: { parameters: { value: "1k" } },
  });
  leaf.nets[0]!.terminals.push({ instanceId: "R1", pinName: "1" });
  leaf.nets[1]!.terminals.push({ instanceId: "R1", pinName: "2" });
  return withProjectComponentDefinitions(project);
}

describe("nested hierarchy shares one semantic interface after Project round trips", () => {
  it("moves a mixed-side selection along each edge tangent in one Project change", () => {
    const project = nestedProject(),
      leaf = project.documents.find((cell) => cell.id === "leaf")!;
    const proposal = proposeBlockSymbolLayout(
      {
        id: "layout",
        name: "leaf",
        terminals: leaf.netlist!.terminals,
        presentation: {
          bodyBounds: { left: -60, right: 60, top: -60, bottom: 60 },
          pinPlacements: [
            { terminalId: "port-A", side: "west", offset: -20 },
            { terminalId: "port-B", side: "north", offset: 0 },
          ],
        },
      },
      {
        kind: "move-pins",
        terminalIds: ["port-A", "port-B"],
        delta: { x: 20, y: 10 },
      },
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const result = executeProjectTransaction(project, {
      transactionId: "mixed",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetCellSymbolPresentation(
        project,
        leaf.id,
        proposal.presentation,
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.documents.find((cell) => cell.id === "leaf")!.presentation
        .cellSymbol?.pinPlacements,
    ).toEqual([
      { terminalId: "port-A", side: "west", offset: -10 },
      { terminalId: "port-B", side: "north", offset: 20 },
    ]);
    expect(analyzeDesignNetlist(result.project).ir).toEqual(
      analyzeDesignNetlist(project).ir,
    );
  });
  it.each([
    [
      "west",
      { x: -80, y: 999 },
      { left: -80, right: 40, top: -20, bottom: 20 },
    ],
    ["east", { x: 90, y: 999 }, { left: -40, right: 90, top: -20, bottom: 20 }],
    [
      "north",
      { x: 999, y: -60 },
      { left: -40, right: 40, top: -60, bottom: 20 },
    ],
    [
      "south",
      { x: 999, y: 70 },
      { left: -40, right: 40, top: -20, bottom: 70 },
    ],
    [
      "north-west",
      { x: -80, y: -60 },
      { left: -80, right: 40, top: -60, bottom: 20 },
    ],
    [
      "north-east",
      { x: 90, y: -60 },
      { left: -40, right: 90, top: -60, bottom: 20 },
    ],
    [
      "south-west",
      { x: -80, y: 70 },
      { left: -80, right: 40, top: -20, bottom: 70 },
    ],
    [
      "south-east",
      { x: 90, y: 70 },
      { left: -40, right: 90, top: -20, bottom: 70 },
    ],
  ] as const)(
    "resizes %s while fixing its opposite edges through the Project transaction",
    (grip, point, bounds) => {
      const project = nestedProject(),
        leaf = project.documents.find((cell) => cell.id === "leaf")!;
      const proposal = proposeBlockSymbolLayout(
        { id: "layout", name: "leaf", terminals: leaf.netlist!.terminals },
        { kind: "resize", grip, point },
      );
      expect(proposal.ok).toBe(true);
      if (!proposal.ok) return;
      const result = executeProjectTransaction(project, {
        transactionId: "grip",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetCellSymbolPresentation(
          project,
          leaf.id,
          proposal.presentation,
        ),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.project.documents.find((cell) => cell.id === "leaf")!
          .presentation.cellSymbol?.bodyBounds,
      ).toEqual(bounds);
      expect(analyzeDesignNetlist(result.project).ir).toEqual(
        analyzeDesignNetlist(project).ir,
      );
    },
  );
  it("keeps uneven same-side spacing when arranging onto another side and treats tangent-free nudges as no-ops", () => {
    const project = nestedProject();
    const leaf = project.documents.find((cell) => cell.id === "leaf")!;
    const layout = {
      id: "layout",
      name: "leaf",
      terminals: leaf.netlist!.terminals,
      presentation: {
        bodyBounds: { left: -60, right: 60, top: -60, bottom: 60 },
        pinPlacements: [
          { terminalId: "port-A", side: "west" as const, offset: -30 },
          { terminalId: "port-B", side: "west" as const, offset: 10 },
        ],
      },
    };
    const proposal = proposeBlockSymbolLayout(layout, {
      kind: "arrange-pins",
      terminalIds: ["port-B", "port-A"],
      side: "north",
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const result = executeProjectTransaction(project, {
      transactionId: "arrange",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetCellSymbolPresentation(
        project,
        "leaf",
        proposal.presentation,
      ),
    });
    expect(result.ok).toBe(true);
    expect(
      createBlockSymbol({
        ...layout,
        presentation: proposal.presentation,
      }).pins.map((pin) => pin.at),
    ).toEqual([
      { x: -20, y: -70 },
      { x: 20, y: -70 },
    ]);
    expect(
      proposeBlockSymbolLayout(layout, {
        kind: "move-pins",
        terminalIds: ["port-A"],
        delta: { x: 10, y: 0 },
      }),
    ).toMatchObject({ ok: true, changed: false });
  });
  it("refuses explicit bounds that leave an automatic pin outside the body", () => {
    const project = nestedProject();
    const result = executeProjectTransaction(project, {
      transactionId: "bad-bounds",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPresentation(project, "leaf", {
        bodyBounds: { left: -10, right: 10, top: 0, bottom: 20 },
      }),
    });
    expect(result.ok).toBe(false);
  });
  it("moves a pin selection as a group and refuses an occupied result without changing the Project", () => {
    const project = nestedProject();
    const leaf = project.documents.find((cell) => cell.id === "leaf")!;
    const layout = {
      id: hierarchicalSymbolId("leaf"),
      name: "leaf",
      terminals: leaf.netlist!.terminals,
      presentation: {
        bodyBounds: { left: -60, right: 60, top: -60, bottom: 60 },
        pinPlacements: [
          { terminalId: "port-A", side: "west" as const, offset: -20 },
          { terminalId: "port-B", side: "west" as const, offset: 0 },
        ],
      },
    };
    const moved = proposeBlockSymbolLayout(layout, {
      kind: "move-pins",
      terminalIds: ["port-A", "port-B"],
      delta: { x: 0, y: 20 },
      side: "east",
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const result = executeProjectTransaction(project, {
      transactionId: "group",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetCellSymbolPresentation(project, "leaf", moved.presentation),
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(
      createBlockSymbol({
        ...layout,
        presentation: moved.presentation,
      }).pins.map((pin) => pin.at),
    ).toEqual([
      { x: 70, y: 0 },
      { x: 70, y: 20 },
    ]);
    expect(analyzeDesignNetlist(result.project).ir).toEqual(
      analyzeDesignNetlist(project).ir,
    );
    const rejected = proposeBlockSymbolLayout(
      { ...layout, presentation: moved.presentation },
      { kind: "move-pins", terminalIds: ["port-A"], delta: { x: 0, y: 20 } },
    );
    expect(rejected).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/occupied/iu),
    });
  });
  it("persists an asymmetric body without moving callers or changing their ordered connections", () => {
    const project = nestedProject();
    const before = analyzeDesignNetlist(project).ir;
    const bounds = { left: -40, right: 100, top: -30, bottom: 70 };
    const result = executeProjectTransaction(project, {
      transactionId: "asymmetric-body",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetCellSymbolPresentation(project, "leaf", {
        bodyBounds: bounds,
        pinPlacements: [
          { terminalId: "port-A", side: "west", offset: 0 },
          { terminalId: "port-B", side: "east", offset: 20 },
        ],
      }),
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const restored = parseProject(serializeProject(result.project));
    const oldEnvelope = JSON.parse(serializeProject(result.project));
    oldEnvelope.schemaVersion = 73;
    expect(() => parseProject(JSON.stringify(oldEnvelope))).toThrow(
      /requires Project schema 74/iu,
    );
    expect(
      restored.documents.find((cell) => cell.id === "leaf")!.presentation
        .cellSymbol?.bodyBounds,
    ).toEqual(bounds);
    expect(
      restored.documents
        .find((cell) => cell.id === "middle")!
        .instances.find((instance) => instance.id === "call")!.placement,
    ).toEqual({ position: { x: 50, y: 100 }, rotation: 0, mirror: "none" });
    const symbol = createProjectSymbolResolver(
      restored,
      builtInSymbols,
    ).resolve(hierarchicalSymbolId("leaf"))!.definition;
    expect(symbol.primitives[0]).toMatchObject({
      points: [
        { x: -40, y: -30 },
        { x: 100, y: -30 },
        { x: 100, y: 70 },
        { x: -40, y: 70 },
      ],
    });
    expect(symbol.pins.map((pin) => pin.at)).toEqual([
      { x: -50, y: 0 },
      { x: 110, y: 20 },
    ]);
    expect(analyzeDesignNetlist(restored).ir).toEqual(before);
    const svg = renderDocumentSvg(
      restored.documents.find((cell) => cell.id === "middle")!,
      createProjectSymbolResolver(restored, builtInSymbols),
    );
    expect(svg).not.toContain("cell-symbol-layout-overlay");
    const renamed = executeProjectTransaction(restored, {
      transactionId: "long-name",
      projectId: restored.id,
      expectedStructureRevision: restored.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planRenameCellTerminal(
        restored,
        "leaf",
        "port-A",
        "A_very_long_formal_pin_name_that_does_not_resize_the_authored_body",
      ),
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const named = renamed.project.documents.find((cell) => cell.id === "leaf")!;
    expect(named.presentation.cellSymbol?.bodyBounds).toEqual(bounds);
    expect(
      hierarchicalBlockLabelWarnings(
        named.netlist!.terminals,
        named.presentation.cellSymbol,
      ),
    ).not.toEqual([]);
  });
  it("keeps identities through layout, order and rename edits while snapshots refresh", () => {
    let project = nestedProject();
    const apply = (edits: readonly ProjectStructureEdit[]) => {
      const result = executeProjectTransaction(project, {
        transactionId: "interface-edit",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: [...edits],
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (result.ok) project = parseProject(serializeProject(result.project));
    };
    const before = analyzeDesignNetlist(project);
    expect(before.ir, JSON.stringify(before.diagnostics)).not.toBeNull();
    apply(
      planSetCellSymbolPins(project, "leaf", [
        { name: "A", side: "east", offset: 20 },
        { name: "B", side: "west", offset: -20 },
      ]),
    );
    expect(analyzeDesignNetlist(project).ir).toEqual(before.ir);
    apply(planReorderCellTerminal(project, "leaf", "port-A", 1));
    apply(planRenameCellTerminal(project, "leaf", "port-A", "INPUT"));
    const analysis = analyzeDesignNetlist(project);
    expect(analysis.ir, JSON.stringify(analysis.diagnostics)).not.toBeNull();
    const leaf = analysis.ir!.cells.find((cell) => cell.id === "leaf")!;
    const call = analysis
      .ir!.cells.find((cell) => cell.id === "middle")!
      .instances.find((instance) => instance.id === "call")!;
    expect(leaf.ports.map((port) => port.name)).toEqual(["B", "INPUT"]);
    expect(call.nodes).toEqual([
      { pinName: "B", netName: "B" },
      { pinName: "INPUT", netName: "A" },
    ]);
    expect(
      createProjectSymbolResolver(project, builtInSymbols)
        .resolve(hierarchicalSymbolId("leaf"))!
        .definition.pins.map((pin) => pin.name),
    ).toEqual(["B", "INPUT"]);
    const rootCall = analysis
      .ir!.cells.find((cell) => cell.id === "root")!
      .instances.find((instance) => instance.id === "call")!;
    expect(rootCall.nodes).toEqual([
      { pinName: "A", netName: "A" },
      { pinName: "B", netName: "B" },
    ]);
    const renamed = analysis.ir;
    apply(
      planCreateCellPin(project, "leaf", {
        instance: {
          id: "marker-C",
          symbolId: "port",
          placement: {
            position: { x: 200, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "marker-C", pinName: "P" },
            to: { kind: "terminal", instanceId: "marker-C", pinName: "P" },
            newNetId: "C",
          },
        ],
        terminal: {
          id: "port-C",
          name: "C",
          direction: "passive",
          netId: "C",
          interfaceInstanceIds: ["marker-C"],
        },
      }),
    );
    expect(
      createProjectSymbolResolver(project, builtInSymbols)
        .resolve(hierarchicalSymbolId("leaf"))!
        .definition.pins.map((pin) => pin.name),
    ).toEqual(["B", "INPUT", "C"]);
    // A newly added caller pin is explicitly unconnected, never guessed onto A/B.
    expect(
      project.documents
        .find((document) => document.id === "middle")!
        .nets.every((net) =>
          net.terminals.every((terminal) => terminal.pinName !== "C"),
        ),
    ).toBe(true);
    apply(planRemoveCellTerminal(project, "leaf", "port-C"));
    expect(analyzeDesignNetlist(project).ir).toEqual(renamed);
  });
});
