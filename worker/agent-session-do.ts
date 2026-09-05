import {
  AGENT_SSE_KEEPALIVE_INTERVAL_MS,
  AGENT_SESSION_PROTOCOL_VERSION,
  AgentCircuitResponseSchema,
  AgentFileResourceResponseSchema,
  AgentSimulationResourceResponseSchema,
  AgentSessionControlMessageSchema,
  AgentSessionEventSchema,
  AgentSessionMachine,
  AgentSessionMessageSchema,
  AgentSessionScopeSchema,
  invalidAgentRequestResponse,
  parseAgentCircuitRequest,
  parseAgentFileResourceRequest,
  parseAgentSimulationResourceRequest,
  type AgentCircuitRequest,
  type AgentFileResourceRequest,
  type AgentSimulationResourceRequest,
  type AgentSessionEvent,
  type AgentSessionScope,
  type AgentTransportErrorCode,
  type PersistedAgentSessionState,
} from "@icm/agent-adapter";

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
  sha256Text,
  simulationOperationScopes,
  transportStatus,
  type AgentSessionEnv,
  type DurableStateLike,
  type PendingForward,
  type WebSocketPairConstructor,
} from "./agent-session-runtime";

/** Cloudflare Durable Object owning one temporary Agent session. */
export class AgentSessionDO {
  private machine: AgentSessionMachine | null = null;
  private readonly ready: Promise<void>;
  private creating = false;
  private readonly pendingForwards = new Map<string, PendingForward>();
  private readonly eventSubscribers = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    ReturnType<typeof setInterval>
  >();

  constructor(
    private readonly state: DurableStateLike,
    private readonly env: AgentSessionEnv,
  ) {
    this.ready = this.initialize();
    this.state.blockConcurrencyWhile?.(() => this.ready);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const allowedOrigin = this.env.AGENT_ALLOWED_ORIGIN ?? null;
    if (request.method === "POST" && url.pathname === "/create") {
      return this.create(request, allowedOrigin);
    }
    const machine = await this.loadMachine();
    if (!machine) {
      return jsonResponse(
        errorBody("SESSION_NOT_FOUND", errorMessage("SESSION_NOT_FOUND")),
        404,
        allowedOrigin,
      );
    }
    if (request.method === "POST" && url.pathname === "/claim") {
      return this.claim(request, machine, allowedOrigin);
    }
    if (request.method === "POST" && url.pathname === "/resume-connector") {
      return this.resumeConnector(request, machine, allowedOrigin);
    }
    if (url.pathname === "/editor") {
      return this.connectEditor(request, machine);
    }
    if (request.method === "POST" && url.pathname === "/circuit") {
      return this.circuit(request, machine, allowedOrigin);
    }
    if (request.method === "POST" && url.pathname === "/files") {
      return this.files(request, machine, allowedOrigin);
    }
    if (request.method === "POST" && url.pathname === "/simulation") {
      return this.simulation(request, machine, allowedOrigin);
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
    return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.ready;
    const machine = await this.loadMachine();
    if (!machine) return;
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
        control.data.projectId &&
        control.data.documentIds &&
        machine.updateEditorDocuments(
          control.data.projectId,
          control.data.documentIds,
        )
      )
        await this.persist();
      socket.send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: machine.sessionId,
          kind: "heartbeat-ack",
          nonce: control.data.nonce,
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
      envelope.kind === "simulation-response"
    ) {
      const pending = this.pendingForwards.get(envelope.requestId);
      if (!pending) return;
      const response =
        envelope.kind === "circuit-response"
          ? AgentCircuitResponseSchema.safeParse(envelope.payload)
          : envelope.kind === "file-response"
            ? AgentFileResourceResponseSchema.safeParse(envelope.payload)
            : AgentSimulationResourceResponseSchema.safeParse(envelope.payload);
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
        this.emit(event.data);
      }
    }
  }

  async webSocketClose(socket?: WebSocket) {
    await this.ready;
    const replacement = (
      this.state.getWebSockets?.(EDITOR_SOCKET_TAG) ?? []
    ).some(
      (candidate) =>
        candidate !== socket && candidate.readyState === WebSocket.OPEN,
    );
    if (replacement) return;
    this.emit({
      type: "editor.offline",
      sessionId: this.machine?.sessionId ?? "unknown",
    });
    for (const [requestId, pending] of this.pendingForwards) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("EDITOR_DISCONNECTED"));
      this.machine?.failRequest(requestId, false);
    }
    this.pendingForwards.clear();
    const status = this.machine?.statusAt(Date.now());
    if (status === "revoked" || status === "expired") {
      await this.state.storage.deleteAll?.();
    } else {
      await this.persist();
    }
  }

  async alarm(): Promise<void> {
    await this.ready;
    const machine = await this.loadMachine();
    if (machine && Date.now() < machine.expiresAt) {
      const event: AgentSessionEvent = {
        type: "session.expiring",
        sessionId: machine.sessionId,
        expiresAt: new Date(machine.expiresAt).toISOString(),
      };
      this.emit(event);
      this.notifyEditor(event);
      await this.state.storage.setAlarm?.(machine.expiresAt);
      return;
    }
    if (machine) {
      machine.revoke();
      this.emit({ type: "session.revoked", sessionId: machine.sessionId });
      this.notifyEditor({
        type: "session.revoked",
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
    await this.state.storage.deleteAll?.();
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
      if (
        scopes.length !== body.scopes.length ||
        body.documentIds.length === 0
      ) {
        return jsonResponse(
          { error: "Invalid session scopes or Documents" },
          400,
          allowedOrigin,
        );
      }
      const created = AgentSessionMachine.create({
        sessionId: body.sessionId,
        projectSessionId: body.projectSessionId,
        projectId: body.projectId,
        documentIds: body.documentIds,
        scopes,
        now: Date.now(),
        random: () => crypto.randomUUID(),
      });
      this.machine = created.machine;
      await this.persist();
      await this.state.storage.setAlarm?.(
        Math.max(Date.now(), created.session.expiresAt - EXPIRY_WARNING_MS),
      );
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
    } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    const result = redeemClaimResponse(machine, code, Date.now());
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
    return jsonResponse(
      { ...result, sessionId: machine.sessionId },
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
    this.emit({ type: "session.ready", sessionId: machine.sessionId });
    this.notifyEditor({ type: "session.ready", sessionId: machine.sessionId });
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
        documentIds: machine.documentIds,
      },
      200,
      allowedOrigin,
    );
  }

  private connectEditor(
    request: Request,
    machine: AgentSessionMachine,
  ): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "WebSocket upgrade required" }, 426);
    }
    if (!machine.authorizeEditor(editorSecret(request))) {
      return jsonResponse(
        errorBody("TOKEN_INVALID", "Invalid editor secret"),
        401,
      );
    }
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
    this.emit({ type: "editor.online", sessionId: machine.sessionId });
    for (const socket of previousSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(4001, "editor transport replaced");
      }
    }
    if (status === "paused") {
      pair[1].send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: machine.sessionId,
          messageId: crypto.randomUUID(),
          requestId: `event-${crypto.randomUUID()}`,
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: { type: "session.paused", sessionId: machine.sessionId },
        }),
      );
    } else if (machine.claimed) {
      pair[1].send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: machine.sessionId,
          messageId: crypto.randomUUID(),
          requestId: `event-${crypto.randomUUID()}`,
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: { type: "session.ready", sessionId: machine.sessionId },
        }),
      );
    }
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
    const scopeAllowed = operationScopes(circuitRequest).every(
      (required) => machine.assertScope(auth.session.scopes, required).ok,
    );
    if (!scopeAllowed) {
      return jsonResponse(
        errorBody(
          "TOKEN_SCOPE_INSUFFICIENT",
          errorMessage("TOKEN_SCOPE_INSUFFICIENT"),
        ),
        403,
        allowedOrigin,
      );
    }
    if ("documentId" in circuitRequest) {
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
    const payloadHash = await sha256Text(raw);
    const begin = machine.beginRequest(
      circuitRequest.requestId,
      Date.now(),
      payloadHash,
    );
    if (begin.kind === "cached")
      return jsonResponse(begin.result, 200, allowedOrigin);
    if (begin.kind === "rejected") {
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    }
    await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: circuitRequest.requestId,
    });
    try {
      const result = await this.forwardToEditor(machine, circuitRequest);
      machine.completeRequest(circuitRequest.requestId, result, Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: circuitRequest.requestId,
      });
      return jsonResponse(result, 200, allowedOrigin);
    } catch (error) {
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
    const scopeAllowed = fileOperationScopes(fileRequest).every(
      (required) => machine.assertScope(auth.session.scopes, required).ok,
    );
    if (!scopeAllowed) {
      return jsonResponse(
        errorBody(
          "TOKEN_SCOPE_INSUFFICIENT",
          errorMessage("TOKEN_SCOPE_INSUFFICIENT"),
        ),
        403,
        allowedOrigin,
      );
    }
    if (
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
    const begin = machine.beginRequest(
      fileRequest.requestId,
      Date.now(),
      await sha256Text(raw),
    );
    if (begin.kind === "cached")
      return jsonResponse(begin.result, 200, allowedOrigin);
    if (begin.kind === "rejected")
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: fileRequest.requestId,
    });
    try {
      const result = await this.forwardToEditor(
        machine,
        fileRequest,
        "file-request",
      );
      // Export blobs are explicitly one-shot: the DO retains only an unavailable
      // idempotency marker, never their bytes. Candidate summaries are safe to cache.
      if (fileRequest.operation === "download") {
        machine.completeRequestWithoutResult(fileRequest.requestId, Date.now());
      } else {
        machine.completeRequest(fileRequest.requestId, result, Date.now());
      }
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: fileRequest.requestId,
      });
      return jsonResponse(result, 200, allowedOrigin);
    } catch (error) {
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
    const scopeAllowed = simulationOperationScopes(simulationRequest).every(
      (required) => machine.assertScope(auth.session.scopes, required).ok,
    );
    if (!scopeAllowed) {
      return jsonResponse(
        errorBody(
          "TOKEN_SCOPE_INSUFFICIENT",
          errorMessage("TOKEN_SCOPE_INSUFFICIENT"),
        ),
        403,
        allowedOrigin,
      );
    }
    const begin = machine.beginRequest(
      simulationRequest.requestId,
      Date.now(),
      await sha256Text(raw),
    );
    if (begin.kind === "cached")
      return jsonResponse(begin.result, 200, allowedOrigin);
    if (begin.kind === "rejected")
      return jsonResponse(
        errorBody(begin.code, errorMessage(begin.code)),
        transportStatus(begin.code),
        allowedOrigin,
      );
    await this.persist();
    this.emit({
      type: "operation.started",
      sessionId: machine.sessionId,
      requestId: simulationRequest.requestId,
    });
    try {
      const result = await this.forwardToEditor(
        machine,
        simulationRequest,
        "simulation-request",
      );
      machine.completeRequest(simulationRequest.requestId, result, Date.now());
      await this.persist();
      this.emit({
        type: "operation.completed",
        sessionId: machine.sessionId,
        requestId: simulationRequest.requestId,
      });
      return jsonResponse(result, 200, allowedOrigin);
    } catch (error) {
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
      await this.state.storage.deleteAll?.();
    } else {
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
  ): Promise<Response> {
    const token = bearerToken(request);
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
    machine.revoke();
    this.emit({ type: "session.revoked", sessionId: machine.sessionId });
    this.notifyEditor({
      type: "session.revoked",
      sessionId: machine.sessionId,
    });
    await this.state.storage.deleteAll?.();
    return new Response(null, {
      status: 204,
      headers: relayHeaders(allowedOrigin),
    });
  }

  private async forwardToEditor(
    machine: AgentSessionMachine,
    payload:
      | AgentCircuitRequest
      | AgentFileResourceRequest
      | AgentSimulationResourceRequest,
    kind:
      | "circuit-request"
      | "file-request"
      | "simulation-request" = "circuit-request",
  ): Promise<unknown> {
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
      this.pendingForwards.set(requestId, { resolve, reject, timeout });
    });
    socket.send(
      JSON.stringify({
        protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
        sessionId: machine.sessionId,
        messageId: crypto.randomUUID(),
        requestId,
        sentAt: new Date().toISOString(),
        kind,
        payload,
      }),
    );
    return response;
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
      socket.send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: event.sessionId,
          messageId: crypto.randomUUID(),
          requestId: `event-${crypto.randomUUID()}`,
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: event,
        }),
      );
    }
  }

  private async loadMachine(): Promise<AgentSessionMachine | null> {
    if (this.machine) return this.machine;
    const stored =
      await this.state.storage.get<PersistedAgentSessionState>(
        SESSION_STATE_KEY,
      );
    if (!stored) return null;
    this.machine = AgentSessionMachine.restore(stored, () =>
      crypto.randomUUID(),
    );
    return this.machine;
  }

  private async initialize(): Promise<void> {
    const stored =
      await this.state.storage.get<PersistedAgentSessionState>(
        SESSION_STATE_KEY,
      );
    if (stored) {
      this.machine = AgentSessionMachine.restore(stored, () =>
        crypto.randomUUID(),
      );
    }
  }

  private async persist(): Promise<void> {
    if (!this.machine) return;
    const status = this.machine.statusAt(Date.now());
    if (status === "revoked" || status === "expired") {
      await this.state.storage.deleteAll?.();
      return;
    }
    await this.state.storage.put(SESSION_STATE_KEY, this.machine.serialize());
  }
}
