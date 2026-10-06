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
} from "@icm/symbols";
import { analyzeDesignNetlist } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import {
  planReorderCellTerminal,
  planSetCellSymbolPins,
  planRenameCellTerminal,
  planCreateCellPin,
  planRemoveCellTerminal,
} from "./hierarchy-planner.js";

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
