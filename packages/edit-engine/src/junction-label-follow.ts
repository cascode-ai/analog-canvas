import type { Point, SchematicDocument } from "@icm/model";

/**
 * Free Net labels follow the Junction they name (#2293).
 *
 * A free label names a Junction when it is a `net-label` of that Junction's
 * Net whose anchor lies within one grid square of it on each axis, and that
 * Junction is the nearest one of the Net. When the transaction moves the
 * Junction and leaves the label where it was, the label moves by the same
 * offset. Its Net binding is unchanged; a locked label, or one the
 * transaction itself placed, stays put.
 */
export function moveFreeNetLabelsWithJunctions(
  before: SchematicDocument,
  draft: SchematicDocument,
  changedObjectIds: Set<string>,
): void {
  const moved = new Map<string, Point>();
  const afterById = new Map(draft.junctions.map((j) => [j.id, j]));
  for (const junction of before.junctions) {
    const after = afterById.get(junction.id);
    if (!after) continue;
    const delta = {
      x: after.position.x - junction.position.x,
      y: after.position.y - junction.position.y,
    };
    if (delta.x !== 0 || delta.y !== 0) moved.set(junction.id, delta);
  }
  if (moved.size === 0) return;
  const reach = before.presentation.grid;
  const draftLabels = new Map(draft.annotations.map((a) => [a.id, a]));
  for (const label of before.annotations) {
    if (
      label.kind !== "net-label" ||
      label.anchor.kind !== "free" ||
      label.locked
    )
      continue;
    const at = label.anchor.position;
    let nearest: { id: string; distance: number } | null = null;
    for (const junction of before.junctions) {
      if (junction.netId !== label.netId) continue;
      const dx = Math.abs(at.x - junction.position.x);
      const dy = Math.abs(at.y - junction.position.y);
      const distance = Math.hypot(dx, dy);
      if (
        dx <= reach &&
        dy <= reach &&
        distance < (nearest?.distance ?? Infinity)
      )
        nearest = { id: junction.id, distance };
    }
    const delta = nearest && moved.get(nearest.id);
    if (!delta) continue;
    const current = draftLabels.get(label.id);
    if (
      current?.anchor.kind !== "free" ||
      current.anchor.position.x !== at.x ||
      current.anchor.position.y !== at.y
    )
      continue;
    current.anchor = {
      ...current.anchor,
      position: { x: at.x + delta.x, y: at.y + delta.y },
    };
    changedObjectIds.add(current.id);
  }
}
