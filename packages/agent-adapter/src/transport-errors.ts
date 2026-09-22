import type { AgentTransportErrorCode } from "./envelope.js";

/**
 * Failure categories every consumer of a transport error code shares. The
 * Worker projects the status onto the HTTP response, the Node session client
 * drives its connection state machine with the category, and the MCP tools
 * derive recovery hints from the category. One exhaustive table means a new
 * code in `AgentTransportErrorCodeSchema` fails typecheck until all three
 * projections are stated together instead of drifting apart per consumer.
 *
 * The status and the category are orthogonal: a code can answer 409 while
 * still requiring a fresh human claim (SESSION_EXPIRED), and a 404 can be a
 * dead session (SESSION_NOT_FOUND). State both explicitly per code.
 */
export type AgentTransportFailureCategory =
  /** The stored credential is unusable; a new human claim is required. */
  | "unrecoverable-credential"
  /** The authorized editor is not attached right now. */
  | "editor-offline"
  /** Retry with the exact same request ID and payload is allowed. */
  | "retryable"
  /** The server rejected the request shape or a protocol rule. */
  | "request-rejected";

export interface AgentTransportErrorDescriptor {
  /** HTTP status the Worker answers with for this code. */
  status: number;
  category: AgentTransportFailureCategory;
  /** Default message the Worker sends when the caller supplies none. */
  message: string;
}

export const AGENT_TRANSPORT_ERRORS: Record<
  AgentTransportErrorCode,
  AgentTransportErrorDescriptor
> = {
  SESSION_NOT_FOUND: {
    status: 404,
    category: "unrecoverable-credential",
    message: "Session is unknown or expired",
  },
  SESSION_EXPIRED: {
    status: 409,
    category: "unrecoverable-credential",
    message: "Session has expired",
  },
  SESSION_PAUSED: {
    status: 409,
    category: "request-rejected",
    message: "Session is paused",
  },
  SESSION_REVOKED: {
    status: 409,
    category: "unrecoverable-credential",
    message: "Session has been revoked",
  },
  PROJECT_REPLACED: {
    status: 409,
    category: "unrecoverable-credential",
    message: "The browser opened a different Project",
  },
  PROJECT_CONTEXT_STALE: {
    status: 409,
    category: "request-rejected",
    message:
      "The browser context changed; read current context and re-plan without reconnecting",
  },
  NO_ACTIVE_PROJECT: {
    status: 409,
    category: "request-rejected",
    message: "The workspace is connected but no Editor Project is active",
  },
  CLAIM_INVALID: {
    status: 401,
    category: "unrecoverable-credential",
    message: "Claim code is unknown or malformed",
  },
  CLAIM_EXPIRED: {
    status: 409,
    category: "unrecoverable-credential",
    message: "Claim code has expired",
  },
  CLAIM_ALREADY_USED: {
    status: 409,
    category: "unrecoverable-credential",
    message: "Claim code was already used by a legacy session",
  },
  CONNECTOR_INVALID: {
    status: 401,
    category: "unrecoverable-credential",
    message: "Connector credential is unknown or replaced",
  },
  CONNECTOR_EXPIRED: {
    status: 401,
    category: "unrecoverable-credential",
    message: "Connector credential has expired",
  },
  TOKEN_INVALID: {
    status: 401,
    category: "unrecoverable-credential",
    message: "Bearer token is missing or unknown",
  },
  TOKEN_EXPIRED: {
    status: 401,
    category: "unrecoverable-credential",
    message: "Bearer token has expired",
  },
  TOKEN_SCOPE_INSUFFICIENT: {
    status: 403,
    category: "request-rejected",
    message: "The token does not grant this operation",
  },
  EDITOR_OFFLINE: {
    status: 503,
    category: "editor-offline",
    message: "The authorized browser editor is offline",
  },
  EDITOR_DISCONNECTED: {
    status: 503,
    category: "editor-offline",
    message: "The browser editor disconnected",
  },
  REQUEST_TOO_LARGE: {
    status: 413,
    category: "request-rejected",
    message: "Request exceeds the relay ceiling",
  },
  MESSAGE_TOO_LARGE: {
    status: 413,
    category: "request-rejected",
    message: "Browser message exceeds the relay ceiling",
  },
  RATE_LIMITED: {
    status: 429,
    category: "retryable",
    message: "Too many requests; back off and retry",
  },
  REQUEST_IN_PROGRESS: {
    status: 409,
    category: "request-rejected",
    message: "The same request is already in progress",
  },
  REQUEST_ID_REUSED: {
    status: 409,
    category: "request-rejected",
    message: "The requestId was reused with a different payload",
  },
  REQUEST_RESULT_UNAVAILABLE: {
    status: 409,
    category: "request-rejected",
    message:
      "The request already ran but its terminal response is no longer cached",
  },
  REQUEST_TIMEOUT: {
    status: 504,
    category: "retryable",
    message: "The browser did not complete the request in time",
  },
  UNSUPPORTED_PROTOCOL_VERSION: {
    status: 409,
    category: "request-rejected",
    message: "Unsupported session protocol version",
  },
  UNAUTHORIZED_ORIGIN: {
    status: 409,
    category: "request-rejected",
    message: "Origin is not authorized",
  },
  FILE_CONTENT_INVALID: {
    status: 409,
    category: "request-rejected",
    message: "File content does not match the requested format",
  },
  FILE_TOO_LARGE: {
    status: 413,
    category: "request-rejected",
    message: "File Resource payload exceeds its bounded limit",
  },
  FILE_INTEGRITY_MISMATCH: {
    status: 409,
    category: "request-rejected",
    message: "File content hash does not match its declaration",
  },
  FILE_CANDIDATE_NOT_FOUND: {
    status: 409,
    category: "request-rejected",
    message: "Candidate is unavailable or has expired",
  },
  FILE_IMPORT_FAILED: {
    status: 409,
    category: "request-rejected",
    message: "Structural SPICE import failed",
  },
  FILE_EXPORT_FAILED: {
    status: 409,
    category: "request-rejected",
    message: "Formal file export failed",
  },
  SIMULATION_REQUEST_INVALID: {
    status: 409,
    category: "request-rejected",
    message: "Simulation Resource request does not match its strict schema",
  },
  PROJECT_REQUEST_INVALID: {
    status: 409,
    category: "request-rejected",
    message: "Project Resource request does not match its strict schema",
  },
};

export function agentTransportErrorStatus(
  code: AgentTransportErrorCode,
): number {
  return AGENT_TRANSPORT_ERRORS[code].status;
}

export function agentTransportErrorMessage(
  code: AgentTransportErrorCode,
): string {
  return AGENT_TRANSPORT_ERRORS[code].message;
}

/**
 * Category for a wire error code. Codes outside the enum stay
 * `request-rejected` so the caller sees the server's message instead of a
 * crash; the connection state machine treats that category as safe.
 */
export function agentTransportErrorCategory(
  code: AgentTransportErrorCode | string,
): AgentTransportFailureCategory {
  const descriptor = (
    AGENT_TRANSPORT_ERRORS as Record<
      string,
      AgentTransportErrorDescriptor | undefined
    >
  )[code];
  return descriptor?.category ?? "request-rejected";
}
