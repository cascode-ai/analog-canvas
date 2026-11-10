import { bearerMatches } from "./bearer";
import { SITE_USAGE_NOTE } from "../apps/editor/src/usage-policy-note";

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
 * Gallery GET/HEAD reads have no request-rate cap. Other /api requests use
 * the binding's flood allowance; route-level authentication and write limits
 * apply independently. Owner jobs, local requests without a client address
 * and the forwarded Arena API are exempt. A failing limiter lets reads and
 * writes through.
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
    pathname.startsWith("/api/arena/") ||
    ((request.method === "GET" || request.method === "HEAD") &&
      (pathname === "/api/gallery" || pathname.startsWith("/api/gallery/")))
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
      usage: SITE_USAGE_NOTE,
    },
    {
      status: 429,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    },
  );
}
