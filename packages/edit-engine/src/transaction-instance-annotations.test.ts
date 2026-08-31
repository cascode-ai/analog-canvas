import { createEmptyDocument } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  followAttachedAnnotations,
  reflowCanonicalInstanceLabelsAfterPresentationChange,
} from "./transaction-instance-annotations.js";

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
    reference: "R_ESR",
    netlist: { parameters: {} },
  });
  const annotation: Annotation = {
    id: "label-r1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
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

describe("adaptive presentation label reflow", () => {
  function formulaDocument(userMoved = false): {
    document: SchematicDocument;
    annotation: Annotation;
  } {
    const document = createEmptyDocument("formula", "Formula");
    const instance: SchematicDocument["instances"][number] = {
      id: "B1",
      symbolId: "unit-delay",
      placement: {
        position: { x: 200, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: { parameters: {} },
    };
    document.instances.push(instance);
    const resolved = resolver.resolve("unit-delay");
    if (!resolved) throw new Error("unit-delay missing");
    const canonical = defaultInstanceLabelPlacement(
      instance,
      resolved,
      resolveDocumentStyleProfile(document.presentation),
      document.presentation.grid,
      "reference",
    );
    if (!canonical || !instance.placement) throw new Error("placement missing");
    const position = userMoved
      ? { x: canonical.position.x + 50, y: canonical.position.y + 10 }
      : canonical.position;
    const annotation: Annotation = {
      id: "label-b1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "B1" },
      anchor: {
        kind: "object",
        objectId: "B1",
        localOffset: {
          x: position.x - instance.placement.position.x,
          y: position.y - instance.placement.position.y,
        },
        fallbackPosition: position,
      },
      alignment: userMoved ? "start" : canonical.alignment,
      rotation: 0,
      locked: false,
    };
    document.annotations.push(annotation);
    return { document, annotation };
  }

  it("moves a canonical label below an expanded frame", () => {
    const { document, annotation } = formulaDocument();
    const before = structuredClone(document.instances[0]!);
    document.instances[0]!.signalFlowParameters = { bodyHeight: 80 };
    const changed = new Set<string>();

    reflowCanonicalInstanceLabelsAfterPresentationChange(
      document,
      before,
      "B1",
      changed,
      resolver,
    );

    expect(annotation.anchor).toMatchObject({
      kind: "object",
      localOffset: { x: 0, y: 70 },
      fallbackPosition: { x: 200, y: 170 },
    });
    expect(annotation.alignment).toBe("middle");
    expect(changed).toContain("label-b1");
  });

  it("preserves a user-moved label when the frame expands", () => {
    const { document, annotation } = formulaDocument(true);
    const before = structuredClone(document.instances[0]!);
    const original = structuredClone(annotation);
    document.instances[0]!.signalFlowParameters = { bodyHeight: 80 };
    const changed = new Set<string>();

    reflowCanonicalInstanceLabelsAfterPresentationChange(
      document,
      before,
      "B1",
      changed,
      resolver,
    );

    expect(annotation).toEqual(original);
    expect(changed).not.toContain("label-b1");
  });
});

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
