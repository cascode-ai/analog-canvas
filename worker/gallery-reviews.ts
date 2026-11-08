// Reviews over HTTP. Any signed-in account reviews an entry's current
// version; the Owner reads every review, the open issues and the disputes,
// and resolves issues. A dataset's entries take reviews though their store
// takes no other write.
//
//   GET  /api/gallery/review/<scope>/queue   what to review, in order
//   GET  /api/gallery/review/<scope>/people  each reviewer's totals
//   GET  /api/gallery/review/<scope>/issues  Owner: open issues, disputes
//   GET  /api/gallery/<id>/reviews           blind until one's own review
//   POST /api/gallery/<id>/reviews           {revision, verdict, flags, note, marks}
//   PATCH /api/gallery/<id>/reviews/<review> Owner: {resolved: true}

import type { SessionUser } from "./auth-do";
import { withGalleryStore } from "./gallery-datasets";
import { callGallery } from "./gallery-requests";
import {
  gallerySourceByKey,
  gallerySourceOfEntryId,
  type GallerySource,
} from "./gallery-sources";
import type { GalleryEnv } from "./gallery-store";
import { sameOrigin } from "./same-origin";

const NO_STORE = { "cache-control": "no-store" };

function storeOf(env: GalleryEnv, source: GallerySource | null): GalleryEnv {
  return source ? withGalleryStore(env, source) : env;
}

function answer(status: number, payload: unknown): Response {
  return Response.json(payload, { status, headers: NO_STORE });
}

/** The review routes, or null when the request is for another route. */
export async function routeReviews(
  request: Request,
  env: GalleryEnv,
  segments: string[],
  readSession: () => Promise<SessionUser | null>,
): Promise<Response | null> {
  const scoped = segments[0] === "review";
  const onEntry = segments[1] === "reviews" && !scoped;
  if (!scoped && !onEntry) return null;
  const writes = request.method !== "GET" && request.method !== "HEAD";
  const viewer = await readSession();
  if (!viewer) return answer(401, { error: "sign-in-required" });
  if (writes && !sameOrigin(request))
    return answer(403, { error: "forbidden" });

  if (scoped) {
    const scope = segments[1] ?? "";
    const source = scope === "community" ? null : gallerySourceByKey(scope);
    if ((scope !== "community" && !source) || segments.length !== 3 || writes)
      return answer(404, { error: "not-found" });
    const operation = {
      queue: "review-queue",
      people: "review-people",
      issues: "review-issues",
    }[segments[2]!];
    if (!operation) return answer(404, { error: "not-found" });
    if (operation === "review-issues" && !viewer.isOwner)
      return answer(403, { error: "owner-only" });
    const { status, payload } = await callGallery(
      storeOf(env, source),
      operation,
      { reviewerId: viewer.id, compared: source?.comparisons === true },
    );
    return answer(status, payload);
  }

  const entryId = segments[0]!;
  const store = storeOf(env, gallerySourceOfEntryId(entryId));
  if (segments.length === 2 && request.method === "GET") {
    const { status, payload } = await callGallery(store, "review-entry", {
      entryId,
      viewerId: viewer.id,
      viewerIsOwner: viewer.isOwner === true,
    });
    return answer(status, payload);
  }
  if (segments.length === 2 && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const { status, payload } = await callGallery(store, "review-submit", {
      entryId,
      revision: body?.revision,
      verdict: body?.verdict,
      flags: body?.flags,
      note: body?.note,
      marks: body?.marks,
      reviewerId: viewer.id,
      reviewerName: viewer.displayName,
      day: new Date().toISOString().slice(0, 10),
    });
    return answer(status, payload);
  }
  if (segments.length === 3 && request.method === "PATCH") {
    if (!viewer.isOwner) return answer(403, { error: "owner-only" });
    const body = (await request.json().catch(() => null)) as {
      resolved?: unknown;
    } | null;
    if (body?.resolved !== true)
      return answer(400, { error: "invalid-fields" });
    const { status, payload } = await callGallery(store, "review-resolve", {
      entryId,
      reviewId: segments[2],
      resolvedBy: viewer.displayName,
    });
    return answer(status, payload);
  }
  return answer(404, { error: "not-found" });
}
