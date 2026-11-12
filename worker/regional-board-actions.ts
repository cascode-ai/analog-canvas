import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { sessionUserOf, type SessionUser } from "./auth";
import { sha256Hex } from "@icm/derived";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { catchUpResource } from "./resource-action-catchup";
import { entryIdOf, storeChanges, withViewer } from "./boards";
import type { ResourceActionEnv } from "./regional-resource-actions";

const peerPath = "/api/resource-actions/board";
const stream = "gallery-activity";
const answer = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
const fail = (error: string, status: number) => answer({ error }, status);
function boardId(actor: string, command: string) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = BigInt("0x" + sha256Hex(JSON.stringify([actor, command]))),
    id = "";
  for (let i = 0; i < 24; i++) {
    id += alphabet[Number(value % 62n)];
    value /= 62n;
  }
  return id;
}
type Command = {
  id: string;
  operation: "create" | "change";
  target: string;
  commandId: string;
  expectedRevision?: number;
  input: Record<string, unknown>;
};

/** Same Board permissions at either entrance; only the Board writer commits a batch. */
export async function routeRegionalBoardActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === peerPath;
  const match =
    /^\/api\/boards(?:\/([A-Za-z0-9]{24})(?:\/(changes|export|preview\/[^/]+))?)?$/.exec(
      url.pathname,
    );
  if (
    !incoming &&
    (!match || !(request.method === "GET" || request.method === "POST"))
  )
    return null;
  if (!env.RESOURCE_REGION || !env.RESOURCE_ACTION_PEER)
    return incoming ? fail("not-found", 404) : null;
  if (incoming && request.method !== "POST")
    return fail("method-not-allowed", 405);
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return fail("action-not-configured", 503);
    const call = (op: string, body: unknown) =>
      env.GALLERY.getByName("gallery").fetch("https://gallery/" + op, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const auth = (op: string, body: unknown) =>
      env
        .AUTH!.getByName("auth")
        .fetch("https://auth/internal/resource-action-" + op, {
          method: "POST",
          headers: { cookie: request.headers.get("cookie") ?? "" },
          body: JSON.stringify(body),
        });
    const locate = async (id: string) => {
      const current = await (
        await call("activity-board-location", { id })
      ).json();
      if (current.origin) return current.origin as string;
      const status = await fetch(
        `${peer.origin}/api/resource-sync/${stream}/status`,
        {
          redirect: "manual",
          signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
          headers: { authorization: "Bearer " + env.RESOURCE_SYNC_PEER_TOKEN },
        },
      );
      if (!status.ok) throw new Error("Activity discovery unavailable");
      const head = await status.json();
      if (
        head.sequence !== 0 &&
        !(await catchUpResource(
          call,
          stream,
          peer.origin,
          env.RESOURCE_SYNC_PEER_TOKEN,
          head,
        ))
      )
        throw new Error("Activity catch-up pending");
      return (await (await call("activity-board-location", { id })).json())
        .origin as string | null;
    };
    // A link may arrive before the background seed; discovery is only needed for
    // a missing Board. Existing Boards continue to read their local snapshot.
    if (!incoming && request.method === "GET") {
      if (match?.[1]) await locate(match[1]);
      return null;
    }
    if (!incoming && match?.[1] && match[2] !== "changes") return null;
    let command: Command, user: SessionUser | null;
    if (incoming) {
      const body = (await readSyncJson(request, 256 * 1024)) as Command;
      if (
        !body ||
        !/^[A-Za-z0-9]{24}$/.test(body.id) ||
        !["create", "change"].includes(body.operation) ||
        body.target !== env.RESOURCE_REGION ||
        typeof body.commandId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.commandId) ||
        !body.input ||
        typeof body.input !== "object" ||
        Array.isArray(body.input) ||
        (body.expectedRevision !== undefined &&
          (!Number.isSafeInteger(body.expectedRevision) ||
            body.expectedRevision < 1))
      )
        return fail("invalid-command", 400);
      command = body;
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
    } else {
      if (!sameOrigin(request)) return fail("cross-origin", 403);
      user = await sessionUserOf(request, env);
      if (!user) return fail("sign-in-required", 401);
      const body = (await readSyncJson(request, 256 * 1024)) as Record<
        string,
        unknown
      >;
      if (!body || typeof body !== "object" || Array.isArray(body))
        return fail("bad-request", 400);
      if (body.accountId !== undefined && body.accountId !== user.id)
        return fail("account-changed", 409);
      const operation = match![1] ? "change" : "create";
      if (operation === "create" && !user.isAdmin)
        return fail("admin-only", 403);
      const commandId =
        request.headers.get("idempotency-key") ?? crypto.randomUUID();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(commandId))
        return fail("invalid-command", 400);
      const id = match![1] ?? boardId(user.id, commandId);
      const changes =
        operation === "change" ? storeChanges(body.changes) : null;
      if (operation === "change" && !changes) return fail("bad-changes", 400);
      if (
        body.expectedRevision !== undefined &&
        (!Number.isSafeInteger(body.expectedRevision) ||
          Number(body.expectedRevision) < 1)
      )
        return fail("bad-revision", 400);
      const entries = Array.isArray(body.entries)
        ? body.entries.map(entryIdOf)
        : [];
      if (entries.some((id) => !id)) return fail("bad-entry", 400);
      command = {
        id,
        operation,
        target:
          operation === "create"
            ? id.charCodeAt(0) % 2 === 0
              ? "cn"
              : "overseas"
            : ((await locate(id)) ?? ""),
        commandId,
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: Number(body.expectedRevision) }),
        input:
          operation === "create"
            ? { title: body.title, slots: body.slots ?? 50, entries }
            : { changes },
      };
      if (!command.target) return fail("board-not-found", 404);
    }
    if (!user) return fail("unauthorized", 401);
    const binding = await digest(JSON.stringify(command));
    if (incoming || command.target === env.RESOURCE_REGION) {
      const references =
        command.operation === "create"
          ? command.input.entries
          : (command.input.changes as Record<string, unknown>[])
              .filter(
                (change) => change.kind === "add" || change.kind === "replace",
              )
              .map((change) => change.entryId);
      if (incoming && Array.isArray(references) && references.length) {
        const checked = await call("activity-board-references", {
          ids: references,
        });
        if (!checked.ok) return checked;
        if (!(await checked.json()).present) {
          const source = await fetch(
            `${peer.origin}/api/resource-sync/gallery/status`,
            {
              redirect: "manual",
              signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
              headers: {
                authorization: "Bearer " + env.RESOURCE_SYNC_PEER_TOKEN,
              },
            },
          );
          if (
            !source.ok ||
            !(await catchUpResource(
              call,
              "gallery",
              peer.origin,
              env.RESOURCE_SYNC_PEER_TOKEN,
              await source.json(),
            ))
          )
            return fail("publication-propagation-pending", 503);
        }
      }
      if (command.operation !== "create")
        await call("activity-board-location", { id: command.id });
      const response = await call("activity-board-command", {
        ...command,
        user,
        binding,
      });
      if (!response.ok) return response;
      const result = await response.json();
      if (!incoming) return answer(withViewer(result, user));
      const head = await (
        await call("resource-sync/status", { stream })
      ).json();
      return answer({
        revision: result.board.revision,
        epoch: head.epoch,
        sequence: head.sequence,
      });
    }
    const authorized = await auth("authorize", { binding });
    if (!authorized.ok)
      return fail("authorization-unavailable", authorized.status);
    const token = (await authorized.json()).token;
    const remote = await fetch(peer.origin + peerPath, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!remote.ok)
      return new Response(remote.body, {
        status: remote.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    const result = (await readSyncJson(remote, 8192)) as {
      epoch: string;
      sequence: number;
      revision: number;
    };
    if (
      !result ||
      typeof result.epoch !== "string" ||
      !Number.isSafeInteger(result.sequence) ||
      !Number.isSafeInteger(result.revision)
    )
      return fail("action-unconfirmed", 503);
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
    const current = await call("board-read", { id: command.id });
    if (!current.ok) return fail("action-propagation-pending", 503);
    const value = await current.json();
    return value.board.revision === result.revision
      ? answer(withViewer(value, user))
      : fail("action-superseded", 409);
  } catch {
    return fail("activity-unavailable", 503);
  }
}
