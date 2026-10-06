import {
  flattenRichText,
  inverseTransformPoint,
  mirrorScale,
  renamedLabelFormat,
  snapGridPoint,
  transformPoint,
} from "@icm/model";
import type {
  Annotation,
  Orientation,
  Point,
  Rotation,
  SchematicDocument,
} from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  legacyDefaultInstanceLabelPlacement,
  legacyPortLabelPlacement,
  previousDefaultInstanceLabelPlacement,
  previousPortLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  legacyDefaultInstanceParameterLabelPlacement,
  previousDefaultInstanceParameterLabelPlacement,
  displayableInstanceParameter,
  defaultVddPowerLabelPlacement,
  displayableInstanceValue,
  inferInstanceLabelSide,
  instanceGroupLabel,
  instanceLabelGroupSeat,
  instanceLabelRowOffset,
  instanceValueRowOffset,
  outwardDefaultInstanceLabelPlacement,
  previousInstanceLabelRowOffset,
  seatedInstanceLabelGroup,
  uniformRowDefaultInstanceLabelPlacement,
  objectStyleProfile,
  placeUprightInstanceLabel,
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
  visibleSymbolInkBounds,
  type InstanceLabelGroupSeat,
  type InstanceLabelPlacement,
  type InstanceLabelSide,
  type InstanceLabelSlot,
} from "@icm/derived";
import { referenceDeviceLetter } from "@icm/devices";
import type { SymbolResolver } from "@icm/symbols";

export function translateObjectAnchoredAnnotation(
  annotation: Annotation,
  objectId: string,
  delta: Point,
): void {
  if (
    annotation.anchor.kind === "object" &&
    annotation.anchor.objectId === objectId
  ) {
    annotation.anchor.fallbackPosition = {
      x: annotation.anchor.fallbackPosition.x + delta.x,
      y: annotation.anchor.fallbackPosition.y + delta.y,
    };
  }
}

/** The upright text slot an annotation occupies beside its instance. */
export function instanceAnnotationSlot(
  annotation: Annotation,
): "reference" | "value" | null {
  if (annotation.anchor.kind !== "object") return null;
  if (annotation.kind === "instance-label") return "reference";
  if (annotation.kind === "instance-value") return "value";
  return null;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function isCanonicalVddPowerLabel(
  annotation: Annotation,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  document: SchematicDocument,
  oldPosition: Point,
  oldOrientation: Orientation,
): boolean {
  if (
    instance.symbolId !== "vdd-port" ||
    annotation.kind !== "power-label" ||
    annotation.id !== `power-label-${instance.id.toLowerCase()}` ||
    annotation.anchor.kind !== "object" ||
    annotation.anchor.objectId !== instance.id
  ) {
    return false;
  }
  const visiblePosition = {
    x: oldPosition.x + annotation.anchor.localOffset.x,
    y: oldPosition.y + annotation.anchor.localOffset.y,
  };
  const oldInstance = {
    ...instance,
    placement: { position: oldPosition, ...oldOrientation },
  };
  const canonical = defaultVddPowerLabelPlacement(
    oldInstance,
    resolved,
    document.presentation.grid,
  );
  const matchesCanonical =
    canonical !== null &&
    annotation.rotation === 0 &&
    annotation.alignment === canonical.alignment &&
    samePoint(visiblePosition, canonical.position) &&
    samePoint(annotation.anchor.fallbackPosition, canonical.position);
  if (matchesCanonical) return true;

  // Compatibility for untouched labels authored before orientation-aware VDD
  // placement. Their original {10,10} vector rotated rigidly with the Symbol.
  const legacyPosition = transformPoint(
    { x: 10, y: 10 },
    oldPosition,
    oldOrientation,
  );
  return (
    annotation.alignment === "start" &&
    samePoint(visiblePosition, legacyPosition) &&
    samePoint(annotation.anchor.fallbackPosition, legacyPosition)
  );
}

/** A Cell Pin name uses the canonical upright reference-row placement. */
function isCanonicalCellPinLabel(
  annotation: Annotation,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  document: SchematicDocument,
  oldPosition: Point,
  oldOrientation: Orientation,
): boolean {
  if (
    (instance.symbolId !== "port" && instance.symbolId !== "port-filled") ||
    annotation.kind !== "instance-label" ||
    annotation.binding?.kind !== "cell-terminal-name" ||
    annotation.anchor.kind !== "object" ||
    annotation.anchor.objectId !== instance.id
  ) {
    return false;
  }
  const before = {
    ...instance,
    placement: { position: oldPosition, ...oldOrientation },
  };
  const profile = objectStyleProfile(
    resolveDocumentStyleProfile(document.presentation),
    annotation,
  );
  const visiblePosition = {
    x: oldPosition.x + annotation.anchor.localOffset.x,
    y: oldPosition.y + annotation.anchor.localOffset.y,
  };
  const fallbackPosition = annotation.anchor.fallbackPosition;
  // A label an earlier rule placed is just as untouched as one the current
  // rule placed, so each keeps following its Pin.
  return [
    defaultInstanceLabelPlacement(
      before,
      resolved,
      profile,
      document.presentation.grid,
      "reference",
    ),
    previousPortLabelPlacement(
      before,
      resolved,
      profile,
      document.presentation.grid,
    ),
    legacyPortLabelPlacement(
      before,
      resolved,
      profile,
      document.presentation.grid,
    ),
  ].some(
    (expected) =>
      expected !== null &&
      annotation.rotation === 0 &&
      annotation.alignment === expected.alignment &&
      samePoint(visiblePosition, expected.position) &&
      samePoint(fallbackPosition, expected.position),
  );
}

/**
 * Re-project the machine-managed Value annotation after a parameter edit.
 * A Value whose text no longer equals the previous projection is treated as
 * hand-edited and left untouched (the clipboard instance-label precedent).
 * When the new projection is undisplayable the annotation keeps its text but
 * hides itself instead of showing stale electrical claims; the editor's show
 * toggle re-projects fresh content.
 */
export function refreshInstanceValueAnnotation(
  draft: SchematicDocument,
  before: SchematicDocument["instances"][number],
  instanceId: string,
  changedObjectIds: Set<string>,
): void {
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!instance) return;
  const previous = displayableInstanceValue(before);
  for (const annotation of draft.annotations) {
    if (
      annotation.kind !== "instance-value" ||
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    ) {
      continue;
    }
    if (annotation.binding?.kind === "instance-value") {
      const previousDisplay = annotation.binding.parameter
        ? displayableInstanceParameter(
            before,
            annotation.binding.parameter,
            annotation.binding.showValue === false ? { showValue: false } : {},
          )
        : previous;
      const next = annotation.binding.parameter
        ? displayableInstanceParameter(
            instance,
            annotation.binding.parameter,
            annotation.binding.showValue === false ? { showValue: false } : {},
          )
        : displayableInstanceValue(instance);
      if (next.kind !== "displayable") {
        annotation.visible = false;
      } else if (annotation.formatOverride) {
        if (previousDisplay.kind === "displayable") {
          const format = renamedLabelFormat(
            annotation,
            flattenRichText(previousDisplay.content),
            flattenRichText(next.content),
            draft.presentation,
          );
          if (format) annotation.formatOverride = format;
          else delete annotation.formatOverride;
        } else {
          delete annotation.formatOverride;
        }
      }
      changedObjectIds.add(annotation.id);
      continue;
    }
    if (!annotation.content || previous.kind !== "displayable") continue;
    if (
      JSON.stringify(annotation.content) !== JSON.stringify(previous.content)
    ) {
      continue;
    }
    const next = displayableInstanceValue(instance);
    if (next.kind === "displayable") {
      annotation.content = structuredClone(next.content);
    } else {
      annotation.visible = false;
    }
    changedObjectIds.add(annotation.id);
  }
}

/**
 * Re-project every live Reference annotation after the authored Reference
 * changes. Its RichText tree remains an independently editable presentation,
 * so a same-text override follows the semantic name without losing styles.
 * Literal object-anchored annotations remain independent text.
 */
export function refreshInstanceReferenceAnnotation(
  draft: SchematicDocument,
  before: SchematicDocument["instances"][number],
  instanceId: string,
  changedObjectIds: Set<string>,
): void {
  const previousReference = before.reference;
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  const nextReference = instance?.reference;
  if (
    !previousReference ||
    !nextReference ||
    previousReference === nextReference
  ) {
    return;
  }
  for (const annotation of draft.annotations) {
    if (
      annotation.kind !== "instance-label" ||
      annotation.binding?.kind !== "instance-reference" ||
      annotation.binding.instanceId !== instanceId
    ) {
      continue;
    }
    if (annotation.formatOverride) {
      // A stored M₁ look follows the new Reference (R₁ renamed RL1 reads
      // R_L1); an authored format keeps its styling around the new text.
      const deviceLetter = referenceDeviceLetter(instance!.symbolId);
      const format = renamedLabelFormat(
        annotation,
        previousReference,
        nextReference,
        draft.presentation,
        deviceLetter ? { deviceLetter } : {},
      );
      if (format) annotation.formatOverride = format;
      else delete annotation.formatOverride;
    }
    changedObjectIds.add(annotation.id);
  }
}

/**
 * A value label is renderer-managed only while it exactly agrees
 * with the current canonical default for its slot. A user-moved label remains
 * an authored object-relative vector and must not be pulled back onto the
 * automatic side when its instance is rotated or mirrored.
 */
export function isCanonicalInstanceLabel(
  annotation: Annotation,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  document: SchematicDocument,
  oldPosition: Point,
  oldOrientation: Orientation,
): boolean {
  return (
    canonicalInstanceLabelRow(
      annotation,
      instance,
      resolved,
      document,
      oldPosition,
      oldOrientation,
    ) !== null
  );
}

/**
 * The part's own value label, or a placed Cell's name, which stands in its
 * row; not a named parameter's.
 */
export function instanceValueAnnotation(
  document: SchematicDocument,
  instanceId: string,
): Annotation | null {
  return (
    document.annotations.find(
      (annotation) =>
        annotation.kind === "instance-value" &&
        !(
          annotation.binding?.kind === "instance-value" &&
          annotation.binding.parameter
        ) &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === instanceId,
    ) ?? null
  );
}

/**
 * Whether the part shows its value in the untouched row under its name, so
 * that above the part the name stands a row further out (#1384).
 */
export function valueShownUnderName(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  position: Point,
  orientation: Orientation,
): boolean {
  const value = instanceValueAnnotation(document, instance.id);
  return (
    value !== null &&
    value.visible !== false &&
    (canonicalInstanceLabelRow(
      value,
      instance,
      resolved,
      document,
      position,
      orientation,
    ) ?? 0) > 0
  );
}

/**
 * The row an untouched instance label sits in, or null when a person moved
 * it. 0 is the Reference's slot, which a value or a Cell's name also takes
 * while no Reference is shown (#1105); otherwise it is the row distance of
 * the rule that put the value there, so an orientation edit can strip it and
 * re-place the label with the current one.
 */
export function canonicalInstanceLabelRow(
  annotation: Annotation,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  document: SchematicDocument,
  oldPosition: Point,
  oldOrientation: Orientation,
): number | null {
  const slot = instanceAnnotationSlot(annotation);
  if (!slot || annotation.anchor.kind !== "object") {
    return null;
  }
  const anchor = annotation.anchor;
  const placement = { position: oldPosition, ...oldOrientation };
  const parameter =
    annotation.binding?.kind === "instance-value"
      ? annotation.binding.parameter
      : undefined;
  const profile = objectStyleProfile(
    resolveDocumentStyleProfile(document.presentation),
    annotation,
  );
  const grid = document.presentation.grid;
  const visiblePosition = {
    x: oldPosition.x + anchor.localOffset.x,
    y: oldPosition.y + anchor.localOffset.y,
  };
  const matches = (candidate: InstanceLabelPlacement | null): boolean =>
    candidate !== null &&
    annotation.alignment === candidate.alignment &&
    visiblePosition.x === candidate.position.x &&
    visiblePosition.y === candidate.position.y &&
    anchor.fallbackPosition.x === candidate.position.x &&
    anchor.fallbackPosition.y === candidate.position.y;
  if (parameter)
    return annotation.rotation === 0 &&
      [
        defaultInstanceParameterLabelPlacement,
        previousDefaultInstanceParameterLabelPlacement,
        legacyDefaultInstanceParameterLabelPlacement,
      ].some((rule) =>
        matches(
          rule({ ...instance, placement }, resolved, profile, grid, parameter),
        ),
      )
      ? 0
      : null;
  // An orientation edit re-places an untouched label at its own size, so it
  // is untouched where a rule puts a label of that size, or of the default
  // size it was placed at before a person resized it. Placements computed
  // at a size other than the label's own would stop matching after one turn.
  const sizeScales = [...new Set([annotation.sizeScale ?? 1, 1])];
  const placedBy = (
    rule: typeof defaultInstanceLabelPlacement,
    inSlot: InstanceLabelSlot = slot,
    symbol: NonNullable<ReturnType<SymbolResolver["resolve"]>> = resolved,
  ) =>
    sizeScales.some((sizeScale) =>
      matches(
        rule(
          { ...instance, placement },
          symbol,
          profile,
          grid,
          inSlot,
          sizeScale,
        ),
      ),
    );
  if (slot === "value") {
    // A value, or a Cell's name, shown without a Reference sits in the
    // Reference's slot. Above the part that is also the value's own row
    // (#1384), so whether a name shows tells the two apart.
    const inReferenceSlot =
      placedBy(defaultInstanceLabelPlacement, "reference") ||
      placedBy(legacyDefaultInstanceLabelPlacement, "reference");
    if (
      inReferenceSlot &&
      !document.annotations.some(
        (other) =>
          other.kind === "instance-label" &&
          other.visible !== false &&
          other.anchor.kind === "object" &&
          other.anchor.objectId === instance.id,
      )
    )
      return 0;
    if (
      placedBy(defaultInstanceLabelPlacement) ||
      placedBy(outwardDefaultInstanceLabelPlacement)
    )
      return instanceValueRowOffset(instance.symbolId, profile, grid);
    // A label an earlier rule put down is just as untouched; the next
    // orientation edit moves it with the current rule.
    if (placedBy(uniformRowDefaultInstanceLabelPlacement))
      return instanceLabelRowOffset(profile, grid);
    if (
      placedBy(previousDefaultInstanceLabelPlacement) ||
      placedBy(legacyDefaultInstanceLabelPlacement)
    )
      return previousInstanceLabelRowOffset(profile, grid);
    if (inReferenceSlot) return 0;
  } else if (
    placedBy(defaultInstanceLabelPlacement) ||
    placedBy(defaultInstanceLabelPlacement, "reference-over-value") ||
    placedBy(legacyDefaultInstanceLabelPlacement)
  )
    return 0;

  // Projects saved before the reviewed Resistor path declared tight bounds
  // used its wider viewBox for the canonical label. Accept that one exact
  // machine-owned position during the next orientation edit, then re-project
  // it through the current placement rule. This stays Symbol-specific so a
  // nearby user-authored label is never absorbed by a general tolerance.
  if (instance.symbolId !== "resistor") return null;
  return placedBy(legacyDefaultInstanceLabelPlacement, slot, {
    ...resolved,
    definition: {
      ...resolved.definition,
      primitives: resolved.definition.primitives.map((primitive) => {
        if (primitive.kind !== "path" || !primitive.bounds) return primitive;
        const { bounds: _bounds, ...withoutBounds } = primitive;
        return withoutBounds;
      }),
    },
  })
    ? slot === "value"
      ? previousInstanceLabelRowOffset(profile, grid)
      : 0
    : null;
}

/**
 * The slot an untouched label takes again in its `row`: a value in its row
 * stays under its name, a name stands over a value shown under it, and any
 * other takes the Reference's slot.
 */
export function canonicalLabelSlot(
  slot: "reference" | "value",
  row: number,
  nameOverValue: boolean,
): InstanceLabelSlot {
  if (row) return "value";
  return slot === "reference" && nameOverValue
    ? "reference-over-value"
    : "reference";
}

/**
 * Keep untouched machine-managed labels outside an adaptive presentation
 * frame when formula text or an authored minimum size changes. User-moved
 * labels retain their authored object-relative offsets.
 */
export function reflowCanonicalInstanceLabelsAfterPresentationChange(
  draft: SchematicDocument,
  before: SchematicDocument["instances"][number],
  instanceId: string,
  changedObjectIds: Set<string>,
  resolver?: SymbolResolver,
): void {
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!instance?.placement || !before.placement || !resolver) return;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return;
  // Read before any label moves.
  const nameOverValue = valueShownUnderName(
    draft,
    before,
    resolved,
    before.placement.position,
    before.placement,
  );
  for (const annotation of draft.annotations) {
    const slot = instanceAnnotationSlot(annotation);
    if (
      !slot ||
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    )
      continue;
    const row = canonicalInstanceLabelRow(
      annotation,
      before,
      resolved,
      draft,
      before.placement.position,
      before.placement,
    );
    if (row === null) continue;
    const profile = objectStyleProfile(
      resolveDocumentStyleProfile(draft.presentation),
      annotation,
    );
    const parameter =
      annotation.binding?.kind === "instance-value"
        ? annotation.binding.parameter
        : undefined;
    const next = parameter
      ? defaultInstanceParameterLabelPlacement(
          instance,
          resolved,
          profile,
          draft.presentation.grid,
          parameter,
        )
      : defaultInstanceLabelPlacement(
          instance,
          resolved,
          profile,
          draft.presentation.grid,
          canonicalLabelSlot(slot, row, nameOverValue),
        );
    if (!next) continue;
    annotation.anchor = {
      ...annotation.anchor,
      localOffset: {
        x: next.position.x - instance.placement.position.x,
        y: next.position.y - instance.placement.position.y,
      },
      fallbackPosition: next.position,
    };
    annotation.alignment = next.alignment;
    annotation.rotation = 0;
    changedObjectIds.add(annotation.id);
  }
}

/**
 * The vertical offset a part's label takes when the part flips top to
 * bottom. The text's ink reflects about the part's origin, not the anchor:
 * the anchor sits on the baseline, so reflecting it alone brings a label that
 * sat above the part most of a line closer below it, into a capacitor's
 * plates. The ink is the extent label placement keeps clear of a part
 * (capitals over the baseline, a subscript under it), so the gap is kept and
 * a label where the rule put it lands where the rule puts it on the other
 * side. Only an object anchor is read, so no wire geometry is needed.
 */
function reflectedTextOffsetY(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  origin: Point,
): number {
  if (annotation.anchor.kind !== "object") return 0;
  const { inkBounds: bounds } = resolveAnnotationPresentation(
    draft,
    resolver,
    annotation,
    resolveDocumentStyleProfile(draft.presentation),
    {
      documentId: draft.id,
      documentRevision: draft.revision,
      routes: new Map(),
      endpointJoins: [],
    },
  );
  const center = bounds.y + bounds.height / 2 - origin.y;
  // `|| 0`: a label level with the origin stays at 0, not -0.
  return Math.round(annotation.anchor.localOffset.y - 2 * center) || 0;
}

export function followAttachedAnnotations(
  draft: SchematicDocument,
  instanceId: string,
  oldPosition: Point,
  oldOrientation: Orientation,
  newPosition: Point,
  newOrientation: Orientation,
  changedObjectIds: Set<string>,
  resolver?: SymbolResolver,
): void {
  const isPureTranslation =
    oldOrientation.rotation === newOrientation.rotation &&
    oldOrientation.mirror === newOrientation.mirror;
  if (isPureTranslation) {
    const delta = {
      x: newPosition.x - oldPosition.x,
      y: newPosition.y - oldPosition.y,
    };
    for (const annotation of draft.annotations) {
      if (
        annotation.anchor.kind !== "object" ||
        annotation.anchor.objectId !== instanceId
      ) {
        continue;
      }
      translateObjectAnchoredAnnotation(annotation, instanceId, delta);
      changedObjectIds.add(annotation.id);
    }
    return;
  }

  const directionForRotation = (rotation: Rotation): Point => {
    const radians = (rotation * Math.PI) / 180;
    return { x: Math.cos(radians), y: Math.sin(radians) };
  };
  const rotationForDirection = (direction: Point): Rotation => {
    const degrees = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
    const normalized = ((degrees % 360) + 360) % 360;
    return ((Math.round(normalized / 45) * 45) % 360) as Rotation;
  };
  const origin = { x: 0, y: 0 };
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  const resolved = instance
    ? resolver?.resolve(instance.symbolId, instance.symbolVariantId)
    : undefined;
  const reflection =
    oldOrientation.rotation === newOrientation.rotation &&
    oldOrientation.mirror !== newOrientation.mirror;
  const oldMirror = mirrorScale(oldOrientation.mirror);
  const newMirror = mirrorScale(newOrientation.mirror);
  const horizontal = oldMirror.x * newMirror.x;
  const vertical = oldMirror.y * newMirror.y;
  // Read before any label moves: a name over its value stays over it, and a
  // name and value standing as a group stay one, name first.
  const nameOverValue =
    !reflection && instance && resolved
      ? valueShownUnderName(
          draft,
          instance,
          resolved,
          oldPosition,
          oldOrientation,
        )
      : false;
  const group =
    reflection && vertical < 0 && instance && resolved
      ? instanceLabelGroup(
          draft,
          instance,
          resolved,
          oldPosition,
          oldOrientation,
        )
      : null;
  for (const annotation of draft.annotations) {
    if (
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    ) {
      continue;
    }
    if (reflection) {
      // Mirror the authored text attachment in screen space. Re-running
      // default placement would pin power and magnetic labels to the right.
      // A part's name and value standing as a group are seated again below,
      // so the name still reads first.
      // Glyphs retain their readable orientation; horizontal alignment changes
      // with the side on which the text extends from its anchor.
      const localOffset = {
        x: annotation.anchor.localOffset.x * horizontal,
        y:
          vertical < 0 && resolver
            ? reflectedTextOffsetY(draft, resolver, annotation, newPosition)
            : annotation.anchor.localOffset.y * vertical,
      };
      annotation.anchor = {
        ...annotation.anchor,
        localOffset,
        fallbackPosition: {
          x: newPosition.x + localOffset.x,
          y: newPosition.y + localOffset.y,
        },
      };
      if (horizontal < 0 && annotation.alignment !== "middle") {
        annotation.alignment =
          annotation.alignment === "start" ? "end" : "start";
      }
      changedObjectIds.add(annotation.id);
      continue;
    }
    const visiblePosition = {
      x: oldPosition.x + annotation.anchor.localOffset.x,
      y: oldPosition.y + annotation.anchor.localOffset.y,
    };
    if (
      instance &&
      resolved &&
      isCanonicalVddPowerLabel(
        annotation,
        instance,
        resolved,
        draft,
        oldPosition,
        oldOrientation,
      )
    ) {
      const next = defaultVddPowerLabelPlacement(
        {
          ...instance,
          placement: { position: newPosition, ...newOrientation },
        },
        resolved,
        draft.presentation.grid,
      );
      if (next) {
        annotation.anchor = {
          ...annotation.anchor,
          localOffset: {
            x: next.position.x - newPosition.x,
            y: next.position.y - newPosition.y,
          },
          fallbackPosition: next.position,
        };
        annotation.alignment = next.alignment;
        annotation.rotation = 0;
        changedObjectIds.add(annotation.id);
        continue;
      }
    }
    if (
      instance &&
      resolved &&
      isCanonicalCellPinLabel(
        annotation,
        instance,
        resolved,
        draft,
        oldPosition,
        oldOrientation,
      )
    ) {
      const next = defaultInstanceLabelPlacement(
        {
          ...instance,
          placement: { position: newPosition, ...newOrientation },
        },
        resolved,
        objectStyleProfile(
          resolveDocumentStyleProfile(draft.presentation),
          annotation,
        ),
        draft.presentation.grid,
        "reference",
      );
      if (next) {
        annotation.anchor = {
          ...annotation.anchor,
          localOffset: {
            x: next.position.x - newPosition.x,
            y: next.position.y - newPosition.y,
          },
          fallbackPosition: next.position,
        };
        annotation.alignment = next.alignment;
        annotation.rotation = 0;
        changedObjectIds.add(annotation.id);
        continue;
      }
    }
    const parameter =
      annotation.binding?.kind === "instance-value"
        ? annotation.binding.parameter
        : undefined;
    if (
      parameter &&
      instance &&
      resolved &&
      isCanonicalInstanceLabel(
        annotation,
        instance,
        resolved,
        draft,
        oldPosition,
        oldOrientation,
      )
    ) {
      const next = defaultInstanceParameterLabelPlacement(
        {
          ...instance,
          placement: { position: newPosition, ...newOrientation },
        },
        resolved,
        objectStyleProfile(
          resolveDocumentStyleProfile(draft.presentation),
          annotation,
        ),
        draft.presentation.grid,
        parameter,
      );
      if (next) {
        annotation.anchor = {
          ...annotation.anchor,
          localOffset: {
            x: next.position.x - newPosition.x,
            y: next.position.y - newPosition.y,
          },
          fallbackPosition: next.position,
        };
        annotation.alignment = next.alignment;
        annotation.rotation = 0;
        changedObjectIds.add(annotation.id);
        continue;
      }
    }
    const local = inverseTransformPoint(
      visiblePosition,
      oldPosition,
      oldOrientation,
    );
    const transformedAnchor = transformPoint(
      local,
      newPosition,
      newOrientation,
    );
    let position = transformedAnchor;
    let transformedAlignment: "start" | "middle" | "end" | null = null;
    const slot = instanceAnnotationSlot(annotation);
    const row =
      slot !== null && instance && resolved
        ? canonicalInstanceLabelRow(
            annotation,
            instance,
            resolved,
            draft,
            oldPosition,
            oldOrientation,
          )
        : null;
    if (slot !== null && instance && resolved && row !== null) {
      const styleProfile = objectStyleProfile(
        resolveDocumentStyleProfile(draft.presentation),
        annotation,
      );
      // Upright rows stack along world y regardless of orientation, so the
      // row the label was placed in is stripped from the recovered anchor in
      // world space before side inference, and the upright placer puts the
      // label back in its slot on the new side.
      const slotAnchor = row
        ? { x: visiblePosition.x, y: visiblePosition.y - row }
        : visiblePosition;
      const slotLocal = inverseTransformPoint(
        slotAnchor,
        oldPosition,
        oldOrientation,
      );
      const localSide = inferInstanceLabelSide(
        slotLocal,
        visibleSymbolInkBounds(resolved, instance.signalFlowParameters),
      );
      if (localSide) {
        try {
          const placement = placeUprightInstanceLabel(
            instance,
            resolved,
            styleProfile,
            slotLocal,
            localSide,
            draft.presentation.grid,
            annotation.sizeScale,
            canonicalLabelSlot(slot, row, nameOverValue),
          );
          if (placement) {
            position = placement.position;
            transformedAlignment = placement.alignment;
          }
        } catch {
          // Keep the rigid semantic transform for a legacy/unknown profile;
          // formal rendering reports the invalid profile separately.
        }
      }
    }
    // A 45-degree transform produces fractional derived geometry. Document
    // anchors intentionally persist integer coordinates, so cross that
    // boundary once at single-pixel precision instead of snapping the label
    // back to the coarser schematic connection grid.
    const persistedPosition = snapGridPoint(position, 1);
    annotation.anchor = {
      ...annotation.anchor,
      // Object anchors resolve localOffset directly in world space. Persist
      // the reflowed upright glyph baseline with only the integer precision
      // required by the Document schema. The label placer already performs
      // the one authoritative schematic-grid snap for canonical labels.
      localOffset: {
        x: persistedPosition.x - newPosition.x,
        y: persistedPosition.y - newPosition.y,
      },
      fallbackPosition: persistedPosition,
    };
    if (slot !== null) {
      annotation.rotation = 0;
      if (transformedAlignment !== null) {
        annotation.alignment = transformedAlignment;
      } else if (annotation.alignment !== "middle") {
        // Rigid fallback for a user-placed label: upright text never mirrors
        // as glyphs, so when the orientation change flips the world x-axis
        // (a left/right mirror, or a 180-degree turn), the anchor lands on
        // the far side of the artwork and the text must extend the other
        // way. A 90-degree turn maps x to y and keeps the alignment.
        const worldX = transformPoint(
          inverseTransformPoint({ x: 1, y: 0 }, origin, oldOrientation),
          origin,
          newOrientation,
        );
        if (worldX.x < 0) {
          annotation.alignment =
            annotation.alignment === "start" ? "end" : "start";
        }
      }
    } else {
      const oldDirection = directionForRotation(annotation.rotation);
      const localDirection = inverseTransformPoint(
        oldDirection,
        origin,
        oldOrientation,
      );
      annotation.rotation = rotationForDirection(
        transformPoint(localDirection, origin, newOrientation),
      );
    }
    changedObjectIds.add(annotation.id);
  }
  const nameLabel = group && instanceGroupLabel(draft, group.name, newPosition);
  const valueLabel =
    group && instanceGroupLabel(draft, group.value, newPosition);
  if (group && nameLabel && valueLabel && instance && resolved) {
    // On the mirrored side, slid as far the mirrored way.
    const seated = seatedInstanceLabelGroup(
      { ...instance, placement: { position: newPosition, ...newOrientation } },
      resolved,
      draft.presentation.grid,
      {
        side: reflectedSide(group.seat.side, horizontal, vertical),
        shift: {
          x: group.seat.shift.x * horizontal,
          y: group.seat.shift.y * vertical,
        },
      },
      nameLabel,
      valueLabel,
    );
    if (seated)
      for (const [annotation, target] of [
        [group.name, seated.name],
        [group.value, seated.value],
      ] as const) {
        if (annotation.anchor.kind !== "object") continue;
        annotation.anchor = {
          ...annotation.anchor,
          localOffset: {
            x: target.position.x - newPosition.x,
            y: target.position.y - newPosition.y,
          },
          fallbackPosition: target.position,
        };
        annotation.alignment = target.alignment;
        changedObjectIds.add(annotation.id);
      }
  }
}

/** The side a mirror puts a side of the drawing on. */
function reflectedSide(
  side: InstanceLabelSide,
  horizontal: number,
  vertical: number,
): InstanceLabelSide {
  if (vertical < 0 && (side === "top" || side === "bottom"))
    return side === "top" ? "bottom" : "top";
  if (horizontal < 0 && (side === "left" || side === "right"))
    return side === "left" ? "right" : "left";
  return side;
}

/**
 * A part's name and its value with the seat they stand on as a group, the
 * part at `position` and `orientation`, or null when they do not stand as
 * one: either missing, turned, or moved by hand.
 */
function instanceLabelGroup(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>,
  position: Point,
  orientation: Orientation,
): {
  name: Annotation;
  value: Annotation;
  seat: InstanceLabelGroupSeat;
} | null {
  const names = document.annotations.filter(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === instance.id,
  );
  const name = names.find((label) => label.visible !== false) ?? names[0];
  const value = instanceValueAnnotation(document, instance.id);
  if (!name || !value || name.rotation !== 0 || value.rotation !== 0)
    return null;
  const nameLabel = instanceGroupLabel(document, name, position);
  const valueLabel = instanceGroupLabel(document, value, position);
  const seat =
    nameLabel && valueLabel
      ? instanceLabelGroupSeat(
          { ...instance, placement: { position, ...orientation } },
          resolved,
          document.presentation.grid,
          nameLabel,
          valueLabel,
        )
      : null;
  return seat ? { name, value, seat } : null;
}
