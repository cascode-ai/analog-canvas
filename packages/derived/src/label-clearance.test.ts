import { expect, it } from "vitest";
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
      const placement = defaultInstanceLabelPlacement(
        doc.instances.at(-1)!,
        resolved,
        profile,
        doc.presentation.grid,
        slot,
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
    const placement = defaultInstanceLabelPlacement(
      instance,
      resolved,
      profile,
      doc.presentation.grid,
      slot,
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
