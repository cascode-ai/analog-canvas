import { resolveVisualAnchor } from "@icm/derived";
import { translateDraftingObject } from "@icm/edit-engine";
import {
  snapGridPoint,
  type DraftingObject,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { draftingDragOrigin } from "./drafting-manipulation";

/** Object-anchored text can change its offset without moving its host. Route
 * attachments that cannot own an independent translation remain followers. */
export function canMoveDraftingIndependently(object: DraftingObject): boolean {
  return (
    (object.kind === "text" && object.anchor.kind === "object") ||
    draftingDragOrigin(object) !== null
  );
}

export function draftingMoveOrigin(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: DraftingObject,
): Point | null {
  return object.kind === "text" && object.anchor.kind === "object"
    ? resolveVisualAnchor(document, resolver, object.anchor).position
    : draftingDragOrigin(object);
}

/** Editor movement differs from paste: paste retains a remapped attachment,
 * whereas independently selected text changes its existing placement offset. */
export function translateDraftingMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: DraftingObject,
  delta: Point,
): DraftingObject {
  if (object.kind !== "text" || object.anchor.kind !== "object")
    return translateDraftingObject(object, delta, 1);
  const position = resolveVisualAnchor(
    document,
    resolver,
    object.anchor,
  ).position;
  return {
    ...object,
    anchor: {
      ...object.anchor,
      localOffset: snapGridPoint(
        {
          x: object.anchor.localOffset.x + delta.x,
          y: object.anchor.localOffset.y + delta.y,
        },
        1,
      ),
      fallbackPosition: snapGridPoint(
        { x: position.x + delta.x, y: position.y + delta.y },
        1,
      ),
    },
  };
}
