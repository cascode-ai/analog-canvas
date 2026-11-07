// Bookmarks: circuits a reader keeps for reference from Statistics. Each
// reader's own and private; a store keeps its circuits' ones.

import { type SqlStorage } from "./gallery-store";

export function installBookmarks(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entry_bookmarks (
      user_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, entry_id)
    ) WITHOUT ROWID
  `);
}

/** Keep or let go of one public circuit; answers whether it is now kept. */
export function toggleBookmark(
  sql: SqlStorage,
  body: { userId: string; id: string; at: string },
): Response {
  const exists = sql
    .exec<{ id: string }>(
      "SELECT id FROM gallery_entries WHERE id = ? AND status = 'public'",
      body.id,
    )
    .toArray()[0];
  if (!exists) return Response.json({ error: "not-found" }, { status: 404 });
  const kept =
    sql
      .exec(
        "DELETE FROM entry_bookmarks WHERE user_id = ? AND entry_id = ? RETURNING entry_id",
        body.userId,
        body.id,
      )
      .toArray().length === 0;
  if (kept)
    sql.exec(
      "INSERT INTO entry_bookmarks (user_id, entry_id, created_at) VALUES (?, ?, ?)",
      body.userId,
      body.id,
      body.at,
    );
  return Response.json({ saved: kept });
}

/** The ids a reader keeps here, newest first. */
export function bookmarks(sql: SqlStorage, userId: string): Response {
  return Response.json({
    ids: sql
      .exec<{ entry_id: string }>(
        "SELECT entry_id FROM entry_bookmarks WHERE user_id = ? ORDER BY created_at DESC",
        userId,
      )
      .toArray()
      .map((row) => row.entry_id),
  });
}
