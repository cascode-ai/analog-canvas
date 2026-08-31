import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createEmptyProject,
  flattenRichText,
} from "@icm/model";
import { externalSubcircuitSymbolId, hierarchicalSymbolId } from "@icm/symbols";

import {
  planRenameCell,
  planRemoveCellTerminal,
  planRemoveCellTerminals,
  planEditCellTerminalAnnotation,
  planRenameCellTerminal,
  planSetCellSymbolPresentation,
} from "./hierarchy-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

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

  it("detaches the vanished caller pin instead of merging it into an existing name", () => {
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
      edits: planRenameCellTerminal(project, child.id, "terminal-old", "new"),
    });

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const updatedParent = result.project.documents[0]!;
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
  });

  it("removes an unused Cell Pin and reconciles caller source order", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({
      id: "port-unused",
      symbolId: "port",
      placement: null,
    });
    child.nets.push({
      id: "net-unused",

      terminals: [{ instanceId: "port-unused", pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: "terminal-unused",
      name: "UNUSED",
      netId: "net-unused",
      direction: "passive",
      interfaceInstanceIds: ["port-unused"],
    });
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );

    const result = executeProjectTransaction(project, {
      transactionId: "remove-unused-port",
      projectId: project.id,
      expectedStructureRevision: 0,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminal(project, child.id, "terminal-unused"),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      project: {
        documents: [
          { instances: [{ reference: "X1" }] },
          { instances: [], netlist: { terminals: [] } },
        ],
      },
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

  it("follows caller Route geometry when a definition pin moves", () => {
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

    const result = executeProjectTransaction(project, {
      transactionId: "move-child-input-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planSetCellSymbolPresentation(project, child.id, {
        pinPlacements: [
          { terminalId: "terminal-in", side: "north", offset: 0 },
        ],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      changedDocumentIds: ["document-child", "document-main"],
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
        ],
      },
    });
  });

  it("preserves a canonical MOS caller while its reviewed external definition stays compatible", () => {
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
    expect(incompatible.ok).toBe(true);
    if (!incompatible.ok) return;
    expect(incompatible.project.documents[0]!.instances[0]!.symbolId).toBe(
      externalSubcircuitSymbolId(definition.id),
    );
  });
});
