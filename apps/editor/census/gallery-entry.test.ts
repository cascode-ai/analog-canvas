import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import {
  executeTransaction,
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
} from "@icm/edit-engine";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { exerciseGalleryEntry } from "./gallery-entry";

function resistor() {
  const project = createEmptyProject("gallery-source", "Gallery source");
  project.documents[0]!.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "1k" },
    },
  });
  return project;
}

/** `count` resistors in a row: one placement edit each. */
function resistors(count: number) {
  const project = resistor();
  const prototype = project.documents[0]!.instances[0]!;
  project.documents[0]!.instances = Array.from(
    { length: count },
    (_, index) => ({
      ...structuredClone(prototype),
      id: `resistor-${index}`,
      reference: `R${index + 1}`,
      placement: {
        position: { x: index * 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    }),
  );
  return project;
}

/** A top calling a Cell whose one Pin is a local VDD rail. */
function railedCellCaller() {
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
  const project = createEmptyProject("gallery-source", "Gallery source");
  project.documents.push(railed.document);
  project.documents[0]!.instances.push({
    id: "X1",
    reference: "X1",
    symbolId: hierarchicalSymbolId("Bias"),
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: "bias" },
    },
  });
  return withProjectComponentDefinitions(project);
}

function vddAt(project: CircuitProject) {
  return createProjectSymbolResolver(project, builtInSymbols)
    .resolve(hierarchicalSymbolId("Bias"))!
    .definition.pins.find((pin) => pin.name === "VDD")!.at;
}

/**
 * `cells` distinct Cells placed in a row, each calling the same `shared`
 * child Cells, with every Cell's generated drawing saved.
 */
function cellsSharingChildren(cells: number, shared: number) {
  const project = createEmptyProject("gallery-source", "Gallery source");
  const call = (id: string, name: string, x: number) => ({
    id,
    reference: id,
    symbolId: hierarchicalSymbolId(name),
    placement: {
      position: { x, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit" as const, childDocumentId: name },
    },
  });
  for (let j = 0; j < shared; j++)
    project.documents.push(createEmptyDocument(`Shared${j}`, `Shared${j}`));
  for (let i = 0; i < cells; i++) {
    const cell = createEmptyDocument(`Cell${i}`, `Cell${i}`);
    for (let j = 0; j < shared; j++)
      cell.instances.push(call(`X${j + 1}`, `Shared${j}`, j * 300));
    project.documents.push(cell);
    project.documents[0]!.instances.push(
      call(`X${i + 1}`, `Cell${i}`, i * 300),
    );
  }
  return withProjectComponentDefinitions(project);
}

describe("Gallery census through the editor commands", () => {
  it("records both failures when the drawing cannot be read", async () => {
    const result = await exerciseGalleryEntry("{ not a project");
    expect(result.open).toMatchObject({
      status: "failed",
      message: expect.stringContaining("could not be opened"),
    });
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("could not be opened"),
    });
  });

  it("does not count a rejected placement as insertion success", async () => {
    const project = resistor();
    project.documents[0]!.presentation.styleProfileId = "other-style-profile";
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("different style profiles"),
    });
  });

  it("rejects opening when the editor cannot resolve a component definition", async () => {
    const project = resistor();
    project.documents[0]!.instances[0]!.symbolId = "missing-component";
    const result = await exerciseGalleryEntry(JSON.stringify(project));
    expect(result.open).toMatchObject({
      status: "failed",
      message: expect.stringContaining("missing component definition"),
    });
  });

  it("inserts a drawing saved with the retired development Symbol Library lock", async () => {
    const project = resistor();
    project.symbolLibrary = {
      id: "builtin-analog",
      version: "0.0.0",
      hash: "development",
    };
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.insert.status).toBe("inserted");
  });

  it("reports a legacy Symbol Library mismatch as insertion failure", async () => {
    const project = resistor();
    project.symbolLibrary.hash = "older-library-lock";
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("incompatible Symbol Library"),
    });
  });

  it("commits a drawing of more than 1024 edits as one placement", async () => {
    const result = await exerciseGalleryEntry(
      serializeProject(resistors(1025)),
    );
    expect(result.insert.status).toBe("inserted");
    if (result.insert.status !== "inserted")
      throw new Error("Expected insertion");
    expect(result.insert.project.documents[0]!.instances).toHaveLength(1025);
  });

  it("reports a commit exceeding the transaction edit limit as failure", async () => {
    const result = await exerciseGalleryEntry(
      serializeProject(resistors(MAX_SCHEMATIC_EDITS_PER_TRANSACTION + 1)),
    );
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining(
        "Placement commit: Transaction schema validation failed",
      ),
    });
  });

  it("commits on the finer grid without moving the source geometry", async () => {
    const project = resistor();
    project.documents[0]!.presentation.grid = 1;
    project.documents[0]!.instances[0]!.placement!.position = { x: 65, y: 47 };
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.insert.status).toBe("inserted");
    if (result.insert.status !== "inserted")
      throw new Error("Expected insertion");
    expect(result.insert.adoptedGrid).toBe(1);
    expect(result.insert.project.documents[0]!.presentation.grid).toBe(1);
    expect(
      result.insert.project.documents[0]!.instances[0]!.placement!.position,
    ).toEqual({ x: 65, y: 47 });
  });

  it("records an empty drawing's open fallback without claiming it inserted", async () => {
    const result = await exerciseGalleryEntry(
      serializeProject(createEmptyProject("empty", "Empty")),
    );
    expect(result.open.status).toBe("opened");
    expect(result.insert.status).toBe("opened-empty");
  });

  it("keeps an inserted Cell's saved drawing from an older generator", async () => {
    const project = railedCellCaller();
    const today = vddAt(project);
    const pin = project
      .componentDefinitions!.find(
        (definition) => definition.symbol.id === hierarchicalSymbolId("Bias"),
      )!
      .symbol.pins.find((candidate) => candidate.name === "VDD")!;
    pin.at = { x: today.x, y: today.y + 10 };
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.insert.status).toBe("inserted");
    if (result.insert.status !== "inserted")
      throw new Error("Expected insertion");
    expect(vddAt(result.insert.project)).toEqual({
      x: today.x,
      y: today.y + 10,
    });
  });

  it.each([
    [60, 4],
    [100, 1],
    [130, 0],
  ])(
    "inserts %i Cells sharing %i child Cells within one Project transaction",
    async (cells, shared) => {
      const result = await exerciseGalleryEntry(
        serializeProject(cellsSharingChildren(cells, shared)),
      );
      expect(result.insert.status).toBe("inserted");
    },
    // A hundred Cells through the full editor commands take seconds on CI.
    30_000,
  );

  it("opens the source and commits its drawing into a separate fresh canvas", async () => {
    const result = await exerciseGalleryEntry(serializeProject(resistor()));
    expect(result.open.status).toBe("opened");
    expect(result.insert.status).toBe("inserted");
    if (result.open.status !== "opened" || result.insert.status !== "inserted")
      throw new Error("Expected both Gallery paths to succeed");
    expect(result.open.project.id).toBe("gallery-source");
    expect(result.insert.project.id).toBe("census-target");
    expect(result.insert.project.documents[0]!.instances).toEqual([
      expect.objectContaining({ reference: "R1", symbolId: "resistor" }),
    ]);
    expect(result.insert.project.documents[0]!.revision).toBeGreaterThan(0);
  });
});
