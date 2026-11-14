import { describe, expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import {
  createEmptyDocument,
  resolveDrawingOrder,
  type Annotation,
  type DraftingObject,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  batchAnnotationEdits,
  batchDraftingEdits,
  drawingPropertyEdits,
} from "./batch-property-apply";
import { EMPTY_VISUAL_SELECTION } from "../selection/visual-selection";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const note = (
  id: string,
  value: string,
  x: number,
): Extract<DraftingObject, { kind: "text" }> => ({
  id,
  kind: "text",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x, y: 100 } },
  content: { runs: [{ kind: "text", value }] },
  alignment: "middle",
  rotation: 0,
});

const line: DraftingObject = {
  id: "line",
  kind: "arrow",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 0, y: 200 } },
  from: { kind: "free", position: { x: 0, y: 200 } },
  to: { kind: "free", position: { x: 100, y: 200 } },
};

function drawing(objects: DraftingObject[]): SchematicDocument {
  return {
    ...createEmptyDocument("batch", "Batch"),
    drafting: { objects },
  };
}

const upserted = (edits: ReturnType<typeof batchDraftingEdits>) =>
  edits.flatMap((edit) =>
    edit.kind === "upsert_drafting_object" ? [edit.object] : [],
  );

describe("one Properties edit for several selected objects", () => {
  it.each([false, true])(
    "updates a shape and moves the entire group atomically (locked=%s)",
    (locked) => {
      const shape: DraftingObject = {
        id: "box",
        kind: "rectangle",
        center: { x: 150, y: 100 },
        anchor: { kind: "free", position: { x: 150, y: 100 } },
        width: 40,
        height: 20,
        rotation: 0,
        zIndex: 0,
        layer: "background",
        lineStyle: "solid",
        locked: false,
      };
      const peer = { ...line, locked };
      const document = drawing([shape, peer]);
      document.layoutGroups = [
        {
          id: "group",
          kind: "custom",
          objectIds: [shape.id, peer.id],
          locked: false,
        },
      ];
      const edits = drawingPropertyEdits(
        document,
        resolver,
        10,
        shape,
        { object: { ...shape, width: 70 }, layer: "front" },
        { ...EMPTY_VISUAL_SELECTION, draftingIds: [shape.id] },
      );
      const result = executeTransaction(document, {
        transactionId: "properties",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits,
      });
      if (locked) {
        expect(result.ok).toBe(false);
        expect(result.document).toEqual(document);
      } else {
        expect(result.ok).toBe(true);
        expect(resolveDrawingOrder(result.document).slice(-2)).toEqual([
          { kind: "drafting", id: shape.id },
          { kind: "drafting", id: peer.id },
        ]);
        expect(result.document.drafting?.objects[0]).toMatchObject({
          width: 70,
        });
      }
    },
  );

  it("gives every selected text the new size and keeps its own words and place", () => {
    const first = note("a", "Vin", 100);
    const second = note("b", "Vout", 200);
    const document = drawing([first, second, note("c", "unselected", 300)]);
    const edited = { ...first, styleOverride: { sizeScale: 1.5 } };
    const [other, ...rest] = upserted(
      batchDraftingEdits(document, resolver, 10, first, edited, ["a", "b"]),
    );
    expect(rest).toEqual([]);
    expect(other).toMatchObject({
      id: "b",
      styleOverride: { sizeScale: 1.5 },
      content: second.content,
      anchor: second.anchor,
    });
  });

  it("carries only the settings each kind has", () => {
    const text = note("a", "Vin", 100);
    const document = drawing([text, line]);
    // A new size means nothing to a line; a new color reaches it.
    expect(
      batchDraftingEdits(
        document,
        resolver,
        10,
        text,
        { ...text, styleOverride: { sizeScale: 2 } },
        ["a", "line"],
      ),
    ).toEqual([]);
    expect(
      upserted(
        batchDraftingEdits(
          document,
          resolver,
          10,
          text,
          { ...text, styleOverride: { color: "#cc0000" } },
          ["a", "line"],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        id: "line",
        styleOverride: { color: "#cc0000" },
      }),
    ]);
  });

  it("leaves a moved or retyped object's place and words to it alone", () => {
    const first = note("a", "Vin", 100);
    const document = drawing([first, note("b", "Vout", 200)]);
    const moved = {
      ...first,
      anchor: { kind: "free" as const, position: { x: 150, y: 100 } },
      content: { runs: [{ kind: "text" as const, value: "Vx" }] },
    };
    expect(
      batchDraftingEdits(document, resolver, 10, first, moved, ["a", "b"]),
    ).toEqual([]);
  });

  it("changes a locked object only by its lock", () => {
    const first = note("a", "Vin", 100);
    const locked = { ...note("b", "Vout", 200), locked: true };
    const document = drawing([first, locked]);
    expect(
      batchDraftingEdits(
        document,
        resolver,
        10,
        first,
        { ...first, styleOverride: { sizeScale: 2 } },
        ["a", "b"],
      ),
    ).toEqual([]);
    const lockedFirst = { ...first, locked: true };
    expect(
      upserted(
        batchDraftingEdits(
          drawing([lockedFirst, locked]),
          resolver,
          10,
          lockedFirst,
          first,
          ["a", "b"],
        ),
      ),
    ).toEqual([expect.objectContaining({ id: "b", locked: false })]);
  });

  it("sizes every selected label together", () => {
    const label = (id: string, instanceId: string): Annotation => ({
      id,
      kind: "instance-label",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      locked: false,
      alignment: "middle",
      rotation: 0,
      binding: { kind: "instance-reference", instanceId },
    });
    const first = label("label-r1", "R1");
    const second = label("label-r2", "R2");
    const document = {
      ...createEmptyDocument("labels", "Labels"),
      annotations: [first, second],
    };
    const edits = batchAnnotationEdits(
      document,
      first,
      { ...first, sizeScale: 1.4, textColor: "#123456" },
      ["label-r1", "label-r2"],
    );
    expect(edits).toEqual([
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...second, sizeScale: 1.4, textColor: "#123456" },
      },
    ]);
  });
});
