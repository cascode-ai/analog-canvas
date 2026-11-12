import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import type { GalleryEnv } from "./gallery-store";
import type { ResourceSyncEnv } from "./resource-sync";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { sameOrigin } from "./same-origin";
import { readSyncJson } from "./project-sync-http";
import { catchUpResource } from "./resource-action-catchup";
import { readCurationRequest, validCurationRequest } from "./gallery-curation";
import type { GalleryEntrySummary } from "./gallery-store";
import { gallerySourceOfEntryId, gallerySourceByKey } from "./gallery-sources";
import { galleryDetails } from "./gallery-details-request";
import { routeRegionalComponentActions } from "./regional-component-actions";
import { routeRegionalReviewActions } from "./regional-review-actions";
import { routeRegionalBoardActions } from "./regional-board-actions";
import { routeRegionalPublicationActions } from "./regional-publication-actions";
import { routeRegionalMaintenance } from "./regional-maintenance";
import { routeRegionalLikeActions } from "./regional-like-actions";

export type ResourceActionEnv = GalleryEnv &
  ResourceSyncEnv & {
    RESOURCE_ACTION_PEER?: string;
    RESOURCE_SYNC_PEER_TOKEN?: string;
  };

export async function routeRegionalResourceActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const board = await routeRegionalBoardActions(request, env);
  if (board) return board;
  const maintenance = await routeRegionalMaintenance(request, env);
  if (maintenance) return maintenance;
  const publication = await routeRegionalPublicationActions(request, env);
  if (publication) return publication;
  const like = await routeRegionalLikeActions(request, env);
  if (like) return like;
  const review = await routeRegionalReviewActions(request, env);
  if (review) return review;
  const component = await routeRegionalComponentActions(request, env);
  if (component) return component;
  const url = new URL(request.url);
  const peerPath = "/api/resource-actions/lifecycle";
  const incoming = url.pathname === peerPath;
  const match =
    /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})(?:\/(recycle|restore|curation))?$/.exec(
      url.pathname,
    );
  if (
    !incoming &&
    (!match ||
      request.method !==
        (match[2] === "curation"
          ? "PATCH"
          : match[2]
            ? "POST"
            : request.method === "PATCH"
              ? "PATCH"
              : "DELETE"))
  )
    return null;
  if (
    !incoming &&
    (gallerySourceOfEntryId(match![1]!) ||
      gallerySourceByKey(url.searchParams.get("source")))
  )
    return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (incoming && request.method !== "POST")
    return fail("method-not-allowed", 405);
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
      input?: Record<string, unknown>;
    };
    let user: SessionUser | null;
    if (incoming) {
      const body = (await readSyncJson(request, 65536)) as Record<
        string,
        unknown
      > | null;
      if (
        !body ||
        typeof body.id !== "string" ||
        !/^[A-Za-z0-9_-]{3,64}$/.test(body.id) ||
        !["recycle", "restore", "delete", "curation", "details"].includes(
          String(body.action),
        ) ||
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
        ...(body.action === "curation" || body.action === "details"
          ? { input: body.input as Record<string, unknown> }
          : {}),
      };
      if (command.action === "curation" && !validCurationRequest(command.input))
        return fail("invalid-curation", 400);
      if (command.action === "details" && !galleryDetails(command.input))
        return fail("invalid-fields", 400);
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
      let input: Record<string, unknown> | undefined;
      if (match![2] === "curation") {
        const parsed = await readCurationRequest(request);
        if (parsed instanceof Response) return parsed;
        input = {
          tags: parsed.tags,
          attention: parsed.attention,
          expectedPreviewRevision: parsed.expectedPreviewRevision,
          expectedCurationRevision: parsed.expectedCurationRevision,
          ...(parsed.source === "visual-audit"
            ? { source: parsed.source }
            : {}),
        };
      }
      const details = !match![2] && request.method === "PATCH";
      if (details) {
        const parsed = galleryDetails(
          await readSyncJson(request, 65536).catch(() => null),
        );
        if (!parsed) return fail("invalid-fields", 400);
        input = parsed;
      }
      const key =
        request.headers.get("idempotency-key") ??
        (input && !details
          ? await digest(
              JSON.stringify({
                actor: user.id,
                id: match![1],
                action: "curation",
                input,
              }),
            )
          : crypto.randomUUID());
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(key))
        return fail("invalid-command-id", 400);
      const location = await call("resource-sync/location", {
        stream: "gallery",
        id: match![1],
      });
      if (!location.ok) return location;
      command = {
        id: match![1]!,
        action: match![2] ?? (details ? "details" : "delete"),
        commandId: key,
        target: (await location.json()).origin,
        ...(input ? { input } : {}),
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
          : lifecycleAnswer(outcome);
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
      signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
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
    const result = (await readSyncJson(response, 65536)) as {
      id: string;
      status: string;
      superseded?: boolean;
      epoch: string;
      sequence: number;
      entry?: GalleryEntrySummary;
      details?: { name: string; description: string };
    };
    if (
      result.id !== command.id ||
      !Number.isSafeInteger(result.sequence) ||
      typeof result.epoch !== "string"
    )
      return fail("action-unconfirmed", 503);
    committed = true;
    if (
      !(await catchUpResource(
        call,
        "gallery",
        peer.origin,
        env.RESOURCE_SYNC_PEER_TOKEN,
        result,
      ))
    )
      return fail("action-propagation-pending", 503);
    const current = await call(
      ["curation", "details"].includes(command.action)
        ? "any-entry"
        : "preview-access",
      { id: result.id },
    );
    if (!current.ok && current.status !== 404)
      return fail("action-propagation-pending", 503);
    let matches =
      result.status === "deleted" ? current.status === 404 : current.ok;
    if (matches && current.ok) {
      const latest = await current.json();
      matches = latest.status === result.status;
      if (command.action === "details")
        matches =
          matches &&
          !!result.details &&
          latest.entry?.name === result.details.name &&
          latest.entry?.description === result.details.description;
      if (command.action === "curation")
        matches =
          matches &&
          !!result.entry &&
          latest.entry?.curationRevision === result.entry.curationRevision &&
          latest.entry?.previewRevision === result.entry.previewRevision;
    }
    return result.superseded || !matches
      ? fail("action-superseded", 409)
      : lifecycleAnswer(result);
  } catch {
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}

function lifecycleAnswer(result: {
  id: string;
  status: string;
  entry?: GalleryEntrySummary;
  details?: { name: string; description: string };
}): Response {
  if (result.details) return answer({ id: result.id, ...result.details });
  if (result.entry) return answer({ entry: result.entry });
  return answer(
    result.status === "deleted"
      ? { id: result.id, deleted: true }
      : { id: result.id, status: result.status },
  );
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
