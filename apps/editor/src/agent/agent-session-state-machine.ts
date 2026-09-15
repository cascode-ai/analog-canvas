import type { AgentConnectionStatus } from "./connect-agent-panel";

const transitions: Readonly<
  Record<AgentConnectionStatus, readonly AgentConnectionStatus[]>
> = {
  idle: ["creating", "reconnecting", "revoked"],
  creating: [
    "waiting-for-agent",
    "connected",
    "reconnecting",
    "offline",
    "revoked",
    "expired",
    "idle",
  ],
  "waiting-for-agent": [
    "connected",
    "paused",
    "reconnecting",
    "offline",
    "revoked",
    "expired",
  ],
  connected: [
    "working",
    "paused",
    "reconnecting",
    "offline",
    "revoked",
    "expired",
  ],
  working: [
    "connected",
    "paused",
    "reconnecting",
    "offline",
    "revoked",
    "expired",
  ],
  paused: [
    "connected",
    "waiting-for-agent",
    "reconnecting",
    "revoked",
    "expired",
  ],
  reconnecting: [
    "paused",
    "waiting-for-agent",
    "connected",
    "offline",
    "revoked",
    "expired",
    "creating",
  ],
  offline: ["reconnecting", "creating", "revoked", "expired"],
  revoked: ["idle", "creating", "reconnecting"],
  expired: ["idle", "creating", "reconnecting", "revoked"],
};

export function canTransitionAgentSession(
  current: AgentConnectionStatus,
  next: AgentConnectionStatus,
): boolean {
  return current === next || transitions[current].includes(next);
}

export function transitionAgentSession(
  current: AgentConnectionStatus,
  next: AgentConnectionStatus,
): AgentConnectionStatus {
  return canTransitionAgentSession(current, next) ? next : current;
}
