// Reference images over HTTP: /api/gallery/<id>/reference. A community
// entry's owner or the Owner puts or deletes one, confirming they may share
// it; signed-in readers read it. A dataset's entries take none: their
// original figures are comparisons.

import type { SessionUser } from "./auth-do";
import { callGallery } from "./gallery-requests";
import { gallerySourceOfEntryId } from "./gallery-sources";
import type { GalleryEnv } from "./gallery-store";
import { sameOrigin } from "./same-origin";

const NO_STORE = { "cache-control": "no-store" };

export async function routeReference(
  request: Request,
  env: GalleryEnv,
  segments: string[],
  readSession: () => Promise<SessionUser | null>,
): Promise<Response | null> {
  if (segments.length !== 2 || segments[1] !== "reference") return null;
  const entryId = segments[0]!;
  if (gallerySourceOfEntryId(entryId))
    return Response.json({ error: "not-found" }, { status: 404 });
  const viewer = await readSession();
  if (!viewer)
    return Response.json(
      { error: "sign-in-required" },
      { status: 401, headers: NO_STORE },
    );
  if (request.method === "GET") {
    const { status, payload } = await callGallery<{
      type?: string;
      data?: string;
      revision?: string;
    }>(env, "reference-read", { entryId });
    if (status !== 200 || !payload.data)
      return Response.json(
        { error: "not-found" },
        { status: 404, headers: NO_STORE },
      );
    const named = new URL(request.url).searchParams.get("v");
    return new Response(
      Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0)),
      {
        headers: {
          "content-type": payload.type ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
          "cache-control":
            named === payload.revision
              ? "private, max-age=31536000, immutable"
              : "private, no-cache",
          etag: `"${payload.revision}"`,
        },
      },
    );
  }
  if (request.method !== "PUT" && request.method !== "DELETE")
    return Response.json({ error: "not-found" }, { status: 404 });
  if (!sameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const who = {
    entryId,
    uploaderId: viewer.id,
    uploaderIsOwner: viewer.isOwner === true,
  };
  if (request.method === "DELETE") {
    const { status, payload } = await callGallery(env, "reference-delete", who);
    return Response.json(payload, { status, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as {
    image?: unknown;
    rights?: unknown;
  } | null;
  const { status, payload } = await callGallery(env, "reference-set", {
    ...who,
    image: body?.image,
    rights: body?.rights,
  });
  return Response.json(payload, { status, headers: NO_STORE });
}
