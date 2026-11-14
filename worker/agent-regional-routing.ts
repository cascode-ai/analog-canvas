import type { AgentSessionNamespaceLike } from "./agent-session-runtime";
import { bearerMatches } from "./bearer";

export interface AgentRegionalEnv {
  RESOURCE_REGION?: string;
  RESOURCE_ACTION_PEER?: string;
  RESOURCE_SYNC_TOKEN?: string;
  RESOURCE_SYNC_PEER_TOKEN?: string;
}

const PREFIX = "/api/agent/region/";
const PEER_HEADER = "x-canvas-agent-peer";
const DIRECTORY = /^(?:(cn|overseas)_)?(agent-device-trust-[a-f0-9]{64})$/u;
const SESSION =
  /^(?:[a-f0-9]{8}_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
// Preserve installed MCP's site_UUID grammar. Only reserved UUIDv8 values
// carry a region; every preexisting randomUUID (v4) keeps legacy resolution.
const REGION_CODES = { cn: "caca0001", overseas: "caca0002" } as const;
export function regionalAgentId(id: string, env: AgentRegionalEnv) {
  const region = agentRegion(env);
  return region
    ? REGION_CODES[region] + id.slice(8, 14) + "8" + id.slice(15)
    : id;
}
const SESSION_PATH =
  /^\/(?:claim|resume-connector|session|circuit|files|simulation|projects|events|editor|control|status|activity|detached-editor|artifact-status|approve-editor-launch|revoke-trusted-device|artifacts\/[A-Za-z0-9_-]{1,128})$/u;
const DIRECTORY_PATH = /^\/device-trust\/(?:list|grant|all|[a-f0-9]{64})$/u;

function agentRegion(env: AgentRegionalEnv): "cn" | "overseas" | undefined {
  return env.RESOURCE_REGION === "cn" || env.RESOURCE_REGION === "overseas"
    ? env.RESOURCE_REGION
    : undefined;
}

function owner(name: string) {
  const directory = DIRECTORY.exec(name);
  if (directory) return directory[1];
  const code =
    /^(?:[a-f0-9]{8}_)?(caca000[12])-[a-f0-9]{4}-8[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$/u.exec(
      name,
    )?.[1];
  return code === REGION_CODES.cn
    ? "cn"
    : code === REGION_CODES.overseas
      ? "overseas"
      : undefined;
}

/** A directory keeps its existing physical key; the prefix records approval's region. */
export function regionalDeviceDirectory(name: string, env: AgentRegionalEnv) {
  const region = agentRegion(env);
  return region && !DIRECTORY.exec(name)?.[1] ? `${region}_${name}` : name;
}

function localName(name: string) {
  return DIRECTORY.exec(name)?.[2] ?? name;
}

function unavailable() {
  return Response.json(
    {
      ok: false,
      error: {
        code: "REQUEST_TIMEOUT",
        message:
          "The owning Agent region is unavailable. Keep the Editor open; no operation was replayed in another region.",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/** Fixed, authenticated, one-hop transport. The owner still checks every credential. */
async function forward(env: AgentRegionalEnv, name: string, request: Request) {
  let peer: URL;
  try {
    peer = new URL(env.RESOURCE_ACTION_PEER ?? "");
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password ||
      !env.RESOURCE_SYNC_PEER_TOKEN
    )
      return unavailable();
  } catch {
    return unavailable();
  }
  const source = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const key of [
    "host",
    "cf-connecting-ip",
    "x-real-ip",
    "x-forwarded-for",
  ])
    headers.delete(key);
  headers.set(PEER_HEADER, env.RESOURCE_SYNC_PEER_TOKEN);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    // Cancel only while opening: established WebSocket/SSE streams have their own lifetime.
    const response = await fetch(
      new Request(
        new URL(PREFIX + name + source.pathname + source.search, peer),
        {
          method: request.method,
          headers,
          body: request.body,
          ...(request.body ? { duplex: "half" } : {}),
          redirect: "manual",
          signal: controller.signal,
        },
      ),
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return unavailable();
    }
    return response;
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

/** Wrap the public relay's namespace, never its incoming peer endpoint. */
export function regionalAgentNamespace(
  namespace: AgentSessionNamespaceLike,
  env: AgentRegionalEnv,
): AgentSessionNamespaceLike {
  const region = agentRegion(env);
  if (!region) return namespace;
  return {
    getByName(name) {
      return {
        async fetch(input, init) {
          const request = new Request(input, init);
          const target = owner(name);
          if (target && target !== region) return forward(env, name, request);
          const local = namespace.getByName(localName(name));
          // Old IDs have no region. Resolve before dispatch; never retry an attempted write.
          if (
            !target &&
            SESSION.test(name) &&
            new URL(request.url).pathname !== "/create"
          ) {
            const presence = await local.fetch(
              "https://agent-session.internal/region-presence",
            );
            if (presence.status === 404) return forward(env, name, request);
            if (presence.status !== 204) return unavailable();
          }
          return local.fetch(request);
        },
      };
    },
  };
}

/** Shared with the outbound allowlist; no arbitrary Durable Object paths. */
export function agentPeerTarget(pathname: string) {
  if (!pathname.startsWith(PREFIX)) return null;
  const rest = pathname.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  const name = rest.slice(0, slash),
    path = rest.slice(slash);
  return slash > 0 &&
    (DIRECTORY.test(name)
      ? DIRECTORY_PATH.test(path)
      : SESSION.test(name) && SESSION_PATH.test(path))
    ? { name, path }
    : null;
}

/** Peer requests never run the public router again, so missing legacy IDs cannot loop. */
export async function routeAgentRegion(
  request: Request,
  env: AgentRegionalEnv & { AGENT_SESSION: AgentSessionNamespaceLike },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const token = request.headers.get(PEER_HEADER);
  const proof = new Request("https://agent-peer.internal", {
    headers: { authorization: `Bearer ${token ?? ""}` },
  });
  if (!agentRegion(env) || !bearerMatches(proof, env.RESOURCE_SYNC_TOKEN))
    return new Response(null, { status: 403 });
  const target = agentPeerTarget(url.pathname);
  if (!target) return new Response(null, { status: 404 });
  const { name, path } = target;
  if (owner(name) && owner(name) !== agentRegion(env)) return unavailable();
  const headers = new Headers(request.headers);
  headers.delete(PEER_HEADER);
  headers.delete("host");
  return env.AGENT_SESSION.getByName(localName(name)).fetch(
    new Request("https://agent-session.internal" + path + url.search, {
      method: request.method,
      headers,
      body: request.body,
      ...(request.body ? { duplex: "half" } : {}),
    }),
  );
}
