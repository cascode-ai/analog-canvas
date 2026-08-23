// Community example gallery: publish-first with an admin recycle bin.
//
// Trust boundary: the only accepted input is Project JSON that passes the
// strict protocol boundary (`parseProject`, rolling-window upgrade applied).
// Everything served back — canonical Project text and the preview SVG — is
// derived server-side from that validated model; no client-supplied markup
// is ever stored or echoed. Signing in is the whole publishing gate: any
// signed-in account publishes straight to the wall, and every entry records
// the submitting account's email and provider so it stays traceable. An
// admin session can recycle (soft, restorable),
// hard-delete from the bin only, and batch re-serialize every entry to keep
// long-lived records inside the rolling schema window. Previews are stored
// independently so browsing survives an entry the current window can no
// longer open.

import { evaluateSubmissionGates } from "@icm/derived";
import { analyzeDesignNetlist } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";

import { sessionUserOf, type AuthNamespaceLike } from "./auth";

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
/** How many circuits an account's scratch shelf keeps. */
export const WORKSPACE_SLOT_LIMIT = 3;

export interface WorkspaceSlotSummary {
  id: string;
  name: string;
  savedAt: string;
  schemaVersion: number;
}

interface WorkspaceSlotRow {
  id: string;
  name: string;
  saved_at: string;
  schema_version: number;
}
export const GALLERY_MAX_NAME_LENGTH = 120;
export const GALLERY_MAX_AUTHOR_LENGTH = 40;
export const GALLERY_MAX_DESCRIPTION_LENGTH = 300;
export const GALLERY_DAILY_SUBMISSION_LIMIT = 10;
export const GALLERY_MAX_TAGS = 5;
export const GALLERY_MAX_TAG_LENGTH = 24;
export const GALLERY_MAX_VERSIONS_PER_ENTRY = 20;
export const GALLERY_DEFAULT_LIST_LIMIT = 30;
export const GALLERY_MAX_LIST_LIMIT = 60;

type SqlResult<T> = {
  toArray(): T[];
  one(): T;
};

type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};

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
};

export interface GalleryEntrySummary {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
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
function wrapTags(tags: string[]): string {
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
}

const resolver = new InMemorySymbolResolver(builtInSymbols);

function summaryOf(
  row: EntryRow & { likes?: number; liked_by_viewer?: number },
): GalleryEntrySummary {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    createdAt: row.created_at,
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
        svg_text TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS gallery_submissions (
        day TEXT NOT NULL,
        submitter_hash TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, submitter_hash)
      ) WITHOUT ROWID
    `);
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
    // A signed-in account's own scratch shelf: the last few circuits it
    // checked, kept so work survives a closed tab or a different machine.
    // Not the Gallery — nothing here is published or visible to anyone else.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS workspace_slots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0,
        schema_version INTEGER NOT NULL,
        project_text TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_workspace_slots_user
      ON workspace_slots(user_id, seq)
    `);
    // Additive columns for pre-existing databases.
    for (const alteration of [
      "ALTER TABLE gallery_entries ADD COLUMN reject_reason TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_by TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_email TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN submitter_provider TEXT",
      "ALTER TABLE workspace_slots ADD COLUMN seq INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE gallery_entries ADD COLUMN netlistable INTEGER NOT NULL DEFAULT 0",
    ]) {
      try {
        this.sql.exec(alteration);
      } catch {
        // Column already present.
      }
    }
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
      case "set-status":
        return this.setStatus(
          String(body.id),
          String(body.status),
          String(body.at),
        );
      case "delete":
        return this.delete(String(body.id));
      case "recycled":
        return this.recycled();
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
      case "workspace-save":
        return this.workspaceSave(body);
      case "workspace-list":
        return this.workspaceList(String(body.userId));
      case "workspace-open":
        return this.workspaceOpen(String(body.userId), String(body.id));
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
    const day = String(body.day);
    const submitterHash = String(body.submitterHash);
    // The daily quota is anti-garbage protection for ordinary submitters;
    // admin and moderator sessions are exempt (they curate).
    const enforceLimit = body.enforceLimit !== false;
    const outcome = this.state.storage.transactionSync(() => {
      if (enforceLimit) {
        const used =
          this.sql
            .exec<{
              count: number;
            }>(
              "SELECT count FROM gallery_submissions WHERE day = ? AND submitter_hash = ?",
              day,
              submitterHash,
            )
            .toArray()[0]?.count ?? 0;
        if (used >= GALLERY_DAILY_SUBMISSION_LIMIT) {
          return { status: "rate-limited" as const };
        }
        this.sql.exec(
          `INSERT INTO gallery_submissions(day, submitter_hash, count) VALUES (?, ?, 1)
           ON CONFLICT(day, submitter_hash) DO UPDATE SET count = count + 1`,
          day,
          submitterHash,
        );
      }
      entry.id = this.freeEntryId();
      this.sql.exec(
        `INSERT INTO gallery_entries(
          id, name, author, description, created_at, schema_version,
          status, recycled_at, owner_user_id, submitter_email,
          submitter_provider, tags, project_text, svg_text, netlistable
        ) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
      return { status: "stored" as const };
    });
    if (outcome.status === "rate-limited") {
      return Response.json({ error: "rate-limited" }, { status: 429 });
    }
    return Response.json({ id: entry.id });
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
    if (cursor) {
      conditions.push("(created_at || '|' || id) < ?");
      bindings.push(cursor);
    }
    // The viewer id leads the bindings because its sub-select comes first.
    const viewerId = typeof body.viewerId === "string" ? body.viewerId : "";
    const rows = this.sql
      .exec<EntryRow & { likes: number; liked_by_viewer: number }>(
        `SELECT e.*,
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
    return Response.json({ entries: page.map(summaryOf), nextCursor });
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
    this.sql.exec(
      `DELETE FROM gallery_entry_versions
       WHERE entry_id = ? AND version_no <= ?`,
      row.id,
      lastVersion + 1 - GALLERY_MAX_VERSIONS_PER_ENTRY,
    );
  }

  private replaceEntry(body: Record<string, unknown>): Response {
    const row = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.id),
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    this.state.storage.transactionSync(() => {
      this.snapshotEntry(row, String(body.at ?? row.created_at));
      this.sql.exec(
        `UPDATE gallery_entries
         SET name = ?, author = ?, description = ?, project_text = ?,
             svg_text = ?, schema_version = ?, status = ?, tags = ?,
             reject_reason = NULL, reviewed_at = NULL, reviewed_by = NULL
         WHERE id = ?`,
        String(body.name),
        String(body.author),
        String(body.description),
        String(body.projectText),
        String(body.svgText),
        Number(body.schemaVersion),
        String(body.status),
        typeof body.tags === "string" ? body.tags : "",
        row.id,
      );
    });
    return Response.json({ id: row.id, status: String(body.status) });
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
    this.state.storage.transactionSync(() => {
      this.snapshotEntry(entry, String(body.at));
      this.sql.exec(
        `UPDATE gallery_entries
         SET name = ?, author = ?, description = ?, project_text = ?,
             svg_text = ?, schema_version = ?, tags = ?
         WHERE id = ?`,
        version.name,
        version.author,
        version.description,
        version.project_text,
        version.svg_text,
        version.schema_version,
        version.tags ?? "",
        entry.id,
      );
    });
    return Response.json({ id: entry.id, restored: true });
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
      })),
    });
  }

  /**
   * Keep the newest few slots per account and drop the rest. A shelf that
   * grew without bound would be storage, and this is deliberately not that:
   * the Project file stays canonical and the Gallery stays the place work is
   * published.
   */
  private workspaceSave(body: Record<string, unknown>): Response {
    const userId = String(body.userId);
    const id = String(body.id);
    // Order the shelf by an insertion counter rather than by the clock: two
    // saves in the same millisecond would otherwise fall back to comparing
    // ids, which is to say to no order at all.
    this.sql.exec(
      `INSERT INTO workspace_slots
         (id, user_id, name, saved_at, seq, schema_version, project_text)
       VALUES (
         ?, ?, ?, ?,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM workspace_slots),
         ?, ?
       )`,
      id,
      userId,
      String(body.name),
      String(body.savedAt),
      Number(body.schemaVersion),
      String(body.projectText),
    );
    this.sql.exec(
      `DELETE FROM workspace_slots
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM workspace_slots WHERE user_id = ?
           ORDER BY seq DESC LIMIT ?
         )`,
      userId,
      userId,
      WORKSPACE_SLOT_LIMIT,
    );
    return Response.json({ id, slots: this.workspaceRows(userId) });
  }

  private workspaceRows(userId: string): WorkspaceSlotSummary[] {
    return this.sql
      .exec<WorkspaceSlotRow>(
        `SELECT id, name, saved_at, schema_version FROM workspace_slots
         WHERE user_id = ? ORDER BY seq DESC LIMIT ?`,
        userId,
        WORKSPACE_SLOT_LIMIT,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        savedAt: row.saved_at,
        schemaVersion: row.schema_version,
      }));
  }

  private workspaceList(userId: string): Response {
    return Response.json({ slots: this.workspaceRows(userId) });
  }

  private workspaceOpen(userId: string, id: string): Response {
    // Scoped by account as well as id: a slot id is never a capability.
    const row = this.sql
      .exec<WorkspaceSlotRow & { project_text: string }>(
        "SELECT * FROM workspace_slots WHERE id = ? AND user_id = ?",
        id,
        userId,
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({
      id: row.id,
      name: row.name,
      savedAt: row.saved_at,
      schemaVersion: row.schema_version,
      projectText: row.project_text,
    });
  }

  private setStatus(id: string, status: string, at: string): Response {
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    this.sql.exec(
      "UPDATE gallery_entries SET status = ?, recycled_at = ? WHERE id = ?",
      status,
      status === "recycled" ? at : null,
      id,
    );
    return Response.json({ id, status });
  }

  private delete(id: string): Response {
    const row = this.sql
      .exec<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (row.status !== "recycled") {
      return Response.json({ error: "not-recycled" }, { status: 409 });
    }
    this.sql.exec("DELETE FROM gallery_entries WHERE id = ?", id);
    return Response.json({ id, deleted: true });
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
    this.sql.exec(
      "UPDATE gallery_entries SET project_text = ?, schema_version = ?, svg_text = ? WHERE id = ?",
      String(body.projectText),
      Number(body.schemaVersion),
      String(body.svgText),
      String(body.id),
    );
    return Response.json({ id: row.id });
  }
}

function galleryStub(env: GalleryEnv) {
  return env.GALLERY.getByName("gallery");
}

async function callGallery<T>(
  env: GalleryEnv,
  operation: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const response = await galleryStub(env).fetch(
    `https://gallery/${operation}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, payload: (await response.json()) as T };
}

function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== expected) return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }
  return true;
}

async function isAdmin(request: Request, env: GalleryEnv): Promise<boolean> {
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true;
}

/** Curation authority: an admin or an appointed moderator. */
async function canReview(request: Request, env: GalleryEnv): Promise<boolean> {
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true || user?.role === "moderator";
}

/**
 * Who may manage one entry's lifecycle surfaces (withdrawal, version
 * history): a reviewer, or the signed-in owner of that entry.
 */
async function entryManager(
  request: Request,
  env: GalleryEnv,
  id: string,
): Promise<{ found: boolean; reviewer: boolean; owner: boolean }> {
  const existing = await callGallery<{ ownerUserId?: string | null }>(
    env,
    "any-entry",
    { id },
  );
  if (existing.status !== 200) {
    return { found: false, reviewer: false, owner: false };
  }
  const reviewer = await canReview(request, env);
  const user = await sessionUserOf(request, env);
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  return { found: true, reviewer, owner };
}

async function submitterHash(request: Request): Promise<string> {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For") ??
    "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`gallery:${ip}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fieldText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

function renderPreview(project: CircuitProject): string {
  const topDocument = project.documents.find(
    (document) => document.id === project.topDocumentId,
  )!;
  return renderDocumentSvg(topDocument, resolver);
}

/**
 * An account's own scratch shelf. Unlike a submission this is never seen by
 * anyone else, is not gated on quality, and holds only the newest few — it
 * exists so a check does not leave work living solely in one browser tab.
 */
async function handleWorkspace(
  request: Request,
  env: GalleryEnv,
  slotId: string | null,
): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const user = await sessionUserOf(request, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const { status, payload } = slotId
      ? await callGallery(env, "workspace-open", {
          userId: user.id,
          id: slotId,
        })
      : await callGallery(env, "workspace-list", { userId: user.id });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  if (!body || !name || typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  if (
    new TextEncoder().encode(body.projectText).length >
    GALLERY_MAX_PROJECT_BYTES
  ) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  const { status, payload } = await callGallery(env, "workspace-save", {
    userId: user.id,
    id: shortId(),
    name,
    savedAt: new Date().toISOString(),
    schemaVersion: project.schemaVersion,
    projectText: body.projectText,
  });
  return Response.json(payload, { status });
}

async function handleSubmission(
  request: Request,
  env: GalleryEnv,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // Signing in is the whole gate: every signed-in user publishes straight to
  // the wall. Anonymous upload stays impossible, because an entry has to be
  // attributable to the account that submitted it.
  const user = await sessionUserOf(request, env);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const privileged = user.isAdmin === true || user.role === "moderator";
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  // The byline is the signed-in account's display name. Reading it from the
  // request would let one account publish under another's name.
  const author = user.displayName.slice(0, GALLERY_MAX_AUTHOR_LENGTH);
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  if (!body || !name || description === null) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  if (typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (
    new TextEncoder().encode(body.projectText).length >
    GALLERY_MAX_PROJECT_BYTES
  ) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (!privileged) {
    const report = evaluateSubmissionGates(project, resolver);
    if (!report.ok) {
      return Response.json(
        { error: "quality-gate", failures: report.failures },
        { status: 422 },
      );
    }
  }
  project.name = name;
  const now = new Date();
  const { status, payload } = await callGallery<{ id?: string }>(
    env,
    "submit",
    {
      day: now.toISOString().slice(0, 10),
      submitterHash: await submitterHash(request),
      enforceLimit: !privileged,
      entry: {
        // The id is drawn inside the Durable Object, which is the only place
        // that can tell whether one is already taken.
        id: "",
        // Recorded, never enforced: a circuit that does not extract is
        // published exactly the same way, it simply does not wear the star.
        netlistable: analyzeDesignNetlist(project).ir ? 1 : 0,
        name,
        author,
        description,
        created_at: now.toISOString(),
        schema_version: project.schemaVersion,
        owner_user_id: user.id,
        // Recorded per submission, so an entry stays traceable to the
        // identity that published it even if the account later changes.
        submitter_email: user.email,
        submitter_provider: user.provider,
        tags: wrapTags(sanitizeGalleryTags(body.tags)),
        project_text: serializeProject(project),
        svg_text: renderPreview(project),
      },
    },
  );
  if (status === 429) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }
  return Response.json({ id: payload.id, status: "public" }, { status: 201 });
}

/**
 * Owner or curator entry update. A moderator may update any entry; an
 * ordinary session must own the entry and passes the quality gates. Either
 * way the entry keeps its byline and its current status, so editing a
 * published circuit neither takes it off the wall nor re-attributes it.
 */
async function handleEntryUpdate(
  request: Request,
  env: GalleryEnv,
  id: string,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const existing = await callGallery<{
    status?: string;
    entry?: { author?: string };
    ownerUserId?: string | null;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const user = await sessionUserOf(request, env);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const privileged = user.isAdmin === true || user.role === "moderator";
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  if (!privileged && !owner) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  // An update never re-attributes the entry, not even when a moderator
  // makes it: the byline stays the one the submitter published under.
  const author = existing.payload.entry?.author ?? "";
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  if (!body || !name || description === null) {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  if (typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (
    new TextEncoder().encode(body.projectText).length >
    GALLERY_MAX_PROJECT_BYTES
  ) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return Response.json({ error: "invalid-project" }, { status: 400 });
  }
  if (!privileged) {
    const report = evaluateSubmissionGates(project, resolver);
    if (!report.ok) {
      return Response.json(
        { error: "quality-gate", failures: report.failures },
        { status: 422 },
      );
    }
  }
  project.name = name;
  const nextStatus = existing.payload.status ?? "public";
  const { status, payload } = await callGallery(env, "replace-entry", {
    id,
    at: new Date().toISOString(),
    name,
    author,
    description,
    projectText: serializeProject(project),
    svgText: renderPreview(project),
    schemaVersion: project.schemaVersion,
    status: nextStatus,
    tags: wrapTags(sanitizeGalleryTags(body.tags)),
  });
  return Response.json(payload, { status });
}

async function handleReserialize(env: GalleryEnv): Promise<Response> {
  const { payload } = await callGallery<{ ids: string[] }>(env, "all-ids", {});
  let upgraded = 0;
  const failed: { id: string; message: string }[] = [];
  for (const id of payload.ids) {
    const detail = await callGallery<{ projectText?: string }>(
      env,
      "any-entry",
      { id },
    );
    if (!detail.payload.projectText) continue;
    try {
      const project = parseProject(detail.payload.projectText);
      await callGallery(env, "update-entry", {
        id,
        projectText: serializeProject(project),
        schemaVersion: project.schemaVersion,
        svgText: renderPreview(project),
      });
      upgraded += 1;
    } catch (error) {
      failed.push({
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Response.json({ upgraded, failed });
}

/**
 * All `/api/gallery*` routing. Returns null for unrelated paths so the
 * worker entry keeps its ordinary dispatch.
 */
export async function routeGalleryRequest(
  request: Request,
  env: GalleryEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/workspace/recent") {
    if (request.method === "GET" || request.method === "POST") {
      return handleWorkspace(request, env, null);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname.startsWith("/api/workspace/recent/")) {
    const slotId = url.pathname.slice("/api/workspace/recent/".length);
    if (request.method === "GET" && slotId.length > 0) {
      return handleWorkspace(request, env, slotId);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!url.pathname.startsWith("/api/gallery")) return null;
  const segments = url.pathname.split("/").filter(Boolean).slice(2);

  if (
    segments.length === 2 &&
    segments[1] === "like" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const user = await sessionUserOf(request, env);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { status, payload } = await callGallery(env, "toggle-like", {
      id: segments[0],
      userId: user.id,
      at: new Date().toISOString(),
    });
    return Response.json(payload, { status });
  }

  if (segments.length === 0 && request.method === "GET") {
    // Signed in, the feed says which circuits this account has already
    // thumbed; signed out it simply carries the counts.
    const viewer = await sessionUserOf(request, env);
    const { payload } = await callGallery(env, "list", {
      viewerId: viewer?.id ?? "",
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      author: url.searchParams.get("author"),
      tags: (url.searchParams.get("tags") ?? "")
        .split(",")
        .filter((tag) => tag.length > 0),
    });
    return Response.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 1 &&
    segments[0] === "submissions" &&
    request.method === "POST"
  ) {
    return handleSubmission(request, env);
  }
  if (
    segments.length === 1 &&
    segments[0] === "recycled" &&
    request.method === "GET"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { payload } = await callGallery(env, "recycled", {});
    return Response.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "reserialize" &&
    request.method === "POST"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return handleReserialize(env);
  }
  if (
    segments.length === 1 &&
    segments[0] === "tags" &&
    request.method === "GET"
  ) {
    const { payload } = await callGallery(env, "tags", {});
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (
    segments.length === 1 &&
    segments[0] === "mine" &&
    request.method === "GET"
  ) {
    const user = await sessionUserOf(request, env);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { payload } = await callGallery(env, "mine", {
      ownerUserId: user.id,
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (
    segments.length === 2 &&
    segments[1] === "versions" &&
    request.method === "GET"
  ) {
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!access.reviewer && !access.owner) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "versions", {
      entryId: segments[0],
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 4 &&
    segments[1] === "versions" &&
    segments[3] === "preview.svg" &&
    request.method === "GET"
  ) {
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found || (!access.reviewer && !access.owner)) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const { status, payload } = await callGallery<{ svgText?: string }>(
      env,
      "version",
      { entryId: segments[0], versionId: segments[2] },
    );
    if (status !== 200 || !payload.svgText) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return new Response(payload.svgText, {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }
  if (
    segments.length === 4 &&
    segments[1] === "versions" &&
    segments[3] === "restore" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!access.reviewer && !access.owner) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "restore-version", {
      entryId: segments[0],
      versionId: segments[2],
      at: new Date().toISOString(),
    });
    return Response.json(payload, { status });
  }
  if (segments.length === 2 && segments[1] === "preview.svg") {
    const { status, payload } = await callGallery<{
      status?: string;
      ownerUserId?: string | null;
      svgText?: string;
    }>(env, "any-entry", { id: segments[0] });
    if (status !== 200 || !payload.svgText) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (payload.status === "public") {
      return new Response(payload.svgText, {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=300",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    }
    const allowed =
      (await canReview(request, env)) ||
      (payload.ownerUserId != null &&
        (await sessionUserOf(request, env))?.id === payload.ownerUserId);
    if (!allowed) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return new Response(payload.svgText, {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }
  if (segments.length === 1 && request.method === "GET") {
    const { status, payload } = await callGallery<{
      entry?: GalleryEntrySummary;
      status?: string;
      ownerUserId?: string | null;
      submitterEmail?: string | null;
      submitterProvider?: string | null;
      projectText?: string;
    }>(env, "any-entry", { id: segments[0] });
    if (status !== 200) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const curator = await canReview(request, env);
    if (payload.status !== "public") {
      const allowed =
        curator ||
        (payload.ownerUserId != null &&
          (await sessionUserOf(request, env))?.id === payload.ownerUserId);
      if (!allowed) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
    }
    return Response.json(
      {
        entry: payload.entry,
        status: payload.status,
        ownerUserId: payload.ownerUserId ?? null,
        // Traceability data, not feed data: a curator sees who submitted an
        // entry, the public sees only the byline.
        ...(curator
          ? {
              submitterEmail: payload.submitterEmail ?? null,
              submitterProvider: payload.submitterProvider ?? null,
            }
          : {}),
        projectText: payload.projectText,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (segments.length === 1 && request.method === "PUT") {
    return handleEntryUpdate(request, env, segments[0]!);
  }
  if (segments.length === 2 && request.method === "POST") {
    const [id, action] = segments;
    if (action !== "recycle" && action !== "restore") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // Admins curate anything; an owner may withdraw their own entry and
    // bring it back, which republishes it.
    const admin = await isAdmin(request, env);
    if (!admin) {
      const access = await entryManager(request, env, id!);
      if (!access.found) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
      if (!access.owner) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
    }
    const { status, payload } = await callGallery(env, "set-status", {
      id,
      status: action === "recycle" ? "recycled" : "public",
      at: new Date().toISOString(),
    });
    return Response.json(payload, { status });
  }
  if (segments.length === 1 && request.method === "DELETE") {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "delete", {
      id: segments[0],
    });
    return Response.json(payload, { status });
  }
  return Response.json({ error: "not-found" }, { status: 404 });
}
