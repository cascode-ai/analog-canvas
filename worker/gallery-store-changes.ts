import {
  type EntrySummaryRow,
  type SqlStorage,
  summaryOf,
} from "./gallery-store";

/**
 * Which entries changed, in the order they changed, for a reader keeping a
 * copy of the Gallery (`GET /api/gallery/maintenance/changes`). Triggers
 * record each entry's latest change as it is written, so reading changes
 * costs one indexed range, never a pass over every Project.
 *
 * One row per entry: its latest change's sequence number. Sequence numbers
 * only grow, so a reader that keeps the highest it has seen asks for what
 * came after.
 */

/** The columns whose change a copy must see: the card, the drawing, its Project. */
const WATCHED_COLUMNS = [
  "id",
  "name",
  "author",
  "description",
  "created_at",
  "owner_user_id",
  "schema_version",
  "tags",
  "curation_json",
  "netlistable",
  "preview_revision",
  "preview_width",
  "preview_height",
  "component_count",
  "ai_generated",
  "status",
  "project_text",
  "svg_text",
].join(", ");

const CHANGES_PAGE_LIMIT = 1000;

function recordChange(entryId: string): string {
  return `
    UPDATE gallery_change_counter SET seq = seq + 1 WHERE id = 1;
    INSERT OR REPLACE INTO gallery_entry_changes (entry_id, seq)
    VALUES (${entryId}, (SELECT seq FROM gallery_change_counter WHERE id = 1));`;
}

export function installEntryChanges(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_change_counter (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    seq INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS gallery_entry_changes (
    entry_id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL
  ) WITHOUT ROWID`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_gallery_entry_changes_seq
    ON gallery_entry_changes(seq)`);
  // A store from before this records every entry once, in id order.
  const fresh =
    sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM gallery_change_counter")
      .one().n === 0;
  if (fresh) {
    sql.exec(`INSERT INTO gallery_entry_changes (entry_id, seq)
      SELECT id, ROW_NUMBER() OVER (ORDER BY id) FROM gallery_entries`);
    sql.exec(`INSERT INTO gallery_change_counter (id, seq)
      SELECT 1, COUNT(*) FROM gallery_entries`);
  }
  for (const [name, event, id] of [
    ["insert", "INSERT", "NEW.id"],
    ["delete", "DELETE", "OLD.id"],
    ["update", `UPDATE OF ${WATCHED_COLUMNS}`, "NEW.id"],
  ] as const)
    sql.exec(`CREATE TRIGGER IF NOT EXISTS gallery_entry_changes_${name}
      AFTER ${event} ON gallery_entries
      BEGIN ${recordChange(id)} END`);
  // A reference image is part of what a copy keeps.
  for (const [name, event, id] of [
    ["insert", "INSERT", "NEW.entry_id"],
    ["update", "UPDATE", "NEW.entry_id"],
    ["delete", "DELETE", "OLD.entry_id"],
  ] as const)
    sql.exec(`CREATE TRIGGER IF NOT EXISTS entry_reference_changes_${name}
      AFTER ${event} ON entry_references
      BEGIN ${recordChange(id)} END`);
}

/**
 * Entries changed after `after`, oldest change first, up to 1000: a public
 * one with its wall card (and its reference image's revision), any other
 * as `removed`. `latest` is the store's newest change, so a reader may skip
 * to it; `nextCursor` resumes this listing.
 */
export function entryChanges(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const after = Math.max(Math.trunc(Number(body.after)) || 0, 0);
  const limit = Math.min(
    Math.max(Math.trunc(Number(body.limit)) || CHANGES_PAGE_LIMIT, 1),
    CHANGES_PAGE_LIMIT,
  );
  const latest = sql
    .exec<{ seq: number }>(
      "SELECT seq FROM gallery_change_counter WHERE id = 1",
    )
    .one().seq;
  const changed = sql
    .exec<{ entry_id: string; seq: number }>(
      `SELECT entry_id, seq FROM gallery_entry_changes
       WHERE seq > ? ORDER BY seq LIMIT ?`,
      after,
      limit + 1,
    )
    .toArray();
  const page = changed.slice(0, limit);
  // The page's cards by its seq range: Cloudflare's SQLite binds at most
  // 100 parameters, so a page of ids cannot go in an IN list.
  const cards = new Map(
    page.length === 0
      ? []
      : sql
          .exec<
            EntrySummaryRow & {
              reference_revision: string | null;
            }
          >(
            `SELECT e.id, e.name, e.author, e.description, e.created_at,
               e.owner_user_id, e.schema_version, e.tags, e.curation_json,
               e.netlistable, e.preview_revision, e.preview_width,
               e.preview_height, e.component_count, e.component_count_version,
               e.ai_generated,
               (SELECT revision FROM entry_references r
                 WHERE r.entry_id = e.id) AS reference_revision
             FROM gallery_entry_changes c
             JOIN gallery_entries e ON e.id = c.entry_id
             WHERE e.status = 'public' AND c.seq > ? AND c.seq <= ?`,
            after,
            page.at(-1)!.seq,
          )
          .toArray()
          .map((row) => [row.id, row]),
  );
  return Response.json({
    changes: page.map(({ entry_id, seq }) => {
      const card = cards.get(entry_id);
      if (!card) return { id: entry_id, seq, removed: true };
      const { likedByViewer: _viewer, ...entry } = summaryOf(card);
      return {
        id: entry_id,
        seq,
        entry: {
          ...entry,
          ...(card.reference_revision
            ? {
                hasReference: true,
                referenceRevision: card.reference_revision,
              }
            : {}),
        },
      };
    }),
    latest,
    nextCursor: changed.length > limit ? String(page.at(-1)!.seq) : null,
  });
}
