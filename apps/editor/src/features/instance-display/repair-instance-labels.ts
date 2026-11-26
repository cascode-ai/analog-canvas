import {
  canonicalPortTextDocument,
  isRoleLabelFormat,
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
  resolveDocumentStyleProfile,
  resolveEndpointPoint,
  uniformRowDefaultInstanceLabelPlacement,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
  type InstanceLabelSlot,
  type SchematicStyleProfile,
} from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import type { SchematicEdit } from "@icm/edit-engine";
import type { ResolvedSymbol, SymbolResolver } from "@icm/symbols";
import {
  annotationAt,
  ASSOCIATION_MARGIN,
  centre,
  CHARACTER_EM,
  followHiddenMultiplierEdits,
  grown,
  isCellNameLabel,
  multiplierLabel,
  nearbyShifts,
  OWN_WIRE_LINE_SPACE,
  OWN_WIRE_SPACE,
  OWNER_REACH_STEPS,
  overlap,
  partLabelOf,
  pointGap,
  readOrder,
  readsAfter,
  rectangleGap,
  sameRow,
  sidesOf,
  union,
  type LabelClearanceContext,
} from "./label-geometry";

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

export interface RepairInstanceLabelsOptions {
  referenceStyle?: "preserve" | "first-letter-subscript" | undefined;
  /**
   * When true, a repair may hide a visible value display (`visible: false`,
   * netlist parameters untouched) as a last resort when the value directly
   * collides with another label and no placement fits name + value cleanly.
   */
  hideCrowdedValues?: boolean | undefined;
}

export interface RepairInstanceLabelsResult {
  edits: SchematicEdit[];
  leftInPlace: LabelLeftInPlace[];
  /** Value annotations hidden as a last resort to resolve severe collisions. */
  hiddenValueIds: string[];
}

const DEFAULT_RULES: readonly (typeof defaultInstanceLabelPlacement)[] = [
  defaultInstanceLabelPlacement,
  outwardDefaultInstanceLabelPlacement,
  uniformRowDefaultInstanceLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  legacyDefaultInstanceLabelPlacement,
];

const DEFAULT_SLOTS: Readonly<
  Record<"reference" | "value", readonly InstanceLabelSlot[]>
> = {
  reference: ["reference", "reference-over-value"],
  value: ["value"],
};

interface MovableLabel {
  readonly original: Annotation;
  readonly annotation: Annotation;
  readonly slot: "reference" | "value";
  readonly compact: boolean;
  readonly sizeScale: number;
  readonly isDefaultSlot: boolean;
}

interface WiredSides {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

interface PartRecord {
  readonly instance: SchematicDocument["instances"][number];
  readonly resolved: ResolvedSymbol;
  readonly body: Rect;
  readonly inScope: boolean;
  readonly movable: readonly MovableLabel[];
  readonly fixed: readonly Annotation[];
  readonly ownLabels: readonly Annotation[];
  readonly ownWires: readonly string[];
  readonly wiredSides: WiredSides;
  readonly reported: boolean;
  /** Struck by a wire/part/own outline, overlapped, run-on, or far from owner. */
  readonly struckOrSevere: boolean;
  /** Struck by another object, overlapped, run-on, or far from owner. */
  readonly severe: boolean;
  /** Visible value directly overlaps or runs on into another label. */
  readonly valueCollidesLabel: boolean;
  readonly homing: boolean;
  readonly primaryRel: Point | null;
}

type Cohort =
  | {
      readonly kind: "mirror-pair";
      readonly axis: "horizontal" | "vertical";
      readonly members: readonly [PartRecord, PartRecord];
    }
  | {
      readonly kind: "row" | "column";
      readonly members: readonly PartRecord[];
    }
  | {
      readonly kind: "single";
      readonly members: readonly [PartRecord];
    };

interface RepairEnv {
  readonly document: SchematicDocument;
  readonly resolver: SymbolResolver;
  readonly context: LabelClearanceContext;
  readonly documentProfile: SchematicStyleProfile;
  readonly grid: number;
  readonly partLabels: ReadonlyMap<
    string,
    { instanceId: string; kind: "instance-reference" | "instance-value" }
  >;
  readonly owners: ReadonlyMap<string, string>;
  readonly reportedIds: ReadonlySet<string>;
  readonly pinEnds: readonly { instanceId: string; at: Point }[];
  readonly box: (annotation: Annotation) => Rect;
  readonly findingsOf: (
    label: Annotation,
  ) => ReturnType<LabelClearanceContext["findingsAt"]>;
  readonly isSevereLabel: (label: Annotation) => boolean;
}

/**
 * Principled, cohort-first label repair planner (`includeManual: true`).
 *
 * Repairs only parts with reported label clearance/crowding/overlap issues
 * (plus aligned or mirrored cohort peers moving flush with them), keeping:
 *   1. Structural symmetry & alignment (parallel/mirrored pairs and rows/columns
 *      move jointly or stay intact — never half-moved out of line).
 *   2. Outward placement for inward-facing colliding pairs (e.g. parallel loads).
 *   3. Unambiguous ownership, neighbour/wire/row clearance, and name-before-value
 *      coherence; crossing to a clean unwired side only for severe clashes.
 *   4. Last-resort hiding of a severely colliding value display (netlist
 *      untouched) when no placement fits name + value cleanly.
 *   5. Consistent VDD orientation and endpoint-bound Port turns.
 */
export function repairInstanceLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  options: RepairInstanceLabelsOptions = {},
): RepairInstanceLabelsResult {
  const ids = new Set(instanceIds);
  for (const id of ids)
    if (!document.instances.some((i) => i.id === id))
      throw new Error(`Instance not found: ${id}`);

  const env = buildRepairEnv(document, resolver);
  const left: LabelLeftInPlace[] = [];
  const hiddenValueIds: string[] = [];
  const edits: SchematicEdit[] = [];

  // Stage 1: Collect all placed parts with visible labels & classify eligibility.
  const parts = collectPartRecords(env, ids, options, left);
  const ownLabelsMap = new Map<string, readonly Annotation[]>(
    parts.map((p) => [p.instance.id, p.ownLabels]),
  );

  // Stage 2: Detect structural cohorts (mirror pairs, aligned rows/columns, singletons).
  const cohorts = detectCohorts(parts, env);

  // Stage 3: Plan each cohort jointly; accept only all-or-nothing flush/symmetric repairs.
  const allowHideValues = options.hideCrowdedValues === true;
  const movedPartIds = new Set<string>();
  const arrangedGroupIds = new Map<string, ReadonlySet<string>>();
  for (const cohort of cohorts) {
    const planned = planCohort(cohort, env, allowHideValues);
    if (planned) {
      for (const item of planned.updates) {
        if (JSON.stringify(item.next) === JSON.stringify(item.original))
          continue;
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: item.next,
        });
        env.context.accept(item.next);
        movedPartIds.add(item.instanceId);
      }
      for (const id of planned.hiddenValueIds) hiddenValueIds.push(id);
      for (const member of cohort.members)
        arrangedGroupIds.set(
          member.instance.id,
          new Set(member.movable.map((l) => l.original.id)),
        );
    } else {
      for (const member of cohort.members) {
        if (!member.inScope || !member.reported) continue;
        for (const label of member.movable)
          if (env.reportedIds.has(label.original.id))
            left.push({
              labelId: label.original.id,
              instanceId: member.instance.id,
              reason: "crowded",
            });
      }
    }
  }

  // Record hand-moved clear labels of unreported parts that stayed untouched.
  for (const part of parts) {
    if (!part.inScope || part.reported || movedPartIds.has(part.instance.id))
      continue;
    for (const label of part.movable)
      if (!label.isDefaultSlot)
        left.push({
          labelId: label.original.id,
          instanceId: part.instance.id,
          reason: "clear",
        });
  }

  // Stage 4: Hidden ×m follow-up, Port turns, and consistent VDD placement.
  edits.push(
    ...followHiddenMultiplierEdits({
      document,
      resolver,
      context: env.context,
      documentProfile: env.documentProfile,
      grid: env.grid,
      edits,
      ownLabels: ownLabelsMap,
      arrangedGroupIds,
      includeManual: true,
    }),
    ...repairPinNames(env, ids, options),
    ...repairSupplyNames(env, ids),
  );

  // Name every remaining visible reported label that stayed in place.
  const touchedIds = new Set(
    edits.flatMap((edit) =>
      edit.kind === "upsert_schematic_annotation" ? [edit.annotation.id] : [],
    ),
  );
  const namedIds = new Set(left.map((item) => item.labelId));
  const hiddenSet = new Set(hiddenValueIds);
  for (const label of env.context.visible) {
    if (
      !env.reportedIds.has(label.id) ||
      touchedIds.has(label.id) ||
      namedIds.has(label.id) ||
      hiddenSet.has(label.id)
    )
      continue;
    const anchored = env.owners.get(label.id);
    const owner =
      anchored && document.instances.some((item) => item.id === anchored)
        ? anchored
        : null;
    if (owner !== null && !ids.has(owner)) continue;
    if (env.context.clearAt(label)) continue;
    left.push({ labelId: label.id, instanceId: owner, reason: "unarranged" });
  }

  return { edits, leftInPlace: left, hiddenValueIds };
}

/**
 * Single-part repair helper reused by `textbook` preset (`repairManual: true`)
 * so hand-moved reported labels follow the exact same geometry & clearance rules.
 */
export function repairManualSinglePart(args: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  context: LabelClearanceContext;
  documentProfile: SchematicStyleProfile;
  instance: SchematicDocument["instances"][number];
  resolved: ResolvedSymbol;
  movable: readonly {
    readonly original: Annotation;
    readonly annotation: Annotation;
    readonly slot: "reference" | "value";
    readonly compact: boolean;
    readonly sizeScale: number;
  }[];
  fixed: readonly Annotation[];
}): Annotation[] | null {
  const {
    document,
    resolver,
    context,
    documentProfile,
    instance,
    resolved,
    movable,
    fixed,
  } = args;
  const body = context.symbols.find((s) => s.id === instance.id)?.bounds;
  if (!body || !movable.length) return null;
  const env = buildRepairEnv(document, resolver, context, documentProfile);
  const ownLabels = [...movable.map((l) => l.original), ...fixed];
  const wiredSides = computeWiredSides(env, instance.id, body);
  const labels: MovableLabel[] = movable.map((l) => ({
    ...l,
    isDefaultSlot: false,
  }));
  const reported = labels.some((l) => env.reportedIds.has(l.original.id));
  if (!reported) return null;
  const struckOrSevere = labels.some(
    (l) =>
      env.reportedIds.has(l.original.id) &&
      (env.findingsOf(l.original).struck.length > 0 ||
        env.isSevereLabel(l.original)),
  );
  const severe = labels.some(
    (l) => env.reportedIds.has(l.original.id) && env.isSevereLabel(l.original),
  );
  const homing = labels.some(
    (l) =>
      env.reportedIds.has(l.original.id) &&
      env.findingsOf(l.original).ownerGap !== undefined,
  );
  const part: PartRecord = {
    instance,
    resolved,
    body,
    inScope: true,
    movable: labels,
    fixed,
    ownLabels,
    ownWires: ownWiresOf(document, instance.id),
    wiredSides,
    reported,
    struckOrSevere,
    severe,
    valueCollidesLabel: false,
    homing,
    primaryRel: null,
  };
  const planned = planSinglePart(part, env, false);
  if (!planned) return null;
  return labels.map(
    (l) =>
      planned.updates.find((u) => u.original.id === l.original.id)?.next ??
      l.annotation,
  );
}

/* -------------------------------------------------------------------------- */
/* Stage 1: Environment & Part Record Construction                             */
/* -------------------------------------------------------------------------- */

function buildRepairEnv(
  document: SchematicDocument,
  resolver: SymbolResolver,
  existingContext?: LabelClearanceContext,
  existingProfile?: SchematicStyleProfile,
): RepairEnv {
  const context =
    existingContext ?? createLabelClearanceContext(document, resolver);
  const documentProfile =
    existingProfile ?? resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const box = (annotation: Annotation): Rect =>
    context.measure(annotation).inkBounds;

  const partLabels = new Map(
    context.visible.flatMap((label) => {
      const part = partLabelOf(label, context.visible);
      return part ? [[label.id, part] as const] : [];
    }),
  );
  const owners = new Map(
    context.visible.flatMap((label) => {
      const owner =
        partLabels.get(label.id)?.instanceId ??
        (label.anchor.kind === "object" ? label.anchor.objectId : undefined);
      return owner ? [[label.id, owner] as const] : [];
    }),
  );
  const findingsCache = new Map<
    string,
    ReturnType<LabelClearanceContext["findingsAt"]>
  >();
  const findingsOf = (label: Annotation) => {
    let found = findingsCache.get(label.id);
    if (!found) {
      found = context.findingsAt(label);
      findingsCache.set(label.id, found);
    }
    return found;
  };
  const reportedIds = new Set(
    context.visible
      .filter((label) => !context.clearAt(label))
      .map((label) => label.id),
  );
  const isSevereLabel = (label: Annotation) => {
    const found = findingsOf(label);
    const own = owners.get(label.id);
    return (
      found.overlapped.length > 0 ||
      found.runsOn.length > 0 ||
      found.ownerGap !== undefined ||
      found.struck.some((id) => id !== own)
    );
  };
  const pinEnds = document.instances.flatMap((instance) =>
    instance.placement
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

  return {
    document,
    resolver,
    context,
    documentProfile,
    grid,
    partLabels,
    owners,
    reportedIds,
    pinEnds,
    box,
    findingsOf,
    isSevereLabel,
  };
}

function ownWiresOf(document: SchematicDocument, instanceId: string): string[] {
  return document.routes
    .filter((route) =>
      routeEndpoints(route).some(
        (end) => end.kind === "terminal" && end.instanceId === instanceId,
      ),
    )
    .map((route) => route.id);
}

function computeWiredSides(
  env: RepairEnv,
  instanceId: string,
  body: Rect,
): WiredSides {
  const ownEnds = env.pinEnds.filter((e) => e.instanceId === instanceId);
  return {
    left: ownEnds.some(({ at }) => at.x <= body.x + 1),
    right: ownEnds.some(({ at }) => at.x >= body.x + body.width - 1),
    top: ownEnds.some(({ at }) => at.y <= body.y + 1),
    bottom: ownEnds.some(({ at }) => at.y >= body.y + body.height - 1),
  };
}

function collectPartRecords(
  env: RepairEnv,
  inScopeIds: ReadonlySet<string>,
  options: RepairInstanceLabelsOptions,
  left: LabelLeftInPlace[],
): PartRecord[] {
  const { document, resolver, context, documentProfile, grid, partLabels } =
    env;
  const byOwner = new Map<string, Annotation[]>();
  for (const label of context.visible) {
    if (label.anchor.kind !== "object") continue;
    const part = partLabels.get(label.id);
    if (!part || part.instanceId !== label.anchor.objectId) continue;
    const list = byOwner.get(part.instanceId) ?? [];
    list.push(label);
    byOwner.set(part.instanceId, list);
  }

  const records: PartRecord[] = [];
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const rawLabels = byOwner.get(instance.id);
    if (!rawLabels?.length) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    const body = context.symbols.find((s) => s.id === instance.id)?.bounds;
    if (!resolved || !body) continue;

    const inScope = inScopeIds.has(instance.id);
    const movable: MovableLabel[] = [];
    const fixed: Annotation[] = [];
    const ownLabels: Annotation[] = [];

    for (const original of rawLabels) {
      const part = partLabels.get(original.id)!;
      const cellName = isCellNameLabel(original);
      if (cellName) {
        if (inScope && env.reportedIds.has(original.id))
          left.push({
            labelId: original.id,
            instanceId: instance.id,
            reason: "unarranged",
          });
        continue;
      }
      ownLabels.push(original);
      const recordLeft = (reason: LabelLeftInPlace["reason"]) => {
        if (inScope)
          left.push({ labelId: original.id, instanceId: instance.id, reason });
        fixed.push(original);
      };
      if (original.locked) {
        recordLeft("locked");
        continue;
      }
      if (original.rotation !== 0) {
        recordLeft("rotated");
        continue;
      }
      const reference = part.kind === "instance-reference";
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
      ) {
        recordLeft("custom");
        continue;
      }
      const style = objectStyleProfile(documentProfile, original);
      const slot = reference ? "reference" : "value";
      const sizeScale = original.sizeScale ?? 1;
      const alone =
        !reference &&
        !rawLabels.some((a) => a.binding?.kind === "instance-reference");
      const current = context.measure(original).position;
      const drawn = { position: current, alignment: original.alignment };
      const atDefault = (inSlot: "reference" | "value") =>
        DEFAULT_RULES.some((place) =>
          DEFAULT_SLOTS[inSlot].some((placeSlot) =>
            offsetFromPlacement(
              drawn,
              place(instance, resolved, style, grid, placeSlot, sizeScale),
            ),
          ),
        );
      const mult = multiplierLabel(original, instance, resolver);
      const inOwnSlot =
        mult !== undefined &&
        offsetFromPlacement(
          drawn,
          defaultInstanceParameterLabelPlacement(
            instance,
            resolved,
            style,
            grid,
            mult,
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
      const isDefaultSlot =
        atDefault(slot) ||
        (alone && atDefault("reference")) ||
        inOwnSlot ||
        inSideRows ||
        isStackedValueFirst(document, instance, resolved, rawLabels, grid);

      const annotation =
        reference &&
        options.referenceStyle === "first-letter-subscript" &&
        /^[A-Za-z][A-Za-z0-9]+$/.test(instance.reference ?? "")
          ? {
              ...original,
              formatOverride: canonicalPortTextDocument(instance.reference!),
            }
          : original;

      movable.push({
        original,
        annotation,
        slot,
        compact: alone,
        sizeScale,
        isDefaultSlot,
      });
    }

    if (!movable.length && !fixed.length) continue;
    const reported = movable.some((l) => env.reportedIds.has(l.original.id));
    const struckOrSevere = movable.some(
      (l) =>
        env.reportedIds.has(l.original.id) &&
        (env.findingsOf(l.original).struck.length > 0 ||
          env.isSevereLabel(l.original)),
    );
    const severe = movable.some(
      (l) =>
        env.reportedIds.has(l.original.id) && env.isSevereLabel(l.original),
    );
    const valueCollidesLabel = movable.some((l) => {
      if (l.slot !== "value" || !env.reportedIds.has(l.original.id))
        return false;
      const f = env.findingsOf(l.original);
      return f.overlapped.length > 0 || f.runsOn.length > 0;
    });
    const homing = movable.some(
      (l) =>
        env.reportedIds.has(l.original.id) &&
        env.findingsOf(l.original).ownerGap !== undefined,
    );
    const primary =
      movable.find((l) => l.slot === "reference")?.original ??
      movable[0]?.original ??
      fixed[0];
    // Anchor/baseline position relative to part centre: invariant to label text
    // width, so aligned rows (R1 vs R10) and mirror pairs (M1 vs M12) match
    // cleanly regardless of how many digits their names have.
    const primaryRel = primary
      ? {
          x: context.measure(primary).position.x - centre(body).x,
          y: context.measure(primary).position.y - centre(body).y,
        }
      : null;

    records.push({
      instance,
      resolved,
      body,
      inScope,
      movable,
      fixed,
      ownLabels,
      ownWires: ownWiresOf(document, instance.id),
      wiredSides: computeWiredSides(env, instance.id, body),
      reported,
      struckOrSevere,
      severe,
      valueCollidesLabel,
      homing,
      primaryRel,
    });
  }
  return records;
}

function isStackedValueFirst(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  ownLabels: readonly Annotation[],
  grid: number,
): boolean {
  const origin = instance.placement?.position;
  if (!origin) return false;
  const name = ownLabels.find((l) => l.binding?.kind === "instance-reference");
  const value = ownLabels.find((l) => l.binding?.kind === "instance-value");
  const nameLabel = name && instanceGroupLabel(document, name, origin);
  const valueLabel = value && instanceGroupLabel(document, value, origin);
  return Boolean(
    nameLabel &&
    valueLabel &&
    instanceLabelGroupSeat(instance, resolved, grid, nameLabel, valueLabel, {
      stacks: "value-over-name",
      slides: false,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Stage 2: Structural Cohort Detection                                        */
/* -------------------------------------------------------------------------- */

function detectCohorts(parts: readonly PartRecord[], env: RepairEnv): Cohort[] {
  const { grid } = env;
  const alikeTol = grid / 2;
  const assigned = new Set<string>();
  const cohorts: Cohort[] = [];

  const bySymbol = new Map<string, PartRecord[]>();
  for (const part of parts) {
    if (!part.primaryRel) continue;
    const bucket = bySymbol.get(part.instance.symbolId) ?? [];
    bucket.push(part);
    bySymbol.set(part.instance.symbolId, bucket);
  }

  const sameCoord = (a: number, b: number) => Math.abs(a - b) <= alikeTol;
  const sameSlotShape = (a: PartRecord, b: PartRecord) =>
    a.movable.length === b.movable.length &&
    a.movable.every((l, i) => l.slot === b.movable[i]?.slot);

  const labelsCollide = (a: PartRecord, b: PartRecord): boolean => {
    const bIds = new Set(b.ownLabels.map((l) => l.id));
    for (const label of a.ownLabels) {
      const f = env.findingsOf(label);
      if (
        f.overlapped.some((id) => bIds.has(id)) ||
        f.runsOn.some((id) => bIds.has(id))
      )
        return true;
    }
    return false;
  };

  // Step 2A: Mirror pairs (horizontal first, then vertical).
  for (const group of bySymbol.values()) {
    // Horizontal rows of same symbolId
    const rows = clusterByCoord(group, (p) => centre(p.body).y, alikeTol);
    for (const row of rows) {
      row.sort((a, b) => centre(a.body).x - centre(b.body).x);
      for (let i = 0; i < row.length - 1; i++) {
        const left = row[i]!;
        const right = row[i + 1]!;
        if (assigned.has(left.instance.id) || assigned.has(right.instance.id))
          continue;
        if (!left.reported && !right.reported) continue;
        const dx = centre(right.body).x - centre(left.body).x;
        const maxSpan = Math.max(
          grid * 24,
          8 * Math.max(left.body.width, right.body.width),
        );
        if (dx > maxSpan) continue;
        const rl = left.primaryRel!;
        const rr = right.primaryRel!;
        const labelsMirrored =
          Math.abs(rl.x) > grid / 4 &&
          sameCoord(rl.x, -rr.x) &&
          sameCoord(rl.y, rr.y);
        const symbolsMirrored =
          left.instance.placement?.rotation ===
            right.instance.placement?.rotation &&
          left.instance.placement?.mirror !==
            right.instance.placement?.mirror &&
          sameCoord(rl.y, rr.y) &&
          // Avoid pairing across a wide unrelated gap if a closer neighbour exists
          dx <=
            Math.max(
              grid * 16,
              6 * Math.max(left.body.width, right.body.width),
            );
        const collidingTwins =
          row.length === 2 &&
          dx <= grid * 14 &&
          left.instance.placement?.rotation ===
            right.instance.placement?.rotation &&
          (labelsCollide(left, right) || labelsCollide(right, left));

        if (!labelsMirrored && !symbolsMirrored && !collidingTwins) continue;
        // Skip splitting an aligned 3+ row unless labels are genuinely mirrored.
        if (row.length > 2 && !labelsMirrored && !symbolsMirrored) continue;
        // Do not tear either part away from a closer aligned same-offset peer on this row.
        const hasCloserAlignedPeer = (idx: number) => {
          const me = row[idx]!;
          for (const otherIdx of [idx - 1, idx + 1]) {
            const peer = row[otherIdx];
            if (!peer || peer === left || peer === right) continue;
            const peerDx = Math.abs(centre(peer.body).x - centre(me.body).x);
            if (
              peerDx < dx &&
              sameCoord(me.primaryRel!.x, peer.primaryRel!.x) &&
              sameCoord(me.primaryRel!.y, peer.primaryRel!.y) &&
              sameSlotShape(me, peer)
            )
              return true;
          }
          return false;
        };
        if (hasCloserAlignedPeer(i) || hasCloserAlignedPeer(i + 1)) continue;
        if (!sameSlotShape(left, right)) continue;

        assigned.add(left.instance.id);
        assigned.add(right.instance.id);
        cohorts.push({
          kind: "mirror-pair",
          axis: "horizontal",
          members: [left, right],
        });
      }
    }

    // Vertical mirror pairs
    const cols = clusterByCoord(group, (p) => centre(p.body).x, alikeTol);
    for (const col of cols) {
      col.sort((a, b) => centre(a.body).y - centre(b.body).y);
      for (let i = 0; i < col.length - 1; i++) {
        const top = col[i]!;
        const bottom = col[i + 1]!;
        if (assigned.has(top.instance.id) || assigned.has(bottom.instance.id))
          continue;
        if (!top.reported && !bottom.reported) continue;
        const dy = centre(bottom.body).y - centre(top.body).y;
        const maxSpan = Math.max(
          grid * 20,
          6 * Math.max(top.body.height, bottom.body.height),
        );
        if (dy > maxSpan) continue;
        const rt = top.primaryRel!;
        const rb = bottom.primaryRel!;
        const labelsMirrored =
          Math.abs(rt.y) > grid / 4 &&
          sameCoord(rt.y, -rb.y) &&
          sameCoord(rt.x, rb.x);
        if (!labelsMirrored || !sameSlotShape(top, bottom)) continue;

        assigned.add(top.instance.id);
        assigned.add(bottom.instance.id);
        cohorts.push({
          kind: "mirror-pair",
          axis: "vertical",
          members: [top, bottom],
        });
      }
    }
  }

  // Step 2B: Aligned rows & columns (local runs of like parts with aligned labels).
  const candidateLines: Array<{
    kind: "row" | "column";
    members: PartRecord[];
  }> = [];

  for (const group of bySymbol.values()) {
    const remaining = group.filter((p) => !assigned.has(p.instance.id));
    for (const kind of ["row", "column"] as const) {
      const buckets = clusterByCoord(
        remaining,
        (p) => (kind === "row" ? centre(p.body).y : centre(p.body).x),
        alikeTol,
      );
      for (const bucket of buckets) {
        bucket.sort((a, b) =>
          kind === "row"
            ? centre(a.body).x - centre(b.body).x
            : centre(a.body).y - centre(b.body).y,
        );
        let run: PartRecord[] = [];
        const flushRun = () => {
          if (run.length >= 2 && run.some((p) => p.reported))
            candidateLines.push({ kind, members: run });
          run = [];
        };
        for (const part of bucket) {
          if (!run.length) {
            run.push(part);
            continue;
          }
          const prev = run[run.length - 1]!;
          const step =
            kind === "row"
              ? centre(part.body).x - centre(prev.body).x
              : centre(part.body).y - centre(prev.body).y;
          const maxStep = Math.max(
            grid * 14,
            4 *
              Math.max(
                kind === "row" ? prev.body.width : prev.body.height,
                kind === "row" ? part.body.width : part.body.height,
              ),
          );
          const aligned =
            sameCoord(prev.primaryRel!.x, part.primaryRel!.x) &&
            sameCoord(prev.primaryRel!.y, part.primaryRel!.y) &&
            sameSlotShape(prev, part);
          if (step <= maxStep && aligned) {
            run.push(part);
          } else {
            flushRun();
            run.push(part);
          }
        }
        flushRun();
      }
    }
  }

  // Larger runs claim parts first (preferring rows over columns on a tie).
  // For a 2-part line, require no intervening unrelated part sitting straight
  // between them (e.g. a collector resistor and emitter resistor across a BJT).
  const hasInterveningPart = (a: PartRecord, b: PartRecord): boolean => {
    const corridor: Rect = {
      x: Math.min(centre(a.body).x, centre(b.body).x) - grid / 2,
      y: Math.min(centre(a.body).y, centre(b.body).y) - grid / 2,
      width: Math.abs(centre(a.body).x - centre(b.body).x) + grid,
      height: Math.abs(centre(a.body).y - centre(b.body).y) + grid,
    };
    const betweenRange = (v: number, lo: number, hi: number) =>
      v > Math.min(lo, hi) + grid && v < Math.max(lo, hi) - grid;
    return env.context.symbols.some((s) => {
      if (s.id === a.instance.id || s.id === b.instance.id) return false;
      if (!overlap(corridor, s.bounds)) return false;
      const sc = centre(s.bounds);
      return (
        betweenRange(sc.x, centre(a.body).x, centre(b.body).x) ||
        betweenRange(sc.y, centre(a.body).y, centre(b.body).y)
      );
    });
  };
  candidateLines.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      Number(a.kind === "column") - Number(b.kind === "column"),
  );
  for (const line of candidateLines) {
    const members = line.members.filter((p) => !assigned.has(p.instance.id));
    if (members.length < 2 || !members.some((p) => p.reported)) continue;
    if (members.length === 2 && hasInterveningPart(members[0]!, members[1]!))
      continue;
    for (const m of members) assigned.add(m.instance.id);
    cohorts.push({ kind: line.kind, members });
  }

  // Step 2C: Remaining reported movable parts in scope are singletons.
  for (const part of parts) {
    if (assigned.has(part.instance.id)) continue;
    if (!part.inScope || !part.reported || !part.movable.length) continue;
    assigned.add(part.instance.id);
    cohorts.push({ kind: "single", members: [part] });
  }

  return cohorts;
}

function clusterByCoord<T>(
  items: readonly T[],
  coord: (item: T) => number,
  tolerance: number,
): T[][] {
  const sorted = [...items].sort((a, b) => coord(a) - coord(b));
  const groups: T[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(coord(item) - coord(last[0]!)) <= tolerance)
      last.push(item);
    else groups.push([item]);
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Stage 3: Unified Feasibility Gate & Joint Cohort Planning                   */
/* -------------------------------------------------------------------------- */

interface PartPlanUpdate {
  readonly instanceId: string;
  readonly original: Annotation;
  readonly next: Annotation;
}

interface CohortPlan {
  readonly updates: readonly PartPlanUpdate[];
  readonly hiddenValueIds: readonly string[];
}

/**
 * Unified feasibility check for placing `part`'s visible candidate annotations
 * `candidate` (subset or full set of `part.movable`) given cohort-wide `ignoreIds`.
 */
function acceptsPartPlacement(args: {
  part: PartRecord;
  movableSubset: readonly MovableLabel[];
  candidate: readonly Annotation[];
  cohortIgnoreIds: ReadonlySet<string>;
  cohortPartIds: ReadonlySet<string>;
  allowCrossSide: boolean;
  targetSide?: InstanceLabelSide | undefined;
  env: RepairEnv;
}): boolean {
  const {
    part,
    movableSubset,
    candidate,
    cohortIgnoreIds,
    cohortPartIds,
    allowCrossSide,
    targetSide,
    env,
  } = args;
  const { context, documentProfile, grid, owners, partLabels, box } = env;
  const owner = part.body;
  const originals = movableSubset.map((l) => l.original);
  const fromBoxes = originals.map(box);
  const fixedBoxes = part.fixed.map(box);
  const boxes = candidate.map(box);

  // 1. Unambiguous ownership: within 2 grid steps of own part & strictly nearest it.
  for (const ink of boxes) {
    const ownGap = rectangleGap(ink, owner);
    if (ownGap > grid * OWNER_REACH_STEPS) return false;
    for (const symbol of context.symbols)
      if (
        symbol.id !== part.instance.id &&
        rectangleGap(ink, symbol.bounds) <= ownGap
      )
        return false;
  }

  // 2. Side discipline: never cross to far side unless explicitly allowed onto an unwired side.
  if (!part.homing) {
    if (allowCrossSide) {
      if (targetSide && part.wiredSides[targetSide]) return false;
      if (onWiredSide(boxes, owner, part.wiredSides)) return false;
    } else {
      for (let i = 0; i < boxes.length; i++) {
        const was = sidesOf(fromBoxes[i]!, owner);
        const now = sidesOf(boxes[i]!, owner);
        if (
          (was.left && now.right) ||
          (was.right && now.left) ||
          (was.above && now.below) ||
          (was.below && now.above)
        )
          return false;
      }
    }
  }

  // 3. Name + value block coherence (when both name and value are present).
  const allOriginals = [...originals, ...part.fixed];
  const allFrom = [...fromBoxes, ...fixedBoxes];
  const allNow = [...boxes, ...fixedBoxes];
  const nameAt = allOriginals.findIndex(
    (l) => partLabels.get(l.id)?.kind === "instance-reference",
  );
  const valueAt = allOriginals.findIndex(
    (l) => partLabels.get(l.id)?.kind === "instance-value",
  );
  if (nameAt >= 0 && valueAt >= 0) {
    const wasOrder = readOrder(allFrom[nameAt]!, allFrom[valueAt]!);
    const nowOrder = readOrder(allNow[nameAt]!, allNow[valueAt]!);
    const tangled = overlap(allFrom[nameAt]!, allFrom[valueAt]!);
    const straddled = overlap(
      union([allFrom[nameAt]!, allFrom[valueAt]!]),
      owner,
    );
    if (!nowOrder.nameFirst) return false;
    if (
      !part.homing &&
      !tangled &&
      wasOrder.nameFirst &&
      !allowCrossSide &&
      nowOrder.stacked !== wasOrder.stacked
    )
      return false;
    if (
      !straddled &&
      overlap(union([allNow[nameAt]!, allNow[valueAt]!]), owner)
    )
      return false;
  }

  // 4. Keep part's own labels within one row (or their initial separation).
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < fixedBoxes.length; j++) {
      const limit = Math.max(grid, rectangleGap(fromBoxes[i]!, fixedBoxes[j]!));
      if (rectangleGap(boxes[i]!, fixedBoxes[j]!) > limit) return false;
    }
    for (let j = i + 1; j < boxes.length; j++) {
      const limit = Math.max(grid, rectangleGap(fromBoxes[i]!, fromBoxes[j]!));
      if (rectangleGap(boxes[i]!, boxes[j]!) > limit) return false;
    }
  }

  // 5. Hard clearance, uncrowdedness, not enclosed, and no foreign wire between siblings.
  for (let i = 0; i < boxes.length; i++) {
    const ink = boxes[i]!;
    const cand = candidate[i]!;
    const siblings = [
      ...fixedBoxes,
      ...boxes.filter((_, other) => other !== i),
    ];
    if (siblings.some((s) => overlap(ink, s))) return false;
    if (!context.clearAt(cand, ink, cohortIgnoreIds)) return false;
    if (
      context.conflictsAt(ink, cand.id).some((id) => !cohortIgnoreIds.has(id))
    )
      return false;
    if (context.dotsAt(ink).length > 0) return false;
    if (context.enclosedAt(ink)) return false;
    if (isCutOff(ink, owner, context)) return false;
    if (touchesOwnWire(ink, part.ownWires, context)) return false;
    if (isStrayed(ink, owner, part.instance.id, context)) return false;
    if (
      isMistaken(
        ink,
        cand,
        siblings,
        part.instance.id,
        owner,
        partLabels,
        cohortIgnoreIds,
        context,
      )
    )
      return false;
    if (
      runsIntoNeighbour(
        ink,
        cand,
        part.instance.id,
        documentProfile,
        owners,
        cohortIgnoreIds,
        context,
      )
    )
      return false;
  }
  if (foreignWireBetween(boxes, part.ownWires, context)) return false;

  // 6. No neighbour encroachment & no jumping into an unrelated neighbour label row.
  if (!part.homing) {
    const near = grid / 2;
    const span = union(boxes);
    const around = grid * 2 + near;
    const nearbySymbols = context.symbols.filter(
      (s) =>
        s.id !== part.instance.id &&
        rectangleGap(span, s.bounds) <= around + span.width,
    );
    const nearbyEnds = env.pinEnds.filter(
      ({ instanceId, at }) =>
        instanceId !== part.instance.id &&
        pointGap(at, span) <= around + span.width,
    );
    for (let i = 0; i < boxes.length; i++) {
      const ink = boxes[i]!;
      const was = fromBoxes[i]!;
      const label = candidate[i]!;
      const nearer = (now: number, before: number) =>
        now < near && now < before;
      if (
        nearbySymbols.some((s) =>
          nearer(rectangleGap(ink, s.bounds), rectangleGap(was, s.bounds)),
        )
      )
        return false;
      if (
        nearbyEnds.some(({ at }) =>
          nearer(pointGap(at, ink), pointGap(at, was)),
        )
      )
        return false;
      const oldWires = new Set(context.wiresAt(grown(was, near)));
      if (context.wiresAt(grown(ink, near)).some((id) => !oldWires.has(id)))
        return false;
      const nearLabels = context.labelsWithin(ink, label.id, near);
      if (
        nearLabels.some((id) => {
          if (cohortIgnoreIds.has(id) || owners.get(id) === part.instance.id)
            return false;
          const theirs = context.labelBounds(id);
          return (
            theirs !== undefined &&
            nearer(rectangleGap(ink, theirs), rectangleGap(was, theirs))
          );
        })
      )
        return false;

      // Row-intrusion guard: do not move a label into the exact horizontal row
      // between two unrelated parts' labels (e.g. C7 jumping into M5..M6 row).
      if (
        intrudesIntoNeighbourRow(
          was,
          ink,
          label.id,
          grid,
          owners,
          cohortPartIds,
          cohortIgnoreIds,
          context,
        )
      )
        return false;
    }
  }

  return true;
}

/**
 * Checks whether a moved label newly lands on the exact same horizontal row
 * sandwiched between two unrelated parts' labels (within 3 grid steps each side).
 */
function intrudesIntoNeighbourRow(
  was: Rect,
  now: Rect,
  labelId: string,
  grid: number,
  owners: ReadonlyMap<string, string>,
  cohortPartIds: ReadonlySet<string>,
  cohortIgnoreIds: ReadonlySet<string>,
  context: LabelClearanceContext,
): boolean {
  const reach = grid * 3;
  const neighboursOnRow = (rect: Rect) => {
    let hasLeft = false;
    let hasRight = false;
    for (const id of context.labelsWithin(rect, labelId, reach)) {
      if (cohortIgnoreIds.has(id)) continue;
      const owner = owners.get(id);
      if (owner && cohortPartIds.has(owner)) continue;
      const theirs = context.labelBounds(id);
      if (!theirs || !sameRow(rect, theirs)) continue;
      if (theirs.x + theirs.width <= rect.x) hasLeft = true;
      if (theirs.x >= rect.x + rect.width) hasRight = true;
    }
    return hasLeft && hasRight;
  };
  return !neighboursOnRow(was) && neighboursOnRow(now);
}

/** Verify no two members' labels in a cohort overlap, crowd, or run on into each other. */
function cohortMembersClearOfEachOther(
  memberProposals: readonly {
    readonly part: PartRecord;
    readonly labels: readonly Annotation[];
  }[],
  env: RepairEnv,
): boolean {
  const { box, documentProfile } = env;
  const items = memberProposals.flatMap(({ part, labels }) =>
    labels.map((label) => ({
      partId: part.instance.id,
      label,
      ink: box(label),
      charWidth:
        objectStyleProfile(documentProfile, label).typography.instanceFontSize *
        (label.sizeScale ?? 1) *
        CHARACTER_EM,
    })),
  );
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      if (a.partId === b.partId) continue;
      // Word space (4) horizontally, line space (1) vertically
      const spacedA = {
        x: a.ink.x - 4,
        y: a.ink.y - 1,
        width: a.ink.width + 8,
        height: a.ink.height + 2,
      };
      if (overlap(spacedA, b.ink)) return false;
      if (sameRow(a.ink, b.ink)) {
        const gap = Math.max(
          b.ink.x - (a.ink.x + a.ink.width),
          a.ink.x - (b.ink.x + b.ink.width),
        );
        if (gap < Math.max(a.charWidth, b.charWidth)) return false;
      }
    }
  }
  return true;
}

/** Build a part's candidate annotations on a canonical side, with optional (dx, dy) shift. */
function buildSideArrangement(
  part: PartRecord,
  subset: readonly MovableLabel[],
  side: InstanceLabelSide,
  shift: Point,
  env: RepairEnv,
): Annotation[] | null {
  const { document, resolver, documentProfile, grid } = env;
  const hasValue = subset.some((l) => l.slot === "value" && !l.compact);
  const arrangement: Annotation[] = [];
  for (const label of subset) {
    const style = objectStyleProfile(documentProfile, label.original);
    const slot: InstanceLabelSlot = label.compact
      ? "reference"
      : label.slot === "value"
        ? "value"
        : hasValue
          ? "reference-over-value"
          : "reference";
    const valueRow = multiplierLabel(label.original, part.instance, resolver)
      ? instanceLabelRowOffset(style, grid)
      : undefined;
    const placed = placeUprightInstanceLabel(
      part.instance,
      part.resolved,
      style,
      { x: 0, y: 0 },
      side,
      grid,
      label.sizeScale,
      slot,
      valueRow,
    );
    if (!placed) return null;
    arrangement.push(
      annotationAt(document, resolver, label.annotation, {
        position: {
          x: placed.position.x + shift.x,
          y: placed.position.y + shift.y,
        },
        alignment: placed.alignment,
      }),
    );
  }
  return arrangement;
}

/** Build a part's candidate annotations shifted by `shift` from their current positions. */
function buildShiftedOriginals(
  _part: PartRecord,
  subset: readonly MovableLabel[],
  shift: Point,
  env: RepairEnv,
): Annotation[] {
  const { document, resolver, context } = env;
  return subset.map((label) => {
    const pos = context.measure(label.original).position;
    return annotationAt(document, resolver, label.annotation, {
      position: { x: pos.x + shift.x, y: pos.y + shift.y },
      alignment: label.original.alignment,
    });
  });
}

/** Build a part's default-row arrangement (with optional shift). */
function buildPreferredArrangement(
  part: PartRecord,
  subset: readonly MovableLabel[],
  shift: Point,
  env: RepairEnv,
): Annotation[] | null {
  const { document, resolver, documentProfile, grid } = env;
  const hasValue = subset.some((l) => l.slot === "value" && !l.compact);
  const result: Annotation[] = [];
  for (const label of subset) {
    const style = objectStyleProfile(documentProfile, label.original);
    const slot: InstanceLabelSlot = label.compact
      ? "reference"
      : label.slot === "value"
        ? "value"
        : hasValue
          ? "reference-over-value"
          : "reference";
    const valueRow = multiplierLabel(label.original, part.instance, resolver)
      ? instanceLabelRowOffset(style, grid)
      : undefined;
    const placed = defaultInstanceLabelPlacement(
      part.instance,
      part.resolved,
      style,
      grid,
      slot,
      label.sizeScale,
      valueRow,
    );
    if (!placed) return null;
    result.push(
      annotationAt(document, resolver, label.annotation, {
        position: {
          x: placed.position.x + shift.x,
          y: placed.position.y + shift.y,
        },
        alignment: placed.alignment,
      }),
    );
  }
  return result;
}

function planCohort(
  cohort: Cohort,
  env: RepairEnv,
  allowHideValues: boolean,
): CohortPlan | null {
  if (cohort.kind === "single")
    return planSinglePart(cohort.members[0], env, allowHideValues);

  // Every member in a multi-part cohort must be in scope and have movable labels
  // for the cohort to move jointly; otherwise leave the cohort intact to preserve alignment.
  if (cohort.members.some((m) => !m.inScope || !m.movable.length)) return null;

  if (cohort.kind === "mirror-pair")
    return planMirrorPair(cohort, env, allowHideValues);
  return planAlignedLine(cohort, env, allowHideValues);
}

/** Plan a horizontal or vertical mirror pair jointly (always keeping mirror symmetry). */
function planMirrorPair(
  cohort: Extract<Cohort, { kind: "mirror-pair" }>,
  env: RepairEnv,
  allowHideValues: boolean,
): CohortPlan | null {
  const [a, b] = cohort.members;
  const { grid } = env;
  const anySevere = a.severe || b.severe;
  const reach = a.struckOrSevere || b.struckOrSevere ? grid * 2 : grid;
  const cohortPartIds = new Set([a.instance.id, b.instance.id]);
  const allIgnoreIds = new Set([
    ...a.movable.map((l) => l.original.id),
    ...b.movable.map((l) => l.original.id),
  ]);

  const tryWithSubsets = (
    subA: readonly MovableLabel[],
    subB: readonly MovableLabel[],
    hidden: readonly PartPlanUpdate[],
  ): CohortPlan | null => {
    const hiddenValueIds = hidden.map((h) => h.original.id);

    const evaluate = (
      candA: readonly Annotation[] | null,
      candB: readonly Annotation[] | null,
      allowCrossSide: boolean,
      sideA?: InstanceLabelSide,
      sideB?: InstanceLabelSide,
    ): CohortPlan | null => {
      if (!candA || !candB) return null;
      if (
        !acceptsPartPlacement({
          part: a,
          movableSubset: subA,
          candidate: candA,
          cohortIgnoreIds: allIgnoreIds,
          cohortPartIds,
          allowCrossSide,
          targetSide: sideA,
          env,
        }) ||
        !acceptsPartPlacement({
          part: b,
          movableSubset: subB,
          candidate: candB,
          cohortIgnoreIds: allIgnoreIds,
          cohortPartIds,
          allowCrossSide,
          targetSide: sideB,
          env,
        })
      )
        return null;
      if (
        !cohortMembersClearOfEachOther(
          [
            { part: a, labels: candA },
            { part: b, labels: candB },
          ],
          env,
        )
      )
        return null;
      return {
        updates: [
          ...hidden,
          ...subA.map((l, i) => ({
            instanceId: a.instance.id,
            original: l.original,
            next: candA[i]!,
          })),
          ...subB.map((l, i) => ({
            instanceId: b.instance.id,
            original: l.original,
            next: candB[i]!,
          })),
        ],
        hiddenValueIds,
      };
    };

    const symShifts = (maxStepsFifths: number): readonly [Point, Point][] => {
      const zero: [Point, Point] = [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ];
      // Prefer pure vertical shifts (dx=0) for horizontal pairs so labels stay right
      // at canonical gap, then general mirrored shifts nearest-first.
      const base = nearbyShifts(grid, maxStepsFifths);
      const pairs = base.map((s): [Point, Point] =>
        cohort.axis === "horizontal"
          ? [
              { x: -s.x, y: s.y },
              { x: s.x, y: s.y },
            ]
          : [
              { x: s.x, y: -s.y },
              { x: s.x, y: s.y },
            ],
      );
      return [zero, ...pairs];
    };

    const trySidePair = (
      sideA: InstanceLabelSide,
      sideB: InstanceLabelSide,
      maxStepsFifths: number,
    ): CohortPlan | null => {
      if (a.fixed.length || b.fixed.length) return null;
      if (a.wiredSides[sideA] || b.wiredSides[sideB]) return null;
      for (const [sa, sb] of symShifts(maxStepsFifths)) {
        const res = evaluate(
          buildSideArrangement(a, subA, sideA, sa, env),
          buildSideArrangement(b, subB, sideB, sb, env),
          true,
          sideA,
          sideB,
        );
        if (res) return res;
      }
      return null;
    };

    const inwardFacing =
      cohort.axis === "horizontal"
        ? (a.primaryRel?.x ?? 0) > 0 && (b.primaryRel?.x ?? 0) < 0
        : (a.primaryRel?.y ?? 0) > 0 && (b.primaryRel?.y ?? 0) < 0;

    // Tier 1A: If currently facing inward with a severe clash (e.g. R0/R1 400Ω400Ω),
    // put them cleanly on their outward sides symmetrically FIRST!
    if (inwardFacing && anySevere) {
      const outward: [InstanceLabelSide, InstanceLabelSide] =
        cohort.axis === "horizontal" ? ["left", "right"] : ["top", "bottom"];
      const res = trySidePair(outward[0], outward[1], 10);
      if (res) return res;
    }

    // Tier 1B: Symmetric local shifts on current sides (including (0,0) when values hidden).
    const maxFifths = Math.round((reach / grid) * 5);
    for (const [sa, sb] of symShifts(maxFifths)) {
      if (
        !hidden.length &&
        sa.x === 0 &&
        sa.y === 0 &&
        sb.x === 0 &&
        sb.y === 0
      )
        continue;
      if (Math.hypot(sa.x, sa.y) > reach) continue;
      const res = evaluate(
        buildShiftedOriginals(a, subA, sa, env),
        buildShiftedOriginals(b, subB, sb, env),
        false,
      );
      if (res) return res;
    }

    // Tier 2: Symmetric canonical unwired sides for severe clashes.
    if (anySevere) {
      const sidePairs: readonly [InstanceLabelSide, InstanceLabelSide][] =
        cohort.axis === "horizontal"
          ? [
              ["left", "right"],
              ["top", "top"],
              ["bottom", "bottom"],
              ["right", "left"],
            ]
          : [
              ["top", "bottom"],
              ["right", "right"],
              ["left", "left"],
              ["bottom", "top"],
            ];
      for (const [sideA, sideB] of sidePairs) {
        const res = trySidePair(sideA, sideB, 5);
        if (res) return res;
      }
    }

    return null;
  };

  // Full name + value attempt first.
  const full = tryWithSubsets(a.movable, b.movable, []);
  if (full) return full;

  // Tier 3 (last resort, opt-in): Hide values directly colliding with another label symmetrically.
  if (allowHideValues && (a.valueCollidesLabel || b.valueCollidesLabel)) {
    const refA = a.movable.filter((l) => l.slot === "reference");
    const valA = a.movable.filter((l) => l.slot === "value");
    const refB = b.movable.filter((l) => l.slot === "reference");
    const valB = b.movable.filter((l) => l.slot === "value");
    if (refA.length && valA.length && refB.length && valB.length) {
      const hidden: PartPlanUpdate[] = [
        ...valA.map((l) => ({
          instanceId: a.instance.id,
          original: l.original,
          next: { ...l.original, visible: false },
        })),
        ...valB.map((l) => ({
          instanceId: b.instance.id,
          original: l.original,
          next: { ...l.original, visible: false },
        })),
      ];
      return tryWithSubsets(refA, refB, hidden);
    }
  }

  return null;
}

/** Plan an aligned row or column cohort jointly (all members move flush or none moves). */
function planAlignedLine(
  cohort: Extract<Cohort, { kind: "row" | "column" }>,
  env: RepairEnv,
  allowHideValues: boolean,
): CohortPlan | null {
  const { members } = cohort;
  const { grid } = env;
  const anySevere = members.some((m) => m.severe);
  const reach = members.some((m) => m.struckOrSevere) ? grid * 2 : grid;
  const cohortPartIds = new Set(members.map((m) => m.instance.id));
  const allIgnoreIds = new Set(
    members.flatMap((m) => m.movable.map((l) => l.original.id)),
  );

  const tryWithSubsets = (
    subsets: readonly (readonly MovableLabel[])[],
    hidden: readonly PartPlanUpdate[],
  ): CohortPlan | null => {
    const hiddenValueIds = hidden.map((h) => h.original.id);

    const evaluateAll = (
      candidates: readonly (readonly Annotation[] | null)[],
      allowCrossSide: boolean,
      targetSides?: readonly InstanceLabelSide[],
    ): CohortPlan | null => {
      const resolved: Annotation[][] = [];
      for (let i = 0; i < members.length; i++) {
        const cand = candidates[i];
        if (!cand) return null;
        if (
          !acceptsPartPlacement({
            part: members[i]!,
            movableSubset: subsets[i]!,
            candidate: cand,
            cohortIgnoreIds: allIgnoreIds,
            cohortPartIds,
            allowCrossSide,
            targetSide: targetSides?.[i],
            env,
          })
        )
          return null;
        resolved.push([...cand]);
      }
      if (
        !cohortMembersClearOfEachOther(
          members.map((part, i) => ({ part, labels: resolved[i]! })),
          env,
        )
      )
        return null;
      return {
        updates: [
          ...hidden,
          ...members.flatMap((part, i) =>
            subsets[i]!.map((l, j) => ({
              instanceId: part.instance.id,
              original: l.original,
              next: resolved[i]![j]!,
            })),
          ),
        ],
        hiddenValueIds,
      };
    };

    // Tier 1: Uniform local shift (dx, dy) across the entire row/column.
    const maxFifths = Math.round((reach / grid) * 5);
    const shifts = [
      ...(hidden.length ? [{ x: 0, y: 0 }] : []),
      ...nearbyShifts(grid, maxFifths),
    ];
    for (const shift of shifts) {
      if (Math.hypot(shift.x, shift.y) > reach) continue;
      const res = evaluateAll(
        members.map((part, i) =>
          buildShiftedOriginals(part, subsets[i]!, shift, env),
        ),
        false,
      );
      if (res) return res;
    }

    // Tier 2: For a 2-part horizontal row with a severe clash (e.g. parallel resistors
    // both on their default right side), try symmetric outward sides (left, right)!
    if (
      cohort.kind === "row" &&
      members.length === 2 &&
      anySevere &&
      members.every((m) => !m.fixed.length) &&
      !members[0]!.wiredSides.left &&
      !members[1]!.wiredSides.right
    ) {
      const sym = [{ x: 0, y: 0 }, ...nearbyShifts(grid, 10)];
      for (const s of sym) {
        const res = evaluateAll(
          [
            buildSideArrangement(
              members[0]!,
              subsets[0]!,
              "left",
              { x: -s.x, y: s.y },
              env,
            ),
            buildSideArrangement(
              members[1]!,
              subsets[1]!,
              "right",
              { x: s.x, y: s.y },
              env,
            ),
          ],
          true,
          ["left", "right"],
        );
        if (res) return res;
      }
    }

    // Tier 3: Uniform canonical unwired side across all members (severe only).
    if (anySevere && members.every((m) => !m.fixed.length)) {
      for (const side of INSTANCE_LABEL_SIDES) {
        if (members.some((m) => m.wiredSides[side])) continue;
        for (const shift of [{ x: 0, y: 0 }, ...nearbyShifts(grid, 5)]) {
          const res = evaluateAll(
            members.map((part, i) =>
              buildSideArrangement(part, subsets[i]!, side, shift, env),
            ),
            true,
            members.map(() => side),
          );
          if (res) return res;
        }
      }
    }

    return null;
  };

  const full = tryWithSubsets(
    members.map((m) => m.movable),
    [],
  );
  if (full) return full;

  // Tier 4 (last resort, opt-in): Uniformly hide values directly colliding with another label.
  if (allowHideValues && members.some((m) => m.valueCollidesLabel)) {
    const canHideAll = members.every(
      (m) =>
        m.movable.some((l) => l.slot === "reference") &&
        m.movable.some((l) => l.slot === "value"),
    );
    if (canHideAll) {
      const subsets = members.map((m) =>
        m.movable.filter((l) => l.slot === "reference"),
      );
      const hidden: PartPlanUpdate[] = members.flatMap((m) =>
        m.movable
          .filter((l) => l.slot === "value")
          .map((l) => ({
            instanceId: m.instance.id,
            original: l.original,
            next: { ...l.original, visible: false },
          })),
      );
      return tryWithSubsets(subsets, hidden);
    }
  }

  return null;
}

/** Plan a single part not belonging to any multi-part cohort. */
function planSinglePart(
  part: PartRecord,
  env: RepairEnv,
  allowHideValue: boolean,
): CohortPlan | null {
  const { grid, context, box } = env;
  const reach = part.homing
    ? Number.POSITIVE_INFINITY
    : part.struckOrSevere
      ? grid * 2
      : grid;
  const cohortPartIds = new Set([part.instance.id]);
  const allIgnoreIds = new Set(part.movable.map((l) => l.original.id));

  const tryWithSubset = (
    subset: readonly MovableLabel[],
    hidden: readonly PartPlanUpdate[],
  ): CohortPlan | null => {
    const hiddenValueIds = hidden.map((h) => h.original.id);
    const originals = subset.map((l) => l.original);
    const from = originals.map((l) => context.measure(l).position);

    const evaluate = (
      cand: readonly Annotation[] | null,
      allowCrossSide: boolean,
      targetSide?: InstanceLabelSide,
    ): CohortPlan | null => {
      if (!cand) return null;
      if (
        !acceptsPartPlacement({
          part,
          movableSubset: subset,
          candidate: cand,
          cohortIgnoreIds: allIgnoreIds,
          cohortPartIds,
          allowCrossSide,
          targetSide,
          env,
        })
      )
        return null;
      return {
        updates: [
          ...hidden,
          ...subset.map((l, i) => ({
            instanceId: part.instance.id,
            original: l.original,
            next: cand[i]!,
          })),
        ],
        hiddenValueIds,
      };
    };

    // If hiding the value alone already makes the Reference clear in place, accept immediately.
    if (hidden.length) {
      const inPlace = evaluate(
        subset.map((l) => l.annotation),
        false,
      );
      if (inPlace) return inPlace;
    }

    // Tier 1: Minimal move on current side (shifted originals, reported-only home, preferred).
    const preferred = buildPreferredArrangement(
      part,
      subset,
      { x: 0, y: 0 },
      env,
    );
    const reportedHome = preferred
      ? subset.map((l, i) =>
          env.reportedIds.has(l.original.id) ? preferred[i]! : l.annotation,
        )
      : null;

    const sameSideBases: Array<{
      arrangement: readonly Annotation[];
      shifts: readonly Point[];
    }> = [
      {
        arrangement: subset.map((l) => l.annotation),
        shifts: nearbyShifts(grid, 10),
      },
      ...(reportedHome
        ? [{ arrangement: reportedHome, shifts: nearbyShifts(grid, 5) }]
        : []),
      ...(preferred
        ? [{ arrangement: preferred, shifts: nearbyShifts(grid, 5) }]
        : []),
    ];

    const kept = subset.map((l) => !env.reportedIds.has(l.original.id));
    const scored = sameSideBases.flatMap(({ arrangement, shifts }, base) => {
      const offsets = arrangement.map((label, index) => {
        const p = context.measure(label).position;
        return { x: p.x - from[index]!.x, y: p.y - from[index]!.y };
      });
      const baseBoxes = arrangement.map(box);
      return [{ x: 0, y: 0 }, ...shifts].flatMap((shift) => {
        const moves = offsets.map((o) =>
          Math.hypot(o.x + shift.x, o.y + shift.y),
        );
        if (!moves.every((m) => m <= reach)) return [];
        const moved = Math.max(...moves);
        if (moved === 0 && !hidden.length) return [];
        if (!part.homing) return [{ base, shift, distance: moved, by: 0 }];
        const stay = moves.filter((_, i) => kept[i]);
        const shiftedBoxes = baseBoxes.map((b) => ({
          ...b,
          x: b.x + shift.x,
          y: b.y + shift.y,
        }));
        const stayed = shiftedBoxes.filter((_, i) => kept[i]);
        const by = stayed.length
          ? shiftedBoxes.reduce(
              (sum, ink, i) =>
                kept[i]
                  ? sum
                  : sum + Math.min(...stayed.map((o) => rectangleGap(ink, o))),
              0,
            )
          : 0;
        return [{ base, shift, distance: Math.max(0, ...stay), by }];
      });
    });

    scored.sort(
      (x, y) => x.distance - y.distance || x.by - y.by || x.base - y.base,
    );

    for (const { base, shift } of scored) {
      const arrangement = sameSideBases[base]!.arrangement.map((label, i) => {
        const p = context.measure(label).position;
        return annotationAt(env.document, env.resolver, subset[i]!.annotation, {
          position: { x: p.x + shift.x, y: p.y + shift.y },
          alignment: label.alignment,
        });
      });
      const res = evaluate(arrangement, false);
      if (res) return res;
    }

    // Tier 2: Clean unwired other side (ONLY when severe and no fixed sibling stays behind).
    if (part.severe && !part.fixed.length) {
      const sideCandidates: Array<{
        side: InstanceLabelSide;
        shift: Point;
        arrangement: Annotation[];
        dist: number;
      }> = [];
      for (const side of INSTANCE_LABEL_SIDES) {
        if (part.wiredSides[side]) continue;
        for (const shift of [{ x: 0, y: 0 }, ...nearbyShifts(grid, 5)]) {
          const arrangement = buildSideArrangement(
            part,
            subset,
            side,
            shift,
            env,
          );
          if (!arrangement) continue;
          const dist = Math.hypot(shift.x, shift.y);
          sideCandidates.push({ side, shift, arrangement, dist });
        }
      }
      sideCandidates.sort((x, y) => x.dist - y.dist);
      for (const { side, arrangement } of sideCandidates) {
        const res = evaluate(arrangement, true, side);
        if (res) return res;
      }
    }

    return null;
  };

  const full = tryWithSubset(part.movable, []);
  if (full) return full;

  // Tier 3 (last resort): Hide a value directly colliding with another label when Reference alone clears.
  if (allowHideValue && part.valueCollidesLabel) {
    const refs = part.movable.filter((l) => l.slot === "reference");
    const vals = part.movable.filter((l) => l.slot === "value");
    if (refs.length && vals.length) {
      const hidden: PartPlanUpdate[] = vals.map((l) => ({
        instanceId: part.instance.id,
        original: l.original,
        next: { ...l.original, visible: false },
      }));
      return tryWithSubset(refs, hidden);
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Stage 4: Port Pin & VDD Supply Repair                                       */
/* -------------------------------------------------------------------------- */

function repairPinNames(
  env: RepairEnv,
  inScopeIds: ReadonlySet<string>,
  options: RepairInstanceLabelsOptions,
): SchematicEdit[] {
  const { document, resolver, context, documentProfile, grid, reportedIds } =
    env;
  const changed: SchematicEdit[] = [];
  for (const label of context.visible) {
    if (
      label.binding?.kind !== "cell-terminal-name" ||
      label.anchor.kind !== "object" ||
      !inScopeIds.has(label.anchor.objectId) ||
      label.locked ||
      label.rotation !== 0 ||
      !reportedIds.has(label.id)
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
    if (![...candidates, standard].some((c) => offsetFromPlacement(drawn, c)))
      continue;
    const origin = instance.placement.position;
    const anchor = label.anchor;
    const onSide = (candidate: InstanceLabelPlacement): Annotation => ({
      ...label,
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
  }
  void options;
  return changed;
}

function repairSupplyNames(
  env: RepairEnv,
  inScopeIds: ReadonlySet<string>,
): SchematicEdit[] {
  const { document, resolver, context, grid, reportedIds, box } = env;
  const isOverBar = (name: Annotation, bar: Rect): boolean => {
    const ink = box(name);
    return (
      ink.y + ink.height <= bar.y + 1 &&
      ink.x < bar.x + bar.width &&
      ink.x + ink.width > bar.x
    );
  };
  let over = 0;
  let beside = 0;
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
    if (isOverBar(name, bar)) over += 1;
    else beside += 1;
  }

  const changed: SchematicEdit[] = [];
  for (const id of inScopeIds) {
    const instance = document.instances.find((item) => item.id === id);
    if (!instance || instance.symbolId !== "vdd-port") continue;
    const bar = context.symbols.find((s) => s.id === id)?.bounds;
    const found = document.annotations.find(
      (a) =>
        a.kind === "power-label" &&
        a.anchor.kind === "object" &&
        a.anchor.objectId === id,
    );
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (
      !bar ||
      !found ||
      found.locked ||
      found.rotation !== 0 ||
      !resolved ||
      !reportedIds.has(found.id)
    )
      continue;
    const besidePlace = defaultVddPowerLabelPlacement(instance, resolved, grid);
    const clearOfBar = bar.y - grid / 2;
    const overDraft = annotationAt(document, resolver, found, {
      position: { x: bar.x + bar.width / 2, y: clearOfBar },
      alignment: "middle",
    });
    const overInk = context.measure(overDraft).inkBounds;
    const overBar = annotationAt(document, resolver, overDraft, {
      position: {
        x: bar.x + bar.width / 2,
        y: clearOfBar - (overInk.y + overInk.height - clearOfBar),
      },
      alignment: "middle",
    });
    const wantOver = over === beside ? isOverBar(found, bar) : over > beside;
    const places = wantOver
      ? [overBar]
      : besidePlace
        ? [annotationAt(document, resolver, found, besidePlace)]
        : [];
    const ownedByBar = (place: Annotation) => {
      const ink = box(place);
      const own = rectangleGap(ink, bar);
      return context.symbols.every(
        (s) => s.id === id || rectangleGap(ink, s.bounds) > own,
      );
    };
    const next = places.find(
      (place) =>
        JSON.stringify(place) !== JSON.stringify(found) &&
        !context.conflicts(place).length &&
        context.clearAt(place) &&
        ownedByBar(place),
    );
    if (!next) continue;
    context.accept(next);
    changed.push({ kind: "upsert_schematic_annotation", annotation: next });
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Local Geometric Predicates                                                  */
/* -------------------------------------------------------------------------- */

function onWiredSide(
  boxes: readonly Rect[],
  owner: Rect,
  wiredSides: WiredSides,
): boolean {
  const sides = sidesOf(union(boxes), owner);
  return (
    (sides.left && wiredSides.left) ||
    (sides.right && wiredSides.right) ||
    (sides.above && wiredSides.top) ||
    (sides.below && wiredSides.bottom)
  );
}

function isCutOff(
  ink: Rect,
  owner: Rect,
  context: LabelClearanceContext,
): boolean {
  const c = centre(ink);
  const nearest = {
    x: Math.min(Math.max(c.x, owner.x), owner.x + owner.width),
    y: Math.min(Math.max(c.y, owner.y), owner.y + owner.height),
  };
  const across = context.wiresAt(ink);
  return context.crossings(c, nearest).some((id) => !across.includes(id));
}

function touchesOwnWire(
  ink: Rect,
  ownWires: readonly string[],
  context: LabelClearanceContext,
): boolean {
  const across = context.wiresAt(ink);
  return context
    .wiresAt({
      x: ink.x - OWN_WIRE_SPACE,
      y: ink.y - OWN_WIRE_LINE_SPACE,
      width: ink.width + 2 * OWN_WIRE_SPACE,
      height: ink.height + 2 * OWN_WIRE_LINE_SPACE,
    })
    .some((id) => ownWires.includes(id) && !across.includes(id));
}

function isStrayed(
  ink: Rect,
  owner: Rect,
  instanceId: string,
  context: LabelClearanceContext,
): boolean {
  const own = rectangleGap(ink, owner);
  return context.symbols.some(
    (s) =>
      s.id !== instanceId &&
      rectangleGap(ink, s.bounds) + ASSOCIATION_MARGIN < own,
  );
}

function isMistaken(
  ink: Rect,
  label: Annotation,
  siblings: readonly Rect[],
  instanceId: string,
  owner: Rect,
  partLabels: ReadonlyMap<
    string,
    { instanceId: string; kind: "instance-reference" | "instance-value" }
  >,
  ignoreIds: ReadonlySet<string>,
  context: LabelClearanceContext,
): boolean {
  const kind = partLabels.get(label.id)?.kind;
  const own = Math.min(
    rectangleGap(ink, owner),
    ...siblings.map((s) => rectangleGap(ink, s)),
  );
  if (!kind || !Number.isFinite(own)) return false;
  return context
    .labelsWithin(ink, label.id, own + ASSOCIATION_MARGIN)
    .some((id) => {
      if (ignoreIds.has(id)) return false;
      const other = partLabels.get(id);
      if (!other || other.instanceId === instanceId || other.kind === kind)
        return false;
      const theirs = context.labelBounds(id);
      if (!theirs) return false;
      return kind === "instance-value"
        ? readsAfter(theirs, ink)
        : readsAfter(ink, theirs);
    });
}

function runsIntoNeighbour(
  ink: Rect,
  label: Annotation,
  instanceId: string,
  documentProfile: SchematicStyleProfile,
  owners: ReadonlyMap<string, string>,
  ignoreIds: ReadonlySet<string>,
  context: LabelClearanceContext,
): boolean {
  const reach =
    objectStyleProfile(documentProfile, label).typography.instanceFontSize *
    (label.sizeScale ?? 1) *
    CHARACTER_EM;
  return context.labelsWithin(ink, label.id, reach).some((id) => {
    if (ignoreIds.has(id)) return false;
    const part = owners.get(id);
    const theirs = context.labelBounds(id);
    return (
      part !== undefined &&
      part !== instanceId &&
      theirs !== undefined &&
      sameRow(ink, theirs)
    );
  });
}

function foreignWireBetween(
  boxes: readonly Rect[],
  ownWires: readonly string[],
  context: LabelClearanceContext,
): boolean {
  if (boxes.length < 2) return false;
  const across = new Set([
    ...boxes.flatMap((b) => context.wiresAt(b)),
    ...ownWires,
  ]);
  return context.wiresAt(union(boxes)).some((id) => !across.has(id));
}
