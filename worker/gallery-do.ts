// Community example gallery: publish-first with an admin recycle bin.
//
// Trust boundary: the only accepted input is Project JSON that passes the
// strict protocol boundary (`parseProject`, rolling-window upgrade applied).
// Everything served back — canonical Project text and the preview SVG — is
// derived server-side from that validated model; no client-supplied markup
// is ever stored or echoed. Signing in is the whole publishing gate: any
// signed-in account publishes straight to the wall, and every entry records
// the submitting account's email and provider so it stays traceable. An
// admin session can reject with an author-visible reason, recycle (soft,
// restorable), hard-delete from the bin only, and batch re-serialize every
// entry to keep
// long-lived records inside the rolling schema window. Previews are stored
// independently so browsing survives an entry the current window can no
// longer open.

import {
  type DurableObjectStateLike,
  type SqlStorage,
  svgPreviewDimensions,
} from "./gallery-store";
import {
  SOL_FROM_ASTRA_MIGRATION,
  moveSolFromAstra,
  renameOwner,
  syncAiSeatBylines,
} from "./gallery-store-bylines";
import {
  allIds,
  galleryProjectFormat,
  labelLooksRead,
  labelLooksStore,
  netlistSources,
  refreshNetlistable,
  schemaConverge,
} from "./gallery-store-maintenance";
import {
  authorCounts,
  catalog,
  list,
  ownerData,
  tagCounts,
  toggleLike,
} from "./gallery-store-wall";
import {
  cloudProjectCreate,
  cloudProjectDelete,
  cloudProjectFavorite,
  cloudProjectList,
  cloudProjectOpen,
  cloudProjectPreview,
  cloudProjectPreviewStore,
  cloudProjectUpdate,
  cloudProjectVersions,
} from "./gallery-store-cloud-projects";
import {
  aiSeatEntries,
  countOpen,
  entry,
  forgetOpens,
  importEntry,
  mine,
  preview,
  previewAccess,
  quota,
  replaceEntry,
  submit,
  updateEntry,
} from "./gallery-store-entries";
import {
  curate,
  deleteAccount,
  deleteEntry,
  recycleDuplicates,
  recycled,
  reject,
  rejected,
  setStatus,
} from "./gallery-store-moderation";
import {
  deleteOrphanGalleryData,
  pruneGalleryEntryVersions,
  restoreVersion,
  version,
  versions,
} from "./gallery-store-versions";
import {
  installBackupRevisions,
  schemaBackup,
  schemaRestore,
} from "./gallery-store-backup";

const TOKENZHANG_BYLINE_MIGRATION = "2026-08-26-tokenzhang-to-zhishuai-zhang";
const TOKENZHANG_BYLINE = "Zhishuai Zhang";
const MAGIC_LI_BYLINE_MIGRATION = "2026-09-19-3187863239-netizen-to-magic-li";
const MAGIC_LI_LEGACY_BYLINE = "3187863239-netizen";
const MAGIC_LI_BYLINE = "Magic Li";
const VERSION_RETENTION_MIGRATION = "2026-08-27-gallery-version-retention-2";
const PREVIEW_DIMENSIONS_MIGRATION = "2026-09-02-gallery-preview-dimensions";

/**
 * Storage-only Durable Object: it owns the schema and dispatches each
 * operation to the gallery-store*.ts modules. Policy lives in
 * `routeGalleryRequest` (gallery.ts) and the route modules it calls.
 */
export class GalleryDO {
  private readonly sql: SqlStorage;
  /**
   * This start of the object. A restart — a deploy, or a point-in-time
   * restore that also rewinds the revisions — restarts a capture too.
   */
  private readonly backupEpoch = crypto.randomUUID();

  constructor(private readonly state: DurableObjectStateLike) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gallery_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        recycled_at TEXT,
        owner_user_id TEXT,
        submitter_email TEXT,
        submitter_provider TEXT,
        project_text TEXT NOT NULL,
        svg_text TEXT NOT NULL,
        preview_revision TEXT NOT NULL DEFAULT '',
        preview_width REAL,
        preview_height REAL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entries_status_created
      ON gallery_entries(status, created_at)
    `);
    // Covers both the public contributor roll-up and exact-author feeds.
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entries_status_author
      ON gallery_entries(status, author)
    `);
    // One thumb per account per circuit, so the primary key is the rule.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gallery_likes (
        entry_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        liked_at TEXT NOT NULL,
        PRIMARY KEY (entry_id, user_id)
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_likes_entry
      ON gallery_likes(entry_id)
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entries_owner_created
      ON gallery_entries(owner_user_id, created_at)
    `);
    // The daily quota used to live in its own counter table, which survived
    // deletion and so could not be given back. It now counts the entries
    // themselves; the old table is dropped rather than left to accumulate.
    this.sql.exec("DROP TABLE IF EXISTS gallery_submissions");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gallery_entry_versions (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        schema_version INTEGER NOT NULL,
        project_text TEXT NOT NULL,
        svg_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entry_versions_entry
      ON gallery_entry_versions(entry_id, version_no)
    `);
    // A signed-in account's private, stable Projects. Save updates one row;
    // each changed save keeps the three preceding revisions separately.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cloud_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        schema_version INTEGER NOT NULL,
        project_text TEXT NOT NULL,
        preview_svg TEXT NOT NULL DEFAULT ''
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_cloud_projects_user
      ON cloud_projects(user_id, updated_at)
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cloud_project_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        name TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        project_text TEXT NOT NULL,
        preview_svg TEXT NOT NULL DEFAULT ''
      ) WITHOUT ROWID
    `);
    this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_project_versions
      ON cloud_project_versions(project_id, revision)`);
    // One-time conversion of the retired rolling workspace shelf. Old rows
    // become stable Projects at revision 1; no compatibility route remains.
    try {
      this.sql.exec(`
        INSERT OR IGNORE INTO cloud_projects
          (id, user_id, name, created_at, updated_at, revision,
           schema_version, project_text)
        SELECT id, user_id, name, saved_at, saved_at, 1,
               schema_version, project_text
        FROM workspace_slots
      `);
      this.sql.exec("DROP TABLE workspace_slots");
    } catch {
      // Fresh databases never had the retired table.
    }
    // Additive columns for pre-existing databases.
    for (const alteration of [
      "ALTER TABLE gallery_entries ADD COLUMN curation_json TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entry_versions ADD COLUMN curation_json TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN reject_reason TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_by TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_email TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_provider TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN netlistable INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN netlistable_version INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN component_count INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN component_count_version INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN preview_revision TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN preview_width REAL",
      "ALTER TABLE gallery_entries ADD COLUMN preview_height REAL",
      "ALTER TABLE gallery_entries ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE cloud_projects ADD COLUMN preview_svg TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE cloud_projects ADD COLUMN gallery_entry_id TEXT",
      "ALTER TABLE cloud_projects ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
    ]) {
      try {
        this.sql.exec(alteration);
      } catch {
        // Column already present.
      }
    }
    // Counts and contributor roll-ups scan metadata across the filtered wall.
    // Cover those reads without visiting wide rows containing Project/SVG text.
    // Keep after the additive columns for existing databases. No query, cursor,
    // permission, freshness or result ordering changes; SQLite maintains this
    // index atomically with the same writes that update Gallery metadata.
    // The part count and the AI mark joined the counts and filters later, so
    // the index that covers them was rebuilt with each. Without the AI mark,
    // every page's AI and Human counts read it off the row, walking each
    // entry's Project and SVG text: about 139,000 pages of a 1,269-entry
    // Gallery per click, against about 100 with it.
    this.sql.exec("DROP INDEX IF EXISTS idx_gallery_entries_feed_stats");
    this.sql.exec("DROP INDEX IF EXISTS idx_gallery_entries_feed_stats_parts");
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entries_feed_stats_ai
      ON gallery_entries(status, owner_user_id, author, netlistable,
        ai_generated, tags, curation_json, component_count)
    `);
    syncAiSeatBylines(this.state);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS data_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    installBackupRevisions(this.sql);
    // Which circuits each account opened today; the scheduled pass (and the
    // first counted open of a new day) drops earlier days. Not a backup table.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gallery_daily_opens (
        day TEXT NOT NULL,
        user_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        PRIMARY KEY (day, user_id, entry_id)
      ) WITHOUT ROWID
    `);
    this.state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          PREVIEW_DIMENSIONS_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      const rows = this.sql
        .exec<{ id: string; svg_text: string }>(
          `SELECT id, svg_text FROM gallery_entries
           WHERE preview_width IS NULL OR preview_height IS NULL`,
        )
        .toArray();
      for (const row of rows) {
        const dimensions = svgPreviewDimensions(row.svg_text);
        if (!dimensions) continue;
        this.sql.exec(
          `UPDATE gallery_entries SET preview_width = ?, preview_height = ?
           WHERE id = ?`,
          dimensions.width,
          dimensions.height,
          row.id,
        );
      }
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        PREVIEW_DIMENSIONS_MIGRATION,
        new Date().toISOString(),
      );
    });
    this.state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          TOKENZHANG_BYLINE_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      // Keep every surface consistent, including recycled entries and the
      // snapshots that can later be restored from version history.
      for (const table of ["gallery_entries", "gallery_entry_versions"]) {
        this.sql.exec(
          `UPDATE ${table} SET author = ?
           WHERE LOWER(REPLACE(TRIM(author), ' ', '')) = 'tokenzhang'`,
          TOKENZHANG_BYLINE,
        );
      }
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        TOKENZHANG_BYLINE_MIGRATION,
        new Date().toISOString(),
      );
    });
    this.state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          MAGIC_LI_BYLINE_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      // A restored snapshot must not bring the old public byline back, so the
      // current entries and their restorable histories move together.
      for (const table of ["gallery_entries", "gallery_entry_versions"]) {
        this.sql.exec(
          `UPDATE ${table} SET author = ?
           WHERE LOWER(TRIM(author)) = LOWER(?)`,
          MAGIC_LI_BYLINE,
          MAGIC_LI_LEGACY_BYLINE,
        );
      }
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        MAGIC_LI_BYLINE_MIGRATION,
        new Date().toISOString(),
      );
    });
    this.state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          VERSION_RETENTION_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      deleteOrphanGalleryData(this.sql);
      pruneGalleryEntryVersions(this.sql);
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        VERSION_RETENTION_MIGRATION,
        new Date().toISOString(),
      );
    });
    this.state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          SOL_FROM_ASTRA_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      const appliedAt = new Date().toISOString();
      moveSolFromAstra(this.sql, appliedAt);
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        SOL_FROM_ASTRA_MIGRATION,
        appliedAt,
      );
    });
    // Direct publishing retired the review queue. An entry still waiting for
    // a reviewer would otherwise be stranded — listed nowhere, approvable by
    // nothing — so publish it, which is what its author asked for. An entry a
    // reviewer actually rejected keeps that decision.
    this.sql.exec(
      "UPDATE gallery_entries SET status = 'public' WHERE status = 'pending'",
    );
  }

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname.slice(1);
    const body =
      request.method === "POST"
        ? ((await request.json()) as Record<string, unknown>)
        : {};
    switch (operation) {
      case "submit":
        return submit(this.state, body);
      case "import-entry":
        return importEntry(this.state, body);
      case "public-count":
        return Response.json({
          count: this.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM gallery_entries WHERE status = 'public'",
            )
            .one().count,
        });
      case "topology-inventory":
        return Response.json({
          ids: this.sql
            .exec<{ id: string }>(
              "SELECT id FROM gallery_entries WHERE status = 'public' ORDER BY id",
            )
            .toArray()
            .map((row) => row.id),
        });
      case "list":
        return list(this.sql, body);
      case "catalog":
        return catalog(this.sql);
      case "entry":
        return entry(this.sql, String(body.id), "public");
      case "any-entry":
        return entry(this.sql, String(body.id), null);
      case "count-open":
        return countOpen(
          this.state,
          String(body.userId),
          String(body.entryId),
          String(body.day),
        );
      case "forget-opens":
        return forgetOpens(this.sql, String(body.day));
      case "preview-access":
        return previewAccess(this.sql, String(body.id));
      case "preview":
        return preview(this.sql, String(body.id));
      case "set-status":
        return setStatus(
          this.state,
          String(body.id),
          String(body.status),
          String(body.at),
        );
      case "reject":
        return reject(this.sql, body);
      case "recycle-duplicates":
        return recycleDuplicates(this.state, body);
      case "delete":
        return deleteEntry(
          this.state,
          String(body.id),
          body.requireRecycled !== false,
        );
      case "delete-account":
        return deleteAccount(this.state, String(body.userId ?? ""));
      case "recycled":
        return recycled(this.sql);
      case "rejected":
        return rejected(this.sql);
      case "mine":
        return mine(this.sql, String(body.ownerUserId));
      case "ai-seat-entries":
        return aiSeatEntries(this.sql);
      case "quota":
        return quota(this.sql, String(body.ownerUserId), String(body.day));
      case "all-ids":
        return allIds(this.sql);
      case "netlistable-refresh":
        return refreshNetlistable(this.sql, body);
      case "curate":
        return curate(this.state, body);
      case "tags":
        return tagCounts(this.sql, body);
      case "authors":
        return authorCounts(this.sql);
      case "owner-data":
        return ownerData(this.sql, body);
      case "rename-owner":
        return renameOwner(this.state, body);
      case "update-entry":
        return updateEntry(this.sql, body);
      case "label-looks-read":
        return labelLooksRead(this.sql, String(body.id), body.table);
      case "netlist-sources":
        return netlistSources(this.sql, body);
      case "label-looks-store":
        return labelLooksStore(this.sql, body);
      case "replace-entry":
        return replaceEntry(this.state, body);
      case "versions":
        return versions(this.sql, String(body.entryId));
      case "version":
        return version(this.sql, String(body.entryId), String(body.versionId));
      case "restore-version":
        return restoreVersion(this.state, body);
      case "toggle-like":
        return toggleLike(
          this.sql,
          String(body.id),
          String(body.userId),
          String(body.at),
        );
      case "cloud-project-create":
        return cloudProjectCreate(this.sql, body);
      case "cloud-project-favorite":
        return cloudProjectFavorite(this.sql, body);
      case "cloud-project-versions":
        return cloudProjectVersions(
          this.sql,
          String(body.userId),
          String(body.id),
          body.versionId,
        );
      case "cloud-project-update":
        return cloudProjectUpdate(this.state, body);
      case "cloud-project-list":
        return cloudProjectList(this.sql, String(body.userId));
      case "cloud-project-open":
        return cloudProjectOpen(this.sql, String(body.userId), String(body.id));
      case "cloud-project-delete":
        return cloudProjectDelete(
          this.state,
          String(body.userId),
          String(body.id),
        );
      case "cloud-project-preview":
        return cloudProjectPreview(
          this.sql,
          String(body.userId),
          String(body.id),
        );
      case "cloud-project-preview-store":
        return cloudProjectPreviewStore(
          this.sql,
          String(body.userId),
          String(body.id),
          Number(body.revision),
          String(body.previewSvg),
        );
      case "schema-backup":
        return schemaBackup(this.sql, this.backupEpoch, body);
      case "gallery-project-format":
        return galleryProjectFormat(this.sql, body);
      case "schema-converge":
        return schemaConverge(this.state, body.apply === true);
      case "schema-restore":
        return schemaRestore(this.state, body.backup);
      default:
        return Response.json({ error: "Unknown operation" }, { status: 404 });
    }
  }
}
