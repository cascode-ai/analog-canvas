import type { AgentConnectionStatus } from "../../agent/connect-agent-panel";

export interface SimulationAgentGuidanceProps {
  status: AgentConnectionStatus;
  onOpen(): void;
}

const labels: Record<AgentConnectionStatus, string> = {
  idle: "Connect Agent",
  creating: "Connecting Agent",
  "waiting-for-agent": "Waiting for Agent",
  connected: "Agent connected",
  working: "Agent working",
  paused: "Agent paused",
  reconnecting: "Agent reconnecting",
  offline: "Agent offline",
  revoked: "Connect Agent",
  expired: "Connect Agent",
};

/** A session projection only: opening the existing panel is always deliberate. */
export function SimulationAgentGuidance({
  status,
  onOpen,
}: SimulationAgentGuidanceProps) {
  const hint =
    status === "connected"
      ? "Tell your Agent your simulation goal"
      : status === "idle" || status === "revoked" || status === "expired"
        ? "Let an Agent help configure, run and analyze"
        : "";
  return (
    <div className="simulation-agent-guidance" data-agent-status={status}>
      <span className="simulation-agent-hint" aria-hidden="true">
        {hint}
      </span>
      <button
        type="button"
        onClick={onOpen}
        title={hint || `${labels[status]} — manage connection`}
      >
        <span className="simulation-agent-dot" aria-hidden="true" />
        {labels[status]}
      </button>
    </div>
  );
}
