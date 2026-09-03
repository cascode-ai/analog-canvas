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
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
