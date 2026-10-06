import {
  defaultInstanceLabelPlacement,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  objectStyleProfile,
  offsetFromPlacement,
  resolveDocumentStyleProfile,
  seatedInstanceLabelGroup,
} from "@icm/derived";
import {
  canonicalInstanceLabelRow,
  instanceValueAnnotation,
} from "@icm/edit-engine";
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
      (!reference || reference.kind === "instance-label")
    ) {
      const regroup = (label: Annotation) =>
        reference
          ? regroupedLabels(document, resolver, instance, reference, label)
          : null;
      // A value an earlier rule left in its slot is moved by that rule's
      // slots, and then stands with its name as a group.
      let regrouped = regroup(value);
      if (!regrouped && value.visible !== false) {
        const moved = valueInSlot(
          document,
          resolver,
          instance,
          value,
          reference && reference.visible !== false ? "value" : "reference",
        );
        if (moved) {
          next.set("value", moved);
          regrouped = regroup(moved);
        }
      }
      for (const [field, annotation] of regrouped ?? [])
        next.set(field, annotation);
    }
    for (const annotation of next.values())
      edits.push({ kind: "upsert_schematic_annotation", annotation });
  }
  return edits;
}

/**
 * A part's name and value seated as the group they stand in, for what shows
 * (#1384): a value shown without its name takes the name's slot and goes
 * back under it when the name shows, and above the part a name over a shown
 * value stands a row further out and comes down to the part when the value
 * hides. The group keeps its side and any slide along it, so labels an
 * arrangement put on another side stay on it. Null when the two do not
 * stand as one group, as when a person moved either; otherwise the labels
 * that move.
 */
function regroupedLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: SchematicDocument["instances"][number],
  name: Annotation,
  value: Annotation,
): Map<"reference" | "value", Annotation> | null {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const origin = instance.placement?.position;
  if (!resolved || !origin || name.rotation !== 0 || value.rotation !== 0)
    return null;
  const nameLabel = instanceGroupLabel(document, name, origin);
  const valueLabel = instanceGroupLabel(document, value, origin);
  if (!nameLabel || !valueLabel) return null;
  const grid = document.presentation.grid;
  const seat = instanceLabelGroupSeat(
    instance,
    resolved,
    grid,
    nameLabel,
    valueLabel,
  );
  const seated =
    seat &&
    seatedInstanceLabelGroup(
      instance,
      resolved,
      grid,
      seat,
      nameLabel,
      valueLabel,
    );
  if (!seated) return null;
  const moved = new Map<"reference" | "value", Annotation>();
  for (const [field, label, drawn, target] of [
    ["reference", name, nameLabel, seated.name],
    ["value", value, valueLabel, seated.value],
  ] as const) {
    if (label.anchor.kind !== "object" || offsetFromPlacement(drawn, target))
      continue;
    moved.set(field, {
      ...label,
      alignment: target.alignment,
      anchor: {
        ...label.anchor,
        localOffset: {
          x: target.position.x - origin.x,
          y: target.position.y - origin.y,
        },
        fallbackPosition: target.position,
      },
    });
  }
  return moved;
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
