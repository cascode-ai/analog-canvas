import type { GalleryEnv } from "./gallery-store";
import type { ResourceSyncEnv } from "./resource-sync";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, readBody, sessionIdentity } from "./regional-auth-contract";
import { sameOrigin } from "./same-origin";
import { readSyncJson } from "./project-sync-http";
import { RESOURCE_MAX_BYTES } from "./resource-replica";
import { gallerySourceOfEntryId, gallerySourceByKey } from "./gallery-sources";

export type ResourceActionEnv = GalleryEnv &
  ResourceSyncEnv & {
    RESOURCE_ACTION_PEER?: string;
    RESOURCE_SYNC_PEER_TOKEN?: string;
  };

export async function routeRegionalResourceActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const peerPath = "/api/resource-actions/lifecycle";
  const incoming = url.pathname === peerPath;
  const match =
    /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/(recycle|restore)$/.exec(
      url.pathname,
    );
  if (!incoming && (!match || request.method !== "POST")) return null;
  if (
    !incoming &&
    (gallerySourceOfEntryId(match![1]!) ||
      gallerySourceByKey(url.searchParams.get("source")))
  )
    return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (request.method !== "POST") return fail("method-not-allowed", 405);
  let peer: URL;
  try {
    peer = new URL(env.RESOURCE_ACTION_PEER);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return fail("action-not-configured", 503);
  } catch {
    return fail("action-not-configured", 503);
  }
  const store = env.GALLERY.getByName("gallery");
  const call = (operation: string, body: unknown) =>
    store.fetch("https://gallery/" + operation, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const auth = async (operation: string, body: unknown) =>
    env
      .AUTH!.getByName("auth")
      .fetch("https://auth/internal/resource-action-" + operation, {
        method: "POST",
        headers: { cookie: request.headers.get("cookie") ?? "" },
        body: JSON.stringify(body),
      });
  let committed = false;
  try {
    let command: {
      id: string;
      action: string;
      commandId: string;
      target: string;
    };
    let user: SessionUser | null;
    if (incoming) {
      const body = await readBody(request);
      if (
        !body ||
        typeof body.id !== "string" ||
        !/^[A-Za-z0-9_-]{3,64}$/.test(body.id) ||
        !["recycle", "restore"].includes(String(body.action)) ||
        typeof body.commandId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.commandId) ||
        body.target !== env.RESOURCE_REGION
      )
        return fail("invalid-command", 400);
      command = {
        id: body.id,
        action: String(body.action),
        commandId: body.commandId,
        target: env.RESOURCE_REGION,
      };
      if (gallerySourceOfEntryId(command.id))
        return fail("dataset-read-only", 403);
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
    } else {
      if (!sameOrigin(request)) return fail("forbidden", 403);
      user = await sessionUserOf(request, env);
      if (!user) return fail("unauthorized", 401);
      const key = request.headers.get("idempotency-key") ?? crypto.randomUUID();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
        return fail("invalid-command-id", 400);
      const location = await call("resource-sync/location", {
        stream: "gallery",
        id: match![1],
      });
      if (!location.ok) return location;
      command = {
        id: match![1]!,
        action: match![2]!,
        commandId: key,
        target: (await location.json()).origin,
      };
    }
    if (!user) return fail("unauthorized", 401);
    const binding = await digest(JSON.stringify(command));
    if (incoming || command.target === env.RESOURCE_REGION) {
      const location = await call("resource-sync/location", {
        stream: "gallery",
        id: command.id,
      });
      if ((await location.json()).origin !== env.RESOURCE_REGION)
        return fail("wrong-writer", 409);
      const response = await call("lifecycle-command", {
        ...command,
        binding,
        user,
        userId: user.id,
      });
      if (!response.ok) return response;
      const outcome = await response.json();
      if (!incoming)
        return outcome.superseded
          ? fail("action-superseded", 409)
          : answer({ id: outcome.id, status: outcome.status });
      const status = await call("resource-sync/status", { stream: "gallery" });
      const head = await status.json();
      return answer({
        ...outcome,
        sequence: head.sequence,
        epoch: head.epoch,
      });
    }
    const authorization = await auth("authorize", { binding });
    if (!authorization.ok)
      return fail("authorization-unavailable", authorization.status);
    const { token } = await authorization.json();
    const response = await fetch(peer.origin + peerPath, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return new Response(response.body, {
        status: response.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      });
    const result = (await readSyncJson(response, 8192)) as {
      id: string;
      status: string;
      superseded?: boolean;
      epoch: string;
      sequence: number;
    };
    if (
      result.id !== command.id ||
      !Number.isSafeInteger(result.sequence) ||
      typeof result.epoch !== "string"
    )
      return fail("action-unconfirmed", 503);
    committed = true;
    // Catch up through the existing ordered protocol; never apply an out-of-order command snapshot.
    const until = Date.now() + 20_000;
    for (let attempts = 0; attempts < 64 && Date.now() < until; attempts++) {
      const status = await call("resource-sync/status", { stream: "gallery" });
      const received = (await status.json()).received;
      if (
        received?.epoch === result.epoch &&
        received.sequence >= result.sequence
      ) {
        const current = await call("preview-access", { id: result.id });
        if (!current.ok && current.status !== 404)
          return fail("action-propagation-pending", 503);
        return result.superseded ||
          !current.ok ||
          (await current.json()).status !== result.status
          ? fail("action-superseded", 409)
          : answer({ id: result.id, status: result.status });
      }
      if (received && received.epoch !== result.epoch)
        return fail("action-propagation-pending", 503);
      if (!env.RESOURCE_SYNC_PEER_TOKEN)
        return fail("action-propagation-pending", 503);
      const next = await fetch(
        peer.origin +
          "/api/resource-sync/gallery/changes?after=" +
          (received?.sequence ?? 0),
        {
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, until - Date.now())),
          headers: { authorization: "Bearer " + env.RESOURCE_SYNC_PEER_TOKEN },
        },
      );
      if (!next.ok) return fail("action-propagation-pending", 503);
      const envelope = await readSyncJson(next, RESOURCE_MAX_BYTES * 2);
      const applied = await call("resource-sync/receive", {
        stream: "gallery",
        envelope,
      });
      if (!applied.ok) {
        // The background runner can have committed a later receipt during this fetch.
        const current = await (
          await call("resource-sync/status", { stream: "gallery" })
        ).json();
        if (
          current.received?.epoch !== result.epoch ||
          current.received.sequence <= (received?.sequence ?? 0)
        )
          return fail("action-propagation-pending", 503);
      }
    }
    return fail("action-propagation-pending", 503);
  } catch {
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}

function answer(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
function fail(error: string, status: number): Response {
  return answer({ error }, status);
}
