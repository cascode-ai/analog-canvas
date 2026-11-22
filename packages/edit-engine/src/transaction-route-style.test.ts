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
  it.each([
    { lineStyle: "solid" },
    { lineStyle: "dashed" },
    { color: "#FF0000" },
    { arrow: "middle" },
  ] as const)(
    "sets %o alone, preserves connectivity, undoes, redoes and clears",
    (styleOverride) => {
      const document = documentWithRoute();
      const history = new DocumentHistory(document);
      const set = (value: typeof styleOverride | null) =>
        history.transact(
          transaction(history.document, [
            {
              kind: "set_route_style_override",
              routeId: "wire",
              styleOverride: value,
            },
          ]),
        );
      expect(set(styleOverride)).toMatchObject({ ok: true, applied: true });
      expect(history.document.nets).toEqual(document.nets);
      expect(history.document.junctions).toEqual(document.junctions);
      expect(history.document.routes[0]).toEqual({
        ...document.routes[0],
        styleOverride,
      });
      expect(
        history.transact(transaction(history.document, [{ kind: "undo" }])),
      ).toMatchObject({ ok: true });
      expect(history.document.routes[0]!.styleOverride).toBeUndefined();
      expect(
        history.transact(transaction(history.document, [{ kind: "redo" }])),
      ).toMatchObject({ ok: true });
      expect(history.document.routes[0]!.styleOverride).toEqual(styleOverride);
      expect(set(null)).toMatchObject({ ok: true });
      expect(history.document.routes[0]!.styleOverride).toBeUndefined();
    },
  );

  it("rejects invalid colors, missing routes, and no-op changes", () => {
    const document = documentWithRoute();
    for (const styleOverride of [
      { lineStyle: "long-dash" },
      { color: "red" },
      { arrow: "start" },
    ]) {
      expect(
        executeTransaction(document, {
          ...transaction(document, [] as never[]),
          edits: [
            {
              kind: "set_route_style_override",
              routeId: "wire",
              styleOverride,
            },
          ],
        }).ok,
      ).toBe(false);
    }
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
});
