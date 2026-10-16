import { bearerMatches } from "./bearer";
import { BULK_ACCESS_NOTE } from "./usage-policy";

/** Cloudflare's Workers rate limiting binding (`ratelimits` in wrangler.jsonc). */
type RateLimiterLike = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type ApiRateLimitEnv = {
  API_RATE_LIMITER?: RateLimiterLike;
  GALLERY_BACKUP_TOKEN?: string;
  STORE_BACKUP_TOKEN?: string;
  SIMULATION_SMOKE_TOKEN?: string;
};

/**
 * Refuses an /api request once its client address passes the binding's
 * allowance (wrangler.jsonc). This is flood protection, not a quota: the
 * Gallery's daily opens and the simulation queue limits stay the per-account
 * bounds, and its `too-many-requests` is not their daily `429`. Not counted:
 * the Owner's own jobs, which carry a store or smoke credential; a request
 * with no client address (local runs); AnalogArena's /api/arena, which is
 * forwarded and answered unchanged (docs/specs/analog-arena.md). A limiter
 * that fails lets the request through.
 */
export async function refuseApiFlood(
  request: Request,
  env: ApiRateLimitEnv,
): Promise<Response | null> {
  const limiter = env.API_RATE_LIMITER;
  const { pathname } = new URL(request.url);
  if (
    !limiter ||
    !pathname.startsWith("/api/") ||
    pathname.startsWith("/api/arena/")
  )
    return null;
  const address = request.headers.get("cf-connecting-ip");
  if (!address) return null;
  const ownerJob = [
    env.GALLERY_BACKUP_TOKEN,
    env.STORE_BACKUP_TOKEN,
    env.SIMULATION_SMOKE_TOKEN,
  ].some((token) => bearerMatches(request, token));
  if (ownerJob) return null;
  const allowed = await limiter
    .limit({ key: address })
    .then(({ success }) => success)
    .catch(() => true);
  if (allowed) return null;
  return Response.json(
    {
      error: "too-many-requests",
      retryAfterSeconds: 60,
      usage: BULK_ACCESS_NOTE,
    },
    {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    },
  );
}
