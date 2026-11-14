import type { DrawingOrderEntry } from "@icm/model";

/** Owned annotations immediately above their instance in the paint order. */
export function gatheredDrawingLabelOwners(
  order: readonly DrawingOrderEntry[],
  owners: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const gathered = new Map<string, string>();
  let owner: string | undefined;
  for (const entry of order) {
    if (entry.kind === "instance") owner = entry.id;
    else if (
      entry.kind === "annotation" &&
      owner &&
      owners.get(entry.id) === owner
    )
      gathered.set(entry.id, owner);
    else owner = undefined;
  }
  return gathered;
}
