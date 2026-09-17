import type { SchematicDocument } from "@icm/model";

import { logicalNetChoices } from "../logical-net-choices";
import {
  propertyCodeSpans,
  type PropertyCodeSpan,
} from "../properties/component-property-code-assists";
import type { CanvasPropertyField } from "../properties/component-property-fields";
import { parseDocumentSettingsCode } from "./document-settings-code";
import { STYLE_KNOBS, STYLE_SCALE_OPTIONS } from "./style-knobs";

function fields(document: SchematicDocument): readonly CanvasPropertyField[] {
  const scaleOptions = STYLE_SCALE_OPTIONS.map((value) => ({
    value,
    label: value === 1 ? "Default · 1×" : `${value}×`,
  }));
  const netOptions = [
    { value: null, label: "None" },
    ...logicalNetChoices(document).map((choice) => ({
      value: choice.netId,
      label: choice.label,
    })),
  ];
  return [
    ...STYLE_KNOBS.map((knob): CanvasPropertyField => ({
      path: `appearance.${knob.key}`,
      label: knob.label,
      kind: "choice",
      options: scaleOptions,
      description: "",
      help: `${knob.label} scale from 0.5× to 2×`,
    })),
    {
      path: "bulkDefaults.nmosNet",
      label: "Default NMOS bulk Net",
      kind: "choice",
      options: netOptions,
      description: "",
      help: "Choose a Logical Net from the current Cell",
    },
    {
      path: "bulkDefaults.pmosNet",
      label: "Default PMOS bulk Net",
      kind: "choice",
      options: netOptions,
      description: "",
      help: "Choose a Logical Net from the current Cell",
    },
    {
      path: "canvas.showGrid",
      label: "Canvas grid",
      kind: "choice",
      options: [
        { value: true, label: "On" },
        { value: false, label: "Off" },
      ],
      description: "",
    },
    {
      path: "canvas.annotationGrid",
      label: "Annotation grid",
      kind: "choice",
      options: [1, 5, 10].map((value) => ({ value, label: String(value) })),
      description: "",
    },
    {
      path: "canvas.drawAngle",
      label: "Draw angle",
      kind: "choice",
      options: [
        { value: "free", label: "Free" },
        { value: "45", label: "45°" },
        { value: "orthogonal", label: "Orthogonal" },
      ],
      description: "",
    },
    {
      path: "canvas.scrollBehavior",
      label: "Scroll behavior",
      kind: "choice",
      options: [
        { value: "auto", label: "Auto" },
        { value: "zoom", label: "Zoom" },
        { value: "pan", label: "Pan" },
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
