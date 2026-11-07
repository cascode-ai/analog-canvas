import canvas from "./index";
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
};

/** The common Canvas runtime behind a trusted regional loopback proxy. */
export default {
  async fetch(incoming: Request, env: Env): Promise<Response> {
    const config = regionalConfig(env.AUTH_REGIONAL_CLIENT);
    if (!config)
      return Response.json({ error: "region-not-configured" }, { status: 503 });
    const local = new URL(incoming.url),
      origin = new URL(config.clientOrigin);
    if (
      local.host !== origin.host &&
      !["localhost", "127.0.0.1"].includes(local.hostname)
    )
      return Response.json({ error: "invalid-host" }, { status: 421 });
    const request = new Request(
      new URL(local.pathname + local.search, origin),
      incoming,
    );
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
      env.PROJECT_WRITES_ENABLED !== "true"
    )
      return Response.json(
        { error: "regional-writes-disabled" },
        { status: 503 },
      );
    return canvas.fetch(request, env);
  },
  scheduled: canvas.scheduled,
};
