import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  canonicalPortTextDocument,
} from "@icm/model";
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
      rotation: 0 as 0 | 90 | 180 | 270,
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
/** Overlap of two labels' drawn ink. */
function inkOverlaps(
  context: ReturnType<typeof createLabelClearanceContext>,
  a: Parameters<typeof context.measure>[0],
  b: Parameters<typeof context.measure>[0],
): boolean {
  const p = context.measure(a).inkBounds;
  const q = context.measure(b).inkBounds;
  return (
    p.x < q.x + q.width &&
    p.x + p.width > q.x &&
    p.y < q.y + q.height &&
    p.y + p.height > q.y
  );
}
describe("opt-in label arrangement", () => {
  it("does not trade a crowded value row for its own Reference's (#1307)", () => {
    // Free text covers the value's slot twice and every nearby step once,
    // except the one up, which is the Reference's own row. Its single
    // conflict, the Reference itself, used to win and stacked the value onto
    // its Reference.
    const { doc, instance } = fixture();
    const value = doc.annotations.find(
      (a) => a.binding?.kind === "instance-value",
    )!;
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    const context = createLabelClearanceContext(doc, resolver);
    const at = context.measure(value).position;
    const step = doc.presentation.grid;
    for (const [index, [dx, dy]] of (
      [
        [0, 0],
        [step / 2, 0],
        [0, 2 * step],
        [-2 * step, 0],
        [2 * step, 0],
      ] as const
    ).entries())
      doc.annotations.push({
        id: `obstacle-${index}`,
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "WW" }] },
        anchor: { kind: "free", position: { x: at.x + dx, y: at.y + dy } },
        alignment: "start",
        rotation: 0,
        locked: true,
      });
    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));
    const after = createLabelClearanceContext(doc, resolver);
    const [movedReference, movedValue] = [reference, value].map((label) =>
      doc.annotations.find((a) => a.id === label.id)!,
    );
    expect(inkOverlaps(after, movedReference!, movedValue!)).toBe(false);
  });
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
  it("never stacks a value onto its own Reference in a crowded MOS pair (#1307)", () => {
    // A Gilbert switching pair: 60 units apart, the mirrored device's labels
    // facing the other's across a 12-unit gap.
    const doc = createEmptyDocument("d", "Pair");
    const profile = resolveDocumentStyleProfile(doc.presentation);
    const devices = [
      { id: "m3", reference: "M3", x: -110, mirror: "none" as const },
      { id: "m4", reference: "M4", x: -50, mirror: "horizontal" as const },
      { id: "m5", reference: "M5", x: 50, mirror: "none" as const },
      { id: "m6", reference: "M6", x: 110, mirror: "horizontal" as const },
    ];
    for (const device of devices) {
      const instance = {
        id: device.id,
        reference: device.reference,
        symbolId: "nmos",
        placement: {
          position: { x: device.x, y: -40 },
          rotation: 0 as const,
          mirror: device.mirror,
        },
        netlist: { parameters: { w: "10u", l: "150n" } },
      };
      doc.instances.push(instance);
      doc.annotations.push(
        ...defaultInstanceDisplayAnnotations(doc, instance, resolver, profile, {
          showValue: true,
        }),
      );
    }
    apply(
      doc,
      arrangeInstanceLabels(
        doc,
        resolver,
        devices.map((d) => d.id),
        {},
      ),
    );
    const context = createLabelClearanceContext(doc, resolver);
    for (const device of devices) {
      const [reference, value] = (
        ["instance-reference", "instance-value"] as const
      ).map((kind) =>
        doc.annotations.find(
          (a) => a.binding?.kind === kind && a.binding.instanceId === device.id,
        )!,
      );
      const a = context.measure(reference!).inkBounds;
      const b = context.measure(value!).inkBounds;
      const overlapping =
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      expect(overlapping, device.reference).toBe(false);
    }
  });
  it("moves a crowded label group to a free side of its part (#1307)", () => {
    // A feedback resistor drawn across the top of an op amp: its default
    // value row lands on the amplifier, while the space above is empty.
    const { doc, instance } = fixture();
    instance.placement = {
      position: { x: 260, y: -60 },
      rotation: 90,
      mirror: "none",
    };
    doc.annotations = [];
    doc.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        doc,
        instance,
        resolver,
        resolveDocumentStyleProfile(doc.presentation),
        { showValue: true },
      ),
    );
    doc.instances.push({
      id: "x3",
      symbolId: "opamp",
      placement: {
        position: { x: 260, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    const before = createLabelClearanceContext(doc, resolver);
    expect(
      doc.annotations.some((a) => before.conflicts(a).includes("x3")),
    ).toBe(true);
    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));
    const after = createLabelClearanceContext(doc, resolver);
    for (const annotation of doc.annotations) {
      expect(after.conflicts(annotation)).toEqual([]);
      // Both rows moved above the resistor, together.
      expect(after.measure(annotation).position.y).toBeLessThan(-60);
    }
  });
  it("keeps a value with its Reference instead of hopping across a wire (#1307)", () => {
    // A vertical resistor whose value row is crossed by a wire leaving to
    // the right: the group moves to the free left side.
    const { doc, instance } = fixture();
    instance.placement = {
      position: { x: -60, y: 0 },
      rotation: 0,
      mirror: "none",
    };
    doc.annotations = [];
    doc.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        doc,
        instance,
        resolver,
        resolveDocumentStyleProfile(doc.presentation),
        { showValue: true },
      ),
    );
    doc.nets.push({ id: "n", terminals: [] });
    doc.junctions.push(
      { id: "a", netId: "n", position: { x: -60, y: 25 } },
      { id: "b", netId: "n", position: { x: 60, y: 25 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "w",
        netId: "n",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const before = createLabelClearanceContext(doc, resolver);
    expect(doc.annotations.some((a) => before.conflicts(a).includes("w"))).toBe(
      true,
    );
    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));
    const after = createLabelClearanceContext(doc, resolver);
    const positions = doc.annotations.map((a) => {
      expect(after.conflicts(a)).toEqual([]);
      return after.measure(a).position;
    });
    // Same side, left of the part, Reference row above the value row.
    for (const position of positions) expect(position.x).toBeLessThan(-60);
    expect(positions[0]!.x).toBe(positions[1]!.x);
  });
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
