import type { DraftingObject, DrawingOrderEntry } from "@icm/model";

/** The host object that an object-anchored drafting text label rides on. */
export function draftingLabelOwnerId(
  object: DraftingObject,
): string | undefined {
  return object.kind === "text" && object.anchor.kind === "object"
    ? object.anchor.objectId
    : undefined;
}

/** Owned labels immediately above their host in the paint order. */
export function gatheredDrawingLabelOwners(
  order: readonly DrawingOrderEntry[],
  owners: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const gathered = new Map<string, string>();
  let owner: string | undefined;
  for (const entry of order) {
    if (entry.kind === "instance") {
      owner = entry.id;
    } else if (
      (entry.kind === "annotation" || entry.kind === "drafting") &&
      owner &&
      owners.get(entry.id) === owner
    ) {
      gathered.set(entry.id, owner);
    } else if (entry.kind === "drafting") {
      owner = entry.id;
    } else {
      owner = undefined;
    }
  }
  return gathered;
}
