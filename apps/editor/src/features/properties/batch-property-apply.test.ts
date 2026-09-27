import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  type Annotation,
  type DraftingObject,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  batchAnnotationEdits,
  batchDraftingEdits,
} from "./batch-property-apply";

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
