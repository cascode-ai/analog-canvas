import type { SchematicEdit } from "@icm/edit-engine";
import { resolveAnnotationName } from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import {
  labelRole,
  roleLabelFormat,
  type Annotation,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";

/**
 * Every label of a drawing back to its standard look, in one edit: the
 * default size, and each name in the form it is placed with — its first
 * letter in italic over an upright subscript (M₁, R_E1, V_in, V_DD). A value
 * loses any format of its own. Where a label sits, its color, and whether it
 * shows stay as they are; a locked label is left alone.
 */
export function resetLabelLookEdits(
  document: SchematicDocument,
  project?: Pick<CircuitProject, "componentDefinitions">,
): SchematicEdit[] {
  return document.annotations.flatMap((annotation): SchematicEdit[] => {
    if (!annotation.binding || annotation.locked) return [];
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
}

function standardFormat(
  document: SchematicDocument,
  annotation: Annotation,
  project?: Pick<CircuitProject, "componentDefinitions">,
) {
  const role = labelRole(annotation);
  if (!role) return undefined;
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
  return roleLabelFormat(role, name, deviceLetter ? { deviceLetter } : {});
}
