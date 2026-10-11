// The browser Agent's hosts on the live editor: the document host and its
// planning context, the per-Project file and simulation resources, and the
// Agent session the editor connects through.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  AgentFileCandidateSummary,
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
  AgentProjectResourceRequest,
  AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type { CircuitProject, GridRect } from "@icm/model";
import type { AgentGalleryPublication } from "../agent/agent-gallery-publish";
import type { BrowserAgentPlanningContext } from "../agent/browser-agent-command";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import type { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import { BrowserAgentSimulationHost } from "../agent/browser-agent-simulation-host";
import { peekAgentSessionRecovery } from "../agent/session-recovery";
import type { UseAgentSessionOptions } from "../agent/use-agent-session";
import { useEditorAgentSession } from "../agent/workspace-agent";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { ProjectWorkspace } from "../document/project-workspace";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type {
  ReplaceProjectOptions,
  useProjectFileLifecycle,
} from "../document/use-project-file-lifecycle";
import type { GalleryPublicationRecord } from "../features/editor-shell/gallery-publish";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { NetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  placementModelTarget,
  placementProcessFill,
  processTargetForShortName,
} from "../features/netlist-export/netlist-process";
import type { resolveSimulationTransport } from "../features/simulation/deployment-transport";
import { ProjectRunHistory } from "../features/simulation/project-run-history";
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;

type SessionOptions = Parameters<typeof useEditorAgentSession>[0];
function useWebAgentSession(options: SessionOptions | null) {
  if (!options) throw new Error("Web Agent hosts were not assembled");
  return useEditorAgentSession(options);
}
// The host is fixed for the entire build, so every render calls the same hook.
const useHostAgentSession = import.meta.env?.ICM_DESKTOP
  ? (_options: SessionOptions | null) => null
  : useWebAgentSession;

/** The Agent session a refreshed tab resumes, read once at startup. */
export function useAgentStartupRecovery({
  capabilities,
  restoredWorkspace,
  initialGalleryEntryId,
  recoveryWorkingCopyId,
}: {
  capabilities: EditorServices["capabilities"];
  restoredWorkspace: ProjectWorkspace | null;
  initialGalleryEntryId: string | null;
  recoveryWorkingCopyId: UseRecoveryCoordinatorResult["workingCopyId"];
}) {
  const [agentStartupRecovery] = useState(() => {
    if (
      import.meta.env?.ICM_DESKTOP ||
      !capabilities.agent ||
      typeof window === "undefined" ||
      restoredWorkspace
    )
      return null;
    const search = new URLSearchParams(window.location.search);
    if (
      initialGalleryEntryId !== null ||
      search.has("example") ||
      search.has("project") ||
      search.has("history") ||
      search.get("new") === "1"
    )
      return null;
    const saved = peekAgentSessionRecovery(window.sessionStorage);
    return saved?.projectSessionId === recoveryWorkingCopyId ? saved : null;
  });
  return agentStartupRecovery;
}

/** The Agent's host on the active document, with its planning context. */
export function useBrowserAgentHost({
  editorDocumentController,
  projectSessionId,
  synchronizeExternalCommit,
  flushRecovery,
}: {
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
}) {
  const agentSemanticIntentRef = useRef<
    (request: AgentHostSemanticIntentRequest) => AgentHostSemanticIntentResult
  >(() => ({
    ok: false,
    code: "SEMANTIC_CONTROL_UNAVAILABLE",
    message: "The editor is still initializing semantic controls",
  }));
  // An Agent places a transistor in the Process a person placing it would
  // get; the preferences are read when it plans, not when the host is made.
  const netlistPreferencesRef = useRef<NetlistExportPreferences | null>(null);
  const agentPlanning = useMemo<BrowserAgentPlanningContext>(
    () => ({
      processModelTarget: (source, symbolId) =>
        netlistPreferencesRef.current
          ? placementModelTarget(
              source,
              netlistPreferencesRef.current,
              symbolId,
            )
          : undefined,
      processTargetForShortName: (source, symbolId, name) =>
        netlistPreferencesRef.current
          ? processTargetForShortName(
              source,
              netlistPreferencesRef.current,
              symbolId,
              name,
            )
          : undefined,
      processFill: (source, documentId, edits) =>
        netlistPreferencesRef.current
          ? placementProcessFill(
              source,
              netlistPreferencesRef.current,
              documentId,
              edits,
            )
          : undefined,
    }),
    [],
  );
  const commitCallbacks = useRef({ synchronizeExternalCommit, flushRecovery });
  commitCallbacks.current = { synchronizeExternalCommit, flushRecovery };
  const browserAgentHost = useMemo(
    () =>
      !import.meta.env?.ICM_DESKTOP
        ? new BrowserAgentHost(
            editorDocumentController,
            () => {
              commitCallbacks.current.synchronizeExternalCommit();
              // Agent commits have already crossed a network boundary. Start the
              // durable write immediately so a following render crash cannot lose
              // the acknowledged transaction inside the debounce window.
              void commitCallbacks.current.flushRecovery();
            },
            (request) => agentSemanticIntentRef.current(request),
            undefined,
            agentPlanning,
          )
        : null,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a replacement session must receive a new host even if its controller is reused
    [editorDocumentController, projectSessionId, agentPlanning],
  );
  return {
    agentSemanticIntentRef,
    netlistPreferencesRef,
    agentPlanning,
    browserAgentHost,
  };
}

/** The Agent's file, run-history and simulation services for each Project. */
export function useAgentProjectResources({
  editorDocumentController,
  projectSessionId,
  browserAgentHost,
  simulationTransport,
  projectSwitchBlockerRef,
  openProjectInTabRef,
}: {
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  browserAgentHost: BrowserAgentHost | null;
  simulationTransport: ReturnType<typeof resolveSimulationTransport>;
  projectSwitchBlockerRef: RefObject<() => string | null>;
  openProjectInTabRef: RefObject<
    (
      project: CircuitProject,
      view: GridRect,
      options: ReplaceProjectOptions,
      background?: boolean,
    ) => Promise<boolean>
  >;
}) {
  const [agentFileCandidate, setAgentFileCandidate] =
    useState<AgentFileCandidateSummary | null>(null);
  // Execution and artifacts belong to their originating controller, not the
  // currently selected tab. Re-selecting a tab restores the same service.
  const agentProjectResources = useRef(
    new Map<
      EditorDocumentController,
      Map<
        string,
        {
          files: BrowserAgentFileHost;
          history: ProjectRunHistory;
          simulation: BrowserAgentSimulationHost;
        }
      >
    >(),
  );
  let resources = agentProjectResources.current.get(editorDocumentController);
  if (!resources) {
    resources = new Map();
    agentProjectResources.current.set(editorDocumentController, resources);
  }
  const resourceKey = `${projectSessionId}:${simulationTransport}`;
  const browserAgentFileHost = useMemo(
    () =>
      !import.meta.env?.ICM_DESKTOP && browserAgentHost
        ? (resources.get(resourceKey)?.files ??
          new BrowserAgentFileHost({
            transport: simulationTransport,
            getProjectSessionId: () =>
              editorDocumentController.projectSessionId,
            getProject: () => editorDocumentController.project,
            getDocument: (documentId) =>
              editorDocumentController.project.documents.find(
                (candidate) => candidate.id === documentId,
              ) ?? null,
            getResolver: () => editorDocumentController.resolver,
            onApprovalRequested: setAgentFileCandidate,
            getActiveDocumentId: () => editorDocumentController.document.id,
            commitProjectStructure: (next, active) =>
              browserAgentHost.commitProjectStructure(next, active),
            describeOpenBlocker: () => projectSwitchBlockerRef.current(),
            openProjectInNewTab: (candidate, background) =>
              openProjectInTabRef.current(
                candidate,
                DEFAULT_VIEWBOX,
                {
                  source: "opened-file",
                  agentEdited: true,
                },
                background,
              ),
            dispatchProjectTransaction: (request) =>
              browserAgentHost.dispatchProjectTransaction(request),
          }))
        : null,
    [
      editorDocumentController,
      resourceKey,
      simulationTransport,
      resources,
      browserAgentHost,
      openProjectInTabRef,
      projectSwitchBlockerRef,
    ],
  );
  const projectRunHistory = useMemo(
    () =>
      !import.meta.env?.ICM_DESKTOP
        ? (resources.get(resourceKey)?.history ??
          new ProjectRunHistory(editorDocumentController.project.id))
        : null,
    [editorDocumentController, resourceKey, resources],
  );
  useEffect(() => {
    projectRunHistory?.activate();
  }, [projectRunHistory]);
  const browserAgentSimulationHost = useMemo(
    () =>
      !import.meta.env?.ICM_DESKTOP && browserAgentFileHost && projectRunHistory
        ? (resources.get(resourceKey)?.simulation ??
          new BrowserAgentSimulationHost({
            runHistory: projectRunHistory,
            owner: "agent",
            files: browserAgentFileHost.simulationFiles,
            getProjectSessionId: () =>
              editorDocumentController.projectSessionId,
            getProject: () => editorDocumentController.project,
            transport: simulationTransport,
          }))
        : null,
    [
      browserAgentFileHost,
      resources,
      projectRunHistory,
      editorDocumentController,
      resourceKey,
      simulationTransport,
    ],
  );
  if (browserAgentFileHost && projectRunHistory && browserAgentSimulationHost)
    resources.set(resourceKey, {
      files: browserAgentFileHost,
      history: projectRunHistory,
      simulation: browserAgentSimulationHost,
    });
  useEffect(
    () => () => {
      for (const group of agentProjectResources.current.values())
        for (const resource of group.values()) resource.history.dispose();
    },
    [],
  );
  const agentWorkspaceRef = useRef<
    (
      request: Extract<AgentProjectResourceRequest, { operation: "workspace" }>,
      targetWorkspaceId?: string,
    ) => Promise<AgentProjectResourceResponse>
  >(async () => {
    throw new Error("Workspace is initializing");
  });
  // The working copy an Agent publishes from, read when its request arrives.
  const agentGalleryPublicationRef = useRef<
    () => AgentGalleryPublication & {
      controller: EditorDocumentController;
      sessionId: string;
    }
  >(() => {
    throw new Error("The Editor is initializing");
  });
  const recordGalleryPublicationRef = useRef<
    (
      outcome: GalleryPublicationRecord,
      sessionId: string,
      by: "person" | "agent",
    ) => boolean
  >(() => false);
  return {
    agentFileCandidate,
    setAgentFileCandidate,
    agentProjectResources,
    browserAgentFileHost,
    projectRunHistory,
    browserAgentSimulationHost,
    agentWorkspaceRef,
    agentGalleryPublicationRef,
    recordGalleryPublicationRef,
  };
}

/** The Agent session the editor connects through, and its file approvals. */
export function useEditorAgentConnection({
  publicAgentUiEnabled,
  restoringWorkspace,
  setAgentStatusDismissed,
  setAgentPanelOpen,
  setStatus,
  recoveryWorkingCopyId,
  stageRecovery,
  flushRecovery,
  agentStartupRecovery,
  project,
  browserAgentHost,
  agentFileCandidate,
  setAgentFileCandidate,
  browserAgentFileHost,
  browserAgentSimulationHost,
  browserAgentProjectHost,
  captureAuthoredProject,
  cloudBinding,
  startupRestoreReady,
  isDirtyWork,
  replaceActiveProject,
  guardDirtyReplacement,
}: {
  publicAgentUiEnabled: boolean;
  restoringWorkspace: boolean;
  setAgentStatusDismissed: EditorPanels["setAgentStatusDismissed"];
  setAgentPanelOpen: EditorPanels["setAgentPanelOpen"];
  setStatus: Dispatch<SetStateAction<string>>;
  recoveryWorkingCopyId: UseRecoveryCoordinatorResult["workingCopyId"];
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  agentStartupRecovery: ReturnType<typeof useAgentStartupRecovery>;
  project: CircuitProject;
  browserAgentHost: BrowserAgentHost | null;
  agentFileCandidate: AgentFileCandidateSummary | null;
  setAgentFileCandidate: Dispatch<
    SetStateAction<AgentFileCandidateSummary | null>
  >;
  browserAgentFileHost: BrowserAgentFileHost | null;
  browserAgentSimulationHost: BrowserAgentSimulationHost | null;
  browserAgentProjectHost: BrowserAgentProjectHost | null;
  captureAuthoredProject: () => Promise<CircuitProject | null>;
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  startupRestoreReady: ProjectFileLifecycle["startupRestoreReady"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  replaceActiveProject: ProjectFileLifecycle["replaceActiveProject"];
  guardDirtyReplacement: ProjectFileLifecycle["guardDirtyReplacement"];
}) {
  const agentTargetRef = useRef<
    NonNullable<UseAgentSessionOptions["resolveWorkspace"]>
  >(() => null);
  const backgroundAgentHosts = useRef(
    new Map<
      EditorDocumentController,
      {
        sessionId: string;
        host: BrowserAgentHost;
        fileHost: BrowserAgentFileHost;
        simulationHost: BrowserAgentSimulationHost;
        projectHost: BrowserAgentProjectHost;
      }
    >(),
  );
  const agentSession = useHostAgentSession(
    !import.meta.env?.ICM_DESKTOP &&
      browserAgentHost &&
      browserAgentFileHost &&
      browserAgentSimulationHost &&
      browserAgentProjectHost
      ? {
          // A restored workspace is already the requested circuit. Resume its
          // matching Agent only after the active Project and working copy are installed.
          recover: true,
          beforeConnect: async () => {
            const snapshot = await captureAuthoredProject();
            if (snapshot) {
              stageRecovery(snapshot, {
                unsavedAtSnapshot: isDirtyWork() || snapshot !== project,
                cloudBinding,
              });
              await flushRecovery();
            }
          },
          enabled:
            publicAgentUiEnabled &&
            !restoringWorkspace &&
            (startupRestoreReady ||
              recoveryWorkingCopyId !== agentStartupRecovery?.projectSessionId),
          project,
          projectSessionId: recoveryWorkingCopyId,
          host: browserAgentHost,
          fileHost: browserAgentFileHost,
          simulationHost: browserAgentSimulationHost,
          projectHost: browserAgentProjectHost,
          resolveWorkspace: (workspaceId) =>
            agentTargetRef.current(workspaceId),
        }
      : null,
  );
  useEffect(() => {
    if (!publicAgentUiEnabled) return;
    setAgentStatusDismissed(false);
  }, [agentSession?.status, publicAgentUiEnabled]);

  function approveAgentFileCandidate(): void {
    if (!agentFileCandidate || !browserAgentFileHost) return;
    const meta = agentFileCandidate;
    void guardDirtyReplacement(`Accept Agent ${meta.kind} candidate`, () => {
      const candidate = browserAgentFileHost.consumeApproved(meta.candidateId);
      setAgentFileCandidate(null);
      if (!candidate) {
        setStatus(
          "Agent file candidate expired; ask the Agent to stage it again",
        );
        return;
      }
      replaceActiveProject(candidate, DEFAULT_VIEWBOX, {
        source: "opened-file",
        agentEdited: true,
      });
      setStatus(`Accepted Agent ${meta.kind} candidate: ${candidate.name}`);
    });
  }

  function rejectAgentFileCandidate(): void {
    if (!agentFileCandidate || !browserAgentFileHost) return;
    browserAgentFileHost.discard(agentFileCandidate.candidateId);
    setAgentFileCandidate(null);
    setStatus("Rejected Agent file candidate");
  }

  const openAgentConnection = () => {
    if (!agentSession) return;
    setAgentPanelOpen(true);
    if (
      agentSession.status === "idle" ||
      agentSession.status === "revoked" ||
      agentSession.status === "expired" ||
      (agentSession.status === "waiting-for-agent" &&
        agentSession.claimExpiresAt !== null &&
        agentSession.claimExpiresAt <= Date.now())
    ) {
      void agentSession.newConnection();
    }
  };
  return {
    agentTargetRef,
    backgroundAgentHosts,
    agentSession,
    approveAgentFileCandidate,
    rejectAgentFileCandidate,
    openAgentConnection,
  };
}
