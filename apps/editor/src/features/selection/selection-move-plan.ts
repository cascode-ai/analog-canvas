import { deriveRoutingAffectedClosure } from "@icm/derived";
import type { SchematicDocument, VisualAnchor } from "@icm/model";

import { looseRouteAnchorIds } from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";
import { canMoveDraftingIndependently } from "../drafting/drafting-move";

/**
 * The finite direct-manipulation vocabulary. These are transient editor
 * intents, not persisted commands: all committed changes remain existing typed
 * edits. No intent requests path search or global rerouting.
 */
export type SchematicMoveIntent =
  | "move-selection"
  | "stretch-segment"
  | "move-loose-route"
  | "move-power-rail"
  | "resize-power-rail-start"
  | "resize-power-rail-end";

/**
 * A transient, editor-only description of what moves in one direct-manipulation
 * gesture. It intentionally contains no geometry or persisted state: Route
 * geometry remains planned by the Edit Engine and the Document remains the
 * sole source of electrical truth.
 */
export interface SelectionMovePlan {
  intent: "move-selection";
  instanceIds: string[];
  translatedRouteIds: string[];
  translatedJunctionIds: string[];
  looseRouteIds: string[];
  previewObjectIds: string[];
  /** Explicitly selected labels whose anchor target is not moving with them. */
  independentAnnotationIds: string[];
  /** Selected drawings that own an independent placement edit, not followers. */
  draftingIds: string[];
  fixedObjectIds: string[];
}

/**
 * The step a selection moves by. Parts and wires keep the drawing's grid, so
 * every connection stays on it. Labels and drawing objects alone move on the
 * finer label grid, the step one of them takes when dragged by itself.
 */
export function selectionMovePitch(
  plan: SelectionMovePlan,
  grid: number,
  annotationGrid: number,
): number {
  return plan.instanceIds.length === 0 &&
    plan.translatedRouteIds.length === 0 &&
    plan.translatedJunctionIds.length === 0 &&
    plan.looseRouteIds.length === 0
    ? annotationGrid
    : grid;
}

function stable(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function followsTranslatedAnchor(
  anchor: VisualAnchor,
  objectIds: ReadonlySet<string>,
  routeIds: ReadonlySet<string>,
): boolean {
  return (
    (anchor.kind === "object" && objectIds.has(anchor.objectId)) ||
    (anchor.kind === "route" && routeIds.has(anchor.routeId))
  );
}

/**
 * Derive one movement closure from one visual selection. Instances determine
 * electrical closure: internal Routes/Junctions translate intact and boundary
 * Routes remain the Edit Engine's stretch responsibility. A separately
 * selected loose Route may translate only with both of its loose Junction
 * anchors. Other explicitly selected Routes remain fixed rather than silently
 * detaching or changing connectivity.
 */
export function planSelectionMove(
  document: SchematicDocument,
  selection: VisualSelection,
): SelectionMovePlan {
  const instanceIds = stable(
    selection.instanceIds.filter((id) =>
      document.instances.some(
        (instance) => instance.id === id && instance.placement,
      ),
    ),
  );
  const closure = deriveRoutingAffectedClosure(document, {
    instanceIds,
    routeIds: selection.routeIds,
    junctionIds: selection.junctionIds,
    annotationIds: selection.annotationIds,
  });
  const translatedRouteIds = new Set(closure.internalRoutes);
  // The engine closure decides which anchors travel and which arms stretch.
  // A second GUI filter would disagree with both preview and commit.
  const translatedJunctionIds = new Set(closure.internalJunctions);
  const looseRouteIds = new Set<string>();
  const fixedObjectIds = new Set<string>();

  for (const routeId of selection.routeIds) {
    const route = document.routes.find((candidate) => candidate.id === routeId);
    if (!route) continue;
    const anchors = looseRouteAnchorIds(document, route);
    if (anchors && translatedRouteIds.has(routeId)) {
      looseRouteIds.add(routeId);
      continue;
    }
    if (!translatedRouteIds.has(routeId)) {
      fixedObjectIds.add(routeId);
    }
  }

  for (const junctionId of selection.junctionIds) {
    if (!translatedJunctionIds.has(junctionId)) fixedObjectIds.add(junctionId);
  }

  const selectedDrafting = (document.drafting?.objects ?? []).filter((object) =>
    selection.draftingIds.includes(object.id),
  );
  const movingObjectIds = new Set([
    ...instanceIds,
    ...translatedJunctionIds,
    ...selectedDrafting
      .filter(
        (object) =>
          !object.locked &&
          (object.kind === "rectangle" || object.kind === "circle"),
      )
      .map((object) => object.id),
  ]);
  const followingDraftingIds = (document.drafting?.objects ?? [])
    .filter(
      (object) =>
        object.kind === "text" &&
        followsTranslatedAnchor(
          object.anchor,
          movingObjectIds,
          translatedRouteIds,
        ),
    )
    .map((object) => object.id);
  const followingDraftingIdSet = new Set(followingDraftingIds);
  const followingAnnotationIds = document.annotations
    .filter((annotation) =>
      followsTranslatedAnchor(
        annotation.anchor,
        movingObjectIds,
        translatedRouteIds,
      ),
    )
    .map((annotation) => annotation.id);
  const followingAnnotationIdSet = new Set(followingAnnotationIds);
  const independentAnnotationIds = selection.annotationIds.filter((id) => {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === id,
    );
    if (!annotation) return false;
    if (annotation.locked && !followingAnnotationIdSet.has(id)) {
      fixedObjectIds.add(id);
      return false;
    }
    // A selected label whose host is already in the routing transform is a
    // follower. Updating its anchor as a second operation would apply the
    // same gesture twice. Every other explicitly selected label owns one
    // independent anchor update, regardless of free/object/route anchoring.
    return !followingAnnotationIdSet.has(id);
  });
  const draftingIds = selection.draftingIds.filter((id) => {
    const object = document.drafting?.objects.find(
      (candidate) => candidate.id === id,
    );
    if (!object || followingDraftingIdSet.has(id)) return false;
    if (object.locked || !canMoveDraftingIndependently(object)) {
      fixedObjectIds.add(id);
      return false;
    }
    return true;
  });

  return {
    intent: "move-selection",
    instanceIds,
    translatedRouteIds: stable(translatedRouteIds),
    translatedJunctionIds: stable(translatedJunctionIds),
    looseRouteIds: stable(looseRouteIds),
    previewObjectIds: stable([
      ...instanceIds,
      ...translatedRouteIds,
      ...translatedJunctionIds,
      ...followingAnnotationIds,
      ...independentAnnotationIds,
      ...followingDraftingIds,
      ...draftingIds,
    ]),
    independentAnnotationIds: stable(independentAnnotationIds),
    draftingIds: stable(draftingIds),
    fixedObjectIds: stable(fixedObjectIds),
  };
}
