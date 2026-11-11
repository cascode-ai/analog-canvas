import { isRecord, type SqlStorage } from "./gallery-store";

export const BACKUP_TABLES = {
  galleryEntries: { name: "gallery_entries", keys: ["id"] },
  galleryEntryVersions: { name: "gallery_entry_versions", keys: ["id"] },
  galleryLikes: { name: "gallery_likes", keys: ["entry_id", "user_id"] },
  cloudProjects: { name: "cloud_projects", keys: ["id"] },
  cloudProjectVersions: { name: "cloud_project_versions", keys: ["id"] },
  entryReviews: { name: "entry_reviews", keys: ["id"] },
  entryFixes: { name: "entry_fixes", keys: ["id"] },
  entryReferences: { name: "entry_references", keys: ["entry_id"] },
  entryBookmarks: { name: "entry_bookmarks", keys: ["user_id", "entry_id"] },
  selectionBoards: { name: "boards", keys: ["id"] },
  selectionBoardItems: { name: "board_items", keys: ["id"] },
  selectionBoardEvents: { name: "board_events", keys: ["seq"] },
  entryOpens: { name: "gallery_entry_opens", keys: ["entry_id", "day"] },
} as const;
export type BackupTable = keyof typeof BACKUP_TABLES;
export const BACKUP_SCOPES: Record<
  "gallery" | "store" | "reviews" | "activity",
  readonly BackupTable[]
> = {
  gallery: ["galleryEntries", "galleryEntryVersions", "galleryLikes"],
  store: [
    "galleryEntries",
    "galleryEntryVersions",
    "galleryLikes",
    "cloudProjects",
    "cloudProjectVersions",
  ],
  // Reviews, fixes and reference images: each store's, a dataset's too.
  // Their own scope, so a review restarts no Gallery capture and leaves the
  // wall's cached statistics alone.
  reviews: ["entryReviews", "entryFixes", "entryReferences"],
  activity: [
    "entryBookmarks",
    "selectionBoards",
    "selectionBoardItems",
    "selectionBoardEvents",
    "entryOpens",
  ],
};
export type BackupScope = keyof typeof BACKUP_SCOPES;
const RETAINED_REVISIONS = 100_000;
const PAGE_SIZE = 256;

/** Latest changed keys only: no Project contents or replacement of business rows. */
export function installBackupIndex(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS backup_change_clock (
    scope TEXT PRIMARY KEY, revision INTEGER NOT NULL
  ) WITHOUT ROWID`);
  sql.exec(`CREATE TABLE IF NOT EXISTS backup_changed_keys (
    scope TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL,
    revision INTEGER NOT NULL, PRIMARY KEY(scope, table_name, row_key)
  ) WITHOUT ROWID`);
  sql.exec(`CREATE INDEX IF NOT EXISTS backup_changed_keys_revision
    ON backup_changed_keys(scope, revision, table_name, row_key)`);
  for (const [scope, tables] of Object.entries(BACKUP_SCOPES)) {
    sql.exec("INSERT OR IGNORE INTO backup_change_clock VALUES (?, 0)", scope);
    for (const table of tables) {
      const definition = BACKUP_TABLES[table];
      for (const event of ["INSERT", "UPDATE", "DELETE"]) {
        const sides =
          event === "UPDATE"
            ? ["OLD", "NEW"]
            : [event === "DELETE" ? "OLD" : "NEW"];
        const keys = sides
          .map(
            (side) => `
          INSERT INTO backup_changed_keys(scope, table_name, row_key, revision)
          VALUES ('${scope}', '${table}', json_array(${definition.keys.map((key) => `${side}.${key}`).join(", ")}),
            (SELECT revision FROM backup_change_clock WHERE scope = '${scope}'))
          ON CONFLICT(scope, table_name, row_key) DO UPDATE SET revision = excluded.revision;
        `,
          )
          .join("\n");
        sql.exec(`CREATE TRIGGER IF NOT EXISTS backup_keys_${scope}_${table}_${event.toLowerCase()}
          AFTER ${event} ON ${definition.name} BEGIN
            UPDATE backup_change_clock SET revision = revision + 1 WHERE scope = '${scope}';
            ${keys}
            DELETE FROM backup_changed_keys WHERE scope = '${scope}' AND revision <=
              (SELECT revision - ${RETAINED_REVISIONS} FROM backup_change_clock WHERE scope = '${scope}');
          END`);
      }
    }
  }
}

export function backupChangeCursor(
  sql: SqlStorage,
  epoch: string,
  scope: BackupScope,
) {
  return {
    epoch,
    revision: sql
      .exec<{ revision: number }>(
        "SELECT revision FROM backup_change_clock WHERE scope = ?",
        scope,
      )
      .one().revision,
  };
}

/** Changes can move beyond this window while paging. The collector must fence at the end. */
export function backupChangedKeys(
  sql: SqlStorage,
  epoch: string,
  scope: BackupScope,
  after: unknown,
): Response {
  let cursor: unknown;
  try {
    cursor = JSON.parse(String(after));
  } catch {
    /* rejected below */
  }
  const validRevision = (n: unknown): n is number =>
    Number.isSafeInteger(n) && Number(n) >= 0;
  if (
    !isRecord(cursor) ||
    typeof cursor.epoch !== "string" ||
    !validRevision(cursor.since) ||
    !validRevision(cursor.until) ||
    cursor.since > cursor.until ||
    (cursor.position !== undefined &&
      (!Array.isArray(cursor.position) ||
        cursor.position.length !== 3 ||
        !validRevision(cursor.position[0]) ||
        typeof cursor.position[1] !== "string" ||
        typeof cursor.position[2] !== "string" ||
        cursor.position[0] <= cursor.since ||
        cursor.position[0] > cursor.until))
  ) {
    return Response.json({ error: "invalid-change-cursor" }, { status: 400 });
  }
  const current = backupChangeCursor(sql, epoch, scope);
  if (
    cursor.epoch !== epoch ||
    cursor.since < Math.max(0, current.revision - RETAINED_REVISIONS) ||
    cursor.until > current.revision
  ) {
    return Response.json({ error: "backup-capture-expired" }, { status: 409 });
  }
  const position = cursor.position as [number, string, string] | undefined;
  const rows = sql
    .exec<{ revision: number; table_name: BackupTable; row_key: string }>(
      `SELECT revision,table_name,row_key FROM backup_changed_keys
     WHERE scope = ? AND revision > ? AND revision <= ?
     ${position ? "AND (revision,table_name,row_key) > (?,?,?)" : ""}
     ORDER BY revision,table_name,row_key LIMIT ${PAGE_SIZE + 1}`,
      scope,
      cursor.since,
      cursor.until,
      ...(position ?? []),
    )
    .toArray();
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return Response.json({
    changes: page.map((row) => ({
      table: row.table_name,
      key: JSON.parse(row.row_key),
    })),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? JSON.stringify({
            epoch,
            since: cursor.since,
            until: cursor.until,
            position: [last.revision, last.table_name, last.row_key],
          })
        : null,
  });
}
