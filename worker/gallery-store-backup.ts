// Backups: the one-row pages each scope reads, the revisions a capture
// compares, and restoring the Project-bearing tables.

import { sha256Hex } from "@icm/derived";
import {
  type DurableObjectStateLike,
  type SqlStorage,
  isRecord,
  svgPreviewDimensions,
} from "./gallery-store";
import { pruneCloudProjectVersions } from "./gallery-store-cloud-projects";
import {
  deleteOrphanGalleryData,
  pruneGalleryEntryVersions,
} from "./gallery-store-versions";
import {
  reapplySolFromAstra,
  syncAiSeatBylines,
} from "./gallery-store-bylines";
import { testbenchesMayBeInline } from "./gallery-store-maintenance";

function tableRows(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function rowValues(
  row: Record<string, unknown>,
  columns: readonly string[],
): Array<string | number | null> {
  return columns.map((column) => {
    const value = row[column];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return value;
    }
    throw new Error(`Backup row has invalid ${column}`);
  });
}

/**
 * The tables a backup page may name, by the name a request uses, with the key
 * its cursor follows. These names are an allowlist, never caller-supplied SQL
 * identifiers.
 */
const BACKUP_TABLES = {
  galleryEntries: { name: "gallery_entries", keys: ["id"] },
  galleryEntryVersions: { name: "gallery_entry_versions", keys: ["id"] },
  galleryLikes: { name: "gallery_likes", keys: ["entry_id", "user_id"] },
  cloudProjects: { name: "cloud_projects", keys: ["id"] },
  cloudProjectVersions: { name: "cloud_project_versions", keys: ["id"] },
} as const;
type BackupTable = keyof typeof BACKUP_TABLES;

/**
 * The tables each backup scope reads. A paginated capture compares its scope's
 * revision at the start and the end, so a private Project save never restarts
 * a Gallery-only capture, while any change to the rows it reads does.
 */
const BACKUP_SCOPES: Record<"gallery" | "store", readonly BackupTable[]> = {
  gallery: ["galleryEntries", "galleryEntryVersions", "galleryLikes"],
  store: [
    "galleryEntries",
    "galleryEntryVersions",
    "galleryLikes",
    "cloudProjects",
    "cloudProjectVersions",
  ],
};
export type BackupScope = keyof typeof BACKUP_SCOPES;

/**
 * Triggers count every row change per scope. The count lives in the database,
 * so a change that rolls back takes its count with it.
 */
export function installBackupRevisions(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS backup_revisions (
      scope TEXT PRIMARY KEY,
      revision INTEGER NOT NULL
    ) WITHOUT ROWID
  `);
  for (const [scope, tables] of Object.entries(BACKUP_SCOPES)) {
    sql.exec(
      "INSERT OR IGNORE INTO backup_revisions (scope, revision) VALUES (?, 0)",
      scope,
    );
    for (const table of tables)
      for (const event of ["INSERT", "UPDATE", "DELETE"])
        sql.exec(`
          CREATE TRIGGER IF NOT EXISTS backup_${scope}_${BACKUP_TABLES[table].name}_${event.toLowerCase()}
          AFTER ${event} ON ${BACKUP_TABLES[table].name}
          BEGIN
            UPDATE backup_revisions SET revision = revision + 1
            WHERE scope = '${scope}';
          END
        `);
  }
}

/**
 * Paginated raw backup of one scope: `gallery` (the default) for the
 * Gallery-only credential, `store` with private Cloud Projects for the store
 * credential and administrators.
 */
export function schemaBackup(
  sql: SqlStorage,
  backupEpoch: string,
  body: Record<string, unknown>,
): Response {
  // Bound each response to one record: a complete store can exceed the
  // Worker's memory limit before Response.json has even serialized it, so
  // there is no single-response dump. An unnamed scope reads the narrower.
  const scope: BackupScope = body.scope === "store" ? "store" : "gallery";
  const tables = Object.fromEntries(
    BACKUP_SCOPES[scope].map((key) => [key, BACKUP_TABLES[key]]),
  );
  if (body.table === "inventory") {
    return Response.json({
      format: "analog-canvas-gallery-backup-inventory-v1",
      scope,
      exportedAt: new Date().toISOString(),
      tables: Object.fromEntries(
        Object.entries(tables).map(([key, table]) => [
          key,
          sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM ${table.name}`,
            )
            .toArray()[0]!.count,
        ]),
      ),
      // A capture compares this at its start and end: any row its scope
      // reads that changed in between, even with equal counts, or a restart
      // of the object, restarts it.
      snapshotRevision: `${scope}:${backupEpoch}:${
        sql
          .exec<{
            revision: number;
          }>("SELECT revision FROM backup_revisions WHERE scope = ?", scope)
          .one().revision
      }`,
      schema: Object.values(tables).flatMap((table) =>
        sql
          .exec<{ type: string; name: string; sql: string }>(
            "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('table', 'index') AND sql IS NOT NULL ORDER BY type DESC, name",
            table.name,
          )
          .toArray(),
      ),
    });
  }
  if (body.table == null)
    return Response.json({ error: "table-required" }, { status: 400 });
  const table = Object.hasOwn(tables, String(body.table))
    ? tables[String(body.table)]
    : undefined;
  if (!table) return Response.json({ error: "invalid-table" }, { status: 400 });
  let after: unknown = null;
  try {
    if (body.after) after = JSON.parse(String(body.after));
  } catch {
    return Response.json({ error: "invalid-cursor" }, { status: 400 });
  }
  if (
    after !== null &&
    (!Array.isArray(after) ||
      after.length !== table.keys.length ||
      after.some((key) => typeof key !== "string"))
  ) {
    return Response.json({ error: "invalid-cursor" }, { status: 400 });
  }
  const columns = table.keys.join(", ");
  const condition =
    table.keys.length === 1
      ? `${columns} > ?`
      : `(${columns}) > (${table.keys.map(() => "?").join(", ")})`;
  const rows = sql
    .exec<Record<string, unknown>>(
      `SELECT * FROM ${table.name}${after ? ` WHERE ${condition}` : ""} ORDER BY ${columns} LIMIT 1`,
      ...((after as string[] | null) ?? []),
    )
    .toArray();
  return Response.json({
    format: "analog-canvas-gallery-backup-page-v1",
    table: body.table,
    rows,
    nextCursor: rows.length
      ? JSON.stringify(table.keys.map((key) => rows[0]![key]))
      : null,
  });
}

/** Restore the Project-bearing tables while enforcing current retention. */
export function schemaRestore(
  state: DurableObjectStateLike,
  rawBackup: unknown,
): Response {
  const sql = state.storage.sql;
  if (
    !isRecord(rawBackup) ||
    rawBackup.format !== "analog-canvas-gallery-schema-backup-v1"
  ) {
    return Response.json(
      { restored: false, error: "invalid-backup" },
      { status: 400 },
    );
  }
  const tables = isRecord(rawBackup.tables) ? rawBackup.tables : null;
  const galleryEntries = tableRows(tables?.galleryEntries);
  const galleryEntryVersions = tableRows(tables?.galleryEntryVersions);
  const cloudProjects = tableRows(tables?.cloudProjects);
  const cloudProjectVersions =
    tables?.cloudProjectVersions === undefined
      ? []
      : tableRows(tables.cloudProjectVersions);
  if (
    !galleryEntries ||
    !galleryEntryVersions ||
    !cloudProjects ||
    !cloudProjectVersions
  ) {
    return Response.json(
      { restored: false, error: "invalid-backup-tables" },
      { status: 400 },
    );
  }
  const retainedVersionCount = state.storage.transactionSync(() => {
    sql.exec("DELETE FROM gallery_entries");
    sql.exec("DELETE FROM gallery_entry_versions");
    sql.exec("DELETE FROM cloud_projects");
    sql.exec("DELETE FROM cloud_project_versions");
    for (const row of galleryEntries) {
      const values = rowValues(row, [
        "id",
        "name",
        "author",
        "description",
        "created_at",
        "schema_version",
        "status",
        "recycled_at",
        "owner_user_id",
        "submitter_email",
        "submitter_provider",
        "project_text",
        "svg_text",
        "reject_reason",
        "reviewed_at",
        "reviewed_by",
        "tags",
        "netlistable",
      ]);
      const svgText = values[12];
      if (typeof svgText !== "string") {
        throw new Error("Backup row has invalid svg_text");
      }
      const previewDimensions = svgPreviewDimensions(svgText);
      sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          recycled_at, owner_user_id, submitter_email, submitter_provider,
          project_text, svg_text, reject_reason, reviewed_at, reviewed_by,
          tags, netlistable, preview_revision, preview_width, preview_height, curation_json,
          ai_generated, testbench_text, simulation_check_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...values,
        sha256Hex(svgText),
        previewDimensions?.width ?? null,
        previewDimensions?.height ?? null,
        typeof row.curation_json === "string" ? row.curation_json : "",
        // Backups taken before the mark existed restore unmarked.
        row.ai_generated === 1 ? 1 : 0,
        // Backups taken before testbenches moved hold them in project_text.
        typeof row.testbench_text === "string" ? row.testbench_text : null,
        // A verdict comes back with the content it checked (#1545).
        typeof row.simulation_check_json === "string"
          ? row.simulation_check_json
          : null,
      );
    }
    for (const row of galleryEntryVersions) {
      sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description, tags,
          schema_version, project_text, svg_text, created_at, curation_json,
          testbench_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...rowValues(row, [
          "id",
          "entry_id",
          "version_no",
          "name",
          "author",
          "description",
          "tags",
          "schema_version",
          "project_text",
          "svg_text",
          "created_at",
        ]),
        typeof row.curation_json === "string" ? row.curation_json : "",
        typeof row.testbench_text === "string" ? row.testbench_text : null,
      );
    }
    deleteOrphanGalleryData(sql);
    pruneGalleryEntryVersions(sql);
    // Such a backup's testbenches move again with the next pass.
    testbenchesMayBeInline(sql);
    for (const row of cloudProjects) {
      sql.exec(
        `INSERT INTO cloud_projects
         (id, user_id, name, created_at, updated_at, revision,
          schema_version, project_text, gallery_entry_id, favorite, preview_svg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...rowValues(row, [
          "id",
          "user_id",
          "name",
          "created_at",
          "updated_at",
          "revision",
          "schema_version",
          "project_text",
        ]),
        typeof row.gallery_entry_id === "string" ? row.gallery_entry_id : null,
        row.favorite === 1 ? 1 : 0,
        typeof row.preview_svg === "string" ? row.preview_svg : "",
      );
    }
    for (const row of cloudProjectVersions) {
      const parent = cloudProjects.find(
        (project) => project.id === row.project_id,
      );
      if (
        !parent ||
        typeof row.revision !== "number" ||
        !Number.isInteger(row.revision) ||
        row.revision < 1 ||
        Number(parent.revision) <= row.revision
      )
        throw new Error("Invalid Shelf history parent or revision");
      sql.exec(
        `INSERT INTO cloud_project_versions
        (id, project_id, revision, name, saved_at, schema_version, project_text, preview_svg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ...rowValues(row, [
          "id",
          "project_id",
          "revision",
          "name",
          "saved_at",
          "schema_version",
          "project_text",
          "preview_svg",
        ]),
      );
    }
    pruneCloudProjectVersions(sql);
    return sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM gallery_entry_versions",
      )
      .one().count;
  });
  // A backup from before an AI account was one names it as it was, and
  // one from before GPT-6.1 Sol's circuits moved has them under GPT-6 Astra.
  syncAiSeatBylines(state);
  reapplySolFromAstra(state);
  const retainedCloudVersions = sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM cloud_project_versions",
    )
    .one().count;
  return Response.json({
    restored: true,
    records:
      galleryEntries.length +
      retainedVersionCount +
      cloudProjects.length +
      retainedCloudVersions,
    tables: {
      galleryEntries: galleryEntries.length,
      galleryEntryVersions: retainedVersionCount,
      cloudProjects: cloudProjects.length,
      cloudProjectVersions: retainedCloudVersions,
    },
  });
}
