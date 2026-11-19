type Sql = { exec<T>(sql: string, ...args: any[]): { toArray(): T[] } };

/** A change ID from its identity columns, joined by ':'. */
export const identity = (key: string, ref = "") =>
  key
    .split(":")
    .map((c) => ref + c)
    .join("||':'||");

/** Aggregate maintenance must select authoritative rows before applying limits. */
export function locallyOwnedResources(
  sql: Sql,
  key = "id",
  scope: "resources" | "interactions" = "resources",
): string {
  if (!/^[a-z_.:]+$/.test(key)) throw new Error("Invalid resource key column");
  const meta =
    scope === "resources" ? "resource_replica" : "interaction_replica";
  const enabled = sql
    .exec(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${meta}_meta'`,
    )
    .toArray().length;
  return enabled
    ? `(${identity(key)}) NOT IN (SELECT id FROM ${meta}_keys WHERE origin<>(SELECT region FROM ${meta}_meta WHERE id=1))`
    : "1=1";
}
