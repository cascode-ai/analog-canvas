import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./history.js";
import { planWireBatch } from "./wire-batch-planner.js";
import type { WireIntent } from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const free = (x: number, y: number) => ({
  kind: "free" as const,
  point: { x, y },
});
const at = (x: number, y: number) => ({
  kind: "wire-at" as const,
  point: { x, y },
});
const wire = (
  id: string,
  from: WireIntent["from"],
  to: WireIntent["to"],
  waypoints: { x: number; y: number }[] = [],
): WireIntent => ({ id, from, to, waypoints });
function commit(history: DocumentHistory, intents: WireIntent[]) {
  const before = structuredClone(history.document);
  const plan = planWireBatch(history.document, resolver, intents, 512);
  expect(typeof plan, JSON.stringify(plan)).not.toBe("string");
  if (typeof plan === "string") throw new Error(plan);
  expect(history.document).toEqual(before);
  const result = history.transact({
    transactionId: `test-${before.revision}`,
    documentId: before.id,
    expectedRevision: before.revision,
    actor: { kind: "agent", id: "test" },
    edits: plan.edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return before;
}
function history(
  document: SchematicDocument = createEmptyDocument("doc", "Batch wires"),
) {
  return new DocumentHistory(document, { symbolResolver: resolver });
}
describe("wire batch replay", () => {
  it("merges existing conductors and taps the merged geometry atomically", () => {
    const h = history();
    commit(h, [
      wire("a", free(0, 0), free(100, 0)),
      wire("b", free(200, 0), free(300, 0)),
    ]);
    const before = commit(h, [
      wire("join", at(100, 0), at(200, 0)),
      wire("tap", at(250, 0), free(250, 100)),
    ]);
    expect(h.document.nets).toHaveLength(1);
    expect(h.document.revision).toBe(before.revision + 1);
    h.transact({
      transactionId: "undo",
      documentId: h.document.id,
      expectedRevision: h.document.revision,
      actor: { kind: "agent", id: "test" },
      edits: [{ kind: "undo" }],
    });
    expect(h.document.routes).toEqual(before.routes);
    expect(h.document.nets).toEqual(before.nets);
  });
  it("merges an existing output conductor and then splits its earlier Route", () => {
    const h = history();
    commit(h, [
      wire("output", free(850, 180), free(850, 460)),
      wire("load", free(960, 360), free(1000, 360)),
    ]);
    commit(h, [
      wire("join", at(960, 360), at(850, 360)),
      wire("tap", free(780, 300), at(850, 300)),
    ]);
    expect(h.document.nets).toHaveLength(1);
  });
  it("still refuses taps at foreign crossings, including after prior batch work", () => {
    const h = history();
    commit(h, [
      wire("horizontal", free(0, 0), free(100, 0)),
      wire("vertical", free(50, -50), free(50, 50)),
    ]);
    const before = structuredClone(h.document);
    const plan = planWireBatch(
      h.document,
      resolver,
      [
        wire("elsewhere", free(200, 0), free(300, 0)),
        wire("bad-tap", free(50, 100), at(50, 0)),
      ],
      512,
    );
    expect(plan).toMatch(/Ambiguous wire crossing/);
    expect(h.document).toEqual(before);
  });
  it("resolves successive bias taps without referencing normalized-away endpoints", () => {
    const h = history();
    commit(h, [
      wire("b1", free(140, 480), free(170, 460), [
        { x: 120, y: 480 },
        { x: 120, y: 420 },
        { x: 170, y: 420 },
      ]),
      wire("b2", free(80, 400), at(170, 460), [{ x: 170, y: 400 }]),
      wire("b3", free(410, 480), at(170, 420), [
        { x: 370, y: 480 },
        { x: 370, y: 420 },
      ]),
      wire("b4", free(820, 480), at(370, 420), [
        { x: 780, y: 480 },
        { x: 780, y: 420 },
      ]),
    ]);
    expect(h.document.nets).toHaveLength(1);
  });
  it("leaves the original untouched when a later tap is invalid or over budget", () => {
    const d = createEmptyDocument("doc", "Reject atomically");
    const before = structuredClone(d);
    const intents = [
      wire("a", free(0, 0), free(100, 0)),
      wire("bad", at(300, 0), free(300, 100)),
    ];
    expect(planWireBatch(d, resolver, intents, 512)).toMatch(/Wire 2:/);
    expect(planWireBatch(d, resolver, intents, 1)).toMatch(/exceeding/);
    expect(d).toEqual(before);
  });
});
