import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import type { EditTransaction } from "./edit-schema.js";
import { DocumentHistory } from "./history.js";
import { executeTransaction } from "./transaction.js";

function documentWithRoute(): SchematicDocument {
  const document = createEmptyDocument("route-style", "Route style");
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
    }),
  );
  return document;
}

function transaction(
  document: SchematicDocument,
  edits: EditTransaction["edits"],
): EditTransaction {
  return {
    transactionId: `route-style-${document.revision}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "route-style-test" },
    edits,
  };
}

describe("set_route_style_override edit", () => {
  it("sets and clears a wire color without changing connectivity", () => {
    const document = documentWithRoute();
    const set = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "set_route_style_override",
          routeId: "wire",
          styleOverride: { color: "#FF0000" },
        },
      ]),
    );
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.document.routes[0]!.styleOverride).toEqual({ color: "#FF0000" });
    expect(set.document.routes[0]!.netId).toBe("net");

    const clear = executeTransaction(
      set.document,
      transaction(set.document, [
        {
          kind: "set_route_style_override",
          routeId: "wire",
          styleOverride: null,
        },
      ]),
    );
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;
    expect(clear.document.routes[0]!.styleOverride).toBeUndefined();
  });

  it("rejects invalid colors, missing routes, and no-op changes", () => {
    const document = documentWithRoute();
    expect(
      executeTransaction(document, {
        ...transaction(document, [] as never[]),
        edits: [
          {
            kind: "set_route_style_override",
            routeId: "wire",
            styleOverride: { color: "red" },
          },
        ],
      }).ok,
    ).toBe(false);
    const missing = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "set_route_style_override",
          routeId: "missing",
          styleOverride: { color: "#123456" },
        },
      ]),
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
    const noOp = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "set_route_style_override",
          routeId: "wire",
          styleOverride: null,
        },
      ]),
    );
    expect(noOp).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("participates in document undo and redo", () => {
    const history = new DocumentHistory(documentWithRoute());
    const set = history.transact(
      transaction(history.document, [
        {
          kind: "set_route_style_override",
          routeId: "wire",
          styleOverride: { color: "#0066CC" },
        },
      ]),
    );
    expect(set).toMatchObject({ ok: true, applied: true });
    expect(history.document.routes[0]!.styleOverride?.color).toBe("#0066CC");
    const undone = history.transact(
      transaction(history.document, [{ kind: "undo" }]),
    );
    expect(undone).toMatchObject({ ok: true, applied: true });
    expect(history.document.routes[0]!.styleOverride).toBeUndefined();
    const redone = history.transact(
      transaction(history.document, [{ kind: "redo" }]),
    );
    expect(redone).toMatchObject({ ok: true, applied: true });
    expect(history.document.routes[0]!.styleOverride?.color).toBe("#0066CC");
  });
});
