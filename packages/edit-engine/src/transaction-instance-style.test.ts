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

describe("set_instance_style_override edit", () => {
  it("replaces an existing override with foreground only", () => {
    const doc = makeDocument();
    const r1 = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000", background: "#0000FF" },
        },
      ]),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = executeTransaction(
      r1.document,
      makeTransaction(r1.document, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#00FF00" },
        },
      ]),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.document.instances[0]!.styleOverride).toEqual({
      foreground: "#00FF00",
    });
  });

  it("replaces the existing override as a whole", () => {
    const doc = makeDocument();
    const r1 = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000" },
        },
      ]),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = executeTransaction(
      r1.document,
      makeTransaction(r1.document, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { background: "#0000FF" },
        },
      ]),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.document.instances[0]!.styleOverride).toEqual({
      background: "#0000FF",
    });
  });

  it("normalizes an empty override to a clear", () => {
    const doc = makeDocument();
    doc.instances[0]!.styleOverride = { foreground: "#FF0000" };
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: {},
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.styleOverride).toBeUndefined();
  });

  it("null clears all style overrides", () => {
    const doc = makeDocument();
    // First set both colors
    const r1 = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000", background: "#0000FF" },
        },
      ]),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Then clear
    const r2 = executeTransaction(
      r1.document,
      makeTransaction(r1.document, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: null,
        },
      ]),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.document.instances[0]!.styleOverride).toBeUndefined();
  });

  it("rejects when instance does not exist", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "nonexistent",
          styleOverride: { foreground: "#FF0000" },
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OBJECT_NOT_FOUND");
  });

  it("rejects a no-op edit (same override)", () => {
    const doc = makeDocument();
    // Set foreground
    const r1 = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000" },
        },
      ]),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Try to set the same thing again
    const r2 = executeTransaction(
      r1.document,
      makeTransaction(r1.document, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000" },
        },
      ]),
    );
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe("EDIT_PRECONDITION");
  });

  it("supports multiple instances with different overrides in one transaction", () => {
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
  });

  it("does not change connectivity", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // sourceStatus should not become "connectivity-modified"
    expect(result.document.sourceStatus).not.toBe("connectivity-modified");
  });
});
