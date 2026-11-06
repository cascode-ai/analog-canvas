import type { GalleryEnv } from "./gallery-store";
import { bearerMatches } from "./bearer";
import { decodeProjectEvent, MAX_SYNC_BYTES } from "./project-sync-protocol";
import type { ProjectEvent, ProjectSyncStatus } from "./project-sync-journal";
import { readSyncJson, peerOrigin } from "./project-sync-http";

/** Only a separately scoped peer credential can read private replication events. */
export async function routeProjectSync(
  request: Request,
  env: GalleryEnv,
): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith("/api/project-sync/"))
    return null;
  try {
    const response = await handleProjectSync(request, env);
    if (!response) return null;
    const result = new Response(response.body, response);
    result.headers.set("cache-control", "no-store");
    return result;
  } catch (error) {
    if (!(
      error instanceof RangeError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    ))
      throw error;
    return Response.json(
      { error: error instanceof RangeError ? "too-large" : "invalid-event" },
      {
        status: error instanceof RangeError ? 413 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

async function handleProjectSync(
  request: Request,
  env: GalleryEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/project-sync/")) return null;
  if (!env.PROJECTS || !env.PROJECT_SYNC_TOKEN)
    return Response.json({ error: "not-found" }, { status: 404 });
  if (url.pathname === "/api/project-sync/seed" && request.method === "POST") {
    if (!bearerMatches(request, env.PROJECT_SYNC_ADMIN_TOKEN))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    return projectStore(env, "sync-seed", {});
  }
  if (url.pathname === "/api/project-sync/run" && request.method === "POST") {
    if (!bearerMatches(request, env.PROJECT_SYNC_ADMIN_TOKEN))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(await pumpProjectSync(env), {
      headers: { "cache-control": "no-store" },
    });
  }
  if (!bearerMatches(request, env.PROJECT_SYNC_TOKEN))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (url.pathname === "/api/project-sync/pull" && request.method === "POST")
    return projectStore(env, "sync-pull", await readSyncJson(request, 4096));
  if (url.pathname === "/api/project-sync/quota" && request.method === "POST") {
    const body = (await readSyncJson(request, 4096)) as {
      id?: unknown;
      ownerUserId?: unknown;
    } | null;
    if (
      !body ||
      typeof body.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(body.id) ||
      typeof body.ownerUserId !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(body.ownerUserId)
    )
      return Response.json({ error: "invalid-reservation" }, { status: 400 });
    const denied = await requireProjectOwner(env, body.ownerUserId);
    if (denied) return denied;
    return projectStore(env, "sync-quota", body);
  }
  if (url.pathname === "/api/project-sync/status" && request.method === "GET") {
    const response = await projectStore(env, "sync-status", {});
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/project-sync/events"
  ) {
    if (!env.PROJECT_IDENTITY_URL || !env.PROJECT_IDENTITY_TOKEN)
      return Response.json({ error: "identity-unavailable" }, { status: 503 });
    const input = (await readSyncJson(request, MAX_SYNC_BYTES * 2)) as {
      event?: unknown;
    } | null;
    const decoded = await decodeProjectEvent(input?.event);
    if (!decoded)
      return Response.json({ error: "invalid-event" }, { status: 400 });
    const denied = await requireProjectOwner(env, decoded.change.ownerUserId);
    if (denied) return denied;
    return env.PROJECTS.getByName(env.PROJECTS_STORE_NAME ?? "projects").fetch(
      "https://projects/sync-receive",
      { method: "POST", body: JSON.stringify({ event: decoded.event }) },
    );
  }
  if (request.method !== "GET" || url.pathname !== "/api/project-sync/events")
    return Response.json({ error: "not-found" }, { status: 404 });
  const response = await env.PROJECTS.getByName(
    env.PROJECTS_STORE_NAME ?? "projects",
  ).fetch("https://projects/sync-events", {
    method: "POST",
    body: JSON.stringify({
      after: Number(url.searchParams.get("after") ?? 0),
    }),
  });
  const result = new Response(response.body, response);
  result.headers.set("cache-control", "no-store");
  return result;
}

function projectStore(
  env: GalleryEnv,
  operation: string,
  body: unknown,
): Promise<Response> {
  return env
    .PROJECTS!.getByName(env.PROJECTS_STORE_NAME ?? "projects")
    .fetch(`https://projects/${operation}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
}

/** One bounded delivery per tick. A lost response is retried from durable peer state. */
export async function pumpProjectSync(env: GalleryEnv): Promise<{
  status: "disabled" | "caught-up" | "sent" | "retry" | "blocked";
}> {
  const pulled =
    env.PROJECT_SYNC_PULL === "true" ? await pullProjectSync(env) : null;
  let result =
    pulled?.status === "retry" || pulled?.status === "blocked"
      ? pulled
      : await deliverProjectSync(env);
  if (result.status === "caught-up" && pulled?.status === "sent")
    result = pulled;
  if (env.PROJECTS) await projectStore(env, "sync-delivery", result);
  return result;
}

/** Fetch one ordered peer event without exposing an inbound domestic endpoint. */
async function pullProjectSync(
  env: GalleryEnv,
): Promise<{ status: "sent" | "caught-up" | "retry" | "blocked" }> {
  if (
    !env.PROJECTS ||
    !env.PROJECT_SYNC_PEER_URL ||
    !env.PROJECT_SYNC_PEER_TOKEN
  )
    return { status: "blocked" };
  try {
    const localResponse = await projectStore(env, "sync-status", {});
    if (!localResponse.ok) return { status: "blocked" };
    const response = await fetch(
      new URL("/api/project-sync/pull", peerOrigin(env.PROJECT_SYNC_PEER_URL)),
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${env.PROJECT_SYNC_PEER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: await localResponse.json() }),
      },
    );
    if (!response.ok)
      return { status: response.status >= 500 ? "retry" : "blocked" };
    const result = (await readSyncJson(
      response,
      MAX_SYNC_BYTES * 2 + 4096,
    )) as { peer?: ProjectSyncStatus; events?: unknown[] } | null;
    if (!result || !Array.isArray(result.events) || result.events.length > 1)
      return { status: "blocked" };
    const reconciled = await projectStore(env, "sync-reconcile", {
      peer: result.peer,
    });
    if (!reconciled.ok) return { status: "blocked" };
    if (!result.events.length) return { status: "caught-up" };
    const decoded = await decodeProjectEvent(result.events[0]);
    if (!decoded) return { status: "blocked" };
    const denied = await requireProjectOwner(env, decoded.change.ownerUserId);
    if (denied) return { status: denied.status >= 500 ? "retry" : "blocked" };
    const received = await projectStore(env, "sync-receive", {
      event: decoded.event,
    });
    return {
      status: received.ok
        ? "sent"
        : received.status >= 500
          ? "retry"
          : "blocked",
    };
  } catch {
    return { status: "retry" };
  }
}

async function deliverProjectSync(env: GalleryEnv): Promise<{
  status: "disabled" | "caught-up" | "sent" | "retry" | "blocked";
}> {
  if (
    !env.PROJECTS ||
    !env.PROJECT_SYNC_PEER_URL ||
    !env.PROJECT_SYNC_PEER_TOKEN
  )
    return { status: "disabled" };
  try {
    const peer = peerOrigin(env.PROJECT_SYNC_PEER_URL);
    const headers = {
      Authorization: `Bearer ${env.PROJECT_SYNC_PEER_TOKEN}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(new URL("/api/project-sync/status", peer), {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      return { status: response.status >= 500 ? "retry" : "blocked" };
    const remote = (await readSyncJson(response, 4096)) as ProjectSyncStatus;
    const local = (await (
      await projectStore(env, "sync-status", {})
    ).json()) as ProjectSyncStatus;
    const reconciled = await projectStore(env, "sync-reconcile", {
      peer: remote,
    });
    if (!reconciled.ok) return { status: "blocked" };
    if (
      !["cn", "overseas"].includes(remote.origin) ||
      remote.origin === local.origin ||
      (remote.received &&
        (remote.received.epoch !== local.epoch ||
          remote.received.origin !== local.origin ||
          !Number.isSafeInteger(remote.received.sequence) ||
          remote.received.sequence < 0))
    )
      return { status: "blocked" };
    const after = remote.received?.sequence ?? 0;
    const exported = await projectStore(env, "sync-events", { after });
    if (!exported.ok) return { status: "blocked" };
    const { events } = (await exported.json()) as { events: ProjectEvent[] };
    if (!events.length) {
      const ack = await projectStore(env, "sync-ack", {
        epoch: local.epoch,
        sequence: after,
      });
      return { status: ack.ok ? "caught-up" : "blocked" };
    }
    const event = events[0]!;
    const sent = await fetch(new URL("/api/project-sync/events", peer), {
      method: "POST",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ event }),
    });
    if (!sent.ok) return { status: sent.status >= 500 ? "retry" : "blocked" };
    const received = (await readSyncJson(sent, 4096)) as {
      epoch: string;
      acknowledged: number;
    };
    if (
      received.epoch !== local.epoch ||
      !Number.isSafeInteger(received.acknowledged) ||
      received.acknowledged < event.sequence
    )
      return { status: "blocked" };
    const ack = await projectStore(env, "sync-ack", {
      epoch: received.epoch,
      sequence: received.acknowledged,
    });
    return { status: ack.ok ? "sent" : "blocked" };
  } catch {
    return { status: "retry" };
  }
}

async function requireProjectOwner(
  env: GalleryEnv,
  ownerUserId: string,
): Promise<Response | null> {
  if (!env.PROJECT_IDENTITY_URL || !env.PROJECT_IDENTITY_TOKEN)
    return Response.json({ error: "identity-unavailable" }, { status: 503 });
  try {
    const identityUrl = new URL(env.PROJECT_IDENTITY_URL);
    if (
      identityUrl.protocol !== "https:" ||
      identityUrl.username ||
      identityUrl.password
    )
      throw new Error("Invalid identity endpoint");
    const identity = await fetch(identityUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${env.PROJECT_IDENTITY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userIds: [ownerUserId] }),
    });
    if (!identity.ok) throw new Error("Identity unavailable");
    const result = (await readSyncJson(identity, 16384)) as {
      identities?: { id: string; status: string; user?: { id: string } }[];
    };
    const owner = result.identities?.find((item) => item.id === ownerUserId);
    if (owner?.status !== "found" || owner.user?.id !== ownerUserId)
      return Response.json({ error: "unknown-owner" }, { status: 409 });
  } catch {
    return Response.json({ error: "identity-unavailable" }, { status: 503 });
  }
  return null;
}
