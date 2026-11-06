import type { ComponentLibrarySummary } from "@icm/agent-adapter";

export interface ComponentRecordGroup {
  key: string;
  /** What the row places: the newest record that can be placed. */
  head: ComponentLibrarySummary;
  others: ComponentLibrarySummary[];
}

/**
 * One author's records of one name read as one row with a count, as repeated
 * Cells do in the tree. This is only a view: every record keeps its own
 * identity, stays listed under its row and can be placed on its own.
 */
export function groupCatalogEntries(
  entries: readonly ComponentLibrarySummary[],
): ComponentRecordGroup[] {
  const groups = new Map<string, ComponentLibrarySummary[]>();
  for (const entry of entries) {
    const key = `${entry.authorId}\n${entry.name.trim().toLowerCase()}`;
    const members = groups.get(key);
    if (members) members.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups].map(([key, members]) => {
    const [head, ...others] = [...members].sort(
      (left, right) =>
        Number(left.capability === "needs-repair") -
          Number(right.capability === "needs-repair") ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    );
    return { key, head: head!, others };
  });
}
