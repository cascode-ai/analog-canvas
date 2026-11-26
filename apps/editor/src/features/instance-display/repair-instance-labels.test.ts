import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { defaultInstanceDisplayAnnotations } from "./default-instance-display";
import {
  arrangeInstanceLabelsReport,
  type ArrangeInstanceLabelsOptions,
} from "./arrange-instance-labels";
import { vddPowerLabelAnnotation } from "../component-insert/vdd-power-label";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function applyEdits(
  doc: SchematicDocument,
  edits: readonly SchematicEdit[],
): SchematicDocument {
  if (!edits.length) return doc;
  const result = executeTransaction(
    doc,
    {
      transactionId: "repair-test",
      documentId: doc.id,
      expectedRevision: doc.revision,
      actor: { kind: "agent", id: "test" },
      edits: [...edits],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) {
    throw new Error(
      `${result.error.message}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.document;
}

function addPart(
  doc: SchematicDocument,
  spec: {
    id: string;
    reference: string;
    symbolId: string;
    position: Point;
    rotation?: 0 | 90 | 180 | 270;
    mirror?: "none" | "horizontal" | "vertical";
    value?: string;
    showValue?: boolean;
    side?: "left" | "right" | "top" | "bottom";
  },
) {
  const instance = {
    id: spec.id,
    reference: spec.reference,
    symbolId: spec.symbolId,
    placement: {
      position: spec.position,
      rotation: spec.rotation ?? 0,
      mirror: spec.mirror ?? "none",
    },
    netlist: {
      parameters:
        spec.value !== undefined
          ? { value: spec.value }
          : spec.symbolId === "nmos" || spec.symbolId === "pmos"
            ? { w: "10u", l: "0.5u" }
            : {},
    },
  };
  doc.instances.push(instance);
  const style = resolveDocumentStyleProfile(doc.presentation);
  const annotations = defaultInstanceDisplayAnnotations(
    doc,
    instance,
    resolver,
    style,
    { showValue: spec.showValue ?? spec.value !== undefined },
  );
  if (spec.side) {
    const resolved = resolver.resolve(instance.symbolId)!;
    const hasVal = annotations.some(
      (a) => a.binding?.kind === "instance-value",
    );
    for (const ann of annotations) {
      const slot =
        ann.binding?.kind === "instance-value"
          ? "value"
          : hasVal
            ? "reference-over-value"
            : "reference";
      const placed = placeUprightInstanceLabel(
        instance,
        resolved,
        style,
        { x: 0, y: 0 },
        spec.side,
        doc.presentation.grid,
        1,
        slot,
      )!;
      ann.alignment = placed.alignment;
      ann.anchor = {
        kind: "object",
        objectId: instance.id,
        localOffset: {
          x: placed.position.x - instance.placement.position.x,
          y: placed.position.y - instance.placement.position.y,
        },
        fallbackPosition: placed.position,
      };
    }
  }
  doc.annotations.push(...annotations);
  return instance;
}

function addWire(doc: SchematicDocument, id: string, from: Point, to: Point) {
  if (!doc.nets.some((n) => n.id === "n"))
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

function addGround(doc: SchematicDocument, id: string, position: Point) {
  doc.instances.push({
    id,
    symbolId: "ground",
    placement: { position, rotation: 0, mirror: "none" },
  });
}

function addVdd(
  doc: SchematicDocument,
  id: string,
  position: Point,
  overBar = false,
) {
  const netId = "net-vdd";
  if (!doc.nets.some((n) => n.id === netId))
    doc.nets.push({ id: netId, terminals: [] });
  const instance = {
    id,
    symbolId: "vdd-port",
    placement: { position, rotation: 0 as const, mirror: "none" as const },
    netlist: { parameters: {} },
  };
  doc.instances.push(instance);
  const label = vddPowerLabelAnnotation({
    instance,
    resolved: resolver.resolve("vdd-port")!,
    netId,
    grid: doc.presentation.grid,
    name: "VDD",
  });
  if (overBar) {
    label.alignment = "middle";
    label.anchor = {
      kind: "object",
      objectId: id,
      localOffset: { x: 0, y: -15 },
      fallbackPosition: { x: position.x, y: position.y - 15 },
    };
  }
  doc.annotations.push(label);
  return instance;
}

function shiftLabel(
  doc: SchematicDocument,
  ownerId: string,
  kind: "instance-reference" | "instance-value",
  dx: number,
  dy: number,
) {
  const ann = doc.annotations.find(
    (a) =>
      a.binding?.kind === kind &&
      a.anchor.kind === "object" &&
      a.anchor.objectId === ownerId,
  )!;
  if (ann.anchor.kind === "object") {
    ann.anchor = {
      ...ann.anchor,
      localOffset: {
        x: ann.anchor.localOffset.x + dx,
        y: ann.anchor.localOffset.y + dy,
      },
      fallbackPosition: {
        x: ann.anchor.fallbackPosition.x + dx,
        y: ann.anchor.fallbackPosition.y + dy,
      },
    };
  }
  return ann;
}

function labelInk(
  doc: SchematicDocument,
  ownerId: string,
  kind: "instance-reference" | "instance-value",
): Rect | undefined {
  const ctx = createLabelClearanceContext(doc, resolver);
  const ann = ctx.visible.find(
    (a) =>
      a.binding?.kind === kind &&
      a.anchor.kind === "object" &&
      a.anchor.objectId === ownerId,
  );
  return ann ? ctx.measure(ann).inkBounds : undefined;
}

function labelPos(
  doc: SchematicDocument,
  ownerId: string,
  kind: "instance-reference" | "instance-value",
) {
  const ctx = createLabelClearanceContext(doc, resolver);
  const ann = ctx.visible.find(
    (a) =>
      a.binding?.kind === kind &&
      a.anchor.kind === "object" &&
      a.anchor.objectId === ownerId,
  )!;
  return ctx.measure(ann);
}

function repairAll(
  doc: SchematicDocument,
  extra: Partial<ArrangeInstanceLabelsOptions> = {},
) {
  const ids = doc.instances.filter((i) => i.placement).map((i) => i.id);
  const report = arrangeInstanceLabelsReport(doc, resolver, ids, {
    includeManual: true,
    ...extra,
  });
  const after = applyEdits(doc, report.edits);
  return { ...report, after };
}

describe("principled cohort-first label repair planner (#2619)", () => {
  it("moves inward-colliding parallel load resistors symmetrically to their outer sides (f7w29qtsmn pattern)", () => {
    const doc = createEmptyDocument("d", "CTLE Loads");
    addPart(doc, {
      id: "r0",
      reference: "R0",
      symbolId: "resistor",
      position: { x: 250, y: 170 },
      value: "400Ω",
      side: "right",
    });
    addPart(doc, {
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      position: { x: 320, y: 170 },
      value: "400Ω",
      side: "left",
    });
    // Output wires right below R0 and R1, as in a differential stage.
    addWire(doc, "outp", { x: 180, y: 200 }, { x: 250, y: 200 });
    addWire(doc, "outn", { x: 320, y: 200 }, { x: 390, y: 200 });

    const beforeCtx = createLabelClearanceContext(doc, resolver);
    expect(beforeCtx.visible.some((l) => !beforeCtx.clearAt(l))).toBe(true);

    const { after, hiddenValueIds } = repairAll(doc);
    expect(hiddenValueIds).toEqual([]);
    const afterCtx = createLabelClearanceContext(after, resolver);
    expect(afterCtx.visible.every((l) => afterCtx.clearAt(l))).toBe(true);

    const r0Body = afterCtx.symbols.find((s) => s.id === "r0")!.bounds;
    const r1Body = afterCtx.symbols.find((s) => s.id === "r1")!.bounds;
    const r0Name = labelInk(after, "r0", "instance-reference")!;
    const r1Name = labelInk(after, "r1", "instance-reference")!;
    const r0Val = labelInk(after, "r0", "instance-value")!;
    const r1Val = labelInk(after, "r1", "instance-value")!;

    // Both moved cleanly to their OUTER sides (R0 left, R1 right) and stay flush!
    expect(r0Name.x + r0Name.width).toBeLessThanOrEqual(r0Body.x);
    expect(r1Name.x).toBeGreaterThanOrEqual(r1Body.x + r1Body.width);
    expect(Math.abs(r0Name.y - r1Name.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(r0Val.y - r1Val.y)).toBeLessThanOrEqual(1);
    // Name stays above value on both resistors.
    expect(r0Name.y).toBeLessThan(r0Val.y);
    expect(r1Name.y).toBeLessThan(r1Val.y);
  });

  it("hides colliding parallel resistor values symmetrically only when hideCrowdedValues is enabled, leaving netlist parameters untouched", () => {
    const doc = createEmptyDocument("d", "Tight Parallel Resistors");
    addPart(doc, {
      id: "r0",
      reference: "R0",
      symbolId: "resistor",
      position: { x: 250, y: 170 },
      value: "400Ω",
      side: "right",
    });
    addPart(doc, {
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      position: { x: 320, y: 170 },
      value: "400Ω",
      side: "left",
    });
    // Box in the outer upper (y=150) and lower (y=190) wires: 40 units of vertical
    // space cannot fit R0+400Ω (36 units + clearance), while R0/R1 alone (16 units) fit cleanly.
    addWire(doc, "top-bar", { x: 160, y: 150 }, { x: 410, y: 150 });
    addWire(doc, "bot-l", { x: 160, y: 190 }, { x: 250, y: 190 });
    addWire(doc, "bot-r", { x: 320, y: 190 }, { x: 410, y: 190 });

    // Default repair never silently drops visible component values.
    const defaultRun = repairAll(doc);
    expect(defaultRun.hiddenValueIds).toEqual([]);
    expect(labelInk(defaultRun.after, "r0", "instance-value")).toBeDefined();
    expect(labelInk(defaultRun.after, "r1", "instance-value")).toBeDefined();

    // Opt-in hideCrowdedValues hides both values symmetrically and places R0/R1 outward.
    const optIn = repairAll(doc, { hideCrowdedValues: true });
    expect(optIn.hiddenValueIds).toHaveLength(2);
    expect(labelInk(optIn.after, "r0", "instance-value")).toBeUndefined();
    expect(labelInk(optIn.after, "r1", "instance-value")).toBeUndefined();
    // Netlist parameters remain completely untouched.
    expect(
      optIn.after.instances.find((i) => i.id === "r0")?.netlist?.parameters
        .value,
    ).toBe("400Ω");
    expect(
      optIn.after.instances.find((i) => i.id === "r1")?.netlist?.parameters
        .value,
    ).toBe("400Ω");

    const afterCtx = createLabelClearanceContext(optIn.after, resolver);
    expect(afterCtx.visible.every((l) => afterCtx.clearAt(l))).toBe(true);
    const r0Name = labelInk(optIn.after, "r0", "instance-reference")!;
    const r1Name = labelInk(optIn.after, "r1", "instance-reference")!;
    expect(Math.abs(r0Name.y - r1Name.y)).toBeLessThanOrEqual(1);
  });

  it("moves an aligned row of resistors flush together when a uniform shift clears all, or keeps the whole row flush in place (ar-4792 pattern)", () => {
    // Case A: Uniform shift within 1 grid step clears the whole row (even with an unreported member).
    const movableDoc = createEmptyDocument("d1", "Flush Row");
    const refs = ["R2", "R4", "R6", "R8"];
    for (const [idx, ref] of refs.entries()) {
      const x = 100 + idx * 70;
      addPart(movableDoc, {
        id: ref.toLowerCase(),
        reference: ref,
        symbolId: "resistor",
        position: { x, y: 200 },
        value: "150Ω",
        side: "right",
      });
      // Crowd only 3 of the 4 resistors with a grid-aligned wire right below their value.
      if (ref !== "R4") {
        addWire(
          movableDoc,
          `w-${ref}`,
          { x: x + 10, y: 230 },
          { x: x + 50, y: 230 },
        );
      }
    }
    const { after } = repairAll(movableDoc);
    const ys = new Set(
      refs.map((r) =>
        Math.round(labelInk(after, r.toLowerCase(), "instance-value")!.y),
      ),
    );
    expect(ys.size).toBe(1);
    const afterCtx = createLabelClearanceContext(after, resolver);
    expect(afterCtx.visible.every((l) => afterCtx.clearAt(l))).toBe(true);

    // Case B: One member is blocked above so no uniform shift works -> entire row stays flush.
    const blockedDoc = createEmptyDocument("d2", "Blocked Row");
    for (const [idx, ref] of refs.entries()) {
      const x = 100 + idx * 70;
      addPart(blockedDoc, {
        id: ref.toLowerCase(),
        reference: ref,
        symbolId: "resistor",
        position: { x, y: 200 },
        value: "150Ω",
        side: "right",
      });
      if (ref !== "R4") {
        addWire(
          blockedDoc,
          `wb-${ref}`,
          { x: x + 10, y: 230 },
          { x: x + 50, y: 230 },
        );
      }
    }
    // Block R4 above and on right so no uniform shift within 1 grid clears all 4.
    addWire(blockedDoc, "block-r4", { x: 180, y: 190 }, { x: 220, y: 190 });
    const blockedRes = repairAll(blockedDoc);
    expect(blockedRes.edits).toEqual([]);
  });

  it("keeps mirrored differential/cascode MOS pairs symmetric — never breaks mirror symmetry (ag-309 & xztx7khz65 patterns)", () => {
    const doc = createEmptyDocument("d", "Mirrored Pair");
    addPart(doc, {
      id: "m12",
      reference: "M12",
      symbolId: "nmos",
      position: { x: 200, y: 160 },
      mirror: "none",
      showValue: false,
      side: "left",
    });
    addPart(doc, {
      id: "m13",
      reference: "M13",
      symbolId: "nmos",
      position: { x: 320, y: 160 },
      mirror: "horizontal",
      showValue: false,
      side: "right",
    });
    // Crowd M13 on its outer side and block any symmetric shift for M12.
    addWire(doc, "w-m13", { x: 350, y: 145 }, { x: 350, y: 185 });
    addWire(doc, "w-m12-top", { x: 150, y: 145 }, { x: 190, y: 145 });
    addWire(doc, "w-m12-bot", { x: 150, y: 180 }, { x: 190, y: 180 });
    addWire(doc, "w-m12-left", { x: 145, y: 145 }, { x: 145, y: 180 });

    const { edits, after } = repairAll(doc);
    expect(edits).toEqual([]);
    const p12 = labelPos(after, "m12", "instance-reference").position;
    const p13 = labelPos(after, "m13", "instance-reference").position;
    expect(p12.y).toBe(p13.y);
  });

  it("keeps a vertical column of aligned transistors flush (6b7s8kaqky & DRLW patterns)", () => {
    const doc = createEmptyDocument("d", "Transistor Column");
    for (const [idx, ref] of ["M1", "M3", "M5", "M7"].entries()) {
      const y = 100 + idx * 80;
      addPart(doc, {
        id: ref.toLowerCase(),
        reference: ref,
        symbolId: "pmos",
        position: { x: 200, y },
        showValue: false,
        side: "right",
      });
    }
    // Put a wire slightly crowding M3 and M5 on their right so a uniform small shift clears all 4.
    addWire(doc, "w-col", { x: 215, y: 171 }, { x: 260, y: 171 });
    addWire(doc, "w-col2", { x: 215, y: 251 }, { x: 260, y: 251 });

    const { after } = repairAll(doc);
    const xs = new Set(
      ["m1", "m3", "m5", "m7"].map((id) =>
        Math.round(labelPos(after, id, "instance-reference").position.x),
      ),
    );
    expect(xs.size).toBe(1);
  });

  it("moves a resistor whose value is struck by a wire cleanly to its unwired opposite side while keeping name above value (i2n-1024 pattern)", () => {
    const doc = createEmptyDocument("d", "Struck Resistor");
    addPart(doc, {
      id: "r2",
      reference: "R2",
      symbolId: "resistor",
      position: { x: 300, y: 160 },
      value: "200kΩ",
      side: "right",
    });
    // Vertical wire straight through R2's value on the right side; left side is open and unwired.
    addWire(doc, "w-strike", { x: 320, y: 120 }, { x: 320, y: 220 });

    const { after, hiddenValueIds } = repairAll(doc);
    expect(hiddenValueIds).toEqual([]);
    const ctx = createLabelClearanceContext(after, resolver);
    expect(ctx.visible.every((l) => ctx.clearAt(l))).toBe(true);
    const body = ctx.symbols.find((s) => s.id === "r2")!.bounds;
    const name = labelInk(after, "r2", "instance-reference")!;
    const val = labelInk(after, "r2", "instance-value")!;
    // Both crossed together onto the clean unwired left side, name above value.
    expect(name.x + name.width).toBeLessThanOrEqual(body.x);
    expect(val.x + val.width).toBeLessThanOrEqual(body.x);
    expect(name.y).toBeLessThan(val.y);
  });

  it("never inverts a value above its name when the value is overlapped below (ve832ef9mm pattern)", () => {
    const doc = createEmptyDocument("d", "Fixed Name Overlapped Value");
    addPart(doc, {
      id: "csp",
      reference: "CSp",
      symbolId: "capacitor",
      position: { x: 200, y: 200 },
      value: "1pF",
      side: "right",
    });
    // Lock the Reference (just like a custom-styled Reference that cannot move).
    const refAnn = doc.annotations.find(
      (a) => a.binding?.kind === "instance-reference",
    )!;
    refAnn.locked = true;
    const valPos = labelPos(doc, "csp", "instance-value").position;
    // Place an obstacle label directly on 1pF.
    doc.annotations.push({
      id: "vcm-obstacle",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "VCM" }] },
      anchor: { kind: "free", position: valPos },
      alignment: "start",
      rotation: 0,
      locked: true,
    });

    const { after } = repairAll(doc);
    const name = labelInk(after, "csp", "instance-reference")!;
    const val = labelInk(after, "csp", "instance-value")!;
    // Name must still stand above value — never inverted.
    expect(name.y).toBeLessThan(val.y);
  });

  it("does not jump a capacitor label up into the horizontal row between two neighbouring MOS labels (y8b2abqnyb C7 pattern)", () => {
    const doc = createEmptyDocument("d", "Row Intrusion");
    addPart(doc, {
      id: "m5",
      reference: "M5",
      symbolId: "pmos",
      position: { x: 480, y: 170 },
      rotation: 90,
      showValue: false,
      side: "bottom",
    });
    addPart(doc, {
      id: "m6",
      reference: "M6",
      symbolId: "pmos",
      position: { x: 550, y: 170 },
      rotation: 90,
      showValue: false,
      side: "bottom",
    });
    addPart(doc, {
      id: "c7",
      reference: "C7",
      symbolId: "capacitor",
      position: { x: 515, y: 225 },
      rotation: 90,
      showValue: false,
      side: "top",
    });
    // Nudge C7 slightly down so it grazes its own top plate, and block below with a wire.
    shiftLabel(doc, "c7", "instance-reference", 0, 5);
    addWire(doc, "w-below", { x: 470, y: 245 }, { x: 560, y: 245 });

    const { after } = repairAll(doc);
    const m5 = labelInk(after, "m5", "instance-reference")!;
    const m6 = labelInk(after, "m6", "instance-reference")!;
    const c7 = labelInk(after, "c7", "instance-reference")!;
    const sharesRowWithM5 =
      Math.min(c7.y + c7.height, m5.y + m5.height) - Math.max(c7.y, m5.y) >=
      Math.min(c7.height, m5.height) / 2;
    const betweenM5M6 = c7.x >= m5.x && c7.x <= m6.x + m6.width;
    expect(sharesRowWithM5 && betweenM5M6).toBe(false);
  });

  it("keeps transistors aligned with closer row-mates and never pushes labels down beside grounds (ss2hsg8c7j pattern)", () => {
    const doc = createEmptyDocument("d", "Near Grounds");
    const specs = [
      { id: "m5", reference: "M5", x: 320, mirror: "none" as const },
      { id: "m1", reference: "M1", x: 400, mirror: "none" as const },
      { id: "m3", reference: "M3", x: 570, mirror: "horizontal" as const },
      { id: "m6", reference: "M6", x: 650, mirror: "horizontal" as const },
    ];
    for (const s of specs) {
      addPart(doc, {
        id: s.id,
        reference: s.reference,
        symbolId: "nmos",
        position: { x: s.x, y: 350 },
        mirror: s.mirror,
        showValue: false,
        side: s.mirror === "none" ? "left" : "right",
      });
      // Nudge each slightly onto its own bottom outline, with grounds right below.
      shiftLabel(
        doc,
        s.id,
        "instance-reference",
        s.mirror === "none" ? 10 : -10,
        20,
      );
      addGround(doc, `gnd-${s.id}`, { x: s.x, y: 390 });
    }

    const { after } = repairAll(doc);
    // No transistor label should drop wholly below its transistor body beside its ground.
    const ctx = createLabelClearanceContext(after, resolver);
    for (const s of specs) {
      const body = ctx.symbols.find((sym) => sym.id === s.id)!.bounds;
      const ink = labelInk(after, s.id, "instance-reference")!;
      expect(ink.y).toBeLessThan(body.y + body.height);
    }
  });

  it("keeps VDD label orientation consistent with the drawing's majority (ag-1306 & bfzpwrhc4s patterns)", () => {
    const doc = createEmptyDocument("d", "VDD Majority");
    addVdd(doc, "vdd1", { x: 100, y: 100 }, false);
    addVdd(doc, "vdd2", { x: 200, y: 100 }, false);
    addVdd(doc, "vdd3", { x: 300, y: 100 }, false);
    // Strike vdd3's beside-bar label with a wire so it is reported; since majority
    // are beside their bars, repair must NOT flip vdd3 over its bar.
    addWire(doc, "w-vdd3", { x: 320, y: 80 }, { x: 320, y: 120 });

    const { edits } = repairAll(doc);
    expect(edits).toEqual([]);
  });

  it("turns a reported Port name only to a clear side about its own end, never onto a nearby part (ag-1026 pattern)", () => {
    const doc = createEmptyDocument("d", "Port Turn");
    doc.nets.push({
      id: "net-vin",
      terminals: [{ instanceId: "p1", pinName: "P" }],
    });
    const port = {
      id: "p1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    doc.instances.push(port);
    doc.netlist!.terminals.push({
      id: "term-1",
      netId: "net-vin",
      name: "Vin",
      direction: "input",
      interfaceInstanceIds: ["p1"],
    });
    const style = resolveDocumentStyleProfile(doc.presentation);
    doc.annotations.push(
      ...defaultInstanceDisplayAnnotations(doc, port, resolver, style, {
        formalTerminalId: "term-1",
        formalName: "Vin",
      }),
    );
    const beforePos = createLabelClearanceContext(doc, resolver).measure(
      doc.annotations[0]!,
    ).position;
    // Draw a grid-aligned wire right through Vin's current side so it must turn to a clear side of p1.
    const wireX = Math.round((beforePos.x - 10) / 10) * 10;
    addWire(doc, "w-port", { x: wireX, y: 80 }, { x: wireX, y: 120 });

    const { after, edits } = repairAll(doc);
    expect(edits.length).toBeGreaterThan(0);
    const afterCtx = createLabelClearanceContext(after, resolver);
    const moved = after.annotations.find(
      (a) => a.id === doc.annotations[0]!.id,
    )!;
    expect(afterCtx.clearAt(moved)).toBe(true);
    // Remains right beside its Port endpoint.
    const pos = afterCtx.measure(moved).position;
    expect(Math.hypot(pos.x - 100, pos.y - 100)).toBeLessThanOrEqual(25);
  });

  it("never moves a label onto another label (ar-3923 pattern)", () => {
    const doc = createEmptyDocument("d", "No Overlap");
    addPart(doc, {
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      position: { x: 200, y: 200 },
      value: "1k",
      side: "right",
    });
    const valPos = labelPos(doc, "r1", "instance-value").position;
    addWire(
      doc,
      "w-val",
      { x: valPos.x + 5, y: 180 },
      { x: valPos.x + 5, y: 240 },
    );
    // Put a stationary label right on the left side as an obstacle.
    doc.annotations.push({
      id: "obst",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "VREF" }] },
      anchor: { kind: "free", position: { x: 180, y: 205 } },
      alignment: "end",
      rotation: 0,
      locked: true,
    });

    const { after } = repairAll(doc);
    const afterCtx = createLabelClearanceContext(after, resolver);
    for (const label of afterCtx.visible) {
      if (label.anchor.kind === "object" && label.anchor.objectId === "r1") {
        expect(
          afterCtx.overlapsAt(afterCtx.measure(label).inkBounds, label.id),
        ).toEqual([]);
      }
    }
  });

  it("keeps a label clear of crowding and returns no edits on a clean drawing", () => {
    const doc = createEmptyDocument("d", "Clean Drawing");
    addPart(doc, {
      id: "r1",
      reference: "R1",
      symbolId: "resistor",
      position: { x: 100, y: 100 },
      value: "10k",
      side: "right",
    });
    addPart(doc, {
      id: "r2",
      reference: "R2",
      symbolId: "resistor",
      position: { x: 250, y: 100 },
      value: "10k",
      side: "right",
    });
    expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
    const { edits, hiddenValueIds } = repairAll(doc);
    expect(edits).toEqual([]);
    expect(hiddenValueIds).toEqual([]);
  });
});
