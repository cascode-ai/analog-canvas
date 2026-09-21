import { useCallback, useEffect, useRef, useState } from "react";

import {
  AGENT_API_VERSION,
  AGENT_FILE_RESOURCE_MAX_BYTES,
  AGENT_SESSION_PROTOCOL_VERSION,
  AGENT_SIMULATION_MAX_TIMEOUT_MS,
  AgentSessionEventSchema,
  AgentSessionMessageSchema,
  AgentSessionScopeSchema,
  parseAgentFileResourceRequest,
  parseAgentSimulationResourceRequest,
  parseAgentProjectResourceRequest,
  createAgentCircuitService,
  parseAgentCircuitRequest,
  type AgentOperationHost,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentPermissions,
  type AgentSessionScope,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import { sha256Hex } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import { ArtifactDownloadError } from "@icm/simulation-service/files";

import type { AgentConnectionStatus } from "./connect-agent-panel";
import { transitionAgentSession } from "./agent-session-state-machine";
import {
  clearAgentSessionRecovery,
  readAgentSessionRecovery,
  writeAgentSessionRecovery,
  type AgentSessionRecoveryRecord,
} from "./session-recovery";
import { createHeartbeat, isHeartbeatAck } from "./transport-liveness";
import {
  SessionTransport,
  type TransportDiagnostic,
} from "./session-transport";

interface CreatedSessionResponse {
  ok: true;
  session: {
    sessionId: string;
    editorSecret: string;
    claimCode: string;
    claimExpiresAt: number;
    expiresAt: number;
  };
}

function isCreatedSessionResponse(
  value: unknown,
): value is CreatedSessionResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { ok?: unknown; session?: unknown };
  if (
    candidate.ok !== true ||
    typeof candidate.session !== "object" ||
    candidate.session === null
  ) {
    return false;
  }
  const session = candidate.session as Record<string, unknown>;
  return (
    typeof session.sessionId === "string" &&
    typeof session.editorSecret === "string" &&
    typeof session.claimCode === "string" &&
    typeof session.claimExpiresAt === "number" &&
    typeof session.expiresAt === "number"
  );
}

type LiveSession = {
  projectId: string;
  documentIds: () => string[];
  sessionId: string;
  editorSecret: string;
  claimCode: string | null;
  claimExpiresAt: number | null;
  expiresAt: number;
  scopes: AgentSessionScope[];
  socket: WebSocket | null;
  claimed: boolean;
  paused: boolean;
  allowReconnect: boolean;
  transport?: SessionTransport;
  requestCache: Map<
    string,
    { payloadHash: string; response: unknown; byteLength: number }
  >;
  requestCacheBytes: number;
  requestHashes: Map<string, string>;
};

const BROWSER_CACHE_MAX_ENTRIES = 32;
const BROWSER_CACHE_MAX_BYTES = 16_000_000;
function sendHeartbeat(
  live: LiveSession,
  socket: WebSocket,
  nonce: string = crypto.randomUUID(),
): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  let documentIds: string[];
  try {
    documentIds = live.documentIds();
  } catch {
    return;
  } // A replaced Project invalidates the bound host; its effect closes the socket.
  socket.send(
    JSON.stringify({
      ...createHeartbeat(live.sessionId, nonce),
      projectId: live.projectId,
      documentIds,
    }),
  );
}

function stopReconnect(live: LiveSession): void {
  live.allowReconnect = false;
  live.transport?.stop();
}

export interface AgentSessionViewModel {
  status: AgentConnectionStatus;
  claimCode: string | null;
  claimExpiresAt: number | null;
  scopes: readonly AgentSessionScope[];
  expiresAt: number | null;
  error: string | null;
}

export interface UseAgentSessionOptions {
  /**
   * Disables all browser-side Agent lifecycle work.  This is deliberately a
   * UI/host switch, not an API gate: MCP and loopback deployments remain
   * independently available.
   */
  enabled: boolean;
  recover?: boolean;
  beforeConnect?: () => Promise<void>;
  project: CircuitProject;
  projectSessionId: string;
  host: AgentOperationHost;
  fileHost?: {
    setArtifactPublisher?: (
      publisher: (ref: ArtifactRef, text: string) => Promise<string>,
    ) => void;
    handle: (
      request: AgentFileResourceRequest,
    ) => Promise<AgentFileResourceResponse>;
    clear?: () => void;
  };
  /** Session-owned prepared inputs and run receipts; revoked with the session. */
  simulationHost?: {
    clear?: () => Promise<void>;
    handle: (
      request: AgentSimulationResourceRequest,
    ) => Promise<AgentSimulationResourceResponse>;
  };
  projectHost?: {
    handle: (
      request: AgentProjectResourceRequest,
    ) => Promise<AgentProjectResourceResponse>;
  };
}

export interface UseAgentSessionResult extends AgentSessionViewModel {
  /** Bounded local diagnostics; no credentials, payloads or Project contents. */
  transportDiagnostics: readonly TransportDiagnostic[];
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  reconnect: () => void;
  newConnection: () => Promise<void>;
  revoke: () => Promise<void>;
}

function permissionsFromScopes(
  scopes: readonly AgentSessionScope[],
): AgentPermissions {
  return {
    snapshot: scopes.includes("circuit.snapshot"),
    render: scopes.includes("circuit.render"),
    sourceSpans: scopes.includes("circuit.source-spans"),
    semanticControl: scopes.includes("editor.semantic-control"),
    edit: {
      geometry: scopes.includes("circuit.edit.geometry"),
      connectivity: scopes.includes("circuit.edit.connectivity"),
      presentation: scopes.includes("circuit.edit.presentation"),
    },
  };
}

function socketUrl(sessionId: string): string {
  const url = new URL(
    `/api/agent/sessions/${sessionId}/editor`,
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function useAgentSession(
  options: UseAgentSessionOptions,
): UseAgentSessionResult {
  const liveRef = useRef<LiveSession | null>(null);
  const creatingConnectionRef = useRef(false);
  const recoveryAttemptedForProjectRef = useRef<string | null>(null);
  const projectSessionRef = useRef(options.projectSessionId);
  const revisionRef = useRef(
    new Map(
      options.project.documents.map((document) => [
        document.id,
        document.revision,
      ]),
    ),
  );
  const agentRevisionRef = useRef(new Map<string, number>());
  const [view, setView] = useState<AgentSessionViewModel>(() => {
    const recovery =
      options.recover === false || typeof window === "undefined"
        ? null
        : readAgentSessionRecovery(window.sessionStorage, {
            projectId: options.project.id,
            projectSessionId: options.projectSessionId,
            now: Date.now(),
          });
    return {
      // Recovery itself starts in an effect, but the toolbar can be clicked
      // before that effect runs. Publish the pending state synchronously so
      // an immediate click opens the existing session instead of creating a
      // duplicate one.
      status: recovery ? "reconnecting" : "idle",
      claimCode: null,
      claimExpiresAt: null,
      scopes: recovery?.scopes ?? [],
      expiresAt: recovery?.expiresAt ?? null,
      error: null,
    };
  });

  const update = useCallback((next: Partial<AgentSessionViewModel>) => {
    setView((previous) => ({
      ...previous,
      ...next,
      status:
        next.status === undefined
          ? previous.status
          : transitionAgentSession(previous.status, next.status),
    }));
  }, []);

  const control = useCallback(
    async (action: "pause" | "resume" | "revoke" | "replace-project") => {
      if (!options.enabled) return;
      const live = liveRef.current;
      if (!live) return;
      const response = await fetch(
        `/api/agent/sessions/${live.sessionId}/control`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-editor-secret": live.editorSecret,
          },
          body: JSON.stringify({ action }),
        },
      );
      if (!response.ok)
        throw new Error(`Session control failed (${response.status})`);
    },
    [options.enabled],
  );

  const revoke = useCallback(async () => {
    if (!options.enabled) return;
    const live = liveRef.current;
    if (!live) {
      clearAgentSessionRecovery(window.sessionStorage);
      update({ status: "idle", claimCode: null, claimExpiresAt: null });
      return;
    }
    stopReconnect(live);
    clearAgentSessionRecovery(window.sessionStorage);
    options.fileHost?.clear?.();
    void options.simulationHost?.clear?.();
    try {
      await control("revoke");
    } catch {
      // Local revocation remains terminal even when the relay is unreachable.
    }
    live.socket?.close(1000, "revoked");
    liveRef.current = null;
    update({
      status: "revoked",
      claimCode: null,
      claimExpiresAt: null,
      error: null,
    });
  }, [control, options.enabled, options.fileHost, update]);

  const grant = useCallback(
    async (
      scopes: readonly AgentSessionScope[],
      recovery?: AgentSessionRecoveryRecord,
    ) => {
      if (!options.enabled) return;
      if (liveRef.current) await revoke();
      update({
        status: recovery ? "reconnecting" : "creating",
        error: null,
        claimCode: null,
        claimExpiresAt: null,
        scopes,
      });
      try {
        let created: CreatedSessionResponse | null = null;
        if (!recovery) {
          const response = await fetch("/api/agent/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectSessionId: options.projectSessionId,
              projectId: options.project.id,
              documentIds: options.project.documents.map(
                (document) => document.id,
              ),
              scopes,
            }),
          });
          if (!response.ok) {
            const failure = await response.json().catch(() => null);
            const detail = failure?.error?.message;
            throw new Error(
              typeof detail === "string"
                ? `${detail} (${response.status})`
                : response.status === 404
                  ? "Agent connection service was not found (404). For local use, restart pnpm dev and retry."
                  : `Could not create an Agent connection (${response.status}). Please retry.`,
            );
          }
          const payload: unknown = await response.json();
          if (!isCreatedSessionResponse(payload)) {
            throw new Error("Session creation returned an invalid response");
          }
          created = payload;
        }
        const live: LiveSession = {
          projectId: options.project.id,
          documentIds: () =>
            (options.host.getProject?.() ?? options.project).documents.map(
              (document) => document.id,
            ),
          sessionId: recovery?.sessionId ?? created!.session.sessionId,
          editorSecret: recovery?.editorSecret ?? created!.session.editorSecret,
          claimCode: recovery ? null : created!.session.claimCode,
          claimExpiresAt: recovery ? null : created!.session.claimExpiresAt,
          expiresAt: recovery?.expiresAt ?? created!.session.expiresAt,
          scopes: [...scopes],
          socket: null,
          claimed: recovery !== undefined,
          paused: false,
          allowReconnect: true,
          requestCache: new Map(),
          requestCacheBytes: 0,
          requestHashes: new Map(),
        };
        liveRef.current = live;
        options.fileHost?.setArtifactPublisher?.(async (ref, text) => {
          if (liveRef.current !== live) throw new Error("Session changed");
          const path = `/api/agent/sessions/${encodeURIComponent(live.sessionId)}/artifacts/${encodeURIComponent(ref.fileId ?? ref.id)}`;
          const response = await fetch(path, {
            method: "PUT",
            headers: {
              "x-editor-secret": live.editorSecret,
              "x-artifact-ref": encodeURIComponent(JSON.stringify(ref)),
            },
            body: new Blob([text], { type: ref.mediaType }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as {
              error?: { code?: string };
            } | null;
            throw new ArtifactDownloadError(
              typeof body?.error?.code === "string"
                ? body.error.code
                : "ARTIFACT_UPLOAD_FAILED",
              response.status === 401
                ? "reauthorize"
                : response.status === 413 || response.status === 409
                  ? "not-retryable"
                  : "retry-after",
              `Artifact transfer rejected (HTTP ${response.status}); original browser evidence is unchanged`,
            );
          }
          if (liveRef.current !== live)
            throw new ArtifactDownloadError(
              "SESSION_CHANGED",
              "reauthorize",
              "The download session changed",
            );
          return path;
        });

        const syncDeadline = (expiresAt: number) => {
          live.expiresAt = expiresAt;
          update({ expiresAt });
          if (live.claimed) {
            writeAgentSessionRecovery(window.sessionStorage, {
              version: 1,
              sessionId: live.sessionId,
              editorSecret: live.editorSecret,
              projectId: options.project.id,
              projectSessionId: options.projectSessionId,
              scopes: live.scopes,
              expiresAt,
            });
          }
        };
        const service = createAgentCircuitService({
          agentId: `web-agent:${live.sessionId}`,
          host: options.host,
          permissions: permissionsFromScopes(scopes),
          ...(options.fileHost
            ? {
                fileResource: {
                  path: "/api/agent/sessions/{sessionId}/files" as const,
                  operations: [
                    "download",
                    "stage",
                    "inspect",
                    "discard",
                    "request-approval",
                    "simulation-input",
                  ] as const,
                  maxBytes: AGENT_FILE_RESOURCE_MAX_BYTES,
                  humanApprovalOperations: ["request-approval"] as const,
                },
                ...(options.simulationHost
                  ? {
                      simulationResource: {
                        path: "/api/agent/sessions/{sessionId}/simulation" as const,
                        operations: [
                          "capabilities",
                          "prepare",
                          "start",
                          "read",
                          "cancel",
                          "export",
                          "prepare-batch",
                          "start-batch",
                          "read-batch",
                          "cancel-batch",
                          "prepare-sweep",
                        ] as const,
                        analyses: ["op", "dc", "ac", "tran", "noise"] as const,
                        maxTimeoutMs: AGENT_SIMULATION_MAX_TIMEOUT_MS,
                        synchronous: false as const,
                      },
                    }
                  : {}),
                ...(options.projectHost
                  ? {
                      projectResource: {
                        path: "/api/agent/sessions/{sessionId}/projects" as const,
                        operations: [
                          "list-projects",
                          "list-cells",
                          "import-cell",
                          "list-gallery",
                          "read-gallery-entry",
                          "read-gallery-entries",
                          "read-project-code",
                          "replace-project-code",
                          "read-netlist",
                          "replace-netlist",
                        ] as const,
                        importMode: "project-local-copy" as const,
                      },
                    }
                  : {}),
              }
            : {}),
        });
        const bind = (socket: WebSocket) => {
          live.socket = socket;
          socket.addEventListener("message", (event) => {
            if (
              liveRef.current !== live ||
              live.socket !== socket ||
              !live.allowReconnect
            )
              return;
            let raw: unknown;
            try {
              raw = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (isHeartbeatAck(raw, live.sessionId)) {
              transport.received((raw as { nonce: string }).nonce);
              return;
            }
            const parsed = AgentSessionMessageSchema.safeParse(raw);
            if (!parsed.success || parsed.data.sessionId !== live.sessionId)
              return;
            transport.received();
            if (parsed.data.kind === "event") {
              const sessionEvent = AgentSessionEventSchema.safeParse(
                parsed.data.payload,
              );
              if (
                sessionEvent.success &&
                sessionEvent.data.type === "session.ready"
              ) {
                live.claimed = true;
                live.paused = false;
                syncDeadline(
                  sessionEvent.data.expiresAt
                    ? Date.parse(sessionEvent.data.expiresAt)
                    : live.expiresAt,
                );
                update({ status: "connected" });
              } else if (
                sessionEvent.success &&
                (sessionEvent.data.type === "session.renewed" ||
                  sessionEvent.data.type === "session.expiring")
              ) {
                syncDeadline(Date.parse(sessionEvent.data.expiresAt));
              } else if (
                sessionEvent.success &&
                (sessionEvent.data.type === "session.revoked" ||
                  sessionEvent.data.type === "session.expired")
              ) {
                stopReconnect(live);
                clearAgentSessionRecovery(window.sessionStorage);
                options.fileHost?.clear?.();
                void options.simulationHost?.clear?.();
                socket.close(1000, "session revoked");
                if (liveRef.current === live) liveRef.current = null;
                update({
                  status:
                    sessionEvent.data.type === "session.expired"
                      ? "expired"
                      : "revoked",
                  claimCode: null,
                  claimExpiresAt: null,
                });
              } else if (
                sessionEvent.success &&
                sessionEvent.data.type === "session.paused"
              ) {
                live.paused = true;
                update({ status: "paused" });
              }
              return;
            }
            if (parsed.data.kind === "file-request") {
              const fileRequest = parseAgentFileResourceRequest(
                parsed.data.payload,
              );
              const payloadHash = sha256Hex(
                JSON.stringify(parsed.data.payload),
              );
              const knownHash = live.requestHashes.get(parsed.data.requestId);
              const sendFileResponse = (payload: unknown) => {
                if (socket.readyState !== WebSocket.OPEN) return;
                socket.send(
                  JSON.stringify({
                    protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
                    sessionId: live.sessionId,
                    messageId: crypto.randomUUID(),
                    requestId: parsed.data.requestId,
                    sentAt: new Date().toISOString(),
                    kind: "file-response",
                    payload,
                  }),
                );
              };
              if (!fileRequest.success || !options.fileHost) {
                sendFileResponse({
                  apiVersion: AGENT_API_VERSION,
                  requestId: parsed.data.requestId,
                  operation: "error",
                  ok: false,
                  error: {
                    code: fileRequest.success
                      ? "FILE_HOST_UNAVAILABLE"
                      : "FILE_REQUEST_INVALID",
                    message: fileRequest.success
                      ? "The File host is not available; retry after reconnecting"
                      : "The File request does not match the current contract; read capabilities and correct the request",
                  },
                });
                return;
              }
              if (knownHash) {
                sendFileResponse({
                  apiVersion: AGENT_API_VERSION,
                  requestId: parsed.data.requestId,
                  operation: fileRequest.data.operation,
                  ok: false,
                  error: {
                    code:
                      knownHash === payloadHash
                        ? "REQUEST_RESULT_UNAVAILABLE"
                        : "REQUEST_ID_REUSED",
                    message:
                      knownHash === payloadHash
                        ? "The request was already executed without a browser-side replay cache"
                        : "requestId was reused with a different payload",
                  },
                });
                return;
              }
              live.requestHashes.set(parsed.data.requestId, payloadHash);
              update({ status: "working" });
              void options.fileHost
                .handle(fileRequest.data)
                .then(sendFileResponse)
                .catch(() =>
                  sendFileResponse({
                    apiVersion: AGENT_API_VERSION,
                    requestId: parsed.data.requestId,
                    operation: fileRequest.data.operation,
                    ok: false,
                    error: {
                      code: "FILE_HOST_ERROR",
                      message:
                        "The File operation failed without revoking the session; inspect current state before retrying",
                    },
                  }),
                )
                .finally(() => {
                  if (liveRef.current === live)
                    update({ status: live.paused ? "paused" : "connected" });
                });
              return;
            }
            if (parsed.data.kind === "simulation-request") {
              const simulationRequest = parseAgentSimulationResourceRequest(
                parsed.data.payload,
              );
              const payloadHash = sha256Hex(
                JSON.stringify(parsed.data.payload),
              );
              const knownHash = live.requestHashes.get(parsed.data.requestId);
              const sendSimulationResponse = (payload: unknown) => {
                if (socket.readyState !== WebSocket.OPEN) return;
                socket.send(
                  JSON.stringify({
                    protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
                    sessionId: live.sessionId,
                    messageId: crypto.randomUUID(),
                    requestId: parsed.data.requestId,
                    sentAt: new Date().toISOString(),
                    kind: "simulation-response",
                    payload,
                  }),
                );
              };
              if (!simulationRequest.success || !options.simulationHost) {
                sendSimulationResponse({
                  apiVersion: AGENT_API_VERSION,
                  requestId: parsed.data.requestId,
                  operation: "error",
                  ok: false,
                  error: {
                    code: simulationRequest.success
                      ? "SIMULATION_HOST_UNAVAILABLE"
                      : "SIMULATION_REQUEST_INVALID",
                    message: simulationRequest.success
                      ? "The simulation host is not available; retry after reconnecting"
                      : "The simulation request does not match the current contract; read capabilities and correct the request",
                    stage: "input",
                    recovery: simulationRequest.success
                      ? "retry-after"
                      : "fix-input",
                  },
                });
                return;
              }
              if (knownHash && knownHash !== payloadHash) {
                sendSimulationResponse({
                  apiVersion: AGENT_API_VERSION,
                  requestId: parsed.data.requestId,
                  operation: simulationRequest.data.operation,
                  ok: false,
                  error: {
                    code: "REQUEST_ID_REUSED",
                    message: "Use the same payload for a retry",
                    stage: "input",
                    recovery: "fix-input",
                  },
                });
                return;
              }
              live.requestHashes.set(parsed.data.requestId, payloadHash);
              update({ status: "working" });
              void options.simulationHost
                .handle(simulationRequest.data)
                .then(sendSimulationResponse)
                .catch(() =>
                  sendSimulationResponse({
                    apiVersion: AGENT_API_VERSION,
                    requestId: parsed.data.requestId,
                    operation: simulationRequest.data.operation,
                    ok: false,
                    error: {
                      code: "SIMULATION_HOST_ERROR",
                      message:
                        "The operation failed without revoking the session",
                      stage: "read",
                      recovery: "retry-after",
                    },
                  }),
                )
                .finally(() => {
                  if (liveRef.current === live)
                    update({ status: live.paused ? "paused" : "connected" });
                });
              return;
            }
            if (parsed.data.kind === "project-request") {
              const projectRequest = parseAgentProjectResourceRequest(
                parsed.data.payload,
              );
              if (!projectRequest.success || !options.projectHost) return;
              const payloadHash = sha256Hex(
                JSON.stringify(parsed.data.payload),
              );
              const knownHash = live.requestHashes.get(parsed.data.requestId);
              const sendProjectResponse = (payload: unknown) => {
                if (socket.readyState !== WebSocket.OPEN) return;
                socket.send(
                  JSON.stringify({
                    protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
                    sessionId: live.sessionId,
                    messageId: crypto.randomUUID(),
                    requestId: parsed.data.requestId,
                    sentAt: new Date().toISOString(),
                    kind: "project-response",
                    payload,
                  }),
                );
              };
              if (knownHash) {
                sendProjectResponse({
                  apiVersion: AGENT_API_VERSION,
                  requestId: parsed.data.requestId,
                  operation: projectRequest.data.operation,
                  ok: false,
                  error: {
                    code:
                      knownHash === payloadHash
                        ? "REQUEST_RESULT_UNAVAILABLE"
                        : "REQUEST_ID_REUSED",
                    message:
                      knownHash === payloadHash
                        ? "The request already completed without a browser replay cache"
                        : "requestId was reused with a different payload",
                    recovery:
                      knownHash === payloadHash ? "refresh" : "fix-input",
                  },
                });
                return;
              }
              live.requestHashes.set(parsed.data.requestId, payloadHash);
              update({ status: "working" });
              void options.projectHost
                .handle(projectRequest.data)
                .then(sendProjectResponse)
                .catch(() =>
                  sendProjectResponse({
                    apiVersion: AGENT_API_VERSION,
                    requestId: parsed.data.requestId,
                    operation: projectRequest.data.operation,
                    ok: false,
                    error: {
                      code: "PROJECT_HOST_ERROR",
                      message:
                        "The operation failed without revoking the Agent session",
                      recovery: "retry",
                    },
                  }),
                )
                .finally(() => {
                  if (liveRef.current === live)
                    update({ status: live.paused ? "paused" : "connected" });
                });
              return;
            }
            if (parsed.data.kind !== "circuit-request") return;
            const circuitRequest = parseAgentCircuitRequest(
              parsed.data.payload,
            );
            const payloadKey = JSON.stringify(parsed.data.payload);
            const payloadHash = sha256Hex(payloadKey);
            const cached = live.requestCache.get(parsed.data.requestId);
            const sendResponse = (payload: unknown) => {
              socket.send(
                JSON.stringify({
                  protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
                  sessionId: live.sessionId,
                  messageId: crypto.randomUUID(),
                  requestId: parsed.data.requestId,
                  sentAt: new Date().toISOString(),
                  kind: "circuit-response",
                  payload,
                }),
              );
            };
            const sendRequestError = (
              code: "REQUEST_ID_REUSED" | "REQUEST_RESULT_UNAVAILABLE",
              message: string,
            ) => {
              const candidate = parsed.data.payload as {
                apiVersion?: unknown;
                operation?: unknown;
              };
              sendResponse({
                apiVersion: AGENT_API_VERSION,
                requestId: parsed.data.requestId,
                operation:
                  typeof candidate.operation === "string" &&
                  ["snapshot", "transact", "render"].includes(
                    candidate.operation,
                  )
                    ? candidate.operation
                    : "error",
                ok: false,
                error: { code, message },
                diagnostics: [],
              });
            };
            if (cached) {
              if (cached.payloadHash === payloadHash) {
                sendResponse(cached.response);
              } else {
                sendRequestError(
                  "REQUEST_ID_REUSED",
                  "requestId was reused with a different payload",
                );
              }
              return;
            }
            const knownHash = live.requestHashes.get(parsed.data.requestId);
            if (knownHash) {
              sendRequestError(
                knownHash === payloadHash
                  ? "REQUEST_RESULT_UNAVAILABLE"
                  : "REQUEST_ID_REUSED",
                knownHash === payloadHash
                  ? "The request was already executed but its cached result was evicted"
                  : "requestId was reused with a different payload",
              );
              return;
            }
            live.requestHashes.set(parsed.data.requestId, payloadHash);
            update({ status: "working" });
            // The relay already rejects malformed public payloads, but the
            // browser host repeats that same strict parse before it can touch
            // the live Project.
            const result = service.handle(parsed.data.payload);
            const responseBytes = new TextEncoder().encode(
              JSON.stringify(result),
            ).byteLength;
            if (responseBytes <= BROWSER_CACHE_MAX_BYTES) {
              live.requestCache.set(parsed.data.requestId, {
                payloadHash,
                response: result,
                byteLength: responseBytes,
              });
              live.requestCacheBytes += responseBytes;
            }
            while (
              live.requestCache.size > BROWSER_CACHE_MAX_ENTRIES ||
              live.requestCacheBytes > BROWSER_CACHE_MAX_BYTES
            ) {
              const oldest = live.requestCache.keys().next().value;
              if (oldest === undefined) break;
              const entry = live.requestCache.get(oldest);
              live.requestCache.delete(oldest);
              live.requestCacheBytes -= entry?.byteLength ?? 0;
            }
            if (
              result.ok &&
              result.operation === "transact" &&
              result.applied &&
              result.projectStructure
            )
              sendHeartbeat(live, socket);
            sendResponse(result);
            if (
              result.ok &&
              result.operation === "transact" &&
              result.applied &&
              circuitRequest.success &&
              circuitRequest.data.operation === "transact"
            ) {
              agentRevisionRef.current.set(
                circuitRequest.data.documentId,
                result.revision,
              );
              socket.send(
                JSON.stringify({
                  protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
                  sessionId: live.sessionId,
                  messageId: crypto.randomUUID(),
                  requestId: parsed.data.requestId,
                  sentAt: new Date().toISOString(),
                  kind: "event",
                  payload: {
                    type: "document.revision-changed",
                    sessionId: live.sessionId,
                    documentId: circuitRequest.data.documentId,
                    revision: result.revision,
                    actorKind: "agent",
                    requestId: parsed.data.requestId,
                    changedObjectIds: [...result.diff.changedObjectIds],
                  },
                }),
              );
            }
            if (liveRef.current === live)
              update({ status: live.paused ? "paused" : "connected" });
          });
        };
        const transport = new SessionTransport({
          visibility: () => document.visibilityState,
          createSocket: () =>
            new WebSocket(socketUrl(live.sessionId), [
              "icm-agent-session",
              live.editorSecret,
            ]),
          sendHeartbeat: (socket, nonce) => sendHeartbeat(live, socket, nonce),
          needsAuthorizationCheck: () => Date.now() >= live.expiresAt,
          checkAuthorization: async () => {
            const response = await fetch(
              `/api/agent/sessions/${encodeURIComponent(live.sessionId)}/status`,
              {
                headers: { "x-editor-secret": live.editorSecret },
                signal: AbortSignal.timeout(5_000),
              },
            );
            const result = await response.json();
            if (liveRef.current !== live || !live.allowReconnect) return false;
            if (response.ok && result.ok && Number.isFinite(result.expiresAt)) {
              live.paused = result.authorization === "paused";
              syncDeadline(result.expiresAt);
              return true;
            }
            if (
              [
                "SESSION_EXPIRED",
                "SESSION_REVOKED",
                "SESSION_NOT_FOUND",
                "PROJECT_REPLACED",
                "TOKEN_INVALID",
              ].includes(result.error?.code)
            ) {
              stopReconnect(live);
              clearAgentSessionRecovery(window.sessionStorage);
              options.fileHost?.clear?.();
              void options.simulationHost?.clear?.();
              liveRef.current = null;
              update({
                status:
                  result.error.code === "SESSION_EXPIRED"
                    ? "expired"
                    : "revoked",
                claimCode: null,
                claimExpiresAt: null,
              });
            }
            return false;
          },
          reconnecting: () => update({ status: "reconnecting" }),
          opened: () => {
            update({
              status: live.paused
                ? "paused"
                : live.claimed
                  ? "connected"
                  : "waiting-for-agent",
              claimCode: live.claimCode,
              claimExpiresAt: live.claimExpiresAt,
              scopes,
              expiresAt: live.expiresAt,
              error: null,
            });
          },
          bind,
        });
        live.transport = transport;
        void transport.connect();
      } catch (error) {
        liveRef.current = null;
        // Setup/network failures are not proof of revocation. Authoritative
        // expired/revoked events clear the same-tab recovery credential.
        update({
          status: "idle",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      options.fileHost,
      options.simulationHost,
      options.enabled,
      options.host,
      options.project,
      options.projectSessionId,
      revoke,
      update,
    ],
  );

  useEffect(() => {
    if (options.recover === false) return;
    if (!options.enabled) return;
    if (recoveryAttemptedForProjectRef.current === options.projectSessionId) {
      return;
    }
    // Wait for effect setup to survive StrictMode's setup/cleanup replay.
    // Otherwise cleanup closes the recovering socket before the second setup.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      recoveryAttemptedForProjectRef.current = options.projectSessionId;
      const recovery = readAgentSessionRecovery(window.sessionStorage, {
        projectId: options.project.id,
        projectSessionId: options.projectSessionId,
        now: Date.now(),
      });
      if (recovery) void grant(recovery.scopes, recovery);
    });
    return () => {
      cancelled = true;
    };
  }, [
    grant,
    options.enabled,
    options.recover,
    options.project.id,
    options.projectSessionId,
  ]);

  const pause = useCallback(async () => {
    if (!options.enabled) return;
    try {
      await control("pause");
      if (liveRef.current) liveRef.current.paused = true;
      update({ status: "paused", error: null });
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [control, options.enabled, update]);

  const resume = useCallback(async () => {
    if (!options.enabled) return;
    try {
      await control("resume");
      if (liveRef.current) liveRef.current.paused = false;
      update({
        status: liveRef.current?.claimed ? "connected" : "waiting-for-agent",
        error: null,
      });
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [control, options.enabled, update]);

  const reconnect = useCallback(() => {
    if (!options.enabled) return;
    const live = liveRef.current;
    if (!live || !live.allowReconnect) return;
    live.transport?.wake();
  }, [options.enabled, update]);

  useEffect(() => {
    if (!options.enabled) return;
    const wakeTransport = () => {
      const live = liveRef.current;
      if (live?.allowReconnect) live.transport?.wake();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wakeTransport();
    };
    window.addEventListener("online", wakeTransport);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("resume", wakeTransport);
    return () => {
      window.removeEventListener("online", wakeTransport);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("resume", wakeTransport);
    };
  }, [options.enabled, update]);

  const newConnection = useCallback(async () => {
    if (!options.enabled || creatingConnectionRef.current) return;
    creatingConnectionRef.current = true;
    try {
      await options.beforeConnect?.();
      // Connecting grants the complete editor capability set. Recovery above
      // resumes the original session; a new connection always gets full edit.
      await grant(AgentSessionScopeSchema.options);
    } finally {
      creatingConnectionRef.current = false;
    }
  }, [grant, options.enabled, options.beforeConnect]);

  useEffect(() => {
    if (!options.enabled) return;
    if (projectSessionRef.current !== options.projectSessionId) return;
    const live = liveRef.current;
    const ids = new Set(
      options.project.documents.map((document) => document.id),
    );
    const rosterChanged =
      ids.size !== revisionRef.current.size ||
      [...ids].some((id) => !revisionRef.current.has(id));
    if (rosterChanged && live?.socket?.readyState === WebSocket.OPEN)
      sendHeartbeat(live, live.socket);
    for (const id of revisionRef.current.keys())
      if (!ids.has(id)) revisionRef.current.delete(id);
    for (const document of options.project.documents) {
      const previousRevision = revisionRef.current.get(document.id);
      revisionRef.current.set(document.id, document.revision);
      if (
        previousRevision === undefined ||
        previousRevision === document.revision ||
        !live?.socket ||
        live.socket.readyState !== WebSocket.OPEN
      ) {
        continue;
      }
      if (agentRevisionRef.current.get(document.id) === document.revision) {
        agentRevisionRef.current.delete(document.id);
        continue;
      }
      live.socket.send(
        JSON.stringify({
          protocolVersion: AGENT_SESSION_PROTOCOL_VERSION,
          sessionId: live.sessionId,
          messageId: crypto.randomUUID(),
          requestId: `human-revision-${document.id}-${document.revision}`,
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: {
            type: "document.revision-changed",
            sessionId: live.sessionId,
            documentId: document.id,
            revision: document.revision,
            actorKind: "human",
            changedObjectIds: [],
          },
        }),
      );
    }
  }, [options.enabled, options.project, options.projectSessionId]);

  useEffect(() => {
    if (!options.enabled) return;
    if (projectSessionRef.current === options.projectSessionId) return;
    projectSessionRef.current = options.projectSessionId;
    recoveryAttemptedForProjectRef.current = options.projectSessionId;
    revisionRef.current = new Map(
      options.project.documents.map((document) => [
        document.id,
        document.revision,
      ]),
    );
    agentRevisionRef.current.clear();
    clearAgentSessionRecovery(window.sessionStorage);
    options.fileHost?.clear?.();
    void options.simulationHost?.clear?.();
    const live = liveRef.current;
    if (!live) return;
    stopReconnect(live);
    void control("replace-project").finally(() => {
      live.socket?.close(1000, "project replaced");
      liveRef.current = null;
      update({ status: "revoked", claimCode: null, claimExpiresAt: null });
    });
  }, [
    control,
    options.enabled,
    options.fileHost,
    options.project,
    options.projectSessionId,
    update,
  ]);

  useEffect(() => {
    if (!options.enabled) return;
    const timer = window.setInterval(() => {
      const live = liveRef.current;
      if (
        live &&
        live.claimCode !== null &&
        live.claimExpiresAt !== null &&
        Date.now() >= live.claimExpiresAt
      ) {
        const claimExpiresAt = live.claimExpiresAt;
        live.claimCode = null;
        live.claimExpiresAt = null;
        update({ claimCode: null, claimExpiresAt });
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [options.enabled, options.fileHost, update]);

  useEffect(
    () => () => {
      if (!options.enabled) return;
      const live = liveRef.current;
      options.fileHost?.clear?.();
      void options.simulationHost?.clear?.();
      if (live) {
        stopReconnect(live);
        if (!live.claimed) {
          clearAgentSessionRecovery(window.sessionStorage);
          void fetch(`/api/agent/sessions/${live.sessionId}`, {
            method: "DELETE",
            headers: { "x-editor-secret": live.editorSecret },
            keepalive: true,
          });
        }
        live.socket?.close(1000, "tab closed");
      }
    },
    [options.enabled, options.fileHost],
  );

  return {
    ...view,
    transportDiagnostics: liveRef.current?.transport?.diagnostics ?? [],
    pause,
    resume,
    reconnect,
    newConnection,
    revoke,
  };
}
