import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import { DocumentHistory } from "./history.js";
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
  it("sets a foreground color on an instance", () => {
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
    const instance = result.document.instances[0]!;
    expect(instance.styleOverride).toEqual({ foreground: "#FF0000" });
  });

  it("sets a background color without a foreground override", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { background: "#0000FF" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.styleOverride).toEqual({
      background: "#0000FF",
    });
  });

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

  it("sets both foreground and background", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: { foreground: "#FF0000", background: "#0000FF" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.styleOverride).toEqual({
      foreground: "#FF0000",
      background: "#0000FF",
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

  it("supports undo and redo", () => {
    const history = new DocumentHistory(makeDocument());
    const set = history.transact(
      makeTransaction(history.document, [
        {
          kind: "set_instance_style_override",
          instanceId: "inst-1",
          styleOverride: {
            foreground: "#FF0000",
            background: "#0000FF",
          },
        },
      ]),
    );
    expect(set).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.styleOverride).toEqual({
      foreground: "#FF0000",
      background: "#0000FF",
    });

    const undone = history.transact(
      makeTransaction(history.document, [{ kind: "undo" }]),
    );
    expect(undone).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.styleOverride).toBeUndefined();

    const redone = history.transact(
      makeTransaction(history.document, [{ kind: "redo" }]),
    );
    expect(redone).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.styleOverride).toEqual({
      foreground: "#FF0000",
      background: "#0000FF",
    });
  });

  it("bumps the document revision", () => {
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
    expect(result.revision).toBe(1);
    expect(result.document.revision).toBe(1);
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

  it("persists annotation textColor through upsert_schematic_annotation undo and redo", () => {
    const history = new DocumentHistory(makeDocument());
    const set = history.transact(
      makeTransaction(history.document, [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "note-colored",
            kind: "route-marker",
            markerKind: "current",
            content: { runs: [{ kind: "text", value: "I_ref" }] },
            anchor: { kind: "free", position: { x: 40, y: 40 } },
            alignment: "middle",
            rotation: 0,
            locked: false,
            textColor: "#123ABC",
          },
        },
      ]),
    );
    expect(set).toMatchObject({ ok: true, applied: true });
    expect(history.document.annotations[0]!.textColor).toBe("#123ABC");

    const undone = history.transact(
      makeTransaction(history.document, [{ kind: "undo" }]),
    );
    expect(undone).toMatchObject({ ok: true, applied: true });
    expect(history.document.annotations).toHaveLength(0);

    const redone = history.transact(
      makeTransaction(history.document, [{ kind: "redo" }]),
    );
    expect(redone).toMatchObject({ ok: true, applied: true });
    expect(history.document.annotations[0]!.textColor).toBe("#123ABC");
  });
});
