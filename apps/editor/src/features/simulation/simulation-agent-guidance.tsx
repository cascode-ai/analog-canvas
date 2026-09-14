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

const startStates: Record<
  AgentConnectionStatus,
  {
    label: string;
    hint: string;
    action: string;
    icon: string;
  }
> = {
  idle: {
    label: "Agent not connected",
    hint: "Connect an Agent to get started.",
    action: "Connect Agent",
    icon: "○",
  },
  creating: {
    label: "Connecting Agent",
    hint: "Preparing your connection information…",
    action: "Connecting…",
    icon: "…",
  },
  "waiting-for-agent": {
    label: "Waiting for Agent",
    hint: "Paste the connection message into your Agent chat.",
    action: "View connection info",
    icon: "…",
  },
  connected: {
    label: "Agent connected",
    hint: "Tell your Agent your simulation goal.",
    action: "Connection details",
    icon: "✓",
  },
  working: {
    label: "Agent working",
    hint: "Your Agent is processing a request.",
    action: "Connection details",
    icon: "…",
  },
  paused: {
    label: "Agent paused",
    hint: "Open connection details to resume.",
    action: "Connection details",
    icon: "Ⅱ",
  },
  reconnecting: {
    label: "Agent reconnecting",
    hint: "Restoring the existing connection…",
    action: "Connection details",
    icon: "…",
  },
  offline: {
    label: "Agent offline",
    hint: "Check the connection to continue.",
    action: "Connection details",
    icon: "!",
  },
  revoked: {
    label: "Agent disconnected",
    hint: "Reconnect an Agent to continue.",
    action: "Reconnect Agent",
    icon: "!",
  },
  expired: {
    label: "Agent connection expired",
    hint: "Reconnect an Agent to continue.",
    action: "Reconnect Agent",
    icon: "!",
  },
};

/** No connection, focus or navigation side effects when status changes. */
export function SimulationAgentStart({
  status,
  onOpen,
  onManualSetup,
}: SimulationAgentGuidanceProps & {
  onManualSetup(): void;
}) {
  const state = startStates[status];
  return (
    <section
      className="simulation-agent-start"
      aria-label="Agent simulation guide"
      data-agent-status={status}
    >
      <h2>Simulate with an Agent</h2>
      <div
        className="simulation-agent-start-status"
        role="status"
        aria-atomic="true"
      >
        <span className="simulation-agent-start-icon" aria-hidden="true">
          {state.icon}
        </span>
        <div>
          <strong>{state.label}</strong>
          <p>{state.hint}</p>
        </div>
      </div>
      <ol className="simulation-agent-steps">
        <li>
          <strong>Connect your Agent</strong>
          <p>
            Click <b>Connect Agent</b> and paste the connection message into
            your Agent chat.
          </p>
        </li>
        <li>
          <strong>Describe your goal</strong>
          <p>
            Tell your Agent what to test. It can configure sources, analyses,
            and signals to capture.
          </p>
        </li>
        <li>
          <strong>Review the results</strong>
          <p>
            Your Agent can run the simulation and explain the findings. View
            plots, measurements, and run history here.
          </p>
        </li>
      </ol>
      <div className="simulation-agent-start-actions">
        <button
          className="simulation-agent-start-primary"
          type="button"
          disabled={status === "creating"}
          onClick={onOpen}
        >
          {state.action}
        </button>
        <button
          className="simulation-agent-start-manual"
          type="button"
          onClick={onManualSetup}
        >
          Set up manually
        </button>
      </div>
    </section>
  );
}

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
