import { type SchematicDocument, type StyleOverrides } from "@icm/model";

import {
  logicalNetChoiceForNet,
  logicalNetChoices,
} from "../logical-net-choices";
import { STYLE_KNOBS, styleOverrideDraft } from "./style-knobs";

export interface CanvasPreferenceCodeValue {
  showGrid: boolean;
  annotationGrid: 1 | 5 | 10;
  drawAngle: "free" | "45" | "orthogonal";
  scrollBehavior: "auto" | "zoom" | "pan";
}

export interface DocumentSettingsCodeValue {
  appearance: Record<keyof StyleOverrides, number>;
  bulkDefaults: {
    nmosNet: string | null;
    pmosNet: string | null;
  };
  labels: {
    subscript_case: "preserve" | "uppercase" | "lowercase";
    subscript_italic: boolean;
    underscore_subscript: boolean;
    subscript_after_first: boolean;
    first_letter_italic: boolean;
  };
  canvas: CanvasPreferenceCodeValue;
}

export type DocumentSettingsCodeParseResult =
  | { ok: true; value: DocumentSettingsCodeValue }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): string | null {
  const allowed = new Set(expected);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) return `${path}.${extra} is not supported`;
  const missing = expected.find((key) => !(key in value));
  return missing ? `${path}.${missing} is required` : null;
}

/** The sole copyable code surface for Document-wide and editor preferences. */
export function documentSettingsCodeValue(
  document: SchematicDocument,
  canvas: CanvasPreferenceCodeValue,
): DocumentSettingsCodeValue {
  const netChoices = logicalNetChoices(document);
  return {
    appearance: styleOverrideDraft(document.presentation.styleOverrides),
    bulkDefaults: {
      nmosNet:
        logicalNetChoiceForNet(netChoices, document.mosBulkDefaults?.nmosNetId)
          ?.netId ?? null,
      pmosNet:
        logicalNetChoiceForNet(netChoices, document.mosBulkDefaults?.pmosNetId)
          ?.netId ?? null,
    },
    labels: {
      subscript_case: document.presentation.labelSubscriptCase ?? "preserve",
      subscript_italic: document.presentation.labelSubscriptItalic ?? true,
      underscore_subscript:
        document.presentation.labelUnderscoreSubscript ?? true,
      subscript_after_first:
        document.presentation.labelSubscriptAfterFirst ?? false,
      first_letter_italic: document.presentation.labelFirstLetterItalic ?? true,
    },
    canvas,
  };
}

export function serializeDocumentSettingsCode(
  value: DocumentSettingsCodeValue,
): string {
  return JSON.stringify(value, null, 2);
}

export function formatDocumentSettingsCode(
  document: SchematicDocument,
  canvas: CanvasPreferenceCodeValue,
): string {
  return serializeDocumentSettingsCode(
    documentSettingsCodeValue(document, canvas),
  );
}

export function defaultDocumentSettingsCode(
  document: SchematicDocument,
  canvas: CanvasPreferenceCodeValue,
): string {
  const current = documentSettingsCodeValue(document, canvas);
  return serializeDocumentSettingsCode({
    ...current,
    appearance: Object.fromEntries(
      STYLE_KNOBS.map((knob) => [knob.key, 1]),
    ) as DocumentSettingsCodeValue["appearance"],
    labels: {
      subscript_case: "preserve",
      subscript_italic: true,
      underscore_subscript: true,
      subscript_after_first: false,
      first_letter_italic: true,
    },
  });
}

export function parseDocumentSettingsCode(
  source: string,
  document: SchematicDocument,
): DocumentSettingsCodeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, message: "Properties code must be valid JSON" };
  }
  if (!isRecord(raw))
    return { ok: false, message: "Properties code must be an object" };
  const rootError = exactKeys(
    raw,
    [
      "appearance",
      "bulkDefaults",
      "canvas",
      ...(raw.labels !== undefined ? ["labels"] : []),
    ],
    "properties",
  );
  if (rootError) return { ok: false, message: rootError };

  if (!isRecord(raw.appearance))
    return { ok: false, message: "appearance must be an object" };
  const appearanceKeys = STYLE_KNOBS.map((knob) => knob.key);
  const appearanceError = exactKeys(
    raw.appearance,
    appearanceKeys,
    "appearance",
  );
  if (appearanceError) return { ok: false, message: appearanceError };
  const appearance = {} as DocumentSettingsCodeValue["appearance"];
  for (const key of appearanceKeys) {
    const factor = raw.appearance[key];
    if (
      typeof factor !== "number" ||
      !Number.isFinite(factor) ||
      factor < 0.5 ||
      factor > 2
    ) {
      return {
        ok: false,
        message: `appearance.${key} must be a number from 0.5 to 2`,
      };
    }
    appearance[key] = factor;
  }

  if (!isRecord(raw.bulkDefaults))
    return { ok: false, message: "bulkDefaults must be an object" };
  const bulkError = exactKeys(
    raw.bulkDefaults,
    ["nmosNet", "pmosNet"],
    "bulkDefaults",
  );
  if (bulkError) return { ok: false, message: bulkError };
  const validNetIds = new Set(
    logicalNetChoices(document).map((net) => net.netId),
  );
  const bulkDefaults = {} as DocumentSettingsCodeValue["bulkDefaults"];
  for (const [field, value] of Object.entries(raw.bulkDefaults)) {
    if (value !== null && typeof value !== "string") {
      return {
        ok: false,
        message: `bulkDefaults.${field} must be a Net id or null`,
      };
    }
    if (typeof value === "string" && !validNetIds.has(value)) {
      return {
        ok: false,
        message: `bulkDefaults.${field} does not name a Net in this Cell`,
      };
    }
    bulkDefaults[field as keyof typeof bulkDefaults] = value as string | null;
  }

  const labels = raw.labels ?? {
    subscript_case: document.presentation.labelSubscriptCase ?? "preserve",
    subscript_italic: document.presentation.labelSubscriptItalic ?? true,
    underscore_subscript:
      document.presentation.labelUnderscoreSubscript ?? true,
    subscript_after_first:
      document.presentation.labelSubscriptAfterFirst ?? false,
    first_letter_italic: document.presentation.labelFirstLetterItalic ?? true,
  };
  if (!isRecord(labels))
    return { ok: false, message: "labels must be an object" };
  const labelError = exactKeys(
    labels,
    [
      "subscript_case",
      "subscript_italic",
      ...[
        "underscore_subscript",
        "subscript_after_first",
        "first_letter_italic",
      ].filter((key) => key in labels),
    ],
    "labels",
  );
  if (labelError) return { ok: false, message: labelError };
  if (
    !["preserve", "uppercase", "lowercase"].includes(
      labels.subscript_case as string,
    )
  )
    return {
      ok: false,
      message:
        'labels.subscript_case must be "preserve", "uppercase", or "lowercase"',
    };

  if (typeof labels.subscript_italic !== "boolean")
    return {
      ok: false,
      message: "labels.subscript_italic must be true or false",
    };

  for (const key of [
    "underscore_subscript",
    "subscript_after_first",
    "first_letter_italic",
  ] as const) {
    if (labels[key] !== undefined && typeof labels[key] !== "boolean")
      return { ok: false, message: `labels.${key} must be true or false` };
  }

  if (!isRecord(raw.canvas))
    return { ok: false, message: "canvas must be an object" };
  const canvasError = exactKeys(
    raw.canvas,
    ["showGrid", "annotationGrid", "drawAngle", "scrollBehavior"],
    "canvas",
  );
  if (canvasError) return { ok: false, message: canvasError };
  if (typeof raw.canvas.showGrid !== "boolean")
    return { ok: false, message: "canvas.showGrid must be true or false" };
  if (![1, 5, 10].includes(raw.canvas.annotationGrid as number))
    return { ok: false, message: "canvas.annotationGrid must be 1, 5, or 10" };
  if (!["free", "45", "orthogonal"].includes(raw.canvas.drawAngle as string))
    return {
      ok: false,
      message: 'canvas.drawAngle must be "free", "45", or "orthogonal"',
    };
  if (!["auto", "zoom", "pan"].includes(raw.canvas.scrollBehavior as string))
    return {
      ok: false,
      message: 'canvas.scrollBehavior must be "auto", "zoom", or "pan"',
    };

  return {
    ok: true,
    value: {
      appearance,
      bulkDefaults,
      labels: {
        subscript_case: labels.subscript_case,
        subscript_italic: labels.subscript_italic,
        underscore_subscript:
          labels.underscore_subscript ??
          document.presentation.labelUnderscoreSubscript ??
          true,
        subscript_after_first:
          labels.subscript_after_first ??
          document.presentation.labelSubscriptAfterFirst ??
          false,
        first_letter_italic:
          labels.first_letter_italic ??
          document.presentation.labelFirstLetterItalic ??
          true,
      } as DocumentSettingsCodeValue["labels"],
      canvas: raw.canvas as unknown as CanvasPreferenceCodeValue,
    },
  };
}
