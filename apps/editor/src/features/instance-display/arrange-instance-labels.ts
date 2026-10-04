import {
  canonicalPortTextDocument,
  isRoleLabelFormat,
  type Annotation,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  legacyDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  instanceLabelRowOffset,
  instanceValueRowOffset,
  objectStyleProfile,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  uniformRowDefaultInstanceLabelPlacement,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
} from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";
import { draggedAnnotationAtPosition } from "../text-editing/annotation-drag-model";

/** One instance label still in a default slot, eligible for this pass. */
interface EligibleLabel {
  readonly original: Annotation;
  /** The original, restyled when the pass changes the Reference's look. */
  readonly annotation: Annotation;
  readonly slot: "reference" | "value";
  /** A value shown without its Reference takes the Reference's slot. */
  readonly compact: boolean;
  readonly sizeScale: number;
}

const LOCAL_SIDES: readonly InstanceLabelSide[] = [
  "right",
  "left",
  "bottom",
  "top",
];

/**
 * Explicit one-pass operation, not a new placement default or autorouter.
 *
 * The labels of one part move as a group: the Reference and its value stay
 * together on one side of the part, in their default rows. When the default
 * side is crowded the group tries the part's other sides; a label left in
 * conflict then tries a few nearby positions. No candidate may cover another
 * label of the same part, so a value is never stacked onto its own Reference
 * however many other conflicts that would trade (#1307).
 */
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
  const documentProfile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const box = (annotation: Annotation): Rect =>
    context.measure(annotation).inkBounds;

  // Every visible Reference and value of the parts, eligible or not: a
  // label this pass may not move still takes its space from its siblings.
  const ownLabels = new Map<string, Annotation[]>();
  const groups = new Map<string, EligibleLabel[]>();
  for (const original of context.visible) {
    if (original.anchor.kind !== "object" || !ids.has(original.anchor.objectId))
      continue;
    const binding = original.binding;
    if (
      binding?.kind !== "instance-reference" &&
      binding?.kind !== "instance-value"
    )
      continue;
    const ownerId = original.anchor.objectId;
    ownLabels.set(ownerId, [...(ownLabels.get(ownerId) ?? []), original]);
    const eligible = eligibleLabel(original, ownerId);
    if (eligible)
      groups.set(ownerId, [...(groups.get(ownerId) ?? []), eligible]);
  }

  function eligibleLabel(
    original: Annotation,
    ownerId: string,
  ): EligibleLabel | null {
    const binding = original.binding;
    if (
      original.locked ||
      original.rotation !== 0 ||
      (binding?.kind !== "instance-reference" &&
        binding?.kind !== "instance-value")
    )
      return null;
    const instance = document.instances.find((i) => i.id === ownerId)!;
    if (!instance.placement || binding.instanceId !== instance.id) return null;
    const reference = binding.kind === "instance-reference";
    const deviceLetter = referenceDeviceLetter(instance.symbolId);
    if (
      original.content ||
      (original.formatOverride &&
        (!reference ||
          !isRoleLabelFormat(
            original.formatOverride,
            "device-reference",
            instance.reference ?? "",
            deviceLetter ? { deviceLetter } : {},
          )))
    )
      return null;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return null;
    const style = objectStyleProfile(documentProfile, original);
    const slot = reference ? "reference" : "value";
    const sizeScale = original.sizeScale ?? 1;
    const current = context.measure(original).position;
    // Only a still-default visual slot is eligible. Manual/free anchors,
    // styles, and labels moved by an earlier pass remain under their
    // author's control.
    if (
      ![
        defaultInstanceLabelPlacement,
        uniformRowDefaultInstanceLabelPlacement,
        previousDefaultInstanceLabelPlacement,
        legacyDefaultInstanceLabelPlacement,
      ].some((place) => {
        const p = place(instance, resolved, style, grid, slot, sizeScale);
        return (
          p &&
          p.alignment === original.alignment &&
          Math.hypot(p.position.x - current.x, p.position.y - current.y) < 0.01
        );
      })
    )
      return null;
    const annotation =
      reference &&
      options.referenceStyle === "first-letter-subscript" &&
      /^[A-Za-z][A-Za-z0-9]+$/.test(instance.reference ?? "")
        ? {
            ...original,
            formatOverride: canonicalPortTextDocument(instance.reference!),
          }
        : original;
    const compact =
      options.compact !== false &&
      !reference &&
      !context.visible.some(
        (a) =>
          a.binding?.kind === "instance-reference" &&
          a.binding.instanceId === instance.id,
      );
    return { original, annotation, slot, compact, sizeScale };
  }

  const edits: SchematicEdit[] = [];
  for (const [ownerId, group] of groups) {
    const instance = document.instances.find((i) => i.id === ownerId)!;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )!;
    const groupIds = new Set(group.map((label) => label.original.id));
    // Siblings this pass leaves where they are.
    const fixed = (ownLabels.get(ownerId) ?? []).filter(
      (label) => !groupIds.has(label.id),
    );
    const at = (
      label: EligibleLabel,
      placement: InstanceLabelPlacement,
    ): Annotation => ({
      ...draggedAnnotationAtPosition(
        { document, resolver, annotationGrid: 1, routeGeometryRecords: [] },
        label.annotation,
        placement.position,
      ),
      alignment: placement.alignment,
    });
    const styleOf = (label: EligibleLabel) =>
      objectStyleProfile(documentProfile, label.original);
    const rowOf = (label: EligibleLabel) =>
      label.slot === "value" && !label.compact
        ? instanceValueRowOffset(instance.symbolId, styleOf(label), grid)
        : 0;
    const covers = (a: Annotation, b: Annotation) => overlap(box(a), box(b));
    /** Conflicts of one label, counting its own siblings as disqualifying. */
    const score = (candidate: Annotation, siblings: readonly Annotation[]) =>
      siblings.some((sibling) => covers(candidate, sibling))
        ? Number.POSITIVE_INFINITY
        : context.conflicts(candidate).filter((id) => !groupIds.has(id)).length;
    const total = (arrangement: readonly Annotation[]) =>
      arrangement.reduce(
        (sum, candidate, index) =>
          sum +
          score(candidate, [
            ...fixed,
            ...arrangement.filter((_, other) => other !== index),
          ]),
        0,
      );

    // The default rows first, then the same rows on each other side.
    const preferred = group.map((label) =>
      at(
        label,
        defaultInstanceLabelPlacement(
          instance,
          resolved,
          styleOf(label),
          grid,
          label.compact ? "reference" : label.slot,
          label.sizeScale,
        )!,
      ),
    );
    let chosen = preferred;
    let best = total(preferred);
    if (options.avoidCollisions !== false && best > 0 && !fixed.length)
      for (const side of LOCAL_SIDES) {
        const arrangement: Annotation[] = [];
        for (const label of group) {
          const placement = placeUprightInstanceLabel(
            instance,
            resolved,
            styleOf(label),
            { x: 0, y: 0 },
            side,
            grid,
            label.sizeScale,
            rowOf(label),
          );
          if (!placement) break;
          arrangement.push(at(label, placement));
        }
        if (arrangement.length !== group.length) continue;
        const candidate = total(arrangement);
        if (candidate < best) {
          chosen = arrangement;
          best = candidate;
        }
        if (!best) break;
      }

    // A label still in conflict tries a few nearby positions; it never
    // wanders arbitrarily far, moves a device, or covers a sibling.
    if (options.avoidCollisions !== false && best > 0) {
      chosen = [...chosen];
      for (const [index, label] of group.entries()) {
        const siblings = () => [
          ...fixed,
          ...chosen.filter((_, other) => other !== index),
        ];
        let current = chosen[index]!;
        let currentScore = score(current, siblings());
        if (!currentScore) continue;
        const row = instanceLabelRowOffset(styleOf(label), grid);
        const position = context.measure(current).position;
        for (const [dx, dy] of [
          [0, -row],
          [0, row],
          [-grid * 2, 0],
          [grid * 2, 0],
        ] as const) {
          const candidate = at(label, {
            position: { x: position.x + dx, y: position.y + dy },
            alignment: current.alignment,
          });
          const candidateScore = score(candidate, siblings());
          if (candidateScore < currentScore) {
            current = candidate;
            currentScore = candidateScore;
          }
          if (!currentScore) break;
        }
        chosen[index] = current;
      }
    }

    // Do not make a cramped original worse just to compact its rows.
    const originals = group.map((label) => ({
      ...label.annotation,
      anchor: label.original.anchor,
      alignment: label.original.alignment,
    }));
    if (total(originals) < total(chosen)) chosen = originals;
    for (const [index, label] of group.entries()) {
      const next = chosen[index]!;
      if (JSON.stringify(next) === JSON.stringify(label.original)) continue;
      edits.push({ kind: "upsert_schematic_annotation", annotation: next });
      context.accept(next);
    }
  }
  return edits;
}

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
