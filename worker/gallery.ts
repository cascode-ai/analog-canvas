// Public Gallery HTTP entry: `routeGalleryRequest` authenticates and maps API
// requests. It serves the wall, entries, previews, likes and moderation here
// and hands the rest to the route modules: gallery-publishing,
// gallery-cloud-projects, gallery-maintenance, gallery-datasets and
// gallery-documents, with shared helpers in gallery-requests. Durable storage
// is `GalleryDO` (gallery-do.ts); its operations live in gallery-store*.ts.

import { formulaPreviewNeedsRefresh } from "./gallery-preview";
import { validGalleryAttention } from "./gallery-curation";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { type CircuitProject } from "@icm/model";
import { AI_ACCOUNT_PROVIDER, sessionUserOf, type SessionUser } from "./auth";
import { gallerySourceByKey, gallerySourceOfEntryId } from "./gallery-sources";
import { sameOrigin } from "./same-origin";
import {
  GALLERY_DAILY_OPEN_LIMIT,
  GALLERY_MAX_REJECT_REASON_LENGTH,
  type GalleryEntrySummary,
  type GalleryEnv,
} from "./gallery-store";
import {
  PUBLIC_GALLERY_DOCUMENTS_ENABLED,
  escapeHtml,
  publicGalleryCatalog,
  publicGalleryEntry,
} from "./gallery-documents";
import {
  callGallery,
  canReview,
  entryManager,
  fieldText,
  hasGalleryReadToken,
  hasStoreBackupToken,
  isAdmin,
  isAutomatedBackup,
  readsAsOwner,
  readsTestbench,
  recoverFormulaPreview,
} from "./gallery-requests";
import { withTestbench, withoutTestbench } from "./gallery-testbench";
import {
  gallerySourceCounts,
  handleSourceImport,
  withGalleryStore,
} from "./gallery-datasets";
import {
  handleEntryUpdate,
  handleSubmission,
  routeGalleryPublishing,
} from "./gallery-publishing";
import { routeCloudProjects } from "./gallery-cloud-projects";
import { routeGalleryMaintenance } from "./gallery-maintenance";
import {
  gateSimulationMarks,
  routeSimulationChecks,
  simulationMarkOf,
  simulationMarkPublic,
} from "./gallery-simulation-checks";
import type { SimulationCheck } from "./gallery-store-simulation-checks";

export * from "./gallery-do";

/** The day's opens are spent; they come back at the next UTC midnight. */
function dailyOpenLimitResponse(day: string): Response {
  const resetAt = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
  return Response.json(
    {
      error: "daily-open-limit",
      limit: GALLERY_DAILY_OPEN_LIMIT,
      resetAt: resetAt.toISOString(),
    },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(
          Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
        ),
      },
    },
  );
}

export interface GalleryPreviewCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface GalleryRouteRuntime {
  /** Injectable in tests; production falls back to Cloudflare's default cache. */
  previewCache?: GalleryPreviewCache | null;
  /** Injectable in tests; production reads config/gallery-sim.json. */
  simulationMarkPublicFrom?: string | null;
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

/**
 * Who may read the Community Gallery: a signed-in account. Remembered per
 * session cookie for a minute in this isolate, so a wall of previews asks the
 * AuthDO once rather than once per image.
 */
const galleryReaders = new Map<
  string,
  { expires: number; user: SessionUser }
>();
async function galleryReaderOf(
  request: Request,
  env: GalleryEnv,
): Promise<SessionUser | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const now = Date.now();
  const remembered = galleryReaders.get(cookie);
  if (remembered && remembered.expires > now) return remembered.user;
  const user = await sessionUserOf(request, env);
  if (user) {
    if (galleryReaders.size >= 256)
      galleryReaders.delete(galleryReaders.keys().next().value!);
    galleryReaders.set(cookie, { expires: now + 60_000, user });
  }
  return user;
}

/** A reader's copy of a cacheable response: a browser may keep it, a shared cache may not. */
function readerCopy(response: Response): Response {
  const headers = new Headers(response.headers);
  const policy = headers.get("cache-control");
  if (policy?.startsWith("public"))
    headers.set("cache-control", policy.replace(/^public/u, "private"));
  return new Response(response.body, { status: response.status, headers });
}

/**
 * All `/api/gallery*` routing. Returns null for unrelated paths so the
 * worker entry keeps its ordinary dispatch.
 */

/** The part-count sizes a wall request names (`parts=0-5,6-10`). */
function requestedParts(url: URL): string[] {
  return (url.searchParams.get("parts") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .slice(0, 16);
}

/**
 * The filters a wall request names, read once for the wall and the tag counts
 * beside it, so every filter the wall gains narrows those counts too.
 */
function wallFilters(url: URL) {
  return {
    author: url.searchParams.get("author"),
    ownerUserId: url.searchParams.get("owner"),
    attention: url.searchParams.get("attention") === "1",
    attentionKind: url.searchParams.get("reason"),
    // Two marks the reader can narrow by. "Liked" is answered against the
    // session, so signed out it selects nothing rather than everything.
    netlistable: url.searchParams.get("netlistable") === "1",
    withoutNetlist: url.searchParams.get("netlistable") === "0",
    // The AI mark: only AI-generated circuits, or only those made by hand.
    ai:
      url.searchParams.get("ai") === "1"
        ? "ai"
        : url.searchParams.get("ai") === "0"
          ? "human"
          : null,
    liked: url.searchParams.get("liked") === "1",
    // Sizes by part count; several mean any of them.
    parts: requestedParts(url),
    // Words over names, bylines, descriptions and tags.
    q: url.searchParams.get("q"),
  };
}

/** Drop the record of earlier days' opens; only today's is ever needed. */
/** How many of the wall's first circuits a signed-out visitor sees, dimmed. */
export const SIGNED_OUT_WALL_SIZE = 12;

/**
 * The wall's first circuits as a signed-out visitor sees them: the newest
 * public ones of the unfiltered wall, as many as SIGNED_OUT_WALL_SIZE, and
 * never a next page or a count (docs/specs/community-gallery.md#reader-access).
 */
async function signedOutWallEntries(
  env: GalleryEnv,
): Promise<Pick<GalleryEntrySummary, "id" | "name" | "previewRevision">[]> {
  const { payload } = await callGallery<{ entries?: GalleryEntrySummary[] }>(
    env,
    "list",
    {
      ...wallFilters(new URL("https://gallery.invalid/")),
      isAdmin: false,
      viewerId: "",
      limit: String(SIGNED_OUT_WALL_SIZE),
      cursor: null,
      tags: [],
    },
  );
  // Only what the dimmed tile draws: no byline, description, tags or counts.
  return (payload.entries ?? [])
    .slice(0, SIGNED_OUT_WALL_SIZE)
    .map(({ id, name, previewRevision }) => ({ id, name, previewRevision }));
}

export async function forgetEarlierOpens(env: GalleryEnv): Promise<void> {
  await callGallery(env, "forget-opens", {
    day: new Date().toISOString().slice(0, 10),
  });
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
  if (!PUBLIC_GALLERY_DOCUMENTS_ENABLED) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
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
  env: GalleryEnv,
  runtime: GalleryRouteRuntime = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const directResource = await directGalleryResource(request, env, runtime);
  if (directResource) return directResource;
  if (request.method === "GET" && url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /g/\n", {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/sitemap.xml" || url.pathname === "/llms.txt")
  ) {
    if (!PUBLIC_GALLERY_DOCUMENTS_ENABLED) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
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
  const cloudProjects = await routeCloudProjects(request, env, url);
  if (cloudProjects) return cloudProjects;
  if (!url.pathname.startsWith("/api/gallery")) return null;
  const segments = url.pathname.split("/").filter(Boolean).slice(2);
  // The Community Gallery is for signed-in readers. Without a session or the
  // read-only Gallery credential every read asks to sign in: the list and its
  // search, an entry, its Project and its preview alike. The one exception is
  // the wall's first twelve circuits, which a signed-out visitor sees dimmed
  // and closed: the unfiltered first page, cut to them, and their previews.
  // Writes keep their own, stricter checks.
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    !hasGalleryReadToken(request, env) &&
    !(isAutomatedBackup(segments) && hasStoreBackupToken(request, env)) &&
    !(await galleryReaderOf(request, env))
  ) {
    if (
      segments.length === 0 &&
      request.method === "GET" &&
      url.search === ""
    ) {
      return Response.json(
        {
          entries: await signedOutWallEntries(env),
          nextCursor: null,
          signedOut: true,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const firstTwelvePreview =
      segments.length === 2 &&
      segments[1] === "preview.svg" &&
      (await signedOutWallEntries(env)).some(
        (entry) => entry.id === segments[0],
      );
    if (!firstTwelvePreview)
      return Response.json(
        { error: "sign-in-required" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
  }

  // Reference datasets (#1510). Each lives in a store of its own: a request
  // reaches it by the import route, its entry's id, or the wall's `source`.
  // Nothing writes there but the Owner's import.
  if (segments[0] === "sources") {
    if (segments.length === 1 && request.method === "GET")
      return Response.json(
        { sources: await gallerySourceCounts(env) },
        { headers: { "cache-control": "no-store" } },
      );
    const named = gallerySourceByKey(segments[1]);
    if (
      named &&
      segments.length === 3 &&
      segments[2] === "entries" &&
      request.method === "POST"
    )
      return handleSourceImport(request, env, named);
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const source =
    (segments[0] ? gallerySourceOfEntryId(segments[0]) : null) ??
    gallerySourceByKey(url.searchParams.get("source"));
  if (source) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return Response.json({ error: "dataset-read-only" }, { status: 403 });
    env = withGalleryStore(env, source);
  }

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
    const filters = wallFilters(url);
    if (filters.attention && !viewer)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const { payload } = await callGallery<{
      entries: GalleryEntrySummary[];
    }>(env, "list", {
      ...filters,
      isAdmin: viewer?.isAdmin === true,
      viewerId: viewer?.id ?? "",
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      // The wall's order (#1615); without one, newest first.
      order: url.searchParams.get("order"),
      seed: url.searchParams.get("seed"),
      tags: (url.searchParams.get("tags") ?? "")
        .split(",")
        .filter((tag) => tag.length > 0),
    });
    return Response.json(
      {
        ...payload,
        entries: gateSimulationMarks(
          payload.entries,
          viewer,
          simulationMarkPublic(runtime.simulationMarkPublicFrom),
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
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
    segments[0] === "owner-data" &&
    request.method === "GET"
  ) {
    // The Owner's own accounts only, not every administrator (#1446).
    const user = await sessionUserOf(request, env);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!user.isOwner)
      return Response.json({ error: "owner-only" }, { status: 403 });
    const author = url.searchParams.get("author");
    const { payload } = await callGallery(
      env,
      "owner-data",
      author ? { author } : {},
    );
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
  const maintenance = await routeGalleryMaintenance(
    request,
    env,
    url,
    segments,
  );
  if (maintenance) return maintenance;
  const simulationChecks = await routeSimulationChecks(request, env, segments);
  if (simulationChecks) return simulationChecks;
  if (
    segments.length === 1 &&
    segments[0] === "tags" &&
    request.method === "GET"
  ) {
    // Tag counts follow every filter of the wall except its tag choice. The
    // personal two need the session; the public counts stay a plain read.
    const filters = wallFilters(url);
    const viewer =
      filters.attention || filters.liked
        ? await sessionUserOf(request, env)
        : null;
    if (filters.attention && !viewer)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const { payload } = await callGallery(env, "tags", {
      ...filters,
      isAdmin: viewer?.isAdmin === true,
      viewerId: viewer?.id ?? "",
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
  const publishing = await routeGalleryPublishing(request, env, segments);
  if (publishing) return publishing;
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
        return readerCopy(cached);
      }
    }
    const { status, payload } = await callGallery<{
      status?: string;
      ownerUserId?: string | null;
      author?: string;
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
      return readerCopy(response);
    }
    const allowed =
      (await canReview(request, env)) ||
      readsAsOwner(await sessionUserOf(request, env), payload);
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
      testbench?: string | null;
      simulationCheck?: SimulationCheck | null;
    }>(env, "any-entry", { id: segments[0] });
    if (status !== 200) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const curator = await canReview(request, env);
    const viewer = await sessionUserOf(request, env);
    const held = {
      ownerUserId: payload.ownerUserId,
      author: payload.entry?.author,
    };
    if (
      payload.status !== "public" &&
      !curator &&
      !readsAsOwner(viewer, held)
    ) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (
      payload.entry &&
      !viewer?.isAdmin &&
      (!viewer || viewer.id !== payload.ownerUserId)
    ) {
      delete payload.entry.attention;
      delete payload.entry.assessedPreviewRevision;
    }
    // `summary=1` answers the tile alone — what a link to the wall shows —
    // without the Project Code, so it costs no daily open.
    const summary = url.searchParams.get("summary") === "1";
    if (
      !summary &&
      payload.status === "public" &&
      viewer &&
      viewer.id !== payload.ownerUserId &&
      !curator &&
      viewer.provider !== AI_ACCOUNT_PROVIDER &&
      !hasGalleryReadToken(request, env)
    ) {
      // Opening someone else's circuit spends the account's daily allowance;
      // its author, curators, the Owner's AI accounts and the read
      // credential are not counted.
      const day = new Date().toISOString().slice(0, 10);
      const { payload: open } = await callGallery<{ allowed?: boolean }>(
        env,
        "count-open",
        { userId: viewer.id, entryId: segments[0], day },
      );
      if (open.allowed !== true) return dailyOpenLimitResponse(day);
    }
    return Response.json(
      {
        entry: payload.entry && {
          ...payload.entry,
          ...simulationMarkOf(
            payload.simulationCheck,
            viewer,
            held,
            simulationMarkPublic(runtime.simulationMarkPublicFrom),
          ),
        },
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
        ...(summary
          ? {}
          : {
              // Its testbench only for those who read it (#1545); anyone
              // else opens, inserts or copies the drawing without one.
              projectText: readsTestbench(viewer, held)
                ? withTestbench(payload.projectText ?? "", payload.testbench)
                : withoutTestbench(payload.projectText ?? ""),
            }),
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
    const [id = "", action] = segments;
    if (action !== "recycle" && action !== "restore") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // Admins curate anything. An ordinary owner may withdraw a public entry
    // or restore a voluntary withdrawal, but cannot undo an Owner rejection
    // or an Owner's withdrawal of it (#1540), whoever owns it since.
    const viewer = await sessionUserOf(request, env);
    const admin = viewer?.isAdmin === true;
    const access = await entryManager(request, env, id);
    if (!access.found) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!admin) {
      if (!access.owner) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const validOwnerTransition =
        action === "recycle"
          ? access.status === "public"
          : access.status === "recycled" &&
            access.rejectReason === null &&
            !access.withdrawnByCurator;
      if (!validOwnerTransition) {
        return Response.json({ error: "invalid-status" }, { status: 409 });
      }
    }
    const { status, payload } = await callGallery(env, "set-status", {
      id,
      status: action === "recycle" ? "recycled" : "public",
      at: new Date().toISOString(),
      // The Owner withdrawing someone else's entry records it as theirs; an
      // owner's own withdrawal, the Owner's included, stays voluntary.
      ...(action === "recycle" && admin && !access.owner
        ? { reviewerId: viewer.id }
        : {}),
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
