import {
  canonicalPortTextDocument,
  isAutomaticPinLabelLook,
  isRoleLabelFormat,
  roleLabelFormat,
  routeEndpoints,
  type Annotation,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  INSTANCE_LABEL_SIDES,
  legacyDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  instanceLabelRowOffset,
  isVisibleEndpoint,
  objectStyleProfile,
  offsetFromPlacement,
  outwardDefaultInstanceLabelPlacement,
  placeUprightInstanceLabel,
  portLabelCandidates,
  resolveAnnotationName,
  resolveDocumentStyleProfile,
  resolveEndpointPoint,
  uniformRowDefaultInstanceLabelPlacement,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
  type InstanceLabelSlot,
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

/** Where the current and every earlier rule put an untouched label. */
const DEFAULT_RULES: readonly (typeof defaultInstanceLabelPlacement)[] = [
  defaultInstanceLabelPlacement,
  outwardDefaultInstanceLabelPlacement,
  uniformRowDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  legacyDefaultInstanceLabelPlacement,
];

/**
 * Where an untouched label of either slot stands in a default rule's rows:
 * a name alone or over its value, or a value under its name.
 */
const DEFAULT_SLOTS: Readonly<
  Record<"reference" | "value", readonly InstanceLabelSlot[]>
> = {
  reference: ["reference", "reference-over-value"],
  value: ["value"],
};

/** A label the pass left where it is, and why (#1414). */
export interface LabelLeftInPlace {
  labelId: string;
  instanceId: string;
  reason: "locked" | "rotated" | "custom" | "moved";
}

/**
 * Explicit one-pass operation, not a new placement default or autorouter.
 *
 * The labels of one part move as a group: the Reference and its value stay
 * together on one side of the part, in their default rows, the name read
 * first and its value under it on every side (#1384). When the default
 * side is crowded the group tries the part's other sides; a label left in
 * conflict then tries a few nearby positions. No candidate may cover another
 * label of the same part, so a value is never stacked onto its own Reference
 * however many other conflicts that would trade (#1307).
 */
export function arrangeInstanceLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: ArrangeInstanceLabelsOptions,
): SchematicEdit[] {
  return arrangeInstanceLabelsReport(document, resolver, instanceIds, options)
    .edits;
}

export interface ArrangeInstanceLabelsOptions {
  compact?: boolean | undefined;
  avoidCollisions?: boolean | undefined;
  referenceStyle?: "preserve" | "first-letter-subscript" | undefined;
  /** Re-place labels moved by hand too; locked and custom ones stay. */
  includeManual?: boolean | undefined;
}

/** The arrangement, and the labels it leaves where they are (#1414). */
export function arrangeInstanceLabelsReport(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: ArrangeInstanceLabelsOptions,
): { edits: SchematicEdit[]; leftInPlace: LabelLeftInPlace[] } {
  const left: LabelLeftInPlace[] = [];
  const ids = new Set(instanceIds);
  for (const id of ids)
    if (!document.instances.some((i) => i.id === id))
      throw new Error(`Instance not found: ${id}`);
  const context = createLabelClearanceContext(document, resolver);
  const documentProfile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const box = (annotation: Annotation): Rect =>
    context.measure(annotation).inkBounds;
  // Each visible part name or value: the part it labels, and which it is.
  const partLabels = new Map(
    context.visible.flatMap((label) => {
      const part = partLabelOf(label, context.visible);
      return part ? [[label.id, part] as const] : [];
    }),
  );
  // The part, or Pin, each visible label belongs to.
  const owners = new Map(
    context.visible.flatMap((label) => {
      const owner =
        partLabels.get(label.id)?.instanceId ??
        (label.anchor.kind === "object" ? label.anchor.objectId : undefined);
      return owner ? [[label.id, owner] as const] : [];
    }),
  );
  /** Whether `ink` stands in a row with a label of one of `parts`. */
  const inRowWith = (ink: Rect, parts: ReadonlySet<string>) =>
    context.visible.some((other) => {
      const theirs = parts.has(owners.get(other.id) ?? "")
        ? context.labelBounds(other.id)
        : undefined;
      return theirs !== undefined && sameRow(ink, theirs);
    });

  /**
   * The parts wired to a two-terminal part drawn along a horizontal wire,
   * a ladder's series inductor: both its pins on one row and wired on to
   * other parts. Null for any other part.
   */
  const lineNeighbours = (instanceId: string): ReadonlySet<string> | null => {
    const instance = document.instances.find((item) => item.id === instanceId);
    // Its drawn pins, where the canvas puts them (a resized block's too).
    const pins = instance?.placement
      ? (
          resolver.resolve(instance.symbolId, instance.symbolVariantId)
            ?.definition.pins ?? []
        ).flatMap((pin) => {
          const endpoint = {
            kind: "terminal" as const,
            instanceId,
            pinName: pin.name,
          };
          const at =
            isVisibleEndpoint(document, resolver, endpoint) &&
            resolveEndpointPoint(document, resolver, endpoint);
          return at ? [{ name: pin.name, at }] : [];
        })
      : [];
    if (pins.length !== 2 || pins[0]!.at.y !== pins[1]!.at.y) return null;
    const nets = document.nets.filter((net) =>
      net.terminals.some((end) => end.instanceId === instanceId),
    );
    const wiredOn = (pinName: string) =>
      nets.some(
        (net) =>
          net.terminals.some(
            (end) => end.instanceId === instanceId && end.pinName === pinName,
          ) && net.terminals.some((end) => end.instanceId !== instanceId),
      );
    if (!pins.every((pin) => wiredOn(pin.name))) return null;
    return new Set(
      nets
        .flatMap((net) => net.terminals.map((end) => end.instanceId))
        .filter((id) => id !== instanceId),
    );
  };

  /**
   * A part's name and value standing exactly where the outward placer
   * stacks a group above the part, the value over the name: an earlier
   * arrangement put them there, so this pass takes them up and puts the
   * name first. Labels anywhere else there count as placed by hand.
   */
  const valueFirstGroups = new Map<string, ReadonlySet<string>>();
  const stackedValueFirst = (instanceId: string): ReadonlySet<string> => {
    const known = valueFirstGroups.get(instanceId);
    if (known) return known;
    const instance = document.instances.find((i) => i.id === instanceId);
    const resolved =
      instance && resolver.resolve(instance.symbolId, instance.symbolVariantId);
    const labelOf = (kind: "instance-reference" | "instance-value") =>
      context.visible.find((label) => {
        const part = partLabels.get(label.id);
        return part?.instanceId === instanceId && part.kind === kind;
      });
    const name = labelOf("instance-reference");
    const value = labelOf("instance-value");
    const origin = instance?.placement?.position;
    const nameLabel =
      origin && name && instanceGroupLabel(document, name, origin);
    const valueLabel =
      origin && value && instanceGroupLabel(document, value, origin);
    const stacked =
      instance &&
      resolved &&
      nameLabel &&
      valueLabel &&
      instanceLabelGroupSeat(instance, resolved, grid, nameLabel, valueLabel, {
        stacks: "value-over-name",
        slides: false,
      });
    const ids: ReadonlySet<string> =
      stacked && name && value ? new Set([name.id, value.id]) : new Set();
    valueFirstGroups.set(instanceId, ids);
    return ids;
  };

  // Every visible Reference and value of the parts, eligible or not: a
  // label this pass may not move still takes its space from its siblings.
  const ownLabels = new Map<string, Annotation[]>();
  const groups = new Map<string, EligibleLabel[]>();
  for (const original of context.visible) {
    if (original.anchor.kind !== "object" || !ids.has(original.anchor.objectId))
      continue;
    if (!partLabels.has(original.id)) continue;
    const ownerId = original.anchor.objectId;
    const eligible = eligibleLabel(original, ownerId);
    // A Cell's name moved by hand stays out of its part's group, as it was
    // before Cell names were arranged: it still takes its space as another
    // label, but does not hold the Reference to its side.
    if (!eligible && isCellNameLabel(original)) continue;
    ownLabels.set(ownerId, [...(ownLabels.get(ownerId) ?? []), original]);
    if (eligible)
      groups.set(ownerId, [...(groups.get(ownerId) ?? []), eligible]);
  }

  function eligibleLabel(
    original: Annotation,
    ownerId: string,
  ): EligibleLabel | null {
    const part = partLabels.get(original.id);
    const leave = (reason: LabelLeftInPlace["reason"]) => {
      left.push({ labelId: original.id, instanceId: ownerId, reason });
      return null;
    };
    if (!part) return null;
    if (original.locked) return leave("locked");
    if (original.rotation !== 0) return leave("rotated");
    const instance = document.instances.find((i) => i.id === ownerId)!;
    if (!instance.placement || part.instanceId !== instance.id) return null;
    const reference = part.kind === "instance-reference";
    // A placed Cell's name is literal text; nothing restyles it.
    const cellName = isCellNameLabel(original);
    const deviceLetter = referenceDeviceLetter(instance.symbolId);
    if (
      (original.content && !cellName) ||
      (original.formatOverride &&
        (!reference ||
          !isRoleLabelFormat(
            original.formatOverride,
            "device-reference",
            instance.reference ?? "",
            deviceLetter ? { deviceLetter } : {},
          )))
    )
      return leave("custom");
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return null;
    const style = objectStyleProfile(documentProfile, original);
    const slot = reference ? "reference" : "value";
    const sizeScale = original.sizeScale ?? 1;
    const current = context.measure(original).position;
    // A value shown without its Reference stands in the Reference's slot, as
    // a value-only part is placed and as the edit engine reads it (#1370):
    // one there with a wire through it was never moved.
    const alone =
      !reference &&
      !context.visible.some(
        (a) =>
          a.binding?.kind === "instance-reference" &&
          a.binding.instanceId === instance.id,
      );
    // Only a still-default visual slot is eligible, or a group standing
    // exactly where an earlier arrangement stacked a value over its name
    // above the part. Manual/free anchors, styles, and labels otherwise
    // moved by an earlier pass remain under their author's control.
    const drawn = { position: current, alignment: original.alignment };
    const at = (inSlot: "reference" | "value") =>
      DEFAULT_RULES.some((place) =>
        DEFAULT_SLOTS[inSlot].some((placeSlot) =>
          offsetFromPlacement(
            drawn,
            place(instance, resolved, style, grid, placeSlot, sizeScale),
          ),
        ),
      );
    // Above the part a lone value's row is also the Reference's slot.
    const inReferenceSlot = alone && at("reference");
    const inValueRow =
      !inReferenceSlot &&
      (at(slot) ||
        stackedValueFirst(instance.id).has(original.id) ||
        options.includeManual === true);
    if (!inValueRow && !inReferenceSlot) return leave("moved");
    const annotation =
      reference &&
      !cellName &&
      options.referenceStyle === "first-letter-subscript" &&
      /^[A-Za-z][A-Za-z0-9]+$/.test(instance.reference ?? "")
        ? {
            ...original,
            formatOverride: canonicalPortTextDocument(instance.reference!),
          }
        : original;
    // One already in its Reference's slot keeps that row, compact or not.
    const compact = alone && (options.compact !== false || inReferenceSlot);
    return { original, annotation, slot, compact, sizeScale };
  }

  const edits: SchematicEdit[] = [];
  // Parts drawn along a horizontal wire are arranged first: where their
  // labels go above the wire, their neighbours' labels keep their own side.
  const along = new Map(
    [...groups.keys()].map((id) => [id, lineNeighbours(id)] as const),
  );
  const order = [...groups].sort(
    ([a], [b]) => Number(along.get(b) !== null) - Number(along.get(a) !== null),
  );
  for (const [ownerId, group] of order) {
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
    /**
     * The slot a label takes in its group: a value under its name, a name
     * over a value moved with it, and a label alone in the Reference's slot.
     * Above the part the value takes the row nearest it and its name stands
     * a row further out, so the group reads name first there too (#1384).
     */
    const slotOf = (label: EligibleLabel): InstanceLabelSlot =>
      label.compact
        ? "reference"
        : label.slot === "value"
          ? "value"
          : group.some((other) => other.slot === "value" && !other.compact)
            ? "reference-over-value"
            : "reference";
    const covers = (a: Annotation, b: Annotation) => overlap(box(a), box(b));
    const owner = context.symbols.find((s) => s.id === instance.id)?.bounds;
    const ownWires = document.routes
      .filter((route) =>
        routeEndpoints(route).some(
          (end) => end.kind === "terminal" && end.instanceId === instance.id,
        ),
      )
      .map((route) => route.id);
    /**
     * Half a conflict for a label nearer another part than its own by more
     * than a few units: it reads as that part's. A DAC unit's switch, M3,
     * had its W/L arranged two rows above it, beside the cascode M2.
     */
    const strayed = (ink: Rect) => {
      if (!owner) return 0;
      const own = rectangleGap(ink, owner);
      return context.symbols.some(
        (symbol) =>
          symbol.id !== instance.id &&
          rectangleGap(ink, symbol.bounds) + ASSOCIATION_MARGIN < own,
      )
        ? 0.5
        : 0;
    };
    /**
     * Half a conflict for a value that follows another part's name about as
     * closely as it stands by its own part and labels, or a name that such a
     * value follows. Labels are read in groups, a name and then its value
     * below it or after it on its line, wherever the parts are. A Pierce
     * oscillator's inductor stacked its 10m above its name, 5 units under the
     * inverter's X₁ and 4 above its own L_m, and read as X₁'s (#1347). A
     * value above another part's name, as in a column of transistors each
     * with its name over its W/L, still reads as its own, and so do two
     * names or two values side by side.
     */
    const mistaken = (
      ink: Rect,
      label: Annotation,
      siblings: readonly Rect[],
    ) => {
      const kind = partLabels.get(label.id)?.kind;
      const own = Math.min(
        owner ? rectangleGap(ink, owner) : Number.POSITIVE_INFINITY,
        ...siblings.map((sibling) => rectangleGap(ink, sibling)),
      );
      if (!kind || !Number.isFinite(own)) return 0;
      return context
        .labelsWithin(ink, label.id, own + ASSOCIATION_MARGIN)
        .some((id) => {
          const other = partLabels.get(id);
          if (!other || other.instanceId === instance.id || other.kind === kind)
            return false;
          const theirs = context.labelBounds(id)!;
          return kind === "instance-value"
            ? readsAfter(theirs, ink)
            : readsAfter(ink, theirs);
        })
        ? 0.5
        : 0;
    };
    /**
     * Other parts' labels a label would run into on its row: under about a
     * character apart, though past the word's space every label keeps. A
     * ladder's 637pF a character before the next capacitor's 197pF read as
     * one run, and C₁ before L1's 31.8nH (#1412). Each counts as a conflict,
     * leaving out those `counted` already.
     */
    const runsInto = (
      ink: Rect,
      label: Annotation,
      counted: readonly string[],
    ) =>
      context
        .labelsWithin(
          ink,
          label.id,
          objectStyleProfile(documentProfile, label).typography
            .instanceFontSize *
            (label.sizeScale ?? 1) *
            CHARACTER_EM,
        )
        .filter((id) => {
          const part = owners.get(id);
          const theirs = context.labelBounds(id);
          return (
            part !== undefined &&
            part !== instance.id &&
            !counted.includes(id) &&
            theirs !== undefined &&
            sameRow(ink, theirs)
          );
        }).length;
    /**
     * Wires between a label and its part, other than those drawn across the
     * label, which count already. Above a VDD rail, a PMOS's W/L met
     * nothing, but the rail cut it off from its transistor below. Each counts
     * half a conflict, as does a wire between a part's own labels: worse
     * than a clear place, better than text struck through by a wire.
     */
    const cutOff = (ink: Rect) => {
      if (!owner) return 0;
      const centre = { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 };
      const nearest = {
        x: Math.min(Math.max(centre.x, owner.x), owner.x + owner.width),
        y: Math.min(Math.max(centre.y, owner.y), owner.y + owner.height),
      };
      const across = context.wiresAt(ink);
      return (
        context.crossings(centre, nearest).filter((id) => !across.includes(id))
          .length / 2
      );
    };
    /**
     * Wires that pass between a part's own labels and cross none of them.
     * A wire just above a resistor's Reference row let its labels slide to
     * either side of it, the name above the wire and the value below. The
     * part's own wires may: a transistor's name above its gate lead and its
     * W/L below still read as one.
     */
    const between = (boxes: readonly Rect[]) => {
      if (boxes.length < 2) return 0;
      const across = new Set([
        ...boxes.flatMap((b) => context.wiresAt(b)),
        ...ownWires,
      ]);
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return (
        context
          .wiresAt({
            x,
            y,
            width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
            height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
          })
          .filter((id) => !across.has(id)).length / 2
      );
    };
    /**
     * Conflicts of one label, counting its own siblings as disqualifying.
     * Text drawn over another label counts twice: a name nudged from just
     * beside a Pin's name to on top of it had cleared a wire for it. A
     * junction dot within a line's space counts half: M2 of a Schmitt
     * trigger kept its name against the dot on its gate, but a wire through
     * the name would be worse.
     */
    const score = (candidate: Annotation, siblings: readonly Annotation[]) => {
      if (siblings.some((sibling) => covers(candidate, sibling)))
        return Number.POSITIVE_INFINITY;
      const ink = box(candidate);
      const others = (ids: readonly string[]) =>
        ids.filter((id) => !groupIds.has(id)).length;
      const conflicts = context.conflicts(candidate);
      return (
        others(conflicts) +
        others(context.overlapsAt(ink, candidate.id)) +
        context.dotsAt(ink).filter((id) => !conflicts.includes(id)).length / 2 +
        cutOff(ink) +
        strayed(ink) +
        mistaken(ink, candidate, siblings.map(box)) +
        runsInto(ink, candidate, conflicts)
      );
    };
    /**
     * Conflicts of an arrangement, the Reference's before the value's: a part
     * is named by its Reference, so no clear value is worth drawing the name
     * over a wire or another label. Moving the group to another side to clear
     * a value had struck a folded-cascode OTA's M1 through by its drain wire.
     */
    const total = (arrangement: readonly Annotation[]) =>
      arrangement.reduce(
        (sum, candidate, index) => {
          const conflicts = score(candidate, [
            ...fixed,
            ...arrangement.filter((_, other) => other !== index),
          ]);
          return group[index]!.slot === "reference"
            ? { name: sum.name + conflicts, value: sum.value }
            : { name: sum.name, value: sum.value + conflicts };
        },
        { name: 0, value: between(arrangement.map(box)) },
      );
    const better = (
      left: { name: number; value: number },
      right: { name: number; value: number },
    ) =>
      left.name < right.name ||
      (left.name === right.name && left.value < right.value);
    const clear = (conflicts: { name: number; value: number }) =>
      conflicts.name === 0 && conflicts.value === 0;
    /**
     * The group moved along its side to the clear place nearest where it
     * stands, a little off what bounds that place when there is room, or
     * null. A quarter of the shorter of the group and the part stays side by
     * side, and no label may stray nearer another part, so the labels never
     * pass to a neighbour. Half had kept a DAC switch's labels from the room
     * above its gate wire, the one clear place beside it.
     */
    const slideClear = (
      arrangement: readonly Annotation[],
      owner: Rect,
    ): Annotation[] | null => {
      // Top and bottom labels are centred on the part; side labels start or
      // end beside it.
      const along = arrangement[0]!.alignment === "middle" ? "x" : "y";
      const extent = along === "x" ? "width" : "height";
      const boxes = arrangement.map(box);
      const low = Math.min(...boxes.map((b) => b[along]));
      const high = Math.max(...boxes.map((b) => b[along] + b[extent]));
      const keep = Math.min(high - low, owner[extent]) / 4;
      const first = Math.ceil(owner[along] + keep - high);
      const last = Math.floor(owner[along] + owner[extent] - keep - low);
      const clearBy = (shift: number) => {
        const moved = boxes.map((b) => ({ ...b, [along]: b[along] + shift }));
        return (
          moved.every(
            (b, index) =>
              !context
                .conflictsAt(b, arrangement[index]!.id)
                .some((id) => !groupIds.has(id)) &&
              !context.dotsAt(b).length &&
              !cutOff(b) &&
              !strayed(b) &&
              !mistaken(
                b,
                arrangement[index]!,
                moved.filter((_, other) => other !== index),
              ) &&
              !runsInto(b, arrangement[index]!, []),
          ) && !between(moved)
        );
      };
      let shift: number | undefined;
      for (let step = 1; step <= Math.max(-first, last); step++) {
        for (const candidate of [-step, step]) {
          if (candidate < first || candidate > last || !clearBy(candidate))
            continue;
          // Up to two more units the same way, off what stopped the group,
          // but no nearer to what bounds the place on its far side.
          const direction = Math.sign(candidate);
          let room = 0;
          while (
            room < 4 &&
            candidate + direction * (room + 1) >= first &&
            candidate + direction * (room + 1) <= last &&
            clearBy(candidate + direction * (room + 1))
          )
            room += 1;
          shift = candidate + direction * Math.min(2, Math.floor(room / 2));
          break;
        }
        if (shift !== undefined) break;
      }
      if (shift === undefined) return null;
      return arrangement.map((annotation, index) => {
        const position = context.measure(annotation).position;
        return at(group[index]!, {
          position: {
            x: position.x + (along === "x" ? shift : 0),
            y: position.y + (along === "y" ? shift : 0),
          },
          alignment: annotation.alignment,
        });
      });
    };

    // The default rows first, then the same rows on each other side.
    const preferred = group.map((label) =>
      at(
        label,
        defaultInstanceLabelPlacement(
          instance,
          resolved,
          styleOf(label),
          grid,
          slotOf(label),
          label.sizeScale,
        )!,
      ),
    );
    let chosen = preferred;
    let best = total(preferred);
    /** The group in its rows on one of the part's sides, or null. */
    const onSide = (side: InstanceLabelSide): Annotation[] | null => {
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
          slotOf(label),
        );
        if (!placement) return null;
        arrangement.push(at(label, placement));
      }
      return arrangement;
    };

    // A part drawn along a horizontal wire, as a ladder's series inductor
    // is, takes the clear side above the wire where under it its labels
    // would stand in a row with a neighbour's: a Chebyshev ladder's names
    // and values read as one run per row, C1 L2 C3 L4 (#1412). Textbooks
    // name a series part over its wire.
    const neighbours = along.get(ownerId);
    if (
      options.avoidCollisions !== false &&
      !fixed.length &&
      neighbours &&
      owner &&
      preferred.every((label) => box(label).y >= owner.y + owner.height) &&
      preferred.some((label) => inRowWith(box(label), neighbours))
    ) {
      const above = INSTANCE_LABEL_SIDES.map(onSide).find((arrangement) =>
        arrangement?.every(
          (label) => box(label).y + box(label).height <= owner.y,
        ),
      );
      if (above && clear(total(above))) {
        chosen = above;
        best = total(above);
      }
    }

    const sides: Annotation[][] = [];
    if (options.avoidCollisions !== false && !clear(best) && !fixed.length)
      for (const side of INSTANCE_LABEL_SIDES) {
        const arrangement = onSide(side);
        if (!arrangement) continue;
        sides.push(arrangement);
        const candidate = total(arrangement);
        if (better(candidate, best)) {
          chosen = arrangement;
          best = candidate;
        }
        if (clear(best)) break;
      }

    // A side crowded at the part's middle may have room further along it.
    // Between two rows of transistors, a part's Reference and W/L fit beside
    // it a little above its middle, clear of both rows' wiring. In a Miller
    // op amp's tight input pair, no side was clear at its middle, so the
    // labels went above the part, and its W/L stood beside the transistor
    // above, read as that one's. The group slides along each side in turn,
    // as far as it stays beside the part.
    if (!clear(best) && sides.length && owner)
      for (const arrangement of [preferred, ...sides]) {
        const slid = slideClear(arrangement, owner);
        if (slid) {
          chosen = slid;
          best = total(slid);
          break;
        }
      }

    // A label still in conflict tries a few nearby positions; it never
    // wanders arbitrarily far, moves a device, or covers a sibling.
    if (options.avoidCollisions !== false && !clear(best)) {
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
    if (better(total(originals), total(chosen))) chosen = originals;
    for (const [index, label] of group.entries()) {
      const next = chosen[index]!;
      if (JSON.stringify(next) === JSON.stringify(label.original)) continue;
      edits.push({ kind: "upsert_schematic_annotation", annotation: next });
      context.accept(next);
    }
  }
  edits.push(...arrangePinNames());
  return { edits, leftInPlace: left };

  /**
   * A Cell Pin's name takes the first of its sides where it meets nothing,
   * as a new Pin's does (#1105). Parts placed and wired after it may have
   * come to sit where it was put: an OTA's input Ports' names lay across its
   * cascode transistors, and nothing could move them but a hand.
   *
   * With the first-letter style, a name with no look of its own takes the
   * look a Pin placed with that name gets. A Pin placed as rfp and renamed
   * vrfp stayed plain beside Pins drawn V_bn (#1419).
   */
  function arrangePinNames(): SchematicEdit[] {
    // Each Pin name moved, restyled, or both.
    const changed: SchematicEdit[] = [];
    for (const label of context.visible) {
      if (
        label.binding?.kind !== "cell-terminal-name" ||
        label.anchor.kind !== "object" ||
        !ids.has(label.anchor.objectId) ||
        label.locked ||
        label.rotation !== 0
      )
        continue;
      const ownerId = label.anchor.objectId;
      const instance = document.instances.find((item) => item.id === ownerId);
      if (
        !instance?.placement ||
        (instance.symbolId !== "port" && instance.symbolId !== "port-filled")
      )
        continue;
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) continue;
      const style = objectStyleProfile(documentProfile, instance);
      const candidates = portLabelCandidates(instance, resolved, style, grid);
      const standard = defaultInstanceLabelPlacement(
        instance,
        resolved,
        style,
        grid,
        "reference",
      );
      const drawn = {
        position: context.measure(label).position,
        alignment: label.alignment,
      };
      // Only a name still on one of its own sides; one put elsewhere by
      // hand stays where it was put.
      if (
        ![...candidates, standard].some((candidate) =>
          offsetFromPlacement(drawn, candidate),
        )
      )
        continue;
      // The automatic look counts as none, as a rename reads it.
      const name = resolveAnnotationName(document, label);
      const look =
        options.referenceStyle === "first-letter-subscript" &&
        isAutomaticPinLabelLook(label.formatOverride, name)
          ? roleLabelFormat("voltage-node", name)
          : undefined;
      const restyled: Annotation = look
        ? { ...label, formatOverride: look }
        : label;
      let fewest =
        options.avoidCollisions === false
          ? 0
          : context.conflicts(restyled).length;
      const origin = instance.placement.position;
      let best = restyled;
      if (fewest)
        for (const candidate of candidates) {
          const placed: Annotation = {
            ...restyled,
            alignment: candidate.alignment,
            anchor: {
              ...label.anchor,
              localOffset: {
                x: candidate.position.x - origin.x,
                y: candidate.position.y - origin.y,
              },
              fallbackPosition: candidate.position,
            },
          };
          const conflicts = context.conflicts(placed).length;
          if (conflicts < fewest) {
            best = placed;
            fewest = conflicts;
          }
          if (!conflicts) break;
        }
      if (best === label) continue;
      changed.push({ kind: "upsert_schematic_annotation", annotation: best });
      context.accept(best);
    }
    return changed;
  }
}

/** How much nearer another part a label may stand than its own part. */
const ASSOCIATION_MARGIN = 5;

/**
 * About a character of a label's text, in ems: 10 units at the default
 * size. Two labels on one row nearer than this read as one run (#1412).
 */
const CHARACTER_EM = 0.66;

/** Whether two labels' ink shares a row: half the shorter one's height. */
function sameRow(a: Rect, b: Rect): boolean {
  return (
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >=
    Math.min(a.height, b.height) / 2
  );
}

/** A placed Cell's name under its block, drawn as literal text (#803). */
function isCellNameLabel(label: Annotation): boolean {
  return (
    label.anchor.kind === "object" &&
    label.id === `instance-master-${label.anchor.objectId}` &&
    label.content !== undefined
  );
}

/**
 * The part a label names, and whether it reads as its name or its value. A
 * placed Cell's name stands in its Reference's slot while the Reference is
 * hidden, as a new Cell's does, and in its value's slot beside it. It moves
 * as a part's name does: a redrawn caller wire ran through an SRAM block's
 * "sram6t" under the block, and nothing could clear it (#1366).
 */
export function partLabelOf(
  label: Annotation,
  visible: readonly Annotation[],
): {
  instanceId: string;
  kind: "instance-reference" | "instance-value";
} | null {
  const binding = label.binding;
  if (
    binding?.kind === "instance-reference" ||
    binding?.kind === "instance-value"
  )
    return { instanceId: binding.instanceId, kind: binding.kind };
  if (!isCellNameLabel(label) || label.anchor.kind !== "object") return null;
  const instanceId = label.anchor.objectId;
  return {
    instanceId,
    kind: visible.some(
      (other) =>
        other.binding?.kind === "instance-reference" &&
        other.binding.instanceId === instanceId,
    )
      ? "instance-value"
      : "instance-reference",
  };
}

/**
 * Whether text at `next` reads after text at `first`: below it, or after it
 * on its line.
 */
function readsAfter(first: Rect, next: Rect): boolean {
  const slack = 1;
  return (
    next.y >= first.y + first.height - slack ||
    (next.x >= first.x + first.width - slack &&
      next.y < first.y + first.height &&
      next.y + next.height > first.y)
  );
}

function rectangleGap(a: Rect, b: Rect): number {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );
}

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
