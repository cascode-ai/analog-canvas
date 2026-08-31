import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import { DocumentHistory } from "./history.js";
import { executeTransaction } from "./transaction.js";

function makeDocument(): SchematicDocument {
  const doc = createEmptyDocument("doc-1", "Main");
  doc.instances.push({
    id: "inst-1",
    symbolId: "adder",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
    reference: "X1",
    netlist: { parameters: { gain: "4" } },
  });
  return doc;
}

function makeTransaction(
  document: SchematicDocument,
  edits: EditTransaction["edits"],
  dryRun = false,
): EditTransaction {
  return {
    transactionId: "tx-1",
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "user-1" },
    ...(dryRun ? { dryRun: true } : {}),
    edits,
  };
}

describe("set_instance_signal_flow_parameters edit", () => {
  it("sets formula, coefficient, and optional frame size independently of netlist parameters", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "inst-1",
          parameters: {
            formula: "z^-1",
            coefficient: "a1",
            bodyWidth: 160,
            bodyHeight: 90,
          },
        },
      ]),
    );
    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      diff: { changedObjectIds: ["inst-1"] },
    });
    if (!result.ok) return;
    expect(result.document.instances[0]!.signalFlowParameters).toEqual({
      formula: "z^-1",
      coefficient: "a1",
      bodyWidth: 160,
      bodyHeight: 90,
    });
    expect(result.document.instances[0]!.netlist?.parameters).toEqual({
      gain: "4",
    });
  });

  it("replaces existing parameters as a whole and accepts size-only edits", () => {
    const doc = makeDocument();
    doc.instances[0]!.signalFlowParameters = {
      formula: "z^-1",
      coefficient: "a1",
    };
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "inst-1",
          parameters: { bodyWidth: 180, bodyHeight: 100 },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances[0]!.signalFlowParameters).toEqual({
      bodyWidth: 180,
      bodyHeight: 100,
    });
  });

  it("normalizes empty objects and null to clearing the field", () => {
    for (const parameters of [{}, null] as const) {
      const doc = makeDocument();
      doc.instances[0]!.signalFlowParameters = {
        formula: "1-z^-1",
        coefficient: "c0",
        bodyWidth: 120,
      };
      const result = executeTransaction(
        doc,
        makeTransaction(doc, [
          {
            kind: "set_instance_signal_flow_parameters",
            instanceId: "inst-1",
            parameters,
          },
        ]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(
        result.document.instances[0]!.signalFlowParameters,
      ).toBeUndefined();
    }
  });

  it("rejects missing instances and no-op edits", () => {
    const doc = makeDocument();
    const missing = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "missing",
          parameters: { formula: "z^-1" },
        },
      ]),
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });

    doc.instances[0]!.signalFlowParameters = { formula: "z^-1" };
    const noop = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "inst-1",
          parameters: { formula: "z^-1" },
        },
      ]),
    );
    expect(noop).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
  });

  it("supports dry-run without mutating the source document", () => {
    const doc = makeDocument();
    const result = executeTransaction(
      doc,
      makeTransaction(
        doc,
        [
          {
            kind: "set_instance_signal_flow_parameters",
            instanceId: "inst-1",
            parameters: {
              formula: "z^-2",
              coefficient: "d1",
              bodyWidth: 100,
            },
          },
        ],
        true,
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      applied: false,
      revision: 0,
      proposedRevision: 1,
    });
    if (!result.ok) return;
    expect(result.document.instances[0]!.signalFlowParameters).toEqual({
      formula: "z^-2",
      coefficient: "d1",
      bodyWidth: 100,
    });
    expect(doc.instances[0]!.signalFlowParameters).toBeUndefined();
  });

  it("preserves connectivity/source semantics and supports undo/redo", () => {
    const doc = makeDocument();
    doc.sourceStatus = "in-sync";
    const result = executeTransaction(
      doc,
      makeTransaction(doc, [
        {
          kind: "set_instance_signal_flow_parameters",
          instanceId: "inst-1",
          parameters: { formula: "z^-1", coefficient: "a1" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.sourceStatus).not.toBe("connectivity-modified");

    const history = new DocumentHistory(makeDocument());
    expect(
      history.transact(
        makeTransaction(history.document, [
          {
            kind: "set_instance_signal_flow_parameters",
            instanceId: "inst-1",
            parameters: { bodyWidth: 180, bodyHeight: 100 },
          },
        ]),
      ),
    ).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.signalFlowParameters).toEqual({
      bodyWidth: 180,
      bodyHeight: 100,
    });
    expect(
      history.transact(makeTransaction(history.document, [{ kind: "undo" }])),
    ).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.signalFlowParameters).toBeUndefined();
    expect(
      history.transact(makeTransaction(history.document, [{ kind: "redo" }])),
    ).toMatchObject({ ok: true, applied: true });
    expect(history.document.instances[0]!.signalFlowParameters).toEqual({
      bodyWidth: 180,
      bodyHeight: 100,
    });
  });
});
