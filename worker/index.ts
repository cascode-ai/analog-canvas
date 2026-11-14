import { routeAgentRegion } from "./agent-regional-routing";
import {
  browserSessionNamespace,
  routeBrowserSessionPeer,
} from "./regional-browser-session";
import { ACCOUNT_DELETION_TICK } from "./account-deletions";
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
import { isAppPagePath } from "../apps/editor/src/page-routes";
import { routeGalleryRequest } from "./gallery";
import { pumpProjectSync } from "./project-sync";
import { routeResourceSync, type ResourceSyncEnv } from "./resource-sync";
import { withResourceReplication } from "./resource-replica";
import {
  routeRegionalResourceActions,
  type ResourceActionEnv,
} from "./regional-resource-actions";
export { RegionalProjectDO } from "./regional-projects";
import { routeBoardsRequest } from "./boards";
import {
  galleryReadableDocument,
  type GalleryReadableDocument,
} from "./gallery-documents";
import {
  moveTestbenches,
  refreshNetlistMarks,
  refreshGalleryStatistics,
} from "./gallery-maintenance";
import { advanceSimulationChecks } from "./gallery-simulation-check-runs";
import type { GalleryNamespaceLike, GalleryEnv } from "./gallery-store";
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
import { watchRegionalPulls } from "./regional-watchdog";
import {
  routeRegionalRelease,
  type RegionalReleaseEnv,
} from "./regional-release";

// The stores that keep durable data also answer point-in-time recovery. The
// export names are the deployed class names, so they must not change.
export const ComponentLibraryDO = withPointInTimeRecovery(
  withResourceReplication(ComponentLibraryStore, "components"),
);
export const AnalyticsDO = withPointInTimeRecovery(AnalyticsStore);
export const GalleryDO = withPointInTimeRecovery(
  withResourceReplication(GalleryStore, "gallery"),
);
export const AuthDO = withPointInTimeRecovery(AuthStore);
export { RegionalSessionDO } from "./regional-session";
export { AgentSessionDO } from "./agent-session";
export { SimulationControlDO } from "./simulation-control-do";

type Env = TopologyTaskEnv &
  ResourceActionEnv &
  RegionalReleaseEnv &
  ResourceSyncEnv &
  GalleryEnv &
  ComponentLibraryEnv &
  SimulationEnv &
  SimulationOperationsEnv & {
    ASSETS: { fetch(request: Request): Promise<Response> };
    AGENT_SESSION: AgentSessionNamespaceLike;
    AGENT_ALLOWED_ORIGIN?: string;
    AGENT_MCP_DOWNLOAD_ORIGIN?: string;
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
    if (env.AUTH_REGIONAL_CLIENT || env.AUTH_REGIONAL_AUTHORITY) {
      const cleanup = await env.AUTH.getByName("auth")
        .fetch("https://auth" + ACCOUNT_DELETION_TICK, { method: "POST" })
        .catch(() => null);
      if (!cleanup?.ok) console.warn("account-deletion: cleanup pending");
    }
    if (env.PROJECTS) {
      const result = await pumpProjectSync(env);
      if (result.status === "blocked" || result.status === "retry")
        console.warn("project-sync", result.status);
    }
    try {
      await refreshNetlistMarks(env, SCHEDULED_NETLIST_MARK_BATCH);
      // Every Gallery store, the datasets' too, counts its devices and its
      // Statistics figures ahead of the reads.
      await refreshGalleryStatistics(env, SCHEDULED_TRANSISTOR_BATCH);
      // Once the Owner recorded a backup, testbenches leave the shared
      // Project Code a batch a tick (#1545); then the pass reads one row.
      await moveTestbenches(env, { apply: true, scheduled: true });
    } finally {
      // The simulation checks the Owner queued (#1545) take the rest of
      // the tick, one folder at a time; with none queued, one read.
      await advanceSimulationChecks(env);
      await watchRegionalPulls(env).catch(() => null);
    }
  },
};

/** Batch size per tick: large enough to converge quickly, small enough to stay well inside one invocation. */
const SCHEDULED_NETLIST_MARK_BATCH = 50;
/** Counting reads only the Project, so a batch can be larger. */
const SCHEDULED_TRANSISTOR_BATCH = 100;

type ScheduledEventLike = { scheduledTime: number; cron: string };

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // The Arena host serves only AnalogArena; the former /arena pages move there.
  const hostRedirect = routeArenaHosts(request);
  if (hostRedirect) return hostRedirect;

  // Authenticate the fixed peer before the per-client flood limiter: all
  // remote sessions otherwise share one server IP. Session limits still apply.
  const agentPeer = await routeAgentRegion(request, env);
  if (agentPeer) return agentPeer;
  const sessionPeer = await routeBrowserSessionPeer(request, env);
  if (sessionPeer) return sessionPeer;
  env = { ...env, AUTH: browserSessionNamespace(env) };
  const flood = await refuseApiFlood(request, env);
  if (flood) return flood;

  const release = await routeRegionalRelease(request, env);
  if (release) return release;

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
  const resourceSyncResponse = await routeResourceSync(request, env);
  if (resourceSyncResponse) return resourceSyncResponse;
  const resourceActionResponse = await routeRegionalResourceActions(
    request,
    env,
  );
  if (resourceActionResponse) return resourceActionResponse;

  const topologyResponse = await routeTopologyTaskRequest(request, env);
  if (topologyResponse) return topologyResponse;

  const boardsResponse = await routeBoardsRequest(request, env);
  if (boardsResponse) return boardsResponse;

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

/** The app shell's mark: what the asset layer answers a path with no file. */
const APP_SHELL_MARK = '<div id="root"></div>';

/** A path no page serves: a small page home, never the app (#2159). */
function pageNotFound(method: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found — Analog Canvas</title>
<style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#f6f5f2}
main{max-width:36rem;margin:15vh auto;padding:0 20px}
h1{margin:0 0 8px;font-size:22px}
p{margin:0 0 16px;color:#5f6368}
a{color:#1570ef}
</style>
</head>
<body>
<main>
<h1>There is no page here.</h1>
<p>Check the link, or start from the Gallery.</p>
<p><a href="/">Back to the Gallery</a></p>
</main>
</body>
</html>
`;
  return new Response(method === "HEAD" ? null : html, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A path may become a page with the next deploy.
      "cache-control": "no-store",
    },
  });
}

/**
 * The asset layer answers every path without a file with the app shell. A
 * page the app serves keeps it; any other path is answered 404 (#2159).
 * Real HTML files (the PowerPoint add-in's) are not the shell and pass.
 */
async function withoutStrayShell(
  request: Request,
  response: Response,
  env: Env,
): Promise<Response> {
  if (
    !["GET", "HEAD"].includes(request.method) ||
    response.status !== 200 ||
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("text/html") ||
    isAppPagePath(new URL(request.url).pathname)
  )
    return response;
  // A HEAD answer has no body to tell the shell by: read the same GET.
  const page =
    request.method === "HEAD"
      ? await serveAsset(new Request(request.url), env.ASSETS)
      : response;
  const text = await page.text();
  if (text.includes(APP_SHELL_MARK)) return pageNotFound(request.method);
  if (request.method === "HEAD") return response;
  // The text is decoded: it goes out with its own length and encoding.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(text, { status: response.status, headers });
}

/** Add real public Gallery facts to the first HTML response before React enhances it. */
async function servePublicDocument(
  request: Request,
  env: Env,
): Promise<Response> {
  const response = await withoutStrayShell(
    request,
    await serveAsset(request, env.ASSETS),
    env,
  );
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
