import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  describeDocumentStyle,
  keptDocumentStyleOfSelection,
  releaseKeptDocumentStyleEdit,
} from "./kept-document-style";

const nothing = {
  instanceIds: [],
  routeIds: [],
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
};

function drawing(): SchematicDocument {
  const document = createEmptyDocument("doc", "Pasted");
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      documentStyle: { fontScale: 2, wireStrokeScale: 1.5 },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
    },
  );
  document.annotations.push(
    {
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 20, y: 0 },
        fallbackPosition: { x: 20, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
      documentStyle: { fontScale: 2, wireStrokeScale: 1.5 },
    },
    {
      id: "locked-note",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "Note" }] },
      anchor: { kind: "free", position: { x: 0, y: 80 } },
      alignment: "start",
      rotation: 0,
      locked: true,
      documentStyle: { fontScale: 2 },
    },
  );
  return document;
}

describe("kept Document style in Properties", () => {
  it("names the kept factors in the Style settings' words", () => {
    expect(
      describeDocumentStyle({ fontScale: 2, junctionRadiusScale: 1.3 }),
    ).toBe("Font size 2×, Junction dot size 1.3×");
    expect(describeDocumentStyle({ wireStrokeScale: 1 })).toBe(
      "the standard style",
    );
  });

  it("finds selected copies with their labels and releases them in one edit", () => {
    const document = drawing();
    expect(keptDocumentStyleOfSelection(document, nothing)).toBeNull();
    expect(
      keptDocumentStyleOfSelection(document, {
        ...nothing,
        instanceIds: ["R2"],
      }),
    ).toBeNull();
    const kept = keptDocumentStyleOfSelection(document, {
      ...nothing,
      instanceIds: ["R1", "R2"],
      annotationIds: ["locked-note"],
    });
    expect(kept).toEqual({
      objectIds: ["R1", "label-R1"],
      description: "Font size 2×, Wire thickness 1.5×",
    });
    expect(releaseKeptDocumentStyleEdit(kept!)).toEqual({
      kind: "set_object_document_style",
      objectIds: ["R1", "label-R1"],
      documentStyle: null,
    });
  });

  it("says when the selection keeps several drawings' styles", () => {
    const document = drawing();
    document.instances[1]!.documentStyle = { fontScale: 0.5 };
    expect(
      keptDocumentStyleOfSelection(document, {
        ...nothing,
        instanceIds: ["R1", "R2"],
      })?.description,
    ).toBe("styles of several drawings");
  });
});
