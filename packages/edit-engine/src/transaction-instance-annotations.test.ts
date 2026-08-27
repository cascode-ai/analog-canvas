import { createEmptyDocument } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { followAttachedAnnotations } from "./transaction-instance-annotations.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithDraggedLabel(): {
  document: SchematicDocument;
  annotation: Annotation;
} {
  const document = createEmptyDocument("doc", "Labels");
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 200, y: 100 }, rotation: 0, mirror: "none" },
    netlist: { reference: "R_ESR", parameters: {} },
  });
  const annotation: Annotation = {
    id: "label-r1",
    kind: "instance-label",
    binding: { kind: "instance-designator", instanceId: "R1" },
    anchor: {
      kind: "object",
      objectId: "R1",
      // A user-dragged spot to the right of the body: intentionally NOT the
      // canonical default placement.
      localOffset: { x: 70, y: 5 },
      fallbackPosition: { x: 270, y: 105 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
  document.annotations.push(annotation);
  return { document, annotation };
}

describe("followAttachedAnnotations rigid fallback", () => {
  it("flips start/end when a mirror flips the world x-axis", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 0, mirror: "x" },
      new Set(),
      resolver,
    );
    if (annotation.anchor.kind !== "object") throw new Error("anchor kind");
    // Anchor mirrors to the far side; the upright text now extends the
    // other way.
    expect(annotation.anchor.localOffset.x).toBe(-70);
    expect(annotation.alignment).toBe("end");
  });

  it("keeps the alignment through a quarter turn", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 90, mirror: "none" },
      new Set(),
      resolver,
    );
    expect(annotation.alignment).toBe("start");
  });

  it("flips the alignment through a half turn", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 180, mirror: "none" },
      new Set(),
      resolver,
    );
    expect(annotation.alignment).toBe("end");
  });
});
