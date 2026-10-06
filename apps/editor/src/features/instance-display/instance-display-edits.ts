import {
  defaultInstanceLabelPlacement,
  instanceValueRowOffset,
  objectStyleProfile,
  outwardPlaceUprightInstanceLabel,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
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

const SIDES: readonly InstanceLabelSide[] = ["right", "left", "bottom", "top"];

/**
 * A part's name and value moved as the group they stand in, for what now
 * shows (#1384): a value shown without its name takes the name's slot and
 * gives it back when the name shows, and above the part a name over its
 * value stands a row further out, coming down to the part when the value
 * hides. The group keeps its side and any slide along it, so labels an
 * arrangement put on another side move there: R_F's 10k, arranged above
 * the resistor, had stayed a row away from it when its name was hidden.
 * Null when the two do not stand as one group, as when a person moved
 * either; an empty map when nothing has to move.
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
  const documentStyle = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const rowOf = (label: Annotation) =>
    instanceValueRowOffset(
      instance.symbolId,
      objectStyleProfile(documentStyle, label),
      grid,
    );
  /** How far a label stands from `slot`: only along the side it is on. */
  const shiftFrom = (
    label: Annotation,
    slot: InstanceLabelPlacement | null,
  ) => {
    if (!slot || label.anchor.kind !== "object") return null;
    if (slot.alignment !== label.alignment) return null;
    const shift = {
      x: origin.x + label.anchor.localOffset.x - slot.position.x,
      y: origin.y + label.anchor.localOffset.y - slot.position.y,
    };
    return Math.abs(slot.alignment === "middle" ? shift.y : shift.x) < 0.01
      ? shift
      : null;
  };
  for (const side of SIDES) {
    const slot = (
      label: Annotation,
      rowOffset: number,
      rowsBelow: number,
      place = placeUprightInstanceLabel,
    ) =>
      place(
        instance,
        resolved,
        objectStyleProfile(documentStyle, label),
        { x: 0, y: 0 },
        side,
        grid,
        label.sizeScale ?? 1,
        rowOffset,
        false,
        rowsBelow,
      );
    const nameAlone = slot(name, 0, 0);
    const nameOver = slot(name, 0, rowOf(name));
    const valueAlone = slot(value, 0, 0);
    const valueUnder = slot(value, rowOf(value), 0);
    // Above the part an arrangement before #1384 stood the value over its
    // name.
    const valueOver = slot(
      value,
      rowOf(value),
      0,
      outwardPlaceUprightInstanceLabel,
    );
    for (const [nameSlot, valueSlot] of [
      [nameOver, valueUnder],
      [nameAlone, valueUnder],
      [nameAlone, valueAlone],
      [nameAlone, valueOver],
    ] as const) {
      const shift = shiftFrom(name, nameSlot);
      const valueShift = shiftFrom(value, valueSlot);
      if (
        !shift ||
        !valueShift ||
        Math.hypot(shift.x - valueShift.x, shift.y - valueShift.y) >= 0.01
      )
        continue;
      const moved = new Map<"reference" | "value", Annotation>();
      const seat = (
        field: "reference" | "value",
        label: Annotation,
        target: InstanceLabelPlacement | null,
      ) => {
        if (!target || label.anchor.kind !== "object") return;
        const position = {
          x: target.position.x + shift.x,
          y: target.position.y + shift.y,
        };
        const localOffset = {
          x: position.x - origin.x,
          y: position.y - origin.y,
        };
        if (
          target.alignment === label.alignment &&
          localOffset.x === label.anchor.localOffset.x &&
          localOffset.y === label.anchor.localOffset.y
        )
          return;
        moved.set(field, {
          ...label,
          alignment: target.alignment,
          anchor: { ...label.anchor, localOffset, fallbackPosition: position },
        });
      };
      const nameShows = name.visible !== false;
      const valueShows = value.visible !== false;
      if (nameShows) seat("reference", name, valueShows ? nameOver : nameAlone);
      if (valueShows) seat("value", value, nameShows ? valueUnder : valueAlone);
      return moved;
    }
  }
  return null;
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
