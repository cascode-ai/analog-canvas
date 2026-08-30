import type { SchematicDocument } from "@icm/model";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

function shareArray(before: unknown[], after: unknown[]): unknown[] {
  const beforeById = new Map<string, unknown>();
  for (const value of before) {
    const id = stableId(value);
    if (id !== undefined) beforeById.set(id, value);
  }

  const shared = after.map((value, index) => {
    const id = stableId(value);
    const candidate =
      id === undefined ? before[index] : (beforeById.get(id) ?? before[index]);
    return shareJsonStructure(candidate, value);
  });

  if (
    shared.length === before.length &&
    shared.every((value, index) => value === before[index])
  ) {
    return before;
  }
  return shared;
}

function shareRecord(before: JsonRecord, after: JsonRecord): JsonRecord {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const shared: JsonRecord = {};
  let unchanged = beforeKeys.length === afterKeys.length;

  for (const key of afterKeys) {
    const value = shareJsonStructure(before[key], after[key]);
    shared[key] = value;
    if (!Object.hasOwn(before, key) || value !== before[key]) {
      unchanged = false;
    }
  }

  return unchanged ? before : shared;
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
): SchematicDocument {
  return shareJsonStructure(before, after) as SchematicDocument;
}
