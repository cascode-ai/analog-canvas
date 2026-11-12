import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { sameOrigin } from "./same-origin";
import { readSyncJson } from "./project-sync-http";
import { catchUpResource, type ResourceCall } from "./resource-action-catchup";
import type { ResourceActionEnv } from "./regional-resource-actions";

const PATH = "/api/resource-actions/maintenance";
const DUPLICATES = "/api/gallery/duplicates/recycle",
  CHECKS = "/api/gallery/simulation-checks";
type Reference = { id: string; previewRevision: string };
type Input =
  | { keep: Reference; remove: Reference[] }
  | { ids: string[] }
  | { all: true }
  | Record<string, never>;
type Command = {
  kind: "duplicates" | "checks" | "progress";
  target: string;
  commandId: string;
  body: Input;
};
type Result = { status: number; payload: Record<string, any> };
const answer = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);
const key = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const ref = (value: any): value is Reference =>
  value &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  value.id.length <= 100 &&
  typeof value.previewRevision === "string" &&
  value.previewRevision.length <= 100;
function valid(kind: string, body: any): body is Input {
  if (!body || typeof body !== "object") return false;
  if (kind === "progress") return Object.keys(body).length === 0;
  if (kind === "checks")
    return (
      (body.all === true && body.ids === undefined) ||
      (body.all === undefined &&
        Array.isArray(body.ids) &&
        body.ids.length > 0 &&
        body.ids.length <= 500 &&
        body.ids.every(
          (id: unknown) =>
            typeof id === "string" && id.length > 0 && id.length <= 64,
        ))
    );
  return (
    kind === "duplicates" &&
    ref(body.keep) &&
    Array.isArray(body.remove) &&
    body.remove.length > 0 &&
    body.remove.length <= 49 &&
    body.remove.every(ref) &&
    new Set([body.keep, ...body.remove].map((r: Reference) => r.id)).size ===
      body.remove.length + 1
  );
}
const ids = (command: Command) =>
  command.kind === "duplicates"
    ? (command.body as { remove: Reference[] }).remove.map((r) => r.id)
    : "ids" in command.body
      ? command.body.ids
      : [];

/** Maintenance groups mutate only their writer; the entrance reports every group outcome. */
export async function routeRegionalMaintenance(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === PATH;
  if (
    !incoming &&
    !(url.pathname === DUPLICATES && request.method === "POST") &&
    !(url.pathname === CHECKS && ["GET", "POST"].includes(request.method))
  )
    return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (incoming && request.method !== "POST")
    return fail("method-not-allowed", 405);
  const authBinding = env.AUTH;
  if (!authBinding) return fail("authorization-unavailable", 503);
  const store = env.GALLERY.getByName("gallery");
  const call: ResourceCall = (operation, body) =>
    store.fetch("https://gallery/" + operation, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const auth = (operation: string, body: unknown) =>
    authBinding
      .getByName("auth")
      .fetch("https://auth/internal/resource-action-" + operation, {
        method: "POST",
        headers: { cookie: request.headers.get("cookie") ?? "" },
        body: JSON.stringify(body),
      });
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return fail("action-not-configured", 503);
    const peerRegion = env.RESOURCE_REGION === "cn" ? "overseas" : "cn";
    const location = async (id: string) => {
      const response = await call("resource-sync/location", {
        stream: "gallery",
        id,
      });
      if (!response.ok) throw new Error("Unknown writer");
      return String((await response.json()).origin);
    };
    const catchUp = async () => {
      const head = await fetch(
        peer.origin + "/api/resource-sync/gallery/status",
        {
          redirect: "manual",
          signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
          headers: { authorization: "Bearer " + env.RESOURCE_SYNC_PEER_TOKEN },
        },
      );
      return (
        head.ok &&
        (await catchUpResource(
          call,
          "gallery",
          peer.origin,
          env.RESOURCE_SYNC_PEER_TOKEN,
          await head.json(),
        ))
      );
    };
    const execute = async (
      command: Command,
      user: SessionUser,
    ): Promise<Response> => {
      if (command.target !== env.RESOURCE_REGION)
        return fail("wrong-writer", 409);
      if (command.kind === "duplicates" ? !user.isAdmin : !user.isOwner)
        return fail("forbidden", 403);
      if (command.kind === "progress")
        return call("simulation-checks-progress", { ownedOnly: true });
      for (const id of ids(command))
        if ((await location(id)) !== env.RESOURCE_REGION)
          return fail("wrong-writer", 409);
      if (command.kind === "duplicates") {
        const keep = (command.body as { keep: Reference }).keep;
        if (
          (await location(keep.id)) !== env.RESOURCE_REGION &&
          !(await catchUp())
        )
          return fail("action-propagation-pending", 503);
      }
      const response = await call("maintenance-command", {
        actor: { id: user.id },
        command,
        binding: await digest(JSON.stringify(command)),
        at: new Date().toISOString(),
      });
      if (command.kind !== "checks" || !response.ok) return response;
      const accepted = await response.json();
      const progress = await (
        await call("simulation-checks-progress", { ownedOnly: true })
      ).json();
      return answer({ ...accepted, waiting: progress.waiting });
    };
    if (incoming) {
      const body = (await readSyncJson(request, 65536)) as Command;
      if (
        !body ||
        !valid(body.kind, body.body) ||
        !key(body.commandId) ||
        body.target !== env.RESOURCE_REGION
      )
        return fail("invalid-command", 400);
      const command: Command = {
        kind: body.kind,
        target: body.target,
        commandId: body.commandId,
        body: body.body,
      };
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      const user = sessionIdentity((await verified.json()).user);
      if (!user) return fail("unauthorized", 401);
      const result = await execute(command, user);
      if (!result.ok) return result;
      return answer({
        payload: await result.json(),
        head: await (
          await call("resource-sync/status", { stream: "gallery" })
        ).json(),
        witness: result.headers.get("x-canvas-maintenance-state"),
      });
    }
    if (request.method === "POST" && !sameOrigin(request))
      return fail("forbidden", 403);
    const user = await sessionUserOf(request, env);
    if (!user) return fail("unauthorized", 401);
    const kind =
      url.pathname === DUPLICATES
        ? "duplicates"
        : request.method === "GET"
          ? "progress"
          : "checks";
    if (kind === "duplicates" ? !user.isAdmin : !user.isOwner)
      return fail("forbidden", 403);
    const body =
      request.method === "GET" ? {} : await readSyncJson(request, 32768);
    if (!valid(kind, body)) return fail("invalid-fields", 400);
    const parent =
      request.headers.get("idempotency-key") ??
      (kind === "checks"
        ? crypto.randomUUID()
        : await digest(JSON.stringify({ user: user.id, kind, body })));
    if (!key(parent)) return fail("invalid-command-id", 400);
    const groups = new Map<string, Input>();
    if (kind === "progress" || (kind === "checks" && "all" in body)) {
      groups.set(env.RESOURCE_REGION, body);
      groups.set(peerRegion, body);
    } else if (kind === "duplicates") {
      const duplicate = body as { keep: Reference; remove: Reference[] };
      for (const item of duplicate.remove) {
        const region = await location(item.id);
        const group = groups.get(region) as
          { keep: Reference; remove: Reference[] } | undefined;
        if (group) group.remove.push(item);
        else groups.set(region, { keep: duplicate.keep, remove: [item] });
      }
    } else {
      for (const id of [...new Set((body as { ids: string[] }).ids)]) {
        const region = await location(id),
          group = groups.get(region) as { ids: string[] } | undefined;
        if (group) group.ids.push(id);
        else groups.set(region, { ids: [id] });
      }
    }
    const outcomes: { region: string; command: Command; result: Result }[] = [];
    for (const [region, input] of groups) {
      const command: Command = {
        kind,
        target: region,
        commandId: await digest(parent + ":" + region),
        body: input,
      };
      let result: Result;
      try {
        if (region === env.RESOURCE_REGION) {
          const response = await execute(command, user);
          result = { status: response.status, payload: await response.json() };
        } else {
          if (region !== peerRegion) throw new Error("Unknown region");
          const authorized = await auth("authorize", {
            binding: await digest(JSON.stringify(command)),
          });
          if (!authorized.ok) throw new Error("Authorization unavailable");
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
          const received = (await readSyncJson(
            response,
            3 * 1024 * 1024,
          )) as any;
          if (!response.ok)
            result = { status: response.status, payload: received };
          else if (
            kind !== "progress" &&
            !(await catchUpResource(
              call,
              "gallery",
              peer.origin,
              env.RESOURCE_SYNC_PEER_TOKEN,
              received.head,
            ))
          )
            result = {
              status: 503,
              payload: { error: "action-propagation-pending" },
            };
          else if (
            kind === "duplicates" &&
            (await (await call("maintenance-state", { command })).json())
              .state !== received.witness
          )
            result = { status: 409, payload: { error: "action-superseded" } };
          else result = { status: 200, payload: received.payload };
        }
      } catch {
        result = { status: 503, payload: { error: "action-unconfirmed" } };
      }
      outcomes.push({ region, command, result });
    }
    const succeeded = outcomes.filter((x) => x.result.status < 300),
      failed = outcomes.filter((x) => x.result.status >= 300);
    if (kind === "progress") {
      if (failed.length) return fail("progress-unavailable", 503);
      const progress = succeeded.map((x) => x.result.payload);
      return answer({
        waiting: progress.reduce((n, p) => n + p.waiting, 0),
        current: progress.find((p) => p.current)?.current ?? null,
        counts: Object.fromEntries(
          ["pass", "fail", "error", "noTestbench"].map((key) => [
            key,
            progress.reduce((n, p) => n + p.counts[key], 0),
          ]),
        ),
        results: progress
          .flatMap((p) => p.results ?? [])
          .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
          .slice(0, 100),
      });
    }
    const firstFailure = failed[0];
    const status = firstFailure
      ? succeeded.length
        ? 207
        : firstFailure.result.status
      : kind === "checks"
        ? 202
        : 200;
    if (kind === "duplicates")
      return answer(
        {
          kept: (body as { keep: Reference }).keep.id,
          recycled: succeeded.flatMap((x) => x.result.payload.recycled),
          results: outcomes.flatMap((x) =>
            ids(x.command).map((id) => ({
              id,
              ok: x.result.status < 300,
              ...(x.result.status >= 300
                ? { error: x.result.payload.error }
                : {}),
            })),
          ),
          ...(firstFailure ? { error: firstFailure.result.payload.error } : {}),
        },
        status,
      );
    return answer(
      {
        queued: succeeded.flatMap((x) => x.result.payload.queued),
        noTestbench: succeeded.flatMap((x) => x.result.payload.noTestbench),
        missing: succeeded.flatMap((x) => x.result.payload.missing),
        waiting: succeeded.reduce((n, x) => n + x.result.payload.waiting, 0),
        failures: failed.map((x) => ({
          region: x.region,
          ids: ids(x.command),
          error: x.result.payload.error,
        })),
        ...(firstFailure ? { error: firstFailure.result.payload.error } : {}),
      },
      status,
    );
  } catch (error) {
    return fail(
      error instanceof RangeError
        ? "too-large"
        : error instanceof SyntaxError
          ? "invalid-fields"
          : "action-unconfirmed",
      error instanceof RangeError
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 503,
    );
  }
}
