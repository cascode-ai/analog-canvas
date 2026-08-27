// Public Gallery HTTP policy and rendering. Durable storage lives in
// gallery-do.ts; this module only authenticates and maps API requests.

import { evaluateSubmissionGates } from "@icm/derived";
import { analyzeDesignNetlist } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
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

import { sessionUserOf, type AuthNamespaceLike } from "./auth";
import {
  GALLERY_DAILY_SUBMISSION_LIMIT,
  GALLERY_DEFAULT_LIST_LIMIT,
  GALLERY_MAX_AUTHOR_LENGTH,
  GALLERY_MAX_DESCRIPTION_LENGTH,
  GALLERY_MAX_LIST_LIMIT,
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_PROJECT_BYTES,
  GALLERY_MAX_REJECT_REASON_LENGTH,
  GALLERY_MAX_VERSIONS_PER_ENTRY,
  WORKSPACE_SLOT_LIMIT,
  sanitizeGalleryTags,
  shortId,
  wrapTags,
  type GalleryEntrySummary,
  type GalleryEnv,
  type WorkspaceSlotSummary,
} from "./gallery-do";

export * from "./gallery-do";

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
): Promise<{
  found: boolean;
  reviewer: boolean;
  owner: boolean;
  status: string | null;
  rejectReason: string | null;
}> {
  const existing = await callGallery<{
    ownerUserId?: string | null;
    status?: string;
    rejectReason?: string | null;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return {
      found: false,
      reviewer: false,
      owner: false,
      status: null,
      rejectReason: null,
    };
  }
  const reviewer = await canReview(request, env);
  const user = await sessionUserOf(request, env);
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  return {
    found: true,
    reviewer,
    owner,
    status: existing.payload.status ?? null,
    rejectReason: existing.payload.rejectReason ?? null,
  };
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

function renderPreview(
  project: CircuitProject,
  resolver: SymbolResolver,
): string {
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
    projectText: serializeProject(project),
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
  const projectResolver = createProjectSymbolResolver(project, builtInSymbols);
  if (!privileged) {
    const report = evaluateSubmissionGates(project, projectResolver);
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
        svg_text: renderPreview(project, projectResolver),
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
  const projectResolver = createProjectSymbolResolver(project, builtInSymbols);
  if (!privileged) {
    const report = evaluateSubmissionGates(project, projectResolver);
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
    svgText: renderPreview(project, projectResolver),
    schemaVersion: project.schemaVersion,
    status: nextStatus,
    tags: wrapTags(sanitizeGalleryTags(body.tags)),
  });
  return Response.json(payload, { status });
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
    segments.length === 1 &&
    segments[0] === "rejected" &&
    request.method === "GET"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { payload } = await callGallery(env, "rejected", {});
    return Response.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-backup" &&
    request.method === "GET"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const { status, payload } = await callGallery(env, "schema-backup", {});
    return Response.json(payload, {
      status,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="analog-canvas-gallery-schema-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-current" &&
    request.method === "POST"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      apply?: unknown;
    } | null;
    const { status, payload } = await callGallery(env, "schema-converge", {
      apply: body?.apply === true,
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  if (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "schema-restore" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      backup?: unknown;
    } | null;
    const { status, payload } = await callGallery(env, "schema-restore", {
      backup: body?.backup,
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
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
  if (
    segments.length === 2 &&
    segments[1] === "reject" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const reviewer = await sessionUserOf(request, env);
    if (!reviewer?.isAdmin) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      reason?: unknown;
    } | null;
    const reason = fieldText(body?.reason, GALLERY_MAX_REJECT_REASON_LENGTH);
    if (!reason) {
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    }
    const { status, payload } = await callGallery(env, "reject", {
      id: segments[0],
      reason,
      at: new Date().toISOString(),
      reviewerId: reviewer.id,
    });
    return Response.json(payload, { status });
  }
  if (segments.length === 2 && request.method === "POST") {
    const [id, action] = segments;
    if (action !== "recycle" && action !== "restore") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // Admins curate anything. An ordinary owner may withdraw a public entry
    // or restore a voluntary withdrawal, but cannot undo an Owner rejection.
    const admin = await isAdmin(request, env);
    if (!admin) {
      const access = await entryManager(request, env, id!);
      if (!access.found) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
      if (!access.owner) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const validOwnerTransition =
        action === "recycle"
          ? access.status === "public"
          : access.status === "recycled" && access.rejectReason === null;
      if (!validOwnerTransition) {
        return Response.json({ error: "invalid-status" }, { status: 409 });
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
