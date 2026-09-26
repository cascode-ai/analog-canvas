import { describe, expect, it } from "vitest";
import { createEmptyDocument, canonicalPortTextDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { defaultInstanceDisplayAnnotations } from "./default-instance-display";
import { arrangeInstanceLabels } from "./arrange-instance-labels";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const doc = createEmptyDocument("d", "Labels");
  const instance = {
    id: "r",
    reference: "RBIAS",
    symbolId: "resistor",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: { parameters: { value: "1k" } },
  };
  doc.instances.push(instance);
  doc.annotations.push(
    ...defaultInstanceDisplayAnnotations(
      doc,
      instance,
      resolver,
      resolveDocumentStyleProfile(doc.presentation),
      { showValue: true },
    ),
  );
  return { doc, instance };
}
function apply(
  doc: ReturnType<typeof fixture>["doc"],
  edits: ReturnType<typeof arrangeInstanceLabels>,
) {
  for (const edit of edits)
    if (edit.kind === "upsert_schematic_annotation") {
      const index = doc.annotations.findIndex(
        (a) => a.id === edit.annotation.id,
      );
      doc.annotations[index] = edit.annotation;
    }
}
describe("opt-in label arrangement", () => {
  it("compacts a visible value into a hidden reference slot, preserving bindings and undo-sized edits", () => {
    const { doc, instance } = fixture();
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    reference.visible = false;
    const before = structuredClone(doc);
    const value = doc.annotations.find(
      (a) => a.binding?.kind === "instance-value",
    )!;
    expect(value).toBeDefined();
    const edits = arrangeInstanceLabels(doc, resolver, [instance.id], {
      avoidCollisions: false,
    });
    expect(doc).toEqual(before);
    expect(edits).toHaveLength(1);
    apply(doc, edits);
    const preferred = defaultInstanceLabelPlacement(
      instance,
      resolver.resolve("resistor")!,
      resolveDocumentStyleProfile(doc.presentation),
      doc.presentation.grid,
    )!;
    expect(
      createLabelClearanceContext(doc, resolver).measure(
        doc.annotations.find((a) => a.id === value.id)!,
      ).position,
    ).toEqual(preferred.position);
    expect(doc.annotations.find((a) => a.id === value.id)?.binding).toEqual(
      value.binding,
    );
    expect(arrangeInstanceLabels(doc, resolver, [instance.id], {})).toEqual([]);
  });
  it("restyles only default reference projections, without renaming the device", () => {
    const { doc, instance } = fixture();
    const before = structuredClone(doc.instances);
    apply(
      doc,
      arrangeInstanceLabels(doc, resolver, [instance.id], {
        referenceStyle: "first-letter-subscript",
        avoidCollisions: false,
      }),
    );
    expect(
      doc.annotations.find((a) => a.binding?.kind === "instance-reference")
        ?.formatOverride,
    ).toEqual(canonicalPortTextDocument("RBIAS"));
    expect(doc.instances).toEqual(before);
    expect(
      arrangeInstanceLabels(doc, resolver, [instance.id], {
        referenceStyle: "first-letter-subscript",
      }),
    ).toEqual([]);
  });
  it.each(["locked", "manual", "custom", "hidden"])(
    "preserves %s labels",
    (kind) => {
      const { doc, instance } = fixture();
      doc.annotations = doc.annotations.filter(
        (a) => a.binding?.kind === "instance-reference",
      );
      const annotation = doc.annotations[0]!;
      if (kind === "locked") annotation.locked = true;
      if (kind === "hidden") annotation.visible = false;
      if (kind === "custom")
        annotation.formatOverride = {
          runs: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "RBIAS" }],
            },
          ],
        };
      if (kind === "manual" && annotation.anchor.kind === "object")
        annotation.anchor.localOffset.x += 70;
      expect(
        arrangeInstanceLabels(doc, resolver, [instance.id], {
          referenceStyle: "first-letter-subscript",
        }),
      ).toEqual([]);
    },
  );
  it("uses a bounded collision candidate and preserves topology", () => {
    const { doc, instance } = fixture();
    const before = structuredClone(doc.instances);
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    doc.annotations = [
      reference,
      { ...structuredClone(reference), id: "obstacle", locked: true },
    ];
    const beforeScore = createLabelClearanceContext(doc, resolver).conflicts(
      reference,
    ).length;
    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));
    expect(
      createLabelClearanceContext(doc, resolver).conflicts(doc.annotations[0]!)
        .length,
    ).toBeLessThan(beforeScore);
    expect(doc.instances).toEqual(before);
    expect(doc.annotations[1]).toEqual({
      ...reference,
      id: "obstacle",
      locked: true,
    });
  });
});
