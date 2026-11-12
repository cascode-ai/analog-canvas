import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { gallerySourceOfEntryId, galleryStoreName } from "./gallery-sources";
import { catchUpResource } from "./resource-action-catchup";
import type { ResourceActionEnv } from "./regional-resource-actions";
import type { LikeCommand } from "./gallery-like-command";
import { validAccountId } from "./retired-accounts";

const peerPath = "/api/resource-actions/like";
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function readCommand(value: unknown): LikeCommand | null {
  const body = value as Partial<LikeCommand> | null;
  if (
    !body ||
    !validAccountId(body.actorId) ||
    !validId(body.entryId) ||
    body.entryId.length > 64 ||
    !validId(body.commandId) ||
    !["cn", "overseas"].includes(String(body.target)) ||
    typeof body.expected !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.expected) ||
    typeof body.take !== "boolean" ||
    typeof body.owner !== "boolean"
  )
    return null;
  return {
    actorId: body.actorId,
    entryId: body.entryId,
    commandId: body.commandId,
    target: body.target!,
    expected: body.expected,
    take: body.take,
    owner: body.owner,
  };
}

export async function routeRegionalLikeActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === peerPath;
  const match = /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/like(\/intent)?$/.exec(
    url.pathname,
  );
  if (!incoming && (!match || request.method !== "POST")) return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (request.method !== "POST") return fail("method-not-allowed", 405);
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
    let command: LikeCommand, user: SessionUser | null, entryId: string;
    if (incoming) {
      const body = readCommand(await readSyncJson(request, 8192));
      if (!body || body.target !== env.RESOURCE_REGION)
        return fail("invalid-command", 400);
      command = body;
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
      entryId = command.entryId;
    } else {
      if (!sameOrigin(request)) return fail("forbidden", 403);
      user = await sessionUserOf(request, env);
      entryId = match![1]!;
    }
    if (!user) return fail("sign-in-required", 401);
    const source = gallerySourceOfEntryId(entryId),
      stream = `${source?.key ?? "gallery"}-interactions`;
    const store = env.GALLERY.getByName(galleryStoreName(source));
    const call = (operation: string, body: unknown) =>
      store.fetch("https://gallery/" + operation, {
        method: "POST",
        body: JSON.stringify(body),
      });
    if (!incoming) {
      const commandId =
        request.headers.get("idempotency-key") ?? crypto.randomUUID();
      if (!validId(commandId)) return fail("invalid-command-id", 400);
      const input = request.body
        ? ((await readSyncJson(request, 8192)) as { command?: unknown } | null)
        : null;
      if (input?.command !== undefined && !match![2]) {
        const supplied = readCommand(input.command);
        if (
          !supplied ||
          supplied.entryId !== entryId ||
          supplied.commandId !== commandId ||
          supplied.take !== (url.searchParams.get("take") === "1")
        )
          return fail("invalid-command", 400);
        command = supplied;
      } else {
        const prepared = await call("like-command-prepare", {
          entryId,
          commandId,
          take: url.searchParams.get("take") === "1",
          user,
          userId: user.id,
        });
        if (!prepared.ok) return prepared;
        command = await prepared.json();
      }
      if (match![2]) return answer(command!);
    }
    if (command!.actorId !== user.id) return fail("account-changed", 403);
    const binding = await digest(JSON.stringify(command!));
    const input = { ...command!, user, userId: user.id, binding };
    if (incoming || command!.target === env.RESOURCE_REGION) {
      const response = await call("like-command", input);
      if (!response.ok) return response;
      const result = await response.json();
      if (!incoming)
        return result.superseded
          ? fail("action-superseded", 409)
          : answer({
              likes: result.likes,
              likedByViewer: result.likedByViewer,
            });
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
      body: JSON.stringify(command!),
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
    const current = await call("like-command-state", input);
    if (!current.ok) return fail("action-propagation-pending", 503);
    const now = await current.json();
    return result.superseded || now.state !== result.state
      ? fail("action-superseded", 409)
      : answer({ likes: now.likes, likedByViewer: now.likedByViewer });
  } catch {
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}
