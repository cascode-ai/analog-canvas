/**
 * Frozen web-session transport schemas (WP-WA1). These are browser-safe (zod
 * only) and are consumed by both the in-browser Agent Host (WP-WA3) and the
 * Cloudflare relay (WP-WA4). They never import Node builtins.
 *
 * Contract source: [`docs/specs/web-agent-session.md`](../../../docs/specs/web-agent-session.md)
 * and [`ADR 0016`](../../../docs/adr/0016-browser-authoritative-agent-session.md).
 * The Circuit API payload carried by these messages is defined in `schema.ts`.
 */

import { z } from "zod";

/** Relay protocol version. Bumped only on an incompatible envelope change. */
export const AGENT_SESSION_PROTOCOL_VERSION = "1.0" as const;

/** Browser/relay liveness policy. These control frames never enter Circuit API dispatch. */
export const AGENT_HEARTBEAT_INTERVAL_MS = 15_000;
export const AGENT_HEARTBEAT_TIMEOUT_MS = 45_000;
export const AGENT_SSE_KEEPALIVE_INTERVAL_MS = 25_000;

const OpaqueIdSchema = z.string().min(1);
const IsoTimestampSchema = z
  .string()
  .min(1)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u);

/** Kind of a relay message envelope. */
export const AgentSessionMessageKindSchema = z.enum([
  "circuit-request",
  "circuit-response",
  "file-request",
  "file-response",
  "simulation-request",
  "simulation-response",
  "event",
  "cancel",
]);

export const AgentClaimRequestSchema = z.strictObject({
  claimCode: OpaqueIdSchema,
});
export const AgentClaimRequestJsonSchema = z.toJSONSchema(
  AgentClaimRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);

/** Durable Agent-side connector exchange. The connector is never a Circuit bearer. */
export const AgentConnectorResumeRequestSchema = z.strictObject({
  sessionId: OpaqueIdSchema,
  connectorToken: OpaqueIdSchema,
});
export const AgentConnectorResumeRequestJsonSchema = z.toJSONSchema(
  AgentConnectorResumeRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);

/** Successful claim or connector resume. Secrets are returned only once. */
export const AgentConnectionCredentialResponseSchema = z.strictObject({
  ok: z.literal(true),
  sessionId: OpaqueIdSchema,
  agentToken: OpaqueIdSchema,
  tokenExpiresAt: z.number().int().nonnegative(),
  connectorToken: OpaqueIdSchema,
  connectorExpiresAt: z.number().int().nonnegative(),
  scopes: z.array(z.string().min(1)),
  projectId: OpaqueIdSchema,
  documentIds: z.array(OpaqueIdSchema).min(1),
});
export const AgentConnectionCredentialResponseJsonSchema = z.toJSONSchema(
  AgentConnectionCredentialResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);

/**
 * One forwarded relay message. The `circuit-request`/`circuit-response` payload
 * is the strict Circuit API schema from `schema.ts`; the relay never interprets
 * or rewrites it.
 */
export const AgentSessionMessageSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_SESSION_PROTOCOL_VERSION),
  sessionId: OpaqueIdSchema,
  messageId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
  sentAt: IsoTimestampSchema,
  kind: AgentSessionMessageKindSchema,
  payload: z.unknown(),
});

/** Authenticated browser liveness and current Project document roster. */
export const AgentSessionControlMessageSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_SESSION_PROTOCOL_VERSION),
  sessionId: OpaqueIdSchema,
  kind: z.enum(["heartbeat", "heartbeat-ack"]),
  nonce: OpaqueIdSchema,
  /** Current roster, supplied only by the authenticated editor of this Project. */
  projectId: OpaqueIdSchema.optional(),
  documentIds: z.array(OpaqueIdSchema).min(1).max(1024).optional(),
});

/** Agent-facing event types. `document.replaced` terminates the session. */
export const AgentSessionEventTypeSchema = z.enum([
  "session.ready",
  "session.paused",
  "session.revoked",
  "session.expiring",
  "editor.online",
  "editor.offline",
  "document.revision-changed",
  "document.replaced",
  "operation.started",
  "operation.completed",
  "operation.failed",
]);

const ActorKindSchema = z.enum(["human", "agent"]);

/** A bounded event delivered on the Agent SSE stream. */
export const AgentSessionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("session.ready"),
    sessionId: OpaqueIdSchema,
    expiresAt: IsoTimestampSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("session.paused"),
    sessionId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("session.revoked"),
    sessionId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("session.expiring"),
    sessionId: OpaqueIdSchema,
    expiresAt: IsoTimestampSchema,
  }),
  z.strictObject({
    type: z.literal("editor.online"),
    sessionId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("editor.offline"),
    sessionId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("document.revision-changed"),
    sessionId: OpaqueIdSchema,
    documentId: OpaqueIdSchema,
    revision: z.number().int().nonnegative(),
    actorKind: ActorKindSchema,
    requestId: OpaqueIdSchema.optional(),
    changedObjectIds: z.array(OpaqueIdSchema),
  }),
  z.strictObject({
    type: z.literal("document.replaced"),
    sessionId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("operation.started"),
    sessionId: OpaqueIdSchema,
    requestId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("operation.completed"),
    sessionId: OpaqueIdSchema,
    requestId: OpaqueIdSchema,
  }),
  z.strictObject({
    type: z.literal("operation.failed"),
    sessionId: OpaqueIdSchema,
    requestId: OpaqueIdSchema,
  }),
]);

/** Typed transport error codes (web-session layer). */
export const AgentTransportErrorCodeSchema = z.enum([
  // Session lifecycle
  "SESSION_NOT_FOUND",
  "SESSION_EXPIRED",
  "SESSION_PAUSED",
  "SESSION_REVOKED",
  "PROJECT_REPLACED",
  // Claim exchange
  "CLAIM_INVALID",
  "CLAIM_EXPIRED",
  "CLAIM_ALREADY_USED",
  // Persistent connector
  "CONNECTOR_INVALID",
  "CONNECTOR_EXPIRED",
  // Token
  "TOKEN_INVALID",
  "TOKEN_EXPIRED",
  "TOKEN_SCOPE_INSUFFICIENT",
  // Transport and editor state
  "EDITOR_OFFLINE",
  "EDITOR_DISCONNECTED",
  "REQUEST_TOO_LARGE",
  "MESSAGE_TOO_LARGE",
  "RATE_LIMITED",
  "REQUEST_IN_PROGRESS",
  "REQUEST_ID_REUSED",
  "REQUEST_RESULT_UNAVAILABLE",
  "REQUEST_TIMEOUT",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNAUTHORIZED_ORIGIN",
  // File Resource
  "FILE_CONTENT_INVALID",
  "FILE_TOO_LARGE",
  "FILE_INTEGRITY_MISMATCH",
  "FILE_CANDIDATE_NOT_FOUND",
  "FILE_IMPORT_FAILED",
  "FILE_EXPORT_FAILED",
  // Simulation Resource
  "SIMULATION_REQUEST_INVALID",
]);

/** Stable machine-readable failure envelope for every HTTP transport error. */
export const AgentTransportErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: AgentTransportErrorCodeSchema,
    message: z.string(),
  }),
});
export const AgentTransportErrorResponseJsonSchema = z.toJSONSchema(
  AgentTransportErrorResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);

/**
 * Web-session permission scopes carried by an `agentToken`. They map to
 * `AgentPermissions` as documented in the spec. `circuit.snapshot` is the
 * sole circuit read scope.
 */
export const AgentSessionScopeSchema = z.enum([
  "circuit.snapshot",
  "circuit.render",
  "circuit.source-spans",
  "circuit.edit.geometry",
  "circuit.edit.connectivity",
  "circuit.edit.presentation",
  "editor.semantic-control",
  "project.download",
  "project.import",
  "visual.download",
  /**
   * Compile and execute one structured simulation. Granted through the same
   * human claim flow as the file scopes and, like them, independent of every
   * edit scope: authorizing an Agent to draw a circuit is not authorizing it
   * to spend a deployment's simulator time.
   */
  "simulation.run",
]);

/** Single runtime scope guard for browser recovery and relay consumers. */
export function isAgentSessionScope(
  value: unknown,
): value is AgentSessionScope {
  return AgentSessionScopeSchema.safeParse(value).success;
}

export type AgentSessionMessage = z.infer<typeof AgentSessionMessageSchema>;
export type AgentSessionControlMessage = z.infer<
  typeof AgentSessionControlMessageSchema
>;
export type AgentClaimRequest = z.infer<typeof AgentClaimRequestSchema>;
export type AgentConnectorResumeRequest = z.infer<
  typeof AgentConnectorResumeRequestSchema
>;
export type AgentConnectionCredentialResponse = z.infer<
  typeof AgentConnectionCredentialResponseSchema
>;
export type AgentSessionMessageKind = z.infer<
  typeof AgentSessionMessageKindSchema
>;
export type AgentSessionEvent = z.infer<typeof AgentSessionEventSchema>;
export type AgentSessionEventType = z.infer<typeof AgentSessionEventTypeSchema>;
export type AgentTransportErrorCode = z.infer<
  typeof AgentTransportErrorCodeSchema
>;
export type AgentTransportErrorResponse = z.infer<
  typeof AgentTransportErrorResponseSchema
>;
export type AgentSessionScope = z.infer<typeof AgentSessionScopeSchema>;
