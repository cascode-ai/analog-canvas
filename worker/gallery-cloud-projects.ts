// Private Cloud Projects over HTTP: save, open, list, favorite, delete,
// save history and shelf thumbnails.

import { formulaPreviewNeedsRefresh } from "./gallery-preview";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { type CircuitProject } from "@icm/model";
import { sessionUserOf } from "./auth";
import { sameOrigin } from "./same-origin";
import {
  GALLERY_MAX_NAME_LENGTH,
  GALLERY_MAX_PROJECT_BYTES,
  shortId,
  type GalleryEnv,
} from "./gallery-store";
import {
  callGallery,
  fieldText,
  recoverFormulaPreview,
  renderPreview,
} from "./gallery-requests";

/** Private, stable Cloud Projects. Save updates a bound Project in place. */
async function handleCloudProjects(
  request: Request,
  env: GalleryEnv,
  projectId: string | null,
): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const user = await sessionUserOf(request, env);
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
  env: GalleryEnv,
  projectId: string,
  versionId?: string,
  action?: string,
): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const user = await sessionUserOf(request, env);
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
  env: GalleryEnv,
  projectId: string,
): Promise<Response> {
  const user = await sessionUserOf(request, env);
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

/** `/api/projects*`: an account's private Cloud Projects. */
export async function routeCloudProjects(
  request: Request,
  env: GalleryEnv,
  url: URL,
): Promise<Response | null> {
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
  return null;
}
