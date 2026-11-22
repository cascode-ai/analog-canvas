import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planProjectCellImport } from "./project-cell-import.js";
import { executeProjectTransaction } from "./project-transaction.js";
import { executeTransaction } from "./transaction.js";

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

/** A Cell named Bias whose local VDD rail is its one formal Pin. */
function railedCell() {
  const railed = executeTransaction(createEmptyDocument("bias", "Bias"), {
    transactionId: "add-rail",
    documentId: "bias",
    expectedRevision: 0,
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "add_power_rail",
        netId: "rail-net",
        routeId: "rail-route",
        startJunctionId: "rail-start",
        endJunctionId: "rail-end",
        labelId: "rail-label",
        netName: "VDD",
        scope: "local",
        powerDomain: "vdd",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      },
    ],
  });
  if (!railed.ok) throw new Error(railed.error.message);
  return railed.document;
}

/** A top that calls `child` once, with the Project's captured artwork. */
function callingProject(child: SchematicDocument) {
  const source = createEmptyProject("source", "Source", "source-top");
  source.documents.push(child);
  source.documents[0]!.instances.push({
    id: "source-x1",
    symbolId: hierarchicalSymbolId(child.netlist!.name),
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    reference: "X1",
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  return withProjectComponentDefinitions(source);
}

function pinAt(project: CircuitProject, symbolId: string, name: string) {
  return createProjectSymbolResolver(project, builtInSymbols)
    .resolve(symbolId)!
    .definition.pins.find((pin) => pin.name === name)!.at;
}

/** Moves the saved drawing's VDD 10 lower, as an older generator drew it. */
function shiftSavedVdd(project: CircuitProject, symbolId: string) {
  const saved = project.componentDefinitions!.find(
    (definition) => definition.symbol.id === symbolId,
  )!;
  const pin = saved.symbol.pins.find((candidate) => candidate.name === "VDD")!;
  pin.at = { x: pin.at.x, y: pin.at.y + 10 };
  return saved;
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
      content: { text: "* archived original", encoding: "utf-8" },
    });
    child.importReference = {
      files: [{ fileId: "source-file" }],
      nets: [
        {
          id: "old-net",
          name: "A",
          scope: "local",
          terminals: [{ instanceId: "deleted-device", sourcePosition: 0 }],
        },
      ],
    };
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
    const reference = project.documents.find(
      (d) => d.sourceBinding?.cellName === "GainStage",
    )!.importReference!;
    expect(reference.nets[0]?.terminals[0]?.instanceId).not.toBe(
      "deleted-device",
    );
    expect(
      project.source.files.find((f) => f.id === reference.files[0]?.fileId)
        ?.content?.text,
    ).toBe("* archived original");
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
    destination.documents[0]!.name = "Main";
    destination.documents[0]!.netlist!.name = "Main";
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

  it("keeps a supply-rail Pin and controlled-source references on their imported owners", () => {
    const destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Source", "source-top");
    const child = railedCell();
    child.nets.push({ id: "sense-net", terminals: [] });
    child.instances.push(
      {
        id: "v-sense",
        symbolId: "voltage-source",
        placement: null,
        reference: "V1",
        netlist: { parameters: { dc: "0" } },
      },
      {
        id: "e-gain",
        symbolId: "vcvs",
        placement: null,
        reference: "E1",
        netlist: {
          parameters: { gain: "2" },
          control: {
            kind: "voltage",
            positiveNetId: "rail-net",
            negativeNetId: "sense-net",
          },
        },
      },
      {
        id: "f-mirror",
        symbolId: "cccs",
        placement: null,
        reference: "F1",
        netlist: {
          parameters: { gain: "1" },
          control: { kind: "current", sensorInstanceId: "v-sense" },
        },
      },
    );
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
    const imported = project.documents.find(
      (document) => document.id === plan.documentIds[child.id],
    )!;
    const [terminal] = imported.netlist!.terminals;
    const label = imported.annotations.find(
      (annotation) => annotation.id === terminal!.interfaceAnnotationId,
    );
    expect(label).toMatchObject({
      kind: "power-label",
      netId: terminal!.netId,
    });
    expect(label!.id).not.toBe("rail-label");
    const instance = (reference: string) =>
      imported.instances.find(
        (candidate) => candidate.reference === reference,
      )!;
    const netIds = imported.nets.map((net) => net.id);
    const voltage = instance("E1").netlist!.control;
    expect(
      voltage?.kind === "voltage" &&
        [voltage.positiveNetId, voltage.negativeNetId].every((id) =>
          netIds.includes(id!),
        ),
    ).toBe(true);
    expect(instance("F1").netlist!.control).toEqual({
      kind: "current",
      sensorInstanceId: instance("V1").id,
    });
  });

  it("keeps a Cell's saved generated drawing while its interface is unchanged", () => {
    const source = callingProject(railedCell());
    const symbolId = hierarchicalSymbolId("Bias");
    const today = pinAt(source, symbolId, "VDD");
    shiftSavedVdd(source, symbolId);
    const saved = { x: today.x, y: today.y + 10 };
    expect(pinAt(source, symbolId, "VDD")).toEqual(saved);

    const { project } = importProject(
      createEmptyProject("destination", "Destination"),
      source,
      source.topDocumentId,
    );
    expect(pinAt(project, symbolId, "VDD")).toEqual(saved);
  });

  it("adds no capture for a drawing today's generator reproduces or the destination holds", () => {
    const captures = (plan: ReturnType<typeof planProjectCellImport>) =>
      plan.ok
        ? plan.edits.filter(
            (edit) => edit.kind === "capture_component_definition",
          ).length
        : -1;
    const destination = createEmptyProject("destination", "Destination");
    const current = callingProject(railedCell());
    expect(
      captures(
        planProjectCellImport(destination, current, current.topDocumentId),
      ),
    ).toBe(0);

    const older = callingProject(railedCell());
    shiftSavedVdd(older, hierarchicalSymbolId("Bias"));
    const first = importProject(destination, older, older.topDocumentId);
    expect(captures(first.plan)).toBe(1);
    expect(
      captures(
        planProjectCellImport(first.project, older, older.topDocumentId, {
          sharedSnapshot: true,
        }),
      ),
    ).toBe(0);
  });

  it("redraws a Cell whose saved drawing no longer matches its interface", () => {
    const source = callingProject(railedCell());
    const symbolId = hierarchicalSymbolId("Bias");
    const today = pinAt(source, symbolId, "VDD");
    shiftSavedVdd(source, symbolId).generatedFrom!.terminals[0]!.direction =
      "input";

    const { project } = importProject(
      createEmptyProject("destination", "Destination"),
      source,
      source.topDocumentId,
    );
    expect(pinAt(project, symbolId, "VDD")).toEqual(today);
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
