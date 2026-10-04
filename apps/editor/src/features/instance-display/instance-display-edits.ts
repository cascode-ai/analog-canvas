import {
  defaultInstanceLabelPlacement,
  objectStyleProfile,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { canonicalInstanceLabelRow } from "@icm/edit-engine";
import type { SchematicEdit } from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  defaultInstanceDisplayAnnotations,
  instanceLabelAnnotationFor,
} from "./default-instance-display";
import {
  defaultInstanceLabel,
  defaultInstanceValue,
  instanceValueAnnotation,
} from "../wiring/route-interaction-geometry";

/** Shared GUI/MCP visibility policy. Reuse authored projections, including
 * older free anchors, instead of creating a second label over them. */
export function instanceDisplayEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  display: {
    showReference?: boolean | undefined;
    showValue?: boolean | undefined;
  },
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  const style = resolveDocumentStyleProfile(document.presentation);
  for (const id of new Set(instanceIds)) {
    const instance = document.instances.find((item) => item.id === id);
    if (!instance?.placement) continue;
    const next = new Map<"reference" | "value", Annotation>();
    for (const field of ["reference", "value"] as const) {
      const visible =
        field === "reference" ? display.showReference : display.showValue;
      if (visible === undefined) continue;
      const bindingKind =
        field === "reference" ? "instance-reference" : "instance-value";
      const existing =
        (field === "reference"
          ? instanceLabelAnnotationFor(document, id)
          : instanceValueAnnotation(document, id)) ??
        document.annotations.find(
          (item) =>
            item.binding?.kind === bindingKind &&
            !(
              item.binding.kind === "instance-value" && item.binding.parameter
            ) &&
            "instanceId" in item.binding &&
            item.binding.instanceId === id,
        );
      let annotation: Annotation | null | undefined = existing;
      if (!annotation && visible) {
        // A Cell Pin shows its name, not a Reference it does not have.
        const terminal =
          field === "reference"
            ? document.netlist?.terminals.find((item) =>
                item.interfaceInstanceIds.includes(id),
              )
            : undefined;
        annotation = terminal
          ? (defaultInstanceDisplayAnnotations(
              document,
              instance,
              resolver,
              style,
              { formalTerminalId: terminal.id, formalName: terminal.name },
            )[0] ?? null)
          : field === "reference"
            ? defaultInstanceLabel(document, instance, resolver, style)
            : defaultInstanceValue(document, instance, resolver, style);
      }
      if (!annotation) continue;
      if (annotation.anchor.kind === "free") {
        const position = annotation.anchor.position;
        annotation = {
          ...annotation,
          anchor: {
            kind: "object",
            objectId: id,
            localOffset: {
              x: position.x - instance.placement.position.x,
              y: position.y - instance.placement.position.y,
            },
            fallbackPosition: position,
          },
        };
      }
      const { visible: _visible, ...rest } = annotation;
      next.set(field, visible ? rest : { ...rest, visible: false });
    }
    // A value, or a Cell's name, takes the Reference's slot while no
    // Reference is shown and gives it back when one is (#1105), so it never
    // hangs a row away from its part or prints over the Reference.
    const value = next.get("value") ?? instanceValueAnnotation(document, id);
    const reference =
      next.get("reference") ?? instanceLabelAnnotationFor(document, id);
    if (
      next.size &&
      value &&
      value.visible !== false &&
      (!reference || reference.kind === "instance-label")
    ) {
      const moved = valueInSlot(
        document,
        resolver,
        instance,
        value,
        reference && reference.visible !== false ? "value" : "reference",
      );
      if (moved) next.set("value", moved);
    }
    for (const annotation of next.values())
      edits.push({ kind: "upsert_schematic_annotation", annotation });
  }
  return edits;
}

/** The value label moved into `slot`, or null when it is there already or a
 * person placed it (an authored position is never pulled back). */
function valueInSlot(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: SchematicDocument["instances"][number],
  value: Annotation,
  slot: "reference" | "value",
): Annotation | null {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved || !instance.placement || value.anchor.kind !== "object")
    return null;
  const row = canonicalInstanceLabelRow(
    value,
    instance,
    resolved,
    document,
    instance.placement.position,
    instance.placement,
  );
  if (row === null || (row === 0) === (slot === "reference")) return null;
  const placement = defaultInstanceLabelPlacement(
    instance,
    resolved,
    objectStyleProfile(
      resolveDocumentStyleProfile(document.presentation),
      value,
    ),
    document.presentation.grid,
    slot,
    value.sizeScale ?? 1,
  );
  if (!placement) return null;
  return {
    ...value,
    alignment: placement.alignment,
    anchor: {
      ...value.anchor,
      localOffset: {
        x: placement.position.x - instance.placement.position.x,
        y: placement.position.y - instance.placement.position.y,
      },
      fallbackPosition: placement.position,
    },
  };
}
