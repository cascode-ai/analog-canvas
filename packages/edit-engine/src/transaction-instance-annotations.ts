import {
  inverseTransformPoint,
  semanticTextDocument,
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
  defaultVddPowerLabelPlacement,
  displayableInstanceValue,
  inferInstanceLabelSide,
  instanceLabelRowOffset,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  visibleSymbolInkBounds,
} from "@icm/derived";
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
  const expected = defaultInstanceLabelPlacement(
    { ...instance, placement: { position: oldPosition, ...oldOrientation } },
    resolved,
    resolveDocumentStyleProfile(document.presentation),
    document.presentation.grid,
    "reference",
  );
  if (!expected) return false;
  const visiblePosition = {
    x: oldPosition.x + annotation.anchor.localOffset.x,
    y: oldPosition.y + annotation.anchor.localOffset.y,
  };
  return (
    annotation.rotation === 0 &&
    annotation.alignment === expected.alignment &&
    samePoint(visiblePosition, expected.position) &&
    samePoint(annotation.anchor.fallbackPosition, expected.position)
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
  if (previous.kind !== "displayable") return;
  for (const annotation of draft.annotations) {
    if (
      annotation.kind !== "instance-value" ||
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    ) {
      continue;
    }
    if (annotation.binding?.kind === "instance-value") {
      if (displayableInstanceValue(instance).kind !== "displayable") {
        annotation.visible = false;
      }
      changedObjectIds.add(annotation.id);
      continue;
    }
    if (!annotation.content) continue;
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
 * Keep only the machine-managed reference label aligned with a renamed
 * netlist reference. Hand-authored label content remains an intentional
 * presentation override.
 */
export function refreshInstanceReferenceAnnotation(
  draft: SchematicDocument,
  before: SchematicDocument["instances"][number],
  instanceId: string,
  changedObjectIds: Set<string>,
): void {
  const previousReference = before.netlist?.reference;
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  const nextReference = instance?.netlist?.reference;
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
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    ) {
      continue;
    }
    if (annotation.binding?.kind === "instance-designator") {
      changedObjectIds.add(annotation.id);
      continue;
    }
    if (!annotation.content) continue;
    const previousContent = semanticTextDocument(
      previousReference,
      "instance-label",
    );
    if (
      JSON.stringify(annotation.content) !== JSON.stringify(previousContent)
    ) {
      continue;
    }
    annotation.content = semanticTextDocument(nextReference, "instance-label");
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
  const slot = instanceAnnotationSlot(annotation);
  if (!slot || annotation.anchor.kind !== "object") {
    return false;
  }
  const placement = { position: oldPosition, ...oldOrientation };
  const expected = defaultInstanceLabelPlacement(
    { ...instance, placement },
    resolved,
    resolveDocumentStyleProfile(document.presentation),
    document.presentation.grid,
    slot,
  );
  if (!expected) return false;
  const visiblePosition = {
    x: oldPosition.x + annotation.anchor.localOffset.x,
    y: oldPosition.y + annotation.anchor.localOffset.y,
  };
  return (
    annotation.alignment === expected.alignment &&
    visiblePosition.x === expected.position.x &&
    visiblePosition.y === expected.position.y &&
    annotation.anchor.fallbackPosition.x === expected.position.x &&
    annotation.anchor.fallbackPosition.y === expected.position.y
  );
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
    switch (rotation) {
      case 0:
        return { x: 1, y: 0 };
      case 90:
        return { x: 0, y: 1 };
      case 180:
        return { x: -1, y: 0 };
      case 270:
        return { x: 0, y: -1 };
    }
  };
  const rotationForDirection = (direction: Point): Rotation => {
    if (direction.x > 0) return 0;
    if (direction.y > 0) return 90;
    if (direction.x < 0) return 180;
    return 270;
  };
  const origin = { x: 0, y: 0 };
  const instance = draft.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  const resolved = instance
    ? resolver?.resolve(instance.symbolId, instance.symbolVariantId)
    : undefined;
  for (const annotation of draft.annotations) {
    if (
      annotation.anchor.kind !== "object" ||
      annotation.anchor.objectId !== instanceId
    ) {
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
        resolveDocumentStyleProfile(draft.presentation),
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
    if (
      slot !== null &&
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
      const styleProfile = resolveDocumentStyleProfile(draft.presentation);
      // Upright rows stack along world y regardless of orientation, so the
      // value slot's row offset is stripped from the recovered anchor in world
      // space before side inference and re-added by the upright placer.
      const rowOffset =
        slot === "value"
          ? instanceLabelRowOffset(styleProfile, draft.presentation.grid)
          : 0;
      const slotAnchor = rowOffset
        ? { x: visiblePosition.x, y: visiblePosition.y - rowOffset }
        : visiblePosition;
      const slotLocal = inverseTransformPoint(
        slotAnchor,
        oldPosition,
        oldOrientation,
      );
      const localSide = inferInstanceLabelSide(
        slotLocal,
        visibleSymbolInkBounds(resolved),
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
            rowOffset,
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
    annotation.anchor = {
      ...annotation.anchor,
      // Object anchors resolve localOffset directly in world space. Persist
      // the reflowed upright glyph baseline without a second grid snap. The
      // label placer already performed the one authoritative grid snap;
      // re-snapping a recovered anchor is what previously accumulated drift.
      localOffset: {
        x: position.x - newPosition.x,
        y: position.y - newPosition.y,
      },
      fallbackPosition: position,
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
}
