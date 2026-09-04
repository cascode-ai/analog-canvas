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

import { evaluateSubmissionGates, sha256Hex } from "@icm/derived";
import { analyzeDesignNetlist } from "@icm/netlist";
import {
  parseProject,
  serializeProject,
  upgradeSchema24To25,
  upgradeSchema25To26,
  upgradeSchema26To27,
  upgradeSchema27To28,
  upgradeSchema28To29WithReport,
  upgradeSchema29To30WithReport,
  upgradeSchema30To31WithReport,
  upgradeSchema31To32WithReport,
  upgradeSchema32To33WithReport,
  upgradeSchema33To34WithReport,
  upgradeSchema34To35WithReport,
  upgradeSchema35To36WithReport,
  upgradeSchema36To37WithReport,
} from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type CircuitProject,
} from "@icm/model";

import type { AuthNamespaceLike } from "./auth";

/**
 * A circuit's id is its address, so it is short enough to read out loud and
 * type. Ten characters of this alphabet carry ~50 bits — far more than the
 * wall will ever hold — and the alphabet drops the characters that get
 * misread when someone copies a link off a screen: no 0/o, 1/l/i, or u.
 *
 * Existing entries keep the UUIDs they were given. This shortens what new
 * links look like; it never rewrites an address someone may have shared.
 */
const SHORT_ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const SHORT_ID_LENGTH = 10;

export function shortId(length = SHORT_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const byte of bytes) {
    id += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
  }
  return id;
}

export const GALLERY_MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const GALLERY_MAX_REJECT_REASON_LENGTH = 500;
/** How many distinct private Cloud Projects one account may own. */
export const CLOUD_PROJECT_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export interface CloudProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

interface CloudProjectRow {
  id: string;
  name: string;
  updated_at: string;
  revision: number;
  schema_version: number;
}

interface StoredProjectRow {
  id: string;
  schema_version: number;
  project_text: string;
}
export const GALLERY_MAX_NAME_LENGTH = 120;
export const GALLERY_MAX_AUTHOR_LENGTH = 40;
export const GALLERY_MAX_DESCRIPTION_LENGTH = 300;
/**
 * Publishes one account may make in a UTC day. Anti-garbage protection, not a
 * pace limit: ten stopped an ordinary afternoon of posting a chapter's worth
 * of figures. It counted by IP before it counted by account, so one shared
 * campus or office exit spent the allowance for everyone behind it.
 */
export const GALLERY_DAILY_SUBMISSION_LIMIT = 100;
/**
 * Recycle-bin retention. The quota deliberately refunds a withdrawal
 * (recycling counts as taking work down), which leaves publish->recycle
 * cycling bounded only by request rate while every cycle stores a full
 * project_text/svg_text row. The per-account cap closes that
 * write-amplification channel without touching the quota semantics: from
 * entry 26 onward net storage growth is zero regardless of cycling rate,
 * and the rule is one an author can state — the bin holds their 25 most
 * recent withdrawals. Deliberately no age expiry: a clock destroys work on
 * a schedule the author cannot reason about, and against the burst threat
 * it was the weaker half anyway. An author always held the stronger right
 * of deleting their own entry outright in one step.
 */
export const GALLERY_RECYCLED_KEEP_PER_ACCOUNT = 25;
export const GALLERY_MAX_TAGS = 5;
export const GALLERY_MAX_TAG_LENGTH = 24;
/** How many previous states each Gallery entry retains. */
export const GALLERY_MAX_VERSIONS_PER_ENTRY = 2;
export const GALLERY_DEFAULT_LIST_LIMIT = 30;
export const GALLERY_MAX_LIST_LIMIT = 60;

export interface SvgPreviewDimensions {
  width: number;
  height: number;
}

/** Read the renderer-owned SVG viewBox without parsing or trusting its body. */
export function svgPreviewDimensions(
  svgText: string,
): SvgPreviewDimensions | null {
  const root = /<svg\b[^>]*>/iu.exec(svgText)?.[0];
  const value = root
    ? /\bviewBox\s*=\s*(["'])(.*?)\1/iu.exec(root)?.[2]
    : undefined;
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    parts.length !== 4 ||
    !parts.every(Number.isFinite) ||
    parts[2]! <= 0 ||
    parts[3]! <= 0
  ) {
    return null;
  }
  return { width: parts[2]!, height: parts[3]! };
}

type SqlResult<T> = {
  toArray(): T[];
  one(): T;
};

type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};

/** Enforce retention by count, even for imported rows with sparse versions. */
function pruneGalleryEntryVersions(sql: SqlStorage, entryId?: string): void {
  const entryFilter = entryId === undefined ? "" : "WHERE entry_id = ?";
  sql.exec(
    `DELETE FROM gallery_entry_versions
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY entry_id
                  ORDER BY version_no DESC, id DESC
                ) AS retention_rank
         FROM gallery_entry_versions
         ${entryFilter}
       )
       WHERE retention_rank > ?
     )`,
    ...(entryId === undefined ? [] : [entryId]),
    GALLERY_MAX_VERSIONS_PER_ENTRY,
  );
}

function deleteOrphanGalleryData(sql: SqlStorage): void {
  sql.exec(
    `DELETE FROM gallery_entry_versions
     WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
  );
  sql.exec(
    `DELETE FROM gallery_likes
     WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
  );
}

type DurableObjectStateLike = {
  storage: {
    sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
  };
};

export type GalleryNamespaceLike = {
  getByName(name: string): {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
};

export type GalleryEnv = {
  GALLERY: GalleryNamespaceLike;
  /** Sessions are the only identity: publishing requires one. */
  AUTH?: AuthNamespaceLike;
  ADMIN_EMAILS?: string;
  ADMIN_EMAILS_EXTRA?: string;
};

export interface GalleryEntrySummary {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  /**
   * Content revision of the stored SVG. The public URL includes this so a
   * changed rendering gets a new cache key while identical bytes reuse the
   * existing immutable response.
   */
  previewRevision: string;
  /** Intrinsic preview ratio; absent only for an invalid or legacy SVG. */
  previewWidth?: number;
  previewHeight?: number;
  schemaVersion: number;
  tags: string[];
  /**
   * Whether this circuit currently extracts to a design netlist. A schematic
   * is allowed to be abbreviated, so this is a mark of extra completeness and
   * never a gate: circuits without it are published and browsed alike.
   */
  netlistable: boolean;
  likes: number;
  /** Whether the requesting account has liked it; false when signed out. */
  likedByViewer: boolean;
}

/**
 * One tag normalization for every write and filter: trimmed, lowercased,
 * inner whitespace collapsed, `[a-z0-9 +/-]` only, capped in length and
 * count, deduplicated.
 */
export function sanitizeGalleryTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw
      .toLowerCase()
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[^a-z0-9 +/-]/gu, "")
      .slice(0, GALLERY_MAX_TAG_LENGTH)
      .trim();
    if (tag.length === 0 || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === GALLERY_MAX_TAGS) break;
  }
  return tags;
}

/** Storage form: `,a,b,` so `LIKE '%,a,%'` matches exactly one tag. */
export function wrapTags(tags: string[]): string {
  return tags.length === 0 ? "" : `,${tags.join(",")},`;
}

function unwrapTags(stored: string | null): string[] {
  if (!stored) return [];
  return stored.split(",").filter((tag) => tag.length > 0);
}

interface EntryRow {
  id: string;
  name: string;
  author: string;
  description: string;
  created_at: string;
  schema_version: number;
  status: string;
  recycled_at: string | null;
  owner_user_id: string | null;
  submitter_email: string | null;
  submitter_provider: string | null;
  tags: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  project_text: string;
  svg_text: string;
  netlistable: number;
  preview_revision: string;
  preview_width: number | null;
  preview_height: number | null;
}

type EntrySummaryRow = Pick<
  EntryRow,
  | "id"
  | "name"
  | "author"
  | "description"
  | "created_at"
  | "schema_version"
  | "tags"
  | "netlistable"
  | "preview_revision"
  | "preview_width"
  | "preview_height"
>;

interface PreviewAccessRow {
  status: string;
  owner_user_id: string | null;
  preview_revision: string;
}

interface PreviewRow extends PreviewAccessRow {
  svg_text: string;
}

const TOKENZHANG_BYLINE_MIGRATION = "2026-08-26-tokenzhang-to-zhishuai-zhang";
const TOKENZHANG_BYLINE = "Zhishuai Zhang";
const VERSION_RETENTION_MIGRATION = "2026-08-27-gallery-version-retention-2";
const PREVIEW_DIMENSIONS_MIGRATION = "2026-09-02-gallery-preview-dimensions";

function summaryOf(
  row: EntrySummaryRow & { likes?: number; liked_by_viewer?: number },
): GalleryEntrySummary {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    createdAt: row.created_at,
    // Existing rows receive the additive column as empty. "legacy" moves
    // them off the formerly mutable URL once; their next SVG write stores a
    // content hash like every new row.
    previewRevision: row.preview_revision || "legacy",
    ...(row.preview_width !== null && row.preview_height !== null
      ? {
          previewWidth: row.preview_width,
          previewHeight: row.preview_height,
        }
      : {}),
    schemaVersion: row.schema_version,
    tags: unwrapTags(row.tags),
    netlistable: row.netlistable === 1,
    likes: row.likes ?? 0,
    likedByViewer: (row.liked_by_viewer ?? 0) === 1,
  };
}

/** Storage-only Durable Object; policy lives in `routeGalleryRequest`. */
export class GalleryDO {
  private readonly sql: SqlStorage;

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
    // it never consumes another slot or creates implicit version history.
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
      "ALTER TABLE gallery_entries ADD COLUMN reject_reason TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_by TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_email TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_provider TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN netlistable INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN preview_revision TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN preview_width REAL",
      "ALTER TABLE gallery_entries ADD COLUMN preview_height REAL",
      "ALTER TABLE cloud_projects ADD COLUMN preview_svg TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.sql.exec(alteration);
      } catch {
        // Column already present.
      }
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS data_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
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
        return this.submit(body);
      case "list":
        return this.list(body);
      case "entry":
        return this.entry(String(body.id), "public");
      case "any-entry":
        return this.entry(String(body.id), null);
      case "preview-access":
        return this.previewAccess(String(body.id));
      case "preview":
        return this.preview(String(body.id));
      case "set-status":
        return this.setStatus(
          String(body.id),
          String(body.status),
          String(body.at),
        );
      case "reject":
        return this.reject(body);
      case "delete":
        return this.delete(String(body.id), body.requireRecycled !== false);
      case "recycled":
        return this.recycled();
      case "rejected":
        return this.rejected();
      case "mine":
        return this.mine(String(body.ownerUserId));
      case "all-ids":
        return this.allIds();
      case "tags":
        return this.tagCounts();
      case "update-entry":
        return this.updateEntry(body);
      case "replace-entry":
        return this.replaceEntry(body);
      case "versions":
        return this.versions(String(body.entryId));
      case "version":
        return this.version(String(body.entryId), String(body.versionId));
      case "restore-version":
        return this.restoreVersion(body);
      case "toggle-like":
        return this.toggleLike(
          String(body.id),
          String(body.userId),
          String(body.at),
        );
      case "cloud-project-create":
        return this.cloudProjectCreate(body);
      case "cloud-project-update":
        return this.cloudProjectUpdate(body);
      case "cloud-project-list":
        return this.cloudProjectList(String(body.userId));
      case "cloud-project-open":
        return this.cloudProjectOpen(String(body.userId), String(body.id));
      case "cloud-project-delete":
        return this.cloudProjectDelete(String(body.userId), String(body.id));
      case "cloud-project-preview":
        return this.cloudProjectPreview(String(body.userId), String(body.id));
      case "cloud-project-preview-store":
        return this.cloudProjectPreviewStore(
          String(body.userId),
          String(body.id),
          Number(body.revision),
          String(body.previewSvg),
        );
      case "schema-backup":
        return this.schemaBackup();
      case "schema-converge":
        return this.schemaConverge(body.apply === true);
      case "schema-restore":
        return this.schemaRestore(body.backup);
      default:
        return Response.json({ error: "Unknown operation" }, { status: 404 });
    }
  }

  /**
   * One thumb per account, and pressing it again takes it back. The entry has
   * to exist and be public: a like is not a way to discover a withdrawn one.
   */
  private toggleLike(id: string, userId: string, at: string): Response {
    const entry = this.sql
      .exec<{ status: string }>(
        "SELECT status FROM gallery_entries WHERE id = ?",
        id,
      )
      .toArray()[0];
    if (!entry || entry.status !== "public") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const existing = this.sql
      .exec<{ entry_id: string }>(
        "SELECT entry_id FROM gallery_likes WHERE entry_id = ? AND user_id = ?",
        id,
        userId,
      )
      .toArray();
    if (existing.length > 0) {
      this.sql.exec(
        "DELETE FROM gallery_likes WHERE entry_id = ? AND user_id = ?",
        id,
        userId,
      );
    } else {
      this.sql.exec(
        "INSERT INTO gallery_likes(entry_id, user_id, liked_at) VALUES (?, ?, ?)",
        id,
        userId,
        at,
      );
    }
    const likes =
      this.sql
        .exec<{
          count: number;
        }>("SELECT COUNT(*) AS count FROM gallery_likes WHERE entry_id = ?", id)
        .toArray()[0]?.count ?? 0;
    return Response.json({ likes, likedByViewer: existing.length === 0 });
  }

  /** A free id, redrawn on the vanishing chance the first one is taken. */
  private freeEntryId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = shortId();
      const taken = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM gallery_entries WHERE id = ?",
          candidate,
        )
        .toArray();
      if (taken.length === 0) return candidate;
    }
    // Eight collisions in a row is not chance; fall back to something that
    // cannot collide rather than looping or overwriting an entry.
    return crypto.randomUUID();
  }

  private submit(body: Record<string, unknown>): Response {
    const entry = body.entry as EntryRow;
    const previewRevision = sha256Hex(entry.svg_text);
    const previewDimensions = svgPreviewDimensions(entry.svg_text);
    const day = String(body.day);
    // The daily quota is anti-garbage protection for ordinary submitters;
    // admin and moderator sessions are exempt (they curate).
    //
    // It counts the account's own entries for the day rather than a separate
    // tally, so taking work down gives the allowance back. That is
    // deliberate: the quota exists to bound how much a stranger can dump on
    // the wall at once, not to ration how many times someone may change
    // their mind.
    //
    // Withdrawing to the recycle bin therefore counts as taking it down, the
    // same as deleting. The entry has left the wall; making the author wait
    // for a curator to empty the bin would ration the second thought rather
    // than the dumping. Restoring it publishes it again, and the slot is
    // spent again with it.
    //
    // 'recycled' is the whole exemption, and 'rejected' is deliberately not
    // in it: a rejection is the wall's owner turning work away, not the
    // author changing their mind. Refunding it would mean the harder a
    // curator works the more that account may publish, which points the
    // quota away from the submitter it exists to bound.
    const enforceLimit = body.enforceLimit !== false;
    const outcome = this.state.storage.transactionSync(() => {
      if (enforceLimit) {
        const used = this.sql
          .exec<{
            count: number;
          }>(
            `SELECT COUNT(*) AS count FROM gallery_entries
             WHERE owner_user_id = ? AND substr(created_at, 1, 10) = ?
               AND status <> 'recycled'`,
            entry.owner_user_id ?? "",
            day,
          )
          .one().count;
        if (used >= GALLERY_DAILY_SUBMISSION_LIMIT) {
          return { status: "rate-limited" as const };
        }
      }
      entry.id = this.freeEntryId();
      this.sql.exec(
        `INSERT INTO gallery_entries(
          id, name, author, description, created_at, schema_version,
          status, recycled_at, owner_user_id, submitter_email,
          submitter_provider, tags, project_text, svg_text, netlistable,
          preview_revision, preview_width, preview_height
        ) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.name,
        entry.author,
        entry.description,
        entry.created_at,
        entry.schema_version,
        entry.owner_user_id ?? null,
        entry.submitter_email ?? null,
        entry.submitter_provider ?? null,
        entry.tags ?? "",
        entry.project_text,
        entry.svg_text,
        entry.netlistable ?? 0,
        previewRevision,
        previewDimensions?.width ?? null,
        previewDimensions?.height ?? null,
      );
      this.sweepRecycledRows(entry.owner_user_id ?? "");
      return { status: "stored" as const };
    });
    if (outcome.status === "rate-limited") {
      return Response.json({ error: "rate-limited" }, { status: 429 });
    }
    return Response.json({ id: entry.id, previewRevision });
  }

  private list(body: Record<string, unknown>): Response {
    const limit = Math.min(
      Math.max(Number(body.limit) || GALLERY_DEFAULT_LIST_LIMIT, 1),
      GALLERY_MAX_LIST_LIMIT,
    );
    const cursor = typeof body.cursor === "string" ? body.cursor : null;
    const author =
      typeof body.author === "string" && body.author.length > 0
        ? body.author
        : null;
    const conditions = ["status = 'public'"];
    const bindings: (string | number)[] = [];
    if (author) {
      conditions.push("author = ?");
      bindings.push(author);
    }
    const tags = sanitizeGalleryTags(body.tags);
    if (tags.length > 0) {
      conditions.push(`(${tags.map(() => "tags LIKE ?").join(" OR ")})`);
      for (const tag of tags) bindings.push(`%,${tag},%`);
    }
    // The whole filtered wall's size, not the page's: counted before the
    // cursor narrows the query, so every page carries the same total.
    const total = Number(
      this.sql
        .exec<{ total: number }>(
          `SELECT COUNT(*) AS total FROM gallery_entries
           WHERE ${conditions.join(" AND ")}`,
          ...bindings,
        )
        .toArray()[0]!.total,
    );
    // The viewer id leads the bindings because its sub-select comes first.
    const viewerId = typeof body.viewerId === "string" ? body.viewerId : "";
    if (cursor) {
      conditions.push("(created_at || '|' || id) < ?");
      bindings.push(cursor);
    }
    const rows = this.sql
      .exec<EntrySummaryRow & { likes: number; liked_by_viewer: number }>(
        `SELECT e.id, e.name, e.author, e.description, e.created_at,
           e.schema_version, e.tags, e.netlistable, e.preview_revision,
           e.preview_width, e.preview_height,
           (SELECT COUNT(*) FROM gallery_likes WHERE entry_id = e.id) AS likes,
           (SELECT COUNT(*) FROM gallery_likes
             WHERE entry_id = e.id AND user_id = ?) AS liked_by_viewer
         FROM gallery_entries e WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        viewerId,
        ...bindings,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0
        ? `${page.at(-1)!.created_at}|${page.at(-1)!.id}`
        : null;
    return Response.json({ entries: page.map(summaryOf), nextCursor, total });
  }

  /** Minimum row needed to decide whether an immutable preview cache hit is valid. */
  private previewAccess(id: string): Response {
    const row = this.sql
      .exec<PreviewAccessRow>(
        `SELECT status, owner_user_id, preview_revision
         FROM gallery_entries WHERE id = ?`,
        id,
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      status: row.status,
      ownerUserId: row.owner_user_id,
      previewRevision: row.preview_revision || "legacy",
    });
  }

  /** Preview bytes without the unrelated canonical Project payload. */
  private preview(id: string): Response {
    const row = this.sql
      .exec<PreviewRow>(
        `SELECT status, owner_user_id, preview_revision, svg_text
         FROM gallery_entries WHERE id = ?`,
        id,
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      status: row.status,
      ownerUserId: row.owner_user_id,
      previewRevision: row.preview_revision || "legacy",
      svgText: row.svg_text,
    });
  }

  /**
   * One entry. `submitterEmail`/`submitterProvider` ride along for the
   * caller to gate: `routeGalleryRequest` only forwards them to a curator.
   */
  private entry(id: string, requiredStatus: string | null): Response {
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row || (requiredStatus !== null && row.status !== requiredStatus)) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return Response.json({
      entry: summaryOf(row),
      status: row.status,
      ownerUserId: row.owner_user_id,
      submitterEmail: row.submitter_email,
      submitterProvider: row.submitter_provider,
      rejectReason: row.reject_reason,
      projectText: row.project_text,
      svgText: row.svg_text,
    });
  }

  /** Owner/reviewer edit (phase G3): new content, possibly new status. */
  /** Version-history snapshot of the entry's current state (pre-write). */
  private snapshotEntry(row: EntryRow, at: string): void {
    const lastVersion =
      this.sql
        .exec<{ v: number | null }>(
          "SELECT MAX(version_no) AS v FROM gallery_entry_versions WHERE entry_id = ?",
          row.id,
        )
        .toArray()[0]?.v ?? 0;
    this.sql.exec(
      `INSERT INTO gallery_entry_versions(
        id, entry_id, version_no, name, author, description, tags,
        schema_version, project_text, svg_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      shortId(),
      row.id,
      lastVersion + 1,
      row.name,
      row.author,
      row.description,
      row.tags ?? "",
      row.schema_version,
      row.project_text,
      row.svg_text,
      at,
    );
    pruneGalleryEntryVersions(this.sql, row.id);
  }

  private replaceEntry(body: Record<string, unknown>): Response {
    const row = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.id),
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    const svgText = String(body.svgText);
    const previewRevision = sha256Hex(svgText);
    const previewDimensions = svgPreviewDimensions(svgText);
    this.state.storage.transactionSync(() => {
      this.snapshotEntry(row, String(body.at ?? row.created_at));
      this.sql.exec(
        `UPDATE gallery_entries
         SET name = ?, author = ?, description = ?, project_text = ?,
             svg_text = ?, schema_version = ?, status = ?, tags = ?,
             netlistable = ?, preview_revision = ?, preview_width = ?,
             preview_height = ?
         WHERE id = ?`,
        String(body.name),
        String(body.author),
        String(body.description),
        String(body.projectText),
        svgText,
        Number(body.schemaVersion),
        String(body.status),
        typeof body.tags === "string" ? body.tags : "",
        Number(body.netlistable) === 1 ? 1 : 0,
        previewRevision,
        previewDimensions?.width ?? null,
        previewDimensions?.height ?? null,
        row.id,
      );
    });
    return Response.json({
      id: row.id,
      status: String(body.status),
      previewRevision,
    });
  }

  private versions(entryId: string): Response {
    const rows = this.sql
      .exec<{
        id: string;
        version_no: number;
        name: string;
        author: string;
        tags: string | null;
        created_at: string;
      }>(
        `SELECT id, version_no, name, author, tags, created_at
         FROM gallery_entry_versions WHERE entry_id = ?
         ORDER BY version_no DESC`,
        entryId,
      )
      .toArray();
    return Response.json({
      versions: rows.map((row) => ({
        versionId: row.id,
        versionNo: row.version_no,
        name: row.name,
        author: row.author,
        tags: unwrapTags(row.tags),
        createdAt: row.created_at,
      })),
    });
  }

  private version(entryId: string, versionId: string): Response {
    const row = this.sql
      .exec<{
        id: string;
        name: string;
        author: string;
        description: string;
        tags: string | null;
        schema_version: number;
        project_text: string;
        svg_text: string;
      }>(
        `SELECT * FROM gallery_entry_versions
         WHERE entry_id = ? AND id = ?`,
        entryId,
        versionId,
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      name: row.name,
      author: row.author,
      description: row.description,
      tags: unwrapTags(row.tags),
      schemaVersion: row.schema_version,
      projectText: row.project_text,
      svgText: row.svg_text,
    });
  }

  /** Restore = snapshot the current state, then adopt the version. */
  private restoreVersion(body: Record<string, unknown>): Response {
    const entry = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.entryId),
      )
      .toArray()[0];
    const version = this.sql
      .exec<{
        name: string;
        author: string;
        description: string;
        tags: string | null;
        schema_version: number;
        project_text: string;
        svg_text: string;
      }>(
        "SELECT * FROM gallery_entry_versions WHERE entry_id = ? AND id = ?",
        String(body.entryId),
        String(body.versionId),
      )
      .toArray()[0];
    if (!entry || !version) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    let restoredProject: CircuitProject;
    try {
      restoredProject = parseProject(version.project_text);
    } catch (error) {
      return Response.json(
        {
          error: "invalid-version-project",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 409 },
      );
    }
    const restoredProjectText = serializeProject(restoredProject);
    const netlistable = analyzeDesignNetlist(restoredProject).ir ? 1 : 0;
    const previewRevision = sha256Hex(version.svg_text);
    const previewDimensions = svgPreviewDimensions(version.svg_text);
    this.state.storage.transactionSync(() => {
      this.snapshotEntry(entry, String(body.at));
      this.sql.exec(
        `UPDATE gallery_entries
         SET name = ?, author = ?, description = ?, project_text = ?,
             svg_text = ?, schema_version = ?, tags = ?, netlistable = ?,
             preview_revision = ?, preview_width = ?, preview_height = ?
         WHERE id = ?`,
        version.name,
        version.author,
        version.description,
        restoredProjectText,
        version.svg_text,
        restoredProject.schemaVersion,
        version.tags ?? "",
        netlistable,
        previewRevision,
        previewDimensions?.width ?? null,
        previewDimensions?.height ?? null,
        entry.id,
      );
    });
    return Response.json({ id: entry.id, restored: true, previewRevision });
  }

  private mine(ownerUserId: string): Response {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE owner_user_id = ?
         ORDER BY created_at DESC, id DESC`,
        ownerUserId,
      )
      .toArray();
    return Response.json({
      entries: rows.map((row) => ({
        ...summaryOf(row),
        status: row.status,
        rejectReason: row.reject_reason,
        // When it was withdrawn. Not a deadline: nothing expires by time.
        recycledAt: row.recycled_at,
      })),
    });
  }

  private cloudProjectCreate(body: Record<string, unknown>): Response {
    const userId = String(body.userId);
    const id = String(body.id);
    const count = this.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM cloud_projects WHERE user_id = ?",
        userId,
      )
      .one().count;
    if (count >= CLOUD_PROJECT_LIMIT) {
      return Response.json(
        { error: "project-limit", projects: this.cloudProjectRows(userId) },
        { status: 409 },
      );
    }
    this.sql.exec(
      `INSERT INTO cloud_projects
         (id, user_id, name, created_at, updated_at, revision,
          schema_version, project_text, preview_svg)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      userId,
      String(body.name),
      String(body.updatedAt),
      String(body.updatedAt),
      Number(body.schemaVersion),
      String(body.projectText),
      String(body.previewSvg ?? ""),
    );
    return Response.json(
      { project: this.cloudProjectOpenPayload(userId, id) },
      { status: 201 },
    );
  }

  private cloudProjectUpdate(body: Record<string, unknown>): Response {
    const userId = String(body.userId);
    const id = String(body.id);
    const expectedRevision = Number(body.expectedRevision);
    const current = this.sql
      .exec<CloudProjectRow & { project_text: string }>(
        `SELECT id, name, updated_at, revision, schema_version, project_text
         FROM cloud_projects WHERE id = ? AND user_id = ?`,
        id,
        userId,
      )
      .toArray()[0];
    if (!current) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    // A retried PUT whose acknowledgement was lost is already complete. This
    // gives Save idempotency without persisting browser Session records.
    if (
      current.name === String(body.name) &&
      current.schema_version === Number(body.schemaVersion) &&
      current.project_text === String(body.projectText)
    ) {
      return Response.json({
        project: this.cloudProjectOpenPayload(userId, id),
      });
    }
    if (current.revision !== expectedRevision) {
      return Response.json(
        {
          error: "revision-conflict",
          project: this.cloudProjectSummary(current),
        },
        { status: 409 },
      );
    }
    const nextRevision = current.revision + 1;
    this.sql.exec(
      `UPDATE cloud_projects
       SET name = ?, updated_at = ?, revision = ?, schema_version = ?,
           project_text = ?, preview_svg = ?
       WHERE id = ? AND user_id = ? AND revision = ?`,
      String(body.name),
      String(body.updatedAt),
      nextRevision,
      Number(body.schemaVersion),
      String(body.projectText),
      String(body.previewSvg ?? ""),
      id,
      userId,
      expectedRevision,
    );
    return Response.json({ project: this.cloudProjectOpenPayload(userId, id) });
  }

  private cloudProjectSummary(row: CloudProjectRow): CloudProjectSummary {
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      revision: row.revision,
      schemaVersion: row.schema_version,
    };
  }

  private cloudProjectRows(userId: string): CloudProjectSummary[] {
    return this.sql
      .exec<CloudProjectRow>(
        `SELECT id, name, updated_at, revision, schema_version
         FROM cloud_projects
         WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
        userId,
        CLOUD_PROJECT_LIMIT,
      )
      .toArray()
      .map((row) => this.cloudProjectSummary(row));
  }

  private cloudProjectList(userId: string): Response {
    return Response.json({ projects: this.cloudProjectRows(userId) });
  }

  /**
   * One shelf thumbnail. Scoped by account like every other Cloud Project
   * read: a Project id is never a capability. An empty string means the row
   * predates stored previews, and the shelf draws a placeholder instead.
   */
  private cloudProjectPreview(userId: string, id: string): Response {
    const row = this.sql
      .exec<{ preview_svg: string; revision: number }>(
        `SELECT preview_svg, revision
         FROM cloud_projects WHERE id = ? AND user_id = ?`,
        id,
        userId,
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      previewSvg: row.preview_svg,
      revision: row.revision,
    });
  }

  /**
   * Lazy backfill for shelves saved before previews existed: store the
   * rendered thumbnail only while the row still has none at the same
   * revision, so a save racing this write always wins.
   */
  private cloudProjectPreviewStore(
    userId: string,
    id: string,
    revision: number,
    previewSvg: string,
  ): Response {
    if (!previewSvg || !Number.isInteger(revision)) {
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    }
    this.sql.exec(
      `UPDATE cloud_projects SET preview_svg = ?
        WHERE user_id = ? AND id = ? AND revision = ? AND preview_svg = ''`,
      previewSvg,
      userId,
      id,
      revision,
    );
    return Response.json({ ok: true });
  }

  private cloudProjectOpenPayload(userId: string, id: string) {
    const row = this.sql
      .exec<CloudProjectRow & { project_text: string }>(
        "SELECT * FROM cloud_projects WHERE id = ? AND user_id = ?",
        id,
        userId,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      revision: row.revision,
      schemaVersion: row.schema_version,
      projectText: row.project_text,
    };
  }

  private cloudProjectOpen(userId: string, id: string): Response {
    // Scoped by account as well as id: a Project id is never a capability.
    const project = this.cloudProjectOpenPayload(userId, id);
    if (!project) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ project });
  }

  private cloudProjectDelete(userId: string, id: string): Response {
    const existing = this.cloudProjectOpenPayload(userId, id);
    if (!existing)
      return Response.json({ error: "not-found" }, { status: 404 });
    this.sql.exec(
      "DELETE FROM cloud_projects WHERE id = ? AND user_id = ?",
      id,
      userId,
    );
    return Response.json({
      deleted: id,
      projects: this.cloudProjectRows(userId),
    });
  }

  /** Full-fidelity administrator backup before an online schema migration. */
  private schemaBackup(): Response {
    return Response.json({
      format: "analog-canvas-gallery-schema-backup-v1",
      exportedAt: new Date().toISOString(),
      targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      tables: {
        galleryEntries: this.sql
          .exec<Record<string, unknown>>("SELECT * FROM gallery_entries")
          .toArray(),
        galleryEntryVersions: this.sql
          .exec<Record<string, unknown>>("SELECT * FROM gallery_entry_versions")
          .toArray(),
        cloudProjects: this.sql
          .exec<Record<string, unknown>>("SELECT * FROM cloud_projects")
          .toArray(),
      },
    });
  }

  /** Restore the Project-bearing tables while enforcing current retention. */
  private schemaRestore(rawBackup: unknown): Response {
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
    if (!galleryEntries || !galleryEntryVersions || !cloudProjects) {
      return Response.json(
        { restored: false, error: "invalid-backup-tables" },
        { status: 400 },
      );
    }
    const retainedVersionCount = this.state.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM gallery_entries");
      this.sql.exec("DELETE FROM gallery_entry_versions");
      this.sql.exec("DELETE FROM cloud_projects");
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
        this.sql.exec(
          `INSERT INTO gallery_entries
           (id, name, author, description, created_at, schema_version, status,
            recycled_at, owner_user_id, submitter_email, submitter_provider,
            project_text, svg_text, reject_reason, reviewed_at, reviewed_by,
            tags, netlistable, preview_revision, preview_width, preview_height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ...values,
          sha256Hex(svgText),
          previewDimensions?.width ?? null,
          previewDimensions?.height ?? null,
        );
      }
      for (const row of galleryEntryVersions) {
        this.sql.exec(
          `INSERT INTO gallery_entry_versions
           (id, entry_id, version_no, name, author, description, tags,
            schema_version, project_text, svg_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
      }
      deleteOrphanGalleryData(this.sql);
      pruneGalleryEntryVersions(this.sql);
      for (const row of cloudProjects) {
        this.sql.exec(
          `INSERT INTO cloud_projects
           (id, user_id, name, created_at, updated_at, revision,
            schema_version, project_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
      }
      return this.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM gallery_entry_versions",
        )
        .one().count;
    });
    return Response.json({
      restored: true,
      records:
        galleryEntries.length + retainedVersionCount + cloudProjects.length,
      tables: {
        galleryEntries: galleryEntries.length,
        galleryEntryVersions: retainedVersionCount,
        cloudProjects: cloudProjects.length,
      },
    });
  }

  /**
   * Validate every persisted Project before writing any of them. The apply
   * phase is one Durable Object transaction, so a failed record cannot leave
   * the three storage surfaces at mixed schema versions.
   */
  private schemaConverge(apply: boolean): Response {
    const sources = [
      {
        table: "gallery_entries",
        rows: this.sql
          .exec<StoredProjectRow>(
            "SELECT id, schema_version, project_text FROM gallery_entries",
          )
          .toArray(),
      },
      {
        table: "gallery_entry_versions",
        rows: this.sql
          .exec<StoredProjectRow>(
            "SELECT id, schema_version, project_text FROM gallery_entry_versions",
          )
          .toArray(),
      },
      {
        table: "cloud_projects",
        rows: this.sql
          .exec<StoredProjectRow>(
            "SELECT id, schema_version, project_text FROM cloud_projects",
          )
          .toArray(),
      },
    ] as const;
    const inventory: Record<string, Record<string, number>> = {};
    const updates: Array<{
      table: (typeof sources)[number]["table"];
      id: string;
      projectText: string;
    }> = [];
    const failures: Array<{
      table: string;
      id: string;
      storedSchemaVersion: number;
      message: string;
    }> = [];
    const migrationReports: Array<{
      table: string;
      id: string;
      report:
        | ReturnType<typeof upgradeSchema28To29WithReport>["report"]
        | ReturnType<typeof upgradeSchema29To30WithReport>["report"]
        | ReturnType<typeof upgradeSchema30To31WithReport>["report"]
        | ReturnType<typeof upgradeSchema31To32WithReport>["report"]
        | ReturnType<typeof upgradeSchema32To33WithReport>["report"]
        | ReturnType<typeof upgradeSchema33To34WithReport>["report"]
        | ReturnType<typeof upgradeSchema34To35WithReport>["report"]
        | ReturnType<typeof upgradeSchema35To36WithReport>["report"]
        | ReturnType<typeof upgradeSchema36To37WithReport>["report"];
    }> = [];
    for (const source of sources) {
      const versions: Record<string, number> = {};
      inventory[source.table] = versions;
      for (const row of source.rows) {
        const versionKey = String(row.schema_version);
        versions[versionKey] = (versions[versionKey] ?? 0) + 1;
        try {
          const raw = JSON.parse(row.project_text) as Record<string, unknown>;
          // Rows can lag more than one version between converge runs; chain
          // every retained adapter link by link before crossing the rolling
          // project-file boundary.
          let lifted = raw;
          if (lifted.schemaVersion === 24) {
            lifted = upgradeSchema24To25(lifted);
          }
          if (lifted.schemaVersion === 25) {
            lifted = upgradeSchema25To26(lifted);
          }
          if (lifted.schemaVersion === 26) {
            lifted = upgradeSchema26To27(lifted);
          }
          if (lifted.schemaVersion === 27) {
            lifted = upgradeSchema27To28(lifted);
          }
          if (lifted.schemaVersion === 28) {
            const migration = upgradeSchema28To29WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 29) {
            const migration = upgradeSchema29To30WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 30) {
            const migration = upgradeSchema30To31WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 31) {
            const migration = upgradeSchema31To32WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 32) {
            const migration = upgradeSchema32To33WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 33) {
            const migration = upgradeSchema33To34WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 34) {
            const migration = upgradeSchema34To35WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 35) {
            const migration = upgradeSchema35To36WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          if (lifted.schemaVersion === 36) {
            const migration = upgradeSchema36To37WithReport(lifted);
            lifted = migration.project;
            migrationReports.push({
              table: source.table,
              id: row.id,
              report: migration.report,
            });
          }
          const project = parseProject(JSON.stringify(lifted));
          updates.push({
            table: source.table,
            id: row.id,
            projectText: serializeProject(project),
          });
        } catch (error) {
          failures.push({
            table: source.table,
            id: row.id,
            storedSchemaVersion: row.schema_version,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (apply && failures.length > 0) {
      return Response.json(
        {
          applied: false,
          targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
          inventory,
          failures,
        },
        { status: 409 },
      );
    }
    if (apply) {
      this.state.storage.transactionSync(() => {
        for (const update of updates) {
          this.sql.exec(
            `UPDATE ${update.table}
             SET project_text = ?, schema_version = ? WHERE id = ?`,
            update.projectText,
            CURRENT_PROJECT_SCHEMA_VERSION,
            update.id,
          );
        }
      });
    }
    return Response.json({
      applied: apply,
      targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      inventory,
      records: updates.length + failures.length,
      ready: updates.length,
      failures,
      migrationReports,
    });
  }

  private setStatus(id: string, status: string, at: string): Response {
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (status === "public") {
      this.sql.exec(
        `UPDATE gallery_entries
         SET status = 'public', recycled_at = NULL, reject_reason = NULL,
             reviewed_at = NULL, reviewed_by = NULL
         WHERE id = ?`,
        id,
      );
    } else {
      this.state.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE gallery_entries SET status = ?, recycled_at = ? WHERE id = ?",
          status,
          status === "recycled" ? at : null,
          id,
        );
        if (status === "recycled") {
          this.sweepRecycledRows(row.owner_user_id ?? "");
        }
      });
    }
    return Response.json({ id, status });
  }

  private reject(body: Record<string, unknown>): Response {
    const id = String(body.id);
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (row.status !== "public") {
      return Response.json({ error: "not-public" }, { status: 409 });
    }
    this.sql.exec(
      `UPDATE gallery_entries
       SET status = 'rejected', recycled_at = NULL, reject_reason = ?,
           reviewed_at = ?, reviewed_by = ?
       WHERE id = ?`,
      String(body.reason),
      String(body.at),
      String(body.reviewerId),
      id,
    );
    return Response.json({ id, status: "rejected" });
  }

  /**
   * Remove an entry and everything hanging off it.
   *
   * A curator deletes out of the recycle bin, so the two-step stands for
   * them. An author deleting their own work has already decided, and asking
   * them to withdraw first would only be ceremony, so that path passes
   * `requireRecycled: false`.
   */
  private delete(id: string, requireRecycled: boolean): Response {
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (requireRecycled && row.status !== "recycled") {
      return Response.json({ error: "not-recycled" }, { status: 409 });
    }
    this.state.storage.transactionSync(() => {
      this.hardDeleteEntryRows(id);
    });
    return Response.json({ id, deleted: true });
  }

  /** Remove one entry and everything hanging off it. Callers own the transaction. */
  private hardDeleteEntryRows(id: string): void {
    this.sql.exec("DELETE FROM gallery_entry_versions WHERE entry_id = ?", id);
    this.sql.exec("DELETE FROM gallery_likes WHERE entry_id = ?", id);
    this.sql.exec("DELETE FROM gallery_entries WHERE id = ?", id);
  }

  /**
   * Lazy retention sweep, run inside the submission and recycle write
   * transactions — no alarms, no scheduled work. Keeps the newest
   * {@link GALLERY_RECYCLED_KEEP_PER_ACCOUNT} recycled rows for the writing
   * account; anonymous/legacy rows share one unowned bucket and are exempt
   * from the cap. The cap is the whole policy — nothing expires by time.
   */
  private sweepRecycledRows(ownerUserId: string): void {
    if (ownerUserId === "") return;
    const overflow = this.sql
      .exec<{ id: string }>(
        `SELECT id FROM gallery_entries
         WHERE status = 'recycled' AND owner_user_id = ?
         ORDER BY recycled_at DESC, id DESC
         LIMIT -1 OFFSET ?`,
        ownerUserId,
        GALLERY_RECYCLED_KEEP_PER_ACCOUNT,
      )
      .toArray();
    for (const row of overflow) this.hardDeleteEntryRows(row.id);
  }

  private recycled(): Response {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE status = 'recycled'
         ORDER BY recycled_at DESC, id DESC`,
      )
      .toArray();
    return Response.json({
      entries: rows.map((row) => ({
        ...summaryOf(row),
        recycledAt: row.recycled_at,
      })),
    });
  }

  private rejected(): Response {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE status = 'rejected'
         ORDER BY reviewed_at DESC, created_at DESC, id DESC`,
      )
      .toArray();
    return Response.json({
      entries: rows.map((row) => ({
        ...summaryOf(row),
        rejectReason: row.reject_reason,
        reviewedAt: row.reviewed_at,
      })),
    });
  }

  /** Distinct public tags with counts, most frequent first (G4 menu). */
  private tagCounts(): Response {
    const rows = this.sql
      .exec<{ tags: string | null }>(
        "SELECT tags FROM gallery_entries WHERE status = 'public'",
      )
      .toArray();
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of unwrapTags(row.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
      .map(([tag, count]) => ({ tag, count }));
    return Response.json({ tags });
  }

  private allIds(): Response {
    const rows = this.sql
      .exec<{ id: string }>("SELECT id FROM gallery_entries ORDER BY id")
      .toArray();
    return Response.json({ ids: rows.map((row) => row.id) });
  }

  private updateEntry(body: Record<string, unknown>): Response {
    const row = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.id),
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    const svgText = String(body.svgText);
    const previewRevision = sha256Hex(svgText);
    const previewDimensions = svgPreviewDimensions(svgText);
    this.sql.exec(
      `UPDATE gallery_entries
       SET project_text = ?, schema_version = ?, svg_text = ?,
           preview_revision = ?, preview_width = ?, preview_height = ?
       WHERE id = ?`,
      String(body.projectText),
      Number(body.schemaVersion),
      svgText,
      previewRevision,
      previewDimensions?.width ?? null,
      previewDimensions?.height ?? null,
      String(body.id),
    );
    return Response.json({ id: row.id, previewRevision });
  }
}
