import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  canonicalPortTextDocument,
  type Rect,
} from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  placeUprightInstanceLabel,
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
/** A straight wire between two free points. */
function wire(
  doc: ReturnType<typeof fixture>["doc"],
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  if (!doc.nets.some((net) => net.id === "n"))
    doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: `${id}-a`, netId: "n", position: from },
    { id: `${id}-b`, netId: "n", position: to },
  );
  doc.routes.push(
    createRoutePath({
      id,
      netId: "n",
      start: { kind: "junction", junctionId: `${id}-a` },
      end: { kind: "junction", junctionId: `${id}-b` },
      bends: [],
      modes: ["manual"],
    }),
  );
}
/** A transistor showing its Reference and W/L in their default rows. */
function transistor(
  doc: ReturnType<typeof fixture>["doc"],
  id: string,
  symbolId: "nmos" | "pmos",
  position: { x: number; y: number },
  mirror: "none" | "horizontal" = "none",
) {
  const instance = {
    id,
    reference: id.toUpperCase(),
    symbolId,
    placement: { position, rotation: 0 as const, mirror },
    netlist: { parameters: { w: "10u", l: "0.5u" } },
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
  return instance;
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
  it("keeps a clear Reference where it is rather than move the part's labels to clear the value", () => {
    // The value's default row is covered twice. Every other side clears the
    // value but puts the Reference on a label: one conflict against two, so
    // the whole group used to move and the part's name was drawn over text.
    // Wires just above the Reference row, and a row higher, leave the group
    // no room to slide up, and a wire between its rows does not count as
    // room.
    const { doc, instance } = fixture();
    doc.nets.push({ id: "n", terminals: [] });
    doc.junctions.push(
      { id: "a", netId: "n", position: { x: 0, y: 92 } },
      { id: "b", netId: "n", position: { x: 92, y: 92 } },
      { id: "c", netId: "n", position: { x: 108, y: 92 } },
      { id: "d", netId: "n", position: { x: 200, y: 92 } },
    );
    for (const [id, start, end] of [
      ["left", "a", "b"],
      ["right", "c", "d"],
    ] as const)
      doc.routes.push(
        createRoutePath({
          id,
          netId: "n",
          start: { kind: "junction", junctionId: start },
          end: { kind: "junction", junctionId: end },
          bends: [],
          modes: ["manual"],
        }),
      );
    wire(doc, "left-high", { x: 0, y: 80 }, { x: 92, y: 80 });
    wire(doc, "right-high", { x: 108, y: 80 }, { x: 200, y: 80 });
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    const value = doc.annotations.find(
      (a) => a.binding?.kind === "instance-value",
    )!;
    const context = createLabelClearanceContext(doc, resolver);
    const style = resolveDocumentStyleProfile(doc.presentation);
    const resolved = resolver.resolve(instance.symbolId)!;
    const obstacle = (id: string, position: { x: number; y: number }) =>
      doc.annotations.push({
        id,
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "W" }] },
        anchor: { kind: "free", position },
        alignment: "middle",
        rotation: 0,
        locked: true,
      });
    const valueAt = context.measure(value).position;
    obstacle("value-1", valueAt);
    obstacle("value-2", { x: valueAt.x + 4, y: valueAt.y });
    for (const side of ["left", "top", "bottom"] as const) {
      const placement = placeUprightInstanceLabel(
        instance,
        resolved,
        style,
        { x: 0, y: 0 },
        side,
        doc.presentation.grid,
      )!;
      const ink = createLabelClearanceContext(doc, resolver).measure({
        ...reference,
        anchor: { kind: "free", position: placement.position },
        alignment: placement.alignment,
      }).inkBounds;
      obstacle(`name-${side}`, {
        x: ink.x + ink.width / 2,
        y: ink.y + ink.height,
      });
    }
    const before = context.measure(reference).position;

    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const moved = doc.annotations.find((a) => a.id === reference.id)!;
    expect(after.measure(moved).position).toEqual(before);
    expect(after.conflicts(moved)).toEqual([]);
  });
  it("moves a Cell Pin's name off a part placed over it, and leaves a name moved by hand", () => {
    // Port vin at (100,100) faces right; its name stands to its left, where
    // a resistor placed later now lies.
    const doc = createEmptyDocument("d", "Pin name");
    const port = {
      id: "vin",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    doc.instances.push(port);
    doc.netlist = {
      name: "d",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin",
          name: "vin",
          netId: "net-vin",
          direction: "input",
          interfaceInstanceIds: ["vin"],
        },
      ],
    };
    const name = defaultInstanceDisplayAnnotations(
      doc,
      port,
      resolver,
      resolveDocumentStyleProfile(doc.presentation),
      { formalTerminalId: "terminal-vin", formalName: "vin" },
    )[0]!;
    doc.annotations.push(name);
    const before = createLabelClearanceContext(doc, resolver);
    const ink = before.measure(name).inkBounds;
    doc.instances.push({
      id: "R9",
      reference: "R9",
      symbolId: "resistor",
      placement: {
        position: { x: Math.round(ink.x + ink.width / 2), y: 100 },
        rotation: 90,
        mirror: "none",
      },
      netlist: { parameters: { value: "1k" } },
    });
    expect(createLabelClearanceContext(doc, resolver).conflicts(name)).toEqual([
      "R9",
    ]);

    const edits = arrangeInstanceLabels(doc, resolver, ["vin"], {});
    apply(doc, edits);
    const moved = doc.annotations.find((a) => a.id === name.id)!;
    expect(moved.alignment).toBe("middle");
    expect(createLabelClearanceContext(doc, resolver).conflicts(moved)).toEqual(
      [],
    );

    // A name its author put somewhere else stays there.
    const placed = structuredClone(doc);
    const authored = placed.annotations.find((a) => a.id === name.id)!;
    Object.assign(authored, {
      alignment: "end",
      anchor: { ...name.anchor, localOffset: { x: -13, y: 4 } },
    });
    expect(arrangeInstanceLabels(placed, resolver, ["vin"], {})).toEqual([]);
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
  it("slides a part's labels along its side to fit between two rows of wiring", () => {
    // An input transistor of a Miller op amp: its W/L row crosses the tail
    // wire below, the gate wire takes its left side, a bias line runs under
    // the pair, and labels above it would stand beyond the mirror's wire.
    // Its right side, a little above the middle, fits both rows between the
    // mirror's wire and the tail.
    const doc = createEmptyDocument("d", "Input pair");
    const m1 = transistor(doc, "m1", "nmos", { x: 90, y: -40 });
    wire(doc, "tail", { x: 60, y: -20 }, { x: 200, y: -20 });
    wire(doc, "gate", { x: 40, y: -40 }, { x: 70, y: -40 });
    wire(doc, "mirror", { x: 40, y: -80 }, { x: 200, y: -80 });
    wire(doc, "bias", { x: 40, y: -5 }, { x: 200, y: -5 });
    const before = createLabelClearanceContext(doc, resolver);
    expect(
      doc.annotations.some((a) => before.conflicts(a).includes("tail")),
    ).toBe(true);

    apply(doc, arrangeInstanceLabels(doc, resolver, [m1.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const body = after.symbols.find((s) => s.id === m1.id)!.bounds;
    for (const label of doc.annotations) {
      expect(after.conflicts(label), label.id).toEqual([]);
      const ink = after.measure(label).inkBounds;
      expect(ink.x).toBeGreaterThanOrEqual(body.x + body.width);
      expect(ink.y).toBeGreaterThan(-80);
      expect(ink.y + ink.height).toBeLessThan(-20);
    }
  });
  it("never puts a wire between a part's Reference and its W/L", () => {
    // A mirror transistor under a VDD rail, crowded on its sides: above it,
    // between the rail and the part, there is room for the Reference only,
    // and its W/L met nothing above the rail, away from the transistor.
    const doc = createEmptyDocument("d", "Mirror");
    const m3 = transistor(doc, "m3", "pmos", { x: 110, y: -100 });
    wire(doc, "rail", { x: 40, y: -140 }, { x: 220, y: -140 });
    wire(doc, "gate", { x: 40, y: -100 }, { x: 90, y: -100 });
    wire(doc, "drain", { x: 40, y: -70 }, { x: 220, y: -70 });

    apply(doc, arrangeInstanceLabels(doc, resolver, [m3.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    for (const label of doc.annotations) {
      expect(after.conflicts(label), label.id).toEqual([]);
      expect(after.measure(label).inkBounds.y).toBeGreaterThan(-140);
    }
  });
  it("never leaves a part's labels beyond a wire that runs beside it", () => {
    // A wire passes just right of the transistor, between it and its
    // default labels, which meet nothing there.
    const doc = createEmptyDocument("d", "Bypass");
    const m1 = transistor(doc, "m1", "nmos", { x: 90, y: -40 });
    wire(doc, "bypass", { x: 103, y: -100 }, { x: 103, y: 20 });
    const before = createLabelClearanceContext(doc, resolver);
    for (const label of doc.annotations) {
      expect(before.conflicts(label)).toEqual([]);
      expect(before.measure(label).inkBounds.x).toBeGreaterThan(103);
    }

    apply(doc, arrangeInstanceLabels(doc, resolver, [m1.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    for (const label of doc.annotations) {
      expect(after.conflicts(label), label.id).toEqual([]);
      const ink = after.measure(label).inkBounds;
      expect(ink.x + ink.width).toBeLessThan(103);
    }
  });
  it("lets a part's own wire run between its name and its W/L", () => {
    // A transistor drawn with a Port at each pin: its bulk wire runs through
    // its name's row, the Source Pin's name sits on its W/L's, and the Gate
    // Pin's name takes its left side. Above and below its own bulk wire,
    // both labels still read as the transistor's.
    const doc = createEmptyDocument("d", "Basic transistor");
    const instance = {
      id: "m3",
      reference: "M3",
      symbolId: "nmos",
      placement: {
        position: { x: 400, y: 180 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { w: "1u", l: "150n" } },
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
    doc.nets.push({ id: "n", terminals: [] });
    doc.junctions.push({
      id: "bulk-end",
      netId: "n",
      position: { x: 450, y: 180 },
    });
    doc.routes.push(
      createRoutePath({
        id: "bulk",
        netId: "n",
        start: { kind: "terminal", instanceId: "m3", pinName: "B" },
        end: { kind: "junction", junctionId: "bulk-end" },
        bends: [],
        modes: ["manual"],
      }),
    );
    for (const [id, value, x, y] of [
      ["gate", "Gate", 324, 185],
      ["source", "Source", 383, 230],
      ["drain", "Drain", 387, 136],
      ["bulk-name", "Bulk", 470, 185],
    ] as const)
      doc.annotations.push({
        id,
        kind: "instance-label",
        content: { runs: [{ kind: "text", value }] },
        anchor: { kind: "free", position: { x, y } },
        alignment: "start",
        rotation: 0,
        locked: true,
      });

    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const [name, size] = (
      ["instance-reference", "instance-value"] as const
    ).map((kind) =>
      after.measure(doc.annotations.find((a) => a.binding?.kind === kind)!),
    );
    for (const label of doc.annotations)
      expect(after.conflicts(label), label.id).toEqual([]);
    expect(name!.inkBounds.y + name!.inkBounds.height).toBeLessThan(180);
    expect(size!.inkBounds.y).toBeGreaterThan(180);
  });
  it("does not move a name from just beside other text onto it", () => {
    // The Reference touches text just above it and a wire runs through it;
    // one row up it would meet only that text, drawn over it, and two grid
    // steps right only other text. Wires fence every other side. A name had
    // been nudged so onto a Pin's name in a gain-boosted op amp.
    const { doc, instance } = fixture();
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    for (let x = 30; x <= 90; x += 6)
      wire(doc, `left-${x}`, { x, y: 0 }, { x, y: 200 });
    for (let y = 20; y <= 74; y += 6)
      wire(doc, `top-${y}`, { x: 0, y }, { x: 200, y });
    for (const y of [132, 138, 150, 156])
      wire(doc, `bottom-${y}`, { x: 0, y }, { x: 200, y });
    wire(doc, "through", { x: 105, y: 102 }, { x: 128, y: 102 });
    for (const [id, value, x, y] of [
      ["above", "I", 110, 89],
      ["beyond", "WW", 152, 108],
    ] as const)
      doc.annotations.push({
        id,
        kind: "instance-label",
        content: { runs: [{ kind: "text", value }] },
        anchor: { kind: "free", position: { x, y } },
        alignment: "start",
        rotation: 0,
        locked: true,
      });
    const before = createLabelClearanceContext(doc, resolver);
    expect(before.conflicts(reference)).toEqual(["above", "through"]);
    expect(
      before.overlapsAt(before.measure(reference).inkBounds, reference.id),
    ).toEqual([]);

    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const moved = doc.annotations.find((a) => a.id === reference.id)!;
    expect(after.overlapsAt(after.measure(moved).inkBounds, moved.id)).toEqual(
      [],
    );
  });
  /**
   * A current-steering DAC unit: the switch M3 sits under the cascode M2,
   * with its gate wire on the left, its output wire below and M4 to the
   * right. M3's labels are arranged.
   */
  function dacUnit(m2x: number) {
    const doc = createEmptyDocument("d", "DAC unit");
    const m2 = transistor(doc, "m2", "pmos", { x: m2x, y: -40 });
    const m3 = transistor(doc, "m3", "pmos", { x: 80, y: 40 });
    transistor(doc, "m4", "pmos", { x: 140, y: 40 }, "horizontal");
    for (const [id, from, to] of [
      ["vcas", [20, -40], [m2x - 20, -40]],
      ["d", [20, 40], [60, 40]],
      ["db", [160, 40], [200, 40]],
      ["outp", [90, 60], [90, 80]],
      ["outp-bar", [40, 80], [90, 80]],
      ["outn", [130, 60], [130, 80]],
      ["outn-bar", [130, 80], [180, 80]],
    ] as const)
      wire(doc, id, { x: from[0], y: from[1] }, { x: to[0], y: to[1] });
    apply(doc, arrangeInstanceLabels(doc, resolver, [m3.id], {}));
    const after = createLabelClearanceContext(doc, resolver);
    const labels = doc.annotations
      .filter((a) => a.anchor.kind === "object" && a.anchor.objectId === m3.id)
      .map((label) => ({
        conflicts: after.conflicts(label),
        ink: after.measure(label).inkBounds,
      }));
    const box = (id: string) =>
      after.symbols.find((symbol) => symbol.id === id)!.bounds;
    return { labels, m2: box(m2.id), m3: box(m3.id) };
  }
  it("keeps a part's labels nearer it than any other part", () => {
    // Above M3 met nothing, so its W/L went two rows up, beside M2, and
    // read as M2's.
    const { labels, m2, m3 } = dacUnit(115);
    const gap = (a: Rect, b: Rect) =>
      Math.hypot(
        Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
        Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
      );
    for (const label of labels) {
      expect(label.conflicts).toEqual([]);
      expect(gap(label.ink, m3)).toBeLessThanOrEqual(gap(label.ink, m2) + 5);
    }
  });
  it("slides a part's labels past its middle into the room above its gate wire", () => {
    // M2 stands right above M3, so the one clear place beside M3 is left of
    // it, above its gate wire: a group sliding there keeps only a quarter of
    // its height beside the part.
    const { labels, m3 } = dacUnit(100);
    for (const label of labels) {
      expect(label.conflicts).toEqual([]);
      expect(label.ink.x + label.ink.width).toBeLessThanOrEqual(m3.x);
      expect(label.ink.y + label.ink.height).toBeLessThanOrEqual(40);
    }
  });
  it("moves a part's name off a free drawing note (#1323)", () => {
    // A φ2 note written on a switch's default name read as one smudge.
    const { doc, instance } = fixture();
    const reference = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    const before = createLabelClearanceContext(doc, resolver);
    const at = before.measure(reference).position;
    doc.drafting!.objects.push({
      id: "note",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: at.x + 4, y: at.y } },
      content: { runs: [{ kind: "text", value: "phi2" }] },
      alignment: "start",
      rotation: 0,
    });
    expect(
      createLabelClearanceContext(doc, resolver).conflicts(reference),
    ).toContain("note");

    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const moved = doc.annotations.find((a) => a.id === reference.id)!;
    expect(after.conflicts(moved)).toEqual([]);
  });
  it("keeps a word's space between a part's labels and another label on their line", () => {
    // A resistor's "2k" two units after an input Port's name read "v_inn2k".
    const { doc, instance } = fixture();
    const value = doc.annotations.find(
      (a) => a.binding?.kind === "instance-value",
    )!;
    const context = createLabelClearanceContext(doc, resolver);
    const ink = context.measure(value).inkBounds;
    doc.annotations.push({
      id: "pin-name",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "vinn" }] },
      anchor: {
        kind: "free",
        position: { x: ink.x - 2, y: context.measure(value).position.y },
      },
      alignment: "end",
      rotation: 0,
      locked: true,
    });
    expect(createLabelClearanceContext(doc, resolver).conflicts(value)).toEqual(
      ["pin-name"],
    );

    apply(doc, arrangeInstanceLabels(doc, resolver, [instance.id], {}));

    const after = createLabelClearanceContext(doc, resolver);
    const moved = doc.annotations.find((a) => a.id === value.id)!;
    expect(after.conflicts(moved)).toEqual([]);
  });
});
