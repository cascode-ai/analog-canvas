import type { SchematicDocument } from "@icm/model";

import { logicalNetChoices } from "../logical-net-choices";
import {
  propertyCodeSpans,
  type PropertyCodeSpan,
} from "../properties/component-property-code-assists";
import type {
  CanvasPropertyField,
  CanvasPropertyOptionPreview,
} from "../properties/component-property-fields";
import {
  mosBulkDefaultNetIdFromCode,
  parseDocumentSettingsCode,
} from "./document-settings-code";
import { STYLE_KNOBS, STYLE_SCALE_OPTIONS } from "./style-knobs";

function fields(document: SchematicDocument): readonly CanvasPropertyField[] {
  const labelPreview = (
    overrides: Partial<Extract<CanvasPropertyOptionPreview, { kind: "label" }>>,
  ): CanvasPropertyOptionPreview => ({
    kind: "label",
    first: "V",
    suffix: "in",
    firstItalic: true,
    suffixItalic: false,
    subscript: true,
    ...overrides,
  });
  const scaleTargets: Record<
    (typeof STYLE_KNOBS)[number]["key"],
    Extract<CanvasPropertyOptionPreview, { kind: "scale" }>["target"]
  > = {
    fontScale: "font",
    wireStrokeScale: "wire",
    symbolStrokeScale: "symbol",
    annotationStrokeScale: "drawing",
    junctionRadiusScale: "junction",
  };
  const scaleOptions = STYLE_SCALE_OPTIONS.map((value) => ({
    value,
    label: value === 1 ? "Default · 1×" : `${value}×`,
  }));
  const netOptions = (
    kind: "nmos" | "pmos",
    device: "NMOS" | "PMOS",
    rail: "VSS" | "VDD",
  ) => {
    const supplyNetId = mosBulkDefaultNetIdFromCode(document, kind, rail);
    return [
      {
        value: rail,
        label: rail,
        preview: { kind: "bulk", device, rail } as const,
      },
      ...logicalNetChoices(document)
        .filter((choice) => !choice.baseNetIds.includes(supplyNetId ?? ""))
        .map((choice) => ({
          value: choice.netId,
          label: choice.label,
          preview: { kind: "bulk", device, rail } as const,
        })),
    ];
  };
  return [
    {
      path: "labels.first_letter_italic",
      label: "First letter",
      kind: "choice",
      options: [
        {
          value: true,
          label: "Italic first letter",
          preview: labelPreview({ firstItalic: true }),
        },
        {
          value: false,
          label: "Upright first letter",
          preview: labelPreview({ firstItalic: false }),
        },
      ],
      description: "",
    },
    {
      path: "labels.subscript_after_first",
      label: "Subscript after first letter",
      kind: "choice",
      options: [
        {
          value: true,
          label: "Subscript after the first letter",
          preview: labelPreview({ subscript: true }),
        },
        {
          value: false,
          label: "Keep the suffix on the baseline",
          preview: labelPreview({ subscript: false }),
        },
      ],
      description: "",
    },
    {
      path: "labels.subscript_case",
      label: "Subscript case",
      kind: "choice",
      options: [
        {
          value: "preserve",
          label: "Preserve typed case",
          preview: labelPreview({ suffix: "inP" }),
        },
        {
          value: "uppercase",
          label: "Make suffix uppercase",
          preview: labelPreview({ suffix: "INP" }),
        },
        {
          value: "lowercase",
          label: "Make suffix lowercase",
          preview: labelPreview({ suffix: "inp" }),
        },
      ],
      description: "",
    },
    {
      path: "labels.subscript_italic",
      label: "Subscript style",
      kind: "choice",
      options: [
        {
          value: false,
          label: "Upright subscript",
          preview: labelPreview({ suffixItalic: false }),
        },
        {
          value: true,
          label: "Italic subscript",
          preview: labelPreview({ suffixItalic: true }),
        },
      ],
      description: "",
    },
    {
      path: "labels.underscore_subscript",
      label: "Underscore subscript",
      kind: "choice",
      options: [
        {
          value: true,
          label: "Convert underscore suffix to subscript",
          preview: labelPreview({ suffix: "in", subscript: true }),
        },
        {
          value: false,
          label: "Keep the typed underscore",
          preview: labelPreview({ suffix: "_in", subscript: false }),
        },
      ],
      description: "",
    },
    ...STYLE_KNOBS.map((knob): CanvasPropertyField => ({
      path: `appearance.${knob.key}`,
      label: knob.label,
      kind: "choice",
      options: scaleOptions.map((option) => ({
        ...option,
        preview: {
          kind: "scale",
          target: scaleTargets[knob.key],
          factor: option.value,
        },
      })),
      description: "",
      help: `${knob.label} scale from 0.5× to 2×`,
    })),
    {
      path: "bulkDefaults.nmos",
      label: "NMOS",
      kind: "choice",
      options: netOptions("nmos", "NMOS", "VSS"),
      description: "",
      help: "NMOS bulk defaults to VSS",
    },
    {
      path: "bulkDefaults.pmos",
      label: "PMOS",
      kind: "choice",
      options: netOptions("pmos", "PMOS", "VDD"),
      description: "",
      help: "PMOS bulk defaults to VDD",
    },
    {
      path: "canvas.showGrid",
      label: "Canvas grid",
      kind: "choice",
      options: [
        {
          value: true,
          label: "Grid on",
          preview: { kind: "grid", enabled: true, spacing: 5 },
        },
        {
          value: false,
          label: "Grid off",
          preview: { kind: "grid", enabled: false, spacing: 5 },
        },
      ],
      description: "",
    },
    {
      path: "canvas.annotationGrid",
      label: "Annotation grid",
      kind: "choice",
      options: ([1, 5, 10] as const).map((value) => ({
        value,
        label: `${value} unit${value === 1 ? "" : "s"}`,
        preview: { kind: "grid", enabled: true, spacing: value } as const,
      })),
      description: "",
    },
    {
      path: "canvas.drawAngle",
      label: "Draw angle",
      kind: "choice",
      options: [
        {
          value: "free",
          label: "Free angle",
          preview: { kind: "angle", mode: "free" },
        },
        {
          value: "45",
          label: "45° increments",
          preview: { kind: "angle", mode: "45" },
        },
        {
          value: "orthogonal",
          label: "Orthogonal only",
          preview: { kind: "angle", mode: "orthogonal" },
        },
      ],
      description: "",
    },
    {
      path: "canvas.scrollBehavior",
      label: "Scroll behavior",
      kind: "choice",
      options: [
        {
          value: "auto",
          label: "Auto · trackpad pans, wheel zooms",
          preview: { kind: "scroll", mode: "auto" },
        },
        {
          value: "zoom",
          label: "Always zoom",
          preview: { kind: "scroll", mode: "zoom" },
        },
        {
          value: "pan",
          label: "Always pan",
          preview: { kind: "scroll", mode: "pan" },
        },
      ],
      description: "",
    },
  ];
}

export function documentSettingsCodeSpans(
  source: string,
  document: SchematicDocument,
): PropertyCodeSpan[] {
  return propertyCodeSpans(source, undefined, fields(document));
}

/** Replace only selected JSON values; preserve all unrelated authored bytes. */
export function documentSettingsCodeChanges(
  source: string,
  document: SchematicDocument,
  values: Readonly<Record<string, unknown>>,
): readonly { from: number; to: number; insert: string }[] {
  try {
    JSON.parse(source);
  } catch {
    return [];
  }
  const spans = documentSettingsCodeSpans(source, document);
  const changes = Object.entries(values).map(([path, value]) => {
    const matches = spans.filter((item) => item.field.path === path);
    const span = matches.length === 1 ? matches[0] : undefined;
    return span
      ? { from: span.from, to: span.to, insert: JSON.stringify(value) }
      : null;
  });
  if (changes.some((change) => change === null)) return [];
  const sorted = changes
    .filter((change) => change !== null)
    .sort((left, right) => left.from - right.from);
  let candidate = source;
  for (const change of [...sorted].reverse())
    candidate =
      candidate.slice(0, change.from) +
      change.insert +
      candidate.slice(change.to);
  return parseDocumentSettingsCode(candidate, document).ok ? sorted : [];
}
