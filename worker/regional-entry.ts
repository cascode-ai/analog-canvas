import canvas from "./index";
import { browserSessionNamespace } from "./regional-browser-session";
import { regionalGalleryGzip } from "./regional-gallery-gzip";
import {
  collectRegionalGarbage,
  regionalMemoryStatus,
} from "../containers/canvas-cn/formal/memory.mjs";
import { bearerMatches } from "./bearer";
import { refuseApiFlood } from "./api-rate-limit";
import { readSyncJson } from "./project-sync-http";
import { validCreateTicket } from "./project-create-receipt";
import {
  arenaCapabilityRequest,
  REGIONAL_ARENA_CAPABILITY,
} from "./regional-arena-auth";
import { isRegionalArenaRoute } from "./arena-paths";
import {
  REGIONAL_SCHEDULED_PATH,
  regionalRateLimiters,
} from "./regional-runtime";
import {
  isRegionalAuthorityBrowserRoute,
  regionalConfig,
} from "./regional-auth-contract";
export {
  RegionalSessionDO,
  RegionalProjectDO,
  GalleryDO,
  ComponentLibraryDO,
  AgentSessionDO,
  SimulationControlDO,
  TopologyTaskDO,
  AnalyticsDO,
} from "./index";

type Env = Parameters<typeof canvas.fetch>[1] & {
  PROJECT_WRITES_ENABLED?: string;
  PROJECT_SYNC_ADMIN_TOKEN?: string;
  /** Production's `ratelimits` as `{name: {limit, period}}` (regional-runtime.mjs). */
  REGIONAL_RATE_LIMITS?: string;
};

const ANALYTICS_COUNTRY_HEADER = "x-canvas-analytics-country";

/** The common Canvas runtime behind a trusted regional loopback proxy. */
export default {
  async fetch(incoming: Request, base: Env): Promise<Response> {
    collectRegionalGarbage();
    const config = regionalConfig(base.AUTH_REGIONAL_CLIENT);
    if (!config)
      return Response.json({ error: "region-not-configured" }, { status: 503 });
    const local = new URL(incoming.url),
      origin = new URL(config.clientOrigin);
    // The browser proxy names the client; nothing a client sends is trusted.
    const publicClient = incoming.headers.get("x-real-ip");
    const controlCreate =
      local.pathname === "/__regional/project-create-receipt";
    const dispatchCreate = local.pathname === "/__regional/project-create";
    const ticketHeader = "x-icm-project-create-ticket";
    const addressHeader = "x-icm-project-client-address";
    const proxied = dispatchCreate
      ? incoming.headers.get(addressHeader)
      : publicClient;
    if (controlCreate || dispatchCreate) {
      if (
        local.hostname !== "127.0.0.1" ||
        incoming.method !== "POST" ||
        !base.PROJECTS ||
        base.PROJECT_REGION !== "cn" ||
        publicClient !== null
      )
        return new Response(null, { status: 404 });
      if (controlCreate) {
        const body = (await readSyncJson(incoming, 512).catch(() => null)) as {
          ticket?: unknown;
          action?: unknown;
          address?: unknown;
        } | null;
        if (
          !body ||
          (!["capabilities", "diagnostics"].includes(String(body.action)) &&
            !validCreateTicket(body.ticket)) ||
          ![
            "register",
            "settle",
            "capabilities",
            "diagnostics",
            "handoff",
          ].includes(String(body.action))
        )
          return new Response(null, { status: 400 });
        if (body?.action === "register" && body.address !== undefined) {
          if (
            typeof body.address !== "string" ||
            !/^[0-9a-f:.]{1,45}$/iu.test(body.address)
          )
            return new Response(null, { status: 400 });
          const flood = await refuseApiFlood(
            new Request(new URL("/api/projects", origin), {
              method: "POST",
              headers: { "cf-connecting-ip": body.address },
            }),
            { ...base, ...regionalRateLimiters(base.REGIONAL_RATE_LIMITS) },
          );
          if (flood) return flood;
        }
        return base.PROJECTS.getByName(
          base.PROJECTS_STORE_NAME ?? "projects",
        ).fetch("https://projects/cloud-project-create-receipt", {
          method: "POST",
          body: JSON.stringify({ action: body?.action, ticket: body.ticket }),
        });
      }
      if (!validCreateTicket(incoming.headers.get(ticketHeader)))
        return new Response(null, { status: 400 });
      local.pathname = "/api/projects";
    }
    if (local.pathname === "/__regional/health") {
      if (
        incoming.method !== "GET" ||
        proxied !== null ||
        !["localhost", "127.0.0.1"].includes(local.hostname)
      )
        return new Response(null, { status: 404 });
      const memory = regionalMemoryStatus();
      const auth = await base.AUTH.getByName("auth").fetch(
        new Request(new URL("/api/auth/me", origin)),
      );
      await auth.body?.cancel();
      const ready = memory.enabled && auth.ok;
      return Response.json({ ready, memory }, { status: ready ? 200 : 503 });
    }
    if (local.pathname === REGIONAL_SCHEDULED_PATH) {
      if (
        incoming.method !== "POST" ||
        proxied !== null ||
        !bearerMatches(incoming, base.PROJECT_SYNC_ADMIN_TOKEN)
      )
        return Response.json({ error: "not-found" }, { status: 404 });
      // canvas-cn-project-sync.timer is the region's only Project sync driver.
      await canvas.scheduled(
        { scheduledTime: Date.now(), cron: "regional-timer" },
        { ...base, PROJECTS: undefined } as unknown as Env,
      );
      return Response.json(
        { status: "ran" },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const env: Env = {
      ...base,
      encodePublishedGalleryBody: regionalGalleryGzip,
      ...(dispatchCreate
        ? { regionalProjectCreateTicket: incoming.headers.get(ticketHeader)! }
        : {}),
      ...regionalRateLimiters(base.REGIONAL_RATE_LIMITS),
      regionalAnalyticsCountry: proxied
        ? (incoming.headers.get(ANALYTICS_COUNTRY_HEADER) ?? undefined)
        : undefined,
      // Agents download the pinned MCP bundle from this site (nginx /downloads/mcp/).
      AGENT_MCP_DOWNLOAD_ORIGIN: config.clientOrigin,
    } as Env;
    // The fixed entrance spent this request's allowance before registering the ticket.
    if (dispatchCreate) delete env.API_RATE_LIMITER;
    if (
      local.host !== origin.host &&
      !["localhost", "127.0.0.1"].includes(local.hostname)
    )
      return Response.json({ error: "invalid-host" }, { status: 421 });
    const request = new Request(
      new URL(local.pathname + local.search, origin),
      incoming,
    );
    request.headers.delete("cf-connecting-ip");
    request.headers.delete("x-real-ip");
    request.headers.delete(ticketHeader);
    request.headers.delete(addressHeader);
    request.headers.delete(ANALYTICS_COUNTRY_HEADER);
    if (proxied) request.headers.set("cf-connecting-ip", proxied);
    if (
      config.origin === config.clientOrigin &&
      isRegionalAuthorityBrowserRoute(request.method, local.pathname)
    ) {
      const upstream = new Request(
        new URL(local.pathname + local.search, config.transportOrigin),
        request.clone(),
      );
      // The destination owns Host; browser Origin and cookies stay unchanged.
      upstream.headers.delete("host");
      // This is an internal rate-limit address, not a Cloudflare edge request.
      upstream.headers.delete("cf-connecting-ip");
      // Only Production's private Arena binding may carry a vouched identity.
      upstream.headers.delete("x-arena-account");
      upstream.headers.delete(REGIONAL_ARENA_CAPABILITY);
      try {
        if (isRegionalArenaRoute(request.method, local.pathname)) {
          // Select the current browser's owning session; never forward another
          // cookie's actor as the Arena identity.
          upstream.headers.delete("cookie");
          upstream.headers.delete("authorization");
          const authorization = await arenaCapabilityRequest(
            request,
            "authorize",
          );
          if (authorization instanceof Response) return authorization;
          const proof = await browserSessionNamespace(env)
            .getByName("auth")
            .fetch(authorization);
          if (proof.ok) {
            const body = (await proof.json()) as { token: string };
            upstream.headers.set(REGIONAL_ARENA_CAPABILITY, body.token);
          } else if (proof.status !== 401) {
            return Response.json(
              { error: "arena-authorization-unavailable" },
              { status: 503, headers: { "cache-control": "no-store" } },
            );
          }
        }
        return await fetch(upstream, {
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return Response.json(
          { error: "authority-unavailable" },
          { status: 502, headers: { "cache-control": "no-store" } },
        );
      }
    }
    const writesDisabled =
      local.pathname.startsWith("/api/projects") &&
      incoming.method !== "GET" &&
      env.PROJECT_WRITES_ENABLED?.trim() !== "true";
    const response = writesDisabled
      ? Response.json({ error: "regional-writes-disabled" }, { status: 503 })
      : await canvas.fetch(request, env);
    if (!dispatchCreate) return response;
    const marked = new Response(response.body, response);
    marked.headers.set("x-icm-project-create-protocol", "1");
    return marked;
  },
  scheduled: canvas.scheduled,
};
