import { AUTH_SESSION_COOKIE, sessionUserOf, type SessionUser } from "./auth";
import { routeGalleryRequest } from "./gallery";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { catchUpResource } from "./resource-action-catchup";
import {
  catchUpPublicationProjects,
  publicationProjectHead,
} from "./publication-project-catchup";
import type { ResourceActionEnv } from "./regional-resource-actions";
import { gallerySourceOfEntryId, galleryStoreName } from "./gallery-sources";

const PEER_PATH = "/api/resource-actions/submission";
const MAX = 3 * 1024 * 1024;
const validKey = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(key);
const answer = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);
type Command = {
  path: string;
  body: unknown;
  commandId: string;
  target: string;
};
function reviewEntry(path: string) {
  return /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/reviews$/.exec(path)?.[1];
}
function submissionPath(path: string) {
  return path === "/api/gallery/submissions" || !!reviewEntry(path);
}
async function ownerOf(key: string) {
  const prepared = /^(cn|overseas)_[0-9a-f-]{36}$/.exec(key);
  return (
    prepared?.[1] ??
    (parseInt((await digest(key)).slice(0, 2), 16) % 2 === 0
      ? "cn"
      : "overseas")
  );
}

/** The intent names a stable writer before any new publication is created. */
export async function routeRegionalSubmissions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === PEER_PATH;
  const prepare = url.pathname.endsWith("/intent");
  const commit = url.pathname.endsWith("/commit");
  const path = prepare || commit ? url.pathname.slice(0, -7) : url.pathname;
  if (!incoming && (!submissionPath(path) || request.method !== "POST"))
    return null;
  if (!!env.RESOURCE_ACTION_PEER !== !!env.RESOURCE_REGION)
    return fail("action-not-configured", 503);
  const regional = !!env.RESOURCE_ACTION_PEER && !!env.RESOURCE_REGION;
  if (!regional) {
    if (incoming) return fail("not-found", 404);
    if (!prepare && !commit) return null;
  }
  if (request.method !== "POST") return fail("method-not-allowed", 405);
  let committed = false;
  try {
    const peer = regional ? new URL(env.RESOURCE_ACTION_PEER!) : null;
    if (
      peer &&
      (peer.protocol !== "https:" || peer.origin !== env.RESOURCE_ACTION_PEER)
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
      const body = (await readSyncJson(request, MAX)) as Command | null;
      if (
        !body ||
        !submissionPath(body.path) ||
        !validKey(body.commandId) ||
        body.target !== env.RESOURCE_REGION ||
        (await ownerOf(body.commandId)) !== body.target
      )
        return fail("invalid-command", 400);
      command = {
        path: body.path,
        body: body.body,
        commandId: body.commandId,
        target: body.target,
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
      if (!user) return fail("unauthorized", 401);
      if (prepare)
        return answer({
          key: regional
            ? `${env.RESOURCE_REGION}_${crypto.randomUUID()}`
            : crypto.randomUUID(),
        });
      if (commit && !request.headers.has("idempotency-key"))
        return fail("invalid-command-id", 400);
      const commandId =
        request.headers.get("idempotency-key") ??
        `${env.RESOURCE_REGION}_${crypto.randomUUID()}`;
      if (!validKey(commandId)) return fail("invalid-command-id", 400);
      if (!regional && /^(cn|overseas)_/.test(commandId))
        return fail("action-not-configured", 503);
      command = {
        path,
        body: await readSyncJson(request, MAX),
        commandId,
        target: regional ? await ownerOf(commandId) : "local",
      };
    }
    if (!user) return fail("unauthorized", 401);
    const entryId = reviewEntry(command.path);
    const source = entryId ? gallerySourceOfEntryId(entryId) : null;
    const stream =
      (source?.key ?? "gallery") + (entryId ? "-interactions" : "");
    const call = (operation: string, body: unknown) =>
      env.GALLERY.getByName(galleryStoreName(source)).fetch(
        "https://gallery/" + operation,
        { method: "POST", body: JSON.stringify(body) },
      );
    const binding = await digest(JSON.stringify(command));
    if (command.target === (regional ? env.RESOURCE_REGION : "local")) {
      if (
        incoming &&
        (command.body as { cloudProjectId?: unknown } | null)?.cloudProjectId &&
        !(await catchUpPublicationProjects(env))
      )
        return fail("project-propagation-pending", 503);
      const original = env.GALLERY;
      const authenticated = {
        ...env,
        AUTH: {
          getByName: () => ({
            fetch: (input: string, init?: RequestInit) =>
              new URL(input).pathname === "/internal/session-user"
                ? Promise.resolve(answer({ user }))
                : env.AUTH!.getByName("auth").fetch(input, init),
          }),
        },
        GALLERY: {
          getByName: (name: string) => ({
            fetch: (input: string, init?: RequestInit) =>
              original.getByName(name).fetch(
                input,
                ["/submit", "/review-submit"].includes(new URL(input).pathname)
                  ? {
                      ...init,
                      body: JSON.stringify({
                        ...JSON.parse(String(init?.body ?? "{}")),
                        submissionReceipt: {
                          userId: user!.id,
                          scope: command.path,
                          commandId: command.commandId,
                          binding,
                        },
                      }),
                    }
                  : init,
              ),
          }),
        },
      };
      const origin = url.origin;
      const response =
        (await routeGalleryRequest(
          new Request(origin + command.path, {
            method: "POST",
            headers: {
              origin,
              cookie: `${AUTH_SESSION_COOKIE}=delegated`,
              "content-type": "application/json",
            },
            body: JSON.stringify(command.body),
          }),
          authenticated,
        )) ?? fail("not-found", 404);
      if (!response.ok || !incoming) return response;
      const head = await (
        await call("resource-sync/status", { stream })
      ).json();
      return answer({
        result: await response.json(),
        status: response.status,
        epoch: head.epoch,
        sequence: head.sequence,
        projectHead: entryId ? null : await publicationProjectHead(env),
      });
    }
    if (!peer) return fail("action-not-configured", 503);
    const authorized = await auth("authorize", { binding });
    if (!authorized.ok)
      return fail("authorization-unavailable", authorized.status);
    const response = await fetch(peer.origin + PEER_PATH, {
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
      status: number;
      epoch: string;
      sequence: number;
      projectHead?: { epoch: string; sequence: number } | null;
    };
    if (
      !result ||
      typeof result.epoch !== "string" ||
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
      result.projectHead &&
      !(await catchUpPublicationProjects(env, result.projectHead))
    )
      return fail("project-propagation-pending", 503);
    return answer(result.result, result.status);
  } catch (error) {
    if (error instanceof RangeError) return fail("too-large", 413);
    if (error instanceof SyntaxError) return fail("invalid-fields", 400);
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}
