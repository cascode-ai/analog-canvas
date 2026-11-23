export function groupedBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string | readonly string[] | undefined,
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    if (!key) continue;
    for (const entry of typeof key === "string" ? [key] : new Set(key)) {
      const group = groups.get(entry) ?? [];
      group.push(value);
      groups.set(entry, group);
    }
  }
  return groups;
}
