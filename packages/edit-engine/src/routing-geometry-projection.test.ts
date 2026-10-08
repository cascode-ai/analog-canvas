import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";
import { createRoutingOperationPlan } from "./routing-operation-plan.js";
import { projectRoutingTransformGeometry } from "./instance-contact-transform.js";

function source() {
  const document = createEmptyDocument("projection", "Projection");
  document.drafting = {
    objects: [
      {
        id: "note",
        kind: "text",
        content: { runs: [{ kind: "text", value: "note" }] },
        anchor: { kind: "free", position: { x: 13, y: 7 } },
        alignment: "start",
        rotation: 0,
        locked: false,
        zIndex: 0,
      },
    ],
  };
  document.nets.push({ id: "signal", terminals: [] });
  document.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "signal",
    binding: { kind: "net-name", netId: "signal" },
    anchor: { kind: "free", position: { x: 23, y: 17 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  return document;
}

describe("coordinate-only routing projection", () => {
  it("projects existing text placements without a transaction, preserving source and binding", () => {
    const document = source();
    const original = structuredClone(document);
    const plan = createRoutingOperationPlan(document, {
      intent: "transform",
      diagnostics: [],
      edits: [
        {
          kind: "upsert_drafting_object",
          object: {
            ...document.drafting!.objects[0]!,
            anchor: { kind: "free", position: { x: 33, y: 17 } },
          },
        },
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            ...document.annotations[0]!,
            anchor: { kind: "free", position: { x: 43, y: 27 } },
          },
        },
      ],
    });
    const projected = projectRoutingTransformGeometry(document, plan);
    expect(projected.revision).toBe(document.revision);
    expect(projected.drafting!.objects[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 33, y: 17 },
    });
    expect(projected.annotations[0]!.anchor).toEqual({
      kind: "free",
      position: { x: 43, y: 27 },
    });
    expect(projected.annotations[0]!.binding).toEqual(
      document.annotations[0]!.binding,
    );
    expect(document).toEqual(original);
  });

  it("rejects an electrical rebind instead of treating it as a geometry preview", () => {
    const document = source();
    const plan = createRoutingOperationPlan(document, {
      intent: "transform",
      diagnostics: [],
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            ...document.annotations[0]!,
            binding: { kind: "net-name", netId: "another" },
          },
        },
      ],
    });
    expect(() => projectRoutingTransformGeometry(document, plan)).toThrow();
  });
});
