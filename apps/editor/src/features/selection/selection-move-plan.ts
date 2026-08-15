import { deriveInternalGroupSelection } from "@icm/derived";
import type { Annotation, SchematicDocument } from "@icm/model";

import {
  effectiveRouteAttachment,
  looseRouteAnchorIds,
} from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

/**
 * A transient, editor-only description of what moves in one direct-manipulation
 * gesture. It intentionally contains no geometry or persisted state: Route
 * geometry remains planned by the Edit Engine and the Document remains the
 * sole source of electrical truth.
 */
export interface SelectionMovePlan {
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
  const internal = deriveInternalGroupSelection(document, instanceIds);
  const translatedRouteIds = new Set(internal.routeIds);
  const translatedJunctionIds = new Set(internal.junctionIds);
  const looseRouteIds = new Set<string>();
  const fixedObjectIds = new Set<string>();

  for (const routeId of selection.routeIds) {
    if (translatedRouteIds.has(routeId)) continue;
    const route = document.routes.find((candidate) => candidate.id === routeId);
    if (!route) continue;
    const anchors = looseRouteAnchorIds(document, route);
    if (!anchors) {
      fixedObjectIds.add(routeId);
      continue;
    }
    looseRouteIds.add(routeId);
    translatedRouteIds.add(routeId);
    translatedJunctionIds.add(anchors[0]);
    translatedJunctionIds.add(anchors[1]);
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
