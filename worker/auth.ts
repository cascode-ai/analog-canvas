export * from "./auth-do";
import {
  AUTH_SESSION_COOKIE,
  OWNER_TOKEN_PREFIX,
  type AuthEnv,
  type SessionUser,
} from "./auth-do";
import { cookie, REGIONAL_SESSION_COOKIE } from "./regional-auth-contract";

export class SessionRegionUnavailable extends Error {}

function sessionLookup(request: Request): string {
  const endpoint = "https://auth/internal/session-user";
  if (!cookie(request, REGIONAL_SESSION_COOKIE)) return endpoint;
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    request.method === "GET" &&
    path === "/api/gallery/simulation-checks" &&
    url.searchParams.get("poll") === "1"
  )
    return endpoint + "?poll";
  const write = request.method !== "GET" && request.method !== "HEAD";
  const fresh =
    request.method === "DELETE" ||
    path.startsWith("/api/admin/") ||
    /^\/api\/gallery\/(?:maintenance|owner-data|recycled|rejected|review|simulation-checks)(?:\/|$)/u.test(
      path,
    ) ||
    /^\/api\/gallery\/[^/]+\/reviews$/u.test(path) ||
    (path === "/api/components" &&
      url.searchParams.get("status") === "deleted") ||
    path === "/api/simulation/operations" ||
    (write && !/^\/api\/projects(?:\/[^/]+)?$/u.test(path));
  return endpoint + (fresh ? "?fresh" : write ? "?write" : "");
}

function hasSessionCookie(request: Request): boolean {
  return (request.headers.get("Cookie") ?? "").split(";").some((part) => {
    const cookie = part.trim();
    return [AUTH_SESSION_COOKIE, REGIONAL_SESSION_COOKIE].some(
      (name) =>
        cookie.startsWith(name + "=") && cookie.length > name.length + 1,
    );
  });
}

/**
 * Resolve the signed-in user (with the per-request admin flag) for another
 * worker module, from the incoming request's cookies. Null when the auth
 * binding is absent, the session is missing, or anything fails.
 */
export async function sessionUserOf(
  request: Request,
  env: Partial<AuthEnv>,
): Promise<SessionUser | null> {
  // An absent session cookie proves the request is anonymous. Avoid waking
  // the global AuthDO only to have it make the same observation; Gallery
  // reads are the hottest caller and otherwise serialize this unnecessary
  // cross-object round trip ahead of every public feed query.
  if (!env.AUTH || !hasSessionCookie(request)) return null;
  try {
    const response = await env.AUTH.getByName("auth").fetch(
      sessionLookup(request),
      { headers: { cookie: request.headers.get("Cookie") ?? "" } },
    );
    if (
      response.status === 503 &&
      (await response.json()).error === "session-region-unavailable"
    )
      throw new SessionRegionUnavailable();
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser | null };
    return payload.user ?? null;
  } catch (error) {
    if (error instanceof SessionRegionUnavailable) throw error;
    return null;
  }
}

/** Whether the request carries `Authorization: Bearer …`. */
export function hasBearer(request: Request): boolean {
  return /^Bearer \S/u.test(request.headers.get("Authorization") ?? "");
}

/**
 * The account an API token (#1769) in `Authorization: Bearer <token>`
 * belongs to, through the AuthDO. Null for no bearer, an unknown or revoked
 * token, or any failure. Any account may hold one: the Owner tools
 * ownerToolRefusal names (and the regional batch import) still check
 * `isOwner`; the selection board (worker/boards.ts) takes any account's.
 */
export async function ownerTokenUserOf(
  request: Request,
  env: Partial<AuthEnv>,
): Promise<SessionUser | null> {
  // Only an Owner token's prefix is worth waking the AuthDO for.
  const authorization = request.headers.get("Authorization") ?? "";
  if (!env.AUTH || !authorization.startsWith(`Bearer ${OWNER_TOKEN_PREFIX}`))
    return null;
  try {
    const response = await env.AUTH.getByName("auth").fetch(
      "https://auth/internal/owner-token-user",
      {
        headers: { authorization },
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser | null };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

/**
 * All `/api/auth/*` routing: forwarded verbatim to the AuthDO singleton.
 * Returns null for unrelated paths.
 */
export async function routeAuthRequest(
  request: Request,
  env: AuthEnv,
): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith("/api/auth/")) return null;
  return env.AUTH.getByName("auth").fetch(request);
}
