/**
 * Connection state machine for the local MCP adapter. It deliberately tracks
 * the credential/editor relationship, not host UI visibility: a closed panel
 * or an idle host does not change the state, only claim, editor attachment,
 * revocation, and transport outcomes do.
 */
import type { AgentSessionStatusResponse } from "@icm/agent-adapter";

export type AgentConnectionState =
  | "attached"
  | "paused"
  | "unknown"
  | "unpaired"
  | "connecting"
  | "online"
  | "editor-offline"
  | "reconnecting"
  | "revoked";

export type ConnectionEvent =
  /** A claim or resume attempt started. */
  | "claim-started"
  | "resume-started"
  /** A four-operation request completed successfully. */
  | "request-succeeded"
  /** Transport reported the authorized editor is not attached. */
  | "editor-detached"
  /** Local transport failed; an automatic exact-payload retry is scheduled. */
  | "transport-interrupted"
  /** Retry attempts exhausted or the credential is terminally unusable. */
  | "credential-revoked"
  /** Process-local credential removed. */
  | "reset";

const TRANSITIONS: Record<
  ConnectionEvent,
  Partial<Record<AgentConnectionState, AgentConnectionState>>
> = {
  "claim-started": {
    unpaired: "connecting",
    revoked: "connecting",
    "editor-offline": "connecting",
  },
  "resume-started": {
    unpaired: "connecting",
    revoked: "connecting",
    "editor-offline": "connecting",
  },
  "request-succeeded": {
    attached: "online",
    paused: "online",
    unknown: "online",
    connecting: "online",
    online: "online",
    "editor-offline": "online",
    reconnecting: "online",
  },
  "editor-detached": {
    attached: "editor-offline",
    paused: "editor-offline",
    unknown: "editor-offline",
    online: "editor-offline",
    connecting: "editor-offline",
    reconnecting: "editor-offline",
  },
  "transport-interrupted": {
    attached: "reconnecting",
    paused: "reconnecting",
    unknown: "reconnecting",
    connecting: "reconnecting",
    online: "reconnecting",
    "editor-offline": "reconnecting",
  },
  "credential-revoked": {
    attached: "revoked",
    paused: "revoked",
    unknown: "revoked",
    connecting: "revoked",
    online: "revoked",
    "editor-offline": "revoked",
    reconnecting: "revoked",
  },
  reset: {
    attached: "unpaired",
    paused: "unpaired",
    unknown: "unpaired",
    revoked: "unpaired",
    "editor-offline": "unpaired",
    online: "unpaired",
    connecting: "unpaired",
    reconnecting: "unpaired",
  },
};

export interface ConnectionSnapshot {
  state: AgentConnectionState;
  since: number;
  /** Code of the failure that produced the most recent non-online state. */
  lastErrorCode: string | null;
}

/** Pure transition function so state logic is unit-testable without IO. */
export function connectionTransition(
  state: AgentConnectionState,
  event: ConnectionEvent,
): AgentConnectionState {
  return TRANSITIONS[event][state] ?? state;
}

export class ConnectionTracker {
  private state: AgentConnectionState = "unpaired";
  private since: number;
  private lastErrorCode: string | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.since = now();
  }

  get snapshot(): ConnectionSnapshot {
    return {
      state: this.state,
      since: this.since,
      lastErrorCode: this.lastErrorCode,
    };
  }

  observe(status: AgentSessionStatusResponse | null, errorCode?: string): void {
    const next: AgentConnectionState =
      status === null
        ? "unknown"
        : status.authorization === "paused"
          ? "paused"
          : status.editor === "attached"
            ? "attached"
            : "editor-offline";
    if (next !== this.state) this.since = this.now();
    this.state = next;
    this.lastErrorCode = errorCode ?? null;
  }

  apply(event: ConnectionEvent, errorCode?: string): AgentConnectionState {
    const next = connectionTransition(this.state, event);
    if (errorCode !== undefined) {
      this.lastErrorCode = errorCode;
    }
    if (next !== this.state) {
      this.state = next;
      this.since = this.now();
      if (next === "online") this.lastErrorCode = null;
    }
    return this.state;
  }
}
