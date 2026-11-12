import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import {
  catchUpPublicationProjects,
  publicationProjectHead,
} from "./publication-project-catchup";
import {
  sessionUserOf,
  ownerTokenUserOf,
  hasBearer,
  type SessionUser,
  AUTH_SESSION_COOKIE,
} from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { routeGalleryRequest } from "./gallery";
import { sameOrigin } from "./same-origin";
import { readSyncJson } from "./project-sync-http";
import { catchUpResource } from "./resource-action-catchup";
import {
  gallerySourceOfEntryId,
  galleryStoreName,
  gallerySourceByKey,
} from "./gallery-sources";
import type { ResourceActionEnv } from "./regional-resource-actions";
import type { PublicationReceipt } from "./gallery-publication-command";

const PATH = "/api/resource-actions/publication";
const MAX = 3 * 1024 * 1024;
export type PublicationCommand = {
  path: string;
  method: string;
  body: unknown;
  target: string;
  commandId: string;
  entryId: string;
};
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);
const validKey = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
function batchFor(path: string, method: string) {
  const match =
    /^\/api\/gallery\/sources\/([a-z0-9-]+)\/(entries|comparisons)$/.exec(
      new URL(path, "https://canvas").pathname,
    );
  const source = match && gallerySourceByKey(match[1]!);
  return method === "POST" && source ? { source, field: match![2]! } : null;
}
function entryFor(path: string, method: string, body?: unknown): string | null {
  const batch = batchFor(path, method);
  if (batch) {
    const items = (body as Record<string, unknown> | null)?.[batch.field];
    const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
    return item &&
      typeof item.id === "string" &&
      gallerySourceOfEntryId(item.id)?.key === batch.source.key
      ? item.id
      : null;
  }
  path = new URL(path, "https://canvas").pathname;
  const match = /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})$/.exec(path);
  if (match && method === "PUT") return match[1]!;
  const reference = /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/reference$/.exec(
    path,
  );
  if (reference && ["PUT", "DELETE"].includes(method)) return reference[1]!;
  const version =
    /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/versions\/[A-Za-z0-9_-]{3,128}\/restore$/.exec(
      path,
    );
  if (version && method === "POST") return version[1]!;
  const rejection = /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/reject$/.exec(
    path,
  );
  return rejection && method === "POST" ? rejection[1]! : null;
}

/** Reuse the original route's validation at the writer under a fresh delegated identity. */
async function executeRegionalPublicationCommand(
  request: Request,
  env: ResourceActionEnv,
  command: PublicationCommand,
  user: SessionUser,
): Promise<Response> {
  const receipt: PublicationReceipt = {
    userId: user.id,
    commandId: command.commandId,
    binding: await digest(JSON.stringify(command)),
    entryId: command.entryId,
    ...(typeof (command.body as { cloudProjectId?: unknown } | null)
      ?.cloudProjectId === "string"
      ? {
          projectId: (command.body as { cloudProjectId: string })
            .cloudProjectId,
        }
      : {}),
  };
  const original = env.GALLERY;
  let witness: string | null = null,
    projectWitness: string | null = null;
  const authenticated = {
    ...env,
    AUTH: {
      getByName: () => ({
        fetch: async (input: string, init?: RequestInit) => {
          if (new URL(input).pathname === "/internal/session-user")
            return answer({ user });
          if (new URL(input).pathname === "/internal/gallery-rejection") {
            const body = JSON.parse(String(init?.body ?? "{}"));
            return env.AUTH!.getByName("auth").fetch(input, {
              ...init,
              body: JSON.stringify({
                ...body,
                noticeId: await digest(user.id + ":" + command.commandId),
              }),
            });
          }
          return env.AUTH!.getByName("auth").fetch(input, init);
        },
      }),
    },
    GALLERY: {
      getByName: (name: string) => ({
        fetch: async (input: string, init?: RequestInit) => {
          if (
            [
              "/replace-entry",
              "/reference-set",
              "/reference-delete",
              "/restore-version",
              "/reject",
              "/import-entry",
              "/comparison-import",
            ].includes(new URL(input).pathname)
          ) {
            const body = JSON.parse(String(init?.body ?? "{}"));
            const response = await original.getByName(name).fetch(input, {
              ...init,
              body: JSON.stringify({ ...body, publicationReceipt: receipt }),
            });
            witness = response.headers.get("x-canvas-publication-state");
            projectWitness = response.headers.get(
              "x-canvas-publication-project-state",
            );
            return response;
          }
          return original.getByName(name).fetch(input, init);
        },
      }),
    },
  };
  const origin = new URL(request.url).origin;
  const response =
    (await routeGalleryRequest(
      new Request(origin + command.path, {
        method: command.method,
        headers: {
          origin,
          cookie: `${AUTH_SESSION_COOKIE}=delegated`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command.body),
      }),
      authenticated,
    )) ?? fail("not-found", 404);
  if (witness) response.headers.set("x-canvas-publication-state", witness);
  if (projectWitness)
    response.headers.set("x-canvas-publication-project-state", projectWitness);
  return response;
}

export async function routeRegionalPublicationActions(
  request: Request,
  env: ResourceActionEnv,
  singleItem = false,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === PATH;
  const entryId = entryFor(url.pathname, request.method);
  const batch = batchFor(url.pathname, request.method);
  if (!incoming && !entryId && !batch) return null;
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
        .fetch(`https://auth/internal/resource-action-${operation}`, {
          method: "POST",
          headers: {
            cookie: request.headers.get("cookie") ?? "",
            ...(batch && hasBearer(request)
              ? { authorization: request.headers.get("authorization")! }
              : {}),
          },
          body: JSON.stringify(body),
        });
    let command: PublicationCommand, user: SessionUser | null;
    if (incoming) {
      const body = (await readSyncJson(request, MAX)) as PublicationCommand;
      if (
        !body ||
        entryFor(body.path, body.method, body.body) !== body.entryId ||
        body.target !== env.RESOURCE_REGION ||
        !validKey(body.commandId)
      )
        return fail("invalid-command", 400);
      command = {
        path: body.path,
        method: body.method,
        body: body.body,
        target: body.target,
        commandId: body.commandId,
        entryId: body.entryId,
      };
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
    } else {
      if (!(batch && hasBearer(request)) && !sameOrigin(request))
        return fail("forbidden", 403);
      user =
        batch && hasBearer(request)
          ? await ownerTokenUserOf(request, env)
          : await sessionUserOf(request, env);
      if (!user) return fail("unauthorized", 401);
      const body =
        request.body === null
          ? null
          : await readSyncJson(request, batch && !singleItem ? MAX * 10 : MAX);
      if (batch && !singleItem) {
        if (!user.isOwner) return fail("owner-only", 403);
        const items = (body as Record<string, unknown> | null)?.[batch.field];
        if (!Array.isArray(items) || items.length === 0 || items.length > 10)
          return fail("invalid-fields", 400);
        const results = [];
        for (let index = 0; index < items.length; index++) {
          const item = items[index],
            childBody = { [batch.field]: [item] };
          const id = entryFor(url.pathname, request.method, childBody);
          if (!id) {
            results.push({
              id: typeof item?.id === "string" ? item.id : "",
              ok: false,
              error: "invalid-id",
            });
            continue;
          }
          const headers = new Headers(request.headers);
          const parentKey = headers.get("idempotency-key");
          if (parentKey) {
            if (!validKey(parentKey)) return fail("invalid-command-id", 400);
            headers.set(
              "idempotency-key",
              await digest(parentKey + ":" + index + ":" + id),
            );
          }
          const response = (await routeRegionalPublicationActions(
            new Request(request.url, {
              method: request.method,
              headers,
              body: JSON.stringify(childBody),
            }),
            env,
            true,
          ))!;
          const result = await response.json();
          results.push(
            response.ok
              ? result.results[0]
              : {
                  id,
                  ok: false,
                  error: result.error ?? `http-${response.status}`,
                },
          );
        }
        return answer({ source: batch.source.key, results });
      }
      const commandId =
        request.headers.get("idempotency-key") ??
        (await digest(
          JSON.stringify({
            userId: user.id,
            path: url.pathname + url.search,
            method: request.method,
            body,
          }),
        ));
      if (!validKey(commandId)) return fail("invalid-command-id", 400);
      command = {
        path: url.pathname + url.search,
        method: request.method,
        body,
        target: "",
        commandId,
        entryId: entryId ?? entryFor(url.pathname, request.method, body)!,
      };
    }
    if (!user) return fail("unauthorized", 401);
    const source = gallerySourceOfEntryId(command.entryId),
      stream = source?.key ?? "gallery";
    const store = env.GALLERY.getByName(galleryStoreName(source));
    const call = (operation: string, body: unknown) =>
      store.fetch(`https://gallery/${operation}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const location = await call("resource-sync/location", {
      stream,
      id: command.entryId,
    });
    if (!location.ok) return location;
    const local = (await location.json()) as { origin: string; known: boolean };
    let origin = local.origin;
    if (source && batchFor(command.path, command.method) && !local.known) {
      // An import may arrive before the resource stream. Never interpret a
      // missing local row as permission to establish a second writer.
      if (!env.RESOURCE_SYNC_PEER_TOKEN) return fail("writer-unconfirmed", 503);
      const response = await fetch(
        `${peer.origin}/api/resource-sync/${stream}/location?id=${encodeURIComponent(command.entryId)}`,
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
      // Recheck after the peer lookup: another command may have committed
      // while this request awaited the network.
      const refreshedResponse = await call("resource-sync/location", {
        stream,
        id: command.entryId,
      });
      if (!refreshedResponse.ok) return refreshedResponse;
      const refreshed = (await refreshedResponse.json()) as {
        known: boolean;
        origin: string;
      };
      if (refreshed.known) {
        if (remote.known && remote.origin !== refreshed.origin)
          return fail("writer-conflict", 409);
        origin = refreshed.origin;
      } else {
        if (remote.known && remote.origin === env.RESOURCE_REGION)
          return fail("writer-state-missing", 503);
        // A new Dataset ID has a stable writer, even when both entrances import
        // concurrently. Existing China ownership, including tombstones, stays.
        origin = remote.known ? String(remote.origin) : "overseas";
      }
    }
    if (!incoming) command.target = origin;
    if (incoming || origin === env.RESOURCE_REGION) {
      if (origin !== env.RESOURCE_REGION) return fail("wrong-writer", 409);
      const bindingMutation =
        !source &&
        command.method === "PUT" &&
        !command.path.includes("/reference");
      if (
        incoming &&
        bindingMutation &&
        !(await catchUpPublicationProjects(env))
      )
        return fail("project-propagation-pending", 503);
      const response = await executeRegionalPublicationCommand(
        request,
        env,
        command,
        user,
      );
      if (!response.ok || !incoming) return response;
      if (!response.headers.has("x-canvas-publication-state"))
        return answer({
          result: await response.json(),
          status: response.status,
          uncommitted: true,
        });
      const head = await (
        await call("resource-sync/status", { stream })
      ).json();
      const state = response.headers.get("x-canvas-publication-state");
      return answer({
        result: await response.json(),
        status: response.status,
        state,
        projectState: response.headers.get(
          "x-canvas-publication-project-state",
        ),
        epoch: head.epoch,
        sequence: head.sequence,
        projectHead: bindingMutation ? await publicationProjectHead(env) : null,
      });
    }
    const authorized = await auth("authorize", {
      binding: await digest(JSON.stringify(command)),
    });
    if (!authorized.ok)
      return fail("authorization-unavailable", authorized.status);
    const response = await fetch(peer.origin + PATH, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
      headers: {
        authorization: "Bearer " + (await authorized.json()).token,
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
    const result = (await readSyncJson(response, MAX)) as {
      result: unknown;
      uncommitted?: boolean;
      projectHead?: { epoch: string; sequence: number } | null;
      status: number;
      state: string;
      projectState: string;
      epoch: string;
      sequence: number;
    };
    if (result?.uncommitted === true)
      return answer(result.result, result.status);
    if (
      !result ||
      typeof result.epoch !== "string" ||
      typeof result.state !== "string" ||
      !Number.isSafeInteger(result.sequence) ||
      !Number.isInteger(result.status)
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
    if (
      (await (await call("publication-state", { id: command.entryId })).json())
        .state !== result.state
    )
      return fail("action-superseded", 409);
    if (
      result.projectHead &&
      !(await catchUpPublicationProjects(env, result.projectHead))
    )
      return fail("project-propagation-pending", 503);
    const bindings = await (
      await call("publication-state", {
        id: command.entryId,
        projectId: (command.body as { cloudProjectId?: unknown } | null)
          ?.cloudProjectId,
      })
    ).json();
    if (bindings.projectState !== result.projectState)
      return fail("publication-link-conflict", 409);
    return answer(result.result, result.status);
  } catch (error) {
    if (!incoming && error instanceof RangeError) return fail("too-large", 413);
    if (!incoming && error instanceof SyntaxError)
      return fail("invalid-fields", 400);
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}
