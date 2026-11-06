// Each account's circuit statistics: its public circuits, each with its part
// and transistor counts. The transistor count is read from the stored
// Project, so it is kept in a small table of its own, beside its rule's
// version: the wall's covering indexes, which the part count rides in, stay
// as they are.

import { parseProject } from "@icm/project-protocol";
import {
  galleryTransistorCount,
  TRANSISTOR_COUNT_RULE_VERSION,
} from "./gallery-components";
import type { SqlStorage } from "./gallery-store";

export function installTransistorCounts(sql: SqlStorage): void {
  // A count of null: a Project this build cannot read, not tried again
  // until the rule changes.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS gallery_entry_transistors (
      entry_id TEXT PRIMARY KEY,
      transistors INTEGER,
      rule_version INTEGER NOT NULL
    ) WITHOUT ROWID
  `);
}

/** A changed or reused entry's count is read again. Callers own the transaction. */
export function forgetTransistorCount(sql: SqlStorage, entryId: string): void {
  sql.exec("DELETE FROM gallery_entry_transistors WHERE entry_id = ?", entryId);
}

/** The join that gives an entry `e` its current count as `t.transistors`. */
export const CURRENT_TRANSISTORS = `LEFT JOIN gallery_entry_transistors t
  ON t.entry_id = e.id AND t.rule_version = ${TRANSISTOR_COUNT_RULE_VERSION}`;

/** Count and keep the transistors of these entries, one Project at a time. */
function countTransistors(sql: SqlStorage, ids: readonly string[]): void {
  for (const id of ids) {
    const row = sql
      .exec<{
        project_text: string;
      }>("SELECT project_text FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) continue;
    let transistors: number | null;
    try {
      transistors = galleryTransistorCount(parseProject(row.project_text));
    } catch {
      transistors = null;
    }
    sql.exec(
      `INSERT INTO gallery_entry_transistors(entry_id, transistors, rule_version)
       VALUES (?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         transistors = excluded.transistors,
         rule_version = excluded.rule_version`,
      id,
      transistors,
      TRANSISTOR_COUNT_RULE_VERSION,
    );
  }
}

/** The public entries of one author key whose count is missing or stale. */
function uncounted(
  sql: SqlStorage,
  author: { sql: string; binding: string },
  limit: number,
): string[] {
  return sql
    .exec<{ id: string }>(
      `SELECT e.id FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND ${author.sql} AND t.entry_id IS NULL
       ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      author.binding,
      limit,
    )
    .toArray()
    .map((row) => row.id);
}

/**
 * The circuits an author key names: an account ID, or `legacy:` and the
 * byline of an entry no account owns, as the Owner's Data tab keys authors.
 */
function authorCondition(key: string): {
  sql: string;
  binding: string;
} {
  return key.startsWith("legacy:")
    ? {
        sql: "COALESCE(e.owner_user_id, '') = '' AND e.author = ?",
        binding: key.slice("legacy:".length),
      }
    : { sql: "e.owner_user_id = ?", binding: key };
}

/**
 * How many uncounted circuits one read counts before it answers; the
 * scheduled pass counts the rest, so a read never stalls on a large account.
 */
const COUNTED_PER_READ = 400;

/** Count one author's circuits that have no current count yet. */
export function countAuthorTransistors(sql: SqlStorage, key: string): void {
  countTransistors(sql, uncounted(sql, authorCondition(key), COUNTED_PER_READ));
}

/**
 * One author's public circuits, newest first, each with its part count (the
 * wall's, null while unknown) and its transistor count.
 */
export function circuitStats(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const key = typeof body.author === "string" ? body.author : "";
  if (!key) return Response.json({ error: "author-required" }, { status: 400 });
  countAuthorTransistors(sql, key);
  const author = authorCondition(key);
  const rows = sql
    .exec<{
      id: string;
      name: string;
      created_at: string;
      components: number | null;
      transistors: number | null;
    }>(
      `SELECT e.id, e.name, e.created_at,
              CASE WHEN e.component_count_version > 0
                THEN e.component_count END AS components,
              t.transistors
       FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND ${author.sql}
       ORDER BY e.created_at DESC, e.id DESC`,
      author.binding,
    )
    .toArray();
  return Response.json({
    circuits: rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      components: row.components === null ? null : Number(row.components),
      transistors: row.transistors === null ? null : Number(row.transistors),
    })),
  });
}

/**
 * One batch of the scheduled pass: the public entries with no current
 * transistor count are counted, and counts whose entry is gone are dropped.
 * When everything is counted the pass reads one index and stops.
 */
export function refreshTransistorCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 400);
  const ids = sql
    .exec<{ id: string }>(
      `SELECT e.id FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND t.entry_id IS NULL
       ORDER BY e.id LIMIT ?`,
      limit,
    )
    .toArray()
    .map((row) => row.id);
  countTransistors(sql, ids);
  sql.exec(
    `DELETE FROM gallery_entry_transistors
     WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
  );
  const remaining = Number(
    sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM gallery_entries e INDEXED BY idx_gallery_entries_card
         ${CURRENT_TRANSISTORS}
         WHERE e.status = 'public' AND t.entry_id IS NULL`,
      )
      .toArray()[0]?.count ?? 0,
  );
  return Response.json({ counted: ids.length, remaining });
}

/**
 * One batch of the Owner's Recount: every public entry after `after`, in ID
 * order, counted again whatever its count, so a full recount leaves no gap
 * in the totals. `next` resumes it; null when the last batch is done.
 */
export function recountTransistors(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 400);
  const after = typeof body.after === "string" ? body.after : "";
  const ids = sql
    .exec<{ id: string }>(
      `SELECT id FROM gallery_entries
       WHERE status = 'public' AND id > ? ORDER BY id LIMIT ?`,
      after,
      limit,
    )
    .toArray()
    .map((row) => row.id);
  countTransistors(sql, ids);
  const last = ids.at(-1);
  const remaining = last
    ? Number(
        sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM gallery_entries
             WHERE status = 'public' AND id > ?`,
            last,
          )
          .toArray()[0]?.count ?? 0,
      )
    : 0;
  return Response.json({
    counted: ids.length,
    remaining,
    next: remaining > 0 ? last : null,
  });
}
