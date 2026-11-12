import type { SessionUser } from "./auth-do";
import { digest } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";

/** Never an account header: the authority must validate this short-lived capability. */
export const REGIONAL_ARENA_CAPABILITY = "x-canvas-arena-capability";

/** Bind the existing regional action capability to this Arena request only. */
export async function arenaCapabilityRequest(
  request: Request,
  operation: "authorize" | "verify",
): Promise<Request | Response> {
  const url = new URL(request.url);
  let body: unknown = null;
  try {
    if (request.body) body = await readSyncJson(request.clone(), 65_536);
  } catch (error) {
    return Response.json(
      { error: "invalid-request" },
      {
        status: error instanceof RangeError ? 413 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
  const binding = await digest(
    JSON.stringify([
      "regional-arena-v1",
      request.method,
      url.pathname + url.search,
      body,
    ]),
  );
  return new Request("https://auth/internal/resource-action-" + operation, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(operation === "authorize"
        ? { cookie: request.headers.get("cookie") ?? "" }
        : {}),
    },
    body: JSON.stringify({
      binding,
      ...(operation === "verify"
        ? { token: request.headers.get(REGIONAL_ARENA_CAPABILITY) }
        : {}),
    }),
  });
}

/** An invalid proof never falls back to another cookie's account. */
export async function regionalArenaUser(
  request: Request,
  auth: (request: Request) => Promise<Response>,
): Promise<SessionUser | Response> {
  try {
    const internal = await arenaCapabilityRequest(request, "verify");
    if (internal instanceof Response) return internal;
    const response = await auth(internal);
    if (!response.ok)
      return Response.json(
        { error: "unauthorized" },
        {
          status: response.status === 401 ? 401 : 503,
          headers: { "cache-control": "no-store" },
        },
      );
    const result = (await response.json()) as { user: SessionUser };
    return result.user;
  } catch {
    return Response.json(
      { error: "arena-authorization-unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
