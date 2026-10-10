// Project tabs and their sessions: what a tab captures and restores, how the
// window's tabs are saved and reopened, and what holds the editor on a tab.
import { parseProject, serializeProject } from "@icm/project-protocol";
import type { HierarchyFrame } from "@icm/derived";
import {
  createEmptyProject,
  createId,
  type CircuitProject,
  type GridRect,
} from "@icm/model";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import type { CameraRectInput } from "../canvas/fit-view";
import type { CameraRuntime } from "../canvas/camera-runtime";
import {
  EditorDocumentController,
  type useDocumentController,
} from "../document/document-controller";
import { projectChangeToken } from "../document/project-session-lifecycle";
import type { createProjectSnapshotSerializer } from "../document/project-snapshot-serializer";
import {
  browserWorkspaceStore,
  journalProjectWorkspace,
  openWorkspaceWindows,
  workspaceRoute,
  workspaceWindowId,
  type ProjectWorkspace,
} from "../document/project-workspace";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type {
  ReplaceProjectOptions,
  useProjectFileLifecycle,
} from "../document/use-project-file-lifecycle";
import { useProjectTabs } from "../document/use-project-tabs";
import {
  findWorkspaceReopenOffer,
  planWorkspaceReopen,
  type WorkspaceReopenSummary,
} from "../document/workspace-reopen";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import {
  editInProgressReason,
  projectHoldReason,
} from "../features/editor-shell/edit-blockers";
import type { SpiceImportReport } from "../features/editor-shell/editor-file-commands";
import type { GalleryEntryContext } from "../features/editor-shell/gallery-example-commands";
import type { PublishGalleryDraft } from "../features/editor-shell/publish-gallery-dialog";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { usePropertiesEditor } from "../features/properties/use-properties-editor";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { resolveTextEditingTarget } from "../features/text-editing/text-editing";
import type { useInteractionState } from "../interaction/interaction-state";
import type { PlacementOrientationOperation } from "../interaction/shortcut-orientation";
import { materializeRazaviProjectBulkConnections } from "../presentation/razavi-presentation";
import type { ComponentEditorSession } from "./component-editor-session";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type { EditorProjectPanelMode } from "./editor-project-dock";
import type { HighlightedNetOrigin } from "./use-editor-derived-model";
import type { useAgentProjectResources } from "./use-agent-hosts";
import { executeProjectTransaction } from "@icm/edit-engine";
import type { CloudProjectStore } from "../services/editor-services";
import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type SelectionController = ReturnType<typeof useSelectionController>;
type InteractionState = ReturnType<
  typeof useInteractionState<SchematicClipboard>
>;
type AgentProjectResources = ReturnType<typeof useAgentProjectResources>;
type AgentProjectResourcesOptions = Parameters<
  typeof useAgentProjectResources
>[0];

interface ProjectTabSessionsOptions {
  projectStore: CloudProjectStore | null;
  onCloudProjectSaved(project: CloudProjectSummary): void;
  onCloudProjectsDeleted(projects: readonly CloudProjectSummary[]): void;
  initialProject: CircuitProject | undefined;
  restoredWorkspace: ProjectWorkspace | null;
  workspaceError: string | null;
  setRestoringWorkspace: Dispatch<SetStateAction<boolean>>;
  preparedInitialProject: CircuitProject;
  setStatus: Dispatch<SetStateAction<string>>;
  componentEditor: ComponentEditorSession | null;
  selectionOpen: boolean;
  setSelectionOpen: EditorPanels["setSelectionOpen"];
  snapshotSerializer: ReturnType<typeof createProjectSnapshotSerializer>;
  captureRecoverySession: UseRecoveryCoordinatorResult["captureWorkingSession"];
  resumeRecoverySession: UseRecoveryCoordinatorResult["resumeWorkingSession"];
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  writeRecoverySessionSnapshot: UseRecoveryCoordinatorResult["writeSessionSnapshot"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  openWorkingCopyIdsRef: RefObject<() => readonly string[]>;
  project: CircuitProject;
  activateDocumentSession: DocumentControllerState["activateSession"];
  editorDocumentController: EditorDocumentController;
  documentStack: HierarchyFrame[];
  setDocumentStack: Dispatch<SetStateAction<HierarchyFrame[]>>;
  visualSelection: SelectionController["selection"];
  replaceSelection: SelectionController["replace"];
  cameraRuntime: CameraRuntime;
  setViewBox: (
    next: GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput),
    grid?: number,
  ) => void;
  setImportReport: Dispatch<SetStateAction<SpiceImportReport | null>>;
  setImportReviewOpen: Dispatch<SetStateAction<boolean>>;
  setCanvasContextMenu: Dispatch<
    SetStateAction<{ x: number; y: number } | null>
  >;
  setNetlistPreflightOpen: Dispatch<SetStateAction<boolean>>;
  projectPanel: EditorProjectPanelMode | null;
  setProjectPanel: Dispatch<SetStateAction<EditorProjectPanelMode | null>>;
  setNetlistFocusedInstance: Dispatch<
    SetStateAction<{ documentId: string; instanceId: string } | null>
  >;
  netlistEntry: { sessionId: string; documentId: string } | null;
  setNetlistEntry: Dispatch<
    SetStateAction<{ sessionId: string; documentId: string } | null>
  >;
  documentSettingsOpen: boolean;
  projectInfoOpen: boolean;
  setProjectInfoOpen: Dispatch<SetStateAction<boolean>>;
  projectNameEditing: RefObject<boolean>;
  publishGalleryOpen: boolean;
  versionHistoryOpen: boolean;
  galleryEntryContext: GalleryEntryContext | null;
  setGalleryEntryContext: Dispatch<SetStateAction<GalleryEntryContext | null>>;
  projectSwitchBlockerRef: RefObject<() => string | null>;
  openProjectInTabRef: AgentProjectResourcesOptions["openProjectInTabRef"];
  setAgentFileCandidate: AgentProjectResources["setAgentFileCandidate"];
  setAnalogSimulationState: Dispatch<
    SetStateAction<"closed" | "open" | "maximized" | "minimized">
  >;
  codeDraftDirty: boolean;
  captureAuthoredProject: () => Promise<CircuitProject | null>;
  captureFileSession: ProjectFileLifecycle["captureFileSession"];
  restoreFileSession: ProjectFileLifecycle["restoreFileSession"];
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  replaceGuard: ProjectFileLifecycle["replaceGuard"];
  recoveryDialogOpen: ProjectFileLifecycle["recoveryDialogOpen"];
  isDirtyWork: ProjectFileLifecycle["isDirtyWork"];
  hasUnsafeWork: ProjectFileLifecycle["hasUnsafeWork"];
  isSaveInFlight: ProjectFileLifecycle["isSaveInFlight"];
  restoreSavedProjectBaseline: ProjectFileLifecycle["restoreSavedProjectBaseline"];
  hasExplicitBootTarget: boolean;
  getCurrentInteractionState: InteractionState["getCurrentState"];
  publishDraft: PublishGalleryDraft | null;
  setPublishDraft: Dispatch<SetStateAction<PublishGalleryDraft | null>>;
  setHighlightedNetOrigin: Dispatch<
    SetStateAction<HighlightedNetOrigin | null>
  >;
  setCodeNetPreview: Dispatch<SetStateAction<HighlightedNetOrigin | null>>;
  carriedCopyRef: RefObject<{
    clipboard: SchematicClipboard;
    orientation: readonly PlacementOrientationOperation[];
  } | null>;
  documentViewBoxes: RefObject<Map<string, GridRect>>;
  textEditing: ReturnType<typeof usePropertiesEditor>["textEditing"];
  textEditingTarget: ReturnType<typeof resolveTextEditingTarget>;
  pendingAutoFitRef: RefObject<boolean>;
  autoFitProjectRef: RefObject<string | null>;
  beginClipboardPlacement: (
    clipboard: SchematicClipboard,
    orientation?: readonly PlacementOrientationOperation[],
  ) => void;
  restoredNewLink: RefObject<boolean>;
  resetInteractionState: () => void;
  cancelAllTransientInteraction: () => void;
  nativeWorkspaceSaving: RefObject<boolean>;
}

/** The window's project tabs: one session per tab, saved with the window. */
export function useProjectTabSessions({
  projectStore,
  onCloudProjectSaved,
  onCloudProjectsDeleted,
  initialProject,
  restoredWorkspace,
  workspaceError,
  setRestoringWorkspace,
  preparedInitialProject,
  setStatus,
  componentEditor,
  selectionOpen,
  setSelectionOpen,
  snapshotSerializer,
  captureRecoverySession,
  resumeRecoverySession,
  stageRecovery,
  writeRecoverySessionSnapshot,
  flushRecovery,
  openWorkingCopyIdsRef,
  project,
  activateDocumentSession,
  editorDocumentController,
  documentStack,
  setDocumentStack,
  visualSelection,
  replaceSelection,
  cameraRuntime,
  setViewBox,
  setImportReport,
  setImportReviewOpen,
  setCanvasContextMenu,
  setNetlistPreflightOpen,
  projectPanel,
  setProjectPanel,
  setNetlistFocusedInstance,
  netlistEntry,
  setNetlistEntry,
  documentSettingsOpen,
  projectInfoOpen,
  setProjectInfoOpen,
  projectNameEditing,
  publishGalleryOpen,
  versionHistoryOpen,
  galleryEntryContext,
  setGalleryEntryContext,
  projectSwitchBlockerRef,
  openProjectInTabRef,
  setAgentFileCandidate,
  setAnalogSimulationState,
  codeDraftDirty,
  captureAuthoredProject,
  captureFileSession,
  restoreFileSession,
  cloudBinding,
  replaceGuard,
  recoveryDialogOpen,
  isDirtyWork,
  hasUnsafeWork,
  isSaveInFlight,
  restoreSavedProjectBaseline,
  hasExplicitBootTarget,
  getCurrentInteractionState,
  publishDraft,
  setPublishDraft,
  setHighlightedNetOrigin,
  setCodeNetPreview,
  carriedCopyRef,
  documentViewBoxes,
  textEditing,
  textEditingTarget,
  pendingAutoFitRef,
  autoFitProjectRef,
  beginClipboardPlacement,
  restoredNewLink,
  resetInteractionState,
  cancelAllTransientInteraction,
  nativeWorkspaceSaving,
}: ProjectTabSessionsOptions) {
  function captureTabSession() {
    return {
      controller: editorDocumentController,
      file: captureFileSession(),
      recovery: captureRecoverySession(),
      view: cameraRuntime.current(),
      cellViews: new Map(documentViewBoxes.current),
      stack: documentStack,
      selection: visualSelection,
      panel: projectPanel,
      properties: selectionOpen,
      publication: galleryEntryContext,
      publishDraft,
      netlistEntry,
      dirty: isDirtyWork(),
      unsafe: hasUnsafeWork() || codeDraftDirty,
      fit: false,
    };
  }
  type TabSession = ReturnType<typeof captureTabSession>;
  function restoreTabSession(session: TabSession) {
    resetInteractionState();
    // The outgoing tab still owns its artifacts and expiring workspaces.
    // Selection changes hide its UI, not its file service.
    setAgentFileCandidate(null);
    setImportReport(null);
    setImportReviewOpen(false);
    setProjectInfoOpen(false);
    setCanvasContextMenu(null);
    setNetlistFocusedInstance(null);
    setHighlightedNetOrigin(null);
    setCodeNetPreview(null);
    setAnalogSimulationState("closed");
    setNetlistPreflightOpen(false);
    activateDocumentSession(session.controller);
    restoreFileSession(session.file);
    resumeRecoverySession(session.recovery);
    documentViewBoxes.current = new Map(session.cellViews);
    setDocumentStack(session.stack);
    setViewBox(session.view, session.controller.document.presentation.grid);
    autoFitProjectRef.current = session.controller.projectSessionId;
    pendingAutoFitRef.current = session.fit;
    replaceSelection(session.selection);
    setSelectionOpen(session.properties);
    setProjectPanel(session.panel);
    setGalleryEntryContext(session.publication);
    setPublishDraft(session.publishDraft);
    setNetlistEntry(session.netlistEntry);
    setStatus(`Switched to ${session.controller.project.name}`);
    setRestoringWorkspace(false);
    stageRecovery(session.controller.project, {
      cloudBinding: session.file.cloudBinding,
      unsavedAtSnapshot: session.dirty,
    });
  }
  function createTabSession(
    nextProject = createEmptyProject(
      createId("project"),
      "New Circuit",
      createId("document"),
    ),
    nextView = DEFAULT_VIEWBOX,
    options: ReplaceProjectOptions = {},
  ): TabSession {
    const prepared =
      materializeRazaviProjectBulkConnections(nextProject).project;
    const controller = new EditorDocumentController(prepared);
    if (options.agentEdited) controller.noteAgentEdit();
    // Identity is allocated without changing the outgoing recovery coordinator.
    return {
      ...captureTabSession(),
      controller,
      file: {
        nativeBinding: options.nativeBinding ?? null,
        persistenceState: options.persistenceState ?? "unbound",
        cloudBinding: options.cloudBinding ?? null,
        savedBaseline: options.savedBaseline ?? null,
        safeSnapshotToken: null,
      },
      recovery: {
        workingCopyId: createId("working-copy"),
        source: options.source ?? "new",
        ...(options.formalFileHint
          ? { formalFileHint: options.formalFileHint }
          : {}),
      },
      view: nextView,
      cellViews: new Map(),
      stack: [],
      selection: {
        instanceIds: [],
        routeIds: [],
        annotationIds: [],
        draftingIds: [],
        junctionIds: [],
      },
      panel: "netlist",
      properties: false,
      publication: null,
      publishDraft: null,
      netlistEntry: null,
      dirty: options.persistenceState === "dirty",
      unsafe: options.persistenceState === "dirty",
      fit: true,
    };
  }
  type PortableTab = Omit<TabSession, "controller" | "cellViews"> & {
    projectText: string;
    activeDocumentId: string;
    cellViews: [string, GridRect][];
    /** Whether an Agent edited it; publishing notes it beside the AI mark. */
    agentEdited?: boolean;
  };
  /** A tab as a window saved it, ready to show again: after a refresh, or
   * when a fresh window reopens the tabs a closed one left (#1250). */
  function tabSessionFromPortable(saved: PortableTab): TabSession {
    const controller = new EditorDocumentController(
      parseProject(saved.projectText),
    );
    if (saved.agentEdited === true) controller.noteAgentEdit();
    if (!controller.openDocument(saved.activeDocumentId))
      throw new Error("Missing active Cell");
    if (
      !saved.file ||
      !saved.recovery ||
      !saved.view ||
      !Array.isArray(saved.stack) ||
      !saved.selection
    )
      throw new Error("Incomplete tab session");
    if (saved.file.savedBaseline)
      saved.file.savedBaseline.project = parseProject(
        serializeProject(saved.file.savedBaseline.project),
      );
    const session: TabSession = {
      ...saved,
      // Cloud publication metadata may change while the page is closed.
      // Keep the local draft, but resolve its current link before publishing.
      publication: saved.file.cloudBinding ? null : saved.publication,
      controller,
      cellViews: new Map(saved.cellViews),
      fit: false,
      netlistEntry: saved.netlistEntry
        ? { ...saved.netlistEntry, sessionId: controller.projectSessionId }
        : null,
      file: {
        ...saved.file,
        persistenceState:
          saved.file.persistenceState === "saving"
            ? "dirty"
            : saved.file.persistenceState,
      },
    };
    return session;
  }
  const [restoredTabs] = useState(() => {
    if (!restoredWorkspace) return { value: null, error: null };
    try {
      const tabs = restoredWorkspace.tabs.map((tab) => ({
        id: tab.id,
        session: tabSessionFromPortable(tab.session as PortableTab),
      }));
      return {
        value: { activeId: restoredWorkspace.activeId, tabs },
        error: null,
      };
    } catch {
      return {
        value: null,
        error:
          "Saved tabs could not be restored. Their original snapshots are retained; export new work before leaving.",
      };
    }
  });
  const workspaceLastSignature = useRef("");
  // Portable records already own one text per open tab. Reuse that text until
  // its immutable snapshot changes, regardless of the computation-cache budget.
  const workspaceTexts = useRef(
    new Map<string, { project: CircuitProject; text: string }>(),
  );
  const snapshotIds = useRef(new WeakMap<CircuitProject, number>());
  const nextSnapshotId = useRef(0);
  const snapshotId = (project: CircuitProject) => {
    let id = snapshotIds.current.get(project);
    if (id === undefined)
      snapshotIds.current.set(project, (id = ++nextSnapshotId.current));
    return id;
  };
  const workspaceLastRecord = useRef<ProjectWorkspace | null>(null);
  const workspaceSaveQueue = useRef(Promise.resolve());
  const workspaceFailure = useRef(false);
  // The closed window whose tabs this one reopened (#1250). Its record goes
  // once this window's own saved record holds every one of those tabs, so
  // no other window offers them again and nothing is lost on the way.
  const reopenedWorkspace = useRef<{
    windowId: string;
    workingCopyIds: string[];
  } | null>(null);
  function releaseReopenedWorkspace(record: ProjectWorkspace): Promise<void> {
    const reopened = reopenedWorkspace.current;
    if (!reopened) return Promise.resolve();
    const held = new Set(
      record.tabs.map(
        ({ session }) => (session as PortableTab).recovery.workingCopyId,
      ),
    );
    if (!reopened.workingCopyIds.every((id) => held.has(id)))
      return Promise.resolve();
    reopenedWorkspace.current = null;
    return browserWorkspaceStore()
      .remove(reopened.windowId)
      .catch(() => {});
  }
  function persistTabs(
    workspace: {
      activeId: string;
      tabs: { id: string; session: TabSession }[];
    },
    final: boolean,
  ) {
    if (
      workspaceError ||
      restoredTabs.error ||
      typeof window === "undefined" ||
      initialProject
    )
      return;
    try {
      snapshotSerializer.retain(
        workspace.tabs.map(({ session }) => session.controller.project),
      );
      const liveIds = new Set(workspace.tabs.map((tab) => tab.id));
      for (const id of workspaceTexts.current.keys())
        if (!liveIds.has(id)) workspaceTexts.current.delete(id);
      const tabs = workspace.tabs.map(({ id, session }) => {
        const { controller, cellViews, ...rest } = session;
        let cached = workspaceTexts.current.get(id);
        if (cached?.project !== controller.project) {
          cached = {
            project: controller.project,
            text: snapshotSerializer.serialize(controller.project),
          };
          workspaceTexts.current.set(id, cached);
        }
        const portable: PortableTab = {
          ...rest,
          cellViews: [...cellViews],
          projectText: cached.text,
          activeDocumentId: controller.document.id,
          agentEdited: controller.agentEdited,
        };
        return { id, session: portable };
      });
      // Compare small session metadata and immutable identities. Escaping all
      // drawing text and saved baselines on every render made switching costly.
      const text = JSON.stringify({
        activeId: workspace.activeId,
        tabs: tabs.map(({ id, session }, index) => ({
          id,
          session: {
            ...session,
            projectText: snapshotId(
              workspace.tabs[index]!.session.controller.project,
            ),
            file: {
              ...session.file,
              savedBaseline: session.file.savedBaseline
                ? {
                    ...session.file.savedBaseline,
                    project: snapshotId(session.file.savedBaseline.project),
                  }
                : null,
            },
          },
        })),
      });
      if (text !== workspaceLastSignature.current) {
        const record: ProjectWorkspace = {
          version: 1,
          windowId: workspaceWindowId(),
          url: workspaceRoute(
            window.location.pathname + window.location.search,
          ),
          savedAt: Date.now(),
          activeId: workspace.activeId,
          tabs,
        };
        workspaceLastSignature.current = text;
        workspaceLastRecord.current = record;
        workspaceSaveQueue.current = workspaceSaveQueue.current
          .then(() => browserWorkspaceStore().write(record))
          .then(
            () => releaseReopenedWorkspace(record),
            () => {
              workspaceLastSignature.current = "";
              if (!workspaceFailure.current) {
                workspaceFailure.current = true;
                setStatus(
                  "Project tabs could not be saved in this browser. Export your work before leaving; earlier copies are retained.",
                );
              }
            },
          );
      }
      if (final && workspaceLastRecord.current)
        journalProjectWorkspace(workspaceLastRecord.current);
    } catch {
      if (!workspaceFailure.current) {
        workspaceFailure.current = true;
        setStatus(
          "The latest tab snapshot could not be saved. Export your work before leaving.",
        );
      }
    }
  }
  useEffect(() => {
    if (restoredTabs.error) {
      setStatus(restoredTabs.error);
      setRestoringWorkspace(false);
    }
  }, [restoredTabs.error]);
  // New Circuit's blank tab joins the ones brought back and is the open one
  // from the first paint: the circuit drawn last is never shown in its place,
  // and a file opened at once lands in the blank tab, not over that circuit.
  const [initialTabs] = useState(() => {
    if (!restoredTabs.value || !restoredNewLink.current)
      return restoredTabs.value;
    const id = createId("tab");
    return {
      activeId: id,
      tabs: [...restoredTabs.value.tabs, { id, session: createTabSession() }],
    };
  });
  // What keeps the editor on this Project now (#1462).
  const editInProgress = () => ({
    componentEditor: !!componentEditor,
    documentSettingsOpen,
    projectInfoOpen,
    projectNameEditing: projectNameEditing.current,
    textEditing: !!textEditing,
    textOnScreen: !!textEditingTarget,
    codeDraftDirty,
  });
  const currentEditBlocker = () => editInProgressReason(editInProgress());
  const [cloudManagementBusy, setCloudManagementBusy] = useState(false);
  const cloudMutation = useRef(false);
  const projectSwitchBlocker = () =>
    projectHoldReason({
      ...editInProgress(),
      saving:
        isSaveInFlight() ||
        nativeWorkspaceSaving.current ||
        cloudMutation.current,
      replaceGuard: !!replaceGuard,
      recoveryDialogOpen,
      publishGalleryOpen,
      versionHistoryOpen,
    });
  projectSwitchBlockerRef.current = projectSwitchBlocker;
  const projectTabs = useProjectTabs<TabSession>({
    initial: initialTabs,
    persist: persistTabs,
    capture: captureTabSession,
    restore: restoreTabSession,
    describe: (session) => ({
      name: session.controller.project.name,
      // A tab whose exact bytes the Gallery holds loses nothing on close.
      dirty:
        (session.dirty &&
          session.file.publishedSnapshotToken !==
            projectChangeToken(session.controller.project)) ||
        session.unsafe,
      unsafe: session.unsafe,
      cloudId: session.file.cloudBinding?.id ?? null,
      galleryId: session.publication?.id ?? null,
    }),
    prepare: async () => {
      const blocker = projectSwitchBlocker();
      if (blocker) {
        setStatus(
          `Can't switch project tabs yet: ${blocker}. No work was discarded.`,
        );
        return false;
      }
      const snapshot = await captureAuthoredProject();
      if (!snapshot) return false;
      // A copy in hand (C, or a paste not yet placed) follows the pointer
      // into the tab that opens next, as if the tabs were one canvas.
      const interaction = getCurrentInteractionState();
      carriedCopyRef.current =
        interaction.kind === "copy-placement"
          ? {
              clipboard: interaction.copy.clipboard,
              orientation: interaction.copy.orientationOperations,
            }
          : null;
      cancelAllTransientInteraction();
      stageRecovery(snapshot, {
        cloudBinding,
        unsavedAtSnapshot: isDirtyWork(),
      });
      // flushNow synchronously enqueues the captured outgoing identity.
      // IndexedDB completion does not need to delay painting the incoming tab.
      void flushRecovery();
      return true;
    },
    onError: (message) => setStatus(message),
  });
  openWorkingCopyIdsRef.current = () =>
    projectTabs.entries().map(({ session }) => session.recovery.workingCopyId);
  /**
   * Continue without saving on the way out of the editor (#1288): the
   * window's saved tabs must not bring the dropped edits back. A Project
   * with a saved version returns to it; any other tab closes, the last one
   * giving way to a blank circuit. The page shows what is kept, and the
   * saved tabs hold it, before the page leaves.
   */
  async function dropDiscardedWork(): Promise<void> {
    // Rendered at once, so the tabs saved next capture what is kept.
    flushSync(() => {
      if (!restoreSavedProjectBaseline())
        projectTabs.discard(projectTabs.activeId, () => createTabSession());
    });
    projectTabs.changed();
    await workspaceSaveQueue.current;
  }
  const [workspaceReopen, setWorkspaceReopen] = useState<{
    record: ProjectWorkspace;
    summary: WorkspaceReopenSummary;
  } | null>(null);
  // A fresh window with no tabs of its own offers the newest tabs a closed
  // window left (#1250). An explicit open request (a link, New Circuit)
  // already says what to show.
  useEffect(() => {
    if (
      restoredWorkspace ||
      initialProject ||
      workspaceError ||
      hasExplicitBootTarget
    )
      return;
    let live = true;
    void openWorkspaceWindows()
      .then((open) =>
        findWorkspaceReopenOffer(
          browserWorkspaceStore(),
          workspaceWindowId(),
          open,
        ),
      )
      .then((offer) => {
        if (live) setWorkspaceReopen(offer);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  async function reopenClosedWindowTabs(): Promise<void> {
    const offer = workspaceReopen;
    if (!offer) return;
    const openCloudIds = new Set(
      projectTabs
        .entries()
        .flatMap(({ session }) =>
          session.file.cloudBinding ? [session.file.cloudBinding.id] : [],
        ),
    );
    let incoming: { session: TabSession; active: boolean; copy: boolean }[];
    try {
      incoming = planWorkspaceReopen(offer.record, openCloudIds).map((tab) => ({
        session: tabSessionFromPortable(tab.session as PortableTab),
        active: tab.id === offer.record.activeId,
        copy: tab.copy,
      }));
    } catch {
      setWorkspaceReopen(null);
      setStatus(
        "Those tabs could not be reopened. Their recovery copies are kept: File → Recover Unsaved Work…",
      );
      return;
    }
    if (!incoming.length) {
      // Every one of them is open here already, none with unsaved edits.
      setWorkspaceReopen(null);
      void browserWorkspaceStore()
        .remove(offer.record.windowId)
        .catch(() => {});
      return;
    }
    // An untouched blank circuit is only a placeholder: the tabs take its
    // place. Anything drawn in it stays as a tab of its own.
    const placeholder =
      projectTabs.tabs.length === 1 &&
      project.id === preparedInitialProject.id &&
      !isDirtyWork() &&
      !hasUnsafeWork() &&
      !codeDraftDirty;
    if (!(await projectTabs.adopt(incoming, placeholder))) return;
    reopenedWorkspace.current = {
      windowId: offer.record.windowId,
      workingCopyIds: incoming.map(
        ({ session }) => session.recovery.workingCopyId,
      ),
    };
    setWorkspaceReopen(null);
    const copies = incoming.filter(({ copy }) => copy).length;
    setStatus(
      (incoming.length === 1
        ? "Reopened 1 tab from your last window"
        : `Reopened ${incoming.length} tabs from your last window`) +
        (copies === 0
          ? ""
          : copies === 1
            ? "; unsaved edits to a Project open here came back as an unsaved copy"
            : "; unsaved edits to Projects open here came back as unsaved copies"),
    );
  }
  useEffect(() => {
    // Runs once the next tab's Project is the one rendered, so the copy is
    // prepared against, and placed into, that Project.
    const carried = carriedCopyRef.current;
    carriedCopyRef.current = null;
    if (!carried) return;
    try {
      beginClipboardPlacement(carried.clipboard, carried.orientation);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [projectTabs.activeId]);
  openProjectInTabRef.current = (next, view, options, background) =>
    background
      ? Promise.resolve(
          projectTabs.openBackground(
            () => createTabSession(next, view, options),
            options.cloudBinding?.id,
          ),
        )
      : projectTabs.open(
          () => createTabSession(next, view, options),
          options.cloudBinding?.id,
        );
  async function manageCloud(
    action: (store: CloudProjectStore) => Promise<void>,
  ) {
    const blocker = projectSwitchBlocker();
    if (!projectStore || cloudMutation.current || blocker)
      throw new Error(blocker ?? "Cloud storage is unavailable");
    cloudMutation.current = true;
    setCloudManagementBusy(true);
    try {
      await action(projectStore);
    } finally {
      cloudMutation.current = false;
      setCloudManagementBusy(false);
    }
  }
  function updateOpenCloud(id: string, update: (session: TabSession) => void) {
    for (const entry of projectTabs.entries()) {
      if (entry.session.file.cloudBinding?.id !== id) continue;
      update(entry.session);
      if (entry.id === projectTabs.currentId()) {
        flushSync(() => {
          activateDocumentSession(entry.session.controller);
          restoreFileSession(entry.session.file);
        });
        stageRecovery(entry.session.controller.project, {
          cloudBinding: entry.session.file.cloudBinding,
          unsavedAtSnapshot: entry.session.dirty,
        });
      } else {
        writeRecoverySessionSnapshot(
          entry.session.recovery,
          entry.session.controller.project,
          {
            cloudBinding: entry.session.file.cloudBinding,
            unsavedAtSnapshot: entry.session.dirty,
          },
        );
      }
    }
    projectTabs.changed();
  }
  const renameShelfProject = (id: string, name: string) =>
    manageCloud(async (store) => {
      const opened = await store.open(id);
      if (opened.status !== "opened")
        throw new Error(`Could not rename this Project (${opened.status}).`);
      const original = parseProject(opened.project.projectText);
      if (name === original.name) return;
      const transaction = {
        transactionId: createId("shelf-rename"),
        projectId: original.id,
        expectedStructureRevision: original.structureRevision,
        actor: { kind: "human" as const, id: "editor" },
        edits: [{ kind: "rename_project" as const, name }],
      };
      const renamed = executeProjectTransaction(original, transaction);
      if (!renamed.ok) throw new Error(renamed.error.message);
      const saved = await store.save(renamed.project, opened.project);
      if (saved.status !== "saved")
        throw new Error(
          saved.status === "conflict"
            ? "This Project changed elsewhere. Refresh and try again; no edits were overwritten."
            : `Could not rename this Project (${saved.status}).`,
        );
      onCloudProjectSaved(saved.project);
      updateOpenCloud(id, (session) => {
        // An older local binding must still conflict rather than acknowledging
        // remote drawing changes that this working copy has never received.
        if (session.file.cloudBinding?.revision !== opened.project.revision)
          return;
        if (session.controller.project.name === original.name) {
          const result = session.controller.dispatchProjectTransaction({
            ...transaction,
            expectedStructureRevision:
              session.controller.project.structureRevision,
          });
          if (!result.ok) {
            setStatus(
              "Cloud name changed; the local draft was retained. Reopen the Project to review it.",
            );
            return;
          }
        }
        // Independent local and Cloud edits can share the same revision token.
        // Only the acknowledged content may lose its unsaved protection.
        const dirty =
          snapshotSerializer.serialize(session.controller.project) !==
          snapshotSerializer.serialize(renamed.project);
        session.file = {
          ...session.file,
          cloudBinding: {
            id: saved.project.id,
            revision: saved.project.revision,
            galleryEntryId: saved.project.galleryEntryId ?? null,
          },
          savedBaseline: {
            project: renamed.project,
            viewBox: session.file.savedBaseline?.viewBox ?? session.view,
          },
          persistenceState: dirty ? "dirty" : "clean",
        };
        session.dirty = dirty;
        session.unsafe = dirty;
      });
    });
  const deleteShelfProject = (id: string) =>
    manageCloud(async (store) => {
      const removed = await store.delete(id);
      if (removed.status !== "deleted") throw new Error(removed.message);
      onCloudProjectsDeleted(removed.projects);
      updateOpenCloud(id, (session) => {
        session.file = {
          ...session.file,
          cloudBinding: null,
          savedBaseline: null,
          safeSnapshotToken: null,
          persistenceState: "dirty",
        };
        session.dirty = true;
        session.unsafe = true;
      });
    });
  return {
    cloudManagementBusy,
    isCloudManagementInFlight: () => cloudMutation.current,
    renameShelfProject,
    deleteShelfProject,
    createTabSession,
    restoredTabs,
    currentEditBlocker,
    projectSwitchBlocker,
    projectTabs,
    dropDiscardedWork,
    workspaceReopen,
    setWorkspaceReopen,
    reopenClosedWindowTabs,
  };
}
