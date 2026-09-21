import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  type Annotation,
  type DraftingObject,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  draftingPropertyValue,
  annotationPropertyValue,
  serializeAnnotationPropertyCode,
  parseDraftingPropertyCode,
  parseAnnotationPropertyCode,
  annotationPropertyAdapter,
} from "./annotation-property-code";

const anchor = { kind: "free" as const, position: { x: 100, y: 100 } };
const base = { id: "drawing", locked: false, zIndex: 0, anchor };
const text = {
  content: { runs: [{ kind: "text" as const, value: "VDD" }] },
  alignment: "middle" as const,
  rotation: 0 as const,
};
const rectangle: DraftingObject = {
  ...base,
  kind: "rectangle",
  center: anchor.position,
  width: 80,
  height: 40,
  rotation: 0,
  lineStyle: "solid",
};
const arrow: DraftingObject = {
  ...base,
  kind: "arrow",
  from: anchor,
  to: { kind: "free", position: { x: 200, y: 100 } },
};
const objects: DraftingObject[] = [
  rectangle,
  {
    ...base,
    kind: "circle",
    center: anchor.position,
    radius: 40,
    lineStyle: "solid",
  },
  arrow,
  {
    ...base,
    kind: "construction-line",
    points: [anchor.position, { x: 200, y: 100 }],
    lineStyle: "dashed",
  },
  { ...base, kind: "text", ...text },
  { ...base, kind: "text", ...text, polarity: "both" },
  { ...base, kind: "text", ...text, polarity: "positive" },
  { ...base, kind: "text", ...text, polarity: "negative" },
  { ...base, kind: "callout", ...text, target: anchor },
  { ...base, kind: "leader", target: anchor },
  {
    ...base,
    kind: "floating-symbol",
    symbolId: "resistor",
    transform: { rotation: 0, mirror: "none" },
  },
];
const resolver = new InMemorySymbolResolver(builtInSymbols);
function context(object: DraftingObject) {
  const document = createEmptyDocument("doc", "Properties");
  document.drafting = { objects: [object] };
  return { object, document, resolver, grid: 1 };
}
function source(object: DraftingObject) {
  return serializeAnnotationPropertyCode(
    draftingPropertyValue(context(object)),
  );
}
function change(
  object: DraftingObject,
  update: (code: ReturnType<typeof draftingPropertyValue>) => void,
) {
  const code = draftingPropertyValue(context(object));
  update(code);
  return parseDraftingPropertyCode(JSON.stringify(code), context(object));
}

describe("annotation code projection", () => {
  it.each(objects)(
    "round trips $kind without changing identity, geometry or content",
    (object) => {
      const result = parseDraftingPropertyCode(source(object), context(object));
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(JSON.parse(JSON.stringify(result.value))).toEqual(object);
    },
  );
  it.each(
    objects.filter(
      (object) => object.kind === "rectangle" || object.kind === "circle",
    ),
  )("updates $kind border, fill and stacking together", (object) => {
    const result = change(object, (code) => {
      code.appearance.color = "#123456";
      code.appearance.fillColor = "#abcdef";
      code.stacking = { layer: "back" };
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: object.id,
        layer: "background",
        zIndex: object.zIndex,
        styleOverride: { color: "#123456", fillColor: "#abcdef" },
      },
    });
    if (!result.ok) return;
    const reset = change(result.value, (code) => {
      code.appearance.color = "auto";
      code.appearance.fillColor = "auto";
    });
    expect(reset).toMatchObject({
      ok: true,
      value: { styleOverride: undefined },
    });
  });
  it("preserves short hex colors and latent styles on unrelated changes", () => {
    const object = {
      ...rectangle,
      styleOverride: { color: "#abc", weight: "normal" as const },
    };
    expect(
      change(object, (code) => {
        code.geometry!.width = 120;
      }),
    ).toMatchObject({
      ok: true,
      value: { styleOverride: object.styleOverride, width: 120 },
    });
  });
  it("uses front/back without exposing or resetting an existing numeric drawing order", () => {
    const object = { ...rectangle, layer: "background" as const, zIndex: 37 };
    const code = draftingPropertyValue(context(object));
    expect(code.stacking).toEqual({ layer: "back" });
    expect(code.placement).toEqual({ at: [100, 100], rotation: 0 });
    expect(source(object)).not.toMatch(/bearing|zIndex|background/);
    expect(
      change(object, (value) => {
        value.stacking!.layer = "front";
      }),
    ).toMatchObject({
      ok: true,
      value: { layer: "foreground", zIndex: 37 },
    });
    const drawing = { ...arrow, zIndex: 12 };
    expect(draftingPropertyValue(context(drawing))).not.toHaveProperty(
      "stacking",
    );
    expect(
      change(drawing, (value) => {
        value.appearance.lineStyle = "dotted";
      }),
    ).toMatchObject({
      ok: true,
      value: { zIndex: 12, styleOverride: { lineStyle: "dotted" } },
    });
  });
  it("accepts a custom rectangle rotation while retaining the text angle contract", () => {
    expect(
      change(rectangle, (code) => {
        code.placement.rotation = 22.5;
      }),
    ).toMatchObject({
      ok: true,
      value: { rotation: 22.5 },
    });
    expect(
      change({ ...base, kind: "text", ...text }, (code) => {
        code.placement.rotation = 22.5;
      }).ok,
    ).toBe(false);
  });
  it("never reformats numeric-looking text while compacting color and coordinate arrays", () => {
    const object: DraftingObject = {
      ...base,
      kind: "text",
      ...text,
      content: {
        runs: [
          { kind: "text", value: '[1,  2,   3] and \"color\": [1,  2, 3]' },
        ],
      },
    };
    const result = parseDraftingPropertyCode(source(object), context(object));
    expect(result).toMatchObject({
      ok: true,
      value: { content: object.content },
    });
  });
  it("moves the whole free path and retains its segment structure", () => {
    expect(
      change(arrow, (code) => {
        code.placement.at = [110, 120];
      }),
    ).toMatchObject({
      ok: true,
      value: {
        from: { position: { x: 110, y: 120 } },
        to: { position: { x: 210, y: 120 } },
      },
    });
  });
  it("keeps existing steep curves and fractional outline widths editable", () => {
    const curved: DraftingObject = {
      ...arrow,
      curveControls: [{ x: 150, y: 5000 }],
    };
    expect(
      change(curved, (code) => {
        code.appearance.color = "#123456";
      }).ok,
    ).toBe(true);
    const outline: DraftingObject = { ...arrow, outline: { width: 12.5 } };
    expect(
      parseDraftingPropertyCode(source(outline), context(outline)).ok,
    ).toBe(true);
  });
  it("rotates and curves through the existing geometry planner", () => {
    const curved = change(arrow, (code) => {
      code.placement.rotation = 90;
      code.geometry!.tangentAngles = [60];
    });
    expect(curved.ok).toBe(true);
    if (!curved.ok) return;
    const value = draftingPropertyValue(context(curved.value));
    expect(value.placement.rotation).toBe(90);
    expect(value.geometry!.tangentAngles![0]).toBeCloseTo(60, 0);
    expect(
      change(curved.value, (code) => {
        code.appearance.arrowShape = "outline";
      }),
    ).toMatchObject({ ok: false });
  });
  it("changes arrow family without flattening bends or losing paint", () => {
    const outlined = change(
      { ...arrow, styleOverride: { color: "#123456" } },
      (code) => {
        code.appearance.arrowShape = "outline";
        code.appearance.startStyle = "medium-arrow";
      },
    );
    expect(outlined).toMatchObject({
      ok: true,
      value: {
        outline: { width: 30 },
        styleOverride: { color: "#123456", arrowStart: "medium-arrow" },
      },
    });
    if (!outlined.ok) return;
    expect(
      change(outlined.value, (code) => {
        code.geometry!.width = 45;
      }),
    ).toMatchObject({ ok: true, value: { outline: { width: 45 } } });
  });
  it("edits either endpoint without changing the other end or normalizing legacy scale", () => {
    const legacy: DraftingObject = {
      ...arrow,
      styleOverride: { arrowHeadAt: "both" as const, arrowHeadScale: 1.25 },
    };
    expect(
      parseDraftingPropertyCode(source(legacy), context(legacy)),
    ).toMatchObject({ ok: true, value: legacy });
    const start = change(legacy, (code) => {
      code.appearance.startStyle = "dot";
    });
    expect(start).toMatchObject({
      ok: true,
      value: { styleOverride: { ...legacy.styleOverride, arrowStart: "dot" } },
    });
    if (!start.ok) return;
    expect(start.value.styleOverride).not.toHaveProperty("arrowEnd");
    expect(
      change(start.value, (code) => {
        code.appearance.endStyle = "large-arrow";
      }),
    ).toMatchObject({
      ok: true,
      value: {
        styleOverride: {
          ...legacy.styleOverride,
          arrowStart: "dot",
          arrowEnd: "large-arrow",
        },
      },
    });
    expect(
      change({ ...start.value, locked: true }, (code) => {
        code.appearance.endStyle = "none";
      }).ok,
    ).toBe(false);
    expect(
      change(start.value, (code) => {
        code.appearance.startStyle = "tiny" as any;
        code.appearance.endStyle = "none";
      }).ok,
    ).toBe(false);
  });
  it("preserves endpoint choices when changing the shaft family", () => {
    const legacy: DraftingObject = {
      ...arrow,
      styleOverride: { arrowHead: "none" },
    };
    const result = change(legacy, (code) => {
      code.appearance.arrowShape = "outline";
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        outline: { width: 30 },
        styleOverride: { arrowStart: "none", arrowEnd: "none" },
      },
    });
    if (!result.ok) return;
    expect(
      draftingPropertyValue(context(result.value)).appearance,
    ).toMatchObject({ startStyle: "none", endStyle: "none" });
    const line = change(result.value, (code) => {
      code.appearance.arrowShape = "line";
      code.appearance.endStyle = "open-arrow";
    });
    expect(line).toMatchObject({
      ok: true,
      value: { styleOverride: { arrowStart: "none", arrowEnd: "open-arrow" } },
    });
    if (line.ok) expect(line.value).not.toHaveProperty("outline");
  });
  it("rejects invalid, unsupported and missing properties without a partial edit", () => {
    for (const update of [
      (code: any) => {
        code.geometry.width = -1;
        code.appearance.color = "#123456";
      },
      (code: any) => {
        code.appearance.color = [256, 0, 0];
      },
      (code: any) => {
        code.stacking.layer = "middle";
      },
      (code: any) => {
        code.geometry.width = 0;
      },
      (code: any) => {
        delete code.appearance.fillColor;
      },
      (code: any) => {
        code.binding = { kind: "net-name", netId: "VDD" };
      },
    ])
      expect(change(rectangle, update).ok).toBe(false);
    expect(parseDraftingPropertyCode("{", context(rectangle)).ok).toBe(false);
    expect(
      change(arrow, (code) => {
        code.appearance.fillColor = "#123456";
      }).ok,
    ).toBe(false);
  });
  it("allows only unlock while locked, including protection against simultaneous unlock/edit", () => {
    const locked = { ...rectangle, locked: true };
    expect(parseDraftingPropertyCode(source(locked), context(locked)).ok).toBe(
      true,
    );
    expect(
      change(locked, (code) => {
        code.locked = false;
      }).ok,
    ).toBe(true);
    expect(
      change(locked, (code) => {
        code.locked = false;
        code.geometry!.width = 900;
      }).ok,
    ).toBe(false);
  });
  it("keeps semantic bindings intact while changing visual presentation", () => {
    const annotation: Annotation = {
      id: "label",
      kind: "instance-label",
      anchor,
      locked: false,
      alignment: "middle",
      rotation: 0,
      binding: { kind: "instance-reference", instanceId: "R1" },
    };
    const code = annotationPropertyValue(annotation);
    expect(code).not.toHaveProperty("content");
    code.appearance.color = "#123456";
    code.placement.rotation = 45;
    code.display!.visible = false;
    const result = parseAnnotationPropertyCode(
      JSON.stringify(code),
      annotation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: annotation.binding,
        textColor: "#123456",
        rotation: 45,
        visible: false,
      },
    });
    expect(
      parseAnnotationPropertyCode(
        JSON.stringify({ ...code, content: text.content }),
        annotation,
      ).ok,
    ).toBe(false);
  });
  it("patches the chosen inline color only, preserving whitespace and other values", () => {
    const code = source(rectangle);
    const adapter = annotationPropertyAdapter(
      (source) => parseDraftingPropertyCode(source, context(rectangle)),
      true,
    );
    const edits = adapter.changes(code, {
      "appearance.fillColor": [12, 34, 56],
    });
    expect(edits).toHaveLength(1);
    const edit = edits[0]!;
    const next = code.slice(0, edit.from) + edit.insert + code.slice(edit.to);
    expect(parseDraftingPropertyCode(next, context(rectangle))).toMatchObject({
      ok: true,
      value: { styleOverride: { fillColor: "#0c2238" } },
    });
    expect(
      adapter.changes(code, { "appearance.fillColor": [999, 0, 0] }),
    ).toEqual([]);
  });
  it("provides typed menu choices and patches only their JSON value", () => {
    const object: DraftingObject = { ...base, kind: "text", ...text };
    const code = source(object);
    const adapter = annotationPropertyAdapter(
      (source) => parseDraftingPropertyCode(source, context(object)),
      false,
    );
    const spans = adapter.spans(code);
    const choices = (path: string) =>
      spans
        .find((span) => span.field.path === path)!
        .field.options!.map((option) => option.value);
    expect(choices("placement.rotation")).toEqual([
      0, 45, 90, 135, 180, 225, 270, 315,
    ]);
    expect(choices("appearance.alignment")).toEqual(["start", "middle", "end"]);
    expect(choices("appearance.weight")).toEqual(["normal", "bold"]);
    expect(choices("appearance.italic")).toEqual([false, true]);
    for (const [path, value, expected] of [
      ["placement.rotation", 90, { rotation: 90 }],
      ["locked", true, { locked: true }],
      ["appearance.alignment", "end", { alignment: "end" }],
    ] as const) {
      const edits = adapter.changes(code, { [path]: value });
      expect(edits).toHaveLength(1);
      const edit = edits[0]!;
      const next = code.slice(0, edit.from) + edit.insert + code.slice(edit.to);
      expect(parseDraftingPropertyCode(next, context(object))).toMatchObject({
        ok: true,
        value: expected,
      });
    }
    expect(adapter.changes(code, { "placement.rotation": "90" })).toEqual([]);
    expect(adapter.changes(code, { locked: "true" })).toEqual([]);
    expect(adapter.changes(code, { "appearance.weight": "heavy" })).toEqual([]);
  });
});

describe("polyline property code", () => {
  it("edits coordinates and endpoint shapes together without redundant angle bookkeeping", () => {
    const result = change(arrow, (code) => {
      code.geometry!.points = [
        [100, 100],
        [100, 250],
        [350, 250],
      ];
      code.appearance.startStyle = "dot";
      code.appearance.endStyle = "large-arrow";
      code.geometry!.closed = true;
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        from: arrow.from,
        to: arrow.from,
        waypoints: [
          { x: 100, y: 250 },
          { x: 350, y: 250 },
        ],
        styleOverride: { arrowStart: "dot", arrowEnd: "large-arrow" },
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(
      change(result.value, (code) => {
        code.geometry!.closed = false;
      }),
    ).toMatchObject({
      ok: true,
      value: {
        from: arrow.from,
        to: { kind: "free", position: { x: 350, y: 250 } },
        waypoints: [{ x: 100, y: 250 }],
      },
    });
  });
  it("does not overwrite a translation or rotation with the unchanged points projection", () => {
    const result = change(arrow, (code) => {
      code.placement.at = [200, 200];
      code.placement.rotation = 90;
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        from: { position: { x: 250, y: 150 } },
        to: { position: { x: 250, y: 250 } },
      },
    });
  });
  it("rejects closing a two-vertex line without damaging its endpoints", () => {
    const result = change(arrow, (code) => {
      code.geometry!.closed = true;
    });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("three distinct"),
    });
  });
});
