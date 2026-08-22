// Community example gallery: publish-first with an admin recycle bin.
//
// Trust boundary: the only accepted input is Project JSON that passes the
// strict protocol boundary (`parseProject`, rolling-window upgrade applied).
// Everything served back — canonical Project text and the preview SVG — is
// derived server-side from that validated model; no client-supplied markup
// is ever stored or echoed. Entries publish immediately; the admin (bearer
// `GALLERY_ADMIN_TOKEN`, a Cloudflare secret) can recycle (soft, restorable),
// hard-delete from the bin only, and batch re-serialize every entry to keep
// long-lived records inside the rolling schema window. Previews are stored
// independently so browsing survives an entry the current window can no
// longer open.

import { evaluateSubmissionGates } from "@icm/derived";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";

import { sessionUserOf, type AuthNamespaceLike } from "./auth";

export const GALLERY_MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const GALLERY_MAX_NAME_LENGTH = 120;
export const GALLERY_MAX_AUTHOR_LENGTH = 40;
export const GALLERY_MAX_DESCRIPTION_LENGTH = 300;
export const GALLERY_DAILY_SUBMISSION_LIMIT = 10;
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
  GALLERY_ADMIN_TOKEN?: string;
  /** Phase G2: an admin session works wherever the bearer does. */
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
  reject_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  project_text: string;
  svg_text: string;
}

const resolver = new InMemorySymbolResolver(builtInSymbols);

function summaryOf(row: EntryRow): GalleryEntrySummary {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    createdAt: row.created_at,
    schemaVersion: row.schema_version,
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
        project_text TEXT NOT NULL,
        svg_text TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_gallery_entries_status_created
      ON gallery_entries(status, created_at)
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gallery_submissions (
        day TEXT NOT NULL,
        submitter_hash TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, submitter_hash)
      ) WITHOUT ROWID
    `);
    // Additive review-queue columns (phase G3) for pre-existing databases.
    for (const alteration of [
      "ALTER TABLE gallery_entries ADD COLUMN reject_reason TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE gallery_entries ADD COLUMN reviewed_by TEXT",
    ]) {
      try {
        this.sql.exec(alteration);
      } catch {
        // Column already present.
      }
    }
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
      case "pending":
        return this.pending();
      case "review":
        return this.review(body);
      case "mine":
        return this.mine(String(body.ownerUserId));
      case "all-ids":
        return this.allIds();
      case "update-entry":
        return this.updateEntry(body);
      case "replace-entry":
        return this.replaceEntry(body);
      default:
        return Response.json({ error: "Unknown operation" }, { status: 404 });
    }
  }

  private submit(body: Record<string, unknown>): Response {
    const entry = body.entry as EntryRow;
    const day = String(body.day);
    const submitterHash = String(body.submitterHash);
    const outcome = this.state.storage.transactionSync(() => {
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
      this.sql.exec(
        `INSERT INTO gallery_entries(
          id, name, author, description, created_at, schema_version,
          status, recycled_at, owner_user_id, project_text, svg_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        entry.id,
        entry.name,
        entry.author,
        entry.description,
        entry.created_at,
        entry.schema_version,
        entry.status === "pending" ? "pending" : "public",
        entry.owner_user_id ?? null,
        entry.project_text,
        entry.svg_text,
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
    if (cursor) {
      conditions.push("(created_at || '|' || id) < ?");
      bindings.push(cursor);
    }
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
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
      projectText: row.project_text,
      svgText: row.svg_text,
    });
  }

  private pending(): Response {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT * FROM gallery_entries WHERE status = 'pending'
         ORDER BY created_at ASC, id ASC`,
      )
      .toArray();
    return Response.json({
      entries: rows.map((row) => ({
        ...summaryOf(row),
        ownerUserId: row.owner_user_id,
      })),
    });
  }

  private review(body: Record<string, unknown>): Response {
    const row = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.id),
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    if (row.status !== "pending") {
      return Response.json({ error: "not-pending" }, { status: 409 });
    }
    const approve = body.decision === "approve";
    this.sql.exec(
      `UPDATE gallery_entries
       SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = ?
       WHERE id = ?`,
      approve ? "public" : "rejected",
      approve ? null : ((body.reason as string | null) ?? null),
      String(body.at),
      String(body.reviewerId),
      row.id,
    );
    return Response.json({
      id: row.id,
      status: approve ? "public" : "rejected",
    });
  }

  /** Owner/reviewer edit (phase G3): new content, possibly new status. */
  private replaceEntry(body: Record<string, unknown>): Response {
    const row = this.sql
      .exec<EntryRow>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        String(body.id),
      )
      .toArray()[0];
    if (!row) return Response.json({ error: "not-found" }, { status: 404 });
    this.sql.exec(
      `UPDATE gallery_entries
       SET name = ?, author = ?, description = ?, project_text = ?,
           svg_text = ?, schema_version = ?, status = ?,
           reject_reason = NULL, reviewed_at = NULL, reviewed_by = NULL
       WHERE id = ?`,
      String(body.name),
      String(body.author),
      String(body.description),
      String(body.projectText),
      String(body.svgText),
      Number(body.schemaVersion),
      String(body.status),
      row.id,
    );
    return Response.json({ id: row.id, status: String(body.status) });
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

function bearerIsAdmin(request: Request, env: GalleryEnv): boolean {
  return Boolean(
    env.GALLERY_ADMIN_TOKEN &&
    request.headers.get("Authorization") ===
      `Bearer ${env.GALLERY_ADMIN_TOKEN}`,
  );
}

async function isAdmin(request: Request, env: GalleryEnv): Promise<boolean> {
  if (bearerIsAdmin(request, env)) return true;
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true;
}

/** Review authority (phase G3): the bearer, an admin, or a moderator. */
async function canReview(request: Request, env: GalleryEnv): Promise<boolean> {
  if (bearerIsAdmin(request, env)) return true;
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true || user?.role === "moderator";
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

async function handleSubmission(
  request: Request,
  env: GalleryEnv,
): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // Phase G3: the bearer and admin/moderator sessions publish directly;
  // ordinary signed-in users pass the quality gates and enter the review
  // queue as `pending`. Anonymous upload stays impossible — the original
  // day-one rule.
  const bearer = bearerIsAdmin(request, env);
  const user = await sessionUserOf(request, env);
  const privileged =
    bearer || user?.isAdmin === true || user?.role === "moderator";
  if (!bearer && !user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    author?: unknown;
    description?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  const author = fieldText(body?.author, GALLERY_MAX_AUTHOR_LENGTH);
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  if (!body || !name || author === null || description === null) {
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
  const entryStatus = privileged ? "public" : "pending";
  const { status, payload } = await callGallery<{ id?: string }>(
    env,
    "submit",
    {
      day: now.toISOString().slice(0, 10),
      submitterHash: await submitterHash(request),
      entry: {
        id: crypto.randomUUID(),
        name,
        author,
        description,
        created_at: now.toISOString(),
        schema_version: project.schemaVersion,
        status: entryStatus,
        owner_user_id: user?.id ?? null,
        project_text: serializeProject(project),
        svg_text: renderPreview(project),
      },
    },
  );
  if (status === 429) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }
  return Response.json(
    { id: payload.id, status: entryStatus },
    { status: 201 },
  );
}

/**
 * Owner/reviewer entry update (phase G3 completion). The bearer and
 * admin/moderator sessions may update any entry, keeping its current
 * status; an ordinary session must own the entry and passes the quality
 * gates, after which the entry re-enters review as `pending` with the
 * previous decision cleared — a rejection therefore becomes an informed
 * resubmission.
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
    ownerUserId?: string | null;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const bearer = bearerIsAdmin(request, env);
  const user = await sessionUserOf(request, env);
  const privileged =
    bearer || user?.isAdmin === true || user?.role === "moderator";
  if (!bearer && !user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  if (!privileged && !owner) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    author?: unknown;
    description?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  const author = fieldText(body?.author, GALLERY_MAX_AUTHOR_LENGTH);
  const description = fieldText(
    body?.description,
    GALLERY_MAX_DESCRIPTION_LENGTH,
  );
  if (!body || !name || author === null || description === null) {
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
  const nextStatus = privileged
    ? (existing.payload.status ?? "public")
    : "pending";
  const { status, payload } = await callGallery(env, "replace-entry", {
    id,
    name,
    author,
    description,
    projectText: serializeProject(project),
    svgText: renderPreview(project),
    schemaVersion: project.schemaVersion,
    status: nextStatus,
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
  if (!url.pathname.startsWith("/api/gallery")) return null;
  const segments = url.pathname.split("/").filter(Boolean).slice(2);

  if (segments.length === 0 && request.method === "GET") {
    const { payload } = await callGallery(env, "list", {
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      author: url.searchParams.get("author"),
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
    segments[0] === "review" &&
    request.method === "GET"
  ) {
    if (!(await canReview(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { payload } = await callGallery(env, "pending", {});
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
      projectText?: string;
    }>(env, "any-entry", { id: segments[0] });
    if (status !== 200) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (payload.status !== "public") {
      const allowed =
        (await canReview(request, env)) ||
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
    if (action === "approve" || action === "reject") {
      if (!(await canReview(request, env))) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body =
        action === "reject"
          ? ((await request.json().catch(() => null)) as {
              reason?: unknown;
            } | null)
          : null;
      const reason = fieldText(body?.reason, GALLERY_MAX_DESCRIPTION_LENGTH);
      const reviewer = await sessionUserOf(request, env);
      const { status, payload } = await callGallery(env, "review", {
        id,
        decision: action,
        reason: action === "reject" && reason ? reason : null,
        at: new Date().toISOString(),
        reviewerId: reviewer?.id ?? "bearer",
      });
      return Response.json(payload, { status });
    }
    if (action !== "recycle" && action !== "restore") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
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
