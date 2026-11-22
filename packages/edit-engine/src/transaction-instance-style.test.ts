import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import { executeTransaction } from "./transaction.js";
import type { EditTransaction } from "./edit-schema.js";

function makeDocument(): SchematicDocument {
  const doc = createEmptyDocument("doc-1", "Main");
  doc.instances.push({
    id: "inst-1",
    symbolId: "resistor",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
    reference: "R1",
    netlist: { parameters: {} },
  });
  return doc;
}

function makeTransaction(
  document: SchematicDocument,
  edits: EditTransaction["edits"],
): EditTransaction {
  return {
    transactionId: "tx-1",
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "user-1" },
    edits,
  };
}

function setStyle(
  document: SchematicDocument,
  instanceId: string,
  styleOverride: { foreground?: string; background?: string } | null,
) {
  return executeTransaction(
    document,
    makeTransaction(document, [
      { kind: "set_instance_style_override", instanceId, styleOverride },
    ]),
  );
}

describe("set_instance_style_override edit", () => {
  it.each([
    {
      name: "replaces an existing override with foreground only",
      current: { foreground: "#FF0000", background: "#0000FF" },
      next: { foreground: "#00FF00" },
      expected: { foreground: "#00FF00" },
    },
    {
      name: "replaces the existing override as a whole",
      current: { foreground: "#FF0000" },
      next: { background: "#0000FF" },
      expected: { background: "#0000FF" },
    },
    {
      name: "normalizes an empty override to a clear",
      current: { foreground: "#FF0000" },
      next: {},
      expected: undefined,
    },
    {
      name: "null clears all style overrides",
      current: { foreground: "#FF0000", background: "#0000FF" },
      next: null,
      expected: undefined,
    },
  ])("$name", ({ current, next, expected }) => {
    const doc = makeDocument();
    doc.instances[0]!.styleOverride = current;
    const result = setStyle(doc, "inst-1", next);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.styleOverride).toEqual(expected);
  });

  it("rejects a missing instance and a no-op edit (same override)", () => {
    const doc = makeDocument();
    expect(
      setStyle(doc, "nonexistent", { foreground: "#FF0000" }),
    ).toMatchObject({ ok: false, error: { code: "OBJECT_NOT_FOUND" } });
    doc.instances[0]!.styleOverride = { foreground: "#FF0000" };
    expect(setStyle(doc, "inst-1", { foreground: "#FF0000" })).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("supports multiple instances with different overrides in one transaction without changing connectivity", () => {
    const doc = makeDocument();
    doc.instances.push({
      id: "inst-2",
      symbolId: "capacitor",
      placement: {
        position: { x: 200, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "C1",
      netlist: { parameters: {} },
    });
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000" },
        },
        {
          kind: "set_instance_style_override",
          instanceId: "inst-2",
          styleOverride: { foreground: "#00FF00", background: "#EEEEEE" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.styleOverride).toEqual({
      foreground: "#FF0000",
    });
    expect(result.document.instances[1]!.styleOverride).toEqual({
      foreground: "#00FF00",
      background: "#EEEEEE",
    });
    expect(result.document.sourceStatus).not.toBe("connectivity-modified");
  });
});
