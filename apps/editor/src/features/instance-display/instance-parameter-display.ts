import {
  defaultInstanceParameterLabelPlacement,
  displayableInstanceParameter,
  magneticDisplayParameters,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

type Instance = SchematicDocument["instances"][number];

function parameterAnnotations(
  document: SchematicDocument,
  instanceId: string,
  parameter: string,
) {
  return document.annotations.filter(
    (annotation) =>
      annotation.kind === "instance-value" &&
      annotation.binding?.kind === "instance-value" &&
      annotation.binding.instanceId === instanceId &&
      annotation.binding.parameter?.toLowerCase() === parameter.toLowerCase(),
  );
}

export function instanceParameterVisibility(
  document: SchematicDocument,
  instance: Instance,
): Record<string, boolean> {
  return Object.fromEntries(
    magneticDisplayParameters(instance.symbolId).map((parameter) => [
      parameter.name,
      parameterAnnotations(document, instance.id, parameter.name).some(
        (annotation) => annotation.visible !== false,
      ),
    ]),
  );
}

/** Toggle live bindings without replacing authored placement or text styling. */
export function instanceParameterVisibilityEdits(
  document: SchematicDocument,
  instance: Instance,
  resolver: SymbolResolver,
  desired: Readonly<Record<string, boolean>>,
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  for (const parameter of magneticDisplayParameters(instance.symbolId)) {
    const visible = desired[parameter.name];
    if (visible === undefined) continue;
    const existing = parameterAnnotations(
      document,
      instance.id,
      parameter.name,
    );
    const current = existing.some((annotation) => annotation.visible !== false);
    if (visible === current) continue;
    if (
      visible &&
      displayableInstanceParameter(instance, parameter.name).kind !==
        "displayable"
    ) {
      throw new Error(`Set ${parameter.label} before enabling its display`);
    }
    if (existing.length) {
      // Hide all matching projections; re-enable the first without making duplicates.
      for (const annotation of visible ? existing.slice(0, 1) : existing) {
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: { ...annotation, visible },
        });
      }
      continue;
    }
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const placement =
      resolved &&
      defaultInstanceParameterLabelPlacement(
        instance,
        resolved,
        resolveDocumentStyleProfile(document.presentation),
        document.presentation.grid,
        parameter.name,
      );
    if (!placement || !instance.placement)
      throw new Error("Place the component before showing its parameters");
    const baseId = `instance-parameter-${instance.id}-${parameter.name}`;
    let id = baseId;
    let suffix = 1;
    while (document.annotations.some((annotation) => annotation.id === id))
      id = `${baseId}-${suffix++}`;
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        id,
        kind: "instance-value",
        binding: {
          kind: "instance-value",
          instanceId: instance.id,
          parameter: parameter.name,
        },
        anchor: {
          kind: "object",
          objectId: instance.id,
          localOffset: {
            x: placement.position.x - instance.placement.position.x,
            y: placement.position.y - instance.placement.position.y,
          },
          fallbackPosition: placement.position,
        },
        alignment: placement.alignment,
        rotation: 0,
        locked: false,
        visible: true,
      },
    });
  }
  return edits;
}
