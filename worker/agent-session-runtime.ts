import {
  AgentClaimRequestSchema,
  AgentConnectorResumeRequestSchema,
  DEFAULT_AGENT_SESSION_LIMITS,
  AgentSessionMachine,
  AgentTransportErrorResponseSchema,
  agentEditCategory,
  agentCircuitOpenApi,
  agentMcpBootstrapManifest,
  agentTransportErrorMessage,
  agentTransportErrorStatus,
  type AgentCircuitRequest,
  type AgentFileResourceRequest,
  type AgentSessionLimits,
  type AgentSessionScope,
  type AgentSimulationResourceRequest,
  type AgentProjectResourceRequest,
  type AgentTransportErrorCode,
  type AgentTransportErrorResponse,
} from "@icm/agent-adapter";
import { agentOperatingKit } from "@icm/agent-adapter/kit";
import type { AgentArtifactBucket } from "./agent-artifacts";

export const SESSION_STATE_KEY = "agent-session-v1";
export const EDITOR_SOCKET_TAG = "editor";
export const EDITOR_PROTOCOL = "icm-agent-session";
export const FORWARD_TIMEOUT_MS = 30_000;
/** Simulation start returns a receipt; it uses the ordinary RPC deadline. */
export const SIMULATION_FORWARD_TIMEOUT_MS = FORWARD_TIMEOUT_MS;
export const EXPIRY_WARNING_MS = 60_000;
export const CREATE_BODY_LIMIT = 64_000;
export const CLAIM_BODY_LIMIT = 8_000;
export const CONNECTOR_BODY_LIMIT = 8_000;

export interface AgentRelayConfig {
  allowedOrigin: string | null;
  limits: AgentSessionLimits;
}

export type RelayError = AgentTransportErrorResponse;

export type AgentSessionNamespaceLike = {
  getByName(name: string): {
    fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  };
};

export interface AgentSessionRouterEnv {
  AGENT_SESSION: AgentSessionNamespaceLike;
  AGENT_ALLOWED_ORIGIN?: string;
}

export type DurableStorageLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll?(): Promise<void>;
  setAlarm?(scheduledTime: number): Promise<void>;
};

export type DurableStateLike = {
  storage: DurableStorageLike;
  blockConcurrencyWhile?(callback: () => Promise<void>): void;
  acceptWebSocket?(socket: WebSocket, tags?: string[]): void;
  getWebSockets?(tag?: string): WebSocket[];
};

export type AgentSessionEnv = {
  AGENT_ALLOWED_ORIGIN?: string;
  SIMULATION_ARTIFACTS?: AgentArtifactBucket;
};

export type WebSocketPairShape = { 0: WebSocket; 1: WebSocket };
export type WebSocketPairConstructor = new () => WebSocketPairShape;

export type PendingForward = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export function relayHeaders(allowedOrigin: string | null): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  if (allowedOrigin !== null) {
    headers.set("access-control-allow-origin", allowedOrigin);
    headers.set("vary", "Origin");
  }
  return headers;
}

export function requestOriginAllowed(
  request: Request,
  allowedOrigin: string,
): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === allowedOrigin;
}

async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) return { ok: false, tooLarge: true };
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/** Route the public `/api/agent/*` resource surface to one session DO. */
export async function routeAgentSessionRequest(
  request: Request,
  env: AgentSessionRouterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/agent/")) return null;
  const allowedOrigin = env.AGENT_ALLOWED_ORIGIN ?? url.origin;
  if (!requestOriginAllowed(request, allowedOrigin)) {
    return jsonResponse(
      errorBody("UNAUTHORIZED_ORIGIN", errorMessage("UNAUTHORIZED_ORIGIN")),
      403,
      allowedOrigin,
    );
  }
  if (request.method === "OPTIONS") {
    const headers = relayHeaders(allowedOrigin);
    headers.set(
      "access-control-allow-methods",
      "GET, HEAD, PUT, POST, DELETE, OPTIONS",
    );
    headers.set(
      "access-control-allow-headers",
      "authorization, content-type, x-editor-secret, x-artifact-ref, range, if-range",
    );
    return new Response(null, { status: 204, headers });
  }
  if (request.method === "GET" && url.pathname === "/api/agent/openapi.json") {
    return jsonResponse(agentCircuitOpenApi, 200, allowedOrigin);
  }
  if (request.method === "GET" && url.pathname === "/api/agent/kit") {
    return jsonResponse(agentOperatingKit, 200, allowedOrigin);
  }
  if (
    request.method === "GET" &&
    url.pathname === "/api/agent/mcp-manifest.json"
  ) {
    const response = jsonResponse(
      agentMcpBootstrapManifest(url.origin),
      200,
      allowedOrigin,
    );
    response.headers.set("cache-control", "public, max-age=300");
    return response;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/sessions") {
    const parsedBody = await readBoundedJson(request, CREATE_BODY_LIMIT);
    if (!parsedBody.ok) {
      return jsonResponse(
        { error: parsedBody.tooLarge ? "Request too large" : "Invalid JSON" },
        parsedBody.tooLarge ? 413 : 400,
        allowedOrigin,
      );
    }
    const body = parsedBody.value as Record<string, unknown>;
    const sessionId = crypto.randomUUID();
    const response = await env.AGENT_SESSION.getByName(sessionId).fetch(
      "https://agent-session.internal/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, sessionId }),
      },
    );
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      session?: Record<string, unknown> & { claimCode?: unknown };
    } | null;
    if (!response.ok || !result?.session) {
      return jsonResponse(
        result ?? { error: "Session creation failed" },
        response.status,
        allowedOrigin,
      );
    }
    const rawClaim = result.session.claimCode;
    return jsonResponse(
      {
        ...result,
        session: {
          ...result.session,
          claimCode:
            typeof rawClaim === "string"
              ? `${sessionId}.${rawClaim}`
              : rawClaim,
        },
      },
      200,
      allowedOrigin,
    );
  }

  if (request.method === "POST" && url.pathname === "/api/agent/claims") {
    const parsedBody = await readBoundedJson(request, CLAIM_BODY_LIMIT);
    if (!parsedBody.ok) {
      return jsonResponse(
        errorBody(
          parsedBody.tooLarge ? "REQUEST_TOO_LARGE" : "CLAIM_INVALID",
          errorMessage(
            parsedBody.tooLarge ? "REQUEST_TOO_LARGE" : "CLAIM_INVALID",
          ),
        ),
        parsedBody.tooLarge ? 413 : 401,
        allowedOrigin,
      );
    }
    const parsedClaim = AgentClaimRequestSchema.safeParse(parsedBody.value);
    const claimCode = parsedClaim.success ? parsedClaim.data.claimCode : "";
    const separator = claimCode.indexOf(".");
    if (separator <= 0) {
      return jsonResponse(
        errorBody("CLAIM_INVALID", errorMessage("CLAIM_INVALID")),
        401,
        allowedOrigin,
      );
    }
    const sessionId = claimCode.slice(0, separator);
    const code = claimCode.slice(separator + 1);
    return env.AGENT_SESSION.getByName(sessionId).fetch(
      "https://agent-session.internal/claim",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/agent/connectors/resume"
  ) {
    const parsedBody = await readBoundedJson(request, CONNECTOR_BODY_LIMIT);
    if (!parsedBody.ok) {
      return jsonResponse(
        errorBody(
          parsedBody.tooLarge ? "REQUEST_TOO_LARGE" : "CONNECTOR_INVALID",
          errorMessage(
            parsedBody.tooLarge ? "REQUEST_TOO_LARGE" : "CONNECTOR_INVALID",
          ),
        ),
        parsedBody.tooLarge ? 413 : 401,
        allowedOrigin,
      );
    }
    const parsed = AgentConnectorResumeRequestSchema.safeParse(
      parsedBody.value,
    );
    if (!parsed.success) {
      return jsonResponse(
        errorBody("CONNECTOR_INVALID", errorMessage("CONNECTOR_INVALID")),
        401,
        allowedOrigin,
      );
    }
    return env.AGENT_SESSION.getByName(parsed.data.sessionId).fetch(
      "https://agent-session.internal/resume-connector",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectorToken: parsed.data.connectorToken }),
      },
    );
  }

  const match =
    /^\/api\/agent\/sessions\/([^/]+)(?:\/(circuit|files|simulation|projects|events|editor|control|status|artifacts\/[a-zA-Z0-9_-]{1,128}))?$/u.exec(
      url.pathname,
    );
  if (!match) return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
  const [, sessionId, resource] = match;
  const internalPath = resource ? `/${resource}` : "/session";
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };
  if (resource?.startsWith("artifacts/") && request.method === "PUT") {
    init.body = request.body;
    init.duplex = "half";
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await readBoundedText(
      request,
      DEFAULT_AGENT_SESSION_LIMITS.maxRequestBytes,
    );
    if (!body.ok) {
      return jsonResponse(
        errorBody("REQUEST_TOO_LARGE", errorMessage("REQUEST_TOO_LARGE")),
        413,
        allowedOrigin,
      );
    }
    init.body = body.text;
  }
  return env.AGENT_SESSION.getByName(sessionId!).fetch(
    new Request(`https://agent-session.internal${internalPath}`, init),
  );
}

export function jsonResponse(
  body: unknown,
  status = 200,
  allowedOrigin: string | null = null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: relayHeaders(allowedOrigin),
  });
}

export function errorBody(
  code: AgentTransportErrorCode,
  message: string,
): RelayError {
  return AgentTransportErrorResponseSchema.parse({
    ok: false,
    error: { code, message },
  });
}

// Both projections come from the exhaustive transport-error table owned by
// agent-adapter; a new wire code cannot land without stating its status.
export function transportStatus(code: AgentTransportErrorCode): number {
  return agentTransportErrorStatus(code);
}

export function errorMessage(code: AgentTransportErrorCode): string {
  return agentTransportErrorMessage(code);
}

export function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export function editorSecret(request: Request): string {
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim());
  if (protocols[0] === EDITOR_PROTOCOL && protocols[1]) return protocols[1];
  return request.headers.get("x-editor-secret") ?? "";
}

export function operationScopes(
  request: AgentCircuitRequest,
): AgentSessionScope[] {
  switch (request.operation) {
    case "capabilities":
      return [];
    case "snapshot":
      return [
        "circuit.snapshot",
        ...(request.includeSourceSpans
          ? ["circuit.source-spans" as const]
          : []),
      ];
    case "render":
      return ["circuit.render"];
    case "transact":
      if (request.semanticIntent) {
        return ["editor.semantic-control"];
      }
      if (request.wireIntent) {
        return ["circuit.edit.geometry", "circuit.edit.connectivity"];
      }
      return [
        ...new Set(
          (request.edits ?? []).flatMap((edit) => {
            const category = agentEditCategory(edit.kind);
            return category === "unsupported"
              ? []
              : ([`circuit.edit.${category}`] as AgentSessionScope[]);
          }),
        ),
      ];
  }
}

export function fileOperationScopes(
  request: AgentFileResourceRequest,
): AgentSessionScope[] {
  switch (request.operation) {
    case "simulation-input":
      return request.input.action === "update" &&
        request.input.owner.kind === "project-folder"
        ? [
            "simulation.run",
            "project.import",
            ...(request.input.circuitEdits.length
              ? ["circuit.edit.connectivity" as const]
              : []),
          ]
        : ["simulation.run"];
    case "download":
      return [
        request.artifact === "project" ? "project.download" : "visual.download",
      ];
    case "stage":
    case "inspect":
    case "discard":
    case "request-approval":
      return ["project.import"];
  }
}

/**
 * `capabilities` and static `authoring-help` are free: asking
 * what a deployment can do is not doing it, and an Agent that must hold a
 * spending scope merely to discover it has none is being told to guess.
 * Running costs the deployment simulator time, so `run` needs its own grant.
 */
export function simulationOperationScopes(
  request: AgentSimulationResourceRequest,
): AgentSessionScope[] {
  switch (request.operation) {
    case "capabilities":
    case "authoring-help":
      return [];
    case "prepare":
    case "start":
    case "read":
    case "catalog":
    case "cancel":
    case "prepare-batch":
    case "start-batch":
    case "read-batch":
    case "history":
    case "cancel-batch":
    case "prepare-sweep":
    case "export":
      return ["simulation.run"];
  }
}

export function projectOperationScopes(
  request: AgentProjectResourceRequest,
): AgentSessionScope[] {
  switch (request.operation) {
    case "list-gallery":
    case "read-gallery-entry":
    case "read-gallery-entries":
      return ["circuit.snapshot"];
    case "read-project-code":
    case "read-netlist":
      return ["project.download"];
    case "replace-project-code":
      return [
        "circuit.edit.geometry",
        "circuit.edit.connectivity",
        "circuit.edit.presentation",
      ];
    case "replace-netlist":
      return ["circuit.edit.connectivity", "circuit.edit.presentation"];
    case "list-projects":
    case "list-cells":
    case "import-cell":
      return ["project.import"];
  }
}

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function redeemClaimResponse(
  machine: AgentSessionMachine,
  code: string,
  now: number,
):
  | {
      ok: true;
      sessionId: string;
      agentToken: string;
      tokenExpiresAt: number;
      connectorToken: string;
      connectorExpiresAt: number;
      scopes: string[];
      projectId: string;
      documentIds: string[];
    }
  | RelayError {
  const result = machine.redeemClaim(code, now);
  return result.ok
    ? {
        ok: true,
        sessionId: machine.sessionId,
        agentToken: result.claim.agentToken,
        tokenExpiresAt: result.claim.tokenExpiresAt,
        connectorToken: result.claim.connectorToken,
        connectorExpiresAt: result.claim.connectorExpiresAt,
        scopes: [...result.claim.scopes],
        projectId: machine.projectId,
        documentIds: machine.documentIds,
      }
    : errorBody(result.code, errorMessage(result.code));
}

export async function forwardCircuitRequest(
  machine: AgentSessionMachine,
  token: string,
  requestId: string,
  payloadBytes: number,
  payload: unknown,
  now: number,
  forward: (payload: unknown) => Promise<unknown>,
  payloadHash = requestId,
): Promise<{ ok: true; result: unknown } | RelayError> {
  const auth = machine.authorize(token, now);
  if (!auth.ok) return errorBody(auth.code, errorMessage(auth.code));
  const size = machine.checkSize(payloadBytes);
  if (!size.ok) return errorBody(size.code, errorMessage(size.code));
  const begin = machine.beginRequest(requestId, now, payloadHash);
  if (begin.kind === "rejected") {
    return errorBody(begin.code, errorMessage(begin.code));
  }
  if (begin.kind === "cached") return { ok: true, result: begin.result };
  try {
    const result = await forward(payload);
    machine.completeRequest(requestId, result, Date.now());
    return { ok: true, result };
  } catch (error) {
    machine.failRequest(requestId);
    throw error;
  }
}

export function revokeSession(machine: AgentSessionMachine): { ok: true } {
  machine.revoke();
  return { ok: true };
}
