import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import type { EditTransaction } from "./edit-schema.js";
import { DocumentHistory } from "./history.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const kept = { fontScale: 2, wireStrokeScale: 1.5 };

function documentWithCopy(): SchematicDocument {
  const document = createEmptyDocument("kept-style", "Kept style");
  document.nets.push({ id: "net", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net", position: { x: 40, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
      documentStyle: kept,
    }),
  );
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    reference: "R1",
    netlist: { parameters: {} },
    documentStyle: kept,
  });
  document.drafting = {
    objects: [
      {
        id: "pinned-note",
        kind: "text",
        locked: true,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 100, y: 100 } },
        alignment: "start",
        rotation: 0,
        content: { runs: [{ kind: "text", value: "Note" }] },
        documentStyle: kept,
      },
    ],
  };
  return document;
}

function transaction(
  document: SchematicDocument,
  edits: EditTransaction["edits"],
): EditTransaction {
  return {
    transactionId: `kept-style-${document.revision}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "kept-style-test" },
    edits,
  };
}

function apply(document: SchematicDocument, edits: EditTransaction["edits"]) {
  return executeTransaction(document, transaction(document, edits), {
    symbolResolver: resolver,
  });
}

const label = {
  id: "label-R1",
  kind: "instance-label" as const,
  binding: { kind: "instance-reference" as const, instanceId: "R1" },
  anchor: {
    kind: "object" as const,
    objectId: "R1",
    localOffset: { x: 20, y: 0 },
    fallbackPosition: { x: 220, y: 200 },
  },
  alignment: "start" as const,
  rotation: 0 as const,
  locked: false,
};

describe("set_object_document_style edit", () => {
  it("releases and restores a kept style without moving anything", () => {
    const document = documentWithCopy();
    const history = new DocumentHistory(document);
    const release = history.transact(
      transaction(history.document, [
        {
          kind: "set_object_document_style",
          objectIds: ["wire", "R1"],
          documentStyle: null,
        },
      ]),
    );
    expect(release).toMatchObject({ ok: true, applied: true });
    const { documentStyle: _wire, ...plainWire } = document.routes[0]!;
    expect(history.document.routes[0]).toEqual(plainWire);
    expect(history.document.instances[0]!.documentStyle).toBeUndefined();
    expect(history.document.nets).toEqual(document.nets);
    expect(
      history.transact(transaction(history.document, [{ kind: "undo" }])),
    ).toMatchObject({ ok: true });
    expect(history.document.routes[0]!.documentStyle).toEqual(kept);
    const keep = apply(history.document, [
      {
        kind: "set_object_document_style",
        objectIds: ["J1"],
        documentStyle: { junctionRadiusScale: 1.3 },
      },
    ]);
    expect(keep.ok && keep.document.junctions[0]!.documentStyle).toEqual({
      junctionRadiusScale: 1.3,
    });
  });

  it("refuses missing and locked objects and edits that change nothing", () => {
    const document = documentWithCopy();
    const edit = (objectIds: string[], documentStyle: typeof kept | null) =>
      apply(document, [
        { kind: "set_object_document_style", objectIds, documentStyle },
      ]);
    expect(edit(["missing"], null)).toMatchObject({
      ok: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
    expect(edit(["pinned-note"], null)).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    expect(edit(["wire", "R1"], kept)).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });
});

describe("a kept style through ordinary edits", () => {
  it("gives a new label its Instance's style and keeps a text's own", () => {
    const document = documentWithCopy();
    const added = apply(document, [
      { kind: "upsert_schematic_annotation", annotation: label },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.document.annotations[0]!.documentStyle).toEqual(kept);
    const moved = apply(added.document, [
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...label, alignment: "end" },
      },
    ]);
    expect(moved.ok && moved.document.annotations[0]).toMatchObject({
      alignment: "end",
      documentStyle: kept,
    });
  });

  it("keeps a Route's style when its path is replaced or split", () => {
    const document = documentWithCopy();
    const { documentStyle: _style, ...restated } = document.routes[0]!;
    const replaced = apply(document, [
      { kind: "set_route_path", route: restated },
    ]);
    expect(replaced.ok && replaced.document.routes[0]!.documentStyle).toEqual(
      kept,
    );
    const split = apply(document, [
      {
        kind: "add_junction",
        junctionId: "J3",
        netId: "net",
        position: { x: 20, y: 0 },
        split: {
          routeId: "wire",
          firstRouteId: "wire-a",
          secondRouteId: "wire-b",
          legId: document.routes[0]!.legs[0]!.id,
        },
      },
    ]);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(
      split.document.routes.map((route) => [route.id, route.documentStyle]),
    ).toEqual([
      ["wire-a", kept],
      ["wire-b", kept],
    ]);
  });
});
