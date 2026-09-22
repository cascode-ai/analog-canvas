import { formulaPreviewNeedsRefresh } from "./gallery-preview";
import { validGalleryAttention } from "./gallery-curation";
// Public Gallery HTTP policy and rendering. Durable storage lives in
// gallery-do.ts; this module only authenticates and maps API requests.

import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import { createDesignNetlistExport, designExtractsNetlist } from "@icm/netlist";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import { type CircuitProject } from "@icm/model";

import { sessionUserOf } from "./auth";
import {
  previewAcceptanceUserOf,
  type PreviewAcceptanceEnv,
} from "./preview-acceptance";
import {
  GALLERY_MAX_AUTHOR_LENGTH,
  GALLERY_MAX_DESCRIPTION_LENGTH,
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_PROJECT_BYTES,
  GALLERY_MAX_REJECT_REASON_LENGTH,
  sanitizeGalleryTags,
  shortId,
  wrapTags,
  type GalleryEntrySummary,
  type GalleryEnv,
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

interface PublicGalleryCatalog {
  entries: GalleryEntrySummary[];
  total: number;
  netlistable: number;
  tags: { tag: string; count: number; group: string }[];
  groups: { group: string; count: number }[];
  authors: { author: string; ownerUserId: string | null; count: number }[];
}

interface PublicGalleryStoredEntry {
  entry: GalleryEntrySummary;
  status: string;
  projectText: string;
}

export interface GalleryReadableDocument {
  title: string;
  description: string;
  headHtml: string;
  bodyHtml: string;
}

async function publicGalleryCatalog(
  env: GalleryEnv,
): Promise<PublicGalleryCatalog | null> {
  const { status, payload } = await callGallery<PublicGalleryCatalog>(
    env,
    "catalog",
    {},
  );
  return status === 200 ? payload : null;
}

async function publicGalleryEntry(
  env: GalleryEnv,
  id: string,
): Promise<PublicGalleryStoredEntry | null> {
  const { status, payload } = await callGallery<PublicGalleryStoredEntry>(
    env,
    "entry",
    { id },
  );
  return status === 200 ? payload : null;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicHref(path: string, value?: string): string {
  return value === undefined ? path : `${path}${encodeURIComponent(value)}`;
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US");
}

function readableJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export interface GalleryPreviewCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface GalleryRouteRuntime {
  /** Injectable in tests; production falls back to Cloudflare's default cache. */
  previewCache?: GalleryPreviewCache | null;
}

function defaultPreviewCache(): GalleryPreviewCache | null {
  if (typeof caches === "undefined") return null;
  return (
    (caches as CacheStorage & { readonly default?: Cache }).default ?? null
  );
}

async function matchPreviewCache(
  cache: GalleryPreviewCache | null,
  request: Request,
): Promise<Response | undefined> {
  if (!cache) return undefined;
  try {
    return await cache.match(request);
  } catch {
    // A cache outage must degrade to the canonical GalleryDO path.
    return undefined;
  }
}

async function storePreviewCache(
  cache: GalleryPreviewCache | null,
  request: Request,
  response: Response,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(request, response);
  } catch {
    // The response is still valid when an edge refuses or evicts the entry.
  }
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

function fieldText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

async function renderPreview(
  project: CircuitProject,
  resolver: SymbolResolver,
): Promise<string> {
  const topDocument = project.documents.find(
    (document) => document.id === project.topDocumentId,
  )!;
  const prepared = await prepareDocumentFormulaArtifacts(topDocument);
  try {
    return renderDocumentSvg(topDocument, resolver);
  } finally {
    prepared.release();
  }
}

async function recoverFormulaPreview(
  svg: string,
  projectText?: string,
): Promise<string> {
  if (!projectText || !formulaPreviewNeedsRefresh(svg)) return svg;
  const project = parseProject(projectText);
  return renderPreview(
    project,
    createProjectSymbolResolver(project, builtInSymbols),
  );
}

function publicationBindingFields(body: {
  cloudProjectId?: unknown;
  expectedGalleryEntryId?: unknown;
}): { cloudProjectId?: string; expectedGalleryEntryId?: string | null } | null {
  if (body.cloudProjectId === undefined) return {};
  if (
    typeof body.cloudProjectId !== "string" ||
    !body.cloudProjectId ||
    !(
      body.expectedGalleryEntryId === null ||
      (typeof body.expectedGalleryEntryId === "string" &&
        body.expectedGalleryEntryId.length > 0)
    )
  )
    return null;
  return {
    cloudProjectId: body.cloudProjectId,
    expectedGalleryEntryId: body.expectedGalleryEntryId,
  };
}

/** Private, stable Cloud Projects. Save updates a bound Project in place. */
async function handleCloudProjects(
  request: Request,
  env: GalleryEnv & PreviewAcceptanceEnv,
  projectId: string | null,
): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const user =
    previewAcceptanceUserOf(request, env) ??
    (await sessionUserOf(request, env));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const { status, payload } = projectId
      ? await callGallery(env, "cloud-project-open", {
          userId: user.id,
          id: projectId,
        })
      : await callGallery(env, "cloud-project-list", { userId: user.id });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }

  if (request.method === "DELETE" && projectId) {
    const { status, payload } = await callGallery(env, "cloud-project-delete", {
      userId: user.id,
      id: projectId,
    });
    return Response.json(payload, { status });
  }

  if (request.method === "PATCH" && projectId) {
    const fields = (await request.json().catch(() => null)) as {
      favorite?: unknown;
    } | null;
    if (!fields || typeof fields.favorite !== "boolean")
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    const { status, payload } = await callGallery(
      env,
      "cloud-project-favorite",
      {
        userId: user.id,
        id: projectId,
        favorite: fields.favorite,
      },
    );
    return Response.json(payload, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    projectText?: unknown;
    galleryEntryId?: unknown;
  } | null;
  const name = fieldText(body?.name, GALLERY_MAX_NAME_LENGTH);
  if (!body || !name || typeof body.projectText !== "string") {
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  }
  if (
    body.galleryEntryId !== undefined &&
    (typeof body.galleryEntryId !== "string" || !body.galleryEntryId)
  ) {
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
  // The shelf shows the circuit, not its name, so the thumbnail is rendered
  // once here on save rather than on every read. A drawing the renderer
  // cannot handle still saves; the shelf draws a placeholder tile instead.
  let previewSvg = "";
  try {
    previewSvg = await renderPreview(
      project,
      createProjectSymbolResolver(project, builtInSymbols),
    );
  } catch {
    previewSvg = "";
  }
  const operation =
    request.method === "POST" ? "cloud-project-create" : "cloud-project-update";
  const expectedRevisionMatch = request.headers
    .get("if-match")
    ?.match(/^revision-(\d+)$/u);
  if (request.method === "PUT" && !expectedRevisionMatch) {
    return Response.json(
      { error: "expected-revision-required" },
      { status: 428 },
    );
  }
  const { status, payload } = await callGallery(env, operation, {
    userId: user.id,
    mayEditGallery: user.isAdmin === true || user.role === "moderator",
    ...(body.galleryEntryId === undefined
      ? {}
      : {
          galleryEntryId: body.galleryEntryId,
        }),
    id: projectId ?? shortId(),
    name,
    updatedAt: new Date().toISOString(),
    ...(expectedRevisionMatch
      ? { expectedRevision: Number(expectedRevisionMatch[1]) }
      : {}),
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    projectText: serializeProject(project),
    previewSvg,
  });
  return Response.json(payload, { status });
}

/** Private save history uses the same account boundary and revision gate as Save. */
async function handleCloudProjectHistory(
  request: Request,
  env: GalleryEnv & PreviewAcceptanceEnv,
  projectId: string,
  versionId?: string,
  action?: string,
): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const user =
    previewAcceptanceUserOf(request, env) ??
    (await sessionUserOf(request, env));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const headers = { "cache-control": "private, no-store" };
  const result = await callGallery(env, "cloud-project-versions", {
    userId: user.id,
    id: projectId,
    ...(versionId ? { versionId } : {}),
  });
  if (result.status !== 200 || !versionId)
    return Response.json(result.payload, { status: result.status, headers });
  const payload = result.payload as {
    version: { project_text: string; preview_svg: string; name: string };
  };
  if (request.method === "GET" && action === "preview.svg")
    return new Response(
      await recoverFormulaPreview(
        payload.version.preview_svg,
        payload.version.project_text,
      ),
      {
        headers: { ...headers, "content-type": "image/svg+xml" },
      },
    );
  if (request.method === "GET" && action === "project")
    return Response.json(
      { projectText: payload.version.project_text },
      { headers },
    );
  if (request.method === "POST" && action === "restore") {
    // Route through Save, including parsing, rendering, compare-and-swap and
    // snapshotting the displaced draft. Publication/favorite bindings stay put.
    return handleCloudProjects(
      new Request(request.url, {
        method: "PUT",
        headers: request.headers,
        body: JSON.stringify({
          name: payload.version.name,
          projectText: payload.version.project_text,
        }),
      }),
      env,
      projectId,
    );
  }
  return Response.json({ error: "not-found" }, { status: 404, headers });
}

/**
 * One shelf thumbnail. Private by construction: the Durable Object scopes the
 * read to the signed-in account, and the response is marked private so no
 * shared cache ever holds another member's drawing.
 */
async function handleCloudProjectPreview(
  request: Request,
  env: GalleryEnv & PreviewAcceptanceEnv,
  projectId: string,
): Promise<Response> {
  const user =
    previewAcceptanceUserOf(request, env) ??
    (await sessionUserOf(request, env));
  if (!user) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const { status, payload } = await callGallery<{
    previewSvg?: string;
    revision?: number;
  }>(env, "cloud-project-preview", { userId: user.id, id: projectId });
  if (status !== 200) {
    return Response.json(
      { error: "not-found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  const needsBackfill = !payload.previewSvg;
  if (needsBackfill || formulaPreviewNeedsRefresh(payload.previewSvg!)) {
    // Backfill empty legacy thumbnails. Existing formula previews are repaired
    // only in the response; saved Projects, previews and history stay intact.
    const opened = await callGallery<{
      project?: { projectText?: string; revision?: number };
    }>(env, "cloud-project-open", { userId: user.id, id: projectId });
    const projectText = opened.payload.project?.projectText;
    if (opened.status === 200 && typeof projectText === "string") {
      try {
        const project = parseProject(projectText);
        const rendered = await renderPreview(
          project,
          createProjectSymbolResolver(project, builtInSymbols),
        );
        if (rendered) {
          payload.previewSvg = rendered;
          const openedRevision = opened.payload.project?.revision;
          if (typeof openedRevision === "number") {
            payload.revision = openedRevision;
          }
          if (needsBackfill) {
            await callGallery(env, "cloud-project-preview-store", {
              userId: user.id,
              id: projectId,
              revision: opened.payload.project?.revision,
              previewSvg: rendered,
            });
          }
        }
      } catch {
        // The renderer cannot draw this Project; the shelf shows its
        // placeholder tile instead.
      }
    }
  }
  if (!payload.previewSvg) {
    return Response.json(
      { error: "not-found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  // A matching revision names immutable bytes, so a shelf that has not been
  // saved since costs nothing to redraw.
  const requestedRevision = new URL(request.url).searchParams.get("v");
  const immutable =
    typeof payload.revision === "number" &&
    requestedRevision === String(payload.revision);
  return new Response(payload.previewSvg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": immutable
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
    },
  });
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
    cloudProjectId?: unknown;
    expectedGalleryEntryId?: unknown;
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
  const binding = publicationBindingFields(body);
  if (!binding)
    return Response.json({ error: "invalid-fields" }, { status: 400 });
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
  project.name = name;
  const now = new Date();
  const { status, payload } = await callGallery<{
    id?: string;
    previewRevision?: string;
  }>(env, "submit", {
    ...binding,
    userId: user.id,
    day: now.toISOString().slice(0, 10),
    enforceLimit: !privileged,
    entry: {
      // The id is drawn inside the Durable Object, which is the only place
      // that can tell whether one is already taken.
      id: "",
      // Recorded, never enforced: a circuit that does not extract is
      // published exactly the same way, it simply does not wear the badge.
      netlistable: designExtractsNetlist(project) ? 1 : 0,
      name,
      author,
      description,
      created_at: now.toISOString(),
      schema_version: CURRENT_PROJECT_FILE_VERSION,
      owner_user_id: user.id,
      // Recorded per submission, so an entry stays traceable to the
      // identity that published it even if the account later changes.
      submitter_email: user.email,
      submitter_provider: user.provider,
      tags: wrapTags(sanitizeGalleryTags(body.tags)),
      project_text: serializeProject(project),
      svg_text: await renderPreview(project, projectResolver),
    },
  });
  if (status === 429) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }
  if (status !== 200) return Response.json(payload, { status });
  return Response.json(
    {
      id: payload.id,
      status: "public",
      previewRevision: payload.previewRevision ?? "legacy",
    },
    { status: 201 },
  );
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
    cloudProjectId?: unknown;
    expectedGalleryEntryId?: unknown;
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
  const binding = publicationBindingFields(body);
  if (!binding)
    return Response.json({ error: "invalid-fields" }, { status: 400 });
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
  project.name = name;
  const nextStatus = existing.payload.status ?? "public";
  // Every republication re-answers this; the badge follows the drawing.
  const netlistable = designExtractsNetlist(project) ? 1 : 0;
  const { status, payload } = await callGallery(env, "replace-entry", {
    ...binding,
    userId: user.id,
    id,
    at: new Date().toISOString(),
    name,
    author,
    description,
    projectText: serializeProject(project),
    svgText: await renderPreview(project, projectResolver),
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    netlistable,
    status: nextStatus,
    tags: wrapTags(sanitizeGalleryTags(body.tags)),
  });
  return Response.json(payload, { status });
}

/**
 * All `/api/gallery*` routing. Returns null for unrelated paths so the
 * worker entry keeps its ordinary dispatch.
 */
/**
 * Re-answer one batch of stored netlist marks whose rule version is behind
 * this build's. Both callers want the same thing and neither has to know how
 * staleness is found: the moderation button when somebody wants it now, and
 * the schedule so that nobody has to.
 */
export async function refreshNetlistMarks(
  env: GalleryEnv,
  limit?: number,
): Promise<{ status: number; payload: unknown }> {
  return callGallery(env, "netlistable-refresh", {
    ...(limit === undefined ? {} : { limit }),
  });
}

function catalogEntryHtml(entry: GalleryEntrySummary): string {
  const tags = entry.tags.length
    ? ` Tags: ${entry.tags
        .map(
          (tag) =>
            `<a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a>`,
        )
        .join(", ")}.`
    : "";
  return `<li data-gallery-entry-id="${escapeHtml(entry.id)}">
    <a href="/g/${encodeURIComponent(entry.id)}">${escapeHtml(entry.name)}</a>
    <span> by ${escapeHtml(entry.author || "Unknown contributor")}.</span>
    ${entry.description ? `<span> ${escapeHtml(entry.description)}</span>` : ""}
    <span>${tags} ${entry.netlistable ? "Netlist available." : "Netlist currently blocked."} ${entry.likes} likes.</span>
  </li>`;
}

function catalogDocument(
  request: Request,
  catalog: PublicGalleryCatalog,
): GalleryReadableDocument {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const author = (url.searchParams.get("author") ?? "").trim();
  const requestedTags = [
    ...url.searchParams.getAll("tag"),
    ...(url.searchParams.get("tags") ?? "").split(","),
  ]
    .map((tag) => tag.trim().toLocaleLowerCase("en-US"))
    .filter((tag, index, values) => tag && values.indexOf(tag) === index);
  const netlistableOnly =
    url.searchParams.get("netlist") === "1" ||
    url.searchParams.get("netlistable") === "1";
  const normalizedQuery = normalizedSearchText(query);
  const entries = catalog.entries.filter((entry) => {
    if (
      author &&
      entry.author.toLocaleLowerCase("en-US") !==
        author.toLocaleLowerCase("en-US")
    ) {
      return false;
    }
    if (
      requestedTags.length &&
      !requestedTags.every((tag) => entry.tags.includes(tag))
    ) {
      return false;
    }
    if (netlistableOnly && !entry.netlistable) return false;
    if (!normalizedQuery) return true;
    return normalizedSearchText(
      [entry.name, entry.author, entry.description, ...entry.tags].join(" "),
    ).includes(normalizedQuery);
  });
  const filters = [
    query ? `text “${query}”` : "",
    author ? `author “${author}”` : "",
    requestedTags.length ? `tags ${requestedTags.join(", ")}` : "",
    netlistableOnly ? "netlistable only" : "",
  ].filter(Boolean);
  const description = `${catalog.total} public analog circuits with searchable authors, descriptions, tags, Project Code and generated netlists.`;
  const tagsByGroup = new Map<string, { tag: string; count: number }[]>();
  for (const tag of catalog.tags) {
    tagsByGroup.set(tag.group, [...(tagsByGroup.get(tag.group) ?? []), tag]);
  }
  const groupHtml = catalog.groups
    .map(({ group, count }) => {
      const tags = (tagsByGroup.get(group) ?? [])
        .map(
          ({ tag, count: tagCount }) =>
            `<li><a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a> (${tagCount})</li>`,
        )
        .join("");
      return `<li><strong>${escapeHtml(group)}</strong> (${count} circuits)<ul>${tags}</ul></li>`;
    })
    .join("");
  const authors = catalog.authors
    .map(
      ({ author, count }) =>
        `<li><a href="${publicHref("/?author=", author)}">${escapeHtml(author)}</a> (${count})</li>`,
    )
    .join("");
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Analog Canvas Community Gallery",
    description,
    numberOfItems: catalog.total,
    mainEntity: entries.map((entry) => ({
      "@type": "CreativeWork",
      "@id": `${url.origin}/g/${entry.id}`,
      name: entry.name,
      author: entry.author,
      description: entry.description,
      keywords: entry.tags,
    })),
  };
  return {
    title: "Analog Canvas Community Gallery",
    description,
    headHtml: `<link rel="canonical" href="${escapeHtml(url.origin)}/"><script type="application/ld+json">${readableJson(structured)}</script>`,
    bodyHtml: `<main data-public-gallery-document="catalog">
      <header>
        <h1>Analog Canvas Community Gallery</h1>
        <p>${escapeHtml(description)}</p>
      </header>
      <section aria-labelledby="gallery-overview">
        <h2 id="gallery-overview">Gallery overview</h2>
        <dl>
          <dt>Public circuits</dt><dd>${catalog.total}</dd>
          <dt>Netlistable circuits</dt><dd>${catalog.netlistable}</dd>
          <dt>Tags</dt><dd>${catalog.tags.length}</dd>
          <dt>Contributors</dt><dd>${catalog.authors.length}</dd>
        </dl>
        <p>Search the same URL with <code>?q=ota</code>, <code>?tags=bandgap</code>, <code>?author=Magic%20Li</code>, or <code>?netlist=1</code>.</p>
      </section>
      <section aria-labelledby="gallery-taxonomy">
        <h2 id="gallery-taxonomy">Tags</h2>
        <p>Tags are the sole public classification system. Tag groups organize those tags without creating a second category system.</p>
        <ul>${groupHtml}</ul>
      </section>
      <section aria-labelledby="gallery-contributors">
        <h2 id="gallery-contributors">Contributors</h2>
        <ul>${authors}</ul>
      </section>
      <section aria-labelledby="gallery-circuits">
        <h2 id="gallery-circuits">${entries.length}${filters.length ? ` matching` : " public"} circuits</h2>
        ${filters.length ? `<p>Active filters: ${escapeHtml(filters.join("; "))}. <a href="/">Clear filters</a>.</p>` : ""}
        <ol>${entries.map(catalogEntryHtml).join("")}</ol>
      </section>
    </main>`,
  };
}

function entryDocument(
  request: Request,
  stored: PublicGalleryStoredEntry,
): GalleryReadableDocument {
  const url = new URL(request.url);
  const entry = stored.entry;
  const project = parseProject(stored.projectText);
  const documents = project.documents;
  const instances = documents.flatMap((document) => document.instances);
  const symbolCounts = new Map<string, number>();
  for (const instance of instances) {
    symbolCounts.set(
      instance.symbolId,
      (symbolCounts.get(instance.symbolId) ?? 0) + 1,
    );
  }
  const resourceBase = `/g/${encodeURIComponent(entry.id)}`;
  const cells = documents
    .map((document) => {
      const ports = (document.netlist?.terminals ?? [])
        .map(
          (terminal) =>
            `${escapeHtml(terminal.name)} (${escapeHtml(terminal.direction)})`,
        )
        .join(", ");
      return `<li><strong>${escapeHtml(document.name)}</strong>${document.netlist?.name ? ` · netlist name ${escapeHtml(document.netlist.name)}` : ""}; ${document.instances.length} components; ports: ${ports || "none"}.</li>`;
    })
    .join("");
  const components = [...symbolCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "en"))
    .map(([symbolId, count]) => `<li>${escapeHtml(symbolId)}: ${count}</li>`)
    .join("");
  const tags = entry.tags
    .map(
      (tag) => `<a href="${publicHref("/?tags=", tag)}">${escapeHtml(tag)}</a>`,
    )
    .join(", ");
  const description =
    entry.description || `${entry.name}, a public Analog Canvas circuit.`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": url.href,
    name: entry.name,
    author: entry.author,
    description,
    datePublished: entry.createdAt,
    keywords: entry.tags,
    encoding: [
      `${url.origin}${resourceBase}/project.icproj.json`,
      `${url.origin}${resourceBase}/netlist.sp`,
      `${url.origin}${resourceBase}/netlist.scs`,
    ],
  };
  return {
    title: `${entry.name} · Analog Canvas`,
    description,
    headHtml: `<link rel="canonical" href="${escapeHtml(url.origin + resourceBase)}"><link rel="alternate" type="application/json" href="${resourceBase}/project.icproj.json" title="Analog Canvas Project Code"><link rel="alternate" type="text/plain" href="${resourceBase}/netlist.sp" title="SPICE netlist"><link rel="alternate" type="text/plain" href="${resourceBase}/netlist.scs" title="Spectre netlist"><script type="application/ld+json">${readableJson(structured)}</script>`,
    bodyHtml: `<main data-public-gallery-document="entry" data-gallery-entry-id="${escapeHtml(entry.id)}">
      <header>
        <p><a href="/">Analog Canvas Community Gallery</a></p>
        <h1>${escapeHtml(entry.name)}</h1>
        <p>By <a href="${publicHref("/?author=", entry.author)}">${escapeHtml(entry.author || "Unknown contributor")}</a>.</p>
        <p>${escapeHtml(description)}</p>
        <p>Tags: ${tags || "none"}.</p>
      </header>
      <section aria-labelledby="circuit-overview">
        <h2 id="circuit-overview">Circuit overview</h2>
        <dl>
          <dt>Gallery ID</dt><dd>${escapeHtml(entry.id)}</dd>
          <dt>Published</dt><dd>${escapeHtml(entry.createdAt)}</dd>
          <dt>Project schema</dt><dd>${entry.schemaVersion}</dd>
          <dt>Cells</dt><dd>${documents.length}</dd>
          <dt>Components</dt><dd>${instances.length}</dd>
          <dt>Nets</dt><dd>${documents.reduce((sum, document) => sum + document.nets.length, 0)}</dd>
          <dt>Routes</dt><dd>${documents.reduce((sum, document) => sum + document.routes.length, 0)}</dd>
          <dt>Junctions</dt><dd>${documents.reduce((sum, document) => sum + document.junctions.length, 0)}</dd>
          <dt>Netlist</dt><dd>${entry.netlistable ? "Available" : "Currently blocked; read a netlist URL for diagnostics"}</dd>
          <dt>Likes</dt><dd>${entry.likes}</dd>
        </dl>
      </section>
      <section aria-labelledby="circuit-cells"><h2 id="circuit-cells">Cells and ports</h2><ul>${cells}</ul></section>
      <section aria-labelledby="circuit-components"><h2 id="circuit-components">Component types</h2><ul>${components || "<li>None</li>"}</ul></section>
      <section aria-labelledby="circuit-resources">
        <h2 id="circuit-resources">Direct public resources</h2>
        <ul>
          <li><a href="${resourceBase}/project.icproj.json">Complete Project Code</a></li>
          <li><a href="${resourceBase}/netlist.sp">SPICE netlist</a></li>
          <li><a href="${resourceBase}/netlist.scs">Spectre netlist</a></li>
          <li><a href="${resourceBase}/preview.svg">SVG preview</a></li>
        </ul>
        <p>This page becomes the interactive Editor when browser JavaScript runs. Reading the page or resources above requires no account or private Canvas connection; modifying a circuit still requires explicit authorization.</p>
      </section>
    </main>`,
  };
}

/** Server-readable content for the same public URLs the browser application owns. */
export async function galleryReadableDocument(
  request: Request,
  env: GalleryEnv,
): Promise<GalleryReadableDocument | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (/^\/?$/u.test(url.pathname)) {
    const catalog = await publicGalleryCatalog(env);
    return catalog ? catalogDocument(request, catalog) : null;
  }
  const match = /^\/g\/([A-Za-z0-9-]{1,64})\/?$/u.exec(url.pathname);
  if (!match) return null;
  const stored = await publicGalleryEntry(env, match[1]!);
  if (!stored) return null;
  try {
    return entryDocument(request, stored);
  } catch {
    return null;
  }
}

function rawGalleryHeaders(contentType: string, fileName: string): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "content-disposition": `inline; filename="${fileName}"`,
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
}

async function directGalleryResource(
  request: Request,
  env: GalleryEnv,
  runtime: GalleryRouteRuntime,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const match =
    /^\/g\/([A-Za-z0-9-]{1,64})\/(project\.icproj\.json|netlist\.(sp|scs)|preview\.svg)\/?$/u.exec(
      url.pathname,
    );
  if (!match) return null;
  const id = match[1]!;
  const resource = match[2]!;
  const stored = await publicGalleryEntry(env, id);
  if (!stored) return Response.json({ error: "not-found" }, { status: 404 });
  if (resource === "preview.svg") {
    const response = await routeGalleryRequest(
      new Request(
        `${url.origin}/api/gallery/${encodeURIComponent(id)}/preview.svg?v=${encodeURIComponent(stored.entry.previewRevision)}`,
        { method: request.method },
      ),
      env,
      runtime,
    );
    if (!response)
      return new Response("Preview unavailable\n", { status: 503 });
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("content-disposition", `inline; filename="${id}.svg"`);
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  }
  if (resource === "project.icproj.json") {
    return new Response(request.method === "HEAD" ? null : stored.projectText, {
      headers: rawGalleryHeaders(
        "application/json; charset=utf-8",
        `${id}.icproj.json`,
      ),
    });
  }
  let project: CircuitProject;
  try {
    project = parseProject(stored.projectText);
  } catch (error) {
    return new Response(
      request.method === "HEAD"
        ? null
        : `Project Code cannot be read: ${error instanceof Error ? error.message : String(error)}\n`,
      {
        status: 422,
        headers: rawGalleryHeaders(
          "text/plain; charset=utf-8",
          `${id}.${match[3]}`,
        ),
      },
    );
  }
  const format = match[3] === "scs" ? "spectre" : "spice";
  const result = createDesignNetlistExport(project, { format });
  if (result.status === "blocked") {
    const diagnostics = result.diagnostics
      .map(
        (diagnostic) =>
          `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
      )
      .join("\n");
    return new Response(
      request.method === "HEAD"
        ? null
        : `Netlist generation is blocked.\n${diagnostics}\n`,
      {
        status: 422,
        headers: rawGalleryHeaders(
          "text/plain; charset=utf-8",
          `${id}.${match[3]}`,
        ),
      },
    );
  }
  return new Response(request.method === "HEAD" ? null : result.file.text, {
    headers: rawGalleryHeaders(
      "text/plain; charset=utf-8",
      `${id}.${match[3]}`,
    ),
  });
}

export async function routeGalleryRequest(
  request: Request,
  env: GalleryEnv & PreviewAcceptanceEnv,
  runtime: GalleryRouteRuntime = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const directResource = await directGalleryResource(request, env, runtime);
  if (directResource) return directResource;
  if (request.method === "GET" && url.pathname === "/robots.txt") {
    return new Response(
      `User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/sitemap.xml" || url.pathname === "/llms.txt")
  ) {
    const catalog = await publicGalleryCatalog(env);
    if (!catalog) return new Response("Gallery unavailable\n", { status: 503 });
    if (url.pathname === "/sitemap.xml") {
      const locations = [
        url.origin,
        ...catalog.entries.map(
          (entry) => `${url.origin}/g/${encodeURIComponent(entry.id)}`,
        ),
      ];
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map((location) => `<url><loc>${escapeHtml(location)}</loc></url>`).join("")}</urlset>\n`,
        {
          headers: {
            "cache-control": "public, max-age=300",
            "content-type": "application/xml; charset=utf-8",
          },
        },
      );
    }
    return new Response(
      `# Analog Canvas\n\nPublic analog-circuit Gallery. No account or private Canvas connection is required to read public pages and resources.\n\n- Gallery: ${url.origin}/\n- Public circuits: ${catalog.total}\n- Netlistable circuits: ${catalog.netlistable}\n- Search: ${url.origin}/?q=ota\n- Filter by tag: ${url.origin}/?tags=bandgap\n- Circuit page: ${url.origin}/g/{id}\n- Project Code: ${url.origin}/g/{id}/project.icproj.json\n- SPICE: ${url.origin}/g/{id}/netlist.sp\n- Spectre: ${url.origin}/g/{id}/netlist.scs\n- Complete URL index: ${url.origin}/sitemap.xml\n\nPrivate Projects and all edits require an explicitly authorized Editor connection.\n`,
      {
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": "text/plain; charset=utf-8",
        },
      },
    );
  }
  if (url.pathname === "/api/projects") {
    if (request.method === "GET" || request.method === "POST") {
      return handleCloudProjects(request, env, null);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (url.pathname.startsWith("/api/projects/")) {
    const projectId = url.pathname.slice("/api/projects/".length);
    const historyMatch =
      /^([^/]+)\/versions(?:\/([^/]+)\/(project|preview\.svg|restore))?$/u.exec(
        projectId,
      );
    if (
      historyMatch &&
      (request.method === "GET" ||
        (request.method === "POST" && historyMatch[3] === "restore"))
    )
      return handleCloudProjectHistory(
        request,
        env,
        historyMatch[1]!,
        historyMatch[2] ? decodeURIComponent(historyMatch[2]) : undefined,
        historyMatch[3],
      );
    const previewMatch = /^([^/]+)\/preview\.svg$/u.exec(projectId);
    if (previewMatch && request.method === "GET") {
      return handleCloudProjectPreview(request, env, previewMatch[1]!);
    }
    if (
      (request.method === "GET" ||
        request.method === "PUT" ||
        request.method === "PATCH" ||
        request.method === "DELETE") &&
      projectId.length > 0
    ) {
      return handleCloudProjects(request, env, projectId);
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
    if (url.searchParams.get("attention") === "1" && !viewer)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const { payload } = await callGallery(env, "list", {
      isAdmin: viewer?.isAdmin === true,
      attention: url.searchParams.get("attention") === "1",
      viewerId: viewer?.id ?? "",
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      author: url.searchParams.get("author"),
      ownerUserId: url.searchParams.get("owner"),
      tags: (url.searchParams.get("tags") ?? "")
        .split(",")
        .filter((tag) => tag.length > 0),
      // Two marks the reader can narrow by. "Liked" is answered against the
      // session, so signed out it selects nothing rather than everything.
      netlistable: url.searchParams.get("netlistable") === "1",
      liked: url.searchParams.get("liked") === "1",
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
    segments[1] === "automated-backup"
  ) {
    // A dedicated credential authorizes this GET only: never admin writes,
    // unbounded dumps, or private Cloud Projects. Do not add it to isAdmin.
    const expected = env.GALLERY_BACKUP_TOKEN;
    const supplied = request.headers
      .get("Authorization")
      ?.replace(/^Bearer /, "");
    let difference = 0;
    if (expected && supplied?.length === expected.length) {
      for (let i = 0; i < expected.length; i++)
        difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    } else difference = 1;
    if (difference !== 0)
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    if (request.method !== "GET")
      return Response.json(
        { error: "method-not-allowed" },
        { status: 405, headers: { Allow: "GET", "cache-control": "no-store" } },
      );
    const table = url.searchParams.get("table");
    if (
      ![
        "inventory",
        "galleryEntries",
        "galleryEntryVersions",
        "galleryLikes",
      ].includes(table ?? "")
    )
      return Response.json({ error: "invalid-table" }, { status: 400 });
    const { status, payload } = await callGallery(env, "schema-backup", {
      scope: "gallery",
      table,
      after: url.searchParams.get("after"),
    });
    return Response.json(payload, {
      status,
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
    const { status, payload } = await callGallery(env, "schema-backup", {
      table: url.searchParams.get("table"),
      after: url.searchParams.get("after"),
    });
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
    segments[1] === "project-format" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request))
      return Response.json({ error: "forbidden" }, { status: 403 });
    if (!(await isAdmin(request, env)))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ error: "invalid-request" }, { status: 400 });
    const { status, payload } = await callGallery(
      env,
      "gallery-project-format",
      body,
    );
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
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
    segments[1] === "netlist-badges" &&
    request.method === "POST"
  ) {
    if (!(await isAdmin(request, env))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      after?: unknown;
      limit?: unknown;
    } | null;
    const { status, payload } = await refreshNetlistMarks(
      env,
      Number.isFinite(Number(body?.limit)) ? Number(body!.limit) : undefined,
    );
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
    const { payload } = await callGallery(env, "tags", {
      netlistable: url.searchParams.get("netlistable") === "1",
    });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (
    segments.length === 1 &&
    segments[0] === "authors" &&
    request.method === "GET"
  ) {
    const { payload } = await callGallery(env, "authors", {});
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
    segments[3] === "project" &&
    request.method === "GET"
  ) {
    const headers = { "cache-control": "no-store" };
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found || (!access.reviewer && !access.owner)) {
      return Response.json({ error: "not-found" }, { status: 404, headers });
    }
    const { status, payload } = await callGallery<{ projectText?: string }>(
      env,
      "version",
      { entryId: segments[0], versionId: segments[2] },
    );
    if (status !== 200 || !payload.projectText) {
      return Response.json({ error: "not-found" }, { status: 404, headers });
    }
    return Response.json({ projectText: payload.projectText }, { headers });
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
    const { status, payload } = await callGallery<{
      svgText?: string;
      projectText?: string;
    }>(env, "version", { entryId: segments[0], versionId: segments[2] });
    if (status !== 200 || !payload.svgText) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    return new Response(
      await recoverFormulaPreview(payload.svgText, payload.projectText),
      {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    );
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
    const requestedRevision = url.searchParams.get("v");
    const previewCache =
      request.method === "GET" && requestedRevision
        ? runtime.previewCache === undefined
          ? defaultPreviewCache()
          : runtime.previewCache
        : null;
    const cached = await matchPreviewCache(previewCache, request);
    if (cached && !formulaPreviewNeedsRefresh(await cached.clone().text())) {
      // A content URL stays immutable, but publication status does not. Check
      // the tiny access row before serving an edge hit so recycle/reject/delete
      // and a newer current revision retain exactly their existing behavior.
      const access = await callGallery<{
        status?: string;
        previewRevision?: string;
      }>(env, "preview-access", { id: segments[0] });
      if (
        access.status === 200 &&
        access.payload.status === "public" &&
        access.payload.previewRevision === requestedRevision
      ) {
        return cached;
      }
    }
    const { status, payload } = await callGallery<{
      status?: string;
      ownerUserId?: string | null;
      previewRevision?: string;
      svgText?: string;
      projectText?: string;
    }>(env, "preview", { id: segments[0] });
    if (status !== 200 || !payload.svgText) {
      return Response.json(
        { error: "not-found" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    if (payload.status === "public") {
      // A matching revision URL names immutable bytes. Old and unversioned
      // clients still receive the current image, but it is never stored under
      // a mutable or incorrect cache key.
      const currentRevision = payload.previewRevision;
      const immutable =
        typeof currentRevision === "string" &&
        requestedRevision === String(currentRevision);
      const response = new Response(
        await recoverFormulaPreview(payload.svgText, payload.projectText),
        {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": immutable
              ? "public, max-age=31536000, immutable"
              : "no-store",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'",
          },
        },
      );
      if (immutable) {
        await storePreviewCache(previewCache, request, response.clone());
      }
      return response;
    }
    const allowed =
      (await canReview(request, env)) ||
      (payload.ownerUserId != null &&
        (await sessionUserOf(request, env))?.id === payload.ownerUserId);
    if (!allowed) {
      return Response.json(
        { error: "not-found" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    return new Response(
      await recoverFormulaPreview(payload.svgText, payload.projectText),
      {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    );
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
    const viewer = await sessionUserOf(request, env);
    if (
      payload.entry &&
      !viewer?.isAdmin &&
      (!viewer || viewer.id !== payload.ownerUserId)
    ) {
      delete payload.entry.attention;
      delete payload.entry.assessedPreviewRevision;
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
  if (
    segments.length === 2 &&
    segments[1] === "curation" &&
    request.method === "PATCH"
  ) {
    if (!sameOrigin(request))
      return Response.json({ error: "forbidden" }, { status: 403 });
    const user = await sessionUserOf(request, env);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const access = await entryManager(request, env, segments[0]!);
    if (!access.found)
      return Response.json({ error: "not-found" }, { status: 404 });
    if (!user.isAdmin && !access.owner)
      return Response.json({ error: "forbidden" }, { status: 403 });
    const text = await request.text();
    if (text.length > 16000)
      return Response.json({ error: "too-large" }, { status: 413 });
    let body: Record<string, unknown> | null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (
      !body ||
      !validGalleryAttention(body.attention) ||
      !Array.isArray(body.tags) ||
      body.tags.length > 12 ||
      body.tags.some((tag) => typeof tag !== "string" || tag.length > 32) ||
      typeof body.expectedPreviewRevision !== "string" ||
      !Number.isSafeInteger(body.expectedCurationRevision) ||
      Number(body.expectedCurationRevision) < 0
    ) {
      return Response.json({ error: "invalid-curation" }, { status: 400 });
    }
    const { status, payload } = await callGallery(env, "curate", {
      ...body,
      id: segments[0],
      userId: user.id,
      at: new Date().toISOString(),
    });
    return Response.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    });
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
  if (
    segments.length === 2 &&
    segments[0] === "duplicates" &&
    segments[1] === "recycle" &&
    request.method === "POST"
  ) {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const reviewer = await sessionUserOf(request, env);
    if (!reviewer?.isAdmin) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const text = await request.text();
    if (text.length > 32_768) {
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    }
    const { status, payload } = await callGallery(env, "recycle-duplicates", {
      keep: body?.keep,
      remove: body?.remove,
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
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // An author owns their own work: removing it is theirs to do, not a
    // favour to ask a curator for. The daily quota counts entries that still
    // exist, so deleting gives the allowance back — that is the point.
    const admin = await isAdmin(request, env);
    if (!admin) {
      const access = await entryManager(request, env, segments[0]!);
      if (!access.found) {
        return Response.json({ error: "not-found" }, { status: 404 });
      }
      if (!access.owner) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
    }
    const { status, payload } = await callGallery(env, "delete", {
      id: segments[0],
      // The curator's bin keeps its withdraw-then-empty step; an author
      // removing their own entry does it in one.
      requireRecycled: admin,
    });
    return Response.json(payload, { status });
  }
  return Response.json({ error: "not-found" }, { status: 404 });
}
