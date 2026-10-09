// AnalogArena's way in (docs/specs/analog-arena.md#forwarded-identity-and-routing).
//
// Arena is its own Worker, `analog-arena`, deployed from Arcadia-1/analog-arena
// with no route of its own. This Worker forwards exactly /arena, /arena/… and
// /api/arena/… to it over a service binding and vouches for the signed-in
// account in one header. Arena trusts that header because nothing else can
// reach it, so this Worker never lets a client's copy through.

import { sessionUserOf, type AuthEnv, type SessionUser } from "./auth";

/** The forwarded account, as one JSON object; absent when signed out. */
const ARENA_ACCOUNT_HEADER = "x-arena-account";

export type ArenaEnv = Partial<AuthEnv> & {
  /** The service binding to `analog-arena`; Production alone holds it. */
  ARENA?: { fetch(request: Request): Promise<Response> };
};

function isArenaPath(pathname: string): boolean {
  return (
    pathname === "/arena" ||
    pathname.startsWith("/arena/") ||
    pathname.startsWith("/api/arena/")
  );
}

/**
 * The header value: the contract's fields, nothing else from the session.
 * A header carries bytes, so every character outside printable ASCII
 * travels as a JSON `\u` escape; the value is still one JSON object and
 * parses to the name.
 */
function arenaAccount(user: SessionUser): string {
  const account = JSON.stringify({
    id: user.id,
    displayName: user.displayName,
    isOwner: user.isOwner === true,
    isAdmin: user.isAdmin,
    role: user.role === "moderator" ? "moderator" : "user",
    seat: user.seat ?? null,
  });
  // UTF-16 units, not code points: an emoji travels as its surrogate pair.
  return account.replace(
    /[\u007f-\uffff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
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

/**
 * Forwards an Arena request with the vouched account. Null for every other
 * path, which Arena never sees.
 */
export async function routeArenaRequest(
  request: Request,
  env: ArenaEnv,
): Promise<Response | null> {
  if (!isArenaPath(new URL(request.url).pathname)) return null;
  const headers = new Headers(request.headers);
  headers.delete(ARENA_ACCOUNT_HEADER);
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
  if (response.status < 500) return response;
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
