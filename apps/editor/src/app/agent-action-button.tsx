import {
  agentPresenceLabel,
  type AgentPresence,
} from "../agent/agent-presence";
import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

export interface AgentAction {
  label: string;
  /** The connection's mark: green connected, yellow lost, none unpaired. */
  presence: AgentPresence;
  execute: () => void;
}

/** The command row's Agent button, marked with the connection's state. */
export function AgentActionButton({ action }: { action: AgentAction }) {
  const name = agentPresenceLabel(action.presence);
  return (
    <button
      type="button"
      className="app-action app-action-agent"
      data-testid="open-agent"
      title={action.presence ? `${action.label} · ${name}` : action.label}
      aria-label={name}
      onClick={() => {
        dismissOpenCommandMenus();
        action.execute();
      }}
    >
      <svg className="app-action-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <span className="app-action-label">Agent</span>
      {action.presence ? (
        <span
          className={`app-action-agent-presence ${action.presence}`}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
