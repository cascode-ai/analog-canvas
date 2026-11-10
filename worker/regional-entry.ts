import canvas from "./index";
import { bearerMatches } from "./bearer";
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

/** The common Canvas runtime behind a trusted regional loopback proxy. */
export default {
  async fetch(incoming: Request, base: Env): Promise<Response> {
    const config = regionalConfig(base.AUTH_REGIONAL_CLIENT);
    if (!config)
      return Response.json({ error: "region-not-configured" }, { status: 503 });
    const local = new URL(incoming.url),
      origin = new URL(config.clientOrigin);
    // The browser proxy names the client; nothing a client sends is trusted.
    const proxied = incoming.headers.get("x-real-ip");
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
      ...regionalRateLimiters(base.REGIONAL_RATE_LIMITS),
      // Agents download the pinned MCP bundle from this site (nginx /downloads/mcp/).
      AGENT_MCP_DOWNLOAD_ORIGIN: config.clientOrigin,
    } as Env;
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
    if (proxied) request.headers.set("cf-connecting-ip", proxied);
    if (
      config.origin === config.clientOrigin &&
      isRegionalAuthorityBrowserRoute(request.method, local.pathname)
    ) {
      const upstream = new Request(
        new URL(local.pathname + local.search, config.transportOrigin),
        request,
      );
      // The destination owns Host; browser Origin and cookies stay unchanged.
      upstream.headers.delete("host");
      // This is an internal rate-limit address, not a Cloudflare edge request.
      upstream.headers.delete("cf-connecting-ip");
      try {
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
    if (
      local.pathname.startsWith("/api/projects") &&
      incoming.method !== "GET" &&
      env.PROJECT_WRITES_ENABLED?.trim() !== "true"
    )
      return Response.json(
        { error: "regional-writes-disabled" },
        { status: 503 },
      );
    return canvas.fetch(request, env);
  },
  scheduled: canvas.scheduled,
};
