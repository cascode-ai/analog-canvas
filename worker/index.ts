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
import { forgetEarlierOpens, routeGalleryRequest } from "./gallery";
import {
  galleryReadableDocument,
  type GalleryReadableDocument,
} from "./gallery-documents";
import { refreshNetlistMarks } from "./gallery-maintenance";
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
  } & AnalyticsRouteEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
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
    } finally {
      // The privacy notice promises yesterday's opens are gone the next
      // day, whatever became of the marks.
      await forgetEarlierOpens(env);
    }
  },
};

/** Batch size per tick: large enough to converge quickly, small enough to stay well inside one invocation. */
const SCHEDULED_NETLIST_MARK_BATCH = 50;

type ScheduledEventLike = { scheduledTime: number; cron: string };

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const conversion = await handleNetlistConversionRequest(request);
  if (conversion) return conversion;

  const agentResponse = await routeAgentSessionRequest(request, env);
  if (agentResponse) return agentResponse;

  const authResponse = await routeAuthRequest(request, env);
  if (authResponse) return authResponse;

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
  const response = await serveAsset(request, env);
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
