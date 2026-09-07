import { deriveRoutingAffectedClosure } from "@icm/derived";
import type { Annotation, SchematicDocument } from "@icm/model";

import {
  effectiveRouteAttachment,
  looseRouteAnchorIds,
} from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

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
  freeAnnotationIds: string[];
  draftingIds: string[];
  fixedObjectIds: string[];
}

function stable(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function followsTranslatedObject(
  annotation: Annotation,
  instanceIds: ReadonlySet<string>,
  junctionIds: ReadonlySet<string>,
  routeIds: ReadonlySet<string>,
): boolean {
  if (annotation.anchor.kind === "object") {
    return (
      instanceIds.has(annotation.anchor.objectId) ||
      junctionIds.has(annotation.anchor.objectId)
    );
  }
  const attachment = effectiveRouteAttachment(annotation);
  return attachment !== null && routeIds.has(attachment.routeId);
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

  const instanceIdSet = new Set(instanceIds);
  const followingAnnotationIds = document.annotations
    .filter((annotation) =>
      followsTranslatedObject(
        annotation,
        instanceIdSet,
        translatedJunctionIds,
        translatedRouteIds,
      ),
    )
    .map((annotation) => annotation.id);
  const freeAnnotationIds = selection.annotationIds.filter((id) => {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === id,
    );
    return annotation?.anchor.kind === "free" && !annotation.locked;
  });
  const draftingIds = selection.draftingIds.filter((id) => {
    const object = document.drafting?.objects.find(
      (candidate) => candidate.id === id,
    );
    return Boolean(object && !object.locked);
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
      ...freeAnnotationIds,
      ...draftingIds,
    ]),
    freeAnnotationIds: stable(freeAnnotationIds),
    draftingIds: stable(draftingIds),
    fixedObjectIds: stable(fixedObjectIds),
  };
}
