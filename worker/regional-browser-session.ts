import {
  AUTH_OWNER_COOKIE,
  AUTH_SESSION_COOKIE,
  type AuthEnv,
  type AuthNamespaceLike,
} from "./auth-do";
import { bearerMatches } from "./bearer";
import {
  cookie,
  isRegionalAccountRoute,
  regionalConfig,
  REGIONAL_SESSION_COOKIE,
  REGIONAL_SESSION_PEER_PATH,
} from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";

const PEER_HEADER = "x-canvas-auth-peer";
type Env = Partial<AuthEnv> & {
  AUTH: AuthNamespaceLike;
  AUTH_REGIONAL_CLIENT?: string;
};

function configuration(env: Env) {
  const config = regionalConfig(
    env.AUTH_REGIONAL_CLIENT ?? env.AUTH_REGIONAL_AUTHORITY,
  );
  return config &&
    config.origin === config.clientOrigin &&
    (env.RESOURCE_REGION === "cn" || env.RESOURCE_REGION === "overseas")
    ? config
    : null;
}

function sessionRoute(request: Request, site: string) {
  const url = new URL(request.url);
  if (url.origin === "https://auth")
    return (
      (request.method === "GET" && url.pathname === "/internal/session-user") ||
      (request.method === "POST" &&
        url.pathname === "/internal/resource-action-authorize")
    );
  return (
    url.origin === site &&
    ((request.method === "GET" &&
      [
        "/api/auth/me",
        "/api/auth/providers",
        "/api/auth/regional/start",
        "/api/auth/regional/callback",
      ].includes(url.pathname)) ||
      (request.method === "POST" && url.pathname === "/api/auth/logout") ||
      isRegionalAccountRoute(request.method, url.pathname))
  );
}

function unavailable() {
  return Response.json(
    { error: "session-region-unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/** Authenticate transport, then let the owning store authenticate the original cookie. */
async function forward(request: Request, env: Env): Promise<Response> {
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER ?? "");
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      !env.RESOURCE_SYNC_PEER_TOKEN
    )
      return unavailable();
    const headers: Record<string, string> = {};
    for (const name of [
      "cookie",
      "origin",
      "sec-fetch-site",
      "content-type",
      "authorization",
    ])
      if (request.headers.has(name)) headers[name] = request.headers.get(name)!;
    const body = request.body ? await readSyncJson(request, 65_536) : undefined;
    return await fetch(
      new Request(peer.origin + REGIONAL_SESSION_PEER_PATH, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/json",
          [PEER_HEADER]: env.RESOURCE_SYNC_PEER_TOKEN,
        },
        body: JSON.stringify({
          url: request.url,
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        }),
      }),
    );
  } catch {
    return unavailable();
  }
}

/** One-hop, narrow AUTH binding RPC. Public callers cannot select an identity. */
export async function routeBrowserSessionPeer(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== REGIONAL_SESSION_PEER_PATH) return null;
  const config = configuration(env);
  const proof = new Request("https://auth-peer.internal", {
    headers: {
      authorization: "Bearer " + (request.headers.get(PEER_HEADER) ?? ""),
    },
  });
  if (
    !config ||
    request.method !== "POST" ||
    !bearerMatches(proof, env.RESOURCE_SYNC_TOKEN)
  )
    return new Response(null, { status: 403 });
  try {
    const value = (await readSyncJson(request, 98_304)) as {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: unknown;
    };
    const headers = new Headers();
    for (const name of [
      "cookie",
      "origin",
      "sec-fetch-site",
      "content-type",
      "authorization",
    ])
      if (typeof value.headers?.[name] === "string")
        headers.set(name, value.headers[name]);
    const original = new Request(value.url, {
      method: value.method,
      redirect: "manual",
      headers,
      ...(value.body === undefined ? {} : { body: JSON.stringify(value.body) }),
    });
    if (!sessionRoute(original, config.clientOrigin))
      return new Response(null, { status: 404 });
    return env.AUTH.getByName("auth").fetch(original);
  } catch {
    return new Response(null, { status: 400 });
  }
}

/** The cookie's store determines the actor, regardless of the geographic entry. */
export function browserSessionNamespace(env: Env): AuthNamespaceLike {
  const config = configuration(env);
  if (!config) return env.AUTH;
  return {
    getByName(name) {
      const local = env.AUTH.getByName(name);
      return {
        async fetch(input, init) {
          const request = new Request(input, init);
          if (!sessionRoute(request, config.clientOrigin))
            return local.fetch(request);
          const path = new URL(request.url).pathname;
          if (request.method === "POST" && path === "/api/auth/logout") {
            if (
              request.headers.get("origin") !== config.clientOrigin ||
              request.headers.get("sec-fetch-site") === "cross-site"
            )
              return new Response(null, { status: 403 });
            const regions = new Set<string>();
            if (
              cookie(request, REGIONAL_SESSION_COOKIE) ||
              cookie(request, "icm_regional_login")
            )
              regions.add("cn");
            if (
              cookie(request, AUTH_SESSION_COOKIE) ||
              cookie(request, AUTH_OWNER_COOKIE)
            )
              regions.add("overseas");
            if (!regions.size) regions.add(env.RESOURCE_REGION!);
            const replies = await Promise.all(
              [...regions].map((region) =>
                (region === env.RESOURCE_REGION
                  ? local.fetch(request.clone())
                  : forward(request.clone(), env)
                ).catch(() => unavailable()),
              ),
            );
            const headers = new Headers({ "cache-control": "no-store" });
            const succeeded = replies.every((reply) => reply.ok);
            for (const reply of replies) {
              if (succeeded)
                for (const value of reply.headers.getSetCookie())
                  headers.append("set-cookie", value);
              await reply.body?.cancel();
            }
            // Preserve credentials for a safe retry if one store did not confirm.
            return succeeded
              ? Response.json({ ok: true }, { headers })
              : unavailable();
          }
          const owner =
            path === "/api/auth/providers"
              ? env.RESOURCE_REGION
              : path === "/api/auth/regional/start" ||
                  path === "/api/auth/regional/callback" ||
                  cookie(request, REGIONAL_SESSION_COOKIE)
                ? "cn"
                : cookie(request, AUTH_SESSION_COOKIE)
                  ? "overseas"
                  : env.RESOURCE_REGION;
          return owner === env.RESOURCE_REGION
            ? local.fetch(request)
            : forward(request, env);
        },
      };
    },
  };
}
