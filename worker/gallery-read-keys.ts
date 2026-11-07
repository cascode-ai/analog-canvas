// Read keys (docs/specs/community-gallery.md#reader-access): the Owner's
// revocable bearers that read the Gallery as a signed-in reader does, without
// a session, until its reads are public. They never write.

import {
  READ_KEY_PREFIX,
  type AuthEnv,
  type GalleryReadKey,
  type SessionUser,
} from "./auth";

/** How long an isolate trusts a key's answer; a revocation holds within it. */
const REMEMBER_MS = 60_000;
const REMEMBERED_MAX = 256;

/** Each bearer's last answer, and the reads made on it since then. */
const remembered = new Map<
  string,
  { expires: number; key: GalleryReadKey | null; pending: number }
>();
const perRequest = new WeakMap<Request, Promise<GalleryReadKey | null>>();

/**
 * The live read key in `Authorization: Bearer acrk_…`, or null for no bearer,
 * an unknown, revoked or expired key, or any failure. One answer per request;
 * the AuthDO is asked at most once a minute per key and isolate, and then
 * counts the reads made since.
 */
export function galleryReadKeyOf(
  request: Request,
  env: Partial<Pick<AuthEnv, "AUTH">>,
): Promise<GalleryReadKey | null> {
  let found = perRequest.get(request);
  if (!found) {
    found = resolve(request, env);
    perRequest.set(request, found);
  }
  return found;
}

async function resolve(
  request: Request,
  env: Partial<Pick<AuthEnv, "AUTH">>,
): Promise<GalleryReadKey | null> {
  // Only a read key's prefix is worth waking the AuthDO for.
  const authorization = request.headers.get("Authorization") ?? "";
  if (!env.AUTH || !authorization.startsWith(`Bearer ${READ_KEY_PREFIX}`))
    return null;
  const now = Date.now();
  const memo = remembered.get(authorization);
  if (memo && memo.expires > now) {
    memo.pending += 1;
    return memo.key && Date.parse(memo.key.expiresAt) > now ? memo.key : null;
  }
  try {
    const response = await env.AUTH.getByName("auth").fetch(
      "https://auth/internal/read-key",
      {
        headers: {
          authorization,
          "x-read-key-uses": String((memo?.pending ?? 0) + 1),
        },
      },
    );
    if (!response.ok) return null;
    const key =
      ((await response.json()) as { key?: GalleryReadKey | null }).key ?? null;
    remembered.delete(authorization);
    if (remembered.size >= REMEMBERED_MAX)
      remembered.delete(remembered.keys().next().value!);
    remembered.set(authorization, {
      expires: now + REMEMBER_MS,
      key,
      pending: 0,
    });
    return key;
  } catch {
    return null;
  }
}

/**
 * A `full` key's reader on the review routes: it sees every verdict, as the
 * Owner does, and is never a reviewer itself. Reads only.
 */
export function readKeyReviewer(key: GalleryReadKey): SessionUser {
  return {
    id: `read-key:${key.id}`,
    displayName: key.label,
    email: null,
    provider: "read-key",
    role: "user",
    isAdmin: false,
    isOwner: true,
  };
}
