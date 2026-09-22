import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createEmptyProject } from "@icm/model";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";
import { PUBLIC_AGENT_UI_ENABLED } from "./public-agent-ui";
import {
  useAgentSession,
  type UseAgentSessionOptions,
  type UseAgentSessionResult,
} from "./use-agent-session";

const WorkspaceAgent = createContext<{
  session: UseAgentSessionResult;
  bind: (context: UseAgentSessionOptions | null) => void;
} | null>(null);

/** Connection owner above route-specific Editor hosts. No circuit is exposed in Gallery. */
export function WorkspaceAgentProvider({ children }: { children: ReactNode }) {
  return useContext(WorkspaceAgent) ? (
    children
  ) : (
    <WorkspaceAgentOwner>{children}</WorkspaceAgentOwner>
  );
}

function WorkspaceAgentOwner({ children }: { children: ReactNode }) {
  const [context, bind] = useState<UseAgentSessionOptions | null>(null);
  const [empty] = useState(() => {
    const project = createEmptyProject(
      "no-active-project",
      "No active Project",
    );
    const contextRevision = crypto.randomUUID();
    return {
      enabled: PUBLIC_AGENT_UI_ENABLED,
      contextReady: false,
      contextRevision,
      projectSessionId: contextRevision,
      project,
      host: new BrowserAgentHost(new EditorDocumentController(project)),
    };
  });
  const session = useAgentSession(context ?? empty);
  return (
    <WorkspaceAgent.Provider value={{ session, bind }}>
      {children}
    </WorkspaceAgent.Provider>
  );
}

export function useEditorAgentSession(
  options: Omit<UseAgentSessionOptions, "contextRevision">,
): UseAgentSessionResult {
  const shared = useContext(WorkspaceAgent);
  if (!shared) throw new Error("Editor requires the workspace Agent provider");
  const revision = useMemo(() => crypto.randomUUID(), [options.host]);
  const latest = useRef(options);
  latest.current = options;
  const { bind } = shared;
  useLayoutEffect(() => {
    bind({
      ...options,
      beforeConnect: async () => latest.current.beforeConnect?.(),
      contextRevision: revision,
      projectSessionId: revision,
    });
  }, [
    bind,
    revision,
    options.enabled,
    options.project,
    options.host,
    options.fileHost,
    options.simulationHost,
    options.projectHost,
    options.recover,
  ]);
  useLayoutEffect(() => () => bind(null), [bind]);
  return shared.session;
}
