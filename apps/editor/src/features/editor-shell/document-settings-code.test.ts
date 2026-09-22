import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import {
  defaultDocumentSettingsCode,
  documentSettingsCodeValue,
  mosBulkDefaultNetIdFromCode,
  parseDocumentSettingsCode,
  serializeDocumentSettingsCode,
  type CanvasPreferenceCodeValue,
  type DocumentSettingsCodeValue,
} from "./document-settings-code";
import {
  documentSettingsCodeChanges,
  documentSettingsCodeSpans,
} from "./document-settings-code-assists";

const canvas: CanvasPreferenceCodeValue = {
  showGrid: true,
  annotationGrid: 5,
  drawAngle: "free",
  scrollBehavior: "auto",
};

function editableValue(): DocumentSettingsCodeValue {
  return {
    appearance: {
      fontScale: 1,
      wireStrokeScale: 1,
      symbolStrokeScale: 1,
      annotationStrokeScale: 1,
      junctionRadiusScale: 1,
    },
    bulkDefaults: { nmos: "VSS", pmos: "VDD" },
    labels: {
      first_letter_italic: true,
      subscript_after_first: true,
      subscript_case: "preserve",
      subscript_italic: false,
      underscore_subscript: true,
    },
    canvas: { ...canvas },
  };
}

function applyChanges(
  source: string,
  changes: readonly { from: number; to: number; insert: string }[],
): string {
  return [...changes]
    .reverse()
    .reduce(
      (text, change) =>
        text.slice(0, change.from) + change.insert + text.slice(change.to),
      source,
    );
}

describe("document Style code", () => {
  it("serializes the complete appearance and canvas preference surface", () => {
    const document = createEmptyDocument("document-main", "Main");
    expect(documentSettingsCodeValue(document, canvas)).toEqual(
      editableValue(),
    );
    expect(JSON.parse(serializeDocumentSettingsCode(editableValue()))).toEqual(
      editableValue(),
    );
  });

  it("shows VSS and VDD while resolving them to the Cell's real supply Nets", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push(
      { id: "net-vss", terminals: [] },
      { id: "net-vdd", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "vss-claim",
        kind: "name-claim",
        netId: "net-vss",
        owner: { kind: "power-marker", objectId: "GND1" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
      {
        id: "vdd-claim",
        kind: "name-claim",
        netId: "net-vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
      },
    );

    expect(documentSettingsCodeValue(document, canvas).bulkDefaults).toEqual({
      nmos: "VSS",
      pmos: "VDD",
    });
    expect(mosBulkDefaultNetIdFromCode(document, "nmos", "VSS")).toBe(
      "net-vss",
    );
    expect(mosBulkDefaultNetIdFromCode(document, "pmos", "VDD")).toBe(
      "net-vdd",
    );
  });

  it("normalizes label field order without inventing a label edit", () => {
    const document = createEmptyDocument("document-main", "Main");
    const baseline = documentSettingsCodeValue(document, canvas);
    const reordered = {
      ...baseline,
      labels: Object.fromEntries(Object.entries(baseline.labels).reverse()),
    };
    const parsed = parseDocumentSettingsCode(
      JSON.stringify(reordered),
      document,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDocumentSettingsCode(parsed.value)).toBe(
      serializeDocumentSettingsCode(baseline),
    );
  });

  it("accepts supported values and a Net id present in the Cell", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-ground", terminals: [] });
    const value = editableValue();
    value.appearance.fontScale = 1.5;
    value.bulkDefaults.nmos = "net-ground";
    value.canvas = {
      showGrid: false,
      annotationGrid: 1,
      drawAngle: "45",
      scrollBehavior: "pan",
    };

    expect(
      parseDocumentSettingsCode(serializeDocumentSettingsCode(value), document),
    ).toEqual({ ok: true, value });
  });

  it.each([
    ["appearance.fontScale", 0.49, "from 0.5 to 2"],
    ["appearance.wireStrokeScale", 2.01, "from 0.5 to 2"],
    ["canvas.annotationGrid", 2, "must be 1, 5, or 10"],
    ["canvas.drawAngle", "diagonal", 'must be "free", "45", or "orthogonal"'],
    ["canvas.scrollBehavior", "smooth", 'must be "auto", "zoom", or "pan"'],
    ["labels.subscript_case", "titlecase", "preserve"],
    ["labels.subscript_italic", "false", "must be true or false"],
    ["labels.subscript_italic", 0, "must be true or false"],
    ["labels.underscore_subscript", "true", "must be true or false"],
    ["labels.subscript_after_first", 1, "must be true or false"],
    ["labels.first_letter_italic", null, "must be true or false"],
  ])("rejects an unsupported %s value", (path, invalid, message) => {
    const document = createEmptyDocument("document-main", "Main");
    const value = editableValue() as unknown as Record<string, any>;
    const parts = path.split(".");
    const field = parts.pop()!;
    const owner = parts.reduce((entry, part) => entry[part], value);
    owner[field] = invalid;
    const result = parseDocumentSettingsCode(JSON.stringify(value), document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it("rejects unknown fields and bulk Nets outside the Cell", () => {
    const document = createEmptyDocument("document-main", "Main");
    const unknown = { ...editableValue(), extra: true };
    expect(
      parseDocumentSettingsCode(JSON.stringify(unknown), document),
    ).toEqual({
      ok: false,
      message: "properties.extra is not supported",
    });

    const missingNet = editableValue();
    missingNet.bulkDefaults.pmos = "net-missing";
    const parsed = parseDocumentSettingsCode(
      JSON.stringify(missingNet),
      document,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("VDD or name a Net");
  });

  it("resets appearance while preserving bulk and canvas choices", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-ground", terminals: [] });
    document.presentation.styleOverrides = { fontScale: 1.5 };
    document.mosBulkDefaults = { nmosNetId: "net-ground" };
    const changedCanvas: CanvasPreferenceCodeValue = {
      showGrid: false,
      annotationGrid: 10,
      drawAngle: "orthogonal",
      scrollBehavior: "zoom",
    };

    expect(
      JSON.parse(defaultDocumentSettingsCode(document, changedCanvas)),
    ).toEqual({
      ...editableValue(),
      bulkDefaults: { nmos: "net-ground", pmos: "VDD" },
      canvas: changedCanvas,
    });
  });

  it("offers inline choices for every bounded value and current Logical Net", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-ground", terminals: [] });
    const source = serializeDocumentSettingsCode(editableValue());
    const spans = documentSettingsCodeSpans(source, document);

    expect(spans).toHaveLength(16);
    expect(
      spans.find((span) => span.field.path === "appearance.fontScale")?.field
        .options,
    ).toContainEqual(
      expect.objectContaining({
        value: 1,
        label: "Default · 1×",
        preview: { kind: "scale", target: "font", factor: 1 },
      }),
    );
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.nmos")?.field,
    ).toMatchObject({
      label: "NMOS",
      help: "NMOS bulk defaults to VSS",
    });
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.nmos")?.field
        .options,
    ).toEqual([
      {
        value: "VSS",
        label: "VSS",
        preview: { kind: "bulk", device: "NMOS", rail: "VSS" },
      },
      {
        value: "net-ground",
        label: "net-ground",
        preview: { kind: "bulk", device: "NMOS", rail: "VSS" },
      },
    ]);
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.pmos")?.field,
    ).toMatchObject({
      label: "PMOS",
      help: "PMOS bulk defaults to VDD",
    });
    expect(
      spans.find((span) => span.field.path === "labels.subscript_case")?.field
        .options,
    ).toEqual([
      expect.objectContaining({
        value: "preserve",
        label: "Preserve typed case",
        preview: expect.objectContaining({ kind: "label", suffix: "inP" }),
      }),
      expect.objectContaining({
        value: "uppercase",
        label: "Make suffix uppercase",
        preview: expect.objectContaining({ kind: "label", suffix: "INP" }),
      }),
      expect.objectContaining({
        value: "lowercase",
        label: "Make suffix lowercase",
        preview: expect.objectContaining({ kind: "label", suffix: "inp" }),
      }),
    ]);
    expect(
      spans.every((span) =>
        span.field.options?.every((option) => option.preview !== undefined),
      ),
    ).toBe(true);
    expect(
      spans
        .filter((span) => span.field.path.startsWith("labels."))
        .map((span) => span.field.path),
    ).toEqual([
      "labels.first_letter_italic",
      "labels.subscript_after_first",
      "labels.subscript_case",
      "labels.subscript_italic",
      "labels.underscore_subscript",
    ]);
    expect(
      spans
        .filter((span) => span.field.path.startsWith("labels."))
        .every((span) => span.field.description === ""),
    ).toBe(true);

    const changed = applyChanges(
      source,
      documentSettingsCodeChanges(source, document, {
        "appearance.fontScale": 1.5,
        "bulkDefaults.nmos": "net-ground",
        "labels.subscript_case": "lowercase",
        "labels.subscript_italic": false,
        "canvas.showGrid": false,
      }),
    );
    expect(JSON.parse(changed)).toMatchObject({
      appearance: { fontScale: 1.5 },
      bulkDefaults: { nmos: "net-ground" },
      labels: { subscript_case: "lowercase", subscript_italic: false },
      canvas: { showGrid: false },
    });
  });

  it("does not offer a control edit that violates the canonical parser", () => {
    const document = createEmptyDocument("document-main", "Main");
    const source = serializeDocumentSettingsCode(editableValue());
    expect(
      documentSettingsCodeChanges(source, document, {
        "appearance.fontScale": 3,
      }),
    ).toEqual([]);
    expect(
      documentSettingsCodeChanges(source, document, {
        "bulkDefaults.nmos": "missing-net",
      }),
    ).toEqual([]);
    expect(
      documentSettingsCodeChanges(source.slice(0, -1), document, {
        "canvas.showGrid": false,
      }),
    ).toEqual([]);
  });
});
