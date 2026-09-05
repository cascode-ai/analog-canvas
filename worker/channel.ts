/**
 * Which release channel this deployment is, and what that changes.
 *
 * Two channels exist (ADR 0057): the public site and a preview that every
 * merge to main deploys. They are one build, told apart by `ICM_CHANNEL`.
 * Production leaves it unset, so every check below is free there and the
 * preview rules cannot reach the public site by accident.
 */
export type ReleaseChannel = "production" | "preview";

export interface ChannelEnv {
  /** "preview" on the preview Worker; production leaves it unset. */
  ICM_CHANNEL?: string;
  /**
   * The public site's origin, set only on the preview: gallery reads are
   * fetched from there over HTTP, so the preview can do to real data exactly
   * what an anonymous visitor can, and nothing more.
   */
  ICM_GALLERY_UPSTREAM?: string;
}

export function releaseChannel(env: ChannelEnv): ReleaseChannel {
  return env.ICM_CHANNEL === "preview" ? "preview" : "production";
}

/** What the editor asks at boot so it can show the preview banner. */
export function channelResponse(env: ChannelEnv): Response {
  return Response.json(
    { channel: releaseChannel(env) },
    { headers: { "cache-control": "no-store" } },
  );
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The preview reads the production gallery live and must never write to it.
 * Every path whose writes would reach the shared store is refused here,
 * before any route handler runs, so no handler can forget.
 */
export function previewWriteRefusal(
  request: Request,
  env: ChannelEnv,
): Response | null {
  if (releaseChannel(env) !== "preview") return null;
  if (READ_METHODS.has(request.method)) return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/gallery") && !path.startsWith("/api/projects")) {
    return null;
  }
  return Response.json(
    {
      error: "preview-read-only",
      message:
        "The preview build reads the gallery but never writes to it. Publish, like, moderate, and save Cloud Projects on the production site.",
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Serve a gallery read on the preview from the public site's own API.
 *
 * A Durable Object binding to the production script would have been simpler
 * and would have handed unreleased code a namespace with no read-only mode.
 * Fetching the public API instead is read-only by construction: the request
 * carries no cookie, so it is an anonymous visitor's view, and every write
 * has already been refused by `previewWriteRefusal` before this runs.
 */
export async function previewGalleryReadThrough(
  request: Request,
  env: ChannelEnv,
  fetchLike: typeof fetch = fetch,
): Promise<Response | null> {
  if (releaseChannel(env) !== "preview") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/gallery")) return null;
  const upstream = env.ICM_GALLERY_UPSTREAM;
  if (!upstream) {
    return Response.json(
      {
        error: "preview-gallery-unconfigured",
        message: "This preview has no gallery upstream configured.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const target = new URL(url.pathname + url.search, upstream);
  let response: Response;
  try {
    response = await fetchLike(target.toString(), {
      method: request.method,
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "manual",
    });
  } catch (error) {
    return Response.json(
      {
        error: "preview-gallery-unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

/** A preview is public but not for finding: nothing on it is listed. */
export function previewRobotsResponse(): Response {
  return new Response("User-agent: *\nDisallow: /\n", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Stamp every preview response so nothing on it is indexed, followed, or
 * archived. Asset-layer responses arrive with immutable headers, so the
 * response is rebuilt rather than mutated.
 */
export function markPreviewResponse(
  response: Response,
  env: ChannelEnv,
): Response {
  if (releaseChannel(env) !== "preview") return response;
  // A 101 response transfers a live WebSocket, not an indexable document.
  // Rebuilding it as an ordinary HTTP response drops workerd's webSocket
  // attachment and turns a successful Agent handshake into HTTP 500.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
