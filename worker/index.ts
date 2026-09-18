import { handleNetlistConversionRequest } from "../packages/spice/src/conversion-request.js";
import {
  routeAnalyticsRequest,
  type AnalyticsRouteEnv,
} from "../apps/editor/analytics/routes";
import {
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
} from "./agent-session";
import {
  refreshNetlistMarks,
  routeGalleryRequest,
  type GalleryNamespaceLike,
} from "./gallery";
import { routeSimulationRequest, type SimulationEnv } from "./simulation";
import {
  consumeSimulationJobs,
  routeManagedSimulationRequest,
  type SimulationJobMessage,
  type SimulationOperationsEnv,
  type SimulationQueueBatch,
} from "./simulation-operations";
import {
  channelResponse,
  markPreviewResponse,
  previewGalleryReadThrough,
  previewGalleryWriteRefusal,
  previewRobotsResponse,
  releaseChannel,
  type ChannelEnv,
} from "./channel";
import { routeAuthRequest, type AuthNamespaceLike } from "./auth";

export { AnalyticsDO } from "../apps/editor/analytics/worker";
export { AgentSessionDO } from "./agent-session";
export { GalleryDO } from "./gallery";
export { AuthDO } from "./auth";
export { SimulationControlDO } from "./simulation-control-do";

type Env = SimulationEnv &
  SimulationOperationsEnv &
  ChannelEnv & {
    ASSETS: { fetch(request: Request): Promise<Response> };
    AGENT_SESSION: AgentSessionNamespaceLike;
    AGENT_ALLOWED_ORIGIN?: string;
    GALLERY: GalleryNamespaceLike;
    AUTH: AuthNamespaceLike;
    GH_OAUTH_CLIENT_ID?: string;
    GH_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    AUTH_EMAIL_FROM?: string;
    ADMIN_EMAILS?: string;
    ADMIN_EMAILS_EXTRA?: string;
  } & AnalyticsRouteEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Every preview response is stamped noindex on the way out (Deployment rationale).
    return markPreviewResponse(await route(request, env), env);
  },
  async queue(
    batch: SimulationQueueBatch<SimulationJobMessage>,
    env: Env,
  ): Promise<void> {
    await consumeSimulationJobs(batch, env);
  },
  // A deployed change to the netlist rule leaves every stored Gallery mark
  // answering an older question. One batch per tick re-answers them without
  // anybody pressing anything; when none are stale the pass reads one count
  // and stops.
  async scheduled(_event: ScheduledEventLike, env: Env): Promise<void> {
    await refreshNetlistMarks(env, SCHEDULED_NETLIST_MARK_BATCH);
  },
};

/** Batch size per tick: large enough to converge quickly, small enough to stay well inside one invocation. */
const SCHEDULED_NETLIST_MARK_BATCH = 50;

type ScheduledEventLike = { scheduledTime: number; cron: string };

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const conversion = await handleNetlistConversionRequest(request);
  if (conversion) return conversion;

  // The channel is a fact about the deployment, answered before anything
  // that depends on it; the preview's robots answer and its refusal of
  // shared-store writes sit here so no later handler can forget them.
  if (url.pathname === "/api/channel" && request.method === "GET") {
    return channelResponse(env);
  }
  if (url.pathname === "/robots.txt" && releaseChannel(env) === "preview") {
    return previewRobotsResponse();
  }
  const readOnlyRefusal = previewGalleryWriteRefusal(request, env);
  if (readOnlyRefusal) return readOnlyRefusal;
  const galleryReadThrough = await previewGalleryReadThrough(request, env);
  if (galleryReadThrough) return galleryReadThrough;

  const agentResponse = await routeAgentSessionRequest(request, env);
  if (agentResponse) return agentResponse;

  const authResponse = await routeAuthRequest(request, env);
  if (authResponse) return authResponse;

  const galleryResponse = await routeGalleryRequest(request, env);
  if (galleryResponse) return galleryResponse;

  const managedSimulationResponse = await routeManagedSimulationRequest(
    request,
    env,
  );
  if (managedSimulationResponse) return managedSimulationResponse;

  const simulationResponse = await routeSimulationRequest(request, env);
  if (simulationResponse) return simulationResponse;

  const analyticsResponse = await routeAnalyticsRequest(request, env);
  if (analyticsResponse) return analyticsResponse;
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return serveAsset(request, env);
}

/**
 * Serve a static asset, and let a missing one be missing.
 *
 * The boundary, which is the thing an earlier attempt did not draw: a path
 * under `/assets/` names a CONTENT-HASHED FILE. The name is a promise about
 * the bytes behind it, so if those bytes are gone the honest answer is 404.
 * Every other path is a CLIENT ROUTE — `/editor`, `/g/<id>` — which never had
 * a file behind it, and whose miss is answered with the shell so the app can
 * boot and route it.
 *
 * The asset layer cannot tell them apart: `not_found_handling:
 * single-page-application` answers both with index.html at status 200. That
 * is right for a route and wrong for an asset, and it is the bug a browser
 * reports as "Failed to fetch dynamically imported module" after a redeploy
 * retires a chunk name. So `/assets/*` runs the Worker first, and the shell
 * arriving where a script was requested is recognised and turned into a 404.
 *
 * Detection is by content type rather than by comparing bytes: a real file
 * under /assets/ is script, style, font or image, and never text/html.
 */
async function serveAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/assets/")) return response;
  const isShellFallback = (response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/html");
  if (!isShellFallback) {
    // Only successful content-hashed build assets are immutable. Shells,
    // errors and explicitly private responses keep their policy.
    const policy = response.headers.get("cache-control") ?? "";
    if (
      response.status === 200 &&
      /\/[\w.-]+-[\w-]{8,}\.[\w]+$/.test(path) &&
      !/\b(no-store|private)\b/i.test(policy) &&
      !response.headers.has("set-cookie")
    ) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
  return new Response(`Not found: ${path}`, {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A retired name must not be cached as anything, least of all as a
      // 404 that outlives the next deploy that might reuse it.
      "cache-control": "no-store",
    },
  });
}
