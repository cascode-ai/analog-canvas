import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import { externalSubcircuitSymbolId, hierarchicalSymbolId } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planProjectCellImport } from "./project-cell-import.js";
import { executeProjectTransaction } from "./project-transaction.js";

function importProject(
  destination: CircuitProject,
  source: CircuitProject,
  sourceDocumentId: string,
) {
  const plan = planProjectCellImport(destination, source, sourceDocumentId);
  expect(plan.ok).toBe(true);
  expect(plan.ok && plan.status).toBe("ready");
  if (!plan.ok || plan.status !== "ready") throw new Error("Import not ready");
  const result = executeProjectTransaction(destination, {
    transactionId: "import-cell",
    projectId: destination.id,
    expectedStructureRevision: destination.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [...plan.edits],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return { plan, project: result.project };
}

describe("cross-Project Cell import", () => {
  it("copies a complete child closure and remaps every hierarchy identity", () => {
    const destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Source", "source-top");
    const child = createEmptyDocument("source-child", "GainStage");
    child.sourceBinding = {
      cellName: "GainStage",
      sourceRef: {
        fileId: "source-file",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 10, line: 1, column: 11 },
      },
    };
    source.source.files.push({
      id: "source-file",
      path: "cells/gain-stage.spi",
      hash: "sha256-source",
    });
    source.documents.push(child);
    source.documents[0]!.instances.push({
      id: "source-x1",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: null,
      reference: "X1",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });

    const { plan, project } = importProject(
      destination,
      source,
      source.topDocumentId,
    );

    expect(plan.importedDocumentIds).toHaveLength(2);
    expect(project.documents).toHaveLength(3);
    const importedRoot = project.documents.find(
      (document) => document.id === plan.rootDocumentId,
    )!;
    const importedChildId = importedRoot.instances[0]!.netlist!.binding;
    expect(importedChildId).toMatchObject({ kind: "subcircuit" });
    if (importedChildId?.kind !== "subcircuit") return;
    const importedChild = project.documents.find(
      (document) => document.id === importedChildId.childDocumentId,
    )!;
    expect(importedChild.id).not.toBe(child.id);
    expect(importedRoot.instances[0]!.symbolId).toBe(
      hierarchicalSymbolId(importedChild.netlist!.name),
    );
    expect(importedChild.sourceBinding?.sourceRef.fileId).not.toBe(
      "source-file",
    );
    expect(importedChild.sourceBinding?.cellName).toBe(
      importedChild.netlist?.name,
    );
    expect(project.source.files).toContainEqual(
      expect.objectContaining({ path: "cells/gain-stage.spi" }),
    );
    expect(source.documents.map((document) => document.id)).toEqual([
      "source-top",
      "source-child",
    ]);
  });

  it("uses deterministic names and treats a repeated import as idempotent", () => {
    const destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Source", "source-main");
    source.documents[0]!.name = "Main";
    source.documents[0]!.netlist!.name = "Main";

    const first = importProject(destination, source, source.topDocumentId);
    const imported = first.project.documents.find(
      (document) => document.id === first.plan.rootDocumentId,
    )!;
    expect(imported.name).toMatch(/^Main_[a-f0-9]{8}$/u);

    imported.presentation.compactness = "compact";
    const repeated = planProjectCellImport(
      first.project,
      source,
      source.topDocumentId,
    );
    expect(repeated).toMatchObject({
      ok: true,
      status: "already-imported",
      rootDocumentId: imported.id,
      edits: [],
    });
  });

  it("reuses a compatible external interface and rejects a conflicting one", () => {
    const destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Source", "source-main");
    const definition = {
      id: "source-opamp",
      name: "OPAMP",
      terminals: [
        { id: "source-opamp-in", name: "IN", direction: "input" as const },
        { id: "source-opamp-out", name: "OUT", direction: "output" as const },
      ],
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    source.externalSubcircuitDefinitions.push(definition);
    source.documents[0]!.instances.push({
      id: "source-x1",
      symbolId: externalSubcircuitSymbolId(definition.id),
      placement: null,
      reference: "X1",
      netlist: {
        parameters: {},
        binding: {
          kind: "external-subcircuit",
          definitionId: definition.id,
        },
      },
    });
    destination.externalSubcircuitDefinitions.push({
      ...structuredClone(definition),
      id: "destination-opamp",
      terminals: definition.terminals.map((terminal, index) => ({
        ...terminal,
        id: `destination-terminal-${index}`,
      })),
    });

    const imported = importProject(destination, source, source.topDocumentId);
    expect(imported.project.externalSubcircuitDefinitions).toHaveLength(1);
    const binding = imported.project.documents.find(
      (document) => document.id === imported.plan.rootDocumentId,
    )!.instances[0]!.netlist!.binding;
    expect(binding).toEqual({
      kind: "external-subcircuit",
      definitionId: "destination-opamp",
    });

    const conflictDestination = structuredClone(destination);
    conflictDestination.externalSubcircuitDefinitions[0]!.terminals[1]!.name =
      "NEG";
    expect(
      planProjectCellImport(conflictDestination, source, source.topDocumentId),
    ).toMatchObject({ ok: false, code: "EXTERNAL_DEFINITION_CONFLICT" });
  });

  it("rejects an incompatible symbol-library lock before any mutation", () => {
    const destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Source");
    source.symbolLibrary = {
      id: "other-symbols",
      version: "2",
      hash: "other-hash",
    };
    expect(
      planProjectCellImport(destination, source, source.topDocumentId),
    ).toMatchObject({ ok: false, code: "SYMBOL_LIBRARY_MISMATCH" });
  });
});
