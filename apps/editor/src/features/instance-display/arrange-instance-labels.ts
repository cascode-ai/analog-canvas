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
  instanceLabelSlotAt,
  INSTANCE_LABEL_SIDES,
  legacyDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  instanceLabelRowOffset,
  instanceValueRowOffset,
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
  valuePrintsMultiplier,
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
  /** Eligible only as standing in another side's rows, where a pass put it. */
  readonly arranged: boolean;
  /**
   * Moved by hand and eligible only for `includeManual` because the label
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

/** A label the pass left where it is, and why (#1414). */
export interface LabelLeftInPlace {
  labelId: string;
  /** The part or Pin it labels; null for a Net label or free text. */
  instanceId: string | null;
  /**
   * moved: by hand, without includeManual; clear: by hand, and nothing the
   * label findings report; crowded: by hand and reported, with no clear
   * place to repair it to (#2619); unarranged: reported, but of a kind a
   * repair does not move (a Net label, free text, a block's name) or a
   * Pin's or supply's name with no clear side at its end.
   */
  reason:
    | "locked"
    | "rotated"
    | "custom"
    | "moved"
    | "clear"
    | "crowded"
    | "unarranged";
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
  /**
   * Repair: only parts with a label the label findings report (a wire, a
   * part or a label over or crowding it) are arranged, those moved by hand
   * included; every other label stays where it is and is in the way. A
   * part's labels move together, beside their own part and nearer it than
   * any other, to a place they leave clear, or stay (#2619). A block's name
   * stays in its box; a Pin's or supply's name only turns about its end.
   */
  includeManual?: boolean | undefined;
  /**
   * Repair labels moved by hand as includeManual does, without its other
   * effects: the textbook preset's (#2619).
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
): { edits: SchematicEdit[]; leftInPlace: LabelLeftInPlace[] } {
  // A repair keeps a row of like parts' labels in their row and a mirrored
  // pair's labels mirrored: a part whose repair broke one stays as it was,
  // and the rest are planned again around it (#2619). Each round leaves one
  // more part, so the rounds end.
  const frozen = new Set<string>();
  for (;;) {
    const pass = arrangePass(document, resolver, instanceIds, options, frozen);
    if (!pass.broken.length)
      return { edits: pass.edits, leftInPlace: pass.leftInPlace };
    for (const id of pass.broken) frozen.add(id);
  }
}

function arrangePass(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: ArrangeInstanceLabelsOptions,
  frozen: ReadonlySet<string>,
): {
  edits: SchematicEdit[];
  leftInPlace: LabelLeftInPlace[];
  /** Parts whose repair broke a row or a mirror of like parts' labels. */
  broken: string[];
} {
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

  // A repair (includeManual) moves only what the label findings report:
  // a wire, a part or another label drawn over a label or crowding it, a
  // label far from its part or run on into a neighbour's. In a Gallery dry
  // run an includeManual pass moved 3,555 labels of parts nothing reported,
  // in 1,287 drawings (#2619).
  const repairOnly = options.includeManual === true;
  let supplyWays: { over: number; beside: number } | undefined;
  const reportedLabel = (label: Annotation) => !context.clearAt(label);
  const reportedIds = new Set(
    repairOnly
      ? context.visible.filter(reportedLabel).map((label) => label.id)
      : [],
  );
  const reportedParts = new Set(
    [...reportedIds].flatMap((id) => {
      const part = partLabels.get(id);
      return part && !frozen.has(part.instanceId) ? [part.instanceId] : [];
    }),
  );
  /**
   * Whether a wire, another part or another label is drawn over a label, or
   * it runs on into a neighbour's: worse than one only crowded or over its
   * own part's outline, which holds the empty corners beside its drawing.
   */
  const findings = new Map<string, ReturnType<typeof context.findingsAt>>();
  const findingsOf = (label: Annotation) => {
    let found = findings.get(label.id);
    if (!found) findings.set(label.id, (found = context.findingsAt(label)));
    return found;
  };
  const struckByOther = (label: Annotation) => {
    const found = findingsOf(label);
    const own = owners.get(label.id);
    return (
      found.overlapped.length > 0 ||
      found.runsOn.length > 0 ||
      found.struck.some((id) => id !== own)
    );
  };
  /**
   * How far a repair may move a label: two grid steps for one drawn over,
   * one for one only crowded, and back to its part for one far from it. A
   * repair had moved labels up to four steps to a free spot by a ground or
   * the next transistor (#2619).
   */
  const repairReach = (label: Annotation) =>
    findingsOf(label).ownerGap !== undefined
      ? Number.POSITIVE_INFINITY
      : findingsOf(label).struck.length || struckByOther(label)
        ? grid * 2
        : grid;
  /**
   * Parts a repair leaves rather than break their row or mirror: those with
   * no label worse than crowded or over its own outline. One struck by a
   * wire moves clear all the same.
   */
  const lightlyReported = new Set(reportedParts);
  for (const label of context.visible)
    if (reportedIds.has(label.id) && struckByOther(label))
      lightlyReported.delete(partLabels.get(label.id)?.instanceId ?? "");
  // Every drawn Pin end of every part: a label a repair moves keeps clear
  // of other parts' ends as it was.
  const pinEnds = document.instances.flatMap((instance) =>
    repairOnly && instance.placement
      ? (
          resolver.resolve(instance.symbolId, instance.symbolVariantId)
            ?.definition.pins ?? []
        ).flatMap((pin) => {
          const endpoint = {
            kind: "terminal" as const,
            instanceId: instance.id,
            pinName: pin.name,
          };
          const at =
            isVisibleEndpoint(document, resolver, endpoint) &&
            resolveEndpointPoint(document, resolver, endpoint);
          return at ? [{ instanceId: instance.id, at }] : [];
        })
      : [],
  );

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
    // A repair leaves a part nothing reports as it is, and a block's name
    // where its author wrote it: only its own box is its place (#2619).
    if (repairOnly && isCellNameLabel(original))
      return reportedIds.has(original.id) ? leave("unarranged") : null;
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
    // A ×m shown for its hidden W/L stands in its own slot (#1434).
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
    // A label in its slot's rows on another side stands where an earlier
    // arrangement put it, at placement or by this pass, and is still the
    // editor's to move: a W/L arranged clear of a neighbour when its part
    // was placed, then struck by a wire drawn after, was left there (#1836).
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
    // A hand-moved label is repaired, not re-placed: one clear where its
    // author put it stays there.
    const repairs =
      options.includeManual === true || options.repairManual === true;
    // A part left to keep its row or mirror stays, its labels named.
    if (repairOnly && frozen.has(ownerId))
      return reportedIds.has(original.id) ? leave("crowded") : null;
    if (repairOnly && !reportedParts.has(ownerId))
      return placed || inReferenceSlot || inSideRows ? null : leave("clear");
    // A repair moves a reported part's labels as one group, hand-moved
    // ones too, so a name never leaves its value behind (#2619).
    const repair =
      !placed &&
      !inReferenceSlot &&
      !inSideRows &&
      repairs &&
      (repairOnly || violatesClearance(original));
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
    // One already in its Reference's slot keeps that row, compact or not.
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

  /**
   * Whether the label findings report `label` where it stands: a wire, a
   * part or another label drawn over it or crowding it, or it far from its
   * part or running on into a neighbour's.
   */
  function violatesClearance(label: Annotation): boolean {
    return !context.clearAt(label);
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
  /** The annotation drawn at `placement`, its anchor kept on its part. */
  const annotationAt = (
    annotation: Annotation,
    placement: InstanceLabelPlacement,
  ): Annotation => ({
    ...draggedAnnotationAtPosition(
      { document, resolver, annotationGrid: 1, routeGeometryRecords: [] },
      annotation,
      placement.position,
    ),
    alignment: placement.alignment,
  });
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
    // Siblings this pass leaves where they are.
    const fixed = (ownLabels.get(ownerId) ?? []).filter(
      (label) => !groupIds.has(label.id),
    );
    const at = (
      label: EligibleLabel,
      placement: InstanceLabelPlacement,
    ): Annotation => annotationAt(label.annotation, placement);
    const styleOf = (label: EligibleLabel) =>
      objectStyleProfile(documentProfile, label.original);
    // A ×m shown for its hidden W/L is plain text: beside or below the part
    // it stands a text row under the name, as it is placed, not in the
    // fraction's taller row (#1434). Its name keeps the rows it is placed
    // in, a W/L's row over the ×m above the part.
    const valueRowOf = (label: EligibleLabel) =>
      multiplierLabel(label.original, instance, resolver)
        ? instanceLabelRowOffset(styleOf(label), grid)
        : undefined;
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
     * Half a conflict for a label that a wire of its own part ends or passes
     * within a word's space before or after, as two labels on a row keep, or
     * a line's space above or below; one drawn across it counts already. A
     * comparator's M10 had its name centred above it, 1.85 units from its
     * drain wire: clear of the wire's line, it read as written on the wire
     * (#2346). A bulk wire a line under a name, between it and its W/L,
     * still reads as the part's.
     */
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
     * Whether `label` at `ink` meets nothing and no crowding: no wire, part
     * or other label within spacing, no junction dot within a line's space,
     * no wire cutting it off from its part, and no reading as another part's
     * label or running on into one. `siblings` are its group's other labels.
     */
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
    /**
     * Whether the label diagnostics would report `candidate` drawn at `ink`:
     * text over a wire, a part or a junction dot, over another label or one
     * of `siblings`, far from its part, or run on into a neighbour's. The
     * group's own stale places do not count; `siblings` are where its other
     * labels stand in the arrangement tested.
     */
    const isReported = (
      candidate: Annotation,
      ink: Rect,
      siblings: readonly Rect[],
    ) =>
      siblings.some((sibling) => overlap(ink, sibling)) ||
      !context.clearAt(candidate, ink, groupIds);
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
        (context.enclosedAt(ink) ? 1 : 0) +
        cutOff(ink) +
        touchesOwnWire(ink) +
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
    /**
     * Labels the label diagnostics would report count before every other
     * crowding: a name a dashed body tie struck through beat a place clear
     * of everything but a little nearer the next part (#1836).
     */
    const better = (left: Conflicts, right: Conflicts) =>
      left.reported.name < right.reported.name ||
      (left.reported.name === right.reported.name &&
        (left.reported.value < right.reported.value ||
          (left.reported.value === right.reported.value &&
            (left.name < right.name ||
              (left.name === right.name && left.value < right.value)))));
    const clear = (conflicts: Conflicts) =>
      conflicts.name === 0 &&
      conflicts.value === 0 &&
      conflicts.reported.name === 0 &&
      conflicts.reported.value === 0;
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
          valueRowOf(label),
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
          valueRowOf(label),
        );
        if (!placement) return null;
        arrangement.push(at(label, placement));
      }
      return arrangement;
    };

    /**
     * The repaired group: the nearest arrangement, of the labels where they
     * stand, their default rows or another side's, each shifted a little,
     * that every rule of a repair accepts, or null.
     */
    const repairGroup = (): Annotation[] | null => {
      const originals = group.map((label) => ({
        ...label.annotation,
        anchor: label.original.anchor,
        alignment: label.original.alignment,
      }));
      const from = originals.map((label) => context.measure(label).position);
      const fromBoxes = originals.map(box);
      const fixedBoxes = fixed.map(box);
      // A label far from its part goes back to it: where it stood says
      // nothing of which side, or what neighbours, it should keep.
      const homing = group.some(
        (label) =>
          reportedIds.has(label.original.id) &&
          findingsOf(label.original).ownerGap !== undefined,
      );
      // How far the group may move: as far as its worst-reported label.
      const groupReach = Math.max(
        grid,
        ...group
          .filter((label) => reportedIds.has(label.original.id))
          .map((label) => repairReach(label.original)),
      );
      // How far apart the part's labels may stand: a row's reach, or as far
      // as they already were.
      const reach = (a: Rect, b: Rect) => Math.max(grid, rectangleGap(a, b));
      const allowed = fromBoxes.map((ink) =>
        fixedBoxes.map((f) => reach(ink, f)),
      );
      const pairs = fromBoxes.map((ink) =>
        fromBoxes.map((other) => reach(ink, other)),
      );
      const owned = (ink: Rect) => {
        if (!owner) return false;
        const own = rectangleGap(ink, owner);
        return (
          own <= grid * OWNER_REACH_STEPS &&
          context.symbols.every(
            (symbol) =>
              symbol.id === instance.id ||
              rectangleGap(ink, symbol.bounds) > own,
          )
        );
      };
      /** The sides of its part a label stands wholly beyond. */
      const sidesOf = (ink: Rect) =>
        owner && {
          left: ink.x + ink.width <= owner.x,
          right: ink.x >= owner.x + owner.width,
          above: ink.y + ink.height <= owner.y,
          below: ink.y >= owner.y + owner.height,
        };
      const fromSides = fromBoxes.map(sidesOf);
      // A label never crosses to its part's far side: a switch's M3, M5
      // and M7 had been moved from beside it to across it, out of the
      // column of their row-mates (#2619).
      const keepsSide = (ink: Rect, index: number) => {
        const was = fromSides[index];
        const now = sidesOf(ink);
        return (
          !was ||
          !now ||
          !(
            (was.left && now.right) ||
            (was.right && now.left) ||
            (was.above && now.below) ||
            (was.below && now.above)
          )
        );
      };
      // What stands near: other parts, their labels, their Pin ends and
      // wires. A moved label comes no nearer one within half a grid step
      // than it was, and meets no wire there it did not; repairs had put
      // names beside a ground, a neighbour's Pin, a return wire and the
      // next transistor's name (#2619).
      const near = grid / 2;
      const span = union(fromBoxes);
      const around = grid * 2 + near;
      const nearbySymbols = context.symbols.filter(
        (symbol) =>
          symbol.id !== instance.id &&
          rectangleGap(span, symbol.bounds) <= around + span.width,
      );
      const nearbyEnds = pinEnds.filter(
        ({ instanceId, at }) =>
          instanceId !== instance.id &&
          pointGap(at, span) <= around + span.width,
      );
      const ownEnds = pinEnds.filter(
        ({ instanceId }) => instanceId === instance.id,
      );
      const nearWires = fromBoxes.map(
        (ink) => new Set(context.wiresAt(grown(ink, near))),
      );
      const keepsNeighbours = (ink: Rect, index: number, label: Annotation) => {
        const was = fromBoxes[index]!;
        const nearer = (now: number, before: number) =>
          now < near && now < before;
        return (
          !nearbySymbols.some((symbol) =>
            nearer(
              rectangleGap(ink, symbol.bounds),
              rectangleGap(was, symbol.bounds),
            ),
          ) &&
          !nearbyEnds.some(({ at }) =>
            nearer(pointGap(at, ink), pointGap(at, was)),
          ) &&
          !context
            .wiresAt(grown(ink, near))
            .some((id) => !nearWires[index]!.has(id)) &&
          !context.labelsWithin(ink, label.id, near).some((id) => {
            if (groupIds.has(id) || owners.get(id) === instance.id)
              return false;
            const theirs = context.labelBounds(id)!;
            return nearer(rectangleGap(ink, theirs), rectangleGap(was, theirs));
          })
        );
      };
      // A name and its value read as one block: the name before its value,
      // above it or ahead of it on its line, both on one side of their part.
      // A repair had put a capacitor's C_L on its far side from its 0.1pF,
      // and turned a CSp under its 1pF (#2619).
      const kindOf = (label: Annotation) => partLabels.get(label.id)?.kind;
      const allOriginals = [...originals, ...fixed];
      const nameAt = allOriginals.findIndex(
        (label) => kindOf(label) === "instance-reference",
      );
      const valueAt = allOriginals.findIndex(
        (label) => kindOf(label) === "instance-value",
      );
      const allFrom = [...fromBoxes, ...fixedBoxes];
      const paired = nameAt >= 0 && valueAt >= 0;
      /** Stacked or on one line, and whether the name reads first. */
      const readOrder = (name: Rect, value: Rect) => {
        const dx = centre(value).x - centre(name).x;
        const dy = centre(value).y - centre(name).y;
        const stacked = Math.abs(dy) >= Math.abs(dx);
        return { stacked, nameFirst: (stacked ? dy : dx) > 0 };
      };
      const was = paired && readOrder(allFrom[nameAt]!, allFrom[valueAt]!);
      // Labels drawn over each other had no order to keep.
      const tangled = paired && overlap(allFrom[nameAt]!, allFrom[valueAt]!);
      const straddled =
        paired && owner
          ? overlap(union([allFrom[nameAt]!, allFrom[valueAt]!]), owner)
          : true;
      const readsAsOne = (boxes: readonly Rect[]) => {
        if (!paired || !was || !owner) return true;
        const all = [...boxes, ...fixedBoxes];
        const name = all[nameAt]!;
        const value = all[valueAt]!;
        const now = readOrder(name, value);
        return (
          now.nameFirst &&
          (homing ||
            tangled ||
            !was.nameFirst ||
            now.stacked === was.stacked) &&
          (straddled || !overlap(union([name, value]), owner))
        );
      };
      /** Whether the group stands on a side of its part a lead leaves. */
      const onWiredSide = (boxes: readonly Rect[]) => {
        if (!owner) return false;
        const sides = sidesOf(union(boxes))!;
        return ownEnds.some(
          ({ at }) =>
            (sides.left && at.x <= owner.x + 1) ||
            (sides.right && at.x >= owner.x + owner.width - 1) ||
            (sides.above && at.y <= owner.y + 1) ||
            (sides.below && at.y >= owner.y + owner.height - 1),
        );
      };
      const accepts = (boxes: readonly Rect[], labels: readonly Annotation[]) =>
        boxes.every(owned) &&
        (homing ||
          (boxes.every(keepsSide) &&
            boxes.every((ink, index) =>
              keepsNeighbours(ink, index, labels[index]!),
            ))) &&
        readsAsOne(boxes) &&
        boxes.every((ink, index) =>
          fixedBoxes.every(
            (f, other) => rectangleGap(ink, f) <= allowed[index]![other]!,
          ),
        ) &&
        boxes.every((ink, index) =>
          boxes.every(
            (other, j) => rectangleGap(ink, other) <= pairs[index]![j]!,
          ),
        ) &&
        boxes.every((ink, index) => {
          const siblings = [
            ...fixedBoxes,
            ...boxes.filter((_, other) => other !== index),
          ];
          return (
            !isReported(labels[index]!, ink, siblings) &&
            uncrowdedAt(ink, labels[index]!, siblings) &&
            !context.enclosedAt(ink)
          );
        }) &&
        !between(boxes);
      // Other sides' rows only on a side no lead of the part leaves, as a
      // capacitor's labels stand beside its plates.
      const sideBases = fixed.length
        ? []
        : INSTANCE_LABEL_SIDES.flatMap((side) => {
            const arrangement = onSide(side);
            return arrangement && !onWiredSide(arrangement.map(box))
              ? [{ arrangement, shifts: nearbyShifts(grid, 5) }]
              : [];
          });
      // Only its reported labels to their default rows, the rest kept.
      const reportedHome = group.map((label, index) =>
        reportedIds.has(label.original.id)
          ? preferred[index]!
          : originals[index]!,
      );
      const bases = [
        { arrangement: originals, shifts: nearbyShifts(grid, 10) },
        { arrangement: reportedHome, shifts: nearbyShifts(grid, 5) },
        { arrangement: preferred, shifts: nearbyShifts(grid, 5) },
        ...sideBases,
      ];
      // Nearest first: how far the arrangement stands from the labels, and
      // then how far it is shifted, so a name in its default row is not
      // dragged toward a value moved far off.
      const baseBoxes = bases.map(({ arrangement }) => arrangement.map(box));
      const kept = group.map((label) => !reportedIds.has(label.original.id));
      const candidates = bases.flatMap(({ arrangement, shifts }, base) => {
        const offsets = arrangement.map((label, index) => {
          const p = context.measure(label).position;
          return { x: p.x - from[index]!.x, y: p.y - from[index]!.y };
        });
        return [{ x: 0, y: 0 }, ...shifts].flatMap((shift) => {
          const moves = offsets.map((o) =>
            Math.hypot(o.x + shift.x, o.y + shift.y),
          );
          if (!moves.every((move) => move <= groupReach)) return [];
          // The least move that clears. A label far from its part goes
          // back beside the labels it left, which move least.
          const moved = Math.max(...moves);
          if (!homing) return [{ base, shift, moved, distance: moved, by: 0 }];
          const stay = moves.filter((_, index) => kept[index]);
          const boxes = baseBoxes[base]!.map((b) => ({
            ...b,
            x: b.x + shift.x,
            y: b.y + shift.y,
          }));
          const stayed = boxes.filter((_, index) => kept[index]);
          const by = stayed.length
            ? boxes.reduce(
                (sum, ink, index) =>
                  kept[index]
                    ? sum
                    : sum +
                      Math.min(
                        ...stayed.map((other) => rectangleGap(ink, other)),
                      ),
                0,
              )
            : 0;
          return [{ base, shift, moved, distance: Math.max(0, ...stay), by }];
        });
      });
      candidates.sort(
        (a, b) => a.distance - b.distance || a.by - b.by || a.base - b.base,
      );
      for (const { base, shift, moved } of candidates) {
        if (moved === 0) continue;
        const boxes = baseBoxes[base]!.map((b) => ({
          ...b,
          x: b.x + shift.x,
          y: b.y + shift.y,
        }));
        if (!accepts(boxes, originals)) continue;
        const arrangement = bases[base]!.arrangement.map((label, index) => {
          const position = context.measure(label).position;
          return at(group[index]!, {
            position: { x: position.x + shift.x, y: position.y + shift.y },
            alignment: label.alignment,
          });
        });
        // Placed on the annotation grid, as measured there.
        if (accepts(arrangement.map(box), arrangement)) return arrangement;
      }
      return null;
    };

    // A repair keeps every rule a Gallery dry run found broken (#2619): a
    // part's labels move as one group, nearest where they stand first, only
    // to a place where none meets or crowds a wire, a part, a dot or any
    // other label, beside their own part and nearer it than any other, and
    // its name stays by its value; with no such place they stay.
    if (repairOnly || group.some((label) => label.repair)) {
      const repaired = repairGroup();
      if (!repaired)
        for (const label of group)
          if (label.repair || reportedIds.has(label.original.id))
            left.push({
              labelId: label.original.id,
              instanceId: ownerId,
              reason: "crowded",
            });
      for (const [index, label] of group.entries()) {
        const next = repaired?.[index];
        if (!next || JSON.stringify(next) === JSON.stringify(label.original))
          continue;
        edits.push({ kind: "upsert_schematic_annotation", annotation: next });
        context.accept(next);
      }
      continue;
    }

    // A side asked for comes first; "outside" faces away from the centre
    // line, and a part on it keeps its default rows.
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

    // A part drawn along a horizontal wire, as a ladder's series inductor
    // is, takes the clear side above the wire where under it its labels
    // would stand in a row with a neighbour's: a Chebyshev ladder's names
    // and values read as one run per row, C1 L2 C3 L4 (#1412). Textbooks
    // name a series part over its wire.
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

    // A side crowded at the part's middle may have room further along it.
    // Between two rows of transistors, a part's Reference and W/L fit beside
    // it a little above its middle, clear of both rows' wiring. In a Miller
    // op amp's tight input pair, no side was clear at its middle, so the
    // labels went above the part, and its W/L stood beside the transistor
    // above, read as that one's. The group slides along each side in turn,
    // as far as it stays beside the part.
    if (!clear(best) && sides.length && owner && !options.rowsOnly)
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
        // Reported first, then crowding, as arrangements compare.
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
      // A label the diagnostics would still report takes the nearest spot
      // within a few grid steps where they would not, clear of crowding too
      // when there is one (#1836). A transistor's name beside it stood on its
      // own dashed body tie, six units short of a clear place, between the
      // nudges' steps. Where none is clear the label stays and the warning
      // says so.
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

    // Do not make a cramped original worse just to compact its rows, and
    // leave an earlier arrangement that is still clear where it is, unless
    // a side is asked for.
    const originals = group.map((label) => ({
      ...label.annotation,
      anchor: label.original.anchor,
      alignment: label.original.alignment,
    }));
    const kept = total(originals);
    // A group with a label repaired for includeManual moves only where it
    // meets nothing and no crowding: a telescopic op amp's M3 had been moved
    // onto its drain's junction dot and M7 across its VDD stub, and a summing
    // amplifier's R2 split from its 20kΩ, under R3's (#2619).
    const repairedClear =
      !group.some((label) => label.repair) || clear(total(chosen));
    if (!repairedClear)
      for (const label of group)
        if (label.repair)
          left.push({
            labelId: label.original.id,
            instanceId: ownerId,
            reason: "crowded",
          });
    if (
      better(kept, total(chosen)) ||
      !repairedClear ||
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
  edits.push(
    ...followHiddenMultipliers(),
    ...arrangePinNames(),
    ...arrangeSupplyNames(),
  );
  // A repair names every label still reported that it left: those it
  // could not clear, and Net labels, free text and names it does not move.
  if (repairOnly) {
    const moved = new Set(
      edits.flatMap((edit) =>
        edit.kind === "upsert_schematic_annotation" ? [edit.annotation.id] : [],
      ),
    );
    const named = new Set(left.map((label) => label.labelId));
    for (const label of context.visible) {
      if (
        !reportedIds.has(label.id) ||
        moved.has(label.id) ||
        named.has(label.id)
      )
        continue;
      const anchored = owners.get(label.id);
      const owner =
        anchored && document.instances.some((item) => item.id === anchored)
          ? anchored
          : null;
      if (owner !== null && !ids.has(owner)) continue;
      if (!reportedLabel(label)) continue;
      left.push({
        labelId: label.id,
        instanceId: owner,
        reason: owner !== null && frozen.has(owner) ? "crowded" : "unarranged",
      });
    }
  }
  return {
    edits,
    leftInPlace: left,
    broken: repairOnly ? brokenAlignments() : [],
  };

  /**
   * Parts whose repaired labels left a row or a mirror they stood in with
   * like parts' labels: parts of one kind level with each other and their
   * same labels the same way beside them, or mirrored about the pair. Of
   * two, the one moved further. A repair had lifted five of a row of six
   * resistors' values, and moved one of a mirrored pair's names under its
   * transistor (#2619).
   */
  function brokenAlignments(): string[] {
    // Labels within half a grid step of alike stand in a row; one kept
    // there stays within a quarter step, or as near as it was.
    const tolerance = grid / 4;
    const alikeWithin = grid / 2;
    const bodies = new Map(context.symbols.map((s) => [s.id, s.bounds]));
    const instances = new Map(document.instances.map((i) => [i.id, i]));
    const byKind = new Map<
      string,
      { instanceId: string; c: Point; was: Point; now: Point; moved: number }[]
    >();
    for (const label of context.visible) {
      const part = partLabels.get(label.id);
      const instance = part && instances.get(part.instanceId);
      const body = part && bodies.get(part.instanceId);
      if (!part || !instance || !body) continue;
      const before = context.measure(label).inkBounds;
      const after = context.labelBounds(label.id) ?? before;
      const c = centre(body);
      const b = centre(before);
      const a = centre(after);
      const key = `${instance.symbolId}\n${part.kind}`;
      const entries = byKind.get(key) ?? [];
      byKind.set(key, entries);
      entries.push({
        instanceId: part.instanceId,
        c,
        was: { x: b.x - c.x, y: b.y - c.y },
        now: { x: a.x - c.x, y: a.y - c.y },
        moved: Math.hypot(a.x - b.x, a.y - b.y),
      });
    }
    const same = (u: number, v: number) => Math.abs(u - v) <= alikeWithin;
    const kept = (now: number, was: number) =>
      Math.abs(now) <= Math.max(tolerance, Math.abs(was));
    const broken = new Set<string>();
    for (const entries of byKind.values())
      for (const [index, p] of entries.entries())
        for (const q of entries.slice(index + 1)) {
          if (!p.moved && !q.moved) continue;
          const level = same(p.c.y, q.c.y);
          const column = same(p.c.x, q.c.x);
          const alike = same(p.was.x, q.was.x) && same(p.was.y, q.was.y);
          // A row's or a column's labels keep the same place by their parts.
          const lineKept =
            !((level || column) && alike) ||
            (kept(p.now.x - q.now.x, p.was.x - q.was.x) &&
              kept(p.now.y - q.now.y, p.was.y - q.was.y));
          const mirroredX =
            level &&
            Math.abs(p.was.x) > tolerance &&
            same(p.was.x, -q.was.x) &&
            same(p.was.y, q.was.y);
          const mirroredY =
            column &&
            Math.abs(p.was.y) > tolerance &&
            same(p.was.y, -q.was.y) &&
            same(p.was.x, q.was.x);
          const mirrorKept =
            (!mirroredX ||
              (kept(p.now.x + q.now.x, p.was.x + q.was.x) &&
                kept(p.now.y - q.now.y, p.was.y - q.was.y))) &&
            (!mirroredY ||
              (kept(p.now.y + q.now.y, p.was.y + q.was.y) &&
                kept(p.now.x - q.now.x, p.was.x - q.was.x)));
          if (lineKept && mirrorKept) continue;
          if (p.moved >= q.moved) broken.add(p.instanceId);
          if (q.moved >= p.moved) broken.add(q.instanceId);
        }
    return [...broken].filter(
      (id) => !frozen.has(id) && lightlyReported.has(id),
    );
  }

  /**
   * A VDD marker's supply name, asked for with `side:"top"`, centred over
   * its bar half a grid step clear of it, as the Gallery's house style and
   * textbook figures draw it; `side:"right"` puts it back beside the bar
   * (#1528). Agents had moved it by a guessed offset, or not found it at all.
   * An arranged name reads upright; one turned upside down is set upright
   * even with no side asked, over the bar for `top`, else beside (#2290).
   */
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
      if (repairOnly) return repairSupplyName(instance, resolved, found);
      // An arranged supply name reads upright.
      const upsideDown = found.rotation > 90 && found.rotation < 270;
      const name: Annotation = { ...found, rotation: 0 };
      // A VDD name beside its bar drawn over the next part goes over its bar
      // where that is clear: a comparator's VDD names ran onto the next
      // column's bar (#2346).
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
        next = annotationAt(name, beside);
      } else if (!bar) return [];
      else {
        const clearOfBar = bar.y - grid / 2;
        const over = annotationAt(name, {
          position: { x: bar.x + bar.width / 2, y: clearOfBar },
          alignment: "middle",
        });
        const ink = context.measure(over).inkBounds;
        next = annotationAt(over, {
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

  /**
   * A repair's supply name: a reported VDD name goes over its bar or back
   * beside it, whichever is wholly clear, or stays; it is never turned. A
   * repair had moved VDD names across a neighbour's labels (#2619).
   */
  /** Whether a supply name stands over its bar rather than beside it. */
  function isOverBar(name: Annotation, bar: Rect): boolean {
    const ink = box(name);
    return (
      ink.y + ink.height <= bar.y + 1 &&
      ink.x < bar.x + bar.width &&
      ink.x + ink.width > bar.x
    );
  }

  /** How many of the drawing's VDD names stand over their bar, or beside. */
  function supplyNamesOver(): { over: number; beside: number } {
    if (supplyWays) return supplyWays;
    const ways = { over: 0, beside: 0 };
    for (const instance of document.instances) {
      if (instance.symbolId !== "vdd-port") continue;
      const bar = context.symbols.find((s) => s.id === instance.id)?.bounds;
      const name = context.visible.find(
        (a) =>
          a.kind === "power-label" &&
          a.anchor.kind === "object" &&
          a.anchor.objectId === instance.id,
      );
      if (!bar || !name) continue;
      if (isOverBar(name, bar)) ways.over += 1;
      else ways.beside += 1;
    }
    return (supplyWays = ways);
  }

  function repairSupplyName(
    instance: SchematicDocument["instances"][number],
    resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
    found: Annotation,
  ): SchematicEdit[] {
    const bar = context.symbols.find(
      (symbol) => symbol.id === instance.id,
    )?.bounds;
    if (
      !reportedIds.has(found.id) ||
      instance.symbolId !== "vdd-port" ||
      found.rotation !== 0 ||
      !bar
    )
      return [];
    const beside = defaultVddPowerLabelPlacement(instance, resolved, grid);
    const clearOfBar = bar.y - grid / 2;
    const over = annotationAt(found, {
      position: { x: bar.x + bar.width / 2, y: clearOfBar },
      alignment: "middle",
    });
    const overInk = context.measure(over).inkBounds;
    const overBar = annotationAt(over, {
      position: {
        x: bar.x + bar.width / 2,
        y: clearOfBar - (overInk.y + overInk.height - clearOfBar),
      },
      alignment: "middle",
    });
    // Only the way most of the drawing's VDD names stand, over their bar
    // or beside it, or this one's own on a tie: a repair had turned one
    // row's VDD over its bar, every other beside its own (#2619).
    const overs = supplyNamesOver();
    const way =
      overs.over === overs.beside
        ? isOverBar(found, bar)
        : overs.over > overs.beside;
    const places = way
      ? [overBar]
      : beside
        ? [annotationAt(found, beside)]
        : [];
    // Nearer its own bar than any other part, as a part's labels stand.
    const owned = (place: Annotation) => {
      const ink = box(place);
      const own = rectangleGap(ink, bar);
      return context.symbols.every(
        (symbol) =>
          symbol.id === instance.id || rectangleGap(ink, symbol.bounds) > own,
      );
    };
    const next = places.find(
      (place) =>
        JSON.stringify(place) !== JSON.stringify(found) &&
        !context.conflicts(place).length &&
        context.clearAt(place) &&
        owned(place),
    );
    if (!next) return [];
    context.accept(next);
    return [{ kind: "upsert_schematic_annotation", annotation: next }];
  }

  /**
   * A ×m that a shown W/L prints itself is hidden (#1423), and so is one
   * switched off; this pass moves only what is drawn. When it moved a part's
   * labels, the ×m stayed in its old slot and showed there, away from them,
   * once the W/L was hidden. Now it moves with them (#1434) to where it is
   * placed: a text row under the name beside or below the part, and the
   * W/L's place, nearest the part, above it or with no name drawn. Above
   * the part a name arranged without its W/L takes that row itself, so
   * there the ×m stays. Only one still where it was placed follows (any,
   * with includeManual); a locked, turned or custom ×m stays where it is,
   * as visible labels do.
   */
  function followHiddenMultipliers(): SchematicEdit[] {
    const arranged = new Map(
      edits.flatMap((edit) =>
        edit.kind === "upsert_schematic_annotation"
          ? [[edit.annotation.id, edit.annotation] as const]
          : [],
      ),
    );
    const placeOf = (annotation: Annotation): InstanceLabelPlacement => {
      const { position, alignment } = context.measure(annotation);
      return { position, alignment };
    };
    const followed: SchematicEdit[] = [];
    for (const [id, group] of groups) {
      const instance = document.instances.find((item) => item.id === id)!;
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      const drawn = ownLabels.get(id) ?? [];
      const name = drawn.find(
        (label) => label.binding?.kind === "instance-reference",
      );
      const value = drawn.find(
        (label) =>
          label.binding?.kind === "instance-value" &&
          label.binding.parameter === undefined,
      );
      const lead = name ?? value;
      const moved = lead && arranged.get(lead.id);
      // A name only restyled stays where it stood, and so does its ×m.
      if (
        !resolved ||
        !lead ||
        !moved ||
        offsetFromPlacement(placeOf(moved), placeOf(lead))
      )
        continue;
      const owner = context.symbols.find((symbol) => symbol.id === id)?.bounds;
      // Above the part, not slid up along a side: labels over or under a
      // part are centred on it, and beside it they start or end there.
      const above =
        name !== undefined &&
        owner !== undefined &&
        moved.alignment === "middle" &&
        box(moved).y + box(moved).height <= owner.y;
      // The W/L's place, where it stands now, when it was arranged too.
      const valueNow =
        value &&
        group.some((label) => label.original.id === value.id) &&
        (arranged.get(value.id) ?? value);
      if (above && !valueNow) continue;
      for (const label of document.annotations) {
        const parameter = multiplierLabel(label, instance, resolver);
        if (
          parameter === undefined ||
          label.anchor.kind !== "object" ||
          label.anchor.objectId !== id ||
          context.visible.includes(label) ||
          label.locked ||
          label.rotation !== 0 ||
          label.content ||
          label.formatOverride
        )
          continue;
        const style = objectStyleProfile(documentProfile, label);
        const below = (
          annotation: Annotation,
          row: number,
        ): InstanceLabelPlacement => {
          const { position, alignment } = placeOf(annotation);
          return {
            position: { x: position.x, y: position.y + row },
            alignment,
          };
        };
        const row = instanceLabelRowOffset(style, grid);
        // Where it was placed: its own slot, the W/L's place, or under the
        // name, a text row or the W/L's row where an arrangement showed it
        // as the value.
        const places = [
          defaultInstanceParameterLabelPlacement(
            instance,
            resolved,
            style,
            grid,
            parameter,
            resolver,
          ),
          ...(value ? [placeOf(value)] : []),
          ...(name
            ? [
                below(name, row),
                below(
                  name,
                  instanceValueRowOffset(instance.symbolId, style, grid),
                ),
              ]
            : []),
        ];
        if (
          options.includeManual !== true &&
          !places.some((place) => offsetFromPlacement(placeOf(label), place))
        )
          continue;
        const target =
          name && !above ? below(moved, row) : valueNow && placeOf(valueNow);
        if (!target) continue;
        const next = annotationAt(label, target);
        if (JSON.stringify(next) !== JSON.stringify(label))
          followed.push({
            kind: "upsert_schematic_annotation",
            annotation: next,
          });
      }
    }
    return followed;
  }

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
        label.rotation !== 0 ||
        (repairOnly && !reportedIds.has(label.id))
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
      // A repair turns a reported name to a side of its Pin's end that is
      // wholly clear, or leaves it: an input's v_in⁻ had been moved onto
      // the transistor beside its Port, fewer conflicts than on its wire
      // (#2619).
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
      if (repairOnly) {
        const clearSide = candidates
          .map(onSide)
          .find(
            (placed) =>
              !context.conflicts(placed).length && context.clearAt(placed),
          );
        if (clearSide && JSON.stringify(clearSide) !== JSON.stringify(label)) {
          changed.push({
            kind: "upsert_schematic_annotation",
            annotation: clearSide,
          });
          context.accept(clearSide);
        }
        continue;
      }
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

const shiftsByGrid = new Map<number, readonly Point[]>();
/**
 * Shifts of a label within `reach` fifths of a grid step (three steps by
 * default), a fifth of a step apart, nearest first: where a label the
 * diagnostics report looks for a clear spot.
 */
function nearbyShifts(grid: number, reach = 15): readonly Point[] {
  const key = grid * 1000 + reach;
  let shifts = shiftsByGrid.get(key);
  if (!shifts) {
    const step = grid / 5;
    const all: Point[] = [];
    for (let x = -reach; x <= reach; x++)
      for (let y = -reach; y <= reach; y++)
        if (x || y) all.push({ x: x * step, y: y * step });
    shifts = all.sort(
      (a, b) =>
        Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.y - b.y || a.x - b.x,
    );
    shiftsByGrid.set(key, shifts);
  }
  return shifts;
}

/**
 * How far, in grid steps, a repaired label may stand from its own part: a
 * group's two rows above it. A repair had moved a block's name 270 units,
 * and names onto the next transistor's side (#2619).
 */
const OWNER_REACH_STEPS = 2;
/** How much nearer another part a label may stand than its own part. */
const ASSOCIATION_MARGIN = 5;
/** Least gaps between a label and its part's own wires, as between two
 * labels: a word space before or after it, a line space above or below. */
const OWN_WIRE_SPACE = 4;
const OWN_WIRE_LINE_SPACE = 1;

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

/**
 * The parameter of a MOS's ×m label, which its W/L prints while shown
 * (#1423), or undefined.
 */
function multiplierLabel(
  label: Annotation,
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): string | undefined {
  const binding = label.binding;
  return binding?.kind === "instance-value" &&
    binding.parameter !== undefined &&
    valuePrintsMultiplier(instance, binding.parameter, resolver)
    ? binding.parameter
    : undefined;
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

/** The box around every one of `boxes`. */
function union(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

function centre(box: Rect): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** `box` grown by `by` on every side. */
function grown(box: Rect, by: number): Rect {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  };
}

/** Gap between a point and a box, 0 inside it. */
function pointGap(point: Point, box: Rect): number {
  return Math.hypot(
    Math.max(0, box.x - point.x, point.x - box.x - box.width),
    Math.max(0, box.y - point.y, point.y - box.y - box.height),
  );
}
