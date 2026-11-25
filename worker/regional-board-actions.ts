import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { hasBearer, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { catchUpResource } from "./resource-action-catchup";
import {
  boardEditorOf,
  datasetPublicIds,
  storeChanges,
  withDatasetEntries,
  withViewer,
} from "./boards";
import { gallerySourceOfEntryId } from "./gallery-sources";
import { boardCreationRegion, MAIN_BOARD_ID } from "./gallery-store-boards";
import type { ResourceActionEnv } from "./regional-resource-actions";

const peerPath = "/api/resource-actions/board";
const stream = "gallery-activity";
const answer = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
const fail = (error: string, status: number) => answer({ error }, status);
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
  const match = /^\/api\/board(?:\/(changes|export|preview\/[^/]+))?$/.exec(
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
          headers: {
            cookie: request.headers.get("cookie") ?? "",
            // An agent's API token authorizes its own command at the other entrance.
            ...(request.headers.has("authorization")
              ? { authorization: request.headers.get("authorization")! }
              : {}),
          },
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
    // The one board may be written in the other region before the background
    // seed; discovery is only needed while it is missing here.
    const main = incoming ? null : await call("board-main", {});
    const mainId = main?.ok ? (await main.json()).id : "";
    if (!incoming && typeof mainId !== "string")
      return fail("board-unavailable", 503);
    if (!incoming && !mainId) return fail("board-unavailable", 503);
    if (!incoming && request.method === "GET") {
      await locate(mainId);
      return null;
    }
    if (!incoming && match?.[1] !== "changes") return null;
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
      const viaToken = hasBearer(request);
      if (!viaToken && !sameOrigin(request)) return fail("cross-origin", 403);
      user = await boardEditorOf(request, env);
      if (!user) return fail(viaToken ? "bad-token" : "sign-in-required", 401);
      const body = (await readSyncJson(request, 256 * 1024)) as Record<
        string,
        unknown
      >;
      if (!body || typeof body !== "object" || Array.isArray(body))
        return fail("bad-request", 400);
      if (body.accountId !== undefined && body.accountId !== user.id)
        return fail("account-changed", 409);
      const commandId =
        request.headers.get("idempotency-key") ?? crypto.randomUUID();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(commandId))
        return fail("invalid-command", 400);
      const changes = storeChanges(body.changes);
      if (!changes) return fail("bad-changes", 400);
      if (
        body.expectedRevision !== undefined &&
        (!Number.isSafeInteger(body.expectedRevision) ||
          Number(body.expectedRevision) < 1)
      )
        return fail("bad-revision", 400);
      command = {
        id: mainId,
        operation: "change",
        // The one board not made yet is made by its first change, in the region a create picks.
        target:
          (await locate(mainId)) ??
          (mainId === MAIN_BOARD_ID ? boardCreationRegion(mainId) : ""),
        commandId,
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: Number(body.expectedRevision) }),
        input: { changes },
      };
      if (!command.target) return fail("board-not-found", 404);
    }
    if (!user) return fail("unauthorized", 401);
    const binding = await digest(JSON.stringify(command));
    if (incoming || command.target === env.RESOURCE_REGION) {
      const references = (
        command.operation === "create"
          ? Array.isArray(command.input.entries)
            ? command.input.entries
            : []
          : (command.input.changes as Record<string, unknown>[])
              .filter(
                (change) => change.kind === "add" || change.kind === "replace",
              )
              .map((change) => change.entryId)
      ).map(String);
      // A reference dataset's circuit is in that dataset's store, not the wall's.
      const wall = references.filter((id) => !gallerySourceOfEntryId(id));
      if (incoming && wall.length) {
        const checked = await call("activity-board-references", {
          ids: wall,
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
        // Checked here, in the writer's own dataset stores, not taken from the command.
        datasetPublic: await datasetPublicIds(env, references),
      });
      if (!response.ok) return response;
      const result = await response.json();
      if (!incoming)
        return answer(withViewer(await withDatasetEntries(env, result), user));
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
      ? answer(withViewer(await withDatasetEntries(env, value), user))
      : fail("action-superseded", 409);
  } catch {
    return fail("activity-unavailable", 503);
  }
}
