import {
  createRoutePath,
  createSimulationFolder,
  flattenRichText,
  plainNameDocument,
  roleLabelFormat,
  semanticTextDocument,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  buildProjectConnectivityIndex,
  diagnoseVisualQuality,
  resolveEndpointPoint,
  runErcChecks,
} from "@icm/derived";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  projectCellSymbolTerminals,
} from "@icm/symbols";

import {
  planRenameCell,
  planRemoveCellTerminal,
  planRemoveCellTerminals,
  planEditCellTerminalAnnotation,
  planRenameCellTerminal,
  planSetCellSymbolPresentation,
  planSetDeviceModelTarget,
  createExternalSubcircuitInstance,
} from "./hierarchy-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

describe("default project entry", () => {
  it("keeps captured artwork immutable and rolls back a conflicting batch", () => {
    const project = createEmptyProject("capture", "Capture");
    const snapshot = {
      symbol: {
        ...structuredClone(builtInSymbols.find((s) => s.id === "resistor")!),
        id: "captured-resistor",
      },
    };
    const envelope = {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: "capture",
      actor: { kind: "human" as const, id: "local" },
    };
    const first = executeProjectTransaction(project, {
      ...envelope,
      edits: [{ kind: "capture_component_definition", definition: snapshot }],
    });
    if (!first.ok) throw new Error(JSON.stringify(first));
    const repeated = executeProjectTransaction(first.project, {
      ...envelope,
      expectedStructureRevision: first.project.structureRevision,
      edits: [{ kind: "capture_component_definition", definition: snapshot }],
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) throw new Error(JSON.stringify(repeated));
    expect(repeated.project.componentDefinitions).toEqual([snapshot]);
    const original = structuredClone(first.project);
    const rejected = executeProjectTransaction(first.project, {
      ...envelope,
      expectedStructureRevision: first.project.structureRevision,
      edits: [
        {
          kind: "add_document",
          document: createEmptyDocument("must-rollback", "Must roll back"),
        },
        {
          kind: "capture_component_definition",
          definition: {
            symbol: {
              ...snapshot.symbol,
              name: "Changed under same ID",
            },
          },
        },
      ],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected capture conflict");
    expect(rejected.error.message).toContain("Captured artwork is immutable");
    expect(first.project).toEqual(original);
  });
  it("reorders definitions atomically with Top without changing their contents", () => {
    const project = createEmptyProject("order", "Order");
    project.documents.push(
      createEmptyDocument("second", "Second"),
      createEmptyDocument("third", "Third"),
    );
    const original = structuredClone(project);
    const envelope = {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: "order",
      actor: { kind: "human" as const, id: "local" },
    };
    const ids = ["third", project.topDocumentId, "second"];
    const result = executeProjectTransaction(project, {
      ...envelope,
      edits: [
        { kind: "reorder_documents", documentIds: ids },
        { kind: "set_top_document", documentId: "third" },
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.project.topDocumentId).toBe("third");
    expect(result.project.documents).toEqual(
      ids.map((id) => original.documents.find((cell) => cell.id === id)),
    );
    for (const invalid of [
      ["second"],
      ["second", "second", "third"],
      ["unknown", "second", "third"],
    ]) {
      const rejected = executeProjectTransaction(project, {
        ...envelope,
        edits: [
          { kind: "set_top_document", documentId: "third" },
          { kind: "reorder_documents", documentIds: invalid },
        ],
      });
      expect(rejected.ok).toBe(false);
      expect(project).toEqual(original);
    }
  });
  it("changes only the default Top and rejects unknown definitions", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    const original = structuredClone(project);
    const envelope = {
      transactionId: "set-top",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human" as const, id: "local" },
    };
    const result = executeProjectTransaction(project, {
      ...envelope,
      edits: [{ kind: "set_top_document", documentId: child.id }],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.project.topDocumentId).toBe(child.id);
    expect(result.project.documents).toEqual(original.documents);
    expect(result.project.simulationFolders).toEqual(
      original.simulationFolders,
    );
    expect(project).toEqual(original);
    const rejected = executeProjectTransaction(project, {
      ...envelope,
      edits: [{ kind: "set_top_document", documentId: "missing" }],
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
  });
});

function hierarchyInstance(
  id: string,
  cellName: string,
  childDocumentId: string,
) {
  return {
    id,
    symbolId: hierarchicalSymbolId(cellName),
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    reference: id,
    netlist: {
      parameters: {},
      binding: {
        kind: "subcircuit" as const,
        childDocumentId,
      },
    },
  };
}

function addCellPin(
  document: ReturnType<typeof createEmptyDocument>,
  input: {
    instanceId: string;
    terminalId: string;
    name: string;
    netId: string;
    direction?: "input" | "output" | "inout" | "passive";
  },
): void {
  document.instances.push({
    id: input.instanceId,
    symbolId: "port",
    placement: null,
  });
  document.nets.push({
    id: input.netId,
    terminals: [{ instanceId: input.instanceId, pinName: "P" }],
  });
  document.netlist!.terminals.push({
    id: input.terminalId,
    name: input.name,
    netId: input.netId,
    direction: input.direction ?? "input",
    interfaceInstanceIds: [input.instanceId],
  });
}

describe("Project structural transaction", () => {
  it.each([false, true])(
    "retains effective Port formatting after representative deletion (authored survivor: %s)",
    (authored) => {
      const project = createEmptyProject("project", "Project");
      const child = createEmptyDocument("child", "Child");
      project.documents.push(child);
      const formatted = {
        runs: [
          { kind: "text" as const, value: "V" },
          {
            kind: "span" as const,
            style: "subscript" as const,
            children: [{ kind: "text" as const, value: "out" }],
          },
        ],
      };
      for (const id of ["one", "two"]) {
        addCellPin(child, {
          instanceId: `P-${id}`,
          terminalId: id,
          name: "Vout",
          netId: `net-${id}`,
        });
        child.annotations.push({
          id: `label-${id}`,
          kind: "instance-label",
          binding: { kind: "cell-terminal-name", terminalId: id },
          anchor: {
            kind: "object",
            objectId: `P-${id}`,
            localOffset: { x: 0, y: 0 },
            fallbackPosition: { x: 0, y: 0 },
          },
          alignment: "middle",
          rotation: 0,
          locked: false,
          ...(id === "one"
            ? { formatOverride: formatted }
            : authored
              ? { formatOverride: plainNameDocument("Vout") }
              : {}),
        });
      }
      const result = executeProjectTransaction(project, {
        transactionId: "remove-formatted-marker",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "local" },
        edits: planRemoveCellTerminal(project, child.id, "one"),
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const updated = result.project.documents[1]!;
      expect(updated.annotations).toHaveLength(1);
      expect(projectCellSymbolTerminals(updated)[0]!.nameContent).toEqual(
        authored ? plainNameDocument("Vout") : formatted,
      );
      expect(child.annotations).toHaveLength(2);
    },
  );

  it("accepts a Gallery-sized nested document transaction within its bound", () => {
    const project = createEmptyProject("gallery-sized-project", "Gallery");
    const edits = Array.from({ length: 272 }, () => ({
      kind: "set_presentation_style" as const,
      styleProfileId: "razavi-textbook-v1",
    }));

    const result = executeProjectTransaction(project, {
      transactionId: "gallery-sized-paste",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: [
        {
          kind: "transact_document",
          documentId: project.documents[0]!.id,
          expectedRevision: project.documents[0]!.revision,
          edits,
        },
      ],
    });

    expect(result.ok).toBe(true);

    const oversized = executeProjectTransaction(project, {
      transactionId: "oversized-gallery-paste",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: [
        {
          kind: "transact_document",
          documentId: project.documents[0]!.id,
          expectedRevision: project.documents[0]!.revision,
          edits: Array.from({ length: 1_025 }, () => edits[0]!),
        },
      ],
    });
    expect(oversized).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSACTION" },
    });
  });

  it("deletes a Cell Pin and automatically disconnects every caller", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({ id: "P1", symbolId: "port", placement: null });
    child.nets.push({
      id: "net-in",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    project.documents[0]!.nets.push({
      id: "net-parent-in",

      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });
    project.documents[0]!.junctions.push({
      id: "junction-parent-tail",
      netId: "net-parent-in",
      position: { x: -100, y: 0 },
      role: "route-anchor",
    });
    project.documents[0]!.routes.push(
      createRoutePath({
        id: "route-parent-in",
        netId: "net-parent-in",
        start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
        end: { kind: "junction", junctionId: "junction-parent-tail" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "remove-cell-pin-cascade",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminal(project, child.id, "terminal-in", [
        {
          kind: "disconnect_endpoint",
          endpoint: { kind: "terminal", instanceId: "P1", pinName: "P" },
        },
        { kind: "remove_instance", instanceId: "P1" },
      ]),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updated = result.project.documents.find(
      (document) => document.id === child.id,
    )!;
    expect(updated.instances).toEqual([]);
    expect(updated.netlist?.terminals).toEqual([]);
    expect(updated.nets).toEqual([]);
    const parent = result.project.documents[0]!;
    expect(parent.instances).toEqual([expect.objectContaining({ id: "X1" })]);
    expect(parent.nets).toEqual([
      expect.objectContaining({ id: "net-parent-in", terminals: [] }),
    ]);
    expect(parent.routes).toEqual([
      expect.objectContaining({
        id: "route-parent-in",
        start: {
          kind: "junction",
          junctionId: expect.stringMatching(/^junction-lifecycle-/),
        },
        legs: [
          expect.objectContaining({
            to: {
              kind: "endpoint",
              endpoint: {
                kind: "junction",
                junctionId: "junction-parent-tail",
              },
            },
          }),
        ],
      }),
    ]);
    expect(parent.junctions).toHaveLength(2);
  });

  it("keeps the caller pin wired while another same-named Cell Pin remains", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "P1",
      terminalId: "terminal-in-1",
      name: "IN",
      netId: "net-in-1",
    });
    addCellPin(child, {
      instanceId: "P2",
      terminalId: "terminal-in-2",
      name: "in",
      netId: "net-in-2",
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    parent.instances.push(hierarchyInstance("X1", "Child", child.id));
    parent.nets.push({
      id: "net-parent-in",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });
    parent.junctions.push({
      id: "junction-parent-tail",
      netId: "net-parent-in",
      position: { x: -100, y: 0 },
      role: "route-anchor",
    });
    parent.routes.push(
      createRoutePath({
        id: "route-parent-in",
        netId: "net-parent-in",
        start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
        end: { kind: "junction", junctionId: "junction-parent-tail" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "remove-one-independent-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminal(project, child.id, "terminal-in-2"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updatedParent = result.project.documents[0]!;
    expect(updatedParent.nets[0]!.terminals).toEqual([
      { instanceId: "X1", pinName: "IN" },
    ]);
    expect(updatedParent.routes[0]!.start).toEqual({
      kind: "terminal",
      instanceId: "X1",
      pinName: "IN",
    });
    expect(updatedParent.junctions).toHaveLength(1);
    expect(result.project.documents[1]!.netlist!.terminals).toMatchObject([
      { id: "terminal-in-1", name: "IN", netId: "net-in-1" },
    ]);
  });

  it("renames one same-named Cell Pin without rewriting the surviving caller pin", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "P1",
      terminalId: "terminal-in-1",
      name: "IN",
      netId: "net-in-1",
    });
    addCellPin(child, {
      instanceId: "P2",
      terminalId: "terminal-in-2",
      name: "in",
      netId: "net-in-2",
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    parent.instances.push(hierarchyInstance("X1", "Child", child.id));
    parent.nets.push({
      id: "net-parent-in",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });

    const result = executeProjectTransaction(project, {
      transactionId: "rename-one-independent-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCellTerminal(project, child.id, "terminal-in-2", "AUX"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(result.project.documents[0]!.nets[0]!.terminals).toEqual([
      { instanceId: "X1", pinName: "IN" },
    ]);
    expect(result.project.documents[1]!.netlist!.terminals).toMatchObject([
      { id: "terminal-in-1", name: "IN", netId: "net-in-1" },
      { id: "terminal-in-2", name: "AUX", netId: "net-in-2" },
    ]);
  });

  it.each([false, true])(
    "joins a Port name with explicit electrical merge=%s",
    (mergeExistingPort) => {
      const project = createEmptyProject("project", "Project");
      const child = createEmptyDocument("document-child", "Child");
      addCellPin(child, {
        instanceId: "P1",
        terminalId: "terminal-old",
        name: "OLD",
        netId: "net-old",
      });
      addCellPin(child, {
        instanceId: "P2",
        terminalId: "terminal-new",
        name: "NEW",
        netId: "net-new",
      });
      project.documents.push(child);
      child.presentation.cellSymbol = {
        pinPlacements: [
          { terminalId: "terminal-old", side: "west", offset: 0 },
          { terminalId: "terminal-new", side: "north", offset: 20 },
        ],
      };
      const parent = project.documents[0]!;
      parent.instances.push(hierarchyInstance("X1", "Child", child.id));
      parent.nets.push(
        {
          id: "net-parent-old",
          terminals: [{ instanceId: "X1", pinName: "OLD" }],
        },
        {
          id: "net-parent-new",
          terminals: [{ instanceId: "X1", pinName: "NEW" }],
        },
      );
      parent.junctions.push({
        id: "junction-parent-tail",
        netId: "net-parent-old",
        position: { x: -100, y: 0 },
        role: "route-anchor",
      });
      parent.routes.push(
        createRoutePath({
          id: "route-parent-old",
          netId: "net-parent-old",
          start: { kind: "terminal", instanceId: "X1", pinName: "OLD" },
          end: { kind: "junction", junctionId: "junction-parent-tail" },
          bends: [],
          modes: ["manual"],
        }),
      );

      const result = executeProjectTransaction(project, {
        transactionId: "rename-final-old-pin-onto-existing-name",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "human-local" },
        edits: planRenameCellTerminal(
          project,
          child.id,
          "terminal-old",
          "new",
          { mergeExistingPort },
        ),
      });

      if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
      expect(
        result.project.documents[1]!.presentation.cellSymbol?.pinPlacements,
      ).toEqual([{ terminalId: "terminal-old", side: "north", offset: 20 }]);
      const updatedParent = result.project.documents[0]!;
      if (mergeExistingPort) {
        expect(updatedParent.nets).toEqual([
          expect.objectContaining({
            id: "net-parent-old",
            terminals: [{ instanceId: "X1", pinName: "new" }],
          }),
        ]);
        expect(updatedParent.routes[0]!.start).toEqual({
          kind: "terminal",
          instanceId: "X1",
          pinName: "new",
        });
        expect(updatedParent.routes[0]!.netId).toBe("net-parent-old");
        expect(updatedParent.junctions).toHaveLength(1);
        return;
      }
      expect(updatedParent.nets).toEqual([
        expect.objectContaining({ id: "net-parent-old", terminals: [] }),
        expect.objectContaining({
          id: "net-parent-new",
          terminals: [{ instanceId: "X1", pinName: "new" }],
        }),
      ]);
      expect(updatedParent.routes[0]!.start).toMatchObject({
        kind: "junction",
      });
      expect(updatedParent.routes[0]!.netId).toBe("net-parent-old");
      expect(
        updatedParent.junctions.filter(
          (junction) => junction.netId === "net-parent-old",
        ),
      ).toHaveLength(2);
      expect(updatedParent.nets).toHaveLength(2);
      expect(result.project.documents[1]!.nets).toMatchObject([
        { id: "net-old", terminals: [{ instanceId: "P1", pinName: "P" }] },
        { id: "net-new", terminals: [{ instanceId: "P2", pinName: "P" }] },
      ]);
      expect(result.project.documents[1]!.netlist!.terminals).toMatchObject([
        { id: "terminal-old", name: "new", netId: "net-old" },
        { id: "terminal-new", name: "NEW", netId: "net-new" },
      ]);
    },
  );

  it("merges shared caller Nets once and reconciles NoConnect declarations", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Child");
    for (const name of ["A", "B"])
      addCellPin(child, {
        instanceId: `P${name}`,
        terminalId: name,
        name,
        netId: `net-${name}`,
      });
    project.documents.push(child);
    const parent = project.documents[0]!;
    for (const id of ["X1", "X2", "X3", "X4"])
      parent.instances.push(hierarchyInstance(id, "Child", child.id));
    parent.nets.push(
      {
        id: "left",
        terminals: ["X1", "X2", "X3"].map((instanceId) => ({
          instanceId,
          pinName: "A",
        })),
      },
      {
        id: "right",
        terminals: ["X1", "X2"].map((instanceId) => ({
          instanceId,
          pinName: "B",
        })),
      },
    );
    parent.noConnects.push(
      {
        id: "nc3",
        endpoint: { kind: "terminal", instanceId: "X3", pinName: "B" },
      },
      {
        id: "nc4a",
        endpoint: { kind: "terminal", instanceId: "X4", pinName: "A" },
      },
      {
        id: "nc4b",
        endpoint: { kind: "terminal", instanceId: "X4", pinName: "B" },
      },
    );
    const result = executeProjectTransaction(project, {
      transactionId: "merge-shared-callers",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "local" },
      edits: planRenameCellTerminal(project, child.id, "A", "B", {
        mergeExistingPort: true,
      }),
    });
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updated = result.project.documents[0]!;
    expect(updated.nets).toHaveLength(1);
    expect(updated.nets[0]!.terminals).toEqual(
      ["X1", "X2", "X3"].map((instanceId) => ({ instanceId, pinName: "B" })),
    );
    expect(updated.noConnects).toEqual([
      {
        id: "nc4a",
        endpoint: { kind: "terminal", instanceId: "X4", pinName: "B" },
      },
    ]);
    expect(parent.nets).toHaveLength(2);
    expect(parent.noConnects).toHaveLength(3);
  });

  it("renames the surviving caller spelling when the first same-named Pin leaves its group", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "P1",
      terminalId: "terminal-in-1",
      name: "IN",
      netId: "net-in-1",
    });
    addCellPin(child, {
      instanceId: "P2",
      terminalId: "terminal-in-2",
      name: "in",
      netId: "net-in-2",
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    child.presentation.cellSymbol = {
      pinPlacements: [
        { terminalId: "terminal-in-1", side: "north", offset: 20 },
      ],
    };
    parent.instances.push(hierarchyInstance("X1", "Child", child.id));
    parent.nets.push({
      id: "net-parent-in",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });

    const result = executeProjectTransaction(project, {
      transactionId: "rename-representative-independent-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCellTerminal(project, child.id, "terminal-in-1", "AUX"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.project.documents[1]!.presentation.cellSymbol?.pinPlacements,
    ).toEqual([{ terminalId: "terminal-in-2", side: "north", offset: 20 }]);
    expect(result.project.documents[0]!.nets).toEqual([
      {
        id: "net-parent-in",
        terminals: [{ instanceId: "X1", pinName: "in" }],
      },
    ]);
    expect(result.project.documents[1]!.netlist!.terminals).toMatchObject([
      { id: "terminal-in-1", name: "AUX", netId: "net-in-1" },
      { id: "terminal-in-2", name: "in", netId: "net-in-2" },
    ]);
  });

  it("renames the surviving caller spelling when the first same-named Pin is deleted", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "P1",
      terminalId: "terminal-in-1",
      name: "IN",
      netId: "net-in-1",
    });
    addCellPin(child, {
      instanceId: "P2",
      terminalId: "terminal-in-2",
      name: "in",
      netId: "net-in-2",
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    child.presentation.cellSymbol = {
      pinPlacements: [
        { terminalId: "terminal-in-1", side: "north", offset: 20 },
      ],
    };
    parent.instances.push(hierarchyInstance("X1", "Child", child.id));
    parent.nets.push({
      id: "net-parent-in",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });
    parent.junctions.push({
      id: "junction-parent-tail",
      netId: "net-parent-in",
      position: { x: -100, y: 0 },
      role: "route-anchor",
    });
    parent.routes.push(
      createRoutePath({
        id: "route-parent-in",
        netId: "net-parent-in",
        start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
        end: { kind: "junction", junctionId: "junction-parent-tail" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "delete-representative-independent-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminal(project, child.id, "terminal-in-1"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.project.documents[1]!.presentation.cellSymbol?.pinPlacements,
    ).toEqual([{ terminalId: "terminal-in-2", side: "north", offset: 20 }]);
    const updatedParent = result.project.documents[0]!;
    expect(updatedParent.nets).toEqual([
      {
        id: "net-parent-in",
        terminals: [{ instanceId: "X1", pinName: "in" }],
      },
    ]);
    expect(updatedParent.routes).toEqual([
      expect.objectContaining({
        id: "route-parent-in",
        netId: "net-parent-in",
        start: { kind: "terminal", instanceId: "X1", pinName: "in" },
      }),
    ]);
    expect(updatedParent.junctions).toHaveLength(1);
    expect(result.project.documents[1]!.netlist!.terminals).toMatchObject([
      { id: "terminal-in-2", name: "in", netId: "net-in-2" },
    ]);
  });

  it("updates every caller reference surface for a case-only representative rename", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "P1",
      terminalId: "terminal-vin",
      name: "VIN",
      netId: "net-vin",
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    const connectedCaller = hierarchyInstance("X1", "Child", child.id);
    const openCaller = hierarchyInstance("X2", "Child", child.id);
    openCaller.placement.position = { x: 200, y: 0 };
    const importedCaller = {
      ...hierarchyInstance("X3", "Child", child.id),
      placement: {
        ...hierarchyInstance("X3", "Child", child.id).placement,
        position: { x: 400, y: 0 },
      },
      importProvenance: {
        kind: "subcircuit" as const,
        sourceMasterName: "Child",
        sourceTarget: `cell:${child.id}`,
        terminalMapping: [{ sourcePosition: 0, pinName: "VIN" }],
      },
    };
    parent.instances.push(connectedCaller, openCaller, importedCaller);
    parent.nets.push({
      id: "net-parent-vin",
      terminals: [{ instanceId: "X1", pinName: "VIN" }],
    });
    parent.junctions.push({
      id: "junction-parent-tail",
      netId: "net-parent-vin",
      position: { x: -100, y: 0 },
      role: "route-anchor",
    });
    parent.routes.push(
      createRoutePath({
        id: "route-parent-vin",
        netId: "net-parent-vin",
        start: { kind: "terminal", instanceId: "X1", pinName: "VIN" },
        end: { kind: "junction", junctionId: "junction-parent-tail" },
        bends: [],
        modes: ["manual"],
      }),
    );
    parent.noConnects.push({
      id: "no-connect-vin",
      endpoint: { kind: "terminal", instanceId: "X2", pinName: "VIN" },
    });

    const result = executeProjectTransaction(project, {
      transactionId: "case-only-representative-rename",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCellTerminal(project, child.id, "terminal-vin", "vin"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updatedParent = result.project.documents[0]!;
    expect(updatedParent.nets[0]!.terminals).toEqual([
      { instanceId: "X1", pinName: "vin" },
    ]);
    expect(updatedParent.routes[0]!.start).toEqual({
      kind: "terminal",
      instanceId: "X1",
      pinName: "vin",
    });
    expect(updatedParent.noConnects[0]!.endpoint).toEqual({
      kind: "terminal",
      instanceId: "X2",
      pinName: "vin",
    });
    expect(
      updatedParent.instances.find((instance) => instance.id === "X3")!
        .importProvenance?.terminalMapping,
    ).toEqual([{ sourcePosition: 0, pinName: "vin" }]);
    expect(updatedParent.nets).toHaveLength(1);
    expect(updatedParent.junctions).toHaveLength(1);
  });

  it("detaches both ends of a Wire between two callers of the same Cell", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({ id: "P1", symbolId: "port", placement: null });
    child.nets.push({
      id: "net-in",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    project.documents.push(child);
    const parent = project.documents[0]!;
    parent.instances.push(hierarchyInstance("X1", "Child", child.id), {
      ...hierarchyInstance("X2", "Child", child.id),
      placement: {
        position: { x: 200, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    parent.nets.push({
      id: "net-parent",
      terminals: [
        { instanceId: "X1", pinName: "IN" },
        { instanceId: "X2", pinName: "IN" },
      ],
    });
    parent.routes.push(
      createRoutePath({
        id: "route-between-callers",
        netId: "net-parent",
        start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
        end: { kind: "terminal", instanceId: "X2", pinName: "IN" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "remove-shared-caller-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminal(project, child.id, "terminal-in"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updatedParent = result.project.documents[0]!;
    expect(updatedParent.nets[0]?.terminals).toEqual([]);
    expect(updatedParent.routes[0]).toMatchObject({
      start: { kind: "junction" },
      legs: [{ to: { kind: "endpoint", endpoint: { kind: "junction" } } }],
    });
    expect(updatedParent.junctions).toHaveLength(2);
  });

  it("renames a Cell and reconciles every caller symbol", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    project.documents[0]!.annotations.push({
      id: "instance-master-X1",
      kind: "instance-value",
      content: plainNameDocument("Child"),
      anchor: {
        kind: "object",
        objectId: "X1",
        localOffset: { x: 0, y: -40 },
        fallbackPosition: { x: 0, y: -40 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const result = executeProjectTransaction(project, {
      transactionId: "rename-child",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCell(project, child.id, "Stage"),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: {
        documents: [
          {
            instances: [
              {
                symbolId: hierarchicalSymbolId("Stage"),
                netlist: { binding: { childDocumentId: child.id } },
              },
            ],
          },
          { name: "Stage", netlist: { name: "Stage" } },
        ],
      },
    });
    if (!result.ok) return;
    expect(
      flattenRichText(result.project.documents[0]!.annotations[0]!.content!),
    ).toBe("Stage");
  });

  it("preserves customized Cell master text while renaming its definition", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    project.documents[0]!.annotations.push({
      id: "instance-master-X1",
      kind: "instance-value",
      content: plainNameDocument("custom alias"),
      anchor: {
        kind: "object",
        objectId: "X1",
        localOffset: { x: 0, y: -40 },
        fallbackPosition: { x: 0, y: -40 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const result = executeProjectTransaction(project, {
      transactionId: "rename-child-with-custom-master-label",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCell(project, child.id, "Stage"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      flattenRichText(result.project.documents[0]!.annotations[0]!.content!),
    ).toBe("custom alias");
  });

  it("atomically creates a child Cell and its parent Instance", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    const result = executeProjectTransaction(project, {
      transactionId: "create-child",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: [
        { kind: "add_document", document: child },
        {
          kind: "transact_document",
          documentId: project.topDocumentId,
          expectedRevision: 0,
          edits: [
            {
              kind: "add_instance",
              instance: hierarchyInstance("X1", "Child", child.id),
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 1,
      changedDocumentIds: ["document-child", "document-main"],
      project: {
        structureRevision: 1,
        documents: [
          { id: "document-main", revision: 1, instances: [{ id: "X1" }] },
          { id: "document-child", revision: 0 },
        ],
      },
    });
    expect(project.documents).toHaveLength(1);
    expect(project.structureRevision).toBe(0);
  });

  it("returns a complete proposed Project from dry-run without mutation", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    const result = executeProjectTransaction(project, {
      transactionId: "dry-create-child",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "agent", id: "agent" },
      dryRun: true,
      edits: [{ kind: "add_document", document: child }],
    });

    expect(result).toMatchObject({
      ok: true,
      applied: false,
      structureRevision: 0,
      proposedStructureRevision: 1,
      project: { documents: [{ id: "document-main" }] },
      proposedProject: {
        structureRevision: 1,
        documents: [{ id: "document-main" }, { id: "document-child" }],
      },
    });
  });

  it("rejects stale revisions and referenced or top Cell deletion", () => {
    const project = createEmptyProject("project", "Project");
    expect(
      executeProjectTransaction(project, {
        transactionId: "stale",
        projectId: project.id,
        expectedStructureRevision: 1,
        actor: { kind: "human", id: "human-local" },
        edits: [{ kind: "remove_document", documentId: project.topDocumentId }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_STRUCTURE_REVISION" },
    });

    expect(
      executeProjectTransaction(project, {
        transactionId: "delete-top",
        projectId: project.id,
        expectedStructureRevision: 0,
        actor: { kind: "human", id: "human-local" },
        edits: [{ kind: "remove_document", documentId: project.topDocumentId }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("sets, keeps, and clears the Project simulation folder as structural edits", () => {
    const project = createEmptyProject("project", "Project");
    const testbench = createEmptyDocument("document-testbench", "Testbench");
    project.documents.push(testbench);
    const folder = createSimulationFolder({
      id: "folder-main",
      name: "Main folder",
      profileId: "test",
      documentId: testbench.id,
    });
    const actor = { kind: "human" as const, id: "human-local" };

    const set = executeProjectTransaction(project, {
      transactionId: "set-folder",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor,
      edits: [{ kind: "upsert_simulation_folder", folder }],
    });
    expect(set).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 1,
      project: { simulationFolders: [folder] },
    });
    expect(project.simulationFolders).toEqual([]);
    if (!set.ok) return;

    // The same folder again is not a change and does not spend a revision.
    const unchanged = executeProjectTransaction(set.project, {
      transactionId: "same-folder",
      projectId: project.id,
      expectedStructureRevision: 1,
      actor,
      edits: [
        { kind: "upsert_simulation_folder", folder: structuredClone(folder) },
      ],
    });
    expect(unchanged).toMatchObject({
      ok: true,
      applied: false,
      structureRevision: 1,
    });

    const rerooted = executeProjectTransaction(set.project, {
      transactionId: "replace-folder",
      projectId: project.id,
      expectedStructureRevision: 1,
      actor,
      edits: [
        {
          kind: "upsert_simulation_folder",
          folder: {
            ...folder,
            input: {
              ...folder.input,
              circuitBindings: [
                {
                  ...folder.input.circuitBindings[0]!,
                  documentId: project.topDocumentId,
                },
              ],
            },
          },
        },
      ],
    });
    expect(rerooted).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 2,
      project: {
        simulationFolders: [
          {
            input: {
              circuitBindings: [{ documentId: project.topDocumentId }],
            },
          },
        ],
      },
    });
    if (!rerooted.ok) return;

    const cleared = executeProjectTransaction(rerooted.project, {
      transactionId: "clear-folder",
      projectId: project.id,
      expectedStructureRevision: 2,
      actor,
      edits: [{ kind: "remove_simulation_folder", folderId: folder.id }],
    });
    expect(cleared).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 3,
    });
    if (!cleared.ok) return;
    expect(cleared.project.simulationFolders).toEqual([]);

    expect(
      executeProjectTransaction(cleared.project, {
        transactionId: "clear-absent-folder",
        projectId: project.id,
        expectedStructureRevision: 3,
        actor,
        edits: [{ kind: "remove_simulation_folder", folderId: folder.id }],
      }),
    ).toMatchObject({ ok: true, applied: false, structureRevision: 3 });
  });

  it("preserves unresolved source bindings for repair, including after a Cell is deleted", () => {
    const project = createEmptyProject("project", "Project");
    const testbench = createEmptyDocument("document-testbench", "Testbench");
    project.documents.push(testbench);
    const actor = { kind: "agent" as const, id: "agent" };
    const setupFor = (rootDocumentId: string) =>
      createSimulationFolder({
        id: "folder-main",
        name: "Main folder",
        profileId: "test",
        documentId: rootDocumentId,
      });

    expect(
      executeProjectTransaction(project, {
        transactionId: "unknown-root",
        projectId: project.id,
        expectedStructureRevision: 0,
        actor,
        edits: [
          {
            kind: "upsert_simulation_folder",
            folder: setupFor("document-missing"),
          },
        ],
      }),
    ).toMatchObject({
      ok: true,
      project: {
        simulationFolders: [
          { input: { circuitBindings: [{ documentId: "document-missing" }] } },
        ],
      },
    });

    expect(
      executeProjectTransaction(project, {
        transactionId: "stale-folder",
        projectId: project.id,
        expectedStructureRevision: 4,
        actor,
        edits: [
          { kind: "upsert_simulation_folder", folder: setupFor(testbench.id) },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_STRUCTURE_REVISION" } });

    expect(
      executeProjectTransaction(project, {
        transactionId: "malformed-folder",
        projectId: project.id,
        expectedStructureRevision: 0,
        actor,
        edits: [
          {
            kind: "upsert_simulation_folder",
            folder: {
              ...setupFor(testbench.id),
              input: { ...setupFor(testbench.id).input, lastRunId: "run-1" },
            },
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSACTION" } });

    // A root that is added in the same transaction is a valid new binding.
    // Later deletion preserves that authored binding as unresolved intent.
    const bench2 = createEmptyDocument("document-bench-2", "Bench2");
    expect(
      executeProjectTransaction(project, {
        transactionId: "add-and-root",
        projectId: project.id,
        expectedStructureRevision: 0,
        actor,
        edits: [
          { kind: "add_document", document: bench2 },
          { kind: "upsert_simulation_folder", folder: setupFor(bench2.id) },
        ],
      }),
    ).toMatchObject({
      ok: true,
      applied: true,
      project: {
        simulationFolders: [
          { input: { circuitBindings: [{ documentId: bench2.id }] } },
        ],
      },
    });

    const configured = executeProjectTransaction(project, {
      transactionId: "root-testbench",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor,
      edits: [
        { kind: "upsert_simulation_folder", folder: setupFor(testbench.id) },
      ],
    });
    if (!configured.ok) throw new Error("folder was not applied");
    const deleted = executeProjectTransaction(configured.project, {
      transactionId: "delete-root",
      projectId: project.id,
      expectedStructureRevision: 1,
      actor,
      edits: [{ kind: "remove_document", documentId: testbench.id }],
    });
    expect(deleted).toMatchObject({
      ok: true,
      applied: true,
      project: {
        simulationFolders: [
          { input: { circuitBindings: [{ documentId: testbench.id }] } },
        ],
        documents: [{ id: project.topDocumentId }],
      },
    });
    expect(
      executeProjectTransaction(configured.project, {
        transactionId: "clear-then-delete-root",
        projectId: project.id,
        expectedStructureRevision: 1,
        actor,
        edits: [
          { kind: "remove_simulation_folder", folderId: "folder-main" },
          { kind: "remove_document", documentId: testbench.id },
        ],
      }),
    ).toMatchObject({
      ok: true,
      applied: true,
      project: { documents: [{ id: project.topDocumentId }] },
    });
  });

  it("keeps independent named folders on one Testbench and removes only the addressed folder", () => {
    const project = createEmptyProject("project", "Project");
    const setupFor = (id: string, name: string, analysis: "op" | "ac") => {
      const folder = createSimulationFolder({
        id,
        name,
        profileId: "test",
        documentId: project.topDocumentId,
      });
      if (analysis === "ac")
        folder.input.files[0]!.text = folder.input.files[0]!.text.replace(
          "\nop\n",
          "\nac dec 10 1 1e6\n",
        );
      return folder;
    };
    const added = executeProjectTransaction(project, {
      transactionId: "add-two-folders",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human" },
      edits: [
        {
          kind: "upsert_simulation_folder",
          folder: setupFor("folder-op", "Bias", "op"),
        },
        {
          kind: "upsert_simulation_folder",
          folder: setupFor("folder-ac", "Response", "ac"),
        },
      ],
    });
    expect(added).toMatchObject({
      ok: true,
      applied: true,
      project: {
        simulationFolders: [
          { id: "folder-op", name: "Bias" },
          { id: "folder-ac", name: "Response" },
        ],
      },
    });
    if (!added.ok) return;
    const removed = executeProjectTransaction(added.project, {
      transactionId: "remove-one-folder",
      projectId: project.id,
      expectedStructureRevision: 1,
      actor: { kind: "human", id: "human" },
      edits: [{ kind: "remove_simulation_folder", folderId: "folder-op" }],
    });
    expect(removed).toMatchObject({
      ok: true,
      project: { simulationFolders: [{ id: "folder-ac" }] },
    });
  });

  it("replaces and clears unbound source input without a Canvas root", () => {
    const project = createEmptyProject("project", "Project");
    const unrelated = createEmptyDocument("document-unrelated", "Unrelated");
    project.documents.push(unrelated);
    const actor = { kind: "agent" as const, id: "agent" };
    const folder = createSimulationFolder({
      id: "folder-raw",
      name: "Source experiment",
      profileId: "test",
    });
    folder.input.files[0]!.text = "* invalid while editing\nV1 in 0 ";
    const configured = executeProjectTransaction(project, {
      transactionId: "set-raw-folder",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor,
      edits: [{ kind: "upsert_simulation_folder", folder }],
    });
    expect(configured).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 1,
      project: { simulationFolders: [folder] },
    });
    if (!configured.ok) return;

    const removed = executeProjectTransaction(configured.project, {
      transactionId: "remove-unrelated-cell",
      projectId: project.id,
      expectedStructureRevision: 1,
      actor,
      edits: [{ kind: "remove_document", documentId: unrelated.id }],
    });
    expect(removed).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 2,
      project: { simulationFolders: [folder] },
    });
    if (!removed.ok) return;

    const cleared = executeProjectTransaction(removed.project, {
      transactionId: "clear-raw-folder",
      projectId: project.id,
      expectedStructureRevision: 2,
      actor,
      edits: [{ kind: "remove_simulation_folder", folderId: folder.id }],
    });
    expect(cleared).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 3,
    });
    if (!cleared.ok) return;
    expect(cleared.project.simulationFolders).toEqual([]);
  });

  it("removes an Instance before deleting its now-unreferenced Cell", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    const result = executeProjectTransaction(project, {
      transactionId: "delete-child",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: [
        {
          kind: "transact_document",
          documentId: project.topDocumentId,
          expectedRevision: 0,
          edits: [{ kind: "remove_instance", instanceId: "X1" }],
        },
        { kind: "remove_document", documentId: child.id },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: { documents: [{ id: "document-main", instances: [] }] },
    });
  });

  it("rejects a final cyclic Project without exposing partial edits", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push(
      hierarchyInstance("XBACK", "Main", project.topDocumentId),
    );
    const result = executeProjectTransaction(project, {
      transactionId: "cycle",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: [
        { kind: "add_document", document: child },
        {
          kind: "transact_document",
          documentId: project.topDocumentId,
          expectedRevision: 0,
          edits: [
            {
              kind: "add_instance",
              instance: hierarchyInstance("X1", "Child", child.id),
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_RESULT" },
      project: { documents: [{ id: "document-main", instances: [] }] },
    });
    expect(result.diagnostics[0]?.message).toMatch(/Hierarchy cycle/);
  });

  it("renames a formal Cell Pin and every connected caller atomically", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({
      id: "port-in",
      symbolId: "port",
      placement: null,
    });
    child.nets.push({
      id: "net-in",

      terminals: [{ instanceId: "port-in", pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["port-in"],
    });
    child.annotations.push({
      id: "instance-label-port-in",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-in" },
      formatOverride: semanticTextDocument("IN", "formal-port"),
      anchor: {
        kind: "object",
        objectId: "port-in",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    project.documents.push(child);
    const caller = {
      ...hierarchyInstance("X1", "Child", child.id),
      importProvenance: {
        kind: "subcircuit" as const,
        sourceMasterName: "Child",
        sourceTarget: `cell:${child.id}`,
        terminalMapping: [{ sourcePosition: 0, pinName: "IN" }],
      },
    };
    project.documents[0]!.instances.push(caller);
    project.documents[0]!.nets.push({
      id: "net-parent",

      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });

    const result = executeProjectTransaction(project, {
      transactionId: "rename-port",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCellTerminal(project, child.id, "terminal-in", "VIN"),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: {
        documents: [
          {
            id: "document-main",
            nets: [{ terminals: [{ instanceId: "X1", pinName: "VIN" }] }],
            instances: [
              {
                importProvenance: {
                  terminalMapping: [{ pinName: "VIN" }],
                },
              },
            ],
          },
          {
            id: "document-child",
            netlist: { terminals: [{ id: "terminal-in", name: "VIN" }] },
            // IN's automatic look gives way to the look a Pin placed as VIN
            // gets (#1419).
            annotations: [
              {
                formatOverride: roleLabelFormat("voltage-node", "VIN"),
              },
            ],
          },
        ],
      },
    });
  });

  it("sets a formatting-only formal Port label without renaming its terminal", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({
      id: "port-vout",
      symbolId: "port",
      placement: null,
    });
    child.nets.push({
      id: "net-vout",

      terminals: [{ instanceId: "port-vout", pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: "terminal-vout",
      name: "Vout",
      netId: "net-vout",
      direction: "output",
      interfaceInstanceIds: ["port-vout"],
    });
    child.annotations.push({
      id: "instance-label-port-vout",
      kind: "instance-label",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-vout" },
      anchor: {
        kind: "object",
        objectId: "port-vout",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    project.documents.push(child);

    const result = executeProjectTransaction(project, {
      transactionId: "normalize-port-label",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: planEditCellTerminalAnnotation(
        project,
        child.id,
        "terminal-vout",
        {
          ...child.annotations[0]!,
          formatOverride: {
            runs: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: "Vout" }],
              },
            ],
          },
        },
        "Vout",
      ),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: {
        documents: [
          {},
          {
            netlist: { terminals: [{ name: "Vout" }] },
            annotations: [
              { formatOverride: { runs: [{ kind: "span", style: "bold" }] } },
            ],
          },
        ],
      },
    });
    if (!result.ok)
      throw new Error("Expected formatting-only Port label update");
    expect(result.project.documents[1]!.annotations[0]!.binding).toEqual({
      kind: "cell-terminal-name",
      terminalId: "terminal-vout",
    });

    const renamed = executeProjectTransaction(result.project, {
      transactionId: "rename-manually-formatted-port",
      projectId: result.project.id,
      expectedStructureRevision: result.project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRenameCellTerminal(
        result.project,
        child.id,
        "terminal-vout",
        "VBIAS",
      ),
    });
    if (!renamed.ok) throw new Error("Expected formatted Port rename");
    const renamedAnnotation = renamed.project.documents[1]!.annotations[0]!;
    expect(flattenRichText(renamedAnnotation.formatOverride!)).toBe("VBIAS");
    expect(renamedAnnotation.formatOverride?.runs[0]).toMatchObject({
      style: "bold",
    });
  });

  it("removes multiple unreferenced Cell Pins in one atomic transaction", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push(
      {
        id: "port-a",
        symbolId: "port",
        placement: null,
      },
      {
        id: "port-b",
        symbolId: "port",
        placement: null,
      },
    );
    child.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "port-a", pinName: "P" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "port-b", pinName: "P" }],
      },
    );
    child.netlist!.terminals.push(
      {
        id: "terminal-a",
        name: "A",
        netId: "net-a",
        direction: "input",
        interfaceInstanceIds: ["port-a"],
      },
      {
        id: "terminal-b",
        name: "B",
        netId: "net-b",
        direction: "output",
        interfaceInstanceIds: ["port-b"],
      },
    );
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "remove-unused-ports",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminals(project, child.id, [
        "terminal-a",
        "terminal-b",
      ]),
    });

    expect(result).toMatchObject({
      ok: true,
      project: {
        documents: [
          { instances: [{ reference: "X1" }] },
          { instances: [], netlist: { terminals: [] } },
        ],
      },
    });
  });

  it("updates Cell symbol intent only through a structural transaction", () => {
    const project = createEmptyProject("project", "Project");
    const result = executeProjectTransaction(project, {
      transactionId: "set-cell-symbol-presentation",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planSetCellSymbolPresentation(project, project.topDocumentId, {
        minimumBodySize: { width: 120, height: 80 },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: {
        structureRevision: 1,
        documents: [
          {
            revision: 1,
            presentation: {
              cellSymbol: { minimumBodySize: { width: 120, height: 80 } },
            },
          },
        ],
      },
    });
  });

  it.each(["cell", "external"] as const)(
    "follows caller Route geometry when a %s definition pin moves",
    (kind) => {
      const project = createEmptyProject("project", "Project");
      const child = createEmptyDocument("document-child", "Child");
      child.instances.push({
        id: "P1",
        symbolId: "port",
        placement: null,
      });
      child.nets.push({
        id: "net-in",

        terminals: [{ instanceId: "P1", pinName: "P" }],
      });
      child.netlist!.terminals.push({
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      });
      project.documents.push(child);
      const parent = project.documents[0]!;
      parent.instances.push(hierarchyInstance("X1", "Child", child.id));
      parent.nets.push({
        id: "net-parent",

        terminals: [{ instanceId: "X1", pinName: "IN" }],
      });
      parent.junctions.push({
        id: "J1",
        netId: "net-parent",
        position: { x: -150, y: 0 },
      });
      parent.routes.push(
        createRoutePath({
          id: "route-input",
          netId: "net-parent",
          start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
          end: { kind: "junction", junctionId: "J1" },
          bends: [],
          modes: ["auto"],
        }),
      );

      const presentation = {
        pinPlacements: [
          { terminalId: "terminal-in", side: "north" as const, offset: 0 },
        ],
      };
      const external = {
        id: "external-child",
        name: "ExternalChild",
        terminals: [
          { id: "terminal-in", name: "IN", direction: "input" as const },
        ],
        formalParameters: [],
        interfaceStatus: "declared" as const,
      };
      if (kind === "external") {
        project.externalSubcircuitDefinitions.push(external);
        parent.instances[0] = createExternalSubcircuitInstance(
          "X1",
          external,
          parent.instances[0]!.placement!,
        );
      }
      const anotherCaller = structuredClone(parent);
      anotherCaller.id = "document-other";
      anotherCaller.name = "Other";
      anotherCaller.netlist!.name = "Other";
      project.documents.push(anotherCaller);
      const result = executeProjectTransaction(project, {
        transactionId: "move-child-input-pin",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "human-local" },
        edits:
          kind === "cell"
            ? planSetCellSymbolPresentation(project, child.id, presentation)
            : [
                {
                  kind: "upsert_external_subcircuit_definition",
                  definition: { ...external, presentation },
                },
              ],
      });

      expect(result).toMatchObject({
        ok: true,
        applied: true,
        changedDocumentIds:
          kind === "cell"
            ? ["document-child", "document-main", "document-other"]
            : ["document-main", "document-other"],
        project: {
          documents: [
            {
              routes: [
                {
                  id: "route-input",
                  legs: [
                    {
                      mode: "auto",
                      to: {
                        kind: "bend",
                        position: { x: -150, y: -30 },
                      },
                    },
                    { mode: "auto", to: { kind: "endpoint" } },
                  ],
                },
              ],
            },
            {},
            {},
          ],
        },
      });
      if (result.ok) {
        expect(result.project.documents[2]!.routes).toEqual(
          result.project.documents[0]!.routes,
        );
      }
    },
  );

  it("preserves a canonical MOS caller and refuses an in-place reviewed interface change", () => {
    const project = createEmptyProject("project", "Project");
    const definition = {
      id: "sky130-nfet",
      name: "sky130_fd_pr__nfet_01v8",
      terminals: ["D", "G", "S", "B"].map((name, index) => ({
        id: `terminal-${index}`,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    project.externalSubcircuitDefinitions.push(definition);
    project.documents[0]!.instances.push({
      id: "X1",
      symbolId: "nmos",
      placement: null,
      reference: "X1",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: definition.id,
        },
        parameters: {},
      },
    });

    const compatible = executeProjectTransaction(project, {
      transactionId: "refresh-reviewed-external",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [{ kind: "upsert_external_subcircuit_definition", definition }],
    });
    expect(compatible.ok).toBe(true);
    if (!compatible.ok) return;
    expect(compatible.project.documents[0]!.instances[0]!.symbolId).toBe(
      "nmos",
    );

    const incompatibleDefinition = {
      ...definition,
      terminals: definition.terminals.map((terminal, index) =>
        index === 0 ? { ...terminal, name: "DRAIN" } : terminal,
      ),
    };
    const incompatible = executeProjectTransaction(compatible.project, {
      transactionId: "break-reviewed-external-order",
      projectId: project.id,
      expectedStructureRevision: compatible.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "upsert_external_subcircuit_definition",
          definition: incompatibleDefinition,
        },
      ],
    });
    // #1401 keeps reviewed library semantics fixed at the shared transaction
    // boundary. The former implicit conversion to a generic master is retired;
    // an alternative model must receive a new definition identity.
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok)
      expect(incompatible.error.message).toContain("Reviewed");
    expect(compatible.project.documents[0]!.instances[0]!.symbolId).toBe(
      "nmos",
    );
  });
});

describe("a part wired at pins its model does not have (#1298)", () => {
  const actor = { kind: "agent" as const, id: "test" };
  const varactor = {
    id: "external-varactor",
    name: "sky130_fd_pr__cap_var_lvt",
    terminals: ["C0", "C1", "B"].map((name, index) => ({
      id: `external-varactor-${index}`,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [],
    interfaceStatus: "declared" as const,
  };

  /** A wired Var Cap CV1 in Cell "dut" and a capacitor C1 in Cell "Other". */
  function project(boundVarCap: boolean) {
    const project = createEmptyProject("project", "Project");
    project.externalSubcircuitDefinitions.push(structuredClone(varactor));
    const top = project.documents[0]!;
    top.instances.push({
      id: "CV1",
      reference: "CV1",
      symbolId: "variable-capacitor",
      placement: null,
      netlist: boundVarCap
        ? {
            binding: { kind: "external-subcircuit", definitionId: varactor.id },
            parameters: { w: "5u", l: "500n", vm: "1" },
          }
        : {
            binding: { kind: "primitive", deviceClass: "capacitor" },
            parameters: { value: "1p" },
          },
    });
    top.nets.push(
      { id: "net-tune", terminals: [{ instanceId: "CV1", pinName: "P1" }] },
      { id: "net-ground", terminals: [{ instanceId: "CV1", pinName: "P2" }] },
    );
    const other = createEmptyDocument("document-other", "Other");
    other.instances.push({
      id: "C1",
      reference: "C1",
      symbolId: "capacitor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "1p" },
      },
    });
    project.documents.push(other);
    return project;
  }

  function transact(
    source: ReturnType<typeof project>,
    edits: ProjectStructureEdit[],
  ) {
    return executeProjectTransaction(source, {
      transactionId: "edit",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      actor,
      edits,
    });
  }

  it("lets unrelated edits through while a Var Cap bound before #1298 is still in the Project", () => {
    const source = project(true);
    // A new Cell, a model on a part in another Cell, and an edit beside the
    // Var Cap in its own Cell: none of them touches CV1.
    for (const edits of [
      [
        {
          kind: "add_document" as const,
          document: createEmptyDocument("bias", "Bias"),
        },
      ],
      planSetDeviceModelTarget(
        source,
        "document-other",
        "C1",
        "sky130_fd_pr__cap_mim_m3_1",
      ),
      [
        {
          kind: "transact_document" as const,
          documentId: source.topDocumentId,
          expectedRevision: source.documents[0]!.revision,
          edits: [
            {
              kind: "add_instance" as const,
              instance: {
                id: "R1",
                reference: "R1",
                symbolId: "resistor",
                placement: null,
                netlist: {
                  binding: {
                    kind: "primitive" as const,
                    deviceClass: "resistor" as const,
                  },
                  parameters: { value: "1k" },
                },
              },
            },
          ],
        },
      ],
    ]) {
      const result = transact(source, edits);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.applied).toBe(true);
    }
  });

  it("refuses an edit that wires a part at a pin its model does not have, naming the part, its Cell and the ways out", () => {
    const source = project(false);
    const result = transact(source, [
      {
        kind: "transact_document",
        documentId: source.topDocumentId,
        expectedRevision: source.documents[0]!.revision,
        edits: [
          {
            kind: "bulk_patch_instance_netlist",
            assignments: [
              {
                instanceId: "CV1",
                binding: {
                  kind: "external-subcircuit",
                  definitionId: varactor.id,
                },
              },
            ],
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "INVALID_RESULT",
      message:
        "CV1 in Cell dut uses pin P1, which its model sky130_fd_pr__cap_var_lvt does not have. Disconnect CV1.P1, clear CV1's model, or delete CV1.",
    });
    expect(result.diagnostics[0]).toMatchObject({
      objectIds: ["CV1", "net-tune"],
      parameters: { documentId: source.topDocumentId, instanceId: "CV1" },
    });
  });
});

describe("a Cell symbol's pins change sides (#1316)", () => {
  /** A child with pins A and B, placed once; each pin has a wire out to an
   * open end 50 units beyond it. */
  function wiredCaller() {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    addCellPin(child, {
      instanceId: "PA",
      terminalId: "terminal-a",
      name: "A",
      netId: "net-a",
    });
    addCellPin(child, {
      instanceId: "PB",
      terminalId: "terminal-b",
      name: "B",
      netId: "net-b",
    });
    child.presentation.cellSymbol = {
      pinPlacements: [
        { terminalId: "terminal-a", side: "west", offset: -20 },
        { terminalId: "terminal-b", side: "east", offset: 0 },
      ],
    };
    project.documents.push(child);
    const parent = project.documents[0]!;
    parent.instances.push(hierarchyInstance("X1", "Child", child.id));
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    for (const [pinName, dx] of [
      ["A", -50],
      ["B", 50],
    ] as const) {
      const pin = resolveEndpointPoint(parent, resolver, {
        kind: "terminal",
        instanceId: "X1",
        pinName,
      })!;
      parent.nets.push({
        id: `net-parent-${pinName}`,
        terminals: [{ instanceId: "X1", pinName }],
      });
      parent.junctions.push({
        id: `open-${pinName}`,
        netId: `net-parent-${pinName}`,
        position: { x: pin.x + dx, y: pin.y },
      });
      parent.routes.push(
        createRoutePath({
          id: `wire-${pinName}`,
          netId: `net-parent-${pinName}`,
          start: { kind: "terminal", instanceId: "X1", pinName },
          end: { kind: "junction", junctionId: `open-${pinName}` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    return { project, child };
  }

  it("keeps every caller pin on its own Net, though a pin lands on another's wire", () => {
    const { project, child } = wiredCaller();
    const before = structuredClone(project.documents[0]!.nets);
    // B takes A's old place on the west side, A goes east.
    const result = executeProjectTransaction(project, {
      transactionId: "swap-sides",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planSetCellSymbolPresentation(project, child.id, {
        pinPlacements: [
          { terminalId: "terminal-b", side: "west", offset: -20 },
          { terminalId: "terminal-a", side: "east", offset: -20 },
        ],
      }),
    });
    if (!result.ok) throw new Error(result.error.message);
    const parent = result.project.documents[0]!;
    expect(parent.nets).toEqual(before);
    expect(parent.routes.map((route) => route.netId)).toEqual([
      "net-parent-A",
      "net-parent-B",
    ]);
    // A's wire, stretched to the east side, is drawn around the block and
    // off B's new pin rather than through them.
    const resolver = createProjectSymbolResolver(
      result.project,
      builtInSymbols,
    );
    const findings = [
      ...runErcChecks(
        result.project,
        buildProjectConnectivityIndex(result.project, resolver),
        resolver,
      ).map((item) => item.code),
      ...diagnoseVisualQuality(parent, resolver).map((item) => item.code),
    ];
    expect(findings).not.toContain("ERC_TOUCHING_NOT_CONNECTED");
    expect(findings).not.toContain("ERC_OVERLAPPING_NETS");
    expect(findings).not.toContain("VISUAL_WIRE_THROUGH_SYMBOL");
  });

  it("redraws a stretched wire down its own Net's trunk, as an SRAM bit line", () => {
    // A's wire leaves a vertical trunk of its own Net, as each SRAM cell's
    // blb leaves the shared bit line. Moved to the east side below B, its
    // stretch ran through the block and over B's pin. Its clear path runs
    // down the trunk, where the transaction merges the two wires; that
    // changes which wires there are, not which pins are joined.
    const { project, child } = wiredCaller();
    const parent = project.documents[0]!;
    const stub = parent.junctions.find((junction) => junction.id === "open-A")!;
    parent.junctions.push({
      id: "trunk-end",
      netId: "net-parent-A",
      position: { x: stub.position.x, y: stub.position.y + 150 },
    });
    parent.routes.push(
      createRoutePath({
        id: "trunk-A",
        netId: "net-parent-A",
        start: { kind: "junction", junctionId: "open-A" },
        end: { kind: "junction", junctionId: "trunk-end" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const pinsBefore = parent.nets.map((net) =>
      net.terminals.map((terminal) => terminal.pinName),
    );
    const result = executeProjectTransaction(project, {
      transactionId: "a-east",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPresentation(project, child.id, {
        pinPlacements: [
          { terminalId: "terminal-a", side: "east", offset: 20 },
          { terminalId: "terminal-b", side: "east", offset: 0 },
        ],
      }),
    });
    if (!result.ok) throw new Error(result.error.message);
    const after = result.project.documents[0]!;
    expect(
      after.nets.map((net) =>
        net.terminals.map((terminal) => terminal.pinName),
      ),
    ).toEqual(pinsBefore);
    const resolver = createProjectSymbolResolver(
      result.project,
      builtInSymbols,
    );
    const findings = [
      ...runErcChecks(
        result.project,
        buildProjectConnectivityIndex(result.project, resolver),
        resolver,
      ),
      ...diagnoseVisualQuality(after, resolver),
    ].map((item) => item.code);
    expect(findings).not.toContain("ERC_TOUCHING_NOT_CONNECTED");
    expect(findings).not.toContain("VISUAL_WIRE_THROUGH_SYMBOL");
    expect(findings).not.toContain("VISUAL_TERMINAL_ON_FOREIGN_ROUTE");
  });

  it("names each caller whose wiring was redrawn beside its wires (#1320)", () => {
    const { project, child } = wiredCaller();
    const result = executeProjectTransaction(project, {
      transactionId: "move-b",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPresentation(project, child.id, {
        pinPlacements: [
          { terminalId: "terminal-a", side: "west", offset: -20 },
          { terminalId: "terminal-b", side: "east", offset: 20 },
        ],
      }),
    });
    if (!result.ok) throw new Error(result.error.message);
    const follow = result.documentResults.find(
      (item) => item.ok && item.diff.documentId === project.documents[0]!.id,
    );
    // B's wire is redrawn, and X1, the caller it ends on, is named with it.
    expect(follow?.ok && follow.diff.changedObjectIds).toEqual(
      expect.arrayContaining(["X1", "wire-B"]),
    );

    // A body size the block already has moves no pin: X1 is not named.
    const unmoved = executeProjectTransaction(project, {
      transactionId: "same-size",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test" },
      edits: planSetCellSymbolPresentation(project, child.id, {
        ...child.presentation.cellSymbol,
        minimumBodySize: { width: 80, height: 80 },
      }),
    });
    if (!unmoved.ok) throw new Error(unmoved.error.message);
    // Neither contact moved, so authored wires are left untouched.
    expect(
      unmoved.documentResults.flatMap((item) =>
        item.ok ? item.diff.changedObjectIds : [],
      ),
    ).not.toContain("wire-A");
    expect(
      unmoved.documentResults.flatMap((item) =>
        item.ok ? item.diff.changedObjectIds : [],
      ),
    ).not.toContain("X1");
  });
});
