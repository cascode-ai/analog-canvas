import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { deriveDocumentContactEvidence } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { executeTransaction } from "./transaction.js";
import type { EditExecutionContext } from "./transaction-result.js";
import { DocumentHistory } from "./history.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const d = createEmptyDocument("hint", "Hint parity");
  d.instances = ["A", "B"].map((id) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  }));
  d.nets = ["1", "2"].map((pinName) => ({
    id: `n${pinName}`,
    terminals: ["A", "B"].map((instanceId) => ({ instanceId, pinName })),
  }));
  return d;
}
function request(d: SchematicDocument, edits: unknown[]) {
  return {
    transactionId: `hint-${d.revision}`,
    documentId: d.id,
    expectedRevision: d.revision,
    actor: { kind: "human", id: "test" },
    edits,
  };
}
const move = (x: number) => ({
  kind: "move_instance",
  instanceId: "A",
  position: { x, y: 0 },
});

describe("before contact evidence hint", () => {
  it("uses matching evidence with identical complete transaction results", () => {
    const d = fixture();
    const evidence = deriveDocumentContactEvidence(d, resolver);
    let reads = 0;
    const input = request(d, [move(40)]);
    const plain = executeTransaction(d, input, { symbolResolver: resolver });
    const hinted = executeTransaction(d, input, {
      symbolResolver: resolver,
      beforeContactEvidence: {
        document: d,
        get evidence() {
          reads++;
          return evidence;
        },
      },
    });
    expect(hinted).toEqual(plain);
    expect(reads).toBeGreaterThan(0);
    expect(hinted.ok).toBe(true);
    if (hinted.ok) expect(hinted.document.routes.length).toBeGreaterThan(0);
  });

  it("ignores another object even with the same document id and revision", () => {
    const d = fixture();
    const input = request(d, [move(40)]);
    const hinted = executeTransaction(d, input, {
      symbolResolver: resolver,
      beforeContactEvidence: {
        document: structuredClone(d),
        get evidence(): never {
          throw new Error("foreign evidence must not be consumed");
        },
      },
    });
    expect(hinted).toEqual(
      executeTransaction(d, input, { symbolResolver: resolver }),
    );
    expect(hinted.ok).toBe(true);
  });

  it("preserves sequential edits and undo/redo when an old hint remains", () => {
    const d = fixture();
    const context: EditExecutionContext = { symbolResolver: resolver };
    const hinted = new DocumentHistory(d, context);
    const plain = new DocumentHistory(d, { symbolResolver: resolver });
    context.beforeContactEvidence = {
      document: hinted.document,
      evidence: deriveDocumentContactEvidence(hinted.document, resolver),
    };
    for (const edits of [
      [move(40)],
      [move(80)],
      [{ kind: "undo" }],
      [{ kind: "redo" }],
      [{ kind: "undo" }],
      [move(120)],
    ]) {
      const result = hinted.transact(request(hinted.document, edits));
      expect(result).toEqual(plain.transact(request(plain.document, edits)));
      expect(result.ok).toBe(true);
      expect(hinted.document).toEqual(plain.document);
    }
  });
});
