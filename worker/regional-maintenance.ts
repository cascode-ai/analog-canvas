import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { hasBearer, sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { sameOrigin } from "./same-origin";
import { readSyncJson } from "./project-sync-http";
import { catchUpResource, type ResourceCall } from "./resource-action-catchup";
import type { ResourceActionEnv } from "./regional-resource-actions";
import { sha256Hex } from "@icm/derived";
import { ownerToolRefusal } from "./gallery-datasets";
import { recordLocalSimulationCheckPayload } from "./gallery-simulation-checks";
import {
  projectFormatDigests,
  projectFormatRefusal,
  projectFormatRequest,
  type ProjectFormatDigests,
} from "./gallery-store-maintenance";

const PATH = "/api/resource-actions/maintenance";
const DUPLICATES = "/api/gallery/duplicates/recycle",
  CHECKS = "/api/gallery/simulation-checks",
  LOCAL_INPUTS = "/api/gallery/simulation-checks/inputs",
  FORMAT = "/api/gallery/maintenance/project-format";
const LOCAL_INPUT_RE =
  /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/simulation-check\/input$/;
const LOCAL_RECORD_RE =
  /^\/api\/gallery\/([A-Za-z0-9_-]{3,64})\/simulation-check$/;
const LOCAL_INPUT_MAX = 4 * 1024 * 1024;
type Reference = { id: string; previewRevision: string };
type Input =
  | { keep: Reference; remove: Reference[] }
  | { ids: string[] }
  | { all: true }
  | { id: string }
  | { id: string; payload: Record<string, unknown> }
  | ProjectFormatDigests
  | Record<string, never>;
type Command = {
  kind:
    | "duplicates"
    | "checks"
    | "progress"
    | "format"
    | "local-inputs"
    | "local-input"
    | "local-record";
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
const entryKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;
const ref = (value: any): value is Reference =>
  value &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  value.id.length <= 100 &&
  typeof value.previewRevision === "string" &&
  value.previewRevision.length <= 100;
function valid(kind: string, body: any): body is Input {
  if (!body || typeof body !== "object") return false;
  if (kind === "progress" || kind === "local-inputs")
    return Object.keys(body).length === 0;
  if (kind === "local-input")
    return entryKey(body.id) && Object.keys(body).length === 1;
  if (kind === "local-record")
    return (
      entryKey(body.id) &&
      body.payload !== null &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload) &&
      Object.keys(body).length === 2
    );
  if (kind === "format") return projectFormatDigests(body) !== null;
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
    incoming = url.pathname === PATH,
    format = url.pathname === FORMAT && request.method === "POST",
    localInputs = url.pathname === LOCAL_INPUTS && request.method === "GET",
    localInput =
      request.method === "GET" ? LOCAL_INPUT_RE.exec(url.pathname) : null,
    localRecord =
      request.method === "POST" ? LOCAL_RECORD_RE.exec(url.pathname) : null,
    isLocalSimCheck = Boolean(localInputs || localInput || localRecord);
  if (
    !incoming &&
    !format &&
    !isLocalSimCheck &&
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
  const byToken = isLocalSimCheck && hasBearer(request);
  const store = env.GALLERY.getByName("gallery");
  const call: ResourceCall = (operation, body) =>
    store.fetch("https://gallery/" + operation, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const auth = (operation: string, body: unknown) =>
    authBinding
      .getByName("auth")
      .fetch(
        "https://auth/internal/resource-action-" +
          operation +
          (request.method === "GET" &&
          url.pathname === CHECKS &&
          url.searchParams.get("poll") === "1"
            ? "?poll"
            : ""),
        {
          method: "POST",
          headers: {
            cookie: request.headers.get("cookie") ?? "",
            ...(byToken
              ? { authorization: request.headers.get("authorization")! }
              : {}),
          },
          body: JSON.stringify(body),
        },
      );
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
    const locationInfo = async (id: string) => {
      const response = await call("resource-sync/location", {
        stream: "gallery",
        id,
      });
      if (!response.ok) throw new Error("Unknown writer");
      return (await response.json()) as { known: boolean; origin: string };
    };
    const location = async (id: string) =>
      String((await locationInfo(id)).origin);
    // Versions replicate under their entry's id, so they share its writer.
    const writerKey = async (body: { table: string; id: string }) =>
      (await (await call("gallery-project-format-key", body)).json()).key as
        string | null;
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
      if (
        command.kind === "duplicates" || command.kind === "format"
          ? !user.isAdmin
          : !user.isOwner
      )
        return fail("forbidden", 403);
      if (command.kind === "progress")
        return call("simulation-checks-progress", { ownedOnly: true });
      if (command.kind === "local-inputs")
        return call("simulation-check-inputs", {});
      if (command.kind === "local-input")
        return call("simulation-check-input", {
          id: (command.body as { id: string }).id,
        });
      if (command.kind === "local-record") {
        const { id, payload } = command.body as {
          id: string;
          payload: Record<string, unknown>;
        };
        return recordLocalSimulationCheckPayload(env, id, payload);
      }
      // Format is idempotent by content, so it keeps no command receipt.
      if (command.kind === "format") {
        const key = await writerKey(command.body as ProjectFormatDigests);
        if (key === null) return fail("not-found", 404);
        if ((await location(key)) !== env.RESOURCE_REGION)
          return fail("wrong-writer", 409);
        return call("gallery-project-format-digest", command.body);
      }
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
    if (isLocalSimCheck) {
      const owner = await ownerToolRefusal(request, env);
      if (owner instanceof Response) return owner;
      const forwardPeer = async (command: Command, maxBytes = 65536) => {
        const authorized = await auth("authorize", {
          binding: await digest(JSON.stringify(command)),
        });
        if (!authorized.ok)
          return {
            ok: false as const,
            status: 503,
            payload: { error: "authorization-unavailable" },
          };
        const token = (await authorized.json()).token;
        const response = await fetch(peer.origin + PATH, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
          headers: {
            authorization: "Bearer " + token,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        });
        const received = (await readSyncJson(response, maxBytes)) as any;
        return response.ok
          ? { ok: true as const, status: response.status, received }
          : { ok: false as const, status: response.status, payload: received };
      };
      if (localInputs) {
        const localResponse = await call("simulation-check-inputs", {});
        const remote = await forwardPeer(
          {
            kind: "local-inputs",
            target: peerRegion,
            commandId: crypto.randomUUID(),
            body: {},
          },
          LOCAL_INPUT_MAX,
        ).catch(() => null);
        if (!localResponse.ok || !remote?.ok)
          return fail("inputs-unavailable", 503);
        const localData = (await localResponse.json()) as {
          entries: { id: string; name: string }[];
        };
        const remoteData = remote.received.payload as {
          entries: { id: string; name: string }[];
        };
        const seen = new Set<string>();
        const entries = [...localData.entries, ...remoteData.entries].filter(
          (item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          },
        );
        return answer({ entries });
      }
      const entryId = (localInput ?? localRecord)![1]!;
      const loc = await locationInfo(entryId);
      if (localInput) {
        if (!loc.known || loc.origin === env.RESOURCE_REGION) {
          const response = await call("simulation-check-input", {
            id: entryId,
          });
          return answer(await response.json(), response.status);
        }
        if (loc.origin !== peerRegion) return fail("wrong-writer", 409);
        const remote = await forwardPeer(
          {
            kind: "local-input",
            target: peerRegion,
            commandId: crypto.randomUUID(),
            body: { id: entryId },
          },
          LOCAL_INPUT_MAX,
        );
        if (!remote.ok) return answer(remote.payload, remote.status);
        return answer(remote.received.payload);
      }
      const payload = (await readSyncJson(request, 65536)) as Record<
        string,
        unknown
      > | null;
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return fail("invalid-fields", 400);
      if (!loc.known || loc.origin === env.RESOURCE_REGION)
        return recordLocalSimulationCheckPayload(env, entryId, payload);
      if (loc.origin !== peerRegion) return fail("wrong-writer", 409);
      const command: Command = {
        kind: "local-record",
        target: peerRegion,
        commandId: await digest(JSON.stringify({ id: entryId, payload })),
        body: { id: entryId, payload },
      };
      const remote = await forwardPeer(command);
      if (!remote.ok) return answer(remote.payload, remote.status);
      const caughtUp = await catchUpResource(
        call,
        "gallery",
        peer.origin,
        env.RESOURCE_SYNC_PEER_TOKEN,
        remote.received.head,
      ).catch(() => false);
      if (!caughtUp) return fail("action-propagation-pending", 503);
      return answer(remote.received.payload);
    }
    if (request.method === "POST" && !sameOrigin(request))
      return fail("forbidden", 403);
    const user = await sessionUserOf(request, env);
    if (format) {
      if (!user?.isAdmin) return fail("unauthorized", 401);
      const body = projectFormatRequest(await request.json().catch(() => null));
      if (!body) return fail("invalid-request", 400);
      const key = await writerKey(body);
      if (key === null) return fail("not-found", 404);
      const region = await location(key);
      if (region === env.RESOURCE_REGION) {
        const response = await call("gallery-project-format", body);
        return answer(await response.json(), response.status);
      }
      if (region !== peerRegion) return fail("wrong-writer", 409);
      const refusal = projectFormatRefusal(body);
      if (refusal) return answer(await refusal.json(), refusal.status);
      const input: ProjectFormatDigests = {
        table: body.table,
        id: body.id,
        originalSha256: sha256Hex(body.originalProjectText),
        projectSha256: sha256Hex(body.projectText),
      };
      const command: Command = {
        kind: "format",
        target: region,
        commandId: await digest(JSON.stringify(input)),
        body: input,
      };
      const authorized = await auth("authorize", {
        binding: await digest(JSON.stringify(command)),
      });
      if (!authorized.ok) return fail("authorization-unavailable", 503);
      const token = (await authorized.json()).token;
      let response: Response, received: any;
      try {
        response = await fetch(peer.origin + PATH, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(REGIONAL_ACTION_TIMEOUT_MS),
          headers: {
            authorization: "Bearer " + token,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        });
        received = await readSyncJson(response, 65536);
      } catch {
        // A failed send cannot be told apart from a reply lost after commit.
        return answer({ error: "action-unconfirmed", region }, 503);
      }
      if (!response.ok) return answer(received, response.status);
      const caughtUp = await catchUpResource(
        call,
        "gallery",
        peer.origin,
        env.RESOURCE_SYNC_PEER_TOKEN,
        received.head,
      ).catch(() => false);
      if (!caughtUp) return fail("action-propagation-pending", 503);
      return answer(received.payload);
    }
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
