// AnalogArena's way in (docs/specs/analog-arena.md#forwarded-identity-and-routing).
//
// Arena is its own Worker, `analog-arena`, deployed from Arcadia-1/chip-arena
// with no route of its own. This Worker serves it on chip-arena.com, forwards
// exactly /schematic, /schematic/… and /api/arena/… to it over a service
// binding and vouches for the signed-in
// account in one header. Arena trusts that header because nothing else can
// reach it, so this Worker never lets a client's copy through.

import {
  AUTH_OWNER_COOKIE,
  AUTH_SESSION_COOKIE,
  sessionUserOf,
  type AuthEnv,
} from "./auth";
import { ARENA_ACCOUNT_HEADER, arenaAccount } from "./arena-account";
import {
  ARENA_HOST,
  ARENA_ORIGIN,
  CANVAS_HOST,
  SCHEMATIC_ARENA_PATH,
  isArenaForwardedPath,
  isArenaPagePath,
  isLegacyArenaPagePath,
  schematicArenaPathOf,
} from "./arena-paths";

export type ArenaEnv = Partial<AuthEnv>;

/** Cookies Arena may never set: Analog Canvas's own sign-in. */
const CANVAS_SESSION_COOKIES = new Set([
  AUTH_SESSION_COOKIE,
  AUTH_OWNER_COOKIE,
]);

/** The name of a `Cookie` pair or a `Set-Cookie` value. */
function cookieName(cookie: string): string {
  return cookie.split("=", 1)[0]!.trim();
}

/**
 * The headers Arena receives. The account travels only as the vouched
 * header, so Analog Canvas's credentials stay here: the session cookie is
 * removed from `Cookie` (other cookies are kept) and `Authorization` is
 * dropped. Otherwise Arena could replay them against Analog Canvas.
 */
function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete(ARENA_ACCOUNT_HEADER);
  headers.delete("authorization");
  const cookies = (headers.get("cookie") ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair && cookieName(pair) !== AUTH_SESSION_COOKIE);
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  else headers.delete("cookie");
  return headers;
}

/** Arena's answer without any cookie that would sign this browser in or out. */
function withoutCanvasSessionCookies(response: Response): Response {
  const setCookies = response.headers.getSetCookie();
  const kept = setCookies.filter(
    (cookie) => !CANVAS_SESSION_COOKIES.has(cookieName(cookie)),
  );
  if (kept.length === setCookies.length) return response;
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of kept) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The request without a client's copy of the Arena account. The Worker's
 * entry applies it to every request, forwarded or not, so no route ever
 * passes one on.
 */
export function withoutClientArenaAccount(request: Request): Request {
  if (!request.headers.has(ARENA_ACCOUNT_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(ARENA_ACCOUNT_HEADER);
  return new Request(request, { headers });
}

function redirectTo(location: string, status: 301 | 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A GitHub or Google sign-in start: /api/auth/<provider>/start. */
const OAUTH_START = /^\/api\/auth\/(github|google)\/start$/u;

/**
 * The sign-in handoff to an AnalogArena page: the browser arrives there
 * signed in as it is on Analog Canvas, or signed out when it is signed out
 * here. It begins on AnalogArena's host, which marks the browser first.
 */
function handoffTo(arenaPage: string): Response {
  return redirectTo(
    `${ARENA_ORIGIN}/api/auth/handoff/begin?` +
      new URLSearchParams({ return: arenaPage }).toString(),
    302,
  );
}

/**
 * Where each host sends a request before any route answers it
 * (docs/specs/analog-arena.md#hosts). Null when the request stays.
 *
 * - AnalogArena's host serves the Schematic Arena's pages, /api/arena/… and
 *   the sign-in API. Its root opens /schematic, and every other path goes to
 *   Analog Canvas. A GitHub or Google sign-in starts on Analog Canvas, the
 *   only host those providers send people back to, and is handed back here.
 * - On Analog Canvas's host, the former /arena… pages and /schematic… go to
 *   the same Schematic Arena page on AnalogArena's host, through the sign-in
 *   handoff. Elsewhere (local development) /arena… goes to /schematic… on the
 *   same origin.
 */
export function routeArenaHosts(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname === ARENA_HOST) {
    if (url.pathname === "/") {
      return redirectTo(`${url.origin}${SCHEMATIC_ARENA_PATH}`, 302);
    }
    if (OAUTH_START.test(url.pathname)) {
      const start = new URL(url.pathname, `https://${CANVAS_HOST}`);
      const requested = url.searchParams.get("return");
      const page = requested?.startsWith("/")
        ? URL.parse(requested, ARENA_ORIGIN)
        : null;
      if (page?.origin === ARENA_ORIGIN && isArenaPagePath(page.pathname)) {
        start.searchParams.set("return", page.href);
      }
      return redirectTo(start.toString(), 302);
    }
    if (isArenaForwardedPath(url.pathname)) return null;
    if (url.pathname.startsWith("/api/auth/")) return null;
    return redirectTo(
      `https://${CANVAS_HOST}${url.pathname}${url.search}`,
      302,
    );
  }
  const legacy = isLegacyArenaPagePath(url.pathname);
  if (url.hostname === CANVAS_HOST) {
    if (legacy)
      return handoffTo(schematicArenaPathOf(url.pathname) + url.search);
    if (isArenaPagePath(url.pathname))
      return handoffTo(url.pathname + url.search);
    return null;
  }
  if (legacy) {
    return redirectTo(
      `${url.origin}${schematicArenaPathOf(url.pathname)}${url.search}`,
      301,
    );
  }
  return null;
}

/**
 * Forwards an Arena request with the vouched account. Null for every other
 * path, which Arena never sees.
 */
export async function routeArenaRequest(
  request: Request,
  env: ArenaEnv,
): Promise<Response | null> {
  if (!isArenaForwardedPath(new URL(request.url).pathname)) return null;
  const headers = forwardedHeaders(request);
  const user = await sessionUserOf(request, env);
  if (user) headers.set(ARENA_ACCOUNT_HEADER, arenaAccount(user));
  let response: Response;
  try {
    if (!env.ARENA) throw new Error("no ARENA binding");
    response = await env.ARENA.fetch(new Request(request, { headers }));
  } catch (error) {
    console.error("Arena unreachable", error);
    return arenaUnavailable(request);
  }
  // Arena's own refusals are its answer; a failure is answered here, so a
  // visitor sees the same small notice however Arena broke.
  if (response.status < 500) return withoutCanvasSessionCookies(response);
  console.error("Arena failed", response.status);
  return arenaUnavailable(request);
}

const UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arena unavailable · Analog Canvas</title>
<main style="max-width:32rem;margin:15vh auto;padding:0 16px;font:16px/1.5 system-ui,sans-serif">
<h1 style="font-size:1.4rem">Arena is unavailable right now</h1>
<p>Please try again in a minute. Your circuits and your account are not affected.</p>
<p><a href="/">Back to the Gallery</a> · <a href="/editor">Open the editor</a></p>
</main>
</html>
`;

function arenaUnavailable(request: Request): Response {
  const headers = { "cache-control": "no-store" };
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return Response.json(
      { error: "arena-unavailable" },
      { status: 503, headers },
    );
  }
  return new Response(UNAVAILABLE_PAGE, {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}
