const frozenSnapshots = new WeakSet<object>();

export function isFrozenSnapshot(value: object): boolean {
  return frozenSnapshots.has(value);
}

/** Own a JSON model snapshot before sharing it between revision-scoped readers. */
export function freezeSnapshot<T>(value: T): T {
  if (
    value !== null &&
    typeof value === "object" &&
    !frozenSnapshots.has(value)
  ) {
    frozenSnapshots.add(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
