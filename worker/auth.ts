export * from "./auth-do";
import {
  AUTH_SESSION_COOKIE,
  OWNER_TOKEN_PREFIX,
  type AuthEnv,
  type SessionUser,
} from "./auth-do";
import { REGIONAL_SESSION_COOKIE } from "./regional-auth-contract";

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
      "https://auth/internal/session-user",
      { headers: { cookie: request.headers.get("Cookie") ?? "" } },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser | null };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

/** Whether the request carries `Authorization: Bearer …`. */
export function hasBearer(request: Request): boolean {
  return /^Bearer \S/u.test(request.headers.get("Authorization") ?? "");
}

/**
 * The account an Owner token (#1769) in `Authorization: Bearer <token>`
 * belongs to, through the AuthDO. Null for no bearer, an unknown or revoked
 * token, or any failure. Only the dataset import may call this; the caller
 * still checks `isOwner`.
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
