import { renderAgentConnectionInstructions } from "./connection-guidance.generated.js";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { AgentSessionScope } from "@icm/agent-adapter";
import type { ConnectionOperationKind } from "./connection-operation";

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

export interface ConnectAgentPanelProps {
  pendingOperation?: ConnectionOperationKind | null;
  open: boolean;
  status: AgentConnectionStatus;
  claimCode: string | null;
  claimExpiresAt: number | null;
  scopes: readonly AgentSessionScope[];
  expiresAt: number | null;
  error: string | null;
  now: number;
  onPause: () => void;
  onResume: () => void;
  onReconnect: () => void;
  onNewConnection: () => void;
  onRevoke: () => void;
  onClose: () => void;
}

export interface AgentPropertiesSectionProps extends Omit<
  ConnectAgentPanelProps,
  "open" | "now" | "onClose"
> {
  expanded: boolean;
  onToggleDetails: () => void;
  onDismiss: () => void;
}

export function agentConnectionInstructions(
  origin: string,
  claimCode: string,
): string {
  return renderAgentConnectionInstructions(origin, claimCode);
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
    | "pendingOperation"
    | "onPause"
    | "onResume"
    | "onReconnect"
    | "onNewConnection"
    | "onRevoke"
  >,
): ReactNode {
  if (props.pendingOperation === "creating" || props.status === "creating")
    return (
      <div className="agent-controls">
        <span role="status">Preparing connection…</span>
        <button
          type="button"
          data-testid="agent-revoke"
          onClick={props.onRevoke}
        >
          Cancel connection
        </button>
      </div>
    );
  const progress = props.pendingOperation ? (
    <span role="status">
      {props.pendingOperation === "disconnecting"
        ? "Disconnected locally; confirming with server…"
        : props.pendingOperation === "pausing"
          ? "Pausing…"
          : "Resuming…"}
    </span>
  ) : null;
  const terminal = props.status === "revoked" || props.status === "expired";
  if (terminal) {
    return (
      <div className="agent-controls">
        {progress}
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
  if (props.status === "idle") {
    return (
      <div className="agent-controls">
        <button
          type="button"
          data-testid="agent-connect"
          onClick={props.onNewConnection}
        >
          Connect Agent
        </button>
      </div>
    );
  }
  return (
    <div className="agent-controls">
      {progress}
      {props.status === "connected" ||
      props.status === "waiting-for-agent" ||
      props.status === "working" ? (
        <button
          type="button"
          data-testid="agent-pause"
          onClick={props.onPause}
          disabled={Boolean(props.pendingOperation)}
        >
          Pause
        </button>
      ) : null}
      {props.status === "paused" ? (
        <button
          type="button"
          data-testid="agent-resume"
          onClick={props.onResume}
          disabled={Boolean(props.pendingOperation)}
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
  now,
  status,
  controls,
}: Pick<ConnectAgentPanelProps, "claimCode" | "claimExpiresAt" | "status"> & {
  now: number;
  controls: ReactNode;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [claimCode]);
  const claimExpired = claimExpiresAt !== null && now >= claimExpiresAt;
  const instructions =
    claimCode !== null && !claimExpired
      ? agentConnectionInstructions(
          typeof window === "undefined"
            ? "http://localhost"
            : window.location.origin,
          claimCode,
        )
      : null;

  return (
    <div className="agent-connection-content">
      <div className="agent-connection-toolbar">
        {instructions !== null ? (
          <button
            type="button"
            className="agent-copy-button"
            data-testid="agent-copy-instructions"
            aria-label={
              copied ? "Connection setup copied" : "Copy connection setup"
            }
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(instructions);
                setCopied(true);
                setCopyFailed(false);
              } catch {
                setCopied(false);
                setCopyFailed(true);
                textRef.current?.focus();
                textRef.current?.select();
              }
            }}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              {copied ? (
                <path d="m4 10 4 4 8-8" />
              ) : (
                <>
                  <rect x="6.5" y="3.5" width="10" height="11" rx="2" />
                  <path d="M13.5 14.5v.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h1.5" />
                </>
              )}
            </svg>
            <span aria-live="polite">{copied ? "Copied" : "Copy message"}</span>
          </button>
        ) : null}
        {controls}
      </div>
      {instructions !== null ? (
        <div className="agent-claim" data-testid="agent-claim">
          <p className="agent-connection-hint">
            Paste this message into your Agent chat to connect.
          </p>
          <textarea
            ref={textRef}
            className="agent-message"
            data-testid="agent-copy-text"
            aria-label="Agent connection message"
            readOnly
            value={instructions}
            onFocus={(event) => event.currentTarget.select()}
          />
          {copyFailed ? (
            <p className="agent-panel-error" role="alert">
              Copy was blocked. The message is selected; press Ctrl+C or ⌘C to
              copy it.
            </p>
          ) : null}
          <div className="agent-message-footer">
            <span>
              Connection code expires in {formatRemaining(claimExpiresAt, now)}
            </span>
            <span>Keep this editor open.</span>
          </div>
        </div>
      ) : claimExpired && status === "waiting-for-agent" ? (
        <p className="agent-connection-hint" data-testid="agent-claim-expired">
          Connection message expired. Choose New connection to try again.
        </p>
      ) : null}
    </div>
  );
}

export function ConnectAgentPanel(props: ConnectAgentPanelProps): ReactNode {
  const clock = useClock(props.open, props.now);
  if (!props.open) return null;

  return (
    <div
      className="agent-panel"
      data-testid="connect-agent-panel"
      data-status={props.status}
    >
      <section
        className="agent-dialog agent-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Connect Agent"
      >
        <div className="agent-panel-header">
          <div className="agent-panel-heading">
            <h2>Connect Agent</h2>
            <p className="agent-panel-status" data-testid="agent-status">
              {STATUS_LABEL[props.status]}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="agent-panel-close"
            aria-label="Close Agent dialog"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        {props.error ? (
          <p className="agent-panel-error" role="alert">
            {props.error}
          </p>
        ) : null}

        <ClaimHandOff
          {...props}
          now={clock}
          controls={<ConnectionControls {...props} />}
        />
        {props.status !== "idle" &&
        props.status !== "creating" &&
        props.status !== "revoked" &&
        props.status !== "expired" ? (
          <p className="agent-connection-hint" data-testid="agent-idle-policy">
            Expires after 30 minutes without Agent operations or manual edits.
            Activity keeps the connection alive.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function AgentPropertiesSection(
  props: AgentPropertiesSectionProps,
): ReactNode {
  const clock = useClock(true, Date.now());
  if (props.status === "idle" && !props.error && !props.pendingOperation)
    return null;
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
            {STATUS_LABEL[props.status]}
          </p>
        </div>
        <div className="agent-properties-actions">
          {!props.expanded &&
          (props.pendingOperation || props.status === "idle") ? (
            <ConnectionControls {...props} />
          ) : null}
          {!props.expanded &&
          !props.pendingOperation &&
          (props.status === "connected" ||
            props.status === "waiting-for-agent" ||
            props.status === "working") ? (
            <button
              type="button"
              data-testid="agent-pause"
              onClick={props.onPause}
            >
              Pause
            </button>
          ) : null}
          {!props.expanded &&
          !props.pendingOperation &&
          props.status === "paused" ? (
            <button
              type="button"
              data-testid="agent-resume"
              onClick={props.onResume}
            >
              Resume
            </button>
          ) : null}
          {!props.expanded &&
          !props.pendingOperation &&
          (props.status === "offline" || props.status === "reconnecting") ? (
            <button
              type="button"
              data-testid="agent-reconnect"
              onClick={props.onReconnect}
            >
              Retry relay
            </button>
          ) : null}
          {!props.expanded && !props.pendingOperation && terminal ? (
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
          <ClaimHandOff
            {...props}
            now={clock}
            controls={
              <>
                <ConnectionControls {...props} />
                {terminal ? (
                  <button
                    type="button"
                    className="agent-dismiss"
                    onClick={props.onDismiss}
                  >
                    Dismiss
                  </button>
                ) : null}
              </>
            }
          />
        </div>
      ) : null}
      {props.error ? (
        <p className="agent-panel-error" role="alert">
          {props.error}
        </p>
      ) : null}
    </section>
  );
}
