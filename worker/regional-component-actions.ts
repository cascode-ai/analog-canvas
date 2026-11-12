import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { sessionUserOf, type SessionUser } from "./auth";
import { digest, sessionIdentity } from "./regional-auth-contract";
import { readSyncJson } from "./project-sync-http";
import { sameOrigin } from "./same-origin";
import { readComponentWrite } from "./component-write-request";
import { catchUpResource } from "./resource-action-catchup";
import { RESOURCE_MAX_BYTES } from "./resource-replica";
import type { ResourceActionEnv } from "./regional-resource-actions";
import {
  COMPONENT_LIBRARY_ID,
  COMPONENT_DEFINITION_MAX_BYTES,
  type SharedComponent,
} from "../apps/editor/src/features/user-components/component-library-contract";

const peerPath = "/api/resource-actions/component";
type Command = {
  id: string;
  operation: "save" | "status";
  commandId: string;
  target: string;
  input: Record<string, unknown>;
};
type ComponentResult = { entry: SharedComponent; outcome?: string };
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (error: string, status: number) => answer({ error }, status);

/** Component commands retain the normal payload, ownership and revision checks. */
export async function routeRegionalComponentActions(
  request: Request,
  env: ResourceActionEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    incoming = url.pathname === peerPath;
  const id = url.pathname.startsWith("/api/components/")
    ? url.pathname.slice("/api/components/".length)
    : "";
  if (
    !incoming &&
    (!COMPONENT_LIBRARY_ID.test(id) ||
      !["PUT", "PATCH"].includes(request.method))
  )
    return null;
  if (!env.RESOURCE_ACTION_PEER || !env.RESOURCE_REGION)
    return incoming ? fail("not-found", 404) : null;
  if (incoming && request.method !== "POST")
    return fail("method-not-allowed", 405);
  if (!env.COMPONENT_LIBRARY) return fail("component-library-unavailable", 503);
  const store = env.COMPONENT_LIBRARY.getByName("components");
  const call = (operation: string, body: unknown) =>
    store.fetch("https://components/" + operation, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const auth = (operation: string, body: unknown) =>
    env
      .AUTH!.getByName("auth")
      .fetch("https://auth/internal/resource-action-" + operation, {
        method: "POST",
        headers: { cookie: request.headers.get("cookie") ?? "" },
        body: JSON.stringify(body),
      });
  let committed = false;
  let parsing = true;
  try {
    const peer = new URL(env.RESOURCE_ACTION_PEER);
    if (
      peer.protocol !== "https:" ||
      peer.origin !== env.RESOURCE_ACTION_PEER ||
      peer.username ||
      peer.password
    )
      return fail("action-not-configured", 503);
    let command: Command, user: SessionUser | null;
    if (incoming) {
      const body = (await readSyncJson(
        request,
        COMPONENT_DEFINITION_MAX_BYTES * 2,
      )) as Partial<Command> | null;
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.id !== "string" ||
        !COMPONENT_LIBRARY_ID.test(body.id) ||
        (body.operation !== "save" && body.operation !== "status") ||
        !body.input ||
        typeof body.input !== "object" ||
        Array.isArray(body.input) ||
        typeof body.commandId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.commandId) ||
        body.target !== env.RESOURCE_REGION
      )
        return fail("invalid-command", 400);
      command = {
        id: body.id,
        operation: body.operation,
        commandId: body.commandId,
        target: body.target,
        input: body.input,
      };
      const verified = await auth("verify", {
        token: request.headers.get("authorization")?.replace(/^Bearer /, ""),
        binding: await digest(JSON.stringify(command)),
      });
      if (!verified.ok) return fail("unauthorized", verified.status);
      user = sessionIdentity((await verified.json()).user);
      const parsed = await readComponentWrite(
        new Request("https://components/", {
          method: command.operation === "save" ? "PUT" : "PATCH",
          body: JSON.stringify(command.input),
        }),
      );
      if (parsed instanceof Response) return parsed;
    } else {
      if (
        !sameOrigin(request) ||
        request.headers.get("sec-fetch-site") === "same-site"
      )
        return fail("forbidden", 403);
      user = await sessionUserOf(request, env);
      if (!user) return fail("unauthorized", 401);
      const parsed = await readComponentWrite(request);
      if (parsed instanceof Response) return parsed;
      const input = JSON.parse(
        JSON.stringify({
          revision: parsed.revision,
          definition: parsed.definition,
          circuit: parsed.circuit,
          status: parsed.status,
          action: parsed.action,
        }),
      );
      const operation = request.method === "PUT" ? "save" : "status";
      // Revision-bound requests without a supplied key are safe to retry as the same intent.
      const key =
        request.headers.get("idempotency-key") ??
        parsed.idempotencyKey ??
        (await digest(
          JSON.stringify({ actor: user.id, id, operation, input }),
        ));
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(key))
        return fail("invalid-command-id", 400);
      const location = await call("resource-sync/location", {
        stream: "components",
        id,
      });
      if (!location.ok) return location;
      command = {
        id,
        operation,
        commandId: key,
        target: (await location.json()).origin,
        input,
      };
    }
    if (!user) return fail("unauthorized", 401);
    parsing = false;
    const binding = await digest(JSON.stringify(command));
    if (incoming || command.target === env.RESOURCE_REGION) {
      const location = await call("resource-sync/location", {
        stream: "components",
        id: command.id,
      });
      if (
        !location.ok ||
        (await location.json()).origin !== env.RESOURCE_REGION
      )
        return fail("wrong-writer", 409);
      const response = await call(command.operation, {
        ...command.input,
        id: command.id,
        userId: user.id,
        author: user.displayName,
        admin: user.isAdmin,
        idempotencyKey: command.commandId,
        regionalCommand: { id: command.commandId, binding },
      });
      if (!response.ok) return response;
      const result = await response.json(),
        superseded =
          response.headers.get("x-regional-command-superseded") === "true";
      if (!incoming)
        return superseded ? fail("action-superseded", 409) : answer(result);
      const head = await (
        await call("resource-sync/status", { stream: "components" })
      ).json();
      return answer({
        result,
        superseded,
        epoch: head.epoch,
        sequence: head.sequence,
      });
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
    const envelope = (await readSyncJson(
      response,
      command.operation === "status"
        ? RESOURCE_MAX_BYTES * 2
        : COMPONENT_DEFINITION_MAX_BYTES * 2,
    )) as {
      result: ComponentResult;
      epoch: string;
      sequence: number;
      superseded?: boolean;
    } | null;
    if (
      envelope?.result?.entry?.id !== command.id ||
      !Number.isSafeInteger(envelope.result.entry.revision) ||
      typeof envelope.epoch !== "string" ||
      !Number.isSafeInteger(envelope.sequence)
    )
      return fail("action-unconfirmed", 503);
    committed = true;
    if (
      !(await catchUpResource(
        call,
        "components",
        peer.origin,
        env.RESOURCE_SYNC_PEER_TOKEN,
        envelope,
      ))
    )
      return fail("action-propagation-pending", 503);
    const current = await call("get", {
      id: command.id,
      userId: user.id,
      admin: user.isAdmin,
    });
    if (!current.ok) return fail("action-superseded", 409);
    const { entry } = await current.json();
    if (
      envelope.superseded ||
      entry.revision !== envelope.result.entry.revision ||
      entry.status !== envelope.result.entry.status
    )
      return fail("action-superseded", 409);
    return answer(envelope.result);
  } catch (error) {
    if (parsing && error instanceof RangeError) return fail("too-large", 413);
    if (parsing && error instanceof SyntaxError)
      return fail("invalid-json", 400);
    return fail(
      committed ? "action-propagation-pending" : "action-unconfirmed",
      503,
    );
  }
}
