import { useCallback, useEffect, useRef, useState } from "react";

import {
  AGENT_HEARTBEAT_INTERVAL_MS,
  AGENT_API_VERSION,
  AGENT_FILE_RESOURCE_MAX_BYTES,
  AGENT_SESSION_PROTOCOL_VERSION,
  AgentSessionEventSchema,
  AgentSessionMessageSchema,
  parseAgentFileResourceRequest,
  createAgentCircuitService,
  parseAgentCircuitRequest,
  type AgentOperationHost,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentPermissions,
  type AgentSessionScope,
} from "@icm/agent-adapter";
import { sha256Hex } from "@icm/derived";
import type { CircuitProject } from "@icm/model";

import type { AgentConnectionStatus } from "./connect-agent-panel";
import { transitionAgentSession } from "./agent-session-state-machine";
import {
  clearAgentSessionRecovery,
  readAgentSessionRecovery,
  writeAgentSessionRecovery,
  type AgentSessionRecoveryRecord,
} from "./session-recovery";
import {
  createHeartbeat,
  isHeartbeatAck,
  isTransportStale,
} from "./transport-liveness";

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
  allowReconnect: boolean;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  heartbeatTimer: number | null;
  lastHeartbeatAckAt: number;
  reconnect: () => void;
  requestCache: Map<
    string,
    { payloadHash: string; response: unknown; byteLength: number }
  >;
  requestCacheBytes: number;
  requestHashes: Map<string, string>;
};

const BROWSER_CACHE_MAX_ENTRIES = 32;
const BROWSER_CACHE_MAX_BYTES = 16_000_000;
const RECONNECT_DELAYS_MS = [
  500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000,
] as const;

function stopHeartbeat(live: LiveSession): void {
  if (live.heartbeatTimer !== null) {
    window.clearInterval(live.heartbeatTimer);
    live.heartbeatTimer = null;
  }
}

function sendHeartbeat(live: LiveSession, socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  let documentIds: string[];
  try {
    documentIds = live.documentIds();
  } catch {
    return;
  } // A replaced Project invalidates the bound host; its effect closes the socket.
  socket.send(
    JSON.stringify({
      ...createHeartbeat(live.sessionId, crypto.randomUUID()),
      projectId: live.projectId,
      documentIds,
    }),
  );
}

function stopReconnect(live: LiveSession): void {
  live.allowReconnect = false;
  stopHeartbeat(live);
  if (live.reconnectTimer !== null) {
    window.clearTimeout(live.reconnectTimer);
    live.reconnectTimer = null;
  }
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
  project: CircuitProject;
  projectSessionId: string;
  host: AgentOperationHost;
  fileHost?: {
    handle: (
      request: AgentFileResourceRequest,
    ) => Promise<AgentFileResourceResponse>;
    clear?: () => void;
  };
}

export interface UseAgentSessionResult extends AgentSessionViewModel {
  grant: (scopes: readonly AgentSessionScope[]) => Promise<void>;
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
  const lastScopesRef = useRef<AgentSessionScope[]>([]);
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
  const [view, setView] = useState<AgentSessionViewModel>({
    status: "idle",
    claimCode: null,
    claimExpiresAt: null,
    scopes: [],
    expiresAt: null,
    error: null,
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
      clearAgentSessionRecovery(window.localStorage);
      update({ status: "idle", claimCode: null, claimExpiresAt: null });
      return;
    }
    stopReconnect(live);
    clearAgentSessionRecovery(window.localStorage);
    options.fileHost?.clear?.();
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
      lastScopesRef.current = [...scopes];
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
          if (!response.ok)
            throw new Error(`Session creation failed (${response.status})`);
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
          allowReconnect: true,
          reconnectAttempt: 0,
          reconnectTimer: null,
          heartbeatTimer: null,
          lastHeartbeatAckAt: Date.now(),
          reconnect: () => undefined,
          requestCache: new Map(),
          requestCacheBytes: 0,
          requestHashes: new Map(),
        };
        liveRef.current = live;

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
                  ] as const,
                  maxBytes: AGENT_FILE_RESOURCE_MAX_BYTES,
                  humanApprovalRequired: true as const,
                },
              }
            : {}),
        });
        const connect = () => {
          if (
            liveRef.current !== live ||
            !live.allowReconnect ||
            Date.now() >= live.expiresAt
          ) {
            return;
          }
          if (
            live.socket?.readyState === WebSocket.OPEN ||
            live.socket?.readyState === WebSocket.CONNECTING
          ) {
            return;
          }
          if (live.reconnectTimer !== null) {
            window.clearTimeout(live.reconnectTimer);
            live.reconnectTimer = null;
          }
          const socket = new WebSocket(socketUrl(live.sessionId), [
            "icm-agent-session",
            live.editorSecret,
          ]);
          live.socket = socket;
          socket.addEventListener("open", () => {
            live.reconnectAttempt = 0;
            live.reconnectTimer = null;
            live.lastHeartbeatAckAt = Date.now();
            stopHeartbeat(live);
            sendHeartbeat(live, socket);
            live.heartbeatTimer = window.setInterval(() => {
              if (
                liveRef.current !== live ||
                live.socket !== socket ||
                socket.readyState !== WebSocket.OPEN
              ) {
                stopHeartbeat(live);
                return;
              }
              if (isTransportStale(live.lastHeartbeatAckAt, Date.now())) {
                stopHeartbeat(live);
                update({
                  status: "reconnecting",
                  error: "Agent relay heartbeat timed out",
                });
                socket.close(4000, "heartbeat timeout");
                return;
              }
              sendHeartbeat(live, socket);
            }, AGENT_HEARTBEAT_INTERVAL_MS);
            update({
              status: live.claimed ? "connected" : "waiting-for-agent",
              claimCode: live.claimCode,
              claimExpiresAt: live.claimExpiresAt,
              scopes,
              expiresAt: live.expiresAt,
              error: null,
            });
          });
          socket.addEventListener("message", (event) => {
            let raw: unknown;
            try {
              raw = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (isHeartbeatAck(raw, live.sessionId)) {
              live.lastHeartbeatAckAt = Date.now();
              return;
            }
            const parsed = AgentSessionMessageSchema.safeParse(raw);
            if (!parsed.success || parsed.data.sessionId !== live.sessionId)
              return;
            if (parsed.data.kind === "event") {
              const sessionEvent = AgentSessionEventSchema.safeParse(
                parsed.data.payload,
              );
              if (
                sessionEvent.success &&
                sessionEvent.data.type === "session.ready"
              ) {
                live.claimed = true;
                writeAgentSessionRecovery(window.localStorage, {
                  version: 1,
                  sessionId: live.sessionId,
                  editorSecret: live.editorSecret,
                  projectId: options.project.id,
                  projectSessionId: options.projectSessionId,
                  scopes: live.scopes,
                  expiresAt: live.expiresAt,
                });
                update({ status: "connected" });
              } else if (
                sessionEvent.success &&
                sessionEvent.data.type === "session.revoked"
              ) {
                stopReconnect(live);
                clearAgentSessionRecovery(window.localStorage);
                options.fileHost?.clear?.();
                socket.close(1000, "session revoked");
                if (liveRef.current === live) liveRef.current = null;
                update({
                  status: "revoked",
                  claimCode: null,
                  claimExpiresAt: null,
                });
              } else if (
                sessionEvent.success &&
                sessionEvent.data.type === "session.paused"
              ) {
                update({ status: "paused" });
              }
              return;
            }
            if (parsed.data.kind === "file-request") {
              const fileRequest = parseAgentFileResourceRequest(
                parsed.data.payload,
              );
              if (!fileRequest.success || !options.fileHost) return;
              const payloadHash = sha256Hex(
                JSON.stringify(parsed.data.payload),
              );
              const knownHash = live.requestHashes.get(parsed.data.requestId);
              const sendFileResponse = (payload: unknown) => {
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
                .finally(() => update({ status: "connected" }));
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
            update({ status: "connected" });
          });
          socket.addEventListener("close", () => {
            if (live.socket !== socket) return;
            live.socket = null;
            stopHeartbeat(live);
            if (liveRef.current !== live || !live.allowReconnect) return;
            if (Date.now() >= live.expiresAt) {
              update({ status: "offline" });
              return;
            }
            const delay =
              RECONNECT_DELAYS_MS[
                Math.min(live.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
              ]!;
            live.reconnectAttempt += 1;
            update({ status: "reconnecting" });
            live.reconnectTimer = window.setTimeout(connect, delay);
          });
          socket.addEventListener("error", () => {
            if (liveRef.current === live && live.socket === socket) {
              update({
                status: "reconnecting",
                error: "Agent relay connection failed",
              });
              socket.close();
            }
          });
        };
        live.reconnect = connect;
        connect();
      } catch (error) {
        liveRef.current = null;
        if (recovery) clearAgentSessionRecovery(window.localStorage);
        update({
          status: "idle",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      options.fileHost,
      options.enabled,
      options.host,
      options.project,
      options.projectSessionId,
      revoke,
      update,
    ],
  );

  useEffect(() => {
    if (!options.enabled) return;
    if (recoveryAttemptedForProjectRef.current === options.projectSessionId) {
      return;
    }
    recoveryAttemptedForProjectRef.current = options.projectSessionId;
    const recovery = readAgentSessionRecovery(window.localStorage, {
      projectId: options.project.id,
      projectSessionId: options.projectSessionId,
      now: Date.now(),
    });
    if (recovery) void grant(recovery.scopes, recovery);
  }, [grant, options.enabled, options.project.id, options.projectSessionId]);

  const pause = useCallback(async () => {
    if (!options.enabled) return;
    try {
      await control("pause");
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
    if (!live || Date.now() >= live.expiresAt) return;
    if (live.reconnectTimer !== null) {
      window.clearTimeout(live.reconnectTimer);
      live.reconnectTimer = null;
    }
    live.allowReconnect = true;
    live.reconnectAttempt = 0;
    update({ status: "reconnecting", error: null });
    live.reconnect();
  }, [options.enabled, update]);

  useEffect(() => {
    if (!options.enabled) return;
    const wakeTransport = () => {
      const live = liveRef.current;
      if (!live || !live.allowReconnect || Date.now() >= live.expiresAt) {
        return;
      }
      const socket = live.socket;
      if (socket?.readyState === WebSocket.OPEN) {
        if (isTransportStale(live.lastHeartbeatAckAt, Date.now())) {
          stopHeartbeat(live);
          update({
            status: "reconnecting",
            error: "Agent relay connection became stale",
          });
          socket.close(4000, "stale after browser wake");
        } else {
          sendHeartbeat(live, socket);
        }
        return;
      }
      if (socket?.readyState === WebSocket.CONNECTING) return;
      if (live.reconnectTimer !== null) {
        window.clearTimeout(live.reconnectTimer);
        live.reconnectTimer = null;
      }
      live.reconnectAttempt = 0;
      update({ status: "reconnecting", error: null });
      live.reconnect();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wakeTransport();
    };
    window.addEventListener("online", wakeTransport);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("online", wakeTransport);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [options.enabled, update]);

  const newConnection = useCallback(async () => {
    if (!options.enabled) return;
    const scopes = liveRef.current?.scopes ?? lastScopesRef.current;
    if (scopes.length === 0) return;
    await grant(scopes);
  }, [grant, options.enabled]);

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
    clearAgentSessionRecovery(window.localStorage);
    options.fileHost?.clear?.();
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
      if (live && Date.now() >= live.expiresAt) {
        stopReconnect(live);
        clearAgentSessionRecovery(window.localStorage);
        options.fileHost?.clear?.();
        live.socket?.close(1000, "expired");
        liveRef.current = null;
        update({ status: "expired", claimCode: null, claimExpiresAt: null });
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [options.enabled, options.fileHost, update]);

  useEffect(
    () => () => {
      if (!options.enabled) return;
      const live = liveRef.current;
      options.fileHost?.clear?.();
      if (live) {
        stopReconnect(live);
        if (!live.claimed) {
          clearAgentSessionRecovery(window.localStorage);
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

  return { ...view, grant, pause, resume, reconnect, newConnection, revoke };
}
