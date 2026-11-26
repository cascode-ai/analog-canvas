import {
  canonicalPortTextDocument,
  isAutomaticPinLabelLook,
  isRoleLabelFormat,
  roleLabelFormat,
  routeEndpoints,
  type Annotation,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  defaultVddPowerLabelPlacement,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  instanceLabelRowOffset,
  instanceLabelSlotAt,
  INSTANCE_LABEL_SIDES,
  isVisibleEndpoint,
  legacyDefaultInstanceLabelPlacement,
  objectStyleProfile,
  offsetFromPlacement,
  outwardDefaultInstanceLabelPlacement,
  placeUprightInstanceLabel,
  portLabelCandidates,
  previousDefaultInstanceLabelPlacement,
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
import {
  annotationAt,
  ASSOCIATION_MARGIN,
  CHARACTER_EM,
  followHiddenMultiplierEdits,
  isCellNameLabel,
  multiplierLabel,
  nearbyShifts,
  OWN_WIRE_LINE_SPACE,
  OWN_WIRE_SPACE,
  overlap,
  partLabelOf,
  readsAfter,
  rectangleGap,
  sameRow,
} from "./label-geometry";
import {
  repairInstanceLabels,
  repairManualSinglePart,
  type LabelLeftInPlace,
} from "./repair-instance-labels";

export { partLabelOf, type LabelLeftInPlace };

/** One instance label still in a default slot, eligible for this pass. */
interface EligibleLabel {
  readonly original: Annotation;
  /** The original, restyled when the pass changes the Reference's look. */
  readonly annotation: Annotation;
  readonly slot: "reference" | "value";
  /** A value shown without its Reference takes the Reference's slot. */
  readonly compact: boolean;
  readonly sizeScale: number;
  /** Eligible only as standing in another side's rows, where a pass put it. */
  readonly arranged: boolean;
  /**
   * Moved by hand and eligible only for `repairManual` because the label
   * findings report it: it moves only to a place they leave clear (#2619).
   */
  readonly repair: boolean;
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
  /**
   * Repair: delegates to the cohort-first repair planner (#2619), which moves
   * only parts with reported label findings (and aligned/mirrored peers
   * moving flush with them), keeping symmetry, ownership and name-before-value
   * order, placing inward-colliding pairs outward, and hiding severely
   * colliding values only as a last resort.
   */
  includeManual?: boolean | undefined;
  /**
   * When true with `includeManual`, a repair may hide a visible value display
   * (`visible: false`, netlist parameters untouched) as a last resort when it
   * directly collides with another label and no placement fits name + value.
   */
  hideCrowdedValues?: boolean | undefined;
  /**
   * Repair labels moved by hand without restricting default-slot arrangement:
   * the textbook preset's (#2619).
   */
  repairManual?: boolean | undefined;
  /**
   * The side tried first. "outside" is the side away from the drawing's
   * centre line, so the two halves of a symmetric circuit mirror (#1519).
   */
  side?: InstanceLabelSide | "outside" | undefined;
  /**
   * Only the rows of the part's sides: no slide along a side and no nearby
   * spot off them. A label placed there is still one a later pass moves;
   * one slid or nudged off its rows counts as moved by hand (#1836).
   */
  rowsOnly?: boolean | undefined;
}

/** The arrangement, and the labels it leaves where they are (#1414). */
export function arrangeInstanceLabelsReport(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: ArrangeInstanceLabelsOptions,
): {
  edits: SchematicEdit[];
  leftInPlace: LabelLeftInPlace[];
  hiddenValueIds?: string[];
} {
  if (options.includeManual === true) {
    return repairInstanceLabels(document, resolver, instanceIds, {
      referenceStyle: options.referenceStyle,
      hideCrowdedValues: options.hideCrowdedValues,
    });
  }

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
    const result: ReadonlySet<string> =
      stacked && name && value ? new Set([name.id, value.id]) : new Set();
    valueFirstGroups.set(instanceId, result);
    return result;
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
    const alone =
      !reference &&
      !context.visible.some(
        (a) =>
          a.binding?.kind === "instance-reference" &&
          a.binding.instanceId === instance.id,
      );
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
    const inReferenceSlot = alone && at("reference");
    const multiplier = multiplierLabel(original, instance, resolver);
    const inOwnSlot =
      multiplier !== undefined &&
      offsetFromPlacement(
        drawn,
        defaultInstanceParameterLabelPlacement(
          instance,
          resolved,
          style,
          grid,
          multiplier,
          resolver,
        ),
      ) !== null;
    const sideSlot = instanceLabelSlotAt(
      instance,
      resolved,
      style,
      grid,
      drawn,
      sizeScale,
    );
    const inSideRows =
      sideSlot !== null && DEFAULT_SLOTS[slot].includes(sideSlot.slot);
    const placed =
      at(slot) || inOwnSlot || stackedValueFirst(instance.id).has(original.id);
    const repairs = options.repairManual === true;
    const repair =
      !placed &&
      !inReferenceSlot &&
      !inSideRows &&
      repairs &&
      !context.clearAt(original);
    const inDefaultRow = placed || repair;
    const inValueRow = !inReferenceSlot && (inDefaultRow || inSideRows);
    if (!inValueRow && !inReferenceSlot)
      return leave(repairs ? "clear" : "moved");
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
    const compact = alone && (options.compact !== false || inReferenceSlot);
    return {
      original,
      annotation,
      slot,
      compact,
      sizeScale,
      arranged: !inReferenceSlot && !inDefaultRow,
      repair,
    };
  }

  const edits: SchematicEdit[] = [];
  const along = new Map(
    [...groups.keys()].map((id) => [id, lineNeighbours(id)] as const),
  );
  const order = [...groups].sort(
    ([a], [b]) => Number(along.get(b) !== null) - Number(along.get(a) !== null),
  );
  const placeAnnotation = (
    annotation: Annotation,
    placement: InstanceLabelPlacement,
  ): Annotation => annotationAt(document, resolver, annotation, placement);

  // The drawing's vertical centre line, for labels asked to face outward.
  const parts = context.symbols.map((symbol) => symbol.bounds);
  const centreX = parts.length
    ? (Math.min(...parts.map((part) => part.x)) +
        Math.max(...parts.map((part) => part.x + part.width))) /
      2
    : 0;

  for (const [ownerId, group] of order) {
    const instance = document.instances.find((i) => i.id === ownerId)!;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )!;
    const groupIds = new Set(group.map((label) => label.original.id));
    const fixed = (ownLabels.get(ownerId) ?? []).filter(
      (label) => !groupIds.has(label.id),
    );

    // Textbook preset's hand-moved reported labels reuse the repair planner.
    if (group.some((label) => label.repair)) {
      const repaired = repairManualSinglePart({
        document,
        resolver,
        context,
        documentProfile,
        instance,
        resolved,
        movable: group,
        fixed,
      });
      if (!repaired) {
        for (const label of group)
          if (label.repair)
            left.push({
              labelId: label.original.id,
              instanceId: ownerId,
              reason: "crowded",
            });
      }
      for (const [index, label] of group.entries()) {
        const next = repaired?.[index];
        if (!next || JSON.stringify(next) === JSON.stringify(label.original))
          continue;
        edits.push({ kind: "upsert_schematic_annotation", annotation: next });
        context.accept(next);
      }
      continue;
    }

    const at = (
      label: EligibleLabel,
      placement: InstanceLabelPlacement,
    ): Annotation => placeAnnotation(label.annotation, placement);
    const styleOf = (label: EligibleLabel) =>
      objectStyleProfile(documentProfile, label.original);
    const valueRowOf = (label: EligibleLabel) =>
      multiplierLabel(label.original, instance, resolver)
        ? instanceLabelRowOffset(styleOf(label), grid)
        : undefined;
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
    const cutOff = (ink: Rect) => {
      if (!owner) return 0;
      const c = { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 };
      const nearest = {
        x: Math.min(Math.max(c.x, owner.x), owner.x + owner.width),
        y: Math.min(Math.max(c.y, owner.y), owner.y + owner.height),
      };
      const across = context.wiresAt(ink);
      return (
        context.crossings(c, nearest).filter((id) => !across.includes(id))
          .length / 2
      );
    };
    const touchesOwnWire = (ink: Rect) => {
      const across = context.wiresAt(ink);
      return context
        .wiresAt({
          x: ink.x - OWN_WIRE_SPACE,
          y: ink.y - OWN_WIRE_LINE_SPACE,
          width: ink.width + 2 * OWN_WIRE_SPACE,
          height: ink.height + 2 * OWN_WIRE_LINE_SPACE,
        })
        .some((id) => ownWires.includes(id) && !across.includes(id))
        ? 0.5
        : 0;
    };
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
    const uncrowdedAt = (
      ink: Rect,
      label: Annotation,
      siblings: readonly Rect[],
    ) =>
      !context.conflictsAt(ink, label.id).some((id) => !groupIds.has(id)) &&
      !context.dotsAt(ink).length &&
      !cutOff(ink) &&
      !touchesOwnWire(ink) &&
      !strayed(ink) &&
      !mistaken(ink, label, siblings) &&
      !runsInto(ink, label, []);
    const isReported = (
      candidate: Annotation,
      ink: Rect,
      siblings: readonly Rect[],
    ) =>
      siblings.some((sibling) => overlap(ink, sibling)) ||
      !context.clearAt(candidate, ink, groupIds);
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
        (context.enclosedAt(ink) ? 1 : 0) +
        cutOff(ink) +
        touchesOwnWire(ink) +
        strayed(ink) +
        mistaken(ink, candidate, siblings.map(box)) +
        runsInto(ink, candidate, conflicts)
      );
    };
    const total = (arrangement: readonly Annotation[]) =>
      arrangement.reduce(
        (sum, candidate, index) => {
          const siblings = [
            ...fixed,
            ...arrangement.filter((_, other) => other !== index),
          ];
          const conflicts = score(candidate, siblings);
          const named = group[index]!.slot === "reference";
          const raised = isReported(
            candidate,
            box(candidate),
            siblings.map(box),
          )
            ? 1
            : 0;
          return {
            reported: {
              name: sum.reported.name + (named ? raised : 0),
              value: sum.reported.value + (named ? 0 : raised),
            },
            name: sum.name + (named ? conflicts : 0),
            value: sum.value + (named ? 0 : conflicts),
          };
        },
        {
          reported: { name: 0, value: 0 },
          name: 0,
          value: between(arrangement.map(box)),
        },
      );
    const better = (a: Conflicts, b: Conflicts) =>
      a.reported.name < b.reported.name ||
      (a.reported.name === b.reported.name &&
        (a.reported.value < b.reported.value ||
          (a.reported.value === b.reported.value &&
            (a.name < b.name || (a.name === b.name && a.value < b.value)))));
    const clear = (conflicts: Conflicts) =>
      conflicts.name === 0 &&
      conflicts.value === 0 &&
      conflicts.reported.name === 0 &&
      conflicts.reported.value === 0;

    const slideClear = (
      arrangement: readonly Annotation[],
      partBounds: Rect,
    ): Annotation[] | null => {
      const axis = arrangement[0]!.alignment === "middle" ? "x" : "y";
      const extent = axis === "x" ? "width" : "height";
      const boxes = arrangement.map(box);
      const low = Math.min(...boxes.map((b) => b[axis]));
      const high = Math.max(...boxes.map((b) => b[axis] + b[extent]));
      const keep = Math.min(high - low, partBounds[extent]) / 4;
      const first = Math.ceil(partBounds[axis] + keep - high);
      const last = Math.floor(
        partBounds[axis] + partBounds[extent] - keep - low,
      );
      const clearBy = (shift: number) => {
        const moved = boxes.map((b) => ({ ...b, [axis]: b[axis] + shift }));
        return (
          moved.every((b, index) =>
            uncrowdedAt(
              b,
              arrangement[index]!,
              moved.filter((_, other) => other !== index),
            ),
          ) && !between(moved)
        );
      };
      let shift: number | undefined;
      for (let step = 1; step <= Math.max(-first, last); step++) {
        for (const candidate of [-step, step]) {
          if (candidate < first || candidate > last || !clearBy(candidate))
            continue;
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
            x: position.x + (axis === "x" ? shift : 0),
            y: position.y + (axis === "y" ? shift : 0),
          },
          alignment: annotation.alignment,
        });
      });
    };

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
          valueRowOf(label),
        )!,
      ),
    );
    let chosen = preferred;
    let best = total(preferred);
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
          valueRowOf(label),
        );
        if (!placement) return null;
        arrangement.push(at(label, placement));
      }
      return arrangement;
    };

    const asked =
      options.side === "outside"
        ? owner && owner.x + owner.width / 2 < centreX - grid
          ? "left"
          : owner && owner.x + owner.width / 2 > centreX + grid
            ? "right"
            : undefined
        : options.side;
    const sided = asked && !fixed.length ? onSide(asked) : null;
    if (sided) {
      chosen = sided;
      best = total(sided);
    }

    const neighbours = along.get(ownerId);
    if (
      options.avoidCollisions !== false &&
      !sided &&
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

    if (!clear(best) && sides.length && owner && !options.rowsOnly)
      for (const arrangement of [preferred, ...sides]) {
        const slid = slideClear(arrangement, owner);
        if (slid) {
          chosen = slid;
          best = total(slid);
          break;
        }
      }

    if (
      options.avoidCollisions !== false &&
      !options.rowsOnly &&
      !clear(best)
    ) {
      chosen = [...chosen];
      for (const [index, label] of group.entries()) {
        const siblings = () => [
          ...fixed,
          ...chosen.filter((_, other) => other !== index),
        ];
        let current = chosen[index]!;
        const rank = (candidate: Annotation) =>
          [
            isReported(candidate, box(candidate), siblings().map(box)) ? 1 : 0,
            score(candidate, siblings()),
          ] as const;
        let currentRank = rank(current);
        if (!currentRank[0] && !currentRank[1]) continue;
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
          const candidateRank = rank(candidate);
          if (
            candidateRank[0] < currentRank[0] ||
            (candidateRank[0] === currentRank[0] &&
              candidateRank[1] < currentRank[1])
          ) {
            current = candidate;
            currentRank = candidateRank;
          }
          if (!currentRank[0] && !currentRank[1]) break;
        }
        chosen[index] = current;
      }
      for (const [index, label] of group.entries()) {
        const current = chosen[index]!;
        const ink = box(current);
        const siblings = [
          ...fixed,
          ...chosen.filter((_, other) => other !== index),
        ].map(box);
        if (!isReported(current, ink, siblings)) continue;
        const shifted = (shift: Point) => ({
          ...ink,
          x: ink.x + shift.x,
          y: ink.y + shift.y,
        });
        const unreported = (shift: Point) =>
          !isReported(current, shifted(shift), siblings);
        const uncrowded = (shift: Point) => {
          const b = shifted(shift);
          return uncrowdedAt(b, current, siblings) && !context.enclosedAt(b);
        };
        let shift: Point | undefined;
        let fallback: Point | undefined;
        for (const candidate of nearbyShifts(grid)) {
          if (!unreported(candidate)) continue;
          fallback ??= candidate;
          if (uncrowded(candidate)) {
            shift = candidate;
            break;
          }
        }
        shift ??= fallback;
        if (!shift) continue;
        const position = context.measure(current).position;
        chosen[index] = at(label, {
          position: { x: position.x + shift.x, y: position.y + shift.y },
          alignment: current.alignment,
        });
      }
    }

    const originals = group.map((label) => ({
      ...label.annotation,
      anchor: label.original.anchor,
      alignment: label.original.alignment,
    }));
    const kept = total(originals);
    if (
      better(kept, total(chosen)) ||
      (!options.side && group.some((label) => label.arranged) && clear(kept))
    )
      chosen = originals;
    for (const [index, label] of group.entries()) {
      const next = chosen[index]!;
      if (JSON.stringify(next) === JSON.stringify(label.original)) continue;
      edits.push({ kind: "upsert_schematic_annotation", annotation: next });
      context.accept(next);
    }
  }

  const arrangedGroupIds = new Map<string, ReadonlySet<string>>(
    [...groups].map(([id, group]) => [
      id,
      new Set(group.map((label) => label.original.id)),
    ]),
  );
  edits.push(
    ...followHiddenMultiplierEdits({
      document,
      resolver,
      context,
      documentProfile,
      grid,
      edits,
      ownLabels,
      arrangedGroupIds,
      includeManual: false,
    }),
    ...arrangePinNames(),
    ...arrangeSupplyNames(),
  );
  return { edits, leftInPlace: left };

  function arrangeSupplyNames(): SchematicEdit[] {
    return [...ids].flatMap((id) => {
      const instance = document.instances.find((item) => item.id === id)!;
      const bar = context.symbols.find((symbol) => symbol.id === id)?.bounds;
      const found = document.annotations.find(
        (annotation) =>
          annotation.kind === "power-label" &&
          annotation.anchor.kind === "object" &&
          annotation.anchor.objectId === id,
      );
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!found || found.locked || !resolved) return [];
      const upsideDown = found.rotation > 90 && found.rotation < 270;
      const name: Annotation = { ...found, rotation: 0 };
      const struck =
        options.side === undefined &&
        !upsideDown &&
        instance.symbolId === "vdd-port" &&
        context.struckAt(box(found), found.id).length > 0;
      const side =
        options.side === "top" || options.side === "right"
          ? options.side
          : upsideDown
            ? "right"
            : struck
              ? "top"
              : undefined;
      if (!side || (instance.symbolId !== "vdd-port" && !upsideDown)) return [];
      let next: Annotation;
      if (side === "right" || instance.symbolId !== "vdd-port") {
        const beside = defaultVddPowerLabelPlacement(instance, resolved, grid);
        if (!beside) return [];
        next = placeAnnotation(name, beside);
      } else if (!bar) return [];
      else {
        const clearOfBar = bar.y - grid / 2;
        const over = placeAnnotation(name, {
          position: { x: bar.x + bar.width / 2, y: clearOfBar },
          alignment: "middle",
        });
        const ink = context.measure(over).inkBounds;
        next = placeAnnotation(over, {
          position: {
            x: bar.x + bar.width / 2,
            y: clearOfBar - (ink.y + ink.height - clearOfBar),
          },
          alignment: "middle",
        });
      }
      if (JSON.stringify(next) === JSON.stringify(found)) return [];
      if (struck && context.struckAt(box(next), next.id).length) return [];
      context.accept(next);
      return [{ kind: "upsert_schematic_annotation", annotation: next }];
    });
  }

  function arrangePinNames(): SchematicEdit[] {
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
      if (
        ![...candidates, standard].some((candidate) =>
          offsetFromPlacement(drawn, candidate),
        )
      )
        continue;
      const name = resolveAnnotationName(document, label);
      const look =
        options.referenceStyle === "first-letter-subscript" &&
        isAutomaticPinLabelLook(label.formatOverride, name)
          ? roleLabelFormat("voltage-node", name)
          : undefined;
      const restyled: Annotation = look
        ? { ...label, formatOverride: look }
        : label;
      const origin = instance.placement.position;
      const anchor = label.anchor;
      const onSide = (candidate: InstanceLabelPlacement): Annotation => ({
        ...restyled,
        alignment: candidate.alignment,
        anchor: {
          ...anchor,
          localOffset: {
            x: candidate.position.x - origin.x,
            y: candidate.position.y - origin.y,
          },
          fallbackPosition: candidate.position,
        },
      });
      let fewest =
        options.avoidCollisions === false
          ? 0
          : context.conflicts(restyled).length;
      let best = restyled;
      if (fewest)
        for (const candidate of candidates) {
          const placed = onSide(candidate);
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

/** An arrangement's conflicts: those reported first, then all of them. */
interface Conflicts {
  readonly reported: { readonly name: number; readonly value: number };
  readonly name: number;
  readonly value: number;
}
