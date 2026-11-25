import type { CircuitProject, SchematicDocument } from "./schema/types.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

function shareArray<T>(
  before: T[],
  after: T[],
  changed?: (row: T) => void,
): unknown[] {
  const beforeById = new Map<string, T>();
  for (const value of before) {
    const id = stableId(value);
    if (id !== undefined) beforeById.set(id, value);
  }

  const shared = after.map((value, index) => {
    const id = stableId(value);
    const prior = id === undefined ? undefined : beforeById.get(id);
    const result = shareJsonStructure(prior ?? before[index], value);
    // Only top-level, schema-validated objects with unique IDs are observed.
    if (changed && id !== undefined) {
      beforeById.delete(id);
      if (result !== prior) {
        if (prior !== undefined) changed(prior);
        changed(value);
      }
    }
    return result;
  });
  if (changed) for (const removed of beforeById.values()) changed(removed);

  if (
    shared.length === before.length &&
    shared.every((value, index) => value === before[index])
  ) {
    return before;
  }
  return shared.every((value, index) => value === after[index])
    ? after
    : shared;
}

function shareRecord(
  before: JsonRecord,
  after: JsonRecord,
  shareField?: (key: string) => unknown,
): JsonRecord {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const shared: JsonRecord = {};
  let unchanged = beforeKeys.length === afterKeys.length;
  let unchangedAfter = true;

  for (const key of afterKeys) {
    const value = shareField
      ? shareField(key)
      : shareJsonStructure(before[key], after[key]);
    shared[key] = value;
    if (value !== after[key]) unchangedAfter = false;
    if (!Object.hasOwn(before, key) || value !== before[key]) {
      unchanged = false;
    }
  }

  return unchanged ? before : unchangedAfter ? after : shared;
}

/**
 * Reuses references from a previous JSON-compatible model tree wherever the
 * next tree contains exactly the same value. Arrays of model objects are
 * matched by stable id so an insertion or reorder does not forfeit sharing.
 *
 * The edit engine calls this only after the next document has passed the model
 * schema. It is a storage optimization: the returned tree is value-equivalent
 * to `after` and changed nodes never reuse their previous object.
 */
function shareJsonStructure(before: unknown, after: unknown): unknown {
  if (Object.is(before, after)) return before;
  if (Array.isArray(before) && Array.isArray(after)) {
    return shareArray(before, after);
  }
  if (isRecord(before) && isRecord(after)) {
    return shareRecord(before, after);
  }
  return after;
}

export function shareEqualDocumentStructure(
  before: SchematicDocument,
  after: SchematicDocument,
  changedRoutingNetIds?: Set<string>,
): SchematicDocument {
  if (!changedRoutingNetIds || before === after)
    return shareJsonStructure(before, after) as SchematicDocument;
  const changed = (
    row: SchematicDocument["nets" | "junctions" | "routes"][number],
  ) => {
    if ("terminals" in row) changedRoutingNetIds.add(row.id);
    else {
      changedRoutingNetIds.add(row.netId);
      for (const member of row.members ?? [])
        changedRoutingNetIds.add(member.netId);
    }
  };
  return shareRecord(before, after, (key) => {
    if (key === "nets" || key === "junctions" || key === "routes")
      return shareArray<SchematicDocument[typeof key][number]>(
        before[key],
        after[key],
        changed,
      );
    return shareJsonStructure(
      before[key as keyof SchematicDocument],
      after[key as keyof SchematicDocument],
    );
  }) as SchematicDocument;
}

/** Share all unchanged Project facts after model validation, including definitions. */
export function shareEqualProjectStructure(
  before: CircuitProject,
  after: CircuitProject,
): CircuitProject {
  return shareJsonStructure(before, after) as CircuitProject;
}
