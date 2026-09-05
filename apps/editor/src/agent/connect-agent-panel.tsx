import { useEffect, useState, type ReactNode } from "react";

import type { AgentSessionScope } from "@icm/agent-adapter";

/** Browser authorization hand-off and compact Properties status controls. */

export type AgentConnectionStatus =
  | "idle"
  | "creating"
  | "waiting-for-agent"
  | "connected"
  | "working"
  | "paused"
  | "reconnecting"
  | "offline"
  | "revoked"
  | "expired";

export interface PermissionPreset {
  id: "review" | "layout" | "full";
  label: string;
  description: string;
  scopes: AgentSessionScope[];
}

export const AGENT_PERMISSION_PRESETS: readonly PermissionPreset[] = [
  {
    id: "review",
    label: "Review",
    description: "Read the circuit, render it, and download approved views.",
    scopes: [
      "circuit.snapshot",
      "circuit.render",
      "circuit.source-spans",
      "editor.semantic-control",
      "project.download",
      "visual.download",
    ],
  },
  {
    id: "layout",
    label: "Layout Edit",
    description: "Review the circuit and change component placement or routes.",
    scopes: [
      "circuit.snapshot",
      "circuit.render",
      "circuit.source-spans",
      "circuit.edit.geometry",
      "editor.semantic-control",
      "project.download",
      "visual.download",
    ],
  },
  {
    id: "full",
    label: "Full Circuit Edit",
    description:
      "Edit circuit, connectivity, annotations, and approved imports.",
    scopes: [
      "circuit.snapshot",
      "circuit.render",
      "circuit.source-spans",
      "circuit.edit.geometry",
      "circuit.edit.connectivity",
      "circuit.edit.presentation",
      "editor.semantic-control",
      "project.download",
      "visual.download",
      "project.import",
      "simulation.run",
    ],
  },
];

export interface ConnectAgentPanelProps {
  open: boolean;
  status: AgentConnectionStatus;
  claimCode: string | null;
  claimExpiresAt: number | null;
  scopes: readonly AgentSessionScope[];
  expiresAt: number | null;
  error: string | null;
  now: number;
  onGrant: (scopes: AgentSessionScope[]) => void;
  onPause: () => void;
  onResume: () => void;
  onReconnect: () => void;
  onNewConnection: () => void;
  onRevoke: () => void;
  onClose: () => void;
}

export interface AgentPropertiesSectionProps extends Omit<
  ConnectAgentPanelProps,
  "open" | "now" | "onGrant" | "onClose"
> {
  expanded: boolean;
  onToggleDetails: () => void;
  onDismiss: () => void;
}

export function agentConnectionInstructions(
  origin: string,
  claimCode: string,
): string {
  const kitUrl = `${origin}/api/agent/kit`;
  const manifestUrl = `${origin}/api/agent/mcp-manifest.json`;
  return `Connect to Analog Canvas.
Claim: ${JSON.stringify({ claimCode })}
Bootstrap: ${manifestUrl}

1. If the Analog Canvas MCP is available, call connect with the Claim, read analog-canvas://reference/quickstart, then call get_context.
2. If it is unavailable, read the Bootstrap manifest and configure its version-pinned stdio server for this Agent host. If the host must restart to load it, tell the user once.
3. If MCP cannot load in this session, continue immediately with the HTTP Agent Kit: ${kitUrl}

Do not invent symbol IDs, pin names, revisions, or raw API requests. The connector resumes automatically until the user disconnects it.`;
}

const STATUS_LABEL: Record<AgentConnectionStatus, string> = {
  idle: "Not connected",
  creating: "Creating connection…",
  "waiting-for-agent": "Waiting for Agent",
  connected: "Connected",
  working: "Working",
  paused: "Paused",
  reconnecting: "Reconnecting",
  offline: "Relay offline",
  revoked: "Disconnected",
  expired: "Session expired",
};

function formatRemaining(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return "—";
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function permissionLabel(scopes: readonly AgentSessionScope[]): string {
  const preset = AGENT_PERMISSION_PRESETS.find(
    (candidate) =>
      candidate.scopes.length === scopes.length &&
      candidate.scopes.every((scope) => scopes.includes(scope)),
  );
  return preset?.label ?? "Custom access";
}

function useClock(active: boolean, initial: number): number {
  const [clock, setClock] = useState(initial);
  useEffect(() => {
    if (!active) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return clock;
}

function ConnectionControls(
  props: Pick<
    ConnectAgentPanelProps,
    | "status"
    | "onPause"
    | "onResume"
    | "onReconnect"
    | "onNewConnection"
    | "onRevoke"
  >,
): ReactNode {
  const terminal = props.status === "revoked" || props.status === "expired";
  if (terminal) {
    return (
      <div className="agent-controls">
        <button
          type="button"
          data-testid="agent-new-connection"
          onClick={props.onNewConnection}
        >
          New connection
        </button>
      </div>
    );
  }
  if (props.status === "idle" || props.status === "creating") return null;
  return (
    <div className="agent-controls">
      {props.status === "connected" ||
      props.status === "waiting-for-agent" ||
      props.status === "working" ? (
        <button type="button" data-testid="agent-pause" onClick={props.onPause}>
          Pause
        </button>
      ) : null}
      {props.status === "paused" ? (
        <button
          type="button"
          data-testid="agent-resume"
          onClick={props.onResume}
        >
          Resume
        </button>
      ) : null}
      {props.status === "offline" || props.status === "reconnecting" ? (
        <button
          type="button"
          data-testid="agent-reconnect"
          onClick={props.onReconnect}
        >
          Retry relay
        </button>
      ) : null}
      <button
        type="button"
        data-testid="agent-new-connection"
        onClick={props.onNewConnection}
      >
        New connection
      </button>
      <button type="button" data-testid="agent-revoke" onClick={props.onRevoke}>
        Disconnect
      </button>
    </div>
  );
}

function ClaimHandOff({
  claimCode,
  claimExpiresAt,
  expiresAt,
  scopes,
  now,
  onNewConnection,
  status,
}: Pick<
  ConnectAgentPanelProps,
  | "claimCode"
  | "claimExpiresAt"
  | "expiresAt"
  | "scopes"
  | "onNewConnection"
  | "status"
> & { now: number }): ReactNode {
  const [copied, setCopied] = useState(false);
  const claimExpired = claimExpiresAt !== null && now >= claimExpiresAt;
  if (claimCode === null && !claimExpired) return null;
  if (claimExpired && status === "waiting-for-agent") {
    return (
      <div className="agent-claim" data-testid="agent-claim-expired">
        <p>Connection setup expired.</p>
        <button type="button" onClick={onNewConnection}>
          Generate another
        </button>
      </div>
    );
  }
  if (claimExpired) return null;
  const instructions = agentConnectionInstructions(
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
    claimCode!,
  );
  return (
    <div className="agent-claim" data-testid="agent-claim">
      <p>
        Give the Agent this one-time setup. It expires in{" "}
        {formatRemaining(claimExpiresAt, now)}; the connected session lasts{" "}
        {formatRemaining(expiresAt, now)} and closing this panel does not
        disconnect it.
      </p>
      <div className="agent-copy-card">
        <div className="agent-copy-card-header">
          <span className="agent-copy-card-label">Plain text</span>
          <div className="agent-copy-card-action">
            <span className="agent-copy-feedback" aria-live="polite">
              {copied ? "Copied" : ""}
            </span>
            <button
              type="button"
              className="agent-copy-button"
              data-testid="agent-copy-instructions"
              aria-label={
                copied ? "Connection setup copied" : "Copy connection setup"
              }
              title={copied ? "Copied" : "Copy connection setup"}
              onClick={() => {
                void navigator.clipboard
                  .writeText(instructions)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2_000);
                  })
                  .catch(() => undefined);
              }}
            >
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <rect x="6.5" y="3.5" width="10" height="11" rx="2" />
                <path d="M13.5 14.5v.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h1.5" />
              </svg>
            </button>
          </div>
        </div>
        <pre data-testid="agent-copy-text">{instructions}</pre>
      </div>
      <details>
        <summary>Show connection code and technical details</summary>
        <code data-testid="agent-claim-code">{claimCode}</code>
        <p className="agent-technical-details">Scopes: {scopes.join(", ")}</p>
        <p className="agent-technical-details">
          First-time setup:{" "}
          <a
            href="/api/agent/mcp-manifest.json"
            target="_blank"
            rel="noreferrer"
          >
            MCP bootstrap manifest
          </a>
          . No MCP support is required when the Agent uses the bundled Kit
          fallback.
        </p>
      </details>
    </div>
  );
}

export function ConnectAgentPanel(props: ConnectAgentPanelProps): ReactNode {
  const clock = useClock(props.open, props.now);
  if (!props.open) return null;
  const terminal = props.status === "revoked" || props.status === "expired";
  const showGrant = props.status === "idle" || terminal;

  return (
    <div
      className="agent-panel"
      data-testid="connect-agent-panel"
      data-status={props.status}
    >
      <section
        className="agent-dialog"
        role="dialog"
        aria-label="Connect Agent"
      >
        <div className="agent-panel-header">
          <h2>Connect Agent</h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Hide Agent details"
          >
            Hide details
          </button>
        </div>
        <p className="agent-panel-status" data-testid="agent-status">
          {STATUS_LABEL[props.status]}
          {props.expiresAt !== null
            ? ` · session ${formatRemaining(props.expiresAt, clock)} remaining`
            : ""}
        </p>
        {props.error ? (
          <p className="agent-panel-error" role="alert">
            {props.error}
          </p>
        ) : null}

        {showGrant ? (
          <div className="agent-grant" data-testid="agent-grant">
            <p>Choose what the Agent may do in this Project.</p>
            <ul>
              {AGENT_PERMISSION_PRESETS.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    className="agent-preset-button"
                    data-testid={`agent-preset-${preset.id}`}
                    onClick={() => props.onGrant(preset.scopes)}
                  >
                    {preset.label}
                  </button>
                  <span className="agent-preset-description">
                    {preset.description}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ClaimHandOff {...props} now={clock} />
        <ConnectionControls {...props} />
      </section>
    </div>
  );
}

export function AgentPropertiesSection(
  props: AgentPropertiesSectionProps,
): ReactNode {
  const clock = useClock(true, Date.now());
  if (props.status === "idle") return null;
  const terminal = props.status === "revoked" || props.status === "expired";
  return (
    <section
      className="agent-properties"
      aria-label="Agent connection"
      data-testid="agent-properties"
    >
      <div className="agent-properties-summary">
        <div>
          <h2>Agent</h2>
          <p>
            <span
              className={`agent-status-dot ${terminal ? "terminal" : ""}`}
              aria-hidden="true"
            />
            {STATUS_LABEL[props.status]} · {permissionLabel(props.scopes)}
            {props.expiresAt !== null
              ? ` · ${formatRemaining(props.expiresAt, clock)}`
              : ""}
          </p>
        </div>
        <div className="agent-properties-actions">
          {props.status === "connected" ||
          props.status === "waiting-for-agent" ||
          props.status === "working" ? (
            <button
              type="button"
              data-testid="agent-pause"
              onClick={props.onPause}
            >
              Pause
            </button>
          ) : null}
          {props.status === "paused" ? (
            <button
              type="button"
              data-testid="agent-resume"
              onClick={props.onResume}
            >
              Resume
            </button>
          ) : null}
          {props.status === "offline" || props.status === "reconnecting" ? (
            <button
              type="button"
              data-testid="agent-reconnect"
              onClick={props.onReconnect}
            >
              Retry relay
            </button>
          ) : null}
          {terminal ? (
            <button
              type="button"
              data-testid="agent-new-connection"
              onClick={props.onNewConnection}
            >
              New connection
            </button>
          ) : null}
          <button
            type="button"
            onClick={props.onToggleDetails}
            aria-expanded={props.expanded}
          >
            {props.expanded ? "Hide" : "Manage"}
          </button>
        </div>
      </div>
      {props.expanded ? (
        <div className="agent-properties-details">
          <ClaimHandOff {...props} now={clock} />
          <details>
            <summary>Connection details</summary>
            <p>Access: {permissionLabel(props.scopes)}</p>
            <p className="agent-technical-details">
              Scopes: {props.scopes.join(", ")}
            </p>
          </details>
          {!terminal ? (
            <div className="agent-controls">
              <button
                type="button"
                data-testid="agent-new-connection"
                onClick={props.onNewConnection}
              >
                New connection
              </button>
              <button
                type="button"
                data-testid="agent-revoke"
                onClick={props.onRevoke}
              >
                Disconnect
              </button>
            </div>
          ) : null}
          {props.error ? (
            <p className="agent-panel-error" role="alert">
              {props.error}
            </p>
          ) : null}
          {terminal ? (
            <button
              type="button"
              className="agent-dismiss"
              onClick={props.onDismiss}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
