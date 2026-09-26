import {
  canonicalPortTextDocument,
  isRoleLabelFormat,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  legacyDefaultInstanceLabelPlacement,
  instanceLabelRowOffset,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";
import { draggedAnnotationAtPosition } from "../text-editing/annotation-drag-model";

/** Explicit one-pass operation, not a new placement default or autorouter. */
export function arrangeInstanceLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: {
    compact?: boolean | undefined;
    avoidCollisions?: boolean | undefined;
    referenceStyle?: "preserve" | "first-letter-subscript" | undefined;
  },
): SchematicEdit[] {
  const ids = new Set(instanceIds);
  for (const id of ids)
    if (!document.instances.some((i) => i.id === id))
      throw new Error(`Instance not found: ${id}`);
  const context = createLabelClearanceContext(document, resolver);
  const style = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const edits: SchematicEdit[] = [];
  for (const original of context.visible) {
    if (
      original.locked ||
      original.rotation !== 0 ||
      original.anchor.kind !== "object" ||
      !ids.has(original.anchor.objectId)
    )
      continue;
    const binding = original.binding;
    if (
      binding?.kind !== "instance-reference" &&
      binding?.kind !== "instance-value"
    )
      continue;
    const ownerId = original.anchor.objectId;
    const instance = document.instances.find((i) => i.id === ownerId)!;
    if (!instance.placement || binding.instanceId !== instance.id) continue;
    const reference = binding.kind === "instance-reference";
    if (
      original.content ||
      (original.formatOverride &&
        (!reference ||
          !isRoleLabelFormat(
            original.formatOverride,
            "device-reference",
            instance.reference ?? "",
          )))
    )
      continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const slot = reference ? "reference" : "value";
    const current = context.measure(original).position;
    const defaults = [
      defaultInstanceLabelPlacement,
      legacyDefaultInstanceLabelPlacement,
    ].map((place) =>
      place(instance, resolved, style, grid, slot, original.sizeScale ?? 1),
    );
    // Only a still-default visual slot is eligible. Manual/free anchors, styles,
    // and labels moved by an earlier pass remain under their author's control.
    if (
      !defaults.some(
        (p) =>
          p &&
          p.alignment === original.alignment &&
          Math.hypot(p.position.x - current.x, p.position.y - current.y) < 0.01,
      )
    )
      continue;
    let annotation = original;
    if (
      reference &&
      options.referenceStyle === "first-letter-subscript" &&
      /^[A-Za-z][A-Za-z0-9]+$/.test(instance.reference ?? "")
    )
      annotation = {
        ...annotation,
        formatOverride: canonicalPortTextDocument(instance.reference!),
      };
    const compact =
      options.compact !== false &&
      !reference &&
      !context.visible.some(
        (a) =>
          a.binding?.kind === "instance-reference" &&
          a.binding.instanceId === instance.id,
      );
    const preferred = defaultInstanceLabelPlacement(
      instance,
      resolved,
      style,
      grid,
      compact ? "reference" : slot,
      annotation.sizeScale ?? 1,
    )!;
    const at = (x: number, y: number): Annotation => ({
      ...draggedAnnotationAtPosition(
        { document, resolver, annotationGrid: 1, routeGeometryRecords: [] },
        annotation,
        { x, y },
      ),
      alignment: preferred.alignment,
    });
    let chosen = at(preferred.position.x, preferred.position.y);
    let score = context.conflicts(chosen).length;
    const row = instanceLabelRowOffset(style, grid);
    if (options.avoidCollisions !== false && score) {
      // Fixed local candidates; never wander arbitrarily far or move devices.
      for (const [dx, dy] of [
        [0, -row],
        [0, row],
        [-grid * 2, 0],
        [grid * 2, 0],
      ]) {
        const candidate = at(
          preferred.position.x + dx!,
          preferred.position.y + dy!,
        );
        const candidateScore = context.conflicts(candidate).length;
        if (candidateScore < score) {
          chosen = candidate;
          score = candidateScore;
        }
        if (!score) break;
      }
    }
    // Do not make a cramped original worse just to compact its rows.
    if (context.conflicts(original).length < score)
      chosen = {
        ...annotation,
        anchor: original.anchor,
        alignment: original.alignment,
      };
    if (JSON.stringify(chosen) !== JSON.stringify(original)) {
      edits.push({ kind: "upsert_schematic_annotation", annotation: chosen });
      context.accept(chosen);
    }
  }
  return edits;
}
