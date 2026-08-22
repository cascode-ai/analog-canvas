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
  planRemoveCellTerminalMarkers,
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
    netlist: {
      reference: id,
      parameters: {},
      binding: {
        kind: "subcircuit" as const,
        childDocumentId,
      },
    },
  };
}

describe("Project structural transaction", () => {
  it("removes one repeated formal marker while retaining its terminal and caller", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    child.nets.push({
      id: "net-in",
      scope: "local",
      terminals: [
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
      ],
    });
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1", "P2"],
    });
    project.documents.push(child);
    project.documents[0]!.instances.push(
      hierarchyInstance("X1", "Child", child.id),
    );
    project.documents[0]!.nets.push({
      id: "net-parent-in",
      scope: "local",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });

    const result = executeProjectTransaction(project, {
      transactionId: "remove-one-formal-marker",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: planRemoveCellTerminalMarkers(
        project,
        child.id,
        ["P1"],
        [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "P1", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "P1" },
        ],
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.project.documents.find(
      (document) => document.id === child.id,
    )!;
    expect(updated.instances.map((instance) => instance.id)).toEqual(["P2"]);
    expect(updated.netlist?.terminals).toMatchObject([
      { id: "terminal-in", interfaceInstanceIds: ["P2"] },
    ]);
    expect(updated.nets[0]?.terminals).toEqual([
      { instanceId: "P2", pinName: "P" },
    ]);
    expect(() =>
      planRemoveCellTerminalMarkers(
        result.project,
        child.id,
        ["P2"],
        [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "P2", pinName: "P" },
          },
          { kind: "remove_instance", instanceId: "P2" },
        ],
      ),
    ).toThrow("still referenced");
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

  it("renames a formal port and every connected caller atomically", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({
      id: "port-in",
      symbolId: "port",
      placement: null,
    });
    child.nets.push({
      id: "net-in",
      scope: "local",
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
        name: "Child",
        sourceTarget: `cell:${child.id}`,
        terminalMapping: [{ sourcePosition: 0, pinName: "IN" }],
      },
    };
    project.documents[0]!.instances.push(caller);
    project.documents[0]!.nets.push({
      id: "net-parent",
      scope: "local",
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
      scope: "local",
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

  it("removes an unused formal port and reconciles caller source order", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("document-child", "Child");
    child.instances.push({
      id: "port-unused",
      symbolId: "port",
      placement: null,
    });
    child.nets.push({
      id: "net-unused",
      scope: "local",
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
          { instances: [{ netlist: { reference: "X1" } }] },
          { instances: [], netlist: { terminals: [] } },
        ],
      },
    });
  });

  it("removes multiple unreferenced formal ports in one atomic transaction", () => {
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
        scope: "local",
        terminals: [{ instanceId: "port-a", pinName: "P" }],
      },
      {
        id: "net-b",
        scope: "local",
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
          { instances: [{ netlist: { reference: "X1" } }] },
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
      scope: "local",
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
      scope: "local",
      terminals: [{ instanceId: "X1", pinName: "IN" }],
    });
    parent.junctions.push({
      id: "J1",
      netId: "net-parent",
      position: { x: -150, y: 0 },
    });
    parent.routes.push({
      id: "route-input",
      netId: "net-parent",
      from: { kind: "terminal", instanceId: "X1", pinName: "IN" },
      to: { kind: "junction", junctionId: "J1" },
      waypoints: [],
      segmentModes: ["auto"],
    });

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
                waypoints: [{ x: -150, y: -30 }],
                segmentModes: ["auto", "auto"],
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
      netlist: {
        reference: "X1",
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
