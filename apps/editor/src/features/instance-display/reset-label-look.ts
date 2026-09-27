import type { SchematicEdit } from "@icm/edit-engine";
import { resolveAnnotationName } from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import {
  flattenRichText,
  labelRole,
  richTextWritesNotation,
  roleLabelFormat,
  sameStyledText,
  writtenNameLook,
  type Annotation,
  type CircuitProject,
  type DraftingObject,
  type SchematicDocument,
} from "@icm/model";

type DraftText = Extract<DraftingObject, { kind: "text" }>;

/**
 * Every label of a drawing back to its standard look, in one edit: the
 * default size, and each name in the form it is placed with — its first
 * letter in italic over an upright subscript (M₁, R_E1, V_in, V_DD, Φ₁). A
 * name with no standard form keeps any subscript or bar its format writes,
 * and a value loses any format of its own. A label written by hand — a part's own
 * words, such as a switch's Φ₁, or a free text such as a V_icm beside a Pin
 * — keeps its words and which of them are subscripts, and takes the same
 * italic and bold. Where a label sits, its color, and whether it shows stay
 * as they are; a locked label is left alone.
 */
export function resetLabelLookEdits(
  document: SchematicDocument,
  project?: Pick<CircuitProject, "componentDefinitions">,
): SchematicEdit[] {
  const labels = document.annotations.flatMap((annotation): SchematicEdit[] => {
    if (annotation.locked) return [];
    if (!annotation.binding) return writtenLabelEdits(annotation);
    const format = standardFormat(document, annotation, project);
    if (
      annotation.sizeScale === undefined &&
      JSON.stringify(annotation.formatOverride ?? null) ===
        JSON.stringify(format ?? null)
    )
      return [];
    const {
      sizeScale: _sizeScale,
      formatOverride: _formatOverride,
      ...rest
    } = annotation;
    return [
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...rest, ...(format ? { formatOverride: format } : {}) },
      },
    ];
  });
  const texts = (document.drafting?.objects ?? []).flatMap(
    (object): SchematicEdit[] =>
      object.kind === "text" ? writtenTextEdits(object) : [],
  );
  return [...labels, ...texts];
}

/** Whether a drawing has a label Reset labels may change. */
export function hasResettableLabels(document: SchematicDocument): boolean {
  return (
    document.annotations.some((annotation) => !annotation.locked) ||
    (document.drafting?.objects ?? []).some(
      (object) =>
        object.kind === "text" &&
        !object.locked &&
        object.typographyToken === "label",
    )
  );
}

/** A label shown as words of its own, not a bound name or value. */
function writtenLabelEdits(annotation: Annotation): SchematicEdit[] {
  const look = annotation.content && writtenNameLook(annotation.content);
  const restyled =
    look && !sameStyledText(look, annotation.content!) ? look : undefined;
  if (annotation.sizeScale === undefined && !restyled) return [];
  const { sizeScale: _sizeScale, ...rest } = annotation;
  return [
    {
      kind: "upsert_schematic_annotation",
      annotation: { ...rest, ...(restyled ? { content: restyled } : {}) },
    },
  ];
}

/**
 * A free text that names something the way a label does — letters over a
 * subscript — is a label written by hand: it takes the standard look and
 * sheds its own size, weight and slant. Other free text is left alone.
 */
function writtenTextEdits(object: DraftText): SchematicEdit[] {
  if (object.locked || object.typographyToken !== "label") return [];
  const look = writtenNameLook(object.content);
  if (!look) return [];
  const {
    sizeScale: _sizeScale,
    weight: _weight,
    italic: _italic,
    ...style
  } = object.styleOverride ?? {};
  const shedStyle =
    Object.keys(style).length !==
    Object.keys(object.styleOverride ?? {}).length;
  const restyled = !sameStyledText(look, object.content);
  if (!shedStyle && !restyled) return [];
  const { styleOverride: _styleOverride, ...rest } = object;
  return [
    {
      kind: "upsert_drafting_object",
      object: {
        ...rest,
        content: look,
        ...(Object.keys(style).length > 0 ? { styleOverride: style } : {}),
      },
    },
  ];
}

function standardFormat(
  document: SchematicDocument,
  annotation: Annotation,
  project?: Pick<CircuitProject, "componentDefinitions">,
) {
  const role = labelRole(annotation);
  const name = resolveAnnotationName(document, annotation).trim();
  if (!name) return undefined;
  const binding = annotation.binding;
  const symbolId =
    binding?.kind === "instance-reference"
      ? document.instances.find(
          (instance) => instance.id === binding.instanceId,
        )?.symbolId
      : undefined;
  const deviceLetter = symbolId
    ? referenceDeviceLetter(symbolId, project)
    : undefined;
  const standard = role
    ? roleLabelFormat(role, name, deviceLetter ? { deviceLetter } : {})
    : undefined;
  if (standard || binding?.kind === "instance-value") return standard;
  // A name the rules give no form sheds only its italic and bold. What its
  // format writes beyond them — a subscript (Q_A, V_in+), an inverting bar
  // (Φ̄, CLK̄) — is notation, kept as written.
  const format = annotation.formatOverride;
  if (!format || flattenRichText(format) !== name) return undefined;
  return (
    writtenNameLook(format) ??
    (richTextWritesNotation(format) ? format : undefined)
  );
}
