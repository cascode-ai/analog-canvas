import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { gallerySourceOfEntryId, galleryStoreName } from "./gallery-sources";
import { catchUpResource } from "./resource-action-catchup";
import type { ResourceActionEnv } from "./regional-resource-actions";

type Command = {
  entryId: string;
  reviewId: string;
  target: string;
  commandId: string;
};
const peerPath = "/api/resource-actions/review-resolution";
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(value);
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);

/** A review's resolution is written by the region that holds that review, not the circuit. */
export async function routeRegionalReviewActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === peerPath;
  const match =
    /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/reviews\/([A-Za-z0-9_-]{3,64})$/.exec(
      url.pathname,
    );
  if (!incoming && (!match || request.method !== "PATCH")) return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (incoming && request.method !== "POST")
    return fail("method-not-allowed", 405);
  let committed = false;
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return fail("action-not-configured", 503);
    const auth = (operation: string, body: unknown) =>
      env
        .AUTH!.getByName("auth")
        .fetch("https://auth/internal/resource-action-" + operation, {
          method: "POST",
          headers: { cookie: request.headers.get("cookie") ?? "" },
          body: JSON.stringify(body),
        });
    let command: Command, user: SessionUser | null;
    if (incoming) {
      const body = (await readSyncJson(
        request,
        8192,
      )) as Partial<Command> | null;
      if (
        !body ||
        !validId(body.entryId) ||
        !validId(body.reviewId) ||
        body.target !== env.RESOURCE_REGION ||
        typeof body.commandId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.commandId)
      )
        return fail("invalid-command", 400);
      command = {
        entryId: body.entryId,
        reviewId: body.reviewId,
        target: body.target,
        commandId: body.commandId,
      };
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
    } else {
      if (!sameOrigin(request)) return fail("forbidden", 403);
      user = await sessionUserOf(request, env);
      if (!user) return fail("sign-in-required", 401);
      if (!user.isOwner) return fail("owner-only", 403);
      const body = (await readSyncJson(request, 8192).catch(() => null)) as {
        resolved?: unknown;
      } | null;
      if (body?.resolved !== true) return fail("invalid-fields", 400);
      const commandId =
        request.headers.get("idempotency-key") ??
        (await digest(
          JSON.stringify({
            actor: user.id,
            entryId: match![1],
            reviewId: match![2],
            operation: "resolve",
          }),
        ));
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(commandId))
        return fail("invalid-command-id", 400);
      command = {
        entryId: match![1]!,
        reviewId: match![2]!,
        target: "",
        commandId,
      };
    }
    if (!user?.isOwner) return fail("owner-only", 403);
    const source = gallerySourceOfEntryId(command.entryId);
    const stream = `${source?.key ?? "gallery"}-interactions`;
    const store = env.GALLERY.getByName(galleryStoreName(source));
    const call = (operation: string, body: unknown) =>
      store.fetch("https://gallery/" + operation, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const location = await call("resource-sync/location", {
      stream,
      id: command.reviewId,
    });
    if (!location.ok) return location;
    const local = (await location.json()) as { origin: string; known: boolean };
    let origin = local.origin;
    if (!local.known && !incoming) {
      if (!env.RESOURCE_SYNC_PEER_TOKEN) return fail("writer-unconfirmed", 503);
      const response = await fetch(
        `${peer.origin}/api/resource-sync/${stream}/location?id=${encodeURIComponent(command.reviewId)}`,
        {
          redirect: "manual",
          signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
          headers: { authorization: "Bearer " + env.RESOURCE_SYNC_PEER_TOKEN },
        },
      );
      if (!response.ok) return fail("writer-unconfirmed", 503);
      const remote = (await readSyncJson(response, 4096)) as {
        known?: unknown;
        origin?: unknown;
      } | null;
      if (
        !remote ||
        typeof remote.known !== "boolean" ||
        !["cn", "overseas"].includes(String(remote.origin))
      )
        return fail("writer-unconfirmed", 503);
      if (!remote.known) return fail("not-found", 404);
      if (remote.origin === env.RESOURCE_REGION)
        return fail("writer-state-missing", 503);
      origin = String(remote.origin);
    }
    if (!incoming) command.target = origin;
    const binding = await digest(JSON.stringify(command));
    const input = { ...command, user, userId: user.id, binding };
    if (incoming || command.target === env.RESOURCE_REGION) {
      if (origin !== env.RESOURCE_REGION) return fail("wrong-writer", 409);
      const response = await call("review-command", input);
      if (!response.ok) return response;
      const result = await response.json();
      if (!incoming)
        return result.superseded
          ? fail("action-superseded", 409)
          : answer({ ok: true });
      const head = await (
        await call("resource-sync/status", { stream })
      ).json();
      return answer({ ...result, epoch: head.epoch, sequence: head.sequence });
    }
    const authorized = await auth("authorize", { binding });
    if (!authorized.ok)
      return fail("authorization-unavailable", authorized.status);
    const { token } = await authorized.json();
    const response = await fetch(peer.origin + peerPath, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    const result = (await readSyncJson(response, 8192)) as {
      state: string;
      superseded: boolean;
      epoch: string;
      sequence: number;
    };
    if (
      typeof result?.state !== "string" ||
      typeof result.epoch !== "string" ||
      !Number.isSafeInteger(result.sequence)
    )
      return fail("action-unconfirmed", 503);
    committed = true;
    if (
      !(await catchUpResource(
        call,
        stream,
        peer.origin,
        env.RESOURCE_SYNC_PEER_TOKEN,
        result,
      ))
    )
      return fail("action-propagation-pending", 503);
    const current = await call("review-command-state", input);
    if (!current.ok) return fail("action-propagation-pending", 503);
    const state = await current.json();
    return result.superseded || !state.resolved || state.state !== result.state
      ? fail("action-superseded", 409)
      : answer({ ok: true });
  } catch {
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}
