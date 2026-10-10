import {
  AgentConnectionCredentialResponseSchema,
  AgentCircuitResponseSchema,
  AgentFileResourceResponseSchema,
  AgentSimulationResourceResponseSchema,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
  AgentProjectResourceResponseSchema,
  AgentSessionStatusResponseSchema,
  type AgentSessionStatusResponse,
} from "@icm/agent-adapter";
import {
  invalidResponseFailure,
  networkFailure,
  transportFailure,
} from "./errors.js";
import {
  EvidenceResourceUsageSchema,
  type EvidenceResourceUsage,
} from "@icm/simulation-service/contract";

interface ResponseIssue {
  code: string;
  path: PropertyKey[];
  errors?: ResponseIssue[][];
  values?: unknown[];
}

/** Describe schema locations/codes only, never response values or unknown keys. */
function responseIssueSummary(issues: readonly ResponseIssue[]): string {
  const leaves = (
    items: readonly ResponseIssue[],
    prefix: PropertyKey[] = [],
  ): ResponseIssue[] =>
    items.flatMap((issue) => {
      const path = [...prefix, ...issue.path];
      if (!issue.errors?.length) return [{ ...issue, path }];
      const branches = issue.errors.map((branch) => leaves(branch, path));
      // A short, unrelated union branch (e.g. capabilities for a Snapshot)
      // must not hide the actual invalid field in the matching branch.
      const mismatches = (branch: ResponseIssue[]) =>
        branch.filter(
          (item) =>
            item.code === "invalid_value" &&
            item.values?.length === 1 &&
            ["operation", "kind", "ok"].includes(String(item.path.at(-1))),
        ).length;
      return (
        branches.sort(
          (a, b) => mismatches(a) - mismatches(b) || a.length - b.length,
        )[0] ?? [issue]
      );
    });
  return leaves(issues)
    .slice(0, 3)
    .map(
      (issue) =>
        `${issue.path.map(String).join(".").slice(0, 160) || "response"} (${issue.code})`,
    )
    .join("; ");
}

/**
 * Every relayed call (circuit, files, simulation) is forwarded to the editor
 * under the Worker's FORWARD_TIMEOUT_MS of 30 s. The client must outlive
 * that so the relay's own 504 reaches the caller; a 30 s client timeout
 * races the relay and masks the cause as a bare abort.
 */
const REQUEST_TIMEOUT_MS = 35_000;

export interface ClaimSuccess {
  contextRevision?: string | undefined;
  sessionId: string;
  /** Secret bearer. Stays inside the Helper; never returned to a model. */
  agentToken: string;
  tokenExpiresAt: number;
  /** Durable, revocable pairing secret. Persist this instead of the bearer. */
  connectorToken: string;
  connectorExpiresAt: number;
  scopes: string[];
  projectId: string;
  documentIds: string[];
}

export interface AgentHttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  /** Bounded 429 backoff. The serialized body and request ID never change. */
  rateLimitRetryAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ErrorResponseBody {
  ok?: boolean;
  agentToken?: unknown;
  tokenExpiresAt?: unknown;
  scopes?: unknown;
  projectId?: unknown;
  documentIds?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${path}`;
}

/**
 * Thin HTTP client for the public four-operation API. It knows the three
 * endpoints a Helper needs (claim, circuit, kit/openapi are not its concern),
 * enforces a request timeout, and normalizes every failure into an
 * `AgentSessionError` so callers never inspect raw status codes.
 */
export class AgentHttpClient {
  private readonly baseUrlValue: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly rateLimitRetryAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: AgentHttpClientOptions) {
    this.baseUrlValue = options.baseUrl;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.rateLimitRetryAttempts = options.rateLimitRetryAttempts ?? 2;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get baseUrl(): string {
    return this.baseUrlValue;
  }

  /** Authorized byte stream; never send a bearer to a returned external URL. */
  async downloadArtifact(
    sessionId: string,
    agentToken: string,
    path: string,
    offset = 0,
    digest?: string,
    leaseId?: string,
  ): Promise<Response> {
    const prefix = `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/`;
    if (
      !path.startsWith(prefix) ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(path.slice(prefix.length))
    )
      throw invalidResponseFailure(
        "Artifact download is outside the authorized session",
      );
    const response = await this.send(
      path,
      {
        method: "GET",
        redirect: "error",
        headers: {
          authorization: `Bearer ${agentToken}`,
          ...(leaseId ? { "x-artifact-lease": leaseId } : {}),
          ...(offset
            ? {
                range: `bytes=${offset}-`,
                ...(digest ? { "if-range": `"${digest}"` } : {}),
              }
            : {}),
        },
      },
      120_000,
    );
    if (!response.ok)
      throw this.transportError(
        response.status,
        await this.consume(response, (body) => body),
      );
    return response;
  }
  /** Release only this unguessable download lease after verified local commit. */
  async releaseArtifactDownload(
    sessionId: string,
    agentToken: string,
    path: string,
    leaseId: string,
  ): Promise<void> {
    const prefix = `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/`;
    if (
      !path.startsWith(prefix) ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(path.slice(prefix.length)) ||
      !/^[0-9a-f-]{36}$/u.test(leaseId)
    )
      throw invalidResponseFailure(
        "Artifact lease is outside the authorized session",
      );
    const response = await this.send(
      path,
      {
        method: "DELETE",
        redirect: "error",
        headers: {
          authorization: `Bearer ${agentToken}`,
          "x-artifact-lease": leaseId,
        },
      },
      30_000,
    );
    if (!response.ok && response.status !== 404)
      throw this.transportError(
        response.status,
        await this.consume(response, (body) => body),
      );
    await response.body?.cancel();
  }
  async artifactUsage(
    sessionId: string,
    agentToken: string,
  ): Promise<EvidenceResourceUsage> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifact-status`,
      {
        method: "GET",
        redirect: "error",
        headers: { authorization: `Bearer ${agentToken}` },
      },
      30_000,
    );
    const body = (await this.consume(response, (value) => value)) as {
      usage?: unknown;
    };
    if (!response.ok) throw this.transportError(response.status, body);
    const parsed = EvidenceResourceUsageSchema.safeParse(body.usage);
    if (!parsed.success || parsed.data.scope !== "agent-session-transfer")
      throw invalidResponseFailure("Artifact transfer usage failed validation");
    return parsed.data;
  }

  /**
   * Redeem a `<sessionId>.<code>` claim code. The session ID travels in the
   * claim code prefix, so the response alone is sufficient afterwards.
   */
  async claim(claimCode: string): Promise<ClaimSuccess> {
    const response = await this.send("/api/agent/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimCode }),
    });
    return this.consume(response, (body) => {
      if (response.ok) return this.parseCredential(body, "Claim");
      throw this.transportError(response.status, body);
    });
  }

  /** Resume a prior browser-approved pairing and mint a fresh bearer. */
  async resumeConnector(
    sessionId: string,
    connectorToken: string,
  ): Promise<ClaimSuccess> {
    const response = await this.send("/api/agent/connectors/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, connectorToken }),
    });
    return this.consume(response, (body) => {
      if (response.ok) return this.parseCredential(body, "Connector resume");
      throw this.transportError(response.status, body);
    });
  }

  /**
   * Invoke one four-operation request. A 200 response is parsed against the
   * canonical response schema; every non-200 response is normalized to an
   * `AgentSessionError`.
   */
  async circuit(
    sessionId: string,
    agentToken: string,
    request: AgentCircuitRequest,
    attempts?: AgentHttpAttempts,
  ): Promise<AgentCircuitResponse> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/circuit`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify(request),
      },
      this.timeoutMs,
      request,
      attempts,
    );
    return this.consume(response, (body) => {
      if (!response.ok) {
        throw this.transportError(response.status, body);
      }
      const parsed = AgentCircuitResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw invalidResponseFailure(
          `Circuit response failed schema validation: ${responseIssueSummary(parsed.error.issues)}. Check the server MCP manifest and reload a compatible adapter. Do not repeat a mutation blindly: it may already have committed. The connector remains valid unless the server revokes it.`,
        );
      }
      if (parsed.data.ok && request.operation === "snapshot")
        this.contextRevision =
          response.headers.get("x-agent-context") ?? this.contextRevision;
      return parsed.data;
    });
  }

  async files(
    sessionId: string,
    agentToken: string,
    request: AgentFileResourceRequest,
    attempts?: AgentHttpAttempts,
  ): Promise<AgentFileResourceResponse> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify(request),
      },
      this.timeoutMs,
      request,
      attempts,
    );
    return this.consume(response, (body) => {
      if (!response.ok) throw this.transportError(response.status, body);
      const parsed = AgentFileResourceResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw invalidResponseFailure(
          `File response failed schema validation. ${this.outdatedAdapterHint()}`,
        );
      }
      return parsed.data;
    });
  }

  /**
   * Invoke the browser-hosted Simulation Resource.
   *
   * The 120 s simulation-level ceiling (`AGENT_SIMULATION_MAX_TIMEOUT_MS`)
   * is a run-duration limit enforced inside the browser host, not this
   * transport; each simulation HTTP step still answers within the shared
   * client timeout, above the relay's own forward timeout.
   */
  async simulation(
    sessionId: string,
    agentToken: string,
    request: AgentSimulationResourceRequest,
    attempts?: AgentHttpAttempts,
  ): Promise<AgentSimulationResourceResponse> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/simulation`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify(request),
      },
      this.timeoutMs,
      request,
      attempts,
    );
    return this.consume(response, (body) => {
      if (!response.ok) throw this.transportError(response.status, body);
      const parsed = AgentSimulationResourceResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw invalidResponseFailure(
          `Simulation response failed schema validation: ${responseIssueSummary(parsed.error.issues)}. Check the server MCP manifest and reload a compatible adapter; use the published HTTP Agent Kit if unavailable. The connector remains valid unless the server revokes it.`,
        );
      }
      return parsed.data;
    });
  }

  async projects(
    sessionId: string,
    agentToken: string,
    request: AgentProjectResourceRequest,
    attempts?: AgentHttpAttempts,
  ): Promise<AgentProjectResourceResponse> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/projects`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify(request),
      },
      this.timeoutMs,
      request,
      attempts,
    );
    return this.consume(response, (body) => {
      if (!response.ok) throw this.transportError(response.status, body);
      const parsed = AgentProjectResourceResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw invalidResponseFailure(
          `Project response failed schema validation: ${responseIssueSummary(parsed.error.issues)}. ${this.outdatedAdapterHint()}`,
        );
      }
      return parsed.data;
    });
  }

  /**
   * What a response this adapter cannot read most often means: the Editor
   * answers in a newer contract, so the adapter is the one to update.
   */
  private outdatedAdapterHint(): string {
    return `This adapter is probably older than the Editor: update it from ${joinUrl(this.baseUrlValue, "/api/agent/mcp-manifest.json")}, then retry.`;
  }

  async disconnect(sessionId: string, agentToken: string): Promise<void> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${agentToken}` },
      },
    );
    if (!response.ok) {
      return this.consume(response, (body) => {
        throw this.transportError(response.status, body);
      });
    }
  }

  async status(
    sessionId: string,
    agentToken: string,
  ): Promise<AgentSessionStatusResponse> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/status`,
      { method: "GET", headers: { authorization: `Bearer ${agentToken}` } },
      3_000,
    );
    return this.consume(response, (body) => {
      if (!response.ok) throw this.transportError(response.status, body);
      const parsed = AgentSessionStatusResponseSchema.safeParse(body);
      if (!parsed.success)
        throw invalidResponseFailure("Session status failed schema validation");
      this.contextRevision = parsed.data.contextRevision;
      return parsed.data;
    });
  }

  /** The session's last answered requests, kept by the relay (#1227). */
  async activity(
    sessionId: string,
    agentToken: string,
  ): Promise<AgentRelayOperation[]> {
    const response = await this.send(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/activity`,
      { method: "GET", headers: { authorization: `Bearer ${agentToken}` } },
      3_000,
    );
    return this.consume(response, (value) => {
      const body = value as {
        ok?: unknown;
        operations?: unknown;
      } | null;
      if (!response.ok) throw this.transportError(response.status, body);
      if (body?.ok !== true || !Array.isArray(body.operations))
        throw invalidResponseFailure("Session activity is not readable");
      return body.operations as AgentRelayOperation[];
    });
  }

  private async send(
    path: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
    identity?: { requestId: string; operation: string },
    attempts: AgentHttpAttempts = { count: 0 },
  ): Promise<Response> {
    if (
      this.contextRevision &&
      /\/(circuit|files|simulation|projects)$/.test(path)
    ) {
      const headers = new Headers(init.headers);
      headers.set("x-agent-context", this.contextRevision);
      init = { ...init, headers };
    }
    if (
      this.workspaceId &&
      /\/(circuit|files|simulation|projects)$/.test(path)
    ) {
      const headers = new Headers(init.headers);
      headers.set("x-agent-workspace", this.workspaceId);
      init = { ...init, headers };
    }
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      const requestAttempt = ++attempts.count;
      const started = performance.now();
      try {
        response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
        attempts.last = this.noteTiming(
          path,
          started,
          requestAttempt,
          identity,
          response,
        );
      } catch (error) {
        attempts.last = this.noteTiming(
          path,
          started,
          requestAttempt,
          identity,
          undefined,
          error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
            ? "timeout"
            : "network-error",
        );
        throw networkFailure(
          error instanceof Error ? error.message : "Network request failed",
        );
      }
      if (response.status !== 429 || attempt >= this.rateLimitRetryAttempts) {
        return response;
      }
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const requestedDelay = Number.isFinite(seconds)
        ? seconds * 1000
        : retryAfter
          ? Date.parse(retryAfter) - Date.now()
          : NaN;
      const delay = Number.isFinite(requestedDelay)
        ? Math.max(0, requestedDelay)
        : 1000 * 2 ** attempt;
      // Do not wait indefinitely or retry earlier than the server permits.
      if (delay > timeoutMs) return response;
      await response.body?.cancel();
      const timing = this.responseTimings.get(response);
      if (timing) timing.record.outcome = "retry";
      const backoffStarted = performance.now();
      await this.sleep(delay);
      if (timing)
        timing.record.retryDelayMs = Math.round(
          performance.now() - backoffStarted,
        );
    }
  }

  private transportError(status: number, body: unknown): Error {
    const errorBody = body as ErrorResponseBody | null;
    const code =
      typeof errorBody?.error?.code === "string" ? errorBody.error.code : "";
    const message =
      typeof errorBody?.error?.message === "string"
        ? errorBody.error.message
        : "";
    if (code && message) {
      return transportFailure(code, message, status);
    }
    if (status === 401) {
      return transportFailure("TOKEN_INVALID", "Unauthorized", status);
    }
    if (status === 503) {
      return transportFailure("EDITOR_OFFLINE", "Editor is offline", status);
    }
    return transportFailure(
      "HTTP_ERROR",
      `HTTP ${status}${message ? `: ${message}` : ""}`,
      status,
    );
  }

  private parseCredential(body: unknown, source: string): ClaimSuccess {
    const parsed = AgentConnectionCredentialResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponseFailure(
        `${source} response is missing required fields`,
      );
    }
    this.contextRevision = parsed.data.contextRevision;
    return parsed.data;
  }

  contextRevision: string | undefined;
  /** Optional explicit browser working copy; unset keeps active-tab semantics. */
  workspaceId: string | undefined;

  /**
   * Where each request's time went, newest last (#1227): the whole round
   * trip including consumed JSON and validation; header wait, body work,
   * relay phases and editor observations remain distinct. Bounded. Byte
   * downloads measure through headers only; the stream consumer owns transfer.
   */
  readonly requestTimings: AgentRequestTiming[] = [];
  private timingCount = 0;
  private readonly responseTimings = new WeakMap<
    Response,
    { started: number; record: AgentRequestTiming }
  >();

  /** Body transfer, JSON parse and canonical validation share one completion. */
  private async consume<T>(
    response: Response,
    parse: (body: unknown) => T,
  ): Promise<T> {
    const started = performance.now();
    const timing = this.responseTimings.get(response);
    let bodyFailure: "timeout" | "network-error" | undefined;
    try {
      const body: unknown = await response.json().catch((error: unknown) => {
        if (error instanceof Error) {
          if (error.name === "TimeoutError" || error.name === "AbortError")
            bodyFailure = "timeout";
          else if (error.name === "TypeError") bodyFailure = "network-error";
        }
        // Retain the established parse/null and public error/retry behavior.
        return null;
      });
      return parse(body);
    } catch (error) {
      if (timing && response.ok && !bodyFailure)
        timing.record.outcome = "invalid-response";
      throw error;
    } finally {
      if (timing) {
        if (bodyFailure) timing.record.outcome = bodyFailure;
        timing.record.bodyMs = Math.round(performance.now() - started);
        timing.record.totalMs = Math.round(performance.now() - timing.started);
        this.responseTimings.delete(response);
      }
    }
  }

  /** A mark to read the timings of the requests made after it. */
  timingMark(): number {
    return this.timingCount;
  }

  timingsSince(mark: number): AgentRequestTiming[] {
    const count = Math.min(this.timingCount - mark, this.requestTimings.length);
    return count > 0 ? this.requestTimings.slice(-count) : [];
  }

  private noteTiming(
    path: string,
    started: number,
    attempt: number,
    identity?: { requestId: string; operation: string },
    response?: Response,
    failure?: "timeout" | "network-error",
  ) {
    const header = (name: string) => {
      const value = Number(response?.headers.get(name));
      return response?.headers.has(name) && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
    };
    const relayMs = header("x-agent-relay-ms");
    const editorMs = header("x-agent-editor-ms");
    const visibility = response?.headers.get("x-agent-editor-visibility");
    const headerMs = Math.round(performance.now() - started);
    this.timingCount += 1;
    const resource =
      path.match(
        /\/sessions\/[^/]+\/(circuit|files|simulation|projects|status|activity|artifacts)(?:\/|$)/,
      )?.[1] ??
      path.split("/").filter(Boolean).at(-1) ??
      "request";
    const phases = Object.fromEntries(
      ["server", "restore", "pre-forward", "forward", "post-forward"].flatMap(
        (name) => {
          const value = header(`x-agent-${name}-ms`);
          return value === undefined
            ? []
            : [
                [
                  name.replace(/-([a-z])/g, (_, letter: string) =>
                    letter.toUpperCase(),
                  ) + "Ms",
                  value,
                ],
              ];
        },
      ),
    );
    const cache = response?.headers.get("x-agent-cache");
    const record: AgentRequestTiming = {
      request: resource,
      resource,
      ...(identity
        ? { requestId: identity.requestId, operation: identity.operation }
        : {}),
      attempt,
      ...(response ? { status: response.status } : {}),
      outcome: failure ?? (response?.ok ? "ok" : "http-error"),
      startedAtMs: Math.round(started),
      totalMs: headerMs,
      headerMs,
      ...phases,
      ...(cache === "hit" ? { cache: "hit" as const } : {}),
      ...(relayMs !== undefined ? { relayMs } : {}),
      ...(editorMs !== undefined ? { editorMs } : {}),
      ...(visibility === "visible" || visibility === "hidden"
        ? { editorVisibility: visibility }
        : {}),
    };
    this.requestTimings.push(record);
    if (response) this.responseTimings.set(response, { started, record });
    if (this.requestTimings.length > 64) this.requestTimings.shift();
    return record;
  }
}

/** Ephemeral telemetry for one dispatch; shared by HTTP and session retries. */
export interface AgentHttpAttempts {
  count: number;
  last?: AgentRequestTiming;
}

/** One request's time, hop by hop; see AgentHttpClient.requestTimings. */
export interface AgentRequestTiming {
  /** The request's last path segment: circuit, files, resume, … */
  request: string;
  /** When it started, in ms since this process started. */
  startedAtMs: number;
  /** Through consumed JSON + validation; byte streams stop at headers. */
  totalMs: number;
  /** Fetch through headers; totalMs additionally includes consumed JSON/validation. */
  headerMs?: number;
  bodyMs?: number;
  resource?: string;
  requestId?: string;
  operation?: string;
  attempt?: number;
  status?: number;
  outcome?:
    | "ok"
    | "http-error"
    | "invalid-response"
    | "timeout"
    | "network-error"
    | "retry";
  retryDelayMs?: number;
  cache?: "hit";
  serverMs?: number;
  /** Restore is included in preForwardMs, not additive. */
  restoreMs?: number;
  preForwardMs?: number;
  forwardMs?: number;
  postForwardMs?: number;
  /** Legacy Worker forward + post-forward time; not pure socket time. */
  relayMs?: number;
  /** The editor's own work, from receipt to reply. */
  editorMs?: number;
  editorVisibility?: "visible" | "hidden";
}

/** One answered request in a session, as the relay records it (#1227). */
export interface AgentRelayOperation {
  requestId: string;
  resource: string;
  operation: string;
  at: string;
  durationMs: number;
  ok: boolean;
  revision?: number;
  editorVisibility?: "visible" | "hidden";
  editorMs?: number;
  serverMs?: number;
  restoreMs?: number;
  preForwardMs?: number;
  forwardMs?: number;
  postForwardMs?: number;
  cache?: "hit";
}
