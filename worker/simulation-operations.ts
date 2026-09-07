import {
  DEFAULT_MANAGED_RUN_POLICY,
  Digest,
  ManagedRunRecordSchema,
  type ArtifactRef,
  type ManagedRunRecord,
  type Problem,
} from "@icm/simulation-service";

import { sessionUserOf } from "./auth";
import type { AuthEnv, SessionUser } from "./auth-do";
import type { SimulationControlNamespaceLike } from "./simulation-control-do";
import {
  routeSimulationRequest,
  type SimulationEnv,
  type SimulationRequestBody,
} from "./simulation";

const MAX_MANAGED_INPUT_BYTES = 2 * 1024 * 1024;
const CONTROL_NAME = "simulation";

export interface SimulationArtifactObject {
  text(): Promise<string>;
}

export interface SimulationArtifactBucket {
  get(key: string): Promise<SimulationArtifactObject | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface SimulationJobQueue {
  send(body: SimulationJobMessage): Promise<void>;
}

export interface SimulationOperationsEnv
  extends SimulationEnv, Partial<AuthEnv> {
  SIMULATION_CONTROL?: SimulationControlNamespaceLike;
  SIMULATION_JOBS?: SimulationJobQueue;
  SIMULATION_ARTIFACTS?: SimulationArtifactBucket;
}

export interface SimulationJobMessage {
  schemaVersion: 1;
  runId: string;
}

export interface SimulationQueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface SimulationQueueBatch<T> {
  messages: readonly SimulationQueueMessage<T>[];
}

export interface SimulationOperationsRuntime {
  principalOf(
    request: Request,
    env: SimulationOperationsEnv,
  ): Promise<SessionUser | null>;
  now(): number;
  uuid(): string;
}

const defaultRuntime: SimulationOperationsRuntime = {
  principalOf: (request, env) => sessionUserOf(request, env),
  now: Date.now,
  uuid: () => crypto.randomUUID(),
};

type StartBody = {
  requestId?: unknown;
  preparedId?: unknown;
  preparedDigest?: unknown;
  input?: unknown;
};

function control(env: SimulationOperationsEnv) {
  return env.SIMULATION_CONTROL?.getByName(CONTROL_NAME) ?? null;
}

function configured(env: SimulationOperationsEnv): boolean {
  return !!(
    env.SIMULATION_CONTROL &&
    env.SIMULATION_JOBS &&
    env.SIMULATION_ARTIFACTS
  );
}

function runPath(runId: string): string {
  return `https://simulation-control/runs/${encodeURIComponent(runId)}`;
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 160);
}

function asInput(value: unknown): SimulationRequestBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as SimulationRequestBody;
  if (
    input.operation !== undefined ||
    typeof input.inputRevision !== "string" ||
    !input.environment ||
    typeof input.environment.profileId !== "string"
  )
    return null;
  return input;
}

async function readRun(
  env: SimulationOperationsEnv,
  runId: string,
): Promise<ManagedRunRecord | null> {
  const stub = control(env);
  if (!stub) return null;
  const response = await stub.fetch(runPath(runId));
  if (!response.ok) return null;
  const value = (await response.json()) as { run?: unknown };
  const parsed = ManagedRunRecordSchema.safeParse(value.run);
  return parsed.success ? parsed.data : null;
}

async function transitionRun(
  env: SimulationOperationsEnv,
  runId: string,
  event: unknown,
): Promise<ManagedRunRecord | null> {
  const stub = control(env);
  if (!stub) return null;
  const response = await stub.fetch(runPath(runId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) return null;
  const value = (await response.json()) as { run?: unknown };
  const parsed = ManagedRunRecordSchema.safeParse(value.run);
  return parsed.success ? parsed.data : null;
}

function ownerMayRead(run: ManagedRunRecord, principal: SessionUser): boolean {
  return run.ownerId === principal.id || principal.isAdmin;
}

export async function routeManagedSimulationRequest(
  request: Request,
  env: SimulationOperationsEnv,
  runtime: SimulationOperationsRuntime = defaultRuntime,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/simulation/runs")) return null;
  if (!configured(env))
    return Response.json(
      {
        error: "simulation-operations-not-configured",
        message:
          "Managed simulation runs are not configured in this deployment.",
      },
      { status: 503 },
    );
  const principal = await runtime.principalOf(request, env);
  if (!principal)
    return Response.json(
      { error: "simulation-authentication-required" },
      { status: 401 },
    );

  if (url.pathname === "/api/simulation/runs") {
    if (request.method !== "POST")
      return Response.json({ error: "method-not-allowed" }, { status: 405 });
    const body = (await request.json().catch(() => null)) as StartBody | null;
    const input = asInput(body?.input);
    if (
      !body ||
      typeof body.requestId !== "string" ||
      body.requestId.length === 0 ||
      body.requestId.length > 256 ||
      typeof body.preparedId !== "string" ||
      typeof body.preparedDigest !== "string" ||
      !Digest.safeParse(body.preparedDigest).success ||
      !input
    )
      return Response.json({ error: "invalid-managed-run" }, { status: 400 });
    const canonicalInput = JSON.stringify(input);
    if (
      new TextEncoder().encode(canonicalInput).length > MAX_MANAGED_INPUT_BYTES
    )
      return Response.json({ error: "deck-too-large" }, { status: 413 });
    const requestFingerprint = await sha256(
      JSON.stringify({
        preparedId: body.preparedId,
        preparedDigest: body.preparedDigest,
        timeoutMs: input.timeoutMs ?? null,
        input,
      }),
    );
    const inputKey = `simulation-inputs/${safeSegment(principal.id)}/${requestFingerprint}.json`;
    await env.SIMULATION_ARTIFACTS!.put(inputKey, canonicalInput, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        ownerId: principal.id,
        requestFingerprint,
      },
    });
    const inputArtifact: ArtifactRef = {
      id: inputKey,
      name: "managed-input.json",
      mediaType: "application/json",
      byteLength: new TextEncoder().encode(canonicalInput).length,
      sha256: await sha256(canonicalInput),
    };
    const response = await control(env)!.fetch(
      "https://simulation-control/accept",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerId: principal.id,
          requestId: body.requestId,
          requestFingerprint,
          preparedId: body.preparedId,
          preparedDigest: body.preparedDigest,
          inputRevision: input.inputRevision,
          environment: input.environment,
          timeoutMs:
            typeof input.timeoutMs === "number" ? input.timeoutMs : 60_000,
          maxAttempts: 3,
          artifacts: [inputArtifact],
        }),
      },
    );
    const result = (await response.json()) as {
      run?: ManagedRunRecord;
      accepted?: boolean;
      error?: string;
      retryAfterMs?: number;
    };
    if (!response.ok || !result.run)
      return Response.json(result, {
        status: response.status,
        ...(result.retryAfterMs === undefined
          ? {}
          : {
              headers: {
                "retry-after": String(Math.ceil(result.retryAfterMs / 1_000)),
              },
            }),
      });
    try {
      await env.SIMULATION_JOBS!.send({
        schemaVersion: 1,
        runId: result.run.id,
      });
    } catch {
      return Response.json(
        {
          error: "simulation-queue-unavailable",
          run: result.run,
          recovery: "retry-same-request",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { run: result.run, accepted: result.accepted === true },
      { status: result.accepted === true ? 202 : 200 },
    );
  }

  const match = url.pathname.match(
    /^\/api\/simulation\/runs\/([^/]+)(\/(?:cancel|result))?$/u,
  );
  if (!match) return Response.json({ error: "not-found" }, { status: 404 });
  const runId = decodeURIComponent(match[1]!);
  const run = await readRun(env, runId);
  if (!run || !ownerMayRead(run, principal))
    return Response.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  if (!match[2]) {
    if (request.method !== "GET")
      return Response.json({ error: "method-not-allowed" }, { status: 405 });
    return Response.json({ run });
  }
  if (match[2] === "/result") {
    if (request.method !== "GET")
      return Response.json({ error: "method-not-allowed" }, { status: 405 });
    const result = run.artifacts.find(
      (artifact) => artifact.name === "response.json",
    );
    if (!result)
      return Response.json(
        {
          error: "RESULT_NOT_READY",
          state: run.state,
          retryAfterMs: 1_000,
        },
        { status: 409, headers: { "retry-after": "1" } },
      );
    const object = await env.SIMULATION_ARTIFACTS!.get(result.id);
    if (!object)
      return Response.json({ error: "RESULT_EXPIRED" }, { status: 410 });
    return new Response(await object.text(), {
      headers: {
        "content-type": result.mediaType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (request.method !== "POST")
    return Response.json({ error: "method-not-allowed" }, { status: 405 });
  const transitioned = await transitionRun(env, runId, {
    kind: "cancel-requested",
    at: runtime.now(),
  });
  if (!transitioned)
    return Response.json(
      { error: "cancel-transition-failed" },
      { status: 409 },
    );
  if (transitioned.state === "cancelling") {
    await routeSimulationRequest(
      new Request("https://simulation/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "cancel", runToken: runId }),
      }),
      env,
    );
  }
  return Response.json({ run: transitioned });
}

function infrastructureProblem(code: string): Problem {
  return {
    code,
    message: "The execution infrastructure did not complete this attempt.",
    stage: "start",
    recovery: "retry-after",
    retryAfterMs: 2_000,
  };
}

function responseCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { error?: unknown; reason?: unknown };
  return typeof body.reason === "string"
    ? body.reason
    : typeof body.error === "string"
      ? body.error
      : null;
}

const retryableInfrastructureCodes = new Set([
  "simulator-busy",
  "simulator-unreachable",
  "simulation-executor-unavailable",
  "simulator-not-ready",
]);

export async function consumeSimulationJobs(
  batch: SimulationQueueBatch<SimulationJobMessage>,
  env: SimulationOperationsEnv,
  runtime: Pick<SimulationOperationsRuntime, "now" | "uuid"> = defaultRuntime,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const current = await readRun(env, message.body.runId);
      if (
        !current ||
        [
          "succeeded",
          "failed",
          "timed-out",
          "cancelled",
          "infrastructure-failed",
          "expired",
        ].includes(current.state)
      ) {
        message.ack();
        continue;
      }
      let queued = current;
      if (
        (current.state === "running" || current.state === "cancelling") &&
        current.lease &&
        current.lease.expiresAt <= runtime.now()
      ) {
        const recovered = await transitionRun(env, current.id, {
          kind: "lease-expired",
          at: runtime.now(),
          error: infrastructureProblem("RUN_LEASE_EXPIRED"),
        });
        if (!recovered || recovered.state !== "queued") {
          message.ack();
          continue;
        }
        queued = recovered;
      }
      if (queued.state !== "queued") {
        message.retry({ delaySeconds: 2 });
        continue;
      }
      const leased = await transitionRun(env, queued.id, {
        kind: "lease-acquired",
        lease: {
          id: runtime.uuid(),
          acquiredAt: runtime.now(),
          expiresAt: runtime.now() + DEFAULT_MANAGED_RUN_POLICY.leaseMs,
        },
      });
      if (!leased) {
        message.retry({ delaySeconds: 2 });
        continue;
      }
      // Queue messages carry identity, not storage authority. The immutable
      // input key comes from the admitted run, so a stale or malformed queue
      // delivery cannot make the consumer execute another owner's object.
      const inputArtifact = queued.artifacts.find(
        (artifact) => artifact.name === "managed-input.json",
      );
      const inputObject = inputArtifact
        ? await env.SIMULATION_ARTIFACTS?.get(inputArtifact.id)
        : null;
      if (!inputObject) {
        await transitionRun(env, queued.id, {
          kind: "failed",
          at: runtime.now(),
          error: {
            code: "PREPARED_INPUT_UNAVAILABLE",
            message: "The immutable input artifact is unavailable.",
            stage: "start",
            recovery: "reprepare",
          },
        });
        message.ack();
        continue;
      }
      const input = JSON.parse(
        await inputObject.text(),
      ) as SimulationRequestBody;
      input.runToken = queued.id;
      const response = await routeSimulationRequest(
        new Request("https://simulation/api/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        env,
      );
      if (!response) throw new Error("simulation route unavailable");
      const responseText = await response.text();
      const responseValue = JSON.parse(responseText) as {
        cancelled?: unknown;
        outcome?: { status?: unknown };
      };
      const code = responseCode(responseValue);
      if (!response.ok && code && retryableInfrastructureCodes.has(code)) {
        const retried = await transitionRun(env, queued.id, {
          kind: "infrastructure-failed",
          at: runtime.now(),
          error: infrastructureProblem(code),
        });
        if (retried?.state === "queued") message.retry({ delaySeconds: 2 });
        else message.ack();
        continue;
      }
      const resultKey = `simulation-runs/${safeSegment(queued.ownerId)}/${queued.id}/response.json`;
      await env.SIMULATION_ARTIFACTS!.put(resultKey, responseText, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { ownerId: queued.ownerId, runId: queued.id },
      });
      const resultArtifact: ArtifactRef = {
        id: resultKey,
        name: "response.json",
        mediaType: "application/json",
        byteLength: new TextEncoder().encode(responseText).length,
        sha256: await sha256(responseText),
      };
      const artifacts = [...queued.artifacts, resultArtifact];
      if (responseValue.cancelled === true)
        await transitionRun(env, queued.id, {
          kind: "cancelled",
          at: runtime.now(),
          artifacts,
        });
      else if (responseValue.outcome?.status === "timed-out")
        await transitionRun(env, queued.id, {
          kind: "timed-out",
          at: runtime.now(),
          error: {
            code: "RUN_TIMED_OUT",
            message: "The simulator reached the run deadline.",
            stage: "start",
            recovery: "fix-input",
          },
          artifacts,
        });
      else if (responseValue.outcome?.status === "failed")
        await transitionRun(env, queued.id, {
          kind: "failed",
          at: runtime.now(),
          error: {
            code: "SIMULATION_FAILED",
            message: "ngspice did not produce the requested result.",
            stage: "start",
            recovery: "fix-input",
          },
          artifacts,
        });
      else if (
        response.ok &&
        (responseValue.outcome?.status === "completed" ||
          responseValue.outcome?.status === "completed-with-dropped-input")
      )
        await transitionRun(env, queued.id, {
          kind: "completed",
          at: runtime.now(),
          artifacts,
        });
      else
        await transitionRun(env, queued.id, {
          kind: "failed",
          at: runtime.now(),
          error: {
            code: code ?? "SIMULATION_FAILED",
            message: "The simulator refused or failed this input.",
            stage: "start",
            recovery: "fix-input",
          },
          artifacts,
        });
      message.ack();
    } catch {
      const run = await readRun(env, message.body.runId).catch(() => null);
      if (run?.state === "running")
        await transitionRun(env, run.id, {
          kind: "infrastructure-failed",
          at: runtime.now(),
          error: infrastructureProblem("SIMULATION_CONSUMER_FAILED"),
        }).catch(() => null);
      message.retry({ delaySeconds: 2 });
    }
  }
}
