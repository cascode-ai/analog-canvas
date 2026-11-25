// The browser Agent runtime, loaded on demand through agent-runtime-loader
// (#1673): the hosts that serve Agent requests and the session that carries
// them. Nothing on the editor's first load imports this module.
import { memo, useEffect, useLayoutEffect, useState } from "react";
import { createEmptyProject } from "@icm/model";
import { EditorDocumentController } from "../document/document-controller";
import { readRnl, type RnlReader } from "../features/netlist-export/rnl-read";
import { loadRnlRuntime } from "../features/netlist-export/rnl-runtime";
import { BrowserAgentHost } from "./browser-agent-host";
import {
  useAgentSession,
  type UseAgentSessionOptions,
  type UseAgentSessionResult,
} from "./use-agent-session";

export { BrowserAgentHost } from "./browser-agent-host";
export { BrowserAgentFileHost } from "./browser-agent-file-host";
export { BrowserAgentSimulationHost } from "./browser-agent-simulation-host";
export { BrowserAgentProjectHost } from "./browser-agent-project-host";
export {
  adapterReadsPublishAdvice,
  createAgentGalleryPublisher,
  publishAdviceOf,
} from "./agent-gallery-publish";
export { createAgentSemanticIntentHandler } from "./agent-semantic-intent-handler";

export const readRnlBrowser: RnlReader = (project, options) =>
  readRnl(project, options, loadRnlRuntime);

/**
 * The workspace's Agent session. It runs beside the page the workspace
 * provider wraps and hands each state of the session to that provider.
 * Until an editor binds its hosts, the session serves an empty Project, as
 * Gallery does (no circuit is exposed there).
 */
export const AgentSessionRuntime = memo(function AgentSessionRuntime({
  context,
  enabled,
  connectRequested,
  onSession,
  onConnectHandled,
}: {
  context: UseAgentSessionOptions | null;
  enabled: boolean;
  /** Connect Agent was asked for before this runtime had loaded. */
  connectRequested: boolean;
  onSession: (session: UseAgentSessionResult) => void;
  onConnectHandled: () => void;
}) {
  const [empty] = useState(() => {
    const project = createEmptyProject(
      "no-active-project",
      "No active Project",
    );
    const contextRevision = crypto.randomUUID();
    return {
      enabled,
      contextReady: false,
      contextRevision,
      projectSessionId: contextRevision,
      project,
      host: new BrowserAgentHost(new EditorDocumentController(project)),
    };
  });
  const session = useAgentSession({
    ...(context ?? empty),
    enabled: enabled && (context?.enabled ?? empty.enabled),
  });
  // Before paint, so the page never shows a session state older than this.
  useLayoutEffect(() => {
    onSession(session);
  });
  // The click that loaded this runtime connects once the editor is bound,
  // as Connect Agent does: only when no connection is in place or being
  // resumed. A saved session being recovered is kept, never replaced, so
  // its record is not cleared and the old session is not orphaned.
  useEffect(() => {
    if (!connectRequested || !context) return;
    onConnectHandled();
    if (["idle", "revoked", "expired"].includes(session.status))
      void session.newConnection();
  }, [connectRequested, context, onConnectHandled, session]);
  return null;
});
