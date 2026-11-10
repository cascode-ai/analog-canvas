import {
  AGENT_SSE_KEEPALIVE_INTERVAL_MS,
  AGENT_SESSION_PROTOCOL_VERSION,
  AgentAdapterVersionSchema,
  AgentCircuitResponseSchema,
  AgentFileResourceResponseSchema,
  AgentSimulationResourceResponseSchema,
  AgentProjectResourceResponseSchema,
  AgentSessionControlMessageSchema,
  AgentSessionEventSchema,
  AgentSessionMachine,
  AgentSessionMessageSchema,
  AgentSessionScopeSchema,
  AgentSessionStatusResponseSchema,
  invalidAgentRequestResponse,
  isReadOnlyCircuitRequest,
  isReadOnlyFileRequest,
  isReadOnlySimulationRequest,
  isReadOnlyProjectRequest,
  parseAgentCircuitRequest,
  parseAgentFileResourceRequest,
  parseAgentSimulationResourceRequest,
  parseAgentProjectResourceRequest,
  type AgentCircuitRequest,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentSimulationResourceRequest,
  type AgentProjectResourceRequest,
  type AgentSessionEvent,
  type AgentSessionScope,
  type AgentTransportErrorCode,
  type CompletedAgentRequest,
  type PersistedAgentSessionState,
  type RequestBeginResult,
} from "@icm/agent-adapter";
import { BROWSER_LAUNCH_PENDING_PROJECT } from "@icm/agent-adapter/browser-launch";

import {
  EDITOR_PROTOCOL,
  EDITOR_SOCKET_TAG,
  EXPIRY_WARNING_MS,
  FORWARD_TIMEOUT_MS,
  SIMULATION_FORWARD_TIMEOUT_MS,
  SESSION_STATE_KEY,
  bearerToken,
  editorSecret,
  errorBody,
  errorMessage,
  fileOperationScopes,
  jsonResponse,
  operationScopes,
  redeemClaimResponse,
  relayHeaders,
  requestLedgerKey,
  simulationOperationScopes,
  projectOperationAccess,
  transportStatus,
  TRUSTED_REVIEW_SCOPES,
  type AgentSessionEnv,
  type DurableStateLike,
  type PendingForward,
  type WebSocketPairConstructor,
} from "./agent-session-runtime";
import { AgentArtifacts } from "./agent-artifacts";
import { DEVICE_TRUST_INTERNAL } from "./agent-device-directory";
import {
  AgentDeviceTrustDirectory,
  DeviceTrustClient,
  type DeviceTrustLink,
} from "./agent-device-trust";
import { sha256Text } from "./sha256-text";

// requestId is session-wide; identical payloads in different Project bindings
// must never replay an earlier Project's cached result.
function scopedRequestHash(
  raw: string,
  contextRevision: string | null | undefined,
  workspaceId?: string | null,
): Promise<string> {
  return sha256Text(
    JSON.stringify([
      workspaceId ?? null,
      workspaceId ? null : contextRevision,
      raw,
    ]),
  );
}

/** Downloads an ended session still has to delete from R2. */
const ARTIFACT_CLEANUP_KEY = "agent-artifact-cleanup";
const ARTIFACT_CLEANUP_RETRY_MS = 60_000;
/** The release the paired adapter named, for the editor to show (#1844). */
const ADAPTER_VERSION_KEY = "agent-adapter-version";
/** Reason-only tombstones: no bearer, connector, editor proof or Project data. */
const DEVICE_REVOKED_KEY = "agent-device-revoked-until";
/** Whether the device that opened an ended trusted task is still trusted. */
const DEVICE_REVOKED_TRUST_KEY = "agent-device-revoked-trust";
const PROJECT_REPLACED_KEY = "project-replaced-until";
const TOMBSTONE_MS = 30 * 60_000;
type EndedTrust = "kept" | "removed";
/** What an ended trusted task answers, so the Agent knows what the next task does. */
const TRUSTED_TASK_ENDED: Record<EndedTrust, string> = {
  kept: "The user ended this Canvas task in the browser. The device that opened it is still trusted, so a new task would open without asking the user: start one only when the user asks.",
  removed:
    "This Canvas task ended because the device that opened it is no longer trusted for the signed-in account. A new task opens only after the user approves it in the browser.",
};
type StoredSession = PersistedAgentSessionState & {
  deviceTrust?: DeviceTrustLink;
};

/** One event in the envelope the editor socket carries. */
function editorEventMessage(event: AgentSessionEvent): string {
  return JSON.stringify({
    protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
    sessionId: event.sessionId,
    messageId: crypto.randomUUID(),
    requestId: `event-${crypto.randomUUID()}`,
    sentAt: new Date().toISOString(),
    kind: "event",
    payload: event,
  });
}

interface RequestTrace {
  started: number;
  restoreMs?: number;
  forwardStarted?: number;
  forwardEnded?: number;
  identity?: { requestId: string; operation: string };
  cache?: "hit";
  result?: { ok?: unknown; revision?: unknown } | undefined;
}

/** Cloudflare Durable Object owning one temporary Agent session. */
export class AgentSessionDO {
  private readonly artifacts: AgentArtifacts;
  private readonly deviceDirectory: AgentDeviceTrustDirectory;
  private readonly devices: DeviceTrustClient;
  private deviceTrust: DeviceTrustLink | undefined;
  private deviceRevokedUntil = 0;
  private deviceRevokedTrust: EndedTrust | undefined;
  private approvingLaunch = false;
  private replacedUntil = 0;
  private editorLeft = false;
  private machine: AgentSessionMachine | null = null;
  private readonly ready: Promise<void>;
  private creating = false;
  private publishedExpiresAt: number | null = null;
  private readonly pendingForwards = new Map<string, PendingForward>();
  private readonly eventSubscribers = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    ReturnType<typeof setInterval>
  >();

  constructor(
    private readonly state: DurableStateLike,
    private readonly env: AgentSessionEnv,
  ) {
    this.artifacts = new AgentArtifacts(
      state.storage,
      env.SIMULATION_ARTIFACTS,
    );
    this.deviceDirectory = new AgentDeviceTrustDirectory(state.storage);
    this.devices = new DeviceTrustClient(env.AGENT_SESSION);
    this.ready = this.initialize();
    this.state.blockConcurrencyWhile?.(() => this.ready);
  }

  async fetch(request: Request): Promise<Response> {
    const resource = new URL(request.url).pathname.slice(1);
    if (
      request.method !== "POST" ||
      !["circuit", "files", "simulation", "projects"].includes(resource)
    )
      return this.handleFetch(request);
    const trace: RequestTrace = { started: performance.now() };
    const response = await this.handleFetch(request, trace);
    const ended = performance.now();
    const phases = {
      serverMs: ended - trace.started,
      restoreMs: trace.restoreMs ?? 0,
      preForwardMs: (trace.forwardStarted ?? ended) - trace.started,
      forwardMs:
        trace.forwardStarted === undefined
          ? 0
          : (trace.forwardEnded ?? ended) - trace.forwardStarted,
      postForwardMs:
        trace.forwardEnded === undefined ? 0 : ended - trace.forwardEnded,
    };
    for (const [key, value] of Object.entries(phases))
      response.headers.set(
        `x-agent-${key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())}`,
        String(Math.max(0, Math.round(value))),
      );
    if (trace.cache) response.headers.set("x-agent-cache", trace.cache);
    if (trace.identity) {
      const editor =
        trace.forwardStarted === undefined
          ? undefined
          : this.editorTimings.get(trace.identity.requestId);
      if (trace.forwardStarted !== undefined)
        this.editorTimings.delete(trace.identity.requestId);
      if (editor) {
        response.headers.set("x-agent-editor-ms", String(editor.workMs));
        response.headers.set("x-agent-editor-visibility", editor.visibility);
      }
      if (
        trace.forwardStarted !== undefined &&
        !response.headers.has("x-agent-relay-ms")
      )
        response.headers.set(
          "x-agent-relay-ms",
          String(Math.round(ended - trace.forwardStarted)),
        );
      this.recentOperations.push({
        ...trace.identity,
        resource,
        at: new Date().toISOString(),
        durationMs:
          trace.forwardStarted === undefined
            ? 0
            : Math.round(ended - trace.forwardStarted),
        ok: response.ok && trace.result?.ok !== false,
        ...phases,
        ...(trace.cache ? { cache: trace.cache } : {}),
        ...(typeof trace.result?.revision === "number"
          ? { revision: trace.result.revision }
          : {}),
        ...(editor
          ? { editorMs: editor.workMs, editorVisibility: editor.visibility }
          : {}),
      });
      if (this.recentOperations.length > 32) this.recentOperations.shift();
    }
    return response;
  }

  private async handleFetch(
    request: Request,
    trace?: RequestTrace,
  ): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const allowedOrigin = this.env.AGENT_ALLOWED_ORIGIN ?? null;
    if (url.pathname.startsWith(DEVICE_TRUST_INTERNAL))
      return this.deviceDirectory.handle(request);
    if (request.method === "POST" && url.pathname === "/create") {
      return this.create(request, allowedOrigin);
    }
    if (this.replacedUntil > Date.now()) {
      return jsonResponse(
        errorBody("PROJECT_REPLACED", errorMessage("PROJECT_REPLACED")),
        transportStatus("PROJECT_REPLACED"),
        allowedOrigin,
      );
    }
    if (this.deviceRevokedUntil > Date.now())
      return this.deviceRevokedResponse(allowedOrigin);
    const machine = await this.loadMachine();
    if (trace) trace.restoreMs = performance.now() - trace.started;
    if (!machine) {
      return jsonResponse(
        errorBody("SESSION_NOT_FOUND", errorMessage("SESSION_NOT_FOUND")),
        404,
        allowedOrigin,
      );
    }
    if (request.method === "POST" && url.pathname === "/approve-editor-launch")
      return this.approveEditorLaunch(request, machine, allowedOrigin);
    if (
      request.method === "POST" &&
      url.pathname === "/revoke-trusted-device"
    ) {
      const revoked = (await request.json()) as DeviceTrustLink;
      const current = this.deviceTrust;
      if (
        current &&
        current.directory === revoked.directory &&
        current.deviceId === revoked.deviceId &&
        current.trustId === revoked.trustId
      )
        await this.revokeTrustedSession(machine, "removed");
      return new Response(null, { status: 204 });
    }
    const trustedTask = this.approvingLaunch
      ? undefined
      : this.trustedTask(machine);
    if (trustedTask) {
      const trusted = await trustedTask.isCurrent().catch(() => null);
      if (trusted === null)
        return jsonResponse(
          errorBody(
            "EDITOR_OFFLINE",
            "Device authorization could not be verified",
          ),
          503,
          allowedOrigin,
        );
      if (!trusted) {
        await this.revokeTrustedSession(machine, "removed");
        return this.deviceRevokedResponse(allowedOrigin);
      }
    }
    if (
      url.pathname.startsWith("/artifacts/") ||
      url.pathname === "/artifact-status"
    ) {
      const now = Date.now();
      if (request.method === "PUT") {
        if (!machine.authorizeEditor(editorSecret(request)))
          return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
        if (machine.statusAt(now) !== "active")
          return jsonResponse(
            { error: "Session is not active" },
            403,
            allowedOrigin,
          );
      } else {
        const auth = machine.authorize(bearerToken(request), now);
        if (!auth.ok)
          return jsonResponse(
            errorBody(auth.code, errorMessage(auth.code)),
            transportStatus(auth.code),
            allowedOrigin,
          );
        if (!machine.assertScope(auth.session.scopes, "simulation.run").ok)
          return this.refuseScope(allowedOrigin);
      }
      if (url.pathname === "/artifact-status") {
        if (request.method !== "GET")
          return jsonResponse(
            { error: "Method not allowed" },
            405,
            allowedOrigin,
          );
        return jsonResponse(
          { ok: true, usage: await this.artifacts.usage() },
          200,
          allowedOrigin,
        );
      }
      const response = await this.artifacts.handle(
        request,
        machine.sessionId,
        url.pathname.slice("/artifacts/".length),
      );
      if (response.ok) {
        machine.recordActivity(now);
        await this.persist();
      }
      const maintenanceAt = await this.artifacts.nextMaintenanceAt();
      if (maintenanceAt)
        await this.state.storage.setAlarm?.(
          Math.min(
            maintenanceAt,
            Date.now() < machine.expiresAt - EXPIRY_WARNING_MS
              ? machine.expiresAt - EXPIRY_WARNING_MS
              : machine.expiresAt,
          ),
        );
      return response;
    }
    if (request.method === "POST" && url.pathname === "/claim") {
      return this.claim(request, machine, allowedOrigin);
    }
    if (request.method === "POST" && url.pathname === "/resume-connector") {
      return this.resumeConnector(request, machine, allowedOrigin);
    }
    if (url.pathname === "/editor") {
      return await this.connectEditor(request, machine);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const now = Date.now();
      // Same status resource, two existing authorities. Neither probe renews
      // the lease; the browser must not revoke from a stale local deadline.
      const editorAuthorized = machine.authorizeEditor(editorSecret(request));
      const status = machine.statusAt(now);
      const auth = editorAuthorized
        ? status === "expired" || status === "revoked"
          ? {
              ok: false as const,
              code:
                status === "expired"
                  ? ("SESSION_EXPIRED" as const)
                  : ("SESSION_REVOKED" as const),
            }
          : { ok: true as const }
        : machine.authorizeStatus(bearerToken(request), now);
      if (!auth.ok)
        return jsonResponse(
          errorBody(auth.code, errorMessage(auth.code)),
          transportStatus(auth.code),
          allowedOrigin,
        );
      return jsonResponse(
        AgentSessionStatusResponseSchema.parse({
          ok: true,
          sessionId: machine.sessionId,
          projectId: machine.projectId,
          ...(machine.contextRevision
            ? { contextRevision: machine.contextRevision }
            : {}),
          documentIds: machine.documentIds,
          ...(this.deviceTrust ? { scopes: machine.scopes } : {}),
          authorization: machine.statusAt(now),
          editor: (this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []).some(
            (socket) => socket.readyState === WebSocket.OPEN,
          )
            ? "attached"
            : "detached",
          observedAt: now,
          expiresAt: machine.expiresAt,
        }),
        200,
        allowedOrigin,
      );
    }
    if (
      request.method === "POST" &&
      ["/circuit", "/files", "/simulation", "/projects"].includes(
        url.pathname,
      ) &&
      machine.contextRevision
    ) {
      const auth = machine.authorize(bearerToken(request), Date.now());
      if (!auth.ok)
        return jsonResponse(
          errorBody(auth.code, errorMessage(auth.code)),
          transportStatus(auth.code),
          allowedOrigin,
        );
      const input = (await request
        .clone()
        .json()
        .catch(() => null)) as { operation?: string } | null;
      const discovery =
        url.pathname === "/circuit" &&
        ["snapshot", "capabilities"].includes(input?.operation ?? "");
      const workspaceId = request.headers.get("x-agent-workspace");
      if (workspaceId && (workspaceId.length > 256 || !workspaceId.trim()))
        return jsonResponse(
          errorBody("PROJECT_CONTEXT_STALE", "Invalid workspace target"),
          409,
          allowedOrigin,
        );
      if (machine.documentIds.length === 0 && !workspaceId)
        return jsonResponse(
          errorBody("NO_ACTIVE_PROJECT", errorMessage("NO_ACTIVE_PROJECT")),
          409,
          allowedOrigin,
        );
      if (
        !discovery &&
        !workspaceId &&
        request.headers.get("x-agent-context") !== machine.contextRevision
      )
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PROJECT_CONTEXT_STALE",
              message:
                "The browser context changed. Read current context before submitting a new request.",
            },
          },
          409,
          allowedOrigin,
        );
    }
    if (request.method === "POST" && url.pathname === "/circuit") {
      const context = machine.contextRevision;
      const response = await this.circuit(
        request,
        machine,
        allowedOrigin,
        trace,
      );
      if (context) response.headers.set("x-agent-context", context);
      return response;
    }
    if (request.method === "POST" && url.pathname === "/files") {
      return this.files(request, machine, allowedOrigin, trace);
    }
    if (request.method === "POST" && url.pathname === "/simulation") {
      return this.simulation(request, machine, allowedOrigin, trace);
    }
    if (request.method === "POST" && url.pathname === "/projects") {
      return this.projects(request, machine, allowedOrigin, trace);
    }
    if (request.method === "GET" && url.pathname === "/activity") {
      const auth = machine.authorizeStatus(bearerToken(request), Date.now());
      if (!auth.ok)
        return jsonResponse(
          errorBody(auth.code, errorMessage(auth.code)),
          transportStatus(auth.code),
          allowedOrigin,
        );
      return jsonResponse(
        {
          ok: true,
          sessionId: machine.sessionId,
          scope: "live-relay-instance",
          operations: [...this.recentOperations],
        },
        200,
        allowedOrigin,
      );
    }
    if (request.method === "GET" && url.pathname === "/events") {
      return this.events(request, machine, allowedOrigin);
    }
    if (request.method === "POST" && url.pathname === "/control") {
      return this.control(request, machine, allowedOrigin);
    }
    if (request.method === "DELETE" && url.pathname === "/session") {
      return this.disconnect(request, machine, allowedOrigin);
    }
    if (request.method === "DELETE" && url.pathname === "/detached-editor") {
      return this.disconnect(request, machine, allowedOrigin, true);
    }
    return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.ready;
    const machine = await this.loadMachine();
    if (!machine) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    const status = machine.statusAt(Date.now());
    if (status === "expired" || status === "revoked") return;
    const trustedTask = this.trustedTask(machine);
    if (trustedTask) {
      if (this.approvingLaunch) return;
      const trusted = await trustedTask.isCurrent().catch(() => null);
      if (trusted === null) return;
      if (!trusted) {
        await this.revokeTrustedSession(machine, "removed");
        return;
      }
      if (this.deviceRevokedUntil) return;
    }
    const text =
      typeof message === "string" ? message : new TextDecoder().decode(message);
    const size = machine.checkMessageSize(
      new TextEncoder().encode(text).byteLength,
    );
    if (size && !size.ok) {
      for (const [requestId, pending] of this.pendingForwards) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(size.code));
        machine.failRequest(requestId, false);
      }
      this.pendingForwards.clear();
      await this.persist();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const control = AgentSessionControlMessageSchema.safeParse(raw);
    if (
      control.success &&
      control.data.sessionId === machine.sessionId &&
      control.data.kind === "heartbeat"
    ) {
      if (
        control.data.contextRevision &&
        control.data.projectId &&
        control.data.documentIds
      ) {
        const contextChanged =
          machine.contextRevision !== control.data.contextRevision ||
          machine.projectId !== control.data.projectId;
        const rosterChanged =
          machine.documentIds.length !== control.data.documentIds.length ||
          control.data.documentIds.some(
            (id) => !machine.documentIds.includes(id),
          );
        if (contextChanged || rosterChanged) {
          machine.bindContext(
            control.data.contextRevision,
            control.data.projectId,
            control.data.documentIds,
          );
          // Passive reconnect/refresh must not renew the idle lease. A structural
          // change within an already-bound Project remains real user activity.
          if (!contextChanged && rosterChanged)
            machine.recordActivity(Date.now());
          await this.persist();
        }
      }
      if (
        control.data.projectId &&
        control.data.documentIds &&
        machine.updateEditorDocuments(
          control.data.projectId,
          control.data.documentIds,
        )
      ) {
        machine.recordActivity(Date.now());
        await this.persist();
      }
      socket.send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: machine.sessionId,
          kind: "heartbeat-ack",
          nonce: control.data.nonce,
          ...(machine.contextRevision
            ? { contextRevision: machine.contextRevision }
            : {}),
        }),
      );
      return;
    }
    const parsed = AgentSessionMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const envelope = parsed.data;
    if (envelope.sessionId !== machine.sessionId) return;
    if (
      envelope.kind === "circuit-response" ||
      envelope.kind === "file-response" ||
      envelope.kind === "simulation-response" ||
      envelope.kind === "project-response"
    ) {
      const pending = this.pendingForwards.get(envelope.requestId);
      if (!pending || pending.socket !== socket) return;
      if (envelope.timing)
        this.editorTimings.set(envelope.requestId, envelope.timing);
      const response =
        envelope.kind === "circuit-response"
          ? AgentCircuitResponseSchema.safeParse(envelope.payload)
          : envelope.kind === "file-response"
            ? AgentFileResourceResponseSchema.safeParse(envelope.payload)
            : envelope.kind === "simulation-response"
              ? AgentSimulationResourceResponseSchema.safeParse(
                  envelope.payload,
                )
              : AgentProjectResourceResponseSchema.safeParse(envelope.payload);
      if (!response.success) {
        clearTimeout(pending.timeout);
        this.pendingForwards.delete(envelope.requestId);
        pending.reject(new Error("INVALID_BROWSER_RESPONSE"));
        machine.failRequest(envelope.requestId, false);
        await this.persist();
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingForwards.delete(envelope.requestId);
      pending.resolve(response.data);
    } else if (envelope.kind === "event") {
      const event = AgentSessionEventSchema.safeParse(envelope.payload);
      if (event.success && event.data.sessionId === machine.sessionId) {
        if (
          event.data.type === "document.revision-changed" &&
          event.data.actorKind === "human" &&
          machine.assertDocument(machine.projectId, event.data.documentId).ok
        ) {
          machine.recordActivity(Date.now());
          await this.persist();
        }
        this.emit(event.data);
      }
    }
  }

  async webSocketClose(socket?: WebSocket, code?: number, reason?: string) {
    // Hibernatable sockets require an explicit close reply. Without it the
    // browser stays CLOSING and never reaches its reconnect handler.
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
    await this.ready;
    for (const [requestId, pending] of this.pendingForwards) {
      if (socket && pending.socket !== socket) continue;
      clearTimeout(pending.timeout);
      pending.reject(new Error("EDITOR_DISCONNECTED"));
      this.machine?.failRequest(requestId, false);
      this.pendingForwards.delete(requestId);
    }
    const replacement = (
      this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []
    ).some(
      (candidate) =>
        candidate !== socket && candidate.readyState === WebSocket.OPEN,
    );
    if (replacement) return;
    if (code === 1000 && reason === "tab left") {
      this.editorLeft = true;
      await this.state.storage.put("agent-editor-left", true);
    }
    this.emit({
      type: "editor.offline",
      sessionId: this.machine?.sessionId ?? "unknown",
    });
    const status = this.machine?.statusAt(Date.now());
    if (this.replacedUntil > Date.now()) return;
    if (status === "revoked" || status === "expired") {
      await this.clearStoredSession();
    } else {
      await this.persist();
    }
  }

  async alarm(): Promise<void> {
    await this.ready;
    await this.artifacts.maintenance();
    const left = await this.state.storage.get<string[]>(ARTIFACT_CLEANUP_KEY);
    if (left?.length) {
      const still = await this.artifacts.deleteObjects(left);
      await this.state.storage.put(ARTIFACT_CLEANUP_KEY, still);
      if (still.length)
        await this.state.storage.setAlarm?.(
          Date.now() + ARTIFACT_CLEANUP_RETRY_MS,
        );
    }
    const tombstone = this.replacedUntil || this.deviceRevokedUntil;
    if (tombstone) {
      if (Date.now() < tombstone) {
        await this.state.storage.setAlarm?.(tombstone);
      } else {
        this.replacedUntil = 0;
        this.deviceRevokedUntil = 0;
        this.deviceRevokedTrust = undefined;
        this.machine = null;
        await this.clearStoredSession();
      }
      return;
    }
    const machine = await this.loadMachine();
    if (machine && Date.now() < machine.expiresAt - EXPIRY_WARNING_MS) {
      await this.state.storage.setAlarm?.(
        Math.min(
          machine.expiresAt - EXPIRY_WARNING_MS,
          (await this.artifacts.nextMaintenanceAt()) ?? Infinity,
        ),
      );
      return;
    }
    if (machine && Date.now() < machine.expiresAt) {
      const event: AgentSessionEvent = {
        type: "session.expiring",
        sessionId: machine.sessionId,
        expiresAt: new Date(machine.expiresAt).toISOString(),
      };
      this.emit(event);
      this.notifyEditor(event);
      await this.state.storage.setAlarm?.(
        Math.min(
          machine.expiresAt,
          (await this.artifacts.nextMaintenanceAt()) ?? Infinity,
        ),
      );
      return;
    }
    if (machine) {
      machine.revoke();
      this.emit({ type: "session.expired", sessionId: machine.sessionId });
      this.notifyEditor({
        type: "session.expired",
        sessionId: machine.sessionId,
      });
    }
    for (const pending of this.pendingForwards.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("SESSION_EXPIRED"));
    }
    this.pendingForwards.clear();
    for (const subscriber of [...this.eventSubscribers.keys()]) {
      this.removeEventSubscriber(subscriber, true);
    }
    await this.clearStoredSession();
    this.machine = null;
  }

  private async create(
    request: Request,
    allowedOrigin: string | null,
  ): Promise<Response> {
    if (this.creating || this.machine) {
      return jsonResponse(
        { error: "Session already exists" },
        409,
        allowedOrigin,
      );
    }
    this.creating = true;
    try {
      const body = (await request.json().catch(() => null)) as {
        sessionId?: unknown;
        projectSessionId?: unknown;
        projectId?: unknown;
        documentIds?: unknown;
        scopes?: unknown;
        browserLaunch?: unknown;
      } | null;
      if (
        !body ||
        typeof body.sessionId !== "string" ||
        typeof body.projectSessionId !== "string" ||
        typeof body.projectId !== "string" ||
        !Array.isArray(body.documentIds) ||
        !body.documentIds.every((value) => typeof value === "string") ||
        !Array.isArray(body.scopes)
      ) {
        return jsonResponse(
          { error: "Invalid session request" },
          400,
          allowedOrigin,
        );
      }
      const scopes = body.scopes.filter(
        (value): value is AgentSessionScope =>
          AgentSessionScopeSchema.safeParse(value).success,
      );
      const browserLaunch =
        body.browserLaunch === true &&
        body.projectId === BROWSER_LAUNCH_PENDING_PROJECT;
      if (
        scopes.length !== body.scopes.length ||
        (browserLaunch
          ? body.documentIds.length !== 0
          : body.documentIds.length === 0)
      ) {
        return jsonResponse(
          { error: "Invalid session scopes or Documents" },
          400,
          allowedOrigin,
        );
      }
      const created = AgentSessionMachine.create({
        sessionId: body.sessionId,
        browserLaunch,
        projectSessionId: body.projectSessionId,
        projectId: body.projectId,
        documentIds: body.documentIds,
        scopes,
        now: Date.now(),
        random: () => crypto.randomUUID(),
      });
      this.machine = created.machine;
      await this.persist();
      return jsonResponse(
        { ok: true, session: created.session },
        200,
        allowedOrigin,
      );
    } finally {
      this.creating = false;
    }
  }

  private async claim(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
  ): Promise<Response> {
    const body = (await request.json().catch(() => null)) as {
      code?: unknown;
      adapterVersion?: unknown;
      redemptionKey?: unknown;
    } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const result = redeemClaimResponse(
      machine,
      code,
      Date.now(),
      typeof body?.redemptionKey === "string" ? body.redemptionKey : undefined,
    );
    await this.persist();
    if (!result.ok) {
      return jsonResponse(
        result,
        transportStatus(result.error.code),
        allowedOrigin,
      );
    }
    this.emit({ type: "session.ready", sessionId: machine.sessionId });
    this.notifyEditor({ type: "session.ready", sessionId: machine.sessionId });
    await this.pairedAdapter(machine, body);
    return jsonResponse(
      {
        ...result,
        sessionId: machine.sessionId,
        ...(machine.contextRevision
          ? { contextRevision: machine.contextRevision }
          : {}),
      },
      200,
      allowedOrigin,
    );
  }

  private async resumeConnector(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
  ): Promise<Response> {
    const body = (await request.json().catch(() => null)) as {
      connectorToken?: unknown;
      adapterVersion?: unknown;
    } | null;
    const token =
      typeof body?.connectorToken === "string" ? body.connectorToken : "";
    const result = machine.resumeConnector(token, Date.now());
    await this.persist();
    if (!result.ok) {
      return jsonResponse(
        errorBody(result.code, errorMessage(result.code)),
        transportStatus(result.code),
        allowedOrigin,
      );
    }
    const type =
      machine.statusAt(Date.now()) === "paused"
        ? "session.paused"
        : "session.ready";
    this.emit({ type, sessionId: machine.sessionId });
    this.notifyEditor({ type, sessionId: machine.sessionId });
    await this.pairedAdapter(machine, body);
    return jsonResponse(
      {
        ok: true,
        sessionId: machine.sessionId,
        agentToken: result.claim.agentToken,
        tokenExpiresAt: result.claim.tokenExpiresAt,
        connectorToken: result.claim.connectorToken,
        connectorExpiresAt: result.claim.connectorExpiresAt,
        scopes: [...result.claim.scopes],
        projectId: machine.projectId,
        ...(machine.contextRevision
          ? { contextRevision: machine.contextRevision }
          : {}),
        documentIds: machine.documentIds,
      },
      200,
      allowedOrigin,
    );
  }

  /**
   * Keep the release the adapter named on this claim or resume, or none,
   * and tell the editor (#1844).
   */
  private async pairedAdapter(
    machine: AgentSessionMachine,
    body: { adapterVersion?: unknown } | null,
  ): Promise<void> {
    const named = AgentAdapterVersionSchema.safeParse(body?.adapterVersion);
    const version = named.success ? named.data : null;
    await this.state.storage.put(ADAPTER_VERSION_KEY, version);
    this.notifyEditor({
      type: "agent.adapter",
      sessionId: machine.sessionId,
      ...(version ? { version } : {}),
    });
  }

  private async connectEditor(
    request: Request,
    machine: AgentSessionMachine,
  ): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "WebSocket upgrade required" }, 426);
    }
    if (!machine.authorizeEditor(editorSecret(request))) {
      return jsonResponse(
        errorBody("TOKEN_INVALID", "Invalid editor secret"),
        401,
      );
    }
    const version = await this.state.storage.get<string | null>(
      ADAPTER_VERSION_KEY,
    );
    const status = machine.statusAt(Date.now());
    if (status === "revoked" || status === "expired") {
      const code = status === "revoked" ? "SESSION_REVOKED" : "SESSION_EXPIRED";
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
      );
    }
    const Pair = (
      globalThis as typeof globalThis & {
        WebSocketPair?: WebSocketPairConstructor;
      }
    ).WebSocketPair;
    if (!Pair || !this.state.acceptWebSocket) {
      return jsonResponse({ error: "WebSocket runtime unavailable" }, 501);
    }
    const pair = new Pair();
    const previousSockets = this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? [];
    this.state.acceptWebSocket(pair[1], [EDITOR_SOCKET_TAG]);
    if (this.editorLeft) {
      this.editorLeft = false;
      await this.state.storage.put("agent-editor-left", false);
    }
    this.emit({ type: "editor.online", sessionId: machine.sessionId });
    for (const socket of previousSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(4001, "editor transport replaced");
      }
    }
    this.notifyEditor({
      type: "session.renewed",
      sessionId: machine.sessionId,
      expiresAt: new Date(machine.expiresAt).toISOString(),
    });
    if (status === "paused") {
      pair[1].send(
        editorEventMessage({
          type: "session.paused",
          sessionId: machine.sessionId,
        }),
      );
    } else if (machine.claimed) {
      pair[1].send(
        editorEventMessage({
          type: "session.ready",
          sessionId: machine.sessionId,
          expiresAt: new Date(machine.expiresAt).toISOString(),
        }),
      );
    }
    // A reloaded tab learns which adapter release is paired.
    if (machine.claimed && version)
      pair[1].send(
        editorEventMessage({
          type: "agent.adapter",
          sessionId: machine.sessionId,
          version,
        }),
      );
    return new Response(null, {
      status: 101,
      headers: { "sec-websocket-protocol": EDITOR_PROTOCOL },
      webSocket: pair[0],
    } as ResponseInit & { webSocket: WebSocket });
  }

  private async circuit(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
    trace?: RequestTrace,
  ): Promise<Response> {
    const observedContext = machine.contextRevision;
    const raw = await request.text();
    const size = machine.checkSize(new TextEncoder().encode(raw).byteLength);
    if (!size.ok) {
      return jsonResponse(
        errorBody(size.code, errorMessage(size.code)),
        transportStatus(size.code),
        allowedOrigin,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return jsonResponse(
        invalidAgentRequestResponse(undefined),
        400,
        allowedOrigin,
      );
    }
    const parsed = parseAgentCircuitRequest(input);
    if (!parsed.success)
      return jsonResponse(parsed.response, 400, allowedOrigin);
    const circuitRequest = parsed.data;
    const auth = machine.authorize(bearerToken(request), Date.now());
    if (!auth.ok) {
      return jsonResponse(
        errorBody(auth.code, errorMessage(auth.code)),
        transportStatus(auth.code),
        allowedOrigin,
      );
    }
    if (
      !machine.assertScopes(
        auth.session.scopes,
        operationScopes(circuitRequest),
      ).ok
    )
      return this.refuseScope(allowedOrigin);
    if (
      !request.headers.has("x-agent-workspace") &&
      "documentId" in circuitRequest
    ) {
      const requestDocumentId = circuitRequest.documentId;
      if (requestDocumentId !== undefined) {
        const document = machine.assertDocument(
          machine.projectId,
          requestDocumentId,
        );
        if (!document.ok) {
          return jsonResponse(
            errorBody(
              document.code,
              "Document is outside the authorized session",
            ),
            403,
            allowedOrigin,
          );
        }
      }
    }
    const payloadHash = await scopedRequestHash(
      raw,
      observedContext,
      request.headers.get("x-agent-workspace"),
    );
    const readOnly = isReadOnlyCircuitRequest(circuitRequest);
    if (trace)
      trace.identity = {
        requestId: circuitRequest.requestId,
        operation: circuitRequest.operation,
      };
    const begin = await this.beginRequest(
      machine,
      circuitRequest.requestId,
      payloadHash,
      readOnly ? "read" : "write",
    );
    if (begin.kind === "cached") {
      if (trace) {
        trace.cache = "hit";
        trace.result = begin.result as RequestTrace["result"];
      }
      return jsonResponse(begin.result, 200, allowedOrigin);
    }
    if (begin.kind === "rejected") {
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    }
    if (circuitRequest.operation !== "capabilities")
      machine.recordActivity(Date.now());
    if (!readOnly) await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: circuitRequest.requestId,
    });
    try {
      const discovery =
        circuitRequest.operation === "snapshot" ||
        circuitRequest.operation === "capabilities";
      const forwardStarted = performance.now();
      const result = await this.forwardToEditor(
        machine,
        circuitRequest,
        "circuit-request",
        discovery
          ? observedContext
          : (request.headers.get("x-agent-context") ?? undefined),
        request.headers.get("x-agent-workspace") ?? undefined,
        trace,
      );
      if (trace) trace.result = result as RequestTrace["result"];
      machine.completeRequest(circuitRequest.requestId, result, Date.now());
      if (circuitRequest.operation !== "capabilities")
        machine.recordActivity(Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: circuitRequest.requestId,
      });
      return jsonResponse(
        result,
        200,
        allowedOrigin,
        this.relayTiming(circuitRequest, "circuit", result, forwardStarted),
      );
    } catch (error) {
      if (this.deviceRevokedUntil)
        return this.deviceRevokedResponse(allowedOrigin);
      const errorCode = error instanceof Error ? error.message : "";
      const code: AgentTransportErrorCode =
        errorCode === "REQUEST_TIMEOUT" || errorCode === "MESSAGE_TOO_LARGE"
          ? errorCode
          : errorCode === "EDITOR_OFFLINE"
            ? "EDITOR_OFFLINE"
            : "EDITOR_DISCONNECTED";
      machine.failRequest(circuitRequest.requestId, code === "EDITOR_OFFLINE");
      await this.persist();
      this.emit({
        type: "operation.failed",
        sessionId: machine.sessionId,
        requestId: circuitRequest.requestId,
      });
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
        allowedOrigin,
      );
    }
  }

  private async files(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
    trace?: RequestTrace,
  ): Promise<Response> {
    const raw = await request.text();
    const size = machine.checkSize(new TextEncoder().encode(raw).byteLength);
    if (!size.ok) {
      return jsonResponse(
        errorBody(size.code, errorMessage(size.code)),
        transportStatus(size.code),
        allowedOrigin,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return jsonResponse(
        errorBody(
          "FILE_CONTENT_INVALID",
          "File Resource request must be valid JSON",
        ),
        400,
        allowedOrigin,
      );
    }
    const parsed = parseAgentFileResourceRequest(input);
    if (!parsed.success) {
      return jsonResponse(
        errorBody(
          "FILE_CONTENT_INVALID",
          "File Resource request does not match its strict schema",
        ),
        400,
        allowedOrigin,
      );
    }
    const fileRequest = parsed.data;
    const auth = machine.authorize(bearerToken(request), Date.now());
    if (!auth.ok)
      return jsonResponse(
        errorBody(auth.code, errorMessage(auth.code)),
        transportStatus(auth.code),
        allowedOrigin,
      );
    if (
      !machine.assertScopes(
        auth.session.scopes,
        fileOperationScopes(fileRequest),
      ).ok
    )
      return this.refuseScope(allowedOrigin);
    if (
      !request.headers.has("x-agent-workspace") &&
      fileRequest.operation === "download" &&
      fileRequest.documentId !== undefined
    ) {
      const document = machine.assertDocument(
        machine.projectId,
        fileRequest.documentId,
      );
      if (!document.ok)
        return jsonResponse(
          errorBody(
            document.code,
            "Document is outside the authorized session",
          ),
          403,
          allowedOrigin,
        );
    }
    const readOnly = isReadOnlyFileRequest(fileRequest);
    if (trace)
      trace.identity = {
        requestId: fileRequest.requestId,
        operation: fileRequest.operation,
      };
    const begin = await this.beginRequest(
      machine,
      fileRequest.requestId,
      await scopedRequestHash(
        raw,
        request.headers.get("x-agent-context") ?? machine.contextRevision,
        request.headers.get("x-agent-workspace"),
      ),
      readOnly ? "read" : "write",
    );
    if (begin.kind === "cached") {
      if (trace) {
        trace.cache = "hit";
        trace.result = begin.result as RequestTrace["result"];
      }
      return jsonResponse(begin.result, 200, allowedOrigin);
    }
    if (begin.kind === "rejected")
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    machine.recordActivity(Date.now());
    if (!readOnly) await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: fileRequest.requestId,
    });
    try {
      const forwardStarted = performance.now();
      const result =
        fileRequest.operation === "simulation-input" &&
        fileRequest.input.action === "release-download"
          ? await this.releaseArtifactLease(machine, fileRequest)
          : await this.forwardToEditor(
              machine,
              fileRequest,
              "file-request",
              request.headers.get("x-agent-context") ?? undefined,
              request.headers.get("x-agent-workspace") ?? undefined,
              trace,
            );
      if (trace) trace.result = result as RequestTrace["result"];
      // Export blobs are explicitly one-shot: the DO retains only an unavailable
      // idempotency marker, never their bytes. Candidate summaries are safe to cache.
      if (
        fileRequest.operation === "download" ||
        (fileRequest.operation === "review" &&
          fileRequest.input.action === "prepare-save")
      ) {
        machine.completeRequestWithoutResult(fileRequest.requestId, Date.now());
      } else {
        machine.completeRequest(fileRequest.requestId, result, Date.now());
      }
      machine.recordActivity(Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: fileRequest.requestId,
      });
      return jsonResponse(
        result,
        200,
        allowedOrigin,
        this.relayTiming(fileRequest, "files", result, forwardStarted),
      );
    } catch (error) {
      if (this.deviceRevokedUntil)
        return this.deviceRevokedResponse(allowedOrigin);
      const value = error instanceof Error ? error.message : "";
      const code: AgentTransportErrorCode =
        value === "REQUEST_TIMEOUT" || value === "MESSAGE_TOO_LARGE"
          ? value
          : value === "EDITOR_OFFLINE"
            ? "EDITOR_OFFLINE"
            : "EDITOR_DISCONNECTED";
      machine.failRequest(fileRequest.requestId, code === "EDITOR_OFFLINE");
      await this.persist();
      this.emit({
        type: "operation.failed",
        sessionId: machine.sessionId,
        requestId: fileRequest.requestId,
      });
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
        allowedOrigin,
      );
    }
  }

  private async releaseArtifactLease(
    machine: AgentSessionMachine,
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    if (
      request.operation !== "simulation-input" ||
      request.input.action !== "release-download"
    )
      throw new Error("INVALID_ARTIFACT_ACK");
    const response = await this.artifacts.handle(
      new Request("https://internal/artifacts/" + request.input.fileId, {
        method: "DELETE",
        headers: { "x-artifact-lease": request.input.leaseId },
      }),
      machine.sessionId,
      request.input.fileId,
    );
    const result =
      response.ok || response.status === 404
        ? { ok: true, released: response.ok }
        : {
            ok: false,
            error: {
              code: "ARTIFACT_ACK_FAILED",
              message:
                "Verified local evidence is safe; the download lease will expire",
              stage: "export",
              recovery: "retry-after",
            },
          };
    return AgentFileResourceResponseSchema.parse({
      apiVersion: "3.0",
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      result,
    });
  }

  /**
   * Relay one Simulation Resource request to the browser.
   *
   * Structurally the same as `files`, with two deliberate differences. The
   * forward waits on the simulation ceiling rather than the edit ceiling, and
   * a completed run IS cached against its requestId: a retry after a dropped
   * response must return the numbers that were already computed, not start a
   * second container run and bill the deployment twice for one question.
   */
  private async simulation(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
    trace?: RequestTrace,
  ): Promise<Response> {
    const raw = await request.text();
    const size = machine.checkSize(new TextEncoder().encode(raw).byteLength);
    if (!size.ok) {
      return jsonResponse(
        errorBody(size.code, errorMessage(size.code)),
        transportStatus(size.code),
        allowedOrigin,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return jsonResponse(
        errorBody(
          "SIMULATION_REQUEST_INVALID",
          "Simulation Resource request must be valid JSON",
        ),
        400,
        allowedOrigin,
      );
    }
    const parsed = parseAgentSimulationResourceRequest(input);
    if (!parsed.success) {
      return jsonResponse(
        errorBody(
          "SIMULATION_REQUEST_INVALID",
          errorMessage("SIMULATION_REQUEST_INVALID"),
        ),
        400,
        allowedOrigin,
      );
    }
    const simulationRequest = parsed.data;
    const auth = machine.authorize(bearerToken(request), Date.now());
    if (!auth.ok)
      return jsonResponse(
        errorBody(auth.code, errorMessage(auth.code)),
        transportStatus(auth.code),
        allowedOrigin,
      );
    if (
      !machine.assertScopes(
        auth.session.scopes,
        simulationOperationScopes(simulationRequest),
      ).ok
    )
      return this.refuseScope(allowedOrigin);
    const readOnly = isReadOnlySimulationRequest(simulationRequest);
    if (trace)
      trace.identity = {
        requestId: simulationRequest.requestId,
        operation: simulationRequest.operation,
      };
    const begin = await this.beginRequest(
      machine,
      simulationRequest.requestId,
      await scopedRequestHash(
        raw,
        request.headers.get("x-agent-context") ?? machine.contextRevision,
        request.headers.get("x-agent-workspace"),
      ),
      readOnly ? "read" : "write",
    );
    if (begin.kind === "cached") {
      if (trace) {
        trace.cache = "hit";
        trace.result = begin.result as RequestTrace["result"];
      }
      return jsonResponse(begin.result, 200, allowedOrigin);
    }
    if (begin.kind === "rejected")
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    if (
      simulationRequest.operation !== "capabilities" &&
      simulationRequest.operation !== "authoring-help"
    )
      machine.recordActivity(Date.now());
    if (!readOnly) await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: simulationRequest.requestId,
    });
    try {
      const forwardStarted = performance.now();
      const result = await this.forwardToEditor(
        machine,
        simulationRequest,
        "simulation-request",
        request.headers.get("x-agent-context") ?? undefined,
        request.headers.get("x-agent-workspace") ?? undefined,
        trace,
      );
      if (trace) trace.result = result as RequestTrace["result"];
      machine.completeRequest(simulationRequest.requestId, result, Date.now());
      if (
        simulationRequest.operation !== "capabilities" &&
        simulationRequest.operation !== "authoring-help"
      )
        machine.recordActivity(Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: simulationRequest.requestId,
      });
      return jsonResponse(
        result,
        200,
        allowedOrigin,
        this.relayTiming(
          simulationRequest,
          "simulation",
          result,
          forwardStarted,
        ),
      );
    } catch (error) {
      if (this.deviceRevokedUntil)
        return this.deviceRevokedResponse(allowedOrigin);
      const value = error instanceof Error ? error.message : "";
      const code: AgentTransportErrorCode =
        value === "REQUEST_TIMEOUT" || value === "MESSAGE_TOO_LARGE"
          ? value
          : value === "EDITOR_OFFLINE"
            ? "EDITOR_OFFLINE"
            : "EDITOR_DISCONNECTED";
      machine.failRequest(
        simulationRequest.requestId,
        code === "EDITOR_OFFLINE",
      );
      await this.persist();
      this.emit({
        type: "operation.failed",
        sessionId: machine.sessionId,
        requestId: simulationRequest.requestId,
      });
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
        allowedOrigin,
      );
    }
  }

  private async projects(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
    trace?: RequestTrace,
  ): Promise<Response> {
    const raw = await request.text();
    const size = machine.checkSize(new TextEncoder().encode(raw).byteLength);
    if (!size.ok) {
      return jsonResponse(
        errorBody(size.code, errorMessage(size.code)),
        transportStatus(size.code),
        allowedOrigin,
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return jsonResponse(
        errorBody(
          "PROJECT_REQUEST_INVALID",
          "Project Resource request must be valid JSON",
        ),
        400,
        allowedOrigin,
      );
    }
    const parsed = parseAgentProjectResourceRequest(input);
    if (!parsed.success) {
      return jsonResponse(
        errorBody(
          "PROJECT_REQUEST_INVALID",
          errorMessage("PROJECT_REQUEST_INVALID"),
        ),
        400,
        allowedOrigin,
      );
    }
    const projectRequest = parsed.data;
    const auth = machine.authorize(bearerToken(request), Date.now());
    if (!auth.ok) {
      return jsonResponse(
        errorBody(auth.code, errorMessage(auth.code)),
        transportStatus(auth.code),
        allowedOrigin,
      );
    }
    const access = projectOperationAccess(projectRequest);
    if (
      (this.deviceTrust && access.reachesAccount) ||
      !machine.assertScopes(auth.session.scopes, access.scopes).ok
    )
      return this.refuseScope(allowedOrigin);
    const readOnly = isReadOnlyProjectRequest(projectRequest);
    if (trace)
      trace.identity = {
        requestId: projectRequest.requestId,
        operation: projectRequest.operation,
      };
    const begin = await this.beginRequest(
      machine,
      projectRequest.requestId,
      await scopedRequestHash(
        raw,
        request.headers.get("x-agent-context") ?? machine.contextRevision,
        request.headers.get("x-agent-workspace"),
      ),
      readOnly ? "read" : "write",
    );
    if (begin.kind === "cached") {
      if (trace) {
        trace.cache = "hit";
        trace.result = begin.result as RequestTrace["result"];
      }
      return jsonResponse(begin.result, 200, allowedOrigin);
    }
    if (begin.kind === "rejected") {
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    }
    machine.recordActivity(Date.now());
    if (!readOnly) await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: projectRequest.requestId,
    });
    try {
      const forwardStarted = performance.now();
      const result = await this.forwardToEditor(
        machine,
        projectRequest,
        "project-request",
        request.headers.get("x-agent-context") ?? undefined,
        request.headers.get("x-agent-workspace") ?? undefined,
        trace,
      );
      if (trace) trace.result = result as RequestTrace["result"];
      machine.completeRequest(projectRequest.requestId, result, Date.now());
      machine.recordActivity(Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: projectRequest.requestId,
      });
      return jsonResponse(
        result,
        200,
        allowedOrigin,
        this.relayTiming(projectRequest, "projects", result, forwardStarted),
      );
    } catch (error) {
      if (this.deviceRevokedUntil)
        return this.deviceRevokedResponse(allowedOrigin);
      const value = error instanceof Error ? error.message : "";
      const code: AgentTransportErrorCode =
        value === "REQUEST_TIMEOUT" || value === "MESSAGE_TOO_LARGE"
          ? value
          : value === "EDITOR_OFFLINE"
            ? "EDITOR_OFFLINE"
            : "EDITOR_DISCONNECTED";
      machine.failRequest(projectRequest.requestId, code === "EDITOR_OFFLINE");
      await this.persist();
      this.emit({
        type: "operation.failed",
        sessionId: machine.sessionId,
        requestId: projectRequest.requestId,
      });
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
        allowedOrigin,
      );
    }
  }

  private async events(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
  ): Promise<Response> {
    const auth = machine.authorize(bearerToken(request), Date.now());
    if (!auth.ok)
      return jsonResponse(
        errorBody(auth.code, errorMessage(auth.code)),
        transportStatus(auth.code),
        allowedOrigin,
      );
    const encoder = new TextEncoder();
    let subscriber: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = controller;
        controller.enqueue(encoder.encode(": connected\n\n"));
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            this.removeEventSubscriber(controller);
          }
        }, AGENT_SSE_KEEPALIVE_INTERVAL_MS);
        this.eventSubscribers.set(controller, keepalive);
      },
      cancel: () => {
        if (subscriber) this.removeEventSubscriber(subscriber);
      },
    });
    const headers = relayHeaders(allowedOrigin);
    headers.set("content-type", "text/event-stream");
    headers.set("connection", "keep-alive");
    return new Response(stream, { headers });
  }

  private async control(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
  ): Promise<Response> {
    if (
      !machine.authorizeEditor(request.headers.get("x-editor-secret") ?? "")
    ) {
      return jsonResponse(
        errorBody("TOKEN_INVALID", "Invalid editor secret"),
        401,
        allowedOrigin,
      );
    }
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    const status = machine.statusAt(Date.now());
    if (status === "expired" || status === "revoked") {
      const code = status === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED";
      return jsonResponse(
        errorBody(code, errorMessage(code)),
        transportStatus(code),
        allowedOrigin,
      );
    }
    // A person in the paired editor. Presence renews the idle deadline
    // within its cap; "Keep connected" is an explicit choice and renews as
    // Pause and Resume do. Neither changes what the Agent sees but the
    // renewed deadline.
    if (body?.action === "presence" || body?.action === "keep-alive") {
      // Presence needs the paired editor still attached to the session.
      const attached = (
        this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []
      ).some((socket) => socket.readyState === WebSocket.OPEN);
      const renewed =
        body.action === "presence"
          ? attached && machine.recordPresence(Date.now())
          : machine.recordActivity(Date.now());
      await this.persist();
      return jsonResponse(
        {
          ok: true,
          renewed,
          status: machine.statusAt(Date.now()),
          expiresAt: new Date(machine.expiresAt).toISOString(),
        },
        200,
        allowedOrigin,
      );
    }
    const trustedTask = this.trustedTask(machine);
    const ended = () =>
      jsonResponse({ ok: true, status: "revoked" }, 200, allowedOrigin);
    // Stop trusting the device that opened this task: its other tasks end
    // with it, and its next task needs an approval again.
    if (body?.action === "untrust-device") {
      if (!trustedTask)
        return jsonResponse(
          { error: "This task was not opened from a trusted device" },
          409,
          allowedOrigin,
        );
      if (!(await trustedTask.untrust()))
        return jsonResponse(
          { error: "Device trust could not be changed" },
          503,
          allowedOrigin,
        );
      await this.revokeTrustedSession(machine, "removed");
      return ended();
    }
    // Ending a trusted task leaves its device trusted.
    if (body?.action === "revoke" && trustedTask) {
      await this.revokeTrustedSession(machine, "kept");
      return ended();
    }
    if (body?.action === "pause") machine.pause();
    else if (body?.action === "resume") machine.resume();
    else if (body?.action === "revoke") machine.revoke();
    else if (body?.action === "replace-project") machine.replaceProject();
    else
      return jsonResponse(
        { error: "Unknown control action" },
        400,
        allowedOrigin,
      );
    if (body.action === "revoke" || body.action === "replace-project") {
      await this.clearStoredSession();
      if (body.action === "replace-project")
        this.replacedUntil = await this.tombstone(PROJECT_REPLACED_KEY);
    } else {
      machine.recordActivity(Date.now());
      await this.persist();
    }
    const type =
      body.action === "pause"
        ? "session.paused"
        : body.action === "replace-project"
          ? "document.replaced"
          : body.action === "revoke"
            ? "session.revoked"
            : "session.ready";
    this.emit({ type, sessionId: machine.sessionId } as AgentSessionEvent);
    return jsonResponse(
      { ok: true, status: machine.statusAt(Date.now()) },
      200,
      allowedOrigin,
    );
  }

  private async disconnect(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
    onlyIfDetached = false,
  ): Promise<Response> {
    const token = bearerToken(request);
    if (onlyIfDetached) {
      const auth = machine.authorize(token, Date.now());
      if (!auth.ok)
        return jsonResponse(
          errorBody(auth.code, errorMessage(auth.code)),
          transportStatus(auth.code),
          allowedOrigin,
        );
      const attached = (
        this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []
      ).some((socket) => socket.readyState === WebSocket.OPEN);
      if (
        attached ||
        (!this.editorLeft &&
          machine.projectId !== BROWSER_LAUNCH_PENDING_PROJECT)
      )
        return new Response(null, {
          status: 409,
          headers: relayHeaders(allowedOrigin),
        });
    }
    const editorAuthorized = machine.authorizeEditor(
      request.headers.get("x-editor-secret") ?? "",
    );
    if (!editorAuthorized && !machine.authorize(token, Date.now()).ok) {
      return jsonResponse(
        errorBody("TOKEN_INVALID", errorMessage("TOKEN_INVALID")),
        401,
        allowedOrigin,
      );
    }
    if (this.deviceTrust) {
      await this.revokeTrustedSession(machine, "kept");
    } else {
      machine.revoke();
      this.emit({ type: "session.revoked", sessionId: machine.sessionId });
      this.notifyEditor({
        type: "session.revoked",
        sessionId: machine.sessionId,
      });
      await this.clearStoredSession();
    }
    return new Response(null, {
      status: 204,
      headers: relayHeaders(allowedOrigin),
    });
  }

  /**
   * The session's last answered requests, oldest first, readable by any
   * process holding its Agent token (GET /activity): one CLI process per
   * call kept its own, always empty, list (#1227). Held while the relay is
   * awake; bounded.
   */
  private readonly recentOperations: {
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
  }[] = [];

  /** What the editor reported with each reply, until its request returns. */
  private readonly editorTimings = new Map<
    string,
    { workMs: number; visibility: "visible" | "hidden" }
  >();

  /**
   * Where a relayed request's time went, as response headers: the whole
   * forward through request completion/persistence, the editor's own work, and whether its
   * tab was in the background (#1227). The body's contract is unchanged.
   */
  private relayTiming(
    request: { requestId: string; operation?: unknown; action?: unknown },
    _resource: string,
    _result: unknown,
    forwardStarted: number,
  ): Record<string, string> {
    const requestId = request.requestId;
    const editor = this.editorTimings.get(requestId);
    return {
      "x-agent-relay-ms": String(
        Math.round(performance.now() - forwardStarted),
      ),
      ...(editor
        ? {
            "x-agent-editor-ms": String(editor.workMs),
            "x-agent-editor-visibility": editor.visibility,
          }
        : {}),
    };
  }

  private async forwardToEditor(
    machine: AgentSessionMachine,
    payload:
      | AgentCircuitRequest
      | AgentFileResourceRequest
      | AgentSimulationResourceRequest
      | AgentProjectResourceRequest,
    kind:
      | "circuit-request"
      | "file-request"
      | "simulation-request"
      | "project-request" = "circuit-request",
    contextRevision?: string,
    workspaceId?: string,
    trace?: RequestTrace,
  ): Promise<unknown> {
    if (trace) trace.forwardStarted = performance.now();
    try {
      const sockets = this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? [];
      const socket = sockets.find(
        (candidate) => candidate.readyState === WebSocket.OPEN,
      );
      if (!socket) throw new Error("EDITOR_OFFLINE");
      const requestId = payload.requestId;
      const response = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            this.pendingForwards.delete(requestId);
            reject(new Error("REQUEST_TIMEOUT"));
          },
          kind === "simulation-request"
            ? SIMULATION_FORWARD_TIMEOUT_MS
            : FORWARD_TIMEOUT_MS,
        );
        this.pendingForwards.set(requestId, {
          resolve,
          reject,
          timeout,
          socket,
        });
      });
      socket.send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: machine.sessionId,
          messageId: crypto.randomUUID(),
          requestId,
          sentAt: new Date().toISOString(),
          kind,
          ...(contextRevision ? { contextRevision } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          payload,
        }),
      );
      return await response;
    } finally {
      if (trace) trace.forwardEnded = performance.now();
    }
  }

  private emit(event: AgentSessionEvent): void {
    const encoded = new TextEncoder().encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const subscriber of [...this.eventSubscribers.keys()]) {
      try {
        subscriber.enqueue(encoded);
      } catch {
        this.removeEventSubscriber(subscriber);
      }
    }
  }

  private removeEventSubscriber(
    subscriber: ReadableStreamDefaultController<Uint8Array>,
    close = false,
  ): void {
    const keepalive = this.eventSubscribers.get(subscriber);
    if (keepalive !== undefined) clearInterval(keepalive);
    this.eventSubscribers.delete(subscriber);
    if (close) subscriber.close();
  }

  private notifyEditor(event: AgentSessionEvent): void {
    const sockets = this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? [];
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(editorEventMessage(event));
    }
  }

  /**
   * Begin a request against the session's whole ledger. A completed write
   * leaves memory once stored under its own key, so for a request ID the
   * machine does not hold, its stored record is recalled first. Recall and
   * begin run together after the read, which holds the input gate.
   */
  private async beginRequest(
    machine: AgentSessionMachine,
    requestId: string,
    payloadHash: string,
    replayMode: "read" | "write",
  ): Promise<RequestBeginResult> {
    if (!machine.holdsRequest(requestId)) {
      const stored = await this.state.storage.get<CompletedAgentRequest>(
        requestLedgerKey(requestId),
      );
      if (stored) machine.recallRequest(requestId, stored);
    }
    return machine.beginRequest(requestId, Date.now(), payloadHash, replayMode);
  }

  private async loadMachine(): Promise<AgentSessionMachine | null> {
    if (this.deviceRevokedUntil) return null;
    if (this.machine) return this.machine;
    const stored =
      await this.state.storage.get<StoredSession>(SESSION_STATE_KEY);
    if (!stored) return null;
    this.deviceTrust = stored.deviceTrust;
    this.machine = AgentSessionMachine.restore(
      stored,
      () => crypto.randomUUID(),
      Date.now(),
    );
    return this.machine;
  }

  private async initialize(): Promise<void> {
    this.deviceRevokedUntil =
      (await this.state.storage.get<number>(DEVICE_REVOKED_KEY)) ?? 0;
    if (this.deviceRevokedUntil) {
      // Absent for a task ended by an earlier release: its answer stays generic.
      this.deviceRevokedTrust = await this.state.storage.get<EndedTrust>(
        DEVICE_REVOKED_TRUST_KEY,
      );
      return;
    }
    this.replacedUntil =
      (await this.state.storage.get<number>(PROJECT_REPLACED_KEY)) ?? 0;
    this.editorLeft =
      (await this.state.storage.get<boolean>("agent-editor-left")) === true;
    const stored =
      await this.state.storage.get<StoredSession>(SESSION_STATE_KEY);
    if (stored) {
      this.deviceTrust = stored.deviceTrust;
      this.machine = AgentSessionMachine.restore(
        stored,
        () => crypto.randomUUID(),
        Date.now(),
      );
      // A failed write here would leave the object unable to answer any
      // request, its session neither ended nor usable. The next change
      // writes the state again.
      await this.persist().catch((error: unknown) =>
        console.error("Agent session state not saved on restore", error),
      );
    }
  }

  private async persist(): Promise<void> {
    if (this.deviceRevokedUntil || this.replacedUntil > Date.now()) return;
    if (!this.machine) return;
    const status = this.machine.statusAt(Date.now());
    if (status === "revoked" || status === "expired") {
      await this.clearStoredSession();
      return;
    }
    await this.storeState(this.machine);
    if (this.publishedExpiresAt !== this.machine.expiresAt) {
      this.publishedExpiresAt = this.machine.expiresAt;
      await this.state.storage.setAlarm?.(
        Math.min(
          Math.max(Date.now(), this.machine.expiresAt - EXPIRY_WARNING_MS),
          (await this.artifacts.nextMaintenanceAt()) ?? Infinity,
        ),
      );
      const event: AgentSessionEvent = {
        type: "session.renewed",
        sessionId: this.machine.sessionId,
        expiresAt: new Date(this.machine.expiresAt).toISOString(),
      };
      this.emit(event);
      this.notifyEditor(event);
    }
  }

  /**
   * Write the session state. Completed writes leave it: each record goes
   * once under its own key, issued before the state with no await between
   * them, a series Durable Objects submit atomically. Only then does the
   * machine drop them, so a retry finds its record in memory or in storage.
   */
  private async storeState(machine: AgentSessionMachine): Promise<void> {
    const completed = machine.completedRequestsToStore();
    await Promise.all([
      ...completed.map(([requestId, record]) =>
        this.state.storage.put(requestLedgerKey(requestId), record),
      ),
      this.state.storage.put(SESSION_STATE_KEY, {
        ...machine.serialize(),
        ...(this.deviceTrust ? { deviceTrust: this.deviceTrust } : {}),
      }),
    ]);
    machine.forgetStoredRequests(completed.map(([requestId]) => requestId));
  }

  /**
   * End the session's storage. Downloads R2 could not delete stay listed,
   * with an alarm to retry them, so the session ends either way.
   */
  private async clearStoredSession(): Promise<void> {
    const device = this.deviceTrust;
    this.deviceTrust = undefined;
    if (device && this.machine)
      await this.devices.task(device, this.machine.sessionId).leave();
    const left = [
      ...((await this.state.storage.get<string[]>(ARTIFACT_CLEANUP_KEY)) ?? []),
      ...(await this.artifacts.clear()),
    ];
    const storage = this.state.storage;
    if (!this.deviceRevokedUntil) {
      await storage.deleteAll?.();
    } else if (storage.list && storage.delete) {
      // Leave the terminal marker in place throughout cleanup.
      for (;;) {
        const entries = await storage.list({ limit: 128 });
        const keys = [...entries.keys()].filter(
          (key) =>
            key !== DEVICE_REVOKED_KEY && key !== DEVICE_REVOKED_TRUST_KEY,
        );
        if (keys.length === 0) break;
        await storage.delete(keys);
      }
    }
    if (!left.length) return;
    await this.state.storage.put(ARTIFACT_CLEANUP_KEY, left);
    await this.state.storage.setAlarm?.(Date.now() + ARTIFACT_CLEANUP_RETRY_MS);
  }

  /** This session's standing with the device that opened it, if one did. */
  private trustedTask(machine: AgentSessionMachine) {
    return (
      this.deviceTrust && this.devices.task(this.deviceTrust, machine.sessionId)
    );
  }

  /** A trusted-device task is told it is local, and where the rest is done. */
  private refuseScope(allowedOrigin: string | null): Response {
    const code = this.deviceTrust
      ? "TRUSTED_TASK_LOCAL_ONLY"
      : "TOKEN_SCOPE_INSUFFICIENT";
    return jsonResponse(
      errorBody(code, errorMessage(code)),
      transportStatus(code),
      allowedOrigin,
    );
  }

  /** Write a tombstone that outlives the session's state; the alarm ends it. */
  private async tombstone(key: string): Promise<number> {
    const until = Date.now() + TOMBSTONE_MS;
    await Promise.all([
      this.state.storage.put(key, until),
      this.state.storage.setAlarm?.(until),
    ]);
    return until;
  }

  private deviceRevokedResponse(allowedOrigin: string | null) {
    return jsonResponse(
      errorBody(
        "SESSION_REVOKED",
        this.deviceRevokedTrust
          ? TRUSTED_TASK_ENDED[this.deviceRevokedTrust]
          : errorMessage("SESSION_REVOKED"),
      ),
      transportStatus("SESSION_REVOKED"),
      allowedOrigin,
    );
  }

  /** End a trusted task for good, recording whether its device stays trusted. */
  private async revokeTrustedSession(
    machine: AgentSessionMachine,
    trust: EndedTrust,
  ) {
    if (this.deviceRevokedUntil > Date.now()) return;
    await this.state.storage.put(DEVICE_REVOKED_TRUST_KEY, trust);
    this.deviceRevokedTrust = trust;
    this.deviceRevokedUntil = await this.tombstone(DEVICE_REVOKED_KEY);
    machine.revoke();
    const event = {
      type: "session.revoked" as const,
      sessionId: machine.sessionId,
    };
    this.emit(event);
    try {
      this.notifyEditor(event);
    } catch {
      // An already closed Editor cannot prevent the revocation.
    }
    for (const [requestId, pending] of this.pendingForwards) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("SESSION_REVOKED"));
      machine.failRequest(requestId, false);
    }
    this.pendingForwards.clear();
    for (const socket of this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []) {
      try {
        socket.close?.(4003, "Agent session revoked");
      } catch {
        // A disconnected peer has no further access.
      }
    }
    for (const subscriber of [...this.eventSubscribers.keys()])
      this.removeEventSubscriber(subscriber, true);
    await this.clearStoredSession();
  }

  private async approveEditorLaunch(
    request: Request,
    machine: AgentSessionMachine,
    allowedOrigin: string | null,
  ): Promise<Response> {
    const approval = request.headers
      .get("content-type")
      ?.startsWith("application/json")
      ? ((await request.json()) as {
          grant: string;
          device?: {
            directory: string;
            deviceId: string;
            action: "auto" | "trust";
            label?: string;
          };
        })
      : { grant: await request.text() };
    const reply = (data: unknown, status: number) =>
      jsonResponse(data, status, allowedOrigin);
    if (
      this.approvingLaunch ||
      !machine.matchesBrowserLaunchGrant(approval.grant, Date.now())
    )
      return reply({ ok: false }, 409);
    this.approvingLaunch = true;
    try {
      let link: DeviceTrustLink | undefined;
      let pendingDevice = false;
      if (approval.device) {
        const { directory, ...device } = approval.device;
        const enrolled = await this.devices.enroll(
          directory,
          device,
          machine.sessionId,
        );
        if ("status" in enrolled) return reply({ ok: false }, enrolled.status);
        link = enrolled.link;
        pendingDevice = enrolled.pending;
      }
      const trustedTask = link && this.devices.task(link, machine.sessionId);
      const secret = machine.approveBrowserLaunch(
        approval.grant,
        Date.now(),
        link ? TRUSTED_REVIEW_SCOPES : undefined,
      );
      if (!secret) {
        await trustedTask?.leave();
        return reply({ ok: false }, 409);
      }
      this.deviceTrust = link;
      await this.persist();
      if (trustedTask && pendingDevice) {
        const committed = await trustedTask.commit();
        if (!committed.ok) {
          await this.revokeTrustedSession(machine, "removed");
          return reply({ ok: false }, committed.status);
        }
      }
      if (trustedTask && !(await trustedTask.isCurrent())) {
        await this.revokeTrustedSession(machine, "removed");
        return this.deviceRevokedResponse(allowedOrigin);
      }
      return reply(
        {
          version: 1,
          sessionId: machine.sessionId,
          editorSecret: secret,
          projectId: machine.projectId,
          projectSessionId: machine.projectSessionId,
          scopes: machine.scopes,
          ...(link ? { localReviewOnly: true } : {}),
          expiresAt: machine.expiresAt,
        },
        200,
      );
    } finally {
      this.approvingLaunch = false;
    }
  }
}
