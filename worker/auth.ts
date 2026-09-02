export * from "./auth-do";
import { AUTH_SESSION_COOKIE, type AuthEnv, type SessionUser } from "./auth-do";

function hasSessionCookie(request: Request): boolean {
  const prefix = `${AUTH_SESSION_COOKIE}=`;
  return (request.headers.get("Cookie") ?? "").split(";").some((part) => {
    const cookie = part.trim();
    return cookie.startsWith(prefix) && cookie.length > prefix.length;
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
