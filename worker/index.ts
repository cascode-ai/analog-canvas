import {
  routeTopologyTaskRequest,
  type TopologyTaskEnv,
} from "./topology-task";
export { TopologyTaskDO } from "./topology-task";
import { handleNetlistConversionRequest } from "../packages/spice/src/conversion-request.js";
import {
  routeAnalyticsRequest,
  type AnalyticsRouteEnv,
} from "../apps/editor/analytics/routes";
import {
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
} from "./agent-session";
import { refuseApiFlood, type ApiRateLimitEnv } from "./api-rate-limit";
import { serveAsset } from "./static-assets";
import { forgetEarlierOpens, routeGalleryRequest } from "./gallery";
import {
  galleryReadableDocument,
  type GalleryReadableDocument,
} from "./gallery-documents";
import { moveTestbenches, refreshNetlistMarks } from "./gallery-maintenance";
import { advanceSimulationChecks } from "./gallery-simulation-check-runs";
import type { GalleryNamespaceLike } from "./gallery-store";
import {
  routeSimulationRequest,
  refuseSignedOutSimulation,
  type SimulationEnv,
} from "./simulation";
import {
  consumeSimulationJobs,
  routeManagedSimulationRequest,
  type SimulationJobMessage,
  type SimulationOperationsEnv,
  type SimulationQueueBatch,
} from "./simulation-operations";
import {
  AuthDO as AuthStore,
  routeAuthRequest,
  type AuthNamespaceLike,
} from "./auth";
import {
  routePointInTimeRecovery,
  withPointInTimeRecovery,
} from "./point-in-time-recovery";
import {
  ComponentLibraryDO as ComponentLibraryStore,
  routeComponentLibraryRequest,
  type ComponentLibraryEnv,
} from "./component-library";
import { AnalyticsDO as AnalyticsStore } from "../apps/editor/analytics/worker";
import { GalleryDO as GalleryStore } from "./gallery";
import {
  routeArenaHosts,
  routeArenaRequest,
  withoutClientArenaAccount,
  type ArenaEnv,
} from "./arena";

// The stores that keep durable data also answer point-in-time recovery. The
// export names are the deployed class names, so they must not change.
export const ComponentLibraryDO = withPointInTimeRecovery(
  ComponentLibraryStore,
);
export const AnalyticsDO = withPointInTimeRecovery(AnalyticsStore);
export const GalleryDO = withPointInTimeRecovery(GalleryStore);
export const AuthDO = withPointInTimeRecovery(AuthStore);
export { AgentSessionDO } from "./agent-session";
export { SimulationControlDO } from "./simulation-control-do";

type Env = TopologyTaskEnv &
  ComponentLibraryEnv &
  SimulationEnv &
  SimulationOperationsEnv & {
    ASSETS: { fetch(request: Request): Promise<Response> };
    AGENT_SESSION: AgentSessionNamespaceLike;
    AGENT_ALLOWED_ORIGIN?: string;
    GALLERY: GalleryNamespaceLike;
    GALLERY_BACKUP_TOKEN?: string;
    STORE_BACKUP_TOKEN?: string;
    /** Made by each deploy for its own simulation check; see simulation.ts. */
    SIMULATION_SMOKE_TOKEN?: string;
    AUTH: AuthNamespaceLike;
    GH_OAUTH_CLIENT_ID?: string;
    GH_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    AUTH_EMAIL_FROM?: string;
    ADMIN_EMAILS?: string;
    ADMIN_EMAILS_EXTRA?: string;
  } & AnalyticsRouteEnv &
  ArenaEnv &
  ApiRateLimitEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(withoutClientArenaAccount(request), env);
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
    try {
      await refreshNetlistMarks(env, SCHEDULED_NETLIST_MARK_BATCH);
      // Once the Owner recorded a backup, testbenches leave the shared
      // Project Code a batch a tick (#1545); then the pass reads one row.
      await moveTestbenches(env, { apply: true, scheduled: true });
    } finally {
      // The privacy notice promises yesterday's opens are gone the next
      // day, whatever became of the marks.
      await forgetEarlierOpens(env);
      // A block notice the Owner did not get is sent again.
      await env.AUTH?.getByName("auth")
        .fetch("https://auth/internal/block-notices", { method: "POST" })
        .catch(() => null);
      // The simulation checks the Owner queued (#1545) take the rest of
      // the tick, one folder at a time; with none queued, one read.
      await advanceSimulationChecks(env);
    }
  },
};

/** Batch size per tick: large enough to converge quickly, small enough to stay well inside one invocation. */
const SCHEDULED_NETLIST_MARK_BATCH = 50;

type ScheduledEventLike = { scheduledTime: number; cron: string };

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // The Arena host serves only AnalogArena; the former /arena pages move there.
  const hostRedirect = routeArenaHosts(request);
  if (hostRedirect) return hostRedirect;

  const flood = await refuseApiFlood(request, env);
  if (flood) return flood;

  const conversion = await handleNetlistConversionRequest(request);
  if (conversion) return conversion;

  const agentResponse = await routeAgentSessionRequest(request, env);
  if (agentResponse) return agentResponse;

  const authResponse = await routeAuthRequest(request, env);
  if (authResponse) return authResponse;

  const arenaResponse = await routeArenaRequest(request, env);
  if (arenaResponse) return arenaResponse;

  const recoveryResponse = await routePointInTimeRecovery(request, env);
  if (recoveryResponse) return recoveryResponse;

  const topologyResponse = await routeTopologyTaskRequest(request, env);
  if (topologyResponse) return topologyResponse;

  const galleryResponse = await routeGalleryRequest(request, env);
  if (galleryResponse) return galleryResponse;

  const componentsResponse = await routeComponentLibraryRequest(request, env);
  if (componentsResponse) return componentsResponse;

  const managedSimulationResponse = await routeManagedSimulationRequest(
    request,
    env,
  );
  if (managedSimulationResponse) return managedSimulationResponse;

  const signInResponse = await refuseSignedOutSimulation(request, env);
  if (signInResponse) return signInResponse;

  const simulationResponse = await routeSimulationRequest(request, env);
  if (simulationResponse) return simulationResponse;

  const analyticsResponse = await routeAnalyticsRequest(request, env);
  if (analyticsResponse) return analyticsResponse;
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return servePublicDocument(request, env);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function injectGalleryReadableDocument(
  shell: string,
  readable: GalleryReadableDocument,
): string {
  const title = escapeHtml(readable.title);
  const description = escapeHtml(readable.description);
  return shell
    .replace(/<title>.*?<\/title>/isu, `<title>${title}</title>`)
    .replace(
      "</head>",
      `<meta name="description" content="${description}">${readable.headHtml}</head>`,
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root">${readable.bodyHtml}</div>`,
    );
}

/** Add real public Gallery facts to the first HTML response before React enhances it. */
async function servePublicDocument(
  request: Request,
  env: Env,
): Promise<Response> {
  const response = await serveAsset(request, env.ASSETS);
  if (
    request.method !== "GET" ||
    response.status !== 200 ||
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("text/html")
  ) {
    return response;
  }
  let readable: Awaited<ReturnType<typeof galleryReadableDocument>>;
  try {
    readable = await galleryReadableDocument(request, env);
  } catch {
    // The interactive application remains available during a Gallery read outage.
    return response;
  }
  if (!readable) return response;
  const shell = await response.text();
  const html = injectGalleryReadableDocument(shell, readable);
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");
  headers.set(
    "cache-control",
    "public, max-age=60, stale-while-revalidate=300",
  );
  return new Response(html, { status: response.status, headers });
}
