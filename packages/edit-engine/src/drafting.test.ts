import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";

function transaction(
  documentId: string,
  edits: unknown[],
  expectedRevision = 0,
) {
  return {
    transactionId: "drafting-edit",
    documentId,
    expectedRevision,
    actor: { kind: "human", id: "reviewer" },
    edits,
  };
}

describe("drafting and guide edits", () => {
  it("initializes the drafting layer when absent", () => {
    const document = createEmptyDocument("doc", "Drafting");
    delete document.drafting;
    const result = executeTransaction(
      document,
      transaction("doc", [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "t1",
            kind: "text",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 0 } },
            content: { runs: [{ kind: "text", value: "x" }] },
            alignment: "start",
            rotation: 0,
          },
        },
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it("draws nothing in the sheet's own color to cover the drawing", () => {
    const line = (color?: string, x = 0) => ({
      id: "mask",
      kind: "construction-line" as const,
      locked: false,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x, y: 0 } },
      points: [
        { x, y: 0 },
        { x: x + 10, y: 0 },
      ],
      lineStyle: "solid" as const,
      ...(color ? { styleOverride: { color, strokeScale: 4 } } : {}),
    });
    const upsert = (
      document: ReturnType<typeof createEmptyDocument>,
      object: unknown,
      revision = 0,
    ) =>
      executeTransaction(
        document,
        transaction(
          "doc",
          [{ kind: "upsert_drafting_object", object }],
          revision,
        ),
      );
    // White or nearly, stroke or fill: refused, with the reason.
    for (const color of ["#ffffff", "#FFF", "#fafaf9"]) {
      const refused = upsert(createEmptyDocument("doc", "Mask"), line(color));
      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain("needs no hop");
    }
    const filled = upsert(createEmptyDocument("doc", "Fill"), {
      id: "box",
      kind: "rectangle",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      center: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
      lineStyle: "solid",
      styleOverride: { fillColor: "#ffffff" },
    });
    expect(filled.ok).toBe(false);
    expect(JSON.stringify(filled)).toContain("needs no hop");
    // A visible color is drawing.
    expect(upsert(createEmptyDocument("doc", "Grey"), line("#e0e0e0")).ok).toBe(
      true,
    );
    // An older white object keeps its color and still moves; a black one
    // never turns white.
    const older = createEmptyDocument("doc", "Older");
    older.drafting = {
      ...older.drafting!,
      objects: [line("#ffffff") as never],
    };
    expect(upsert(older, line("#ffffff", 20)).ok).toBe(true);
    const black = createEmptyDocument("doc", "Black");
    const drawn = upsert(black, line("#000000"));
    expect(drawn.ok).toBe(true);
    if (drawn.ok)
      expect(
        JSON.stringify(upsert(drawn.document, line("#ffffff"), 1)),
      ).toContain("needs no hop");
  });

  it("keeps drafting layout groups valid as their objects are removed", () => {
    const document = createEmptyDocument("doc", "Grouped drafting");
    const line = (id: string, y: number) => ({
      id,
      kind: "construction-line" as const,
      locked: false,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x: 0, y } },
      points: [
        { x: 0, y },
        { x: 100, y },
      ],
      lineStyle: "solid" as const,
    });
    const created = executeTransaction(
      document,
      transaction("doc", [
        { kind: "upsert_drafting_object", object: line("wave-a", 0) },
        { kind: "upsert_drafting_object", object: line("wave-b", 20) },
        {
          kind: "set_layout_group",
          group: {
            id: "waveform-group",
            kind: "custom",
            objectIds: ["wave-a", "wave-b"],
            locked: false,
          },
        },
      ]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const firstRemoved = executeTransaction(
      created.document,
      transaction(
        "doc",
        [{ kind: "remove_drafting_object", objectId: "wave-a" }],
        1,
      ),
    );
    expect(firstRemoved.ok).toBe(true);
    if (!firstRemoved.ok) return;
    expect(firstRemoved.document.layoutGroups[0]?.objectIds).toEqual([
      "wave-b",
    ]);

    const secondRemoved = executeTransaction(
      firstRemoved.document,
      transaction(
        "doc",
        [{ kind: "remove_drafting_object", objectId: "wave-b" }],
        2,
      ),
    );
    expect(secondRemoved.ok).toBe(true);
    if (!secondRemoved.ok) return;
    expect(secondRemoved.document.layoutGroups).toEqual([]);
  });

  it("removes a locked drafting object because Delete has priority", () => {
    const document = createEmptyDocument("doc", "Drafting");
    const created = executeTransaction(
      document,
      transaction("doc", [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "t1",
            kind: "text",
            locked: true,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 0 } },
            content: { runs: [{ kind: "text", value: "x" }] },
            alignment: "start",
            rotation: 0,
          },
        },
      ]),
    );
    if (!created.ok) throw new Error("setup failed");
    const removed = executeTransaction(
      created.document,
      transaction(
        "doc",
        [{ kind: "remove_drafting_object", objectId: "t1" }],
        1,
      ),
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.drafting?.objects).toEqual([]);
  });

  it("allows only a pure unlock while a locked drafting object exists", () => {
    const document = createEmptyDocument("doc", "Drafting");
    const lockedText = {
      id: "t1",
      kind: "text" as const,
      locked: true,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      content: { runs: [{ kind: "text" as const, value: "x" }] },
      alignment: "start" as const,
      rotation: 0 as const,
    };
    const created = executeTransaction(
      document,
      transaction("doc", [
        { kind: "upsert_drafting_object", object: lockedText },
      ]),
    );
    if (!created.ok) throw new Error("setup failed");

    const altered = executeTransaction(
      created.document,
      transaction(
        "doc",
        [
          {
            kind: "upsert_drafting_object",
            object: { ...lockedText, locked: false, zIndex: 1 },
          },
        ],
        1,
      ),
    );
    expect(altered.ok).toBe(false);

    const unlocked = executeTransaction(
      created.document,
      transaction(
        "doc",
        [
          {
            kind: "upsert_drafting_object",
            object: { ...lockedText, locked: false },
          },
        ],
        1,
      ),
    );
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(unlocked.document.drafting?.objects[0]?.locked).toBe(false);

    const removed = executeTransaction(
      unlocked.document,
      transaction(
        "doc",
        [{ kind: "remove_drafting_object", objectId: "t1" }],
        2,
      ),
    );
    expect(removed.ok).toBe(true);
  });

  it("rejects a floating symbol without a resolver (no decorative validation possible)", () => {
    const document = createEmptyDocument("doc", "Floating");
    const result = executeTransaction(
      document,
      transaction("doc", [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "f1",
            kind: "floating-symbol",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 0 } },
            symbolId: "nmos",
            transform: { rotation: 0, mirror: "none" },
          },
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects removed decorative and terminal-bearing floating symbols", () => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const document = createEmptyDocument("doc", "Floating");
    const decorative = executeTransaction(
      document,
      transaction("doc", [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "f1",
            kind: "floating-symbol",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 0 } },
            symbolId: "decorative-note-box",
            transform: { rotation: 0, mirror: "none" },
          },
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(decorative.ok).toBe(false);

    const terminal = executeTransaction(
      document,
      transaction("doc", [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "f2",
            kind: "floating-symbol",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 0 } },
            symbolId: "nmos",
            transform: { rotation: 0, mirror: "none" },
          },
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(terminal.ok).toBe(false);
  });
});
