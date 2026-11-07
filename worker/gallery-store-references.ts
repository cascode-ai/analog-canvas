// Reference images: a picture a community circuit's author (or the Owner)
// uploads as what the drawing was drawn from, such as a textbook figure.
// /review sets it beside the drawing, as a dataset's original figure.

import { sha256Hex } from "@icm/derived";
import { type SqlStorage, isRecord } from "./gallery-store";
import { decodedFigure } from "./gallery-store-comparisons";

export function installReferences(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entry_references (
      entry_id TEXT PRIMARY KEY,
      image_type TEXT NOT NULL,
      image_base64 TEXT NOT NULL,
      revision TEXT NOT NULL,
      uploader_id TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    ) WITHOUT ROWID
  `);
  // Which entries have one, and its revision, without reading the images.
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_entry_references_revision
    ON entry_references(entry_id, revision)`);
}

/**
 * Why the uploader may not change an entry's reference, or null: only its
 * owner and the Owner may.
 */
function refusal(sql: SqlStorage, body: Record<string, unknown>) {
  const entry = sql
    .exec<{ owner_user_id: string | null }>(
      "SELECT owner_user_id FROM gallery_entries INDEXED BY idx_gallery_entries_card WHERE id = ?",
      String(body.entryId ?? ""),
    )
    .toArray()[0];
  if (!entry) return Response.json({ error: "not-found" }, { status: 404 });
  if (
    body.uploaderIsOwner !== true &&
    (entry.owner_user_id === null || entry.owner_user_id !== body.uploaderId)
  )
    return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

/** Set an entry's reference image: its owner or the Owner. */
export function setReference(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body))
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const entryId = String(body.entryId ?? "");
  const refused = refusal(sql, body);
  if (refused) return refused;
  if (body.rights !== true)
    return Response.json({ error: "rights-required" }, { status: 400 });
  const image = decodedFigure(body.image);
  if (!image) return Response.json({ error: "invalid-image" }, { status: 400 });
  const revision = sha256Hex(`${image.type}\u0000${image.data}`).slice(0, 16);
  sql.exec(
    `INSERT OR REPLACE INTO entry_references
       (entry_id, image_type, image_base64, revision, uploader_id, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    entryId,
    image.type,
    image.data,
    revision,
    String(body.uploaderId ?? ""),
    new Date().toISOString(),
  );
  return Response.json({ revision });
}

export function deleteReference(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body))
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const refused = refusal(sql, body);
  if (refused) return refused;
  sql.exec(
    "DELETE FROM entry_references WHERE entry_id = ?",
    String(body.entryId),
  );
  return Response.json({ ok: true });
}

/** A public entry's reference image. */
export function readReference(sql: SqlStorage, body: unknown): Response {
  const entryId = isRecord(body) ? String(body.entryId ?? "") : "";
  const row = sql
    .exec<{ image_type: string; image_base64: string; revision: string }>(
      `SELECT r.image_type, r.image_base64, r.revision FROM entry_references r
       CROSS JOIN gallery_entries e INDEXED BY idx_gallery_entries_card
         ON e.id = r.entry_id
       WHERE r.entry_id = ? AND e.status = 'public'`,
      entryId,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    type: row.image_type,
    data: row.image_base64,
    revision: row.revision,
  });
}
