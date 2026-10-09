import { describe, expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { RichTextDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { defaultInstanceLabelPlacement } from "./instance-label-placement.js";
import { displayableInstanceValue } from "./instance-value.js";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
} from "./label-clearance.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";
import { diagnoseVisualQuality } from "./visual.js";
const resolver = new InMemorySymbolResolver(builtInSymbols);
it("reports wire intersection and owner distance as observations, ignores hidden labels, and does not repeat text overlap", () => {
  const doc = createEmptyDocument("d", "Checks");
  doc.instances.push({
    id: "r",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 300, y: 190 } },
    { id: "b", netId: "n", position: { x: 500, y: 190 } },
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
  doc.annotations.push({
    id: "far",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "R1" }] },
    anchor: {
      kind: "object",
      objectId: "r",
      localOffset: { x: 300, y: 100 },
      fallbackPosition: { x: 400, y: 200 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const checks = diagnoseLabelClearance(doc, resolver);
  expect(checks.map((d) => d.code)).toEqual([
    "VISUAL_LABEL_CLEARANCE",
    "VISUAL_LABEL_OWNER_DISTANCE",
  ]);
  expect(checks[0]!.objectIds).toEqual(["far", "w"]);
  // Text over a wire warns, as text over text does (#1105); distance from
  // the owner is information.
  expect(checks.map((d) => [d.severity, d.gateEligible])).toEqual([
    ["warning", false],
    ["info", false],
  ]);
  doc.annotations[0]!.visible = false;
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
});
it("does not mistake a diagonal's bounding box for an actual crossing", () => {
  const doc = createEmptyDocument("d", "Diagonal");
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 0, y: 0 } },
    { id: "b", netId: "n", position: { x: 100, y: 100 } },
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
  doc.annotations.push({
    id: "label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "X" }] },
    anchor: { kind: "free", position: { x: 10, y: 90 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  doc.annotations[0]!.anchor = { kind: "free", position: { x: 50, y: 60 } };
  expect(diagnoseLabelClearance(doc, resolver)).toHaveLength(1);
});

it("does not report a default label against its own part", () => {
  // The line box's extra ascent reached into the part above it; the drawn
  // capitals keep the placement gap (#1105).
  const doc = createEmptyDocument("d", "Own part");
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    const id = `r${index}`;
    const at = { x: 100 + index * 200, y: 100 };
    doc.instances.push({
      id,
      symbolId: "resistor",
      placement: { position: at, rotation, mirror: "none" },
    });
    const resolved = resolver.resolve("resistor")!;
    const profile = resolveDocumentStyleProfile(doc.presentation);
    for (const slot of ["reference", "value"] as const) {
      // The name over the value shown under it (#1384).
      const placement = defaultInstanceLabelPlacement(
        doc.instances.at(-1)!,
        resolved,
        profile,
        doc.presentation.grid,
        slot === "reference" ? "reference-over-value" : slot,
      )!;
      doc.annotations.push({
        id: `${id}-${slot}`,
        kind: slot === "reference" ? "instance-label" : "instance-value",
        content: {
          runs: [{ kind: "text", value: slot === "reference" ? "R1" : "1k" }],
        },
        anchor: {
          kind: "object",
          objectId: id,
          localOffset: {
            x: placement.position.x - at.x,
            y: placement.position.y - at.y,
          },
          fallbackPosition: placement.position,
        },
        alignment: placement.alignment,
        rotation: 0,
        locked: false,
      });
    }
  }
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  // The two stacked rows do not read as overlapping text either.
  expect(
    diagnoseVisualQuality(doc, resolver).filter(
      (d) => d.code === "VISUAL_LABEL_OVERLAP",
    ),
  ).toEqual([]);
});

/** Default reference and value annotations for one part, as the editor creates them. */
function placeDefaultLabels(
  doc: ReturnType<typeof createEmptyDocument>,
  instance: ReturnType<typeof createEmptyDocument>["instances"][number],
  reference: RichTextDocument,
): void {
  doc.instances.push(instance);
  const resolved = resolver.resolve(instance.symbolId)!;
  const profile = resolveDocumentStyleProfile(doc.presentation);
  const value = displayableInstanceValue(instance);
  if (value.kind !== "displayable") throw new Error(value.reason);
  const at = instance.placement!.position;
  for (const slot of ["reference", "value"] as const) {
    // The name over the value shown under it (#1384).
    const placement = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      doc.presentation.grid,
      slot === "reference" ? "reference-over-value" : slot,
    )!;
    doc.annotations.push({
      id: `${instance.id}-${slot}`,
      kind: slot === "reference" ? "instance-label" : "instance-value",
      content: slot === "reference" ? reference : value.content,
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: {
          x: placement.position.x - at.x,
          y: placement.position.y - at.y,
        },
        fallbackPosition: placement.position,
      },
      alignment: placement.alignment,
      rotation: 0,
      locked: false,
    });
  }
}

/** A designator drawn as a letter with a subscript, such as M₂. */
function subscripted(letter: string, index: string): RichTextDocument {
  return {
    runs: [
      { kind: "text", value: letter },
      {
        kind: "span",
        style: "subscript",
        children: [{ kind: "text", value: index }],
      },
    ],
  };
}

it("keeps a MOS W/L fraction clear of its own subscripted reference (#1299)", () => {
  const doc = createEmptyDocument("d", "MOS");
  const orientations = [
    [0, "none"],
    [0, "horizontal"],
    [90, "none"],
    [180, "none"],
    [270, "none"],
    [180, "horizontal"],
  ] as const;
  for (const [index, [rotation, mirror]] of orientations.entries())
    for (const [row, symbolId] of (["nmos", "pmos"] as const).entries())
      placeDefaultLabels(
        doc,
        {
          id: `${symbolId}${index}`,
          symbolId,
          placement: {
            position: { x: 100 + index * 200, y: 100 + row * 300 },
            rotation,
            mirror,
          },
          netlist: { parameters: { w: "10u", l: "150n" } },
        },
        subscripted("M", "2"),
      );
  expect(
    diagnoseVisualQuality(doc, resolver).filter(
      (d) => d.code === "VISUAL_LABEL_OVERLAP",
    ),
  ).toEqual([]);
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
});

it("does not report an inductor's default labels against its own coil (#1299)", () => {
  // The coil is one path without declared bounds. Its labels keep their gap
  // from the path's drawn hull, so the check has to measure that hull rather
  // than the Symbol's padded viewBox.
  const doc = createEmptyDocument("d", "Inductors");
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries())
    placeDefaultLabels(
      doc,
      {
        id: `l${index}`,
        symbolId: "inductor",
        placement: {
          position: { x: 100 + index * 200, y: 100 },
          rotation,
          mirror: "none",
        },
        netlist: { parameters: { value: "10u" } },
      },
      subscripted("L", "A"),
    );
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  // A label actually drawn over the coil is still reported.
  const label = doc.annotations.find((a) => a.id === "l0-reference")!;
  if (label.anchor.kind !== "object") throw new Error("object anchor");
  label.anchor = {
    ...label.anchor,
    localOffset: { x: -5, y: 5 },
    fallbackPosition: { x: 95, y: 105 },
  };
  expect(diagnoseLabelClearance(doc, resolver).map((d) => d.objectIds)).toEqual(
    [["l0-reference", "l0"]],
  );
});

it("lets a Net Label stand as close over its wire as its text allows (#1300)", () => {
  const doc = createEmptyDocument("d", "Close label");
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 100, y: 200 } },
    { id: "b", netId: "n", position: { x: 300, y: 200 } },
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
  const label = (content: RichTextDocument, baselineAboveWire: number) => ({
    id: "label",
    kind: "net-label" as const,
    content,
    anchor: {
      kind: "free" as const,
      position: { x: 200, y: 200 - baselineAboveWire },
    },
    alignment: "middle" as const,
    rotation: 0 as const,
    locked: false,
  });
  const plain = (value: string): RichTextDocument => ({
    runs: [{ kind: "text", value }],
  });
  // Capitals 4 units up and a descender 8 up stand clear of the wire...
  doc.annotations = [label(plain("B0"), 4)];
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  doc.annotations = [label(plain("top"), 8)];
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  // ...where a subscript's figures at 4, or that descender at 2, reach it.
  doc.annotations = [label(subscripted("V", "out"), 4)];
  expect(diagnoseLabelClearance(doc, resolver)).toHaveLength(1);
  doc.annotations = [label(plain("top"), 2)];
  expect(diagnoseLabelClearance(doc, resolver)).toHaveLength(1);
});
it("asks a word's space between labels on a line and a little between lines", () => {
  const doc = createEmptyDocument("d", "Spacing");
  doc.annotations.push({
    id: "name",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "vinn" }] },
    anchor: { kind: "free", position: { x: 0, y: 100 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const context = createLabelClearanceContext(doc, resolver);
  const ink = context.measure(doc.annotations[0]!).inkBounds;
  const after = (gap: number) => ({ ...ink, x: ink.x + ink.width + gap });
  const below = (gap: number) => ({ ...ink, y: ink.y + ink.height + gap });
  // "2k" two units after "vinn" read as "vinn2k".
  expect(context.conflictsAt(after(2), "other")).toEqual(["name"]);
  expect(context.conflictsAt(after(5), "other")).toEqual([]);
  expect(context.conflictsAt(below(0.5), "other")).toEqual(["name"]);
  expect(context.conflictsAt(below(2), "other")).toEqual([]);
  // Too close is not drawn over.
  expect(context.overlapsAt(after(2), "other")).toEqual([]);
  expect(context.overlapsAt(after(-2), "other")).toEqual(["name"]);
  // Clearance findings name wires and parts only, as before.
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
});

it("keeps a label a line's space off a junction dot, which is its wires' ink", () => {
  const doc = createEmptyDocument("d", "Dots");
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "j", netId: "n", position: { x: 100, y: 100 } },
    { id: "a", netId: "n", position: { x: 40, y: 100 } },
    { id: "b", netId: "n", position: { x: 160, y: 100 } },
    { id: "c", netId: "n", position: { x: 100, y: 160 } },
  );
  for (const end of ["a", "b", "c"])
    doc.routes.push(
      createRoutePath({
        id: `w${end}`,
        netId: "n",
        start: { kind: "junction", junctionId: "j" },
        end: { kind: "junction", junctionId: end },
        bends: [],
        modes: ["manual"],
      }),
    );
  doc.annotations.push({
    id: "name",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "M2" }] },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const ink = createLabelClearanceContext(doc, resolver).measure(
    doc.annotations[0]!,
  ).inkBounds;
  // The name above the T's wire, its corner `gap` across from the dot.
  const at = (gap: number) => {
    doc.annotations[0] = {
      ...doc.annotations[0]!,
      anchor: {
        kind: "free",
        position: { x: 100 + gap - ink.x, y: 100 - gap - ink.y - ink.height },
      },
    };
    return createLabelClearanceContext(doc, resolver);
  };
  const radius = resolveDocumentStyleProfile(doc.presentation).nodes
    .junctionRadius;
  // A Schmitt trigger's M2 stood 0.2 units off the dot on its gate.
  const near = at((radius + 0.2) / Math.SQRT2);
  const box = near.measure(doc.annotations[0]!).inkBounds;
  expect(near.dotsAt(box).sort()).toEqual(["wa", "wb", "wc"]);
  // It crosses no wire, so callers weigh a dot apart from a wire.
  expect(near.conflictsAt(box, "name")).toEqual([]);
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([
    expect.objectContaining({
      code: "VISUAL_LABEL_CLEARANCE",
      objectIds: ["name", "wa", "wb", "wc"],
    }),
  ]);
  const clear = at((radius + 1.5) / Math.SQRT2);
  expect(clear.dotsAt(clear.measure(doc.annotations[0]!).inkBounds)).toEqual(
    [],
  );
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
});
it("reports free text struck through by a wire or drawn over a label (#1323)", () => {
  // A φ2 note written on a switch's name read as one smudge with it, and
  // nothing reported it.
  const doc = createEmptyDocument("d", "Notes");
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 0, y: 100 } },
    { id: "b", netId: "n", position: { x: 200, y: 100 } },
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
  const note = (id: string, x: number, y: number, polarity?: "both") => ({
    id,
    kind: "text" as const,
    locked: false,
    zIndex: 0,
    anchor: { kind: "free" as const, position: { x, y } },
    content: { runs: [{ kind: "text" as const, value: "phi2" }] },
    alignment: "start" as const,
    rotation: 0 as const,
    ...(polarity ? { polarity } : {}),
  });
  // Standing on the wire's line, its descender reaches over it.
  doc.drafting!.objects.push(note("on-wire", 20, 98));
  expect(
    diagnoseLabelClearance(doc, resolver).map((d) => [d.code, d.objectIds]),
  ).toEqual([["VISUAL_LABEL_CLEARANCE", ["on-wire", "w"]]]);

  // Its baseline 4 units above the wire: the line box still reaches the wire,
  // the words do not.
  doc.drafting!.objects[0] = note("on-wire", 20, 96);
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);

  // Over a label; a polarity mark there is drawn on purpose and passes.
  doc.drafting!.objects = [note("on-label", 100, 40)];
  doc.annotations.push({
    id: "name",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "S2" }] },
    anchor: { kind: "free", position: { x: 104, y: 42 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  expect(
    diagnoseVisualQuality(doc, resolver)
      .filter((d) => d.code === "VISUAL_LABEL_OVERLAP")
      .map((d) => d.objectIds),
  ).toEqual([["on-label", "name"]]);
  doc.drafting!.objects = [note("mark", 100, 40, "both")];
  doc.revision += 1;
  expect(
    diagnoseVisualQuality(doc, resolver).filter(
      (d) => d.code === "VISUAL_LABEL_OVERLAP",
    ),
  ).toEqual([]);

  // Over a part's outline, as a note inside a block is drawn on purpose.
  doc.annotations = [];
  doc.instances.push({
    id: "r",
    symbolId: "resistor",
    placement: { position: { x: 300, y: 40 }, rotation: 0, mirror: "none" },
  });
  doc.drafting!.objects = [note("inside", 296, 44)];
  doc.revision += 1;
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  expect(
    diagnoseVisualQuality(doc, resolver).filter(
      (d) => d.code === "VISUAL_LABEL_OVERLAP",
    ),
  ).toEqual([]);
});

it("keeps a label off an adder's sign marks, which are its ink (#1324)", () => {
  const doc = createEmptyDocument("d", "Signs");
  doc.instances.push({
    id: "sum",
    symbolId: "adder",
    reference: "X1",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: "adder" },
      parameters: { signA: "+", signB: "+" },
    },
  });
  // Over the plus that marks input A: x 74.7 … 82.3, y 85.7 … 93.3.
  const box = { x: 72, y: 84, width: 4, height: 3 };
  const adding = createLabelClearanceContext(doc, resolver);
  expect(adding.conflictsAt(box, "label")).toEqual([]);
  doc.instances[0]!.netlist!.parameters.signB = "-";
  const subtracting = createLabelClearanceContext(doc, resolver);
  expect(subtracting.conflictsAt(box, "label")).toEqual(["sum"]);
  const obstacle = subtracting.symbols.find((item) => item.id === "sum")!;
  // The plus reaches 3.8 units left of x = 78.5; one unit of padding.
  expect(obstacle.bounds.x).toBeCloseTo(100 - 21.5 - 3.8 - 1, 6);
});

it("measures a value by its glyphs' outlines as the label advance tables set them (#1413)", () => {
  // Gallery #92: CT1's value 1.33pF beside its plates, which end at
  // x 278.05; with a unit of padding a label must start at 279.05.
  const doc = createEmptyDocument("d", "Doherty");
  doc.instances.push({
    id: "CT1",
    symbolId: "capacitor",
    reference: "CT1",
    placement: { position: { x: 270, y: 100 }, rotation: 0, mirror: "none" },
  });
  const valueAt = (alignment: "start" | "end", x: number) => {
    doc.annotations = [
      {
        id: "value",
        kind: "instance-value",
        content: {
          runs: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "1.33pF" }],
            },
          ],
        },
        anchor: {
          kind: "object",
          objectId: "CT1",
          localOffset: { x: x - 270, y: 5 },
          fallbackPosition: { x, y: 105 },
        },
        alignment,
        rotation: 0,
        locked: false,
      },
    ];
    doc.revision += 1;
    return {
      ink: createLabelClearanceContext(doc, resolver).measure(
        doc.annotations[0]!,
      ).inkBounds,
      findings: diagnoseLabelClearance(doc, resolver).map((d) => [
        d.code,
        d.objectIds,
      ]),
    };
  };
  const overPlates = [["VISUAL_LABEL_CLEARANCE", ["value", "CT1"]]];
  // The original #1413 placement is clear in the narrower textbook face.
  expect(valueAt("end", 333).findings).toEqual([]);
  // Metropolis Bold: advance 50.41186, first bearing 0.498828.
  // Ending at 326.5 places the first ink at 276.59, over the plates.
  const close = valueAt("end", 326.5);
  expect(close.ink.x).toBeCloseTo(276.59, 1);
  expect(close.findings).toEqual(overPlates);
  // Three units farther right is clear; F ends 0.589524 short of the anchor.
  const clear = valueAt("end", 329.5);
  expect(clear.ink.x).toBeCloseTo(279.59, 1);
  expect(clear.ink.x + clear.ink.width).toBeCloseTo(328.91, 1);
  expect(clear.findings).toEqual([]);
  // A start-aligned value stands on its anchor by the same bearing: CT2's
  // spot 12 right of the centre is clear, 6 right of it is not.
  expect(valueAt("start", 282).findings).toEqual([]);
  const over = valueAt("start", 276);
  expect(over.ink.x).toBeCloseTo(276.5, 1);
  expect(over.findings).toEqual(overPlates);
});

describe("labels that run on (#1412)", () => {
  const bold = (value: string): RichTextDocument => ({
    runs: [
      { kind: "span", style: "bold", children: [{ kind: "text", value }] },
    ],
  });
  /** A Reference's standard look: a slanted letter over an upright index. */
  const reference = (letter: string, index: string): RichTextDocument => ({
    runs: [
      { kind: "span", style: "italic", children: bold(letter).runs },
      { kind: "span", style: "subscript", children: bold(index).runs },
    ],
  });
  function drawing() {
    const doc = createEmptyDocument("d", "Run-on");
    const part = (
      id: string,
      symbolId: string,
      x: number,
      y: number,
      rotation: 0 | 90 = 0,
    ) =>
      doc.instances.push({
        id,
        reference: id,
        symbolId,
        placement: { position: { x, y }, rotation, mirror: "none" },
      });
    /** A part's name or value, its anchor at (x, y). */
    const label = (
      owner: string,
      slot: "name" | "value",
      content: RichTextDocument,
      alignment: "start" | "middle" | "end",
      x: number,
      y: number,
    ) => {
      const at = doc.instances.find((i) => i.id === owner)!.placement!.position;
      doc.annotations.push({
        id: `${owner}-${slot}`,
        kind: slot === "name" ? "instance-label" : "instance-value",
        content,
        anchor: {
          kind: "object",
          objectId: owner,
          localOffset: { x: x - at.x, y: y - at.y },
          fallbackPosition: { x, y },
        },
        alignment,
        rotation: 0,
        locked: false,
      });
    };
    const runOn = () => {
      doc.revision += 1;
      return diagnoseLabelClearance(doc, resolver).filter(
        (d) => d.code === "VISUAL_LABEL_RUN_ON",
      );
    };
    /**
     * Start-aligned labels along one baseline, each one's ink `gap` after
     * the one before it, as measured.
     */
    const row = (ids: readonly string[], y: number, gap: number) => {
      let end = 0;
      for (const id of ids) {
        const annotation = doc.annotations.find((a) => a.id === id)!;
        const ink = createLabelClearanceContext(doc, resolver).measure(
          annotation,
        ).inkBounds;
        const anchor = annotation.anchor;
        if (anchor.kind !== "object") throw new Error(id);
        const x = anchor.fallbackPosition.x;
        const start = end ? end + gap - (ink.x - x) : x;
        const owner = doc.instances.find((i) => i.id === anchor.objectId)!
          .placement!.position;
        annotation.anchor = {
          ...anchor,
          localOffset: { x: start - owner.x, y: y - owner.y },
          fallbackPosition: { x: start, y },
        };
        end = start + (ink.x - x) + ink.width;
      }
    };
    return { doc, part, label, runOn, row };
  }

  it("reports two parts' values a few units apart on one line", () => {
    // #53, a Butterworth ladder: C3's value start-aligned beside it, C5's
    // end-aligned to its left.
    const { doc, part, label, runOn, row } = drawing();
    part("C3", "capacitor", 260, 60);
    part("C5", "capacitor", 392, 60);
    label("C3", "value", bold("637pF"), "start", 272, 65);
    label("C5", "value", bold("197pF"), "end", 380, 65);
    // The old positions are now clear. Keep the regression at a six-unit gap.
    expect(runOn()).toEqual([]);
    row(["C3-value", "C5-value"], 65, 6);
    expect(runOn()).toEqual([
      expect.objectContaining({
        severity: "info",
        category: "observation",
        gateEligible: false,
        objectIds: ["C3-value", "C5-value"],
        message:
          'C3\'s value "637pF" and C5\'s value "197pF" share a line 6 units apart and read as one',
      }),
    ]);
    // Moving the second part twelve units left overlaps the labels; that
    // belongs to VISUAL_LABEL_OVERLAP and is not reported twice.
    doc.instances[1]!.placement!.position.x = 380;
    expect(runOn()).toEqual([]);
    expect(
      diagnoseVisualQuality(doc, resolver)
        .filter((d) => d.code === "VISUAL_LABEL_OVERLAP")
        .map((d) => d.objectIds),
    ).toEqual([["C3-value", "C5-value"]]);
  });

  it("reports a name beside another part's value", () => {
    // #63, an L-match: C1's name beside it, L1's value centred under the
    // coil.
    const { part, label, runOn, row } = drawing();
    part("C1", "capacitor", 150, 40);
    part("L1", "inductor", 214, 20, 90);
    label("C1", "name", reference("C", "1"), "start", 162, 45);
    label("L1", "value", bold("31.8nH"), "middle", 214, 46);
    row(["C1-name", "L1-value"], 45, 4);
    expect(runOn().map((d) => d.message)).toEqual([
      'C1\'s name "C1" and L1\'s value "31.8nH" share a line 4 units apart and read as one',
    ]);
  });

  it("reports an LC ladder's names and values running along their rows", () => {
    // Each series coil's labels centred under the line, on the rows of its
    // shunt capacitors' labels.
    const { part, label, runOn, row } = drawing();
    const ladder = [
      ["C1", "capacitor", "38.1pF"],
      ["L2", "inductor", "115nH"],
      ["C3", "capacitor", "68pF"],
      ["L4", "inductor", "129nH"],
    ] as const;
    ladder.forEach(([id, symbolId, value], index) => {
      part(
        id,
        symbolId,
        100 + index * 100,
        60,
        symbolId === "inductor" ? 90 : 0,
      );
      label(id, "name", reference(id[0]!, id[1]!), "start", 0, 95);
      label(id, "value", bold(value), "start", 0, 115);
    });
    row(
      ladder.map(([id]) => `${id}-name`),
      95,
      6,
    );
    row(
      ladder.map(([id]) => `${id}-value`),
      115,
      5,
    );
    expect(runOn().map((d) => d.objectIds)).toEqual([
      ["C1-name", "L2-name"],
      ["C1-value", "L2-value"],
      ["L2-name", "C3-name"],
      ["L2-value", "C3-value"],
      ["C3-name", "L4-name"],
      ["C3-value", "L4-value"],
    ]);
  });

  it("leaves a part's own labels and labels a figure apart alone", () => {
    const { part, label, runOn, row } = drawing();
    part("R1", "resistor", 100, 100);
    part("R2", "resistor", 300, 100);
    label("R1", "name", reference("R", "1"), "start", 0, 105);
    label("R1", "value", bold("1k"), "start", 0, 105);
    label("R2", "value", bold("2k"), "start", 0, 105);
    // R1's name and value run on, as one part's are drawn on purpose; R2's
    // value stands a figure's width (10.3 units in Metropolis) clear of them.
    row(["R1-name", "R1-value"], 105, 3);
    row(["R1-value", "R2-value"], 105, 11);
    expect(runOn()).toEqual([]);
    row(["R1-value", "R2-value"], 105, 10);
    expect(runOn().map((d) => d.objectIds)).toEqual([["R1-value", "R2-value"]]);
  });
});
