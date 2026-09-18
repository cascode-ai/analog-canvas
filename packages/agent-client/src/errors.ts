import {
  agentTransportErrorCategory,
  type AgentTransportErrorCode,
  type AgentTransportFailureCategory,
} from "@icm/agent-adapter";

/**
 * Failure categories the session client maps transport outcomes to. The
 * wire-code projections come from the exhaustive table in agent-adapter;
 * `network` is the only client-local addition, for failures with no server
 * answer at all.
 */
export type AgentFailureCategory =
  | AgentTransportFailureCategory
  /** Local transport could not reach the API at all. */
  | "network";

export class AgentSessionError extends Error {
  readonly code: string;
  readonly category: AgentFailureCategory;
  readonly httpStatus: number | undefined;

  constructor(
    code: string,
    message: string,
    category: AgentFailureCategory,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "AgentSessionError";
    this.code = code;
    this.category = category;
    this.httpStatus = httpStatus;
  }

  toJSON(): { code: string; message: string; category: AgentFailureCategory } {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
    };
  }
}

/**
 * Normalize a transport-level failure identified by its wire error code (see
 * `AgentTransportErrorCodeSchema`) plus HTTP status into the local failure
 * taxonomy. Categories come from the exhaustive agent-adapter table; codes
 * outside the enum are treated as rejected requests so the caller sees the
 * server's message instead of a crash.
 */
export function transportFailure(
  code: AgentTransportErrorCode | string,
  message: string,
  httpStatus?: number,
): AgentSessionError {
  return new AgentSessionError(
    code,
    message,
    agentTransportErrorCategory(code),
    httpStatus,
  );
}

export function networkFailure(detail: string): AgentSessionError {
  return new AgentSessionError("NETWORK_FAILURE", detail, "network");
}

export function invalidResponseFailure(detail: string): AgentSessionError {
  return new AgentSessionError("INVALID_RESPONSE", detail, "request-rejected");
}
