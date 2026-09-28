// Slab clipping tests the actual segment, not its axis-aligned bounding box.
export function segmentIntersectsRect(from, to, bounds) {
  let near = 0,
    far = 1;
  for (const [axis, size] of [
    ["x", "width"],
    ["y", "height"],
  ]) {
    const delta = to[axis] - from[axis];
    const min = bounds[axis],
      max = min + bounds[size];
    if (delta === 0) {
      if (from[axis] < min || from[axis] > max) return false;
      continue;
    }
    const a = (min - from[axis]) / delta,
      b = (max - from[axis]) / delta;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return true;
}
