import type { Point } from "@icm/model";
import type { SnapAnchor } from "./engine";

interface Entry {
  target: SnapAnchor;
  x: number;
  y: number;
  order: number;
}

interface CoordinateIndex {
  entries: Entry[];
  x: Entry[];
  y: Entry[];
}

const indexes = new WeakMap<readonly SnapAnchor[], CoordinateIndex>();

function coordinateIndex(
  targets: readonly SnapAnchor[],
): CoordinateIndex | undefined {
  const cached = indexes.get(targets);
  // Callers may reuse mutable arrays/points. Identity alone cannot certify an
  // index: checking N coordinates is still far cheaper than movingCount*N.
  if (
    cached &&
    cached.entries.length === targets.length &&
    cached.entries.every(
      (entry, i) =>
        entry.target === targets[i] &&
        entry.x === targets[i]!.point.x &&
        entry.y === targets[i]!.point.y,
    )
  )
    return cached;
  const entries = targets.map((target, order) => ({
    target,
    order,
    x: target.point.x,
    y: target.point.y,
  }));
  if (entries.some((e) => !Number.isFinite(e.x) || !Number.isFinite(e.y)))
    return undefined;
  const index = {
    entries,
    x: [...entries].sort((a, b) => a.x - b.x || a.order - b.order),
    y: [...entries].sort((a, b) => a.y - b.y || a.order - b.order),
  };
  indexes.set(targets, index);
  return index;
}

function range(
  entries: readonly Entry[],
  axis: "x" | "y",
  min: number,
  max: number,
) {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (entries[mid]![axis] < min) low = mid + 1;
    else high = mid;
  }
  const result: Entry[] = [];
  for (let i = low; i < entries.length && entries[i]![axis] <= max; i++)
    result.push(entries[i]!);
  return result;
}

/** A superset for both axis alignment and exact electrical capture. Remote
 * alignment on either axis stays eligible; the caller retains its exact rules. */
export function translationTargetCandidates(
  targets: readonly SnapAnchor[],
  radius: number,
): (point: Point) => readonly SnapAnchor[] {
  if (targets.length < 64 || !Number.isFinite(radius) || radius < 0)
    return () => targets;
  const index = coordinateIndex(targets);
  if (!index) return () => targets;
  return (point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return targets;
    const candidates = new Map<number, Entry>();
    for (const e of range(index.x, "x", point.x - radius, point.x + radius))
      candidates.set(e.order, e);
    for (const e of range(index.y, "y", point.y - radius, point.y + radius))
      candidates.set(e.order, e);
    return [...candidates.values()]
      .sort((a, b) => a.order - b.order)
      .map((e) => e.target);
  };
}
