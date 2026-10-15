import { lazy, Suspense, useRef, useState } from "react";
import { useDismissDetails } from "../../components/dismiss-details";
import { useWorkspaceAgentConnection } from "../../agent/workspace-agent";
import { claimNow } from "../../agent/claim-clock";
import type { ComponentAuthoringWorkspace } from "./component-authoring-workspace";

const ConnectionPanel = lazy(() =>
  import("../../agent/connect-agent-panel").then((module) => ({
    default: module.ConnectAgentPanel,
  })),
);

export function ComponentAgentControls({
  workspace,
  label = "Current draft",
}: {
  workspace: ComponentAuthoringWorkspace;
  label?: string;
}) {
  const session = useWorkspaceAgentConnection();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useDismissDetails(menu);
  if (!session) return null;
  return (
    <div
      className="component-agent-controls"
      onKeyDown={(event) => {
        if (connectionOpen && event.key === "Escape") {
          event.stopPropagation();
          setConnectionOpen(false);
        }
      }}
    >
      <details ref={menu}>
        <summary>Use Agent</summary>
        <div className="component-agent-menu">
          <span className="component-agent-target" title={label}>
            {label} · {workspace.scope}
          </span>
          <button
            type="button"
            onClick={() => {
              setConnectionOpen(true);
              if (["idle", "revoked", "expired"].includes(session.status))
                void session.newConnection();
            }}
          >
            Connect Agent
          </button>
        </div>
      </details>
      {connectionOpen ? (
        <Suspense fallback={null}>
          <ConnectionPanel
            open
            status={session.status}
            pendingOperation={session.pendingOperation}
            claimCode={session.claimCode}
            claimExpiresAt={session.claimExpiresAt}
            scopes={session.scopes}
            expiresAt={session.expiresAt}
            error={session.error}
            backgroundRequests={session.backgroundRequests}
            now={claimNow()}
            onPause={() => void session.pause()}
            onResume={() => void session.resume()}
            onReconnect={session.reconnect}
            onNewConnection={() => void session.newConnection()}
            onRevoke={() => void session.revoke()}
            onClose={() => setConnectionOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
