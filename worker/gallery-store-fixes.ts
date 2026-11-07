// Fixes: each change of an entry's drawing, who made it, how much it
// changed, and which open review issues of the version it replaced it
// answers. Rows are only added; with the reviews they are the workload.

import { type SqlStorage } from "./gallery-store";

export function installFixes(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entry_fixes (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      from_revision TEXT NOT NULL,
      to_revision TEXT NOT NULL,
      editor_id TEXT NOT NULL,
      editor_name TEXT NOT NULL,
      devices INTEGER NOT NULL,
      wires INTEGER NOT NULL,
      labels INTEGER NOT NULL,
      addressed TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_entry_fixes_entry
    ON entry_fixes(entry_id, created_at)`);
  // `edit`: a person's fix of a dataset's drawing in the editor, credited
  // beside its byline; empty for an import or an entry's own update.
  try {
    sql.exec(
      "ALTER TABLE entry_fixes ADD COLUMN kind TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    // Column already present.
  }
}

type Objects = Map<string, string>;

/** Each document's objects of one kind, by id, as text to compare. */
function objectsOf(project: unknown, kinds: string[]): Objects {
  const objects: Objects = new Map();
  const documents = (project as { documents?: unknown[] })?.documents;
  for (const document of Array.isArray(documents) ? documents : []) {
    const record = document as Record<string, unknown>;
    for (const kind of kinds) {
      const list = record[kind];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const id = (item as { id?: unknown })?.id;
        if (typeof id === "string")
          objects.set(
            `${String(record.id)}/${kind}/${id}`,
            JSON.stringify(item),
          );
      }
    }
  }
  return objects;
}

/** Objects added, removed or changed between two maps. */
function changed(before: Objects, after: Objects): number {
  let count = 0;
  for (const [key, text] of after) if (before.get(key) !== text) count += 1;
  for (const key of before.keys()) if (!after.has(key)) count += 1;
  return count;
}

/**
 * How much a drawing changed: devices (instances), wires (routes and their
 * junctions) and labels (annotations and drafting text) added, removed or
 * changed. Unreadable text counts as nothing changed.
 */
function changeSize(
  beforeText: string,
  afterText: string,
): { devices: number; wires: number; labels: number } {
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return { devices: 0, wires: 0, labels: 0 };
  }
  const size = (kinds: string[]) =>
    changed(objectsOf(before, kinds), objectsOf(after, kinds));
  return {
    devices: size(["instances"]),
    wires: size(["routes", "junctions"]),
    labels: size(["annotations", "drafting"]),
  };
}

/**
 * Record a change of an entry's drawing, inside the caller's transaction,
 * before the entry's row takes the new version. A change that leaves the
 * preview as it was is no fix.
 */
export function recordFix(
  sql: SqlStorage,
  fix: {
    entryId: string;
    fromRevision: string;
    toRevision: string;
    beforeText: string;
    afterText: string;
    editorId: unknown;
    editorName: unknown;
    at: string;
    kind?: "edit";
  },
): void {
  if (fix.fromRevision === fix.toRevision) return;
  const addressed = sql
    .exec<{ id: string }>(
      `SELECT id FROM entry_reviews WHERE entry_id = ? AND preview_revision = ?
         AND verdict = 'issue' AND resolved_at IS NULL`,
      fix.entryId,
      fix.fromRevision,
    )
    .toArray()
    .map((row) => row.id);
  const size = changeSize(fix.beforeText, fix.afterText);
  sql.exec(
    `INSERT INTO entry_fixes (id, entry_id, from_revision, to_revision,
       editor_id, editor_name, devices, wires, labels, addressed, created_at,
       kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    fix.entryId,
    fix.fromRevision,
    fix.toRevision,
    typeof fix.editorId === "string" ? fix.editorId : "",
    typeof fix.editorName === "string" && fix.editorName
      ? fix.editorName.slice(0, 120)
      : "Unknown",
    size.devices,
    size.wires,
    size.labels,
    addressed.join(","),
    fix.at,
    fix.kind ?? "",
  );
}

/** Every entry's fixers in this store, as fixersOf names them. */
export function allFixers(sql: SqlStorage): Map<string, string[]> {
  const fixers = new Map<string, string[]>();
  for (const row of sql
    .exec<{ entry_id: string; editor_name: string }>(
      "SELECT entry_id, editor_name FROM entry_fixes WHERE kind = 'edit' ORDER BY created_at",
    )
    .toArray()) {
    const names = fixers.get(row.entry_id) ?? [];
    if (!names.includes(row.editor_name)) names.push(row.editor_name);
    fixers.set(row.entry_id, names);
  }
  return fixers;
}

/**
 * Who fixed each of these entries' drawings in the editor (`edit` fixes),
 * each name once, first fixer first: the entry's second byline.
 */
export function fixersOf(
  sql: SqlStorage,
  ids: readonly string[],
): Map<string, string[]> {
  const fixers = new Map<string, string[]>();
  if (ids.length === 0) return fixers;
  for (const row of sql
    .exec<{ entry_id: string; editor_name: string }>(
      `SELECT entry_id, editor_name FROM entry_fixes
       WHERE kind = 'edit' AND entry_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY created_at`,
      ...ids,
    )
    .toArray()) {
    const names = fixers.get(row.entry_id) ?? [];
    if (!names.includes(row.editor_name)) names.push(row.editor_name);
    fixers.set(row.entry_id, names);
  }
  return fixers;
}

/** An entry's fixes, newest first. */
export function entryFixes(sql: SqlStorage, entryId: string) {
  return sql
    .exec<{
      id: string;
      from_revision: string;
      to_revision: string;
      editor_name: string;
      devices: number;
      wires: number;
      labels: number;
      addressed: string;
      created_at: string;
    }>(
      "SELECT * FROM entry_fixes WHERE entry_id = ? ORDER BY created_at DESC",
      entryId,
    )
    .toArray()
    .map((row) => ({
      id: row.id,
      fromRevision: row.from_revision,
      toRevision: row.to_revision,
      editor: row.editor_name,
      devices: row.devices,
      wires: row.wires,
      labels: row.labels,
      addressed: row.addressed ? row.addressed.split(",").length : 0,
      at: row.created_at,
    }));
}

/** Each editor's fixes in this store: how many, of how many circuits, how much. */
export function fixTotals(sql: SqlStorage) {
  return sql
    .exec<{
      editor_id: string;
      editor_name: string;
      fixes: number;
      circuits: number;
      devices: number;
      wires: number;
      labels: number;
      addressed: number;
    }>(
      `SELECT editor_id, editor_name, COUNT(*) AS fixes,
         COUNT(DISTINCT entry_id) AS circuits, SUM(devices) AS devices,
         SUM(wires) AS wires, SUM(labels) AS labels,
         SUM(CASE WHEN addressed = '' THEN 0
           ELSE LENGTH(addressed) - LENGTH(REPLACE(addressed, ',', '')) + 1 END)
           AS addressed
       FROM entry_fixes GROUP BY editor_id`,
    )
    .toArray();
}
