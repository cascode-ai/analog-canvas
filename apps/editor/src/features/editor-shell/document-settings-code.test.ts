import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import {
  defaultDocumentSettingsCode,
  documentSettingsCodeValue,
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
    bulkDefaults: { nmosNet: null, pmosNet: null },
    labels: {
      subscript_case: "preserve",
      subscript_italic: true,
      underscore_subscript: true,
      subscript_after_first: false,
      first_letter_italic: true,
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
    value.bulkDefaults.nmosNet = "net-ground";
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
    missingNet.bulkDefaults.pmosNet = "net-missing";
    const parsed = parseDocumentSettingsCode(
      JSON.stringify(missingNet),
      document,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.message).toContain("does not name a Net in this Cell");
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
      bulkDefaults: { nmosNet: "net-ground", pmosNet: null },
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
    ).toContainEqual({ value: 1, label: "Default · 1×" });
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.nmosNet")?.field,
    ).toMatchObject({
      label: "NMOS bulk Net (usually VSS)",
      help: expect.stringContaining("GND is correct only when it is also VSS"),
    });
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.nmosNet")?.field
        .options,
    ).toEqual([
      { value: null, label: "Not set · choose after VSS exists" },
      { value: "net-ground", label: "net-ground" },
    ]);
    expect(
      spans.find((span) => span.field.path === "bulkDefaults.pmosNet")?.field,
    ).toMatchObject({
      label: "PMOS bulk Net (usually VDD)",
      help: expect.stringContaining("highest supply Net"),
    });
    expect(
      spans.find((span) => span.field.path === "labels.subscript_case")?.field
        .options,
    ).toEqual([
      { value: "preserve", label: "Keep typed case" },
      { value: "uppercase", label: "UPPERCASE" },
      { value: "lowercase", label: "lowercase" },
    ]);

    const changed = applyChanges(
      source,
      documentSettingsCodeChanges(source, document, {
        "appearance.fontScale": 1.5,
        "bulkDefaults.nmosNet": "net-ground",
        "labels.subscript_case": "lowercase",
        "labels.subscript_italic": false,
        "canvas.showGrid": false,
      }),
    );
    expect(JSON.parse(changed)).toMatchObject({
      appearance: { fontScale: 1.5 },
      bulkDefaults: { nmosNet: "net-ground" },
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
        "bulkDefaults.nmosNet": "missing-net",
      }),
    ).toEqual([]);
    expect(
      documentSettingsCodeChanges(source.slice(0, -1), document, {
        "canvas.showGrid": false,
      }),
    ).toEqual([]);
  });
});
