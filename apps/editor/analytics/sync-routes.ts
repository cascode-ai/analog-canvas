import { bearerMatches } from "../../../worker/bearer";
import type { AnalyticsRouteEnv } from "./routes";
import {
  ANALYTICS_PERSISTENCE_IDENTITY,
  type AnalyticsSummary,
} from "./worker";
import type {
  AnalyticsStatus,
  AnalyticsBatch,
  AnalyticsReceipt,
  AnalyticsBaseline,
} from "./replication";

const METHODS: Record<string, string> = {
  activate: "POST",
  prepare: "POST",
  seed: "POST",
  receive: "POST",
  ack: "POST",
  cache: "POST",
  tick: "POST",
  status: "GET",
  baseline: "GET",
  batch: "GET",
  summary: "GET",
};
const ADMIN = new Set(["activate", "ack", "cache", "tick"]);
const AUTHORITY = new Set(["prepare", "seed", "receive", "summary"]);

class SyncTransportError extends Error {
  constructor(readonly status: number) {
    super("analytics-sync-unavailable");
  }
}

function storeCall(
  env: AnalyticsRouteEnv,
  operation: string,
  body?: unknown,
): Promise<Response> {
  return env.ANALYTICS.getByName(
    ANALYTICS_PERSISTENCE_IDENTITY.objectName,
  ).fetch("https://analytics.internal/sync/" + operation, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function bodyOf<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new SyncTransportError(response.status === 409 ? 409 : 503);
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new SyncTransportError(503);
  return JSON.parse(text);
}

async function peerCall<T>(
  env: AnalyticsRouteEnv,
  operation: string,
  body?: unknown,
): Promise<T> {
  if (!env.PROJECT_SYNC_PEER_URL || !env.PROJECT_SYNC_PEER_TOKEN)
    throw new SyncTransportError(503);
  const url = new URL(
    "/api/analytics-sync/" + operation,
    env.PROJECT_SYNC_PEER_URL,
  );
  if (url.protocol !== "https:" || url.username || url.password)
    throw new SyncTransportError(503);
  return bodyOf<T>(
    await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + env.PROJECT_SYNC_PEER_TOKEN,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }),
  );
}

async function tick(env: AnalyticsRouteEnv): Promise<Response> {
  let status = await bodyOf<AnalyticsStatus>(await storeCall(env, "status"));
  if (status.mode !== "collector") return Response.json(status);
  if (!status.seeded) {
    const baseline = await bodyOf<AnalyticsBaseline>(
      await storeCall(env, "baseline"),
    );
    const receipt = await peerCall<AnalyticsReceipt>(env, "seed", baseline);
    await bodyOf(await storeCall(env, "ack", receipt));
  }
  const batch = await bodyOf<AnalyticsBatch>(await storeCall(env, "batch"));
  if (batch.events.length) {
    const receipt = await peerCall<AnalyticsReceipt>(env, "receive", batch);
    await bodyOf(await storeCall(env, "ack", receipt));
  } else {
    const summary = await peerCall<AnalyticsSummary>(env, "summary");
    await bodyOf(await storeCall(env, "cache", summary));
  }
  status = await bodyOf<AnalyticsStatus>(await storeCall(env, "status"));
  return Response.json(status);
}

/** Private peer/admin operations; normal tracking and reads never call tick. */
export async function routeAnalyticsSync(
  request: Request,
  env: AnalyticsRouteEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    prefix = "/api/analytics-sync/";
  if (!url.pathname.startsWith(prefix)) return null;
  const operation = url.pathname.slice(prefix.length);
  if (!Object.hasOwn(METHODS, operation))
    return Response.json({ error: "not-found" }, { status: 404 });
  const credential = ADMIN.has(operation)
    ? env.PROJECT_SYNC_ADMIN_TOKEN
    : env.PROJECT_SYNC_TOKEN;
  if (!bearerMatches(request, credential))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (request.method !== METHODS[operation])
    return Response.json(
      { error: "method-not-allowed" },
      { status: 405, headers: { Allow: METHODS[operation]! } },
    );
  if (
    (ADMIN.has(operation) && env.PROJECT_REGION !== "cn") ||
    (AUTHORITY.has(operation) && env.PROJECT_REGION === "cn")
  )
    return Response.json({ error: "wrong-region" }, { status: 409 });
  try {
    if (operation === "tick") return await tick(env);
    const text = request.method === "POST" ? await request.text() : undefined;
    if (text && text.length > 1024 * 1024)
      return Response.json({ error: "payload-too-large" }, { status: 413 });
    const response = await storeCall(
      env,
      operation,
      text === undefined ? undefined : JSON.parse(text),
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof SyncTransportError && error.status === 409
            ? "analytics-sync-blocked"
            : "analytics-sync-retry",
      },
      { status: error instanceof SyncTransportError ? error.status : 503 },
    );
  }
}
