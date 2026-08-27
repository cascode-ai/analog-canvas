import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import "../styles/editor-entry.css";
import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";
import {
  compileWireDraft,
  createFreeWireAnchor,
  proposeEndpointRouteAttachment,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeWireCommitThroughContacts,
  proposeWireSegmentMove,
  planCellReset,
  type CellResetPlan,
  type WireSource,
} from "@icm/edit-engine";
import {
  deriveNetConnectivity,
  deriveRoutingAffectedClosure,
  resolveDraftingObjectGeometry,
  displayableInstanceValue,
  resolveMosBulkConnection,
  resolveDocumentStyleProfile,
  resolveRouteTap,
  summarizeProjectCells,
} from "@icm/derived";
import type { HierarchyFrame } from "@icm/derived";
import {
  createEmptyProject,
  createId,
  foldNetName,
  flattenRichText,
} from "@icm/model";
import type {
  CircuitProject,
  DerivedPoint,
  DraftingObject,
  GridRect,
  Point,
  Rect,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { renderCrashRequested, sceneCrashRequested } from "./crash-test-hooks";
import { buildSceneSafely } from "./scene-safety";
import {
  builtInSymbols,
  externalSubcircuitSymbolId,
  findUnsupportedProjectSymbolIds,
  hierarchicalSymbolId,
  resolvePdkSymbolMappingForTerminalOrder,
  reviewedSky130MosModelSuggestions,
} from "@icm/symbols";
import {
  clipboardPreviewDocument,
  copySelection,
} from "../features/clipboard/clipboard";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import {
  canvasInsetsFromOverlays,
  fitCameraToBounds,
  normalizeCameraRect,
  type CameraRectInput,
  type CanvasInsets,
} from "../canvas/fit-view";
import type { CanvasDragSession } from "../canvas/canvas-drag-session";
import { createCanvasHitController } from "../canvas/canvas-hit-controller";
import {
  type RouteStretchPreview,
  useWireInteraction,
} from "../features/wiring/use-wire-interaction";
import { closestPointOnSegment } from "../canvas/canvas-geometry";
import type { BoxPreview, PanPreview } from "../canvas/canvas-gesture-model";
import { createCanvasGestureController } from "../canvas/canvas-gesture-controller";
import { createEditorCanvasEventHandlers } from "../canvas/editor-canvas-event-handlers";
import {
  canvasPointFromClient,
  logicalRadiusForCanvasPixels,
  replaceCanvasSnapGuides,
} from "../canvas/canvas-viewport";
import { EditorCanvasSurface } from "../canvas/editor-canvas-surface";
import { createAnnotationDragController } from "../features/text-editing/annotation-drag-controller";
import {
  createEditorFileCommands,
  type SpiceImportReport,
} from "../features/editor-shell/editor-file-commands";
import { EditorStatusbar } from "../features/editor-shell/editor-statusbar";
import { useCellSymbolLayout } from "../features/hierarchy/use-cell-symbol-layout";
import {
  cellInsertLaunch,
  fullInsertLaunch,
} from "../features/component-insert/insert-launch";
import { useComponentPlacement } from "../features/component-insert/use-component-placement";
import { findPaletteSymbol } from "../features/component-insert/symbol-catalog";
import { createPlacementTrayCommands } from "../features/component-insert/placement-tray-commands";
import { componentTargetDescription } from "../features/properties/component-identity-properties";
import {
  constrainedPowerRailEndpoint,
  constructVddRailEdits,
} from "../features/component-insert/vdd-rail";
import { vddPowerLabelAnnotation } from "../features/component-insert/vdd-power-label";
import {
  powerConnectionForSymbol,
  proposePlacementContact,
  proposedStandalonePowerConnection,
} from "../features/component-insert/placement-connectivity";
import {
  endpointTestId,
  instanceLabelAnnotationFor,
  maxRoutingCounter,
  previewInstanceValueSource,
} from "./editor-document-helpers";
import {
  compactLayoutMatches,
  dismissOpenCommandMenus,
  isTypingTarget,
  RenderCrashProbe,
} from "./editor-runtime-helpers";
import { EditorDialogLayer } from "./editor-dialog-layer";
import { EditorAppChrome } from "./editor-app-chrome";
import { EditorPropertiesDock } from "./editor-properties-dock";
import {
  type HighlightedNetOrigin,
  type RoutingGuidanceView,
  useEditorDerivedModel,
} from "./use-editor-derived-model";
import {
  netlistReferenceMatchesPlacement,
  nextInstanceDesignator,
} from "../features/netlist-export/netlist-authoring";
import {
  quickPlaceRequest,
  ShapesPanel,
} from "../features/editor-shell/shapes-panel";
import {
  differentialOutputSibling,
  planDifferentialOutputSwap,
} from "../features/editor-shell/differential-output-swap";
import {
  differentialInputSibling,
  planDifferentialInputSwap,
} from "../features/editor-shell/differential-input-swap";
import { ExamplesPanel } from "../features/editor-shell/examples-panel";
import { createGalleryExampleCommands } from "../features/editor-shell/gallery-example-commands";
import { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import type { PublishGalleryDraft } from "../features/editor-shell/publish-gallery-dialog";
import {
  publishProjectToGallery,
  updateGalleryEntry,
} from "../features/editor-shell/gallery-publish";
import {
  announceGalleryChange,
  primeGalleryPreview,
  subscribeGalleryRefresh,
} from "../gallery-client";
import { fetchSessionUser, type SessionUser } from "../components/account";
import {
  evaluateSubmissionGates,
  type SubmissionGateReport,
} from "@icm/derived";
import {
  createLibraryExampleProject,
  libraryProjectExamples,
} from "../examples/library-examples";
import { useDocumentController } from "../document/document-controller";
import { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import {
  draftingDragOrigin,
  translateDraftingObject,
} from "../features/drafting/drafting-manipulation";
import { createDraftingCommands } from "../features/drafting/drafting-commands";
import { createDraftingCreateController } from "../features/drafting/drafting-create-controller";
import {
  createDraftingDragController,
  type DraftingHandlePreview,
} from "../features/drafting/drafting-drag-controller";
import {
  resolveEditorShortcut,
  stepBoundedScale,
} from "../interaction/editor-shortcuts";
import { createEditorCommandRouter } from "../commands/editor-command";
import { createEditorTransactionCommands } from "./editor-transaction-commands";
import { recoveryStateLabel } from "../components/recovery-banners";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { createAgentSemanticIntentHandler } from "../agent/agent-semantic-intent-handler";
import { PUBLIC_AGENT_UI_ENABLED } from "../agent/public-agent-ui";
import { useAgentSession } from "../agent/use-agent-session";
import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
import { referencedDocumentId } from "../document/editor-session";
import { useInteractionState } from "../interaction/interaction-state";
import type { EditorTool } from "../interaction/interaction-state";
import { resolveTextEditingTarget } from "../features/text-editing/text-editing";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import {
  listWorkspaceShelf,
  type WorkspaceSlot,
} from "../features/editor-shell/workspace-shelf";
import {
  defaultRazaviSymbolVariantId,
  materializeRazaviProjectBulkConnections,
  razaviHiddenBulkRisk,
  razaviManualBulkConnectionEdits,
  razaviMosPresentationEdits,
} from "../presentation/razavi-presentation";
import { useRecoveryCoordinator } from "../document/recovery-coordinator";
import { requestProjectDownload } from "../document/project-file-service";
import { useSelectionController } from "../features/selection/selection-controller";
import { deriveSelectionInspectionModel } from "../features/selection/selection-inspection-model";
import { usePropertiesEditor } from "../features/properties/use-properties-editor";
import { createPropertyEditPlanner } from "../features/properties/property-edit-planner";
import { createSelectionPropertyCommands } from "../features/properties/selection-property-commands";
import {
  LIBRARY_WIDTH_MAX,
  LIBRARY_WIDTH_MIN,
  useEditorPanels,
} from "../features/editor-shell/use-editor-panels";
import {
  type InstanceMovePreview,
  type ProjectedInstanceMove,
  useSelectionInteraction,
} from "../features/selection/use-selection-interaction";
import {
  hasVisualSelection,
  pruneVisualSelection,
} from "../features/selection/visual-selection";
import { createSelectionMoveController } from "../features/selection/selection-move-controller";
import { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import type { VisualSelection } from "../features/selection/visual-selection";
import {
  planSelectionMove,
  type SchematicMoveIntent,
  type SelectionMovePlan,
} from "../features/selection/selection-move-plan";
import {
  annotationAnchor,
  annotationHitBox,
  attachmentAtPoint,
  effectiveRouteAttachment,
  instanceValueAnnotation,
  isRoutedMarker,
  looseRouteAnchorIds,
} from "../features/wiring/route-interaction-geometry";
import { useWireCanvasController } from "../features/wiring/use-wire-canvas-controller";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import {
  buildDraftingAnchors,
  buildInstanceAnchors,
  buildSceneSnapTargets,
} from "../snap/candidates";
import {
  resolvePointSnap,
  resolveTranslationSnap,
  SNAP_PROFILES,
  snapCoordinate,
} from "../snap/engine";
import type { SnapAnchor, SnapGuideLine, SnapResult } from "../snap/engine";

const DEFAULT_VIEWBOX: GridRect = { x: 0, y: 0, width: 960, height: 640 };
const RECENT_COMPONENTS_STORAGE_KEY = "icm.recent-components.v1";
const LIBRARY_PANEL_STORAGE_KEY = "icm.library-panel-open.v1";
const LIBRARY_WIDTH_STORAGE_KEY = "icm.library-panel-width.v1";
const COMPACT_LAYOUT_MEDIA_QUERY = "(max-width: 860px)";
const DRAG_START_DISTANCE_PX = 4;
const SNAP_CAPTURE_RADIUS_PX = 7;

/** Persisted Junctions are grid points, including on ±45° Route segments. */

type DragPreview = InstanceMovePreview;

// Handle drags are geometry edits rather than translations.  Keep a complete
// transient object so the formal SVG renderer can redraw both a curved shaft
// and its arrow head from the same latest control point before pointer-up.
export interface AppProps {
  project?: CircuitProject;
  visitStats?: { pv: number; uv: number } | null;
  /** Test/staging seam; production defaults to a human-only editor. */
  publicAgentUiEnabled?: boolean;
  /** `/g/<id>` deep link: load this gallery entry after boot. */
  initialGalleryEntryId?: string | null;
}

export function App({
  project: initialProject,
  visitStats,
  publicAgentUiEnabled = PUBLIC_AGENT_UI_ENABLED,
  initialGalleryEntryId = null,
}: AppProps) {
  const [preparedInitialProject] = useState(
    () =>
      materializeRazaviProjectBulkConnections(
        initialProject ?? createEmptyProject("project-main", "New Circuit"),
      ).project,
  );
  const [status, setStatus] = useState("Ready");
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const libraryResizeOriginRef = useRef<{
    pointerX: number;
    width: number;
  } | null>(null);
  const {
    libraryPanelOpen,
    setLibraryPanelOpen,
    libraryWidth,
    setLibraryWidth,
    compactLayout,
    setCompactLayout,
    compactLibraryPanelOpen,
    setCompactLibraryPanelOpen,
    leftPanelMode,
    setLeftPanelMode,
    selectionOpen,
    setSelectionOpen,
    helpOpen,
    setHelpOpen,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    agentPanelOpen,
    setAgentPanelOpen,
    agentDetailsOpen,
    setAgentDetailsOpen,
    agentStatusDismissed,
    setAgentStatusDismissed,
    closeHelp,
    closeSearch,
    showLeftPanel,
    toggleExamplesPanel: toggleExamplesPanelFromShell,
    toggleLibraryPanel,
  } = useEditorPanels({
    initialCompact: compactLayoutMatches(COMPACT_LAYOUT_MEDIA_QUERY),
    compactMediaQuery: COMPACT_LAYOUT_MEDIA_QUERY,
    libraryStorageKey: LIBRARY_PANEL_STORAGE_KEY,
    libraryWidthStorageKey: LIBRARY_WIDTH_STORAGE_KEY,
    helpButtonRef,
    helpCloseRef,
  });
  const visibleLibraryPanelOpen = compactLayout
    ? compactLibraryPanelOpen
    : libraryPanelOpen;
  const [galleryRefreshSignal, setGalleryRefreshSignal] = useState(0);
  const galleryLoadGenerationRef = useRef(0);
  useEffect(() => {
    if (!visibleLibraryPanelOpen) return;
    return subscribeGalleryRefresh(() => {
      galleryLoadGenerationRef.current += 1;
      setGalleryRefreshSignal((previous) => previous + 1);
    });
  }, [visibleLibraryPanelOpen]);
  useEffect(() => {
    if (!visibleLibraryPanelOpen) return;
    let cancelled = false;
    const generation = ++galleryLoadGenerationRef.current;
    void (async () => {
      try {
        const response = await fetch("/api/gallery?limit=60", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          entries?: {
            id: string;
            name: string;
            author: string;
            description: string;
            previewRevision?: string;
          }[];
        };
        if (!cancelled && generation === galleryLoadGenerationRef.current) {
          setGalleryExamples(payload.entries ?? []);
        }
      } catch {
        // Unreachable worker (offline dev): the bundled list stands in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleLibraryPanelOpen, galleryRefreshSignal]);

  const [recoveryFailureDismissed, setRecoveryFailureDismissed] =
    useState(false);
  const {
    state: recoveryState,
    sessions: recoverySessions,
    ready: recoveryReady,
    workingCopyId: recoveryWorkingCopyId,
    stage: stageRecovery,
    cancelPending: cancelRecovery,
    flushNow: flushRecovery,
    beginWorkingCopy: beginRecoveryWorkingCopy,
    noteFormalFileHint: noteRecoveryFormalFileHint,
    discover: discoverRecovery,
    readSessionProject: readRecoveryProject,
    deleteSession: deleteRecoverySession,
  } = useRecoveryCoordinator(setStatus);
  const {
    project,
    document,
    resolver,
    canUndo,
    canRedo,
    openDocument,
    replaceProject,
    commitProjectStructure,
    dispatchProjectTransaction,
    transact: transactDocument,
    controller: editorDocumentController,
    projectSessionId,
    synchronizeExternalCommit,
  } = useDocumentController(preparedInitialProject, stageRecovery);
  const agentSemanticIntentRef = useRef<
    (request: AgentHostSemanticIntentRequest) => AgentHostSemanticIntentResult
  >(() => ({
    ok: false,
    code: "SEMANTIC_CONTROL_UNAVAILABLE",
    message: "The editor is still initializing semantic controls",
  }));
  const browserAgentHost = useMemo(
    () =>
      new BrowserAgentHost(
        editorDocumentController,
        synchronizeExternalCommit,
        (request) => agentSemanticIntentRef.current(request),
      ),
    [editorDocumentController, projectSessionId],
  );
  const [documentStack, setDocumentStack] = useState<HierarchyFrame[]>([]);
  const {
    selection: visualSelection,
    replace: replaceSelection,
    replaceKind: replaceSelectionKind,
    selectOnly,
    selectInstance: updateInstanceSelection,
    clearKinds: clearSelectionKinds,
    reset: resetSelection,
  } = useSelectionController();
  const uniqueSuffixCounter = useRef(0);
  const [viewBox, setRawViewBox] = useState<GridRect>(DEFAULT_VIEWBOX);
  const [gridDotsVisible, setGridDotsVisible] = useState(true);
  const setViewBox = (
    next: GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput),
    grid = document.presentation.grid,
  ): void => {
    setRawViewBox((current) =>
      normalizeCameraRect(
        typeof next === "function" ? next(current) : next,
        grid,
      ),
    );
  };
  const [importReport, setImportReport] = useState<SpiceImportReport | null>(
    null,
  );
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [cellManagerOpen, setCellManagerOpen] = useState(false);
  const [pendingCellReset, setPendingCellReset] = useState<{
    plan: CellResetPlan;
    command: string;
  } | null>(null);
  const [netlistPreflightOpen, setNetlistPreflightOpen] = useState(false);
  const [documentSettingsOpen, setDocumentSettingsOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState<string | null>(null);
  const [publishGalleryOpen, setPublishGalleryOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [publishSession, setPublishSession] = useState<SessionUser | null>(
    null,
  );
  const [galleryEntryContext, setGalleryEntryContext] = useState<{
    id: string;
    name: string;
    /** The opened Project's id: the context is only valid while that
     * exact Project is still the active one. */
    projectId: string;
    ownerUserId: string | null;
    author: string;
    description: string;
    tags: readonly string[];
  } | null>(null);
  // The moment any OTHER Project replaces the opened gallery entry (new
  // circuit, bundled example, import, …), the update offer must vanish —
  // otherwise a later publish silently overwrites the stale entry.
  const activeProjectId = project.id;
  useEffect(() => {
    setGalleryEntryContext((previous) =>
      previous && previous.projectId !== activeProjectId ? null : previous,
    );
  }, [activeProjectId]);
  // The Examples panel reads the same community gallery as the landing
  // feed; null means unreachable, so the bundled list stands in.
  const [galleryExamples, setGalleryExamples] = useState<
    | readonly {
        id: string;
        name: string;
        author: string;
        description: string;
        previewRevision?: string;
      }[]
    | null
  >(null);
  const [publishGates, setPublishGates] = useState<SubmissionGateReport | null>(
    null,
  );
  // Check and Save needs to know who is signed in before anyone opens the
  // publish dialog, and the shelf it writes to is worth listing on arrival.
  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then(async (user) => {
      if (cancelled) return;
      setPublishSession(user);
      if (!user) return;
      const slots = await listWorkspaceShelf();
      if (!cancelled) setWorkspaceSlots(slots);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!publishGalleryOpen) return;
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (!cancelled) setPublishSession(user);
    });
    // The same evaluator the worker enforces, run live on the open Project.
    setPublishGates(evaluateSubmissionGates(project, resolver));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluated once per dialog open
  }, [publishGalleryOpen]);
  const [instanceTableOpen, setInstanceTableOpen] = useState(false);
  const [agentFileCandidate, setAgentFileCandidate] =
    useState<AgentFileCandidateSummary | null>(null);
  const browserAgentFileHost = useMemo(
    () =>
      new BrowserAgentFileHost({
        getProjectSessionId: () => editorDocumentController.projectSessionId,
        getProject: () => editorDocumentController.project,
        getDocument: (documentId) =>
          editorDocumentController.project.documents.find(
            (candidate) => candidate.id === documentId,
          ) ?? null,
        getResolver: () => editorDocumentController.resolver,
        onApprovalRequested: setAgentFileCandidate,
      }),
    [editorDocumentController, projectSessionId],
  );
  const {
    fileState,
    formalProjectBaseline,
    previousProject,
    replaceGuard,
    recoveryDialogOpen,
    setRecoveryDialogOpen,
    isDirtyWork,
    replaceActiveProject,
    saveProjectFile,
    reportExport,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    downloadCurrentProjectFromGuard,
    createNewProject,
    restorePreviousProject,
    revertToFormalProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    refreshApp,
    openProjectFile,
    openShelvedCircuit,
  } = useProjectFileLifecycle({
    project,
    projectSessionId,
    viewBox,
    defaultViewBox: DEFAULT_VIEWBOX,
    setStatus,
    recovery: {
      ready: recoveryReady,
      sessions: recoverySessions,
      workingCopyId: recoveryWorkingCopyId,
      stage: stageRecovery,
      cancelPending: cancelRecovery,
      flushNow: flushRecovery,
      beginWorkingCopy: beginRecoveryWorkingCopy,
      noteFormalFileHint: noteRecoveryFormalFileHint,
      discover: discoverRecovery,
      readSessionProject: readRecoveryProject,
      deleteSession: deleteRecoverySession,
    },
    installProject: (nextProject, nextViewBox) => {
      browserAgentFileHost.clear();
      setAgentFileCandidate(null);
      setImportReport(null);
      setImportReviewOpen(false);
      setGalleryEntryContext(null);
      const nextDocument = replaceProject(nextProject);
      documentViewBoxes.current = new Map();
      setDocumentStack([]);
      setViewBox(nextViewBox, nextDocument.presentation.grid);
      resetInteractionState();
      return nextDocument;
    },
  });
  const agentSession = useAgentSession({
    enabled: publicAgentUiEnabled,
    project,
    projectSessionId,
    host: browserAgentHost,
    fileHost: browserAgentFileHost,
  });
  useEffect(() => {
    if (!publicAgentUiEnabled) return;
    setAgentStatusDismissed(false);
  }, [agentSession.status, publicAgentUiEnabled]);
  const [boxPreview, setBoxPreview] = useState<BoxPreview | null>(null);
  const [panPreview, setPanPreview] = useState<PanPreview | null>(null);
  const [wireOptionsOpen, setWireOptionsOpen] = useState(false);
  const [routingGuidanceView, setRoutingGuidanceView] =
    useState<RoutingGuidanceView>("focused");
  const [routeStretchPreview, setRouteStretchPreview] =
    useState<RouteStretchPreview | null>(null);
  const [draftingHandlePreview, setDraftingHandlePreview] =
    useState<DraftingHandlePreview | null>(null);
  const snapGuideLayerRef = useRef<SVGGElement | null>(null);
  const {
    getCurrentState: getCurrentInteractionState,
    tool,
    pendingSymbolId,
    pendingComponentPlacement,
    wireSource,
    wireSourceRevision,
    wirePreviewPoint,
    wireWaypoints,
    wireDraftSteps,
    wireRoutingMode,
    wireCornerOrder,
    draftingSource,
    draftingHover,
    draftingWaypoints,
    draftingSnapPoint,
    componentPlacementRotation,
    componentPlacementMirror,
    componentPreviewPoint,
    vddRailMode,
    vddRailNetName,
    vddRailStart,
    copyPlacement,
    setTool,
    beginComponentPlacement,
    setComponentPreviewPoint,
    rotateComponentPlacement,
    mirrorComponentPlacement,
    beginVddRailPlacement: beginVddRailInteraction,
    setVddRailStart,
    setVddRailPreviewPoint,
    completeVddRailPlacement,
    beginCopyPlacement: beginCopyPlacementInteraction,
    setCopyPreviewPoint,
    advanceCopyPlacement,
    rotateCopyPlacement,
    mirrorCopyPlacement,
    setWireSource,
    setWirePreviewPoint,
    setWireDraftSteps,
    setWireRoutingMode,
    setWireCornerOrder,
    completeWire,
    setDraftingSource,
    setDraftingHover,
    setDraftingWaypoints,
    setDraftingSnapPoint,
    clearDraftingCreate,
    beginSelectionMove: beginSelectionMoveInteraction,
    cancelInteraction,
  } = useInteractionState<SchematicClipboard>();
  const { commitStructure, transact, transactConnectivity } =
    createEditorTransactionCommands({
      project,
      document,
      resolver,
      dispatchProjectTransaction,
      transactDocument,
      getCurrentInteractionKind: () => getCurrentInteractionState().kind,
      cancelAllTransientInteraction,
      setStatus,
    });
  const {
    createCell,
    renameCell,
    deleteCell,
    updateCellPinDirection,
    renameCellTerminal,
    moveCellTerminal,
    setCellFormalParameters,
    setExternalSubcircuitDefinition,
    setCellSymbolBodySize,
    setCellSymbolPortPlacement,
    editCellTerminalAnnotation,
    removeCellTerminalSelection,
    deleteCellTerminal,
    renameProject,
  } = createProjectStructureCommands({
    project,
    activeDocument: document,
    resolver,
    commitStructure,
    setStatus,
    onCellCreated: () => setDocumentStack([]),
    nextSequence: () => {
      uniqueSuffixCounter.current += 1;
      return uniqueSuffixCounter.current;
    },
  });
  const { openGalleryEntryById, openLibraryExample, insertGalleryEntryById } =
    createGalleryExampleCommands({
      defaultViewBox: DEFAULT_VIEWBOX,
      replaceActiveProject,
      guardDirtyReplacement,
      beginCopyPlacement: beginCopyPlacementInteraction,
      cancelAllTransientInteraction,
      setGalleryEntryContext,
      setStatus,
    });
  const [draftingInspectorSegment, setDraftingInspectorSegment] = useState<{
    objectId: string;
    index: number;
  } | null>(null);
  const [draftingTangentInput, setDraftingTangentInput] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [draftingBearingInput, setDraftingBearingInput] = useState<{
    objectId: string;
    value: string;
  } | null>(null);
  const [selectedRouteSegmentIndex, setSelectedRouteSegmentIndex] = useState<
    number | null
  >(null);
  /** Survives the dialog closing, so a mistaken dismissal loses nothing. */
  const [publishDraft, setPublishDraft] = useState<PublishGalleryDraft | null>(
    null,
  );
  /**
   * R pressed with nothing selected: the next part pointed at is turned.
   * The key means rotate whether or not something is selected yet, rather
   * than meaning rotate sometimes and draw a rectangle the rest of the time.
   */
  const [rotateArmed, setRotateArmed] = useState(false);
  /** The signed-in account's last few checked circuits, newest first. */
  const [workspaceSlots, setWorkspaceSlots] = useState<
    readonly WorkspaceSlot[]
  >([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<WireSource | null>(
    null,
  );
  const [bulkDrawInstanceId, setBulkDrawInstanceId] = useState<string | null>(
    null,
  );
  const [highlightedNetOrigin, setHighlightedNetOrigin] =
    useState<HighlightedNetOrigin | null>(null);
  const routeCounter = useRef(0);
  const canvasDragSessionRef = useRef<CanvasDragSession | null>(null);
  /**
   * Last pointer position seen on the canvas, in document coordinates. A
   * placement that starts from the keyboard has no pointer event of its own,
   * so it seeds its preview from here instead of waiting for the next move.
   */
  const lastCanvasPointRef = useRef<Point | null>(null);

  /** Show a placement ghost under the cursor without waiting for a move. */
  function seedComponentPreviewFromPointer(): void {
    const point = lastCanvasPointRef.current;
    if (point) setComponentPreviewPoint(point);
  }

  function seedCopyPreviewFromPointer(): void {
    const point = lastCanvasPointRef.current;
    if (!point) return;
    setCopyPreviewPoint({
      x: snapCoordinate(point.x, document.presentation.grid),
      y: snapCoordinate(point.y, document.presentation.grid),
    });
  }
  const suppressInstanceClick = useRef(false);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const selectionShelfRef = useRef<HTMLButtonElement>(null);
  const instanceValueInputRef = useRef<HTMLInputElement>(null);
  const netLabelPropertyInputRef = useRef<HTMLInputElement>(null);
  const netLabelEditorInputRef = useRef<HTMLInputElement>(null);
  const documentViewBoxes = useRef(new Map<string, GridRect>());
  const [projectedMovePreviewDocument, setProjectedMovePreviewDocument] =
    useState<SchematicDocument | null>(null);
  const renderedDocument = useMemo(() => {
    if (projectedMovePreviewDocument) return projectedMovePreviewDocument;
    if (!draftingHandlePreview || !document.drafting) return document;
    return {
      ...document,
      drafting: {
        ...document.drafting,
        objects: document.drafting.objects.map((object) =>
          object.id === draftingHandlePreview.objectId
            ? draftingHandlePreview.object
            : object,
        ),
      },
    };
  }, [document, draftingHandlePreview, projectedMovePreviewDocument]);
  const lastGoodSceneRef = useRef<ReturnType<typeof buildSvgScene> | null>(
    null,
  );
  const sceneState = useMemo(() => {
    const outcome = buildSceneSafely(() => {
      if (sceneCrashRequested()) {
        throw new Error("scene build crashed (test hook)");
      }
      return buildSvgScene(renderedDocument, resolver, { bounds: viewBox });
    }, lastGoodSceneRef.current);
    if (!outcome.degraded) lastGoodSceneRef.current = outcome.scene;
    return outcome;
  }, [renderedDocument, resolver, viewBox]);
  const scene = sceneState.scene;
  useEffect(() => {
    if (sceneState.degraded) {
      setStatus(
        `Scene rendering failed; showing the last good view — ${sceneState.message}`,
      );
    }
  }, [sceneState.degraded, sceneState.message]);
  // React compares dangerouslySetInnerHTML by prop identity, and an inline
  // `{ __html }` literal would force an innerHTML replacement on every App
  // re-render — destroying live drag previews (and pointer capture) whenever
  // unrelated state such as recovery status changes. Memoize the prop object
  // so re-renders with unchanged scene content leave the DOM subtree alone.
  const sceneInnerHtml = useMemo(() => ({ __html: scene.formalBody }), [scene]);
  const copyPreviewState = useMemo(() => {
    if (!copyPlacement || !copyPlacement.previewPoint) {
      return { scene: null, error: null };
    }
    const offset = {
      x: copyPlacement.previewPoint.x - copyPlacement.anchor.x,
      y: copyPlacement.previewPoint.y - copyPlacement.anchor.y,
    };
    try {
      return {
        scene: buildSvgScene(
          clipboardPreviewDocument(
            document,
            copyPlacement.clipboard,
            offset,
            copyPlacement.orientationOperations,
            resolver,
            copyPlacement.sequence,
          ),
          resolver,
          { bounds: viewBox },
        ),
        error: null,
      };
    } catch (error) {
      return {
        scene: null,
        error:
          error instanceof Error
            ? error.message
            : "Copy preview could not be rendered",
      };
    }
  }, [copyPlacement, document, resolver, viewBox]);
  useEffect(() => {
    if (copyPreviewState.error) {
      setStatus(`Copy preview unavailable — ${copyPreviewState.error}`);
    }
  }, [copyPreviewState.error]);
  const copyPreviewInnerHtml = useMemo(
    () =>
      copyPreviewState.scene === null
        ? null
        : { __html: copyPreviewState.scene.formalBody },
    [copyPreviewState.scene],
  );
  const unplaced = document.instances.filter(
    (instance) => instance.placement === null,
  );
  const returnablePlacedInstances = document.instances.filter(
    (instance) => instance.placement !== null,
  );
  const {
    selectedIds,
    supplementalSelection,
    selectedRouteId,
    selectedAnnotationId,
    selectedDraftingId,
    selectedInstance,
    selectedInstanceHasDifferentialInputs,
    selectedHierarchyCell,
    selectedDevice,
    selectedCapacitorPlateRows,
    selectedExternalSubcircuit,
    selectedExternalMosMapping,
    selectedPropertyDevice,
    selectedRoute,
    selectedRouteNetLabels,
    selectedRouteNetLabel,
    selectedAnnotation,
    selectedNetLabelBinding,
    selectedDrafting,
    hasHierarchyEnterSelection,
    hasRotatableSelection,
    hasMirrorableSelection,
    hasInspectableSelection,
    selectionShelfSummary,
    selectedNoConnect,
    selectedEndpointNetId,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
  } = deriveSelectionInspectionModel({
    project,
    document,
    resolver,
    selection: visualSelection,
    selectedEndpoint,
  });
  const {
    projectConnectivityIndex,
    logicalNets,
    routeGeometryRecords,
    netlistAnalysis,
    highlightedTrace,
    highlightedNet,
    highlightedNetId,
    selectedHighlightIsActive,
    liveDiagnosticSnapshot,
    electricalDiagnostics,
    searchResults,
    flightlines,
    displayedFlightlines,
    crossings,
    visualDiagnostics,
    visualDiagnosticSummary,
    visibleEndpoints,
    wiringEndpoints,
    contactComponents,
  } = useEditorDerivedModel({
    project,
    document,
    resolver,
    documentStack,
    highlightedNetOrigin,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
    searchQuery,
    routingGuidanceView,
    wireSource,
    bulkDrawInstanceId,
  });
  const {
    enabled: cellSymbolLayoutEnabled,
    layout: selectedCellSymbolLayout,
    activeDragPointerId: cellSymbolLayoutDragPointerId,
    cancelDrag: cancelCellSymbolLayoutDrag,
    exit: exitCellSymbolLayout,
    toggle: toggleCellSymbolLayout,
    beginDrag: beginCellSymbolLayoutDrag,
    completeDrag: completeCellSymbolLayoutDrag,
  } = useCellSymbolLayout({
    selectedInstance,
    child: selectedHierarchyCell,
    resolver,
    selectionOpen,
    canvasPointFromEvent: (event) =>
      pointFromClient(event.clientX, event.clientY, event.currentTarget),
    setBodySize: setCellSymbolBodySize,
    setPortPlacement: setCellSymbolPortPlacement,
  });
  const {
    netLabelForRoute,
    netLabelEditsForRoute,
    netNameEditsForAnnotation,
    propertyParametersForInstance,
    instancePropertyEdits,
  } = createPropertyEditPlanner({
    project,
    document,
    resolver,
    routeGeometryRecords,
    setStatus,
  });
  const {
    referenceLabelVisibilityEdits,
    valueVisibilityEdits,
    updateSelectedModelTarget,
    updateSelectedSchematicName,
    updateSelectedReference,
    deleteSelectedAnnotation,
    reverseSelectedCurrentArrow,
  } = createSelectionPropertyCommands({
    project,
    document,
    resolver,
    selectedInstance,
    selectedInstanceIsMos:
      selectedPropertyDevice?.capabilities.supportsBulkBinding === true,
    selectedAnnotation,
    commitStructure,
    transact,
    replaceAnnotationSelection: (ids) =>
      replaceSelectionKind("annotation", ids),
    setStatus,
  });
  const {
    addAdditionalParameter,
    additionalParameterDraft,
    additionalParameterDraftChanges,
    applyAdditionalParameters,
    applyNetLabel,
    beginAnnotationTextEditing,
    beginDraftingTextEditing,
    beginNetLabelEditing,
    commitInstancePropertyDraft,
    commitElectricalMarkerName,
    commitNetLabelEditing,
    commitPendingNetLabelDraft,
    commitTextEditing,
    clearTextEditing,
    cancelAdditionalParameters,
    deleteSelectedRouteNetLabel,
    deleteTextEditing,
    discardInstancePropertyDraft,
    hasInstancePropertyDraftChanges,
    instancePropertyDraft,
    netLabelDraft,
    netLabelEditorOpen,
    removeAdditionalParameter,
    setNetLabelEditorOpen,
    setReferenceLabelsVisible,
    setValueLabelsVisible,
    showSelectedInstanceValue,
    textEditing,
    updateInstancePropertyDraft,
    updateAdditionalParameter,
    updateTextEditing,
    updateNetLabelDraft,
  } = usePropertiesEditor({
    document,
    resolver,
    selectedRoute,
    selectedRouteNetLabel: selectedRouteNetLabel ?? null,
    selectedRouteNetLabels,
    selectedInstance,
    componentParametersForInstance: propertyParametersForInstance,
    wireSourceActive: wireSource !== null,
    netLabelEditorInputRef,
    transact,
    setStatus,
    replaceSelectionKind: (kind, ids) => replaceSelectionKind(kind, ids),
    selectOnly: (kind, ids) => selectOnly(kind, ids),
    selectDraftingObject,
    clearSelectionKinds,
    netLabelForRoute,
    netLabelEditsForRoute,
    netNameEditsForAnnotation,
    instancePropertyEdits,
    referenceLabelVisibilityEdits,
    valueVisibilityEdits,
    isCellPinAnnotation: (annotation) => {
      const anchor = annotation.anchor;
      if (anchor.kind !== "object") return false;
      const interfaceInstanceId = anchor.objectId;
      return (
        document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(interfaceInstanceId),
        ) === true
      );
    },
    commitCellPinAnnotation: editCellTerminalAnnotation,
  });
  const selectedInstanceLabel = selectedInstance
    ? instanceLabelAnnotationFor(document, selectedInstance.id)
    : undefined;
  const selectedInstanceValue = selectedInstance
    ? instanceValueAnnotation(document, selectedInstance.id)
    : null;
  // Availability follows the live property draft, not only committed state:
  // typing a value must enable the Value toggle immediately. Geometry edits
  // in the draft are irrelevant to the projection.
  const selectedInstanceValueAvailable = selectedInstance
    ? displayableInstanceValue(
        previewInstanceValueSource(selectedInstance, instancePropertyDraft),
      ).kind === "displayable"
    : false;
  const selectedGroupLabelsAllVisible =
    selectedIds.length > 1 &&
    selectedIds.every((id) => {
      const label = instanceLabelAnnotationFor(document, id);
      return label !== undefined && label.visible !== false;
    });
  const selectedGroupValuesAllVisible =
    selectedIds.length > 1 &&
    selectedIds.every((id) => {
      const value = instanceValueAnnotation(document, id);
      return value !== null && value.visible !== false;
    });
  const selectedGroupValueAvailable = selectedIds.some((id) => {
    const instance = document.instances.find((item) => item.id === id);
    return instance
      ? displayableInstanceValue(instance).kind === "displayable"
      : false;
  });
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  const {
    createRouteAnchor,
    beginRouteStretch,
    drawSelectedMosBulk,
    deleteSelectedRouteConnection,
    fixWirePoint,
    finishWireAtPoint,
    handleFlightline,
    handleWireRoutePointerDown,
    handleWireEndpoint,
    commitWire,
    selectRoute,
  } = useWireInteraction({
    model: {
      document,
      resolver,
      visibleEndpoints,
      routeGeometryRecords,
      contactComponents,
    },
    selection: {
      selectedInstance,
      selectedRouteId,
      selectedRouteSegmentIndex,
      replaceRouteSelection: (routeIds) =>
        replaceSelectionKind("route", routeIds),
      selectOnly,
      setSelectedRouteSegmentIndex,
      setSelectedEndpoint,
    },
    session: {
      wireSource,
      wireSourceRevision,
      wireWaypoints,
      wireDraftSteps,
      wireRoutingMode,
      wireCornerOrder,
      setTool,
      setWireSource,
      setWirePreviewPoint,
      setWireDraftSteps,
      completeWire,
      clearTransientCanvasState,
      cancelInteraction,
      setBulkDrawInstanceId,
    },
    transaction: { nextRoutingSuffix, transact, setStatus },
    drag: {
      canvasDragSessionRef,
      setRouteStretchPreview,
      pointFromClient,
      logicalRadiusForPixels,
    },
  });
  const cellInsertCandidates = useMemo(
    () =>
      project.documents.flatMap((candidate) => {
        if (candidate.id === document.id || !candidate.netlist) return [];
        const definition = resolver.resolve(
          hierarchicalSymbolId(candidate.netlist.name),
        )?.definition;
        return definition
          ? [
              {
                childDocumentId: candidate.id,
                cellName: candidate.netlist.name,
                symbol: definition,
              },
            ]
          : [];
      }),
    [document.id, project.documents, resolver],
  );
  const externalSubcircuitInsertCandidates = useMemo(
    () =>
      project.externalSubcircuitDefinitions.flatMap((definition) => {
        const mapping = definition.presentation
          ? undefined
          : resolvePdkSymbolMappingForTerminalOrder(
              definition.name,
              definition.terminals.map((terminal) => terminal.name),
            );
        const symbol = resolver.resolve(
          mapping?.symbolId ?? externalSubcircuitSymbolId(definition.id),
        )?.definition;
        return symbol
          ? [
              {
                definitionId: definition.id,
                masterName: definition.name,
                symbol,
              },
            ]
          : [];
      }),
    [project.externalSubcircuitDefinitions, resolver],
  );
  const pendingPlacementSymbol = pendingSymbolId
    ? (resolver.resolve(pendingSymbolId)?.definition ??
      findPaletteSymbol(document.presentation.styleProfileId, pendingSymbolId))
    : undefined;
  const {
    beginRetainedInstancePlacement: beginRetainedInstancePlacementFromHook,
    cancelComponentInsert: cancelComponentInsertFromHook,
    commitPendingPlacementAt: commitPendingPlacementAtFromHook,
    closeInsertDialog: closeInsertDialogFromHook,
    insertDialogOpen,
    insertInitialSelectionId,
    insertScope,
    recentSymbolIds,
    rotatePendingComponent: rotatePendingComponentFromHook,
    mirrorPendingComponent: mirrorPendingComponentFromHook,
    startInsert: startInsertFromHook,
  } = useComponentPlacement({
    recentStorageKey: RECENT_COMPONENTS_STORAGE_KEY,
    document,
    project,
    resolver,
    styleProfile,
    visibleEndpoints,
    transact,
    transactConnectivity,
    transactProject: (transactionId, edits) =>
      commitStructure(transactionId, edits),
    selectOnly,
    cancelAllTransientInteraction,
    cancelCanvasDrag: () => canvasDragSessionRef.current?.cancel(),
    clearTransientCanvasState,
    paintSnapGuides,
    beginVddRailInteraction,
    activateDrawingTool: setTool,
    beginComponentPlacement: (request) => {
      beginComponentPlacement(request);
      seedComponentPreviewFromPointer();
    },
    beginDraftingTextEditing,
    nextId: (prefix) => {
      uniqueSuffixCounter.current += 1;
      return `${prefix}-${uniqueSuffixCounter.current}`;
    },
    rotateComponentPlacement,
    mirrorComponentPlacement,
    componentPlacementRotation,
    componentPlacementMirror,
    completeVddRailPlacement,
    setComponentPreviewPoint,
    setStatus,
    vddRailMode,
    vddRailNetName,
    vddRailStart,
    pendingSymbolId,
    pendingComponentPlacement,
    setVddRailStart,
    setVddRailPreviewPoint,
  });
  const {
    completeVisualSelectionMove,
    visualMoveOrigin: commandMoveVisualOrigin,
    resolveInstanceMove: instanceMoveAt,
    completeInstanceMove,
  } = createSelectionMoveController({
    document,
    resolver,
    visibleEndpoints,
    routeGeometryRecords,
    contactComponents,
    transactConnectivity,
    setStatus,
    nextRoutingSuffix,
  });
  const {
    rotate: rotateSelected,
    mirror: mirrorSelected,
    align: alignSelectedInstances,
  } = createSelectionTransformController({
    document,
    resolver,
    selectedInstanceIds: selectedIds,
    selection: visualSelection,
    transact,
    setStatus,
  });

  /** Arm R so the next part pointed at is the one that turns. */
  function armRotateOnNextPart(): void {
    setRotateArmed(true);
    setStatus("Rotate: click a part to turn it, Escape to stop");
  }

  /** Turn one part where it stands. Returns false when nothing was armed. */
  function rotateArmedInstance(instanceId: string): boolean {
    if (!rotateArmed) return false;
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return false;
    const next = (instance.placement.rotation + 90) % 360;
    const applied = transact([
      {
        kind: "rotate_instance",
        instanceId,
        rotation: next as 0 | 90 | 180 | 270,
      },
    ]);
    if (applied.ok) {
      setStatus(
        `Rotated ${instanceId} to ${next}° — click another, Escape to stop`,
      );
    }
    return true;
  }
  const {
    handleDrop,
    placeAll: placeAllFromTray,
    returnToTray: returnInstancesToTray,
  } = createPlacementTrayCommands({
    document,
    resolver,
    styleProfile,
    viewBox,
    pointFromDrop: (event) =>
      pointFromClient(event.clientX, event.clientY, event.currentTarget),
    transact,
    selectInstance: (id) => selectOnly("instance", [id]),
    resetSelection,
    setStatus,
    nextSuffix: () => {
      uniqueSuffixCounter.current += 1;
      return uniqueSuffixCounter.current;
    },
  });
  const {
    beginCopyPlacement: beginCopyPlacementFromSelection,
    beginKeyboardSelectionMove: beginKeyboardSelectionMoveFromSelection,
    beginMove: beginMoveFromSelection,
    beginVisualSelectionMove: beginVisualSelectionMoveFromSelection,
    commitCopyPlacement: commitCopyPlacementFromSelection,
    commitCommandMove: commitCommandMoveFromSelection,
    clearCommandMoveSession: clearCommandMoveSessionFromSelection,
    deleteSelectedJunction: deleteSelectedJunctionFromSelection,
    deleteSelection: deleteSelectionFromSelection,
    disconnectSelectedEndpoint,
    canBeginKeyboardSelectionMove,
    canTransformCommandMove,
    mirrorCommandMove: mirrorCommandMoveFromSelection,
    rotateCommandMove: rotateCommandMoveFromSelection,
    selectInstance: selectInstanceFromSelection,
    toggleSelectedNoConnect: toggleSelectedNoConnectFromSelection,
    updateCommandMovePreview: updateCommandMovePreviewFromSelection,
  } = useSelectionInteraction({
    document,
    resolver,
    visualSelection,
    selectedIds,
    selectedRouteId,
    selectedAnnotationId,
    selectedDraftingId,
    selectedEndpoint,
    selectedNoConnect,
    selectedEndpointNetId,
    getInteractionState: getCurrentInteractionState,
    transact,
    transactProjectDocument: (transactionId, edits) => {
      const committed = commitStructure(transactionId, [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits: [...edits],
        },
      ]);
      return {
        ok: committed,
        revision: committed ? document.revision + 1 : document.revision,
      };
    },
    commitCellTerminalSelection: removeCellTerminalSelection,
    setStatus,
    setSelectedEndpoint,
    resetSelection,
    replaceSelectionKind,
    selectOnly,
    deleteSelectedRouteConnection,
    deleteSelectedAnnotation,
    clearTransientCanvasState,
    cancelAllTransientInteraction,
    cancelInteraction,
    cancelCanvasDrag: () => canvasDragSessionRef.current?.cancel(),
    paintSnapGuides,
    beginCopyPlacementInteraction: (clipboard, anchor) => {
      beginCopyPlacementInteraction(clipboard, anchor);
      seedCopyPreviewFromPointer();
    },
    setCopyPreviewPoint,
    advanceCopyPlacement,
    nextUniqueSuffix: () => {
      uniqueSuffixCounter.current += 1;
      return uniqueSuffixCounter.current;
    },
    endpointTestId,
    tool,
    canvasDragSessionRef,
    pointFromClient,
    completeVisualSelectionMove,
    snapCoordinate,
    updateInstanceSelection,
    suppressInstanceClickRef: suppressInstanceClick,
    resolveInstanceMove: instanceMoveAt,
    completeInstanceMove,
    logicalRadiusForPixels,
    snapGuides: paintSnapGuides,
    setProjectedMovePreview: setProjectedMovePreviewDocument,
    beginSelectionMoveInteraction,
    visualMoveOrigin: commandMoveVisualOrigin,
  });

  const textEditingTarget = textEditing
    ? resolveTextEditingTarget(document, textEditing)
    : null;
  const editingAnnotation =
    textEditingTarget?.owner === "annotation"
      ? textEditingTarget.object
      : undefined;
  const selectedHiddenBulkNet = selectedInstance
    ? razaviHiddenBulkRisk(document, selectedInstance.id)
    : undefined;
  const selectedBulkResolution = selectedInstance
    ? resolveMosBulkConnection(document, selectedInstance)
    : undefined;
  const editingDrafting =
    textEditingTarget?.owner === "drafting"
      ? textEditingTarget.object
      : undefined;
  const textEditingBounds = editingAnnotation
    ? annotationHitBox(
        document,
        editingAnnotation,
        annotationAnchor(
          document,
          resolver,
          editingAnnotation,
          routeGeometryRecords,
          styleProfile,
        ),
        routeGeometryRecords,
        styleProfile,
      )
    : editingDrafting?.kind === "text"
      ? resolveDraftingObjectGeometry(document, resolver, editingDrafting)
          .bounds
      : null;
  const textEditingLocked = Boolean(textEditingTarget?.object.locked);

  const internalSelection = deriveRoutingAffectedClosure(document, {
    instanceIds: selectedIds,
    routeIds: visualSelection.routeIds,
    junctionIds: visualSelection.junctionIds,
    annotationIds: visualSelection.annotationIds,
  });
  const selectedInternalRouteIds = new Set(internalSelection.internalRoutes);
  const selectedInternalJunctionIds = new Set(
    internalSelection.internalJunctions,
  );
  const selectedInternalNetIds = new Set(
    document.routes
      .filter((route) => selectedInternalRouteIds.has(route.id))
      .map((route) => route.netId),
  );
  const selectedInternalObjectIds = new Set([
    ...selectedInternalNetIds,
    ...internalSelection.instances,
    ...internalSelection.internalRoutes,
    ...internalSelection.internalJunctions,
    ...internalSelection.electricalAnnotationIds,
  ]);
  const wireFixedPoints = wireSource
    ? compileWireDraft(wireSource, wireSource, wireDraftSteps).points
    : [];
  const wireDraftPoints =
    wireSource && wirePreviewPoint
      ? compileWireDraft(
          wireSource,
          {
            connection: {
              contactPoint: wirePreviewPoint,
              gridLanding: wirePreviewPoint,
              escapePath: [],
              outward: null,
            },
          },
          wireDraftSteps,
          wireRoutingMode,
          wireCornerOrder,
        ).points
      : wireFixedPoints;
  const projectInstanceCount = project.documents.reduce(
    (count, candidate) => count + candidate.instances.length,
    0,
  );
  const contentScene = useMemo(() => {
    try {
      return buildSvgScene(document, resolver);
    } catch {
      // Fit view falls back to the default framing when the bounds scene
      // cannot be built; the canvas itself renders through the guarded
      // formal-scene pipeline above.
      return null;
    }
  }, [document, resolver]);
  const zoomPercent = Math.round((DEFAULT_VIEWBOX.width / viewBox.width) * 100);
  const canvasIsEmpty =
    document.instances.every((instance) => instance.placement === null) &&
    document.routes.length === 0 &&
    document.annotations.length === 0 &&
    (document.drafting?.objects.length ?? 0) === 0;
  const {
    insertConstructionVertex,
    insertArrowWaypoint,
    deleteConstructionVertex,
    setDraftingStyle,
    setDraftingGeometry,
    setDraftingTangentAngle,
    setDraftingBearing,
    toggleDraftingLock,
    addPlainText,
    addCurrentArrow,
    reverseSelectedDrafting,
  } = createDraftingCommands({
    document,
    resolver,
    viewBox,
    selection: visualSelection,
    selectedDrafting,
    inspectorSegment: draftingInspectorSegment,
    selectedRoute,
    selectedRouteSegmentIndex,
    routeGeometryRecords,
    transact,
    setStatus,
    nextId: (prefix) => {
      uniqueSuffixCounter.current += 1;
      return `${prefix}-${uniqueSuffixCounter.current}`;
    },
    beginTextEditing: beginDraftingTextEditing,
    selectAnnotation: (id) => selectOnly("annotation", [id]),
  });
  const {
    snapPoint: snapDraftingPoint,
    handleCanvasClick: handleDraftingCanvasClick,
    finish: finishDraftingCreate,
  } = createDraftingCreateController({
    document,
    resolver,
    visibleEndpoints,
    routeGeometryRecords,
    tool,
    source: draftingSource,
    hover: draftingHover,
    waypoints: draftingWaypoints,
    setSource: setDraftingSource,
    setHover: setDraftingHover,
    setWaypoints: setDraftingWaypoints,
    setSnapPoint: setDraftingSnapPoint,
    clear: clearDraftingCreate,
    setTool,
    transact,
    setStatus,
    nextId: (prefix) => {
      uniqueSuffixCounter.current += 1;
      return `${prefix}-${uniqueSuffixCounter.current}`;
    },
  });
  const {
    beginDrag: beginDraftingDrag,
    beginHandleDrag: beginDraftingHandleDrag,
  } = createDraftingDragController({
    document,
    resolver,
    visibleEndpoints,
    dragSessionRef: canvasDragSessionRef,
    dragThresholdPx: DRAG_START_DISTANCE_PX,
    snapCaptureRadiusPx: SNAP_CAPTURE_RADIUS_PX,
    pointFromClient: (clientX, clientY, svg, snapToGrid) =>
      snapToGrid
        ? pointFromClient(clientX, clientY, svg)
        : pointFromClient(clientX, clientY, svg, false),
    logicalRadiusForPixels,
    paintSnapGuides,
    snapDraftingPoint,
    onCompositeMove: (event, hitTarget) => {
      if (getCurrentInteractionState().kind !== "moving-selection")
        return false;
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId) {
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
      } else {
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          hitTarget,
        );
      }
      return true;
    },
    selectDraftingObject,
    setInspectorSegment: setDraftingInspectorSegment,
    clearTangentInput: () => setDraftingTangentInput(null),
    setHandlePreview: setDraftingHandlePreview,
    transact,
    setStatus,
  });
  const { beginDrag: beginAnnotationDrag } = createAnnotationDragController({
    document,
    resolver,
    routeGeometryRecords,
    dragSessionRef: canvasDragSessionRef,
    dragThresholdPx: DRAG_START_DISTANCE_PX,
    pointFromClient: (clientX, clientY, svg) =>
      pointFromClient(clientX, clientY, svg, false),
    onCompositeMove: (event, hitTarget) => {
      if (getCurrentInteractionState().kind !== "moving-selection") {
        return false;
      }
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId) {
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
      } else {
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          hitTarget,
        );
      }
      return true;
    },
    selectAnnotation: (id) => selectOnly("annotation", [id]),
    clearSelectedEndpoint: () => setSelectedEndpoint(null),
    transact,
    setStatus,
  });
  const {
    resolveWireCanvasSnap,
    cycleWireCornerShape,
    applyWireCanvasPoint,
    handleRoutePointerDown,
  } = useWireCanvasController({
    model: {
      document,
      resolver,
      wiringEndpoints,
      routeGeometryRecords,
      contactComponents,
    },
    session: {
      wireSource,
      wireWaypoints,
      wireDraftSteps,
      wireRoutingMode,
      wireCornerOrder,
      tool,
      vddRailMode,
      componentPlacementPending: Boolean(
        pendingSymbolId && pendingComponentPlacement,
      ),
      getInteractionKind: () => getCurrentInteractionState().kind,
      cancelInteraction,
      setWireSource,
      setWirePreviewPoint,
      setWireDraftSteps,
      setWireRoutingMode,
      setWireCornerOrder,
    },
    selection: {
      selectedInstanceIds: selectedIds,
      selection: visualSelection,
      beginInstanceMove: beginMoveFromSelection,
      beginVisualSelectionMove: beginVisualSelectionMoveFromSelection,
    },
    routes: {
      handlePointerDown: handleWireRoutePointerDown,
      select: selectRoute,
      beginStretch: beginRouteStretch,
      createAnchor: createRouteAnchor,
    },
    viewport: {
      pointFromClient: (clientX, clientY, svg) =>
        pointFromClient(clientX, clientY, svg, false),
      logicalRadiusForPixels,
      paintSnapGuides,
    },
    commands: { commitWire, fixWirePoint, finishWireAtPoint, setStatus },
  });
  const {
    compositeSelectionOwnsHit,
    handlePointerDown: handleCanvasHitPointerDown,
  } = createCanvasHitController({
    model: {
      document,
      visibleEndpoints,
      selection: visualSelection,
      selectedInternalRouteIds,
      selectedInternalJunctionIds,
      selectedInternalObjectIds,
    },
    session: {
      getInteractionKind: () => getCurrentInteractionState().kind,
      placementOwnsCanvas: Boolean(
        (pendingSymbolId && pendingComponentPlacement) ||
        vddRailMode ||
        copyPlacement !== null,
      ),
      tool,
      cellSymbolLayoutEnabled,
    },
    actions: {
      beginInstanceMove: beginMoveFromSelection,
      beginVisualSelectionMove: beginVisualSelectionMoveFromSelection,
      beginAnnotationDrag,
      handleRoutePointerDown,
      beginDraftingDrag,
      selectEndpoint,
      endpointStatusLabel: (endpoint) => endpointTestId(endpoint.endpoint),
      setStatus,
    },
  });
  const {
    fitView,
    zoomViewAtCenter,
    handleWheel,
    beginCanvasGesture,
    continueCanvasGesture,
    finishCanvasGesture,
  } = createCanvasGestureController({
    model: { document, resolver, routeGeometryRecords, styleProfile },
    viewport: {
      defaultViewBox: DEFAULT_VIEWBOX,
      contentBounds: contentScene?.viewBox,
      viewBox,
      setViewBox,
      pointFromClient: (clientX, clientY, svg) =>
        pointFromClient(clientX, clientY, svg),
      rawPointFromClient: (clientX, clientY, svg) =>
        pointFromClient(clientX, clientY, svg, false),
      logicalRadiusForPixels,
    },
    gestureSession: {
      boxPreview,
      setBoxPreview,
      panPreview,
      setPanPreview,
      getInteractionKind: () => getCurrentInteractionState().kind,
      paintSnapGuides,
      noteCanvasPoint: (point) => {
        lastCanvasPointRef.current = point;
      },
      setStatus,
      measureCanvasView,
    },
    selection: {
      updateCommandMovePreview: updateCommandMovePreviewFromSelection,
      replaceSelection,
      clearSelectedEndpoint: () => setSelectedEndpoint(null),
    },
    placement: {
      componentPlacementPending: Boolean(
        pendingSymbolId && pendingComponentPlacement,
      ),
      componentSymbolPending: pendingSymbolId !== null,
      setComponentPreviewPoint,
      vddRailMode,
      vddRailStart,
      setVddRailPreviewPoint,
      copyPlacementPending: copyPlacement !== null,
      setCopyPreviewPoint,
    },
    drafting: {
      tool,
      draftingSource,
      snapDraftingPoint,
      setDraftingHover,
      setDraftingSnapPoint,
    },
    wiring: {
      wireActive: wireSource !== null,
      resolveWireCanvasSnap,
      setWirePreviewPoint,
      cycleWireCornerShape,
    },
    cellSymbolLayout: {
      activeDragPointerId: cellSymbolLayoutDragPointerId,
      cancelDrag: cancelCellSymbolLayoutDrag,
      completeDrag: completeCellSymbolLayoutDrag,
    },
  });
  /**
   * The canvas element and the docks floating over it. Fit reads this at the
   * moment it runs, so a panel opened since the last fit is accounted for.
   */
  function measureCanvasView(): {
    viewport: { width: number; height: number };
    insets: CanvasInsets;
  } | null {
    const canvas = window.document.querySelector(
      '[data-testid="schematic-canvas"]',
    );
    if (!canvas) return null;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
    const overlays = [
      ...window.document.querySelectorAll("[data-canvas-overlay]"),
    ].map((element) => element.getBoundingClientRect());
    return {
      viewport: { width: canvasRect.width, height: canvasRect.height },
      insets: canvasInsetsFromOverlays(canvasRect, overlays),
    };
  }

  const {
    switchDocument,
    selectDocumentFromHierarchy,
    openInstanceFromTable,
    jumpToCaller,
    navigateToLocator,
    navigateToNetlistDiagnostic,
    fitDocument,
    enterHierarchy,
    enterSelectedHierarchy,
    returnToParentDocument,
    returnToTopDocument,
    selectSearchResult,
    jumpToProjectDiagnostic,
    highlightNet,
    toggleHighlightedNet,
    navigateTraceHop,
  } = createEditorNavigationController({
    project,
    document,
    resolver,
    connectivityIndex: projectConnectivityIndex,
    documentStack,
    setDocumentStack,
    documentViewBoxes,
    viewBox,
    defaultViewBox: DEFAULT_VIEWBOX,
    setViewBox,
    measureCanvasView,
    openDocument,
    resetInteractionState,
    selectOnly,
    setSelectedEndpoint,
    setHighlightedNetOrigin,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
    selectedHighlightIsActive,
    closeSearch,
    setSelectionOpen,
    setInstanceTableOpen,
    setCellManagerOpen,
    selectedInstance,
    setStatus,
  });
  const applyAgentSemanticIntent = createAgentSemanticIntentHandler({
    project,
    resolver,
    connectivityIndex: projectConnectivityIndex,
    navigateToLocator,
    fitDocument,
    clearFocus: () => {
      resetInteractionState();
      setHighlightedNetOrigin(null);
      setSelectionOpen(false);
      setStatus("Agent cleared semantic focus");
    },
    highlightNet,
  });
  agentSemanticIntentRef.current = applyAgentSemanticIntent;

  useEffect(() => {
    if (!selectedRouteId) setSelectedRouteSegmentIndex(null);
  }, [selectedRouteId]);

  useEffect(() => {
    const pruned = pruneVisualSelection(visualSelection, document);
    if (pruned !== visualSelection) replaceSelection(pruned);
  }, [document, visualSelection]);

  function openProperties(): void {
    setImportReviewOpen(false);
    setSelectionOpen(true);
    // Focus the header, not the first field: Q stays a pure toggle and
    // editing starts only when the user clicks an input.
    requestAnimationFrame(() => {
      selectionShelfRef.current?.focus();
    });
  }

  function closeProperties(): void {
    exitCellSymbolLayout();
    setSelectionOpen(false);
    setImportReviewOpen(false);
  }

  function selectAllObjects(): void {
    replaceSelection({
      instanceIds: document.instances
        .filter((instance) => instance.placement)
        .map((instance) => instance.id),
      routeIds: document.routes.map((route) => route.id),
      junctionIds: document.junctions.map((junction) => junction.id),
      annotationIds: document.annotations.map((annotation) => annotation.id),
      draftingIds: (document.drafting?.objects ?? []).map(
        (object) => object.id,
      ),
    });
    setSelectedEndpoint(null);
  }

  function clearEditorSelection(): void {
    resetSelection();
    setSelectedEndpoint(null);
    setSelectedRouteSegmentIndex(null);
    setStatus("Selection cleared");
  }

  function inspectInstance(instanceId: string): void {
    setSelectedEndpoint(null);
    updateInstanceSelection(instanceId, false);
    setImportReviewOpen(false);
    setSelectionOpen(true);
    setStatus(`Properties for ${instanceId}`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => instanceValueInputRef.current?.focus());
    });
  }

  function showLibraryPanel(): void {
    showLeftPanel("library");
  }

  function showExamplesPanel(): void {
    showLeftPanel("examples");
  }

  function toggleExamplesPanel(): void {
    toggleExamplesPanelFromShell();
  }

  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (bootTargetHandled.current) return;
    bootTargetHandled.current = true;
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    if (initialGalleryEntryId) {
      void openGalleryEntryById(initialGalleryEntryId, false);
      return;
    }
    if (exampleId) {
      const exampleProject = createLibraryExampleProject(exampleId);
      const example = libraryProjectExamples.find(
        (candidate) => candidate.id === exampleId,
      );
      if (exampleProject && example) {
        replaceActiveProject(exampleProject, DEFAULT_VIEWBOX, {
          rememberPrevious: false,
        });
        setStatus(`Opened example: ${example.name}`);
      }
    }
  }, [initialGalleryEntryId]);

  function resetInteractionState(): void {
    exitCellSymbolLayout();
    cancelAllTransientInteraction();
    resetSelection();
    setSelectedRouteSegmentIndex(null);
    clearTextEditing();
    setSelectedEndpoint(null);
  }

  function cancelAllTransientInteraction(): void {
    closeInsertDialogFromHook();
    clearCommandMoveSessionFromSelection();
    canvasDragSessionRef.current?.cancel();
    clearTransientCanvasState();
    paintSnapGuides([]);
    cancelInteraction();
    setBulkDrawInstanceId(null);
    setBoxPreview(null);
    setRotateArmed(false);
  }

  function selectEndpoint(candidate: WireSource): void {
    setSelectedEndpoint(candidate);
    if (candidate.endpoint.kind === "junction") {
      selectOnly("junction", [candidate.endpoint.junctionId]);
    } else {
      resetSelection();
    }
  }

  const cellManagerEntries = useMemo(
    () => summarizeProjectCells(project),
    [project],
  );

  function placeCellInstance(): void {
    if (cellInsertCandidates.length === 0) {
      setStatus("Create another Cell before placing a hierarchical Instance");
      return;
    }
    editorCommands.execute({
      id: "insert.start",
      launch: cellInsertLaunch(),
    });
    setStatus("Choose a Cell, then place it on the canvas");
  }

  const selectedFormalTerminal = selectedInstance
    ? document.netlist?.terminals.find((terminal) =>
        terminal.interfaceInstanceIds.includes(selectedInstance.id),
      )
    : undefined;
  // A design routinely carries VDDH and VDDL, or VDD1 and VDD2, at once, so a
  // supply marker keeps its explicit Global-Net name.
  const selectedSupplyMarker =
    selectedInstance?.symbolId === "vdd-port" ? selectedInstance : undefined;
  const selectedPortNet =
    selectedInstance && selectedInstance.symbolId === "vdd-port"
      ? document.nets.find((net) =>
          net.terminals.some(
            (terminal) => terminal.instanceId === selectedInstance.id,
          ),
        )
      : undefined;
  const selectedPortLogicalName = selectedPortNet
    ? logicalNets.byBaseNetId.get(selectedPortNet.id)?.name
    : undefined;

  function commitProjectName(): void {
    setProjectNameDraft(null);
    renameProject(projectNameDraft);
  }

  function renameSelectedFormalPort(name: string): void {
    if (!selectedFormalTerminal) return;
    name = name.trim();
    if (!name || name === selectedFormalTerminal.name) return;
    renameCellTerminal(
      selectedFormalTerminal.id,
      name,
      document.id,
      "rename-cell-pin",
    );
  }

  function deleteSelectedFormalPort(): void {
    if (!selectedFormalTerminal || !selectedInstance) return;
    if (deleteCellTerminal(selectedFormalTerminal.id, selectedInstance.id)) {
      resetSelection();
    }
  }

  function approveAgentFileCandidate(): void {
    if (!agentFileCandidate) return;
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
      });
      setStatus(`Accepted Agent ${meta.kind} candidate: ${candidate.name}`);
    });
  }

  function rejectAgentFileCandidate(): void {
    if (!agentFileCandidate) return;
    browserAgentFileHost.discard(agentFileCandidate.candidateId);
    setAgentFileCandidate(null);
    setStatus("Rejected Agent file candidate");
  }

  const clearDrawingPlan = planCellReset(project, document.id, "clear-drawing");
  const resetPlacementPlan = planCellReset(
    project,
    document.id,
    "reset-placement",
  );
  const resetBodyPlan = planCellReset(project, document.id, "reset-body");

  function commitCellReset(plan: CellResetPlan, command: string): void {
    if (plan.edits.length === 0) {
      setStatus(command + " has nothing to change in Cell " + document.name);
      return;
    }
    setPendingCellReset({ plan, command });
  }

  function confirmClearCanvas(): void {
    if (!pendingCellReset) return;
    const { plan, command } = pendingCellReset;
    const result = transact([...plan.edits]);
    if (!result.ok) return;
    setPendingCellReset(null);
    resetInteractionState();
    setStatus(
      command + " completed in Cell " + document.name + " · Undo restores it",
    );
  }

  function cancelClearCanvas(): void {
    const command = pendingCellReset?.command ?? "Cell reset";
    setPendingCellReset(null);
    setStatus(command + " cancelled");
  }

  function updateMosBulkDefault(
    kind: "nmos" | "pmos",
    netId: string | null,
  ): void {
    const result = transact([
      ...planMosBulkDefaultUpdate(document, kind, netId),
    ]);
    if (!result.ok) return;
    setStatus(
      `${kind === "nmos" ? "NMOS" : "PMOS"} bulk default ${
        netId ? "updated" : "cleared"
      }`,
    );
  }

  function nextRoutingSuffix(): number {
    routeCounter.current =
      Math.max(routeCounter.current, maxRoutingCounter(document)) + 1;
    return routeCounter.current;
  }

  function activateTool(nextTool: EditorTool): void {
    const currentInteraction = getCurrentInteractionState();
    const alreadyActive =
      (nextTool === "wire" && currentInteraction.kind === "wire") ||
      (currentInteraction.kind === "drawing" &&
        currentInteraction.tool === nextTool) ||
      (nextTool === "pointer" && currentInteraction.kind === "idle");
    if (alreadyActive) return;
    exitCellSymbolLayout();
    if (currentInteraction.kind === "moving-selection") {
      clearCommandMoveSessionFromSelection();
    }
    canvasDragSessionRef.current?.cancel();
    clearTransientCanvasState();
    paintSnapGuides([]);
    setTool(nextTool);
    if (nextTool !== "pointer") {
      resetSelection();
      setSelectedEndpoint(null);
      setSelectedRouteSegmentIndex(null);
    }
    setStatus(
      nextTool === "wire"
        ? "Wire: choose a pin, junction, route segment, or blank grid point"
        : nextTool === "rectangle"
          ? "Rectangle: click the first corner"
          : nextTool === "circle"
            ? "Circle: click the center"
            : nextTool === "arrow"
              ? "Arrow: click the start point"
              : nextTool === "construction-line"
                ? "Construction line: click the start point"
                : "Pointer ready",
    );
  }

  function rotatePendingCopy(delta: 90 | -90): void {
    if (!copyPlacement) return;
    rotateCopyPlacement(delta);
    setStatus("Place rotated copy · R rotates · Esc cancels");
  }

  function mirrorPendingCopy(direction: ScreenFlip): void {
    if (!copyPlacement) return;
    mirrorCopyPlacement(direction);
    setStatus(
      `Place copy mirrored ${direction === "left-right" ? "left/right" : "top/bottom"} · R rotates · Esc cancels`,
    );
  }

  function pointFromClient(
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid?: true,
  ): Point;
  function pointFromClient(
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid: false,
  ): DerivedPoint;
  function pointFromClient(
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
    snapToGrid = true,
  ): DerivedPoint {
    return canvasPointFromClient(
      clientX,
      clientY,
      svg,
      viewBox,
      document.presentation.grid,
      snapToGrid,
    );
  }

  function logicalRadiusForPixels(svg: SVGSVGElement, pixels: number): number {
    return logicalRadiusForCanvasPixels(svg, pixels);
  }

  function paintSnapGuides(guides: readonly SnapGuideLine[]): void {
    replaceCanvasSnapGuides(snapGuideLayerRef.current, guides);
  }

  /**
   * Editor-only visual state must never outlive the interaction that produced
   * it. In particular, Smart Snap guides are imperative SVG children so React
   * does not remove them when a document or tool state changes underneath a
   * pointer session.
   */
  function clearTransientCanvasState(): void {
    canvasDragSessionRef.current?.cancel();
    canvasDragSessionRef.current = null;
    paintSnapGuides([]);
  }

  useEffect(() => {
    const cancelWhenHidden = () => {
      if (globalThis.document.visibilityState === "hidden") {
        clearTransientCanvasState();
      }
    };
    const cancelOnPageHide = () => clearTransientCanvasState();
    globalThis.document.addEventListener("visibilitychange", cancelWhenHidden);
    globalThis.window.addEventListener("pagehide", cancelOnPageHide);
    return () => {
      globalThis.document.removeEventListener(
        "visibilitychange",
        cancelWhenHidden,
      );
      globalThis.window.removeEventListener("pagehide", cancelOnPageHide);
      clearTransientCanvasState();
    };
  }, []);

  const editorCommands = createEditorCommandRouter({
    getContext: () => ({
      interactionMode: getCurrentInteractionState().kind,
      activeTool: tool,
      hasDeletableSelection:
        hasVisualSelection(visualSelection) || selectedEndpoint !== null,
      hasMoveSelection: canBeginKeyboardSelectionMove(),
      hasRotatableSelection,
      hasMirrorableSelection,
      canTransformMove: canTransformCommandMove(),
      hasInspectableSelection,
      propertiesOpen: selectionOpen,
      canUndo,
      canRedo,
      helpOpen,
      canvasDragActive: canvasDragSessionRef.current !== null,
      hasClearableDraftingSelection:
        selectedDrafting?.kind === "arrow" ||
        selectedDrafting?.kind === "construction-line" ||
        selectedDrafting?.kind === "rectangle" ||
        selectedDrafting?.kind === "circle",
    }),
    operations: {
      closeHelp,
      cancelCanvasDrag: () => {
        canvasDragSessionRef.current?.cancel();
        setStatus("Cancelled canvas drag");
      },
      cancelInteraction: (interactionMode) => {
        cancelAllTransientInteraction();
        setStatus(
          interactionMode === "copy-placement"
            ? "Copy placement cancelled"
            : interactionMode === "placing-vdd-rail"
              ? "Power Rail cancelled"
              : interactionMode === "placing-component"
                ? "Component placement cancelled"
                : interactionMode === "drawing"
                  ? "Drawing cancelled"
                  : "Cancelled active tool",
        );
      },
      clearDraftingSelection: () => {
        replaceSelectionKind("drafting", []);
        setStatus("Cleared drawing selection");
      },
      cancelPassive: () => {
        setBoxPreview(null);
        paintSnapGuides([]);
        setStatus("Cancelled");
      },
      undo: () => {
        transact([{ kind: "undo" }]);
      },
      redo: () => {
        transact([{ kind: "redo" }]);
      },
      selectAll: selectAllObjects,
      clearSelection: clearEditorSelection,
      deleteSelection: deleteSelectionFromSelection,
      beginCopy: beginCopyPlacementFromSelection,
      beginMove: beginKeyboardSelectionMoveFromSelection,
      rotatePlacement: rotatePendingComponentFromHook,
      rotateCopy: rotatePendingCopy,
      rotateMove: rotateCommandMoveFromSelection,
      rotateSelection: rotateSelected,
      armRotate: () => armRotateOnNextPart(),
      mirrorPlacement: mirrorPendingComponentFromHook,
      mirrorCopy: mirrorPendingCopy,
      mirrorMove: mirrorCommandMoveFromSelection,
      mirrorSelection: mirrorSelected,
      startInsert: startInsertFromHook,
      openInsert: () => startInsertFromHook(fullInsertLaunch()),
      placeCellPin: () => {
        const request = quickPlaceRequest(
          document.presentation.styleProfileId,
          "port",
        );
        if (request) startInsertFromHook({ kind: "quick", request });
      },
      activateTool,
      addText: addPlainText,
      openProperties,
      closeProperties,
      fitView,
      report: setStatus,
    },
  });
  const {
    exportSvg,
    checkAndSave,
    exportDesignNetlist,
    exportRaster,
    importSpiceFiles,
  } = createEditorFileCommands({
    project,
    getCurrentProject: () => editorDocumentController.project,
    document,
    resolver,
    defaultViewBox: DEFAULT_VIEWBOX,
    publishSessionPresent: publishSession !== null,
    netlistIr: netlistAnalysis.ir,
    exportWarningsPresent:
      netlistAnalysis.diagnostics.length > 0 ||
      electricalDiagnostics.length > 0,
    transact,
    reportExport,
    guardDirtyReplacement,
    replaceActiveProject,
    setWorkspaceSlots,
    setNetlistPreflightOpen,
    setImportReport,
    setImportReviewOpen,
    setSelectionOpen,
    setStatus,
  });

  // Single entry point for selecting a drafting object. Editing is opened
  // separately (double-click/Enter) so selection and text caret ownership do
  // not fight drag gestures.
  function selectDraftingObject(id: string): void {
    selectOnly("drafting", [id]);
    setDraftingInspectorSegment(null);
    setDraftingTangentInput(null);
    setDraftingBearingInput(null);
  }

  useEffect(() => {
    function dismissOnOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetElement =
        target instanceof Element ? target : target.parentElement;
      if (
        textEditing &&
        !targetElement?.closest('[data-testid="canvas-text-editor"]')
      ) {
        // Leaving the canvas text editor commits the session; emptying the
        // text still deletes the annotation, matching the Apply button.
        commitTextEditing();
      }
      const openMenus = Array.from(
        globalThis.document.querySelectorAll<HTMLDetailsElement>(
          ".command-menu[open]",
        ),
      );
      if (
        openMenus.length > 0 &&
        !openMenus.some((menu) => menu.contains(target))
      ) {
        dismissOpenCommandMenus();
      }
    }
    globalThis.document.addEventListener(
      "pointerdown",
      dismissOnOutsidePointerDown,
      true,
    );
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        dismissOnOutsidePointerDown,
        true,
      );
  }, [textEditing]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "Escape" && insertDialogOpen) {
        // The dialog focuses its search field a frame after it opens, so an
        // Escape pressed in that gap never reaches its own handler. Cancel it
        // from the window instead of leaving the dialog stuck open.
        event.preventDefault();
        cancelComponentInsertFromHook();
        return;
      }
      if (event.key === "Escape" && dismissOpenCommandMenus()) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && textEditing) {
        event.preventDefault();
        // Escape commits the session; emptying the text still deletes the
        // annotation, matching the Apply button.
        commitTextEditing();
        return;
      }
      if (
        event.key === "Escape" &&
        isTypingTarget(event.target) &&
        event.target instanceof Element &&
        event.target.closest(".selection-dock") !== null
      ) {
        // Escape inside Properties commits pending drafts instead of losing
        // them; a second Escape resumes normal canvas cancel behavior.
        event.preventDefault();
        commitInstancePropertyDraft();
        commitPendingNetLabelDraft();
        if (event.target instanceof HTMLElement) event.target.blur();
        return;
      }
      const currentInteraction = getCurrentInteractionState();
      const shortcut = resolveEditorShortcut(event, {
        isTyping: isTypingTarget(event.target),
        interactionMode: currentInteraction.kind,
        hasRoutedMarkerSelection: Boolean(
          selectedAnnotation && isRoutedMarker(selectedAnnotation),
        ),
        canRotate: editorCommands.state({ id: "transform.rotate" }).enabled,
        canMirror: editorCommands.state({
          id: "transform.mirror",
          direction: "left-right",
        }).enabled,
        hasDraftingSelection: Boolean(selectedDrafting),
        hasInspectableSelection,
        hasRouteSelection: Boolean(selectedRoute),
        hasHighlightableNet: selectedHighlightNetId !== null,
        wireReadyToFinish: Boolean(wireSource && wirePreviewPoint),
        draftingReadyToFinish:
          (tool === "arrow" ||
            tool === "construction-line" ||
            tool === "rectangle" ||
            tool === "circle") &&
          draftingSource !== null,
        hasRemovableWireWaypoint: Boolean(
          wireSource && wireDraftSteps.length > 0,
        ),
        propertiesOpen: selectionOpen,
        hasHierarchyEnterSelection,
        canReturnToParent: documentStack.length > 0,
      });
      if (!shortcut) return;

      const escapeIntent =
        shortcut.kind === "run-command" &&
        shortcut.command.id === "editor.cancel";
      if (!escapeIntent) event.preventDefault();

      switch (shortcut.kind) {
        case "run-command":
          editorCommands.execute(shortcut.command);
          return;
        case "block-browser-refresh":
          setStatus("Refresh blocked to protect the current circuit");
          return;
        case "block-browser-bookmark":
          setStatus("Browser bookmark shortcut blocked while editing");
          return;
        case "save":
          void saveProjectFile();
          return;
        case "open":
          projectInputRef.current?.click();
          return;
        case "reverse-current-marker":
          reverseSelectedCurrentArrow();
          return;
        case "edit-net-label":
          beginNetLabelEditing();
          return;
        case "net-label-selection-required":
          setStatus("Select a wire segment before adding a Net Label");
          return;
        case "toggle-net-highlight":
          toggleHighlightedNet();
          return;
        case "enter-hierarchy":
          enterSelectedHierarchy();
          return;
        case "return-to-parent":
          returnToParentDocument();
          return;
        case "hierarchy-selection-required":
          setStatus("Select a hierarchical block before entering a Cell");
          return;
        case "step-drafting-style": {
          if (!selectedDrafting) return;
          if (shortcut.target === "arrow-head") {
            const scale = selectedDrafting.styleOverride?.arrowHeadScale ?? 1;
            setDraftingStyle({
              arrowHeadScale: stepBoundedScale(
                scale,
                [0.75, 1, 1.25, 1.5] as const,
                shortcut.increase,
              ),
            });
          } else {
            const scale = selectedDrafting.styleOverride?.strokeScale ?? 1;
            setDraftingStyle({
              strokeScale: stepBoundedScale(
                scale,
                [0.75, 1, 1.5, 2] as const,
                shortcut.increase,
              ),
            });
          }
          return;
        }
        case "finish-wire":
          if (wirePreviewPoint) finishWireAtPoint(wirePreviewPoint);
          return;
        case "toggle-wire-options":
          setWireOptionsOpen((open) => !open);
          return;
        case "finish-drafting":
          finishDraftingCreate();
          return;
        case "remove-wire-waypoint":
          setWireDraftSteps(wireDraftSteps.slice(0, -1));
          setStatus("Removed last authored wire step");
          return;
        case "blocked-interaction-command":
          setStatus(
            `${shortcut.command} is unavailable while an active tool owns the canvas · Esc cancels`,
          );
          return;
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const canvasEventHandlers = createEditorCanvasEventHandlers({
    model: { tool, document, resolver },
    session: {
      interactionKind: () => getCurrentInteractionState().kind,
      cellSymbolLayoutEnabled,
      exitCellSymbolLayout,
    },
    coordinates: {
      pointFromClient,
      logicalRadiusForPixels,
      snapCaptureRadiusPixels: SNAP_CAPTURE_RADIUS_PX,
    },
    selection: {
      commitCommandMove: commitCommandMoveFromSelection,
      clearDraftingSelection: () => replaceSelectionKind("drafting", []),
      handleCanvasHitPointerDown,
    },
    placement: {
      pendingSymbolId,
      pendingComponentPlacement: Boolean(pendingComponentPlacement),
      vddRailMode,
      copyPlacementActive: copyPlacement !== null,
      snapPlacementPoint: (point) => ({
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      }),
      commitCopyPlacement: commitCopyPlacementFromSelection,
      commitPendingPlacement: commitPendingPlacementAtFromHook,
      clearComponentPreview: () => setComponentPreviewPoint(null),
      clearVddRailPreview: () => setVddRailPreviewPoint(null),
      clearCopyPreview: () => setCopyPreviewPoint(null),
    },
    gesture: {
      begin: beginCanvasGesture,
      continue: continueCanvasGesture,
      finish: finishCanvasGesture,
      cancelDrag: () => canvasDragSessionRef.current?.cancel(),
      onWheel: handleWheel,
      onDrop: handleDrop,
    },
    drafting: {
      selected: selectedDrafting,
      sourceActive: draftingSource !== null,
      handleCanvasClick: handleDraftingCanvasClick,
      beginAnnotationTextEditing,
      beginTextEditing: beginDraftingTextEditing,
      nextRectangleLabelId: () => {
        uniqueSuffixCounter.current += 1;
        return `note-${uniqueSuffixCounter.current}`;
      },
      upsertObject: (object) =>
        transact([{ kind: "upsert_drafting_object", object }]).ok,
      finishCreate: finishDraftingCreate,
      cancelCreate: clearDraftingCreate,
    },
    wiring: {
      source: wireSource,
      draftStepCount: wireDraftSteps.length,
      applyCanvasPoint: applyWireCanvasPoint,
      resolveCanvasSnap: resolveWireCanvasSnap,
      complete: completeWire,
      cancel: () => {
        setWireSource(null, null);
        setWirePreviewPoint(null);
        setWireDraftSteps([]);
        setTool("pointer");
        setBulkDrawInstanceId(null);
        setStatus("Wire cancelled");
      },
    },
    report: setStatus,
  });

  return (
    <main className="app-shell">
      {renderCrashRequested() ? <RenderCrashProbe /> : null}
      <EditorAppChrome
        projectName={project.name}
        projectNameDraft={projectNameDraft}
        documentName={document.name}
        onProjectNameDraftChange={setProjectNameDraft}
        onProjectNameCommit={commitProjectName}
        onProjectNameCancel={() => setProjectNameDraft(null)}
        fileCommands={{
          workspaceSlots,
          previousProjectName: previousProject?.project.name ?? null,
          canRevert: formalProjectBaseline !== null && isDirtyWork(),
          hasRecoverySessions: recoverySessions.length > 0,
          projectInputRef,
          onNewProject: createNewProject,
          onSaveProject: (pickLocation) =>
            void saveProjectFile({ pickLocation }),
          onOpenShelfSlot: (slot) => void openShelvedCircuit(slot),
          onRefresh: refreshApp,
          onOpenProject: (file) => void openProjectFile(file),
          onImportSpice: (files) => void importSpiceFiles(files),
          onExportSvg: exportSvg,
          onExportRaster: (format) => void exportRaster(format),
          onExportNetlist: exportDesignNetlist,
          onRestorePrevious: restorePreviousProject,
          onRevert: revertToFormalProjectBaseline,
          onOpenRecovery: openRecoveryDialog,
        }}
        searchOpen={searchOpen}
        onManageCells={() => setCellManagerOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        undo={{
          enabled: editorCommands.state({ id: "history.undo" }).enabled,
          execute: () => editorCommands.execute({ id: "history.undo" }),
        }}
        redo={{
          enabled: editorCommands.state({ id: "history.redo" }).enabled,
          execute: () => editorCommands.execute({ id: "history.redo" }),
        }}
        deleteSelection={{
          enabled:
            hasVisualSelection(visualSelection) || selectedEndpoint !== null,
          execute: () => editorCommands.execute({ id: "selection.delete" }),
        }}
        resets={[
          {
            label: "Clear Drawing",
            enabled: clearDrawingPlan.edits.length > 0,
            execute: () => commitCellReset(clearDrawingPlan, "Clear Drawing"),
          },
          {
            label: "Reset Cell Placement",
            enabled: resetPlacementPlan.edits.length > 0,
            execute: () =>
              commitCellReset(resetPlacementPlan, "Reset Cell Placement"),
          },
          {
            label: "Reset Cell Body",
            enabled: resetBodyPlan.edits.length > 0,
            execute: () => commitCellReset(resetBodyPlan, "Reset Cell Body"),
          },
        ]}
        rotate={{
          enabled: editorCommands.state({ id: "transform.rotate" }).enabled,
          execute: () => editorCommands.execute({ id: "transform.rotate" }),
        }}
        mirrorLeftRight={{
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "left-right",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "left-right",
            }),
        }}
        mirrorTopBottom={{
          enabled: editorCommands.state({
            id: "transform.mirror",
            direction: "top-bottom",
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "transform.mirror",
              direction: "top-bottom",
            }),
        }}
        onAlign={selectedIds.length > 1 ? alignSelectedInstances : null}
        instanceTableOpen={instanceTableOpen}
        netlistPreflightOpen={netlistPreflightOpen}
        onOpenInstanceTable={() => setInstanceTableOpen(true)}
        onOpenNetlistPreflight={() => setNetlistPreflightOpen(true)}
        agentAction={
          publicAgentUiEnabled
            ? {
                label:
                  agentSession.status === "idle"
                    ? "Connect Agent"
                    : "Manage Agent",
                execute: () => {
                  if (agentSession.status === "idle") {
                    setAgentPanelOpen(true);
                    return;
                  }
                  setSelectionOpen(true);
                  setAgentDetailsOpen(true);
                },
              }
            : null
        }
        onCheckAndSave={() => void checkAndSave()}
        publishGalleryOpen={publishGalleryOpen}
        onPublishGallery={() => setPublishGalleryOpen(true)}
        helpButtonRef={helpButtonRef}
        helpOpen={helpOpen}
        onOpenHelp={() => setHelpOpen(true)}
        drawingToolbar={{
          leftPanelMode,
          libraryPanelOpen: visibleLibraryPanelOpen,
          tool,
          documentSettingsOpen,
          onToggleExamples: toggleExamplesPanel,
          onToggleLibrary: toggleLibraryPanel,
          onInsert: () =>
            editorCommands.execute({
              id: "insert.start",
              launch: fullInsertLaunch(),
            }),
          onActivateTool: (nextTool) =>
            editorCommands.execute({
              id: "tool.activate",
              tool: nextTool,
            }),
          onAddText: () => editorCommands.execute({ id: "drafting.add-text" }),
          onOpenDocumentSettings: () => {
            setDocumentSettingsOpen((open) => !open);
            setSelectionOpen(true);
          },
        }}
        hierarchyToolbar={{
          documents: project.documents,
          activeDocumentId: document.id,
          topDocumentId: project.topDocumentId,
          navigationDepth: documentStack.length,
          canEnter: hasHierarchyEnterSelection,
          onUp: returnToParentDocument,
          onTop: returnToTopDocument,
          onSelectDocument: selectDocumentFromHierarchy,
          onEnter: enterSelectedHierarchy,
          onManageCells: () => setCellManagerOpen(true),
          onPlaceCell: placeCellInstance,
        }}
        telemetry={{
          snapshot: {
            selectedInternalRouteCount: internalSelection.internalRoutes.length,
            revision: document.revision,
            sourceStatus: document.sourceStatus,
            documentCount: project.documents.length,
            activeDocumentId: document.id,
            activeInstanceCount: document.instances.length,
            instanceCount: projectInstanceCount,
            netCount: document.nets.length,
            activeTool: tool,
            flightlineCount: flightlines.length,
            displayedFlightlineCount: displayedFlightlines.length,
            crossingCount: crossings.length,
            annotationCount: document.annotations.length,
            structuralDiagnosticCount:
              visualDiagnosticSummary.structural.length,
            visualDiagnosticCount: visualDiagnosticSummary.observations.length,
            blockingDiagnosticCount: visualDiagnosticSummary.blockingCount,
          },
        }}
      />
      <EditorDialogLayer
        help={
          helpOpen ? { closeButtonRef: helpCloseRef, onClose: closeHelp } : null
        }
        recoveryFailure={
          (recoveryState === "quota-exceeded" ||
            recoveryState === "unavailable" ||
            recoveryState === "failed") &&
          !recoveryFailureDismissed
            ? {
                state: recoveryState,
                onDownload: () => {
                  const outcome = requestProjectDownload(project);
                  setStatus(
                    outcome.status === "download-requested"
                      ? `Download requested: ${outcome.fileName}`
                      : `Download failed: ${outcome.message}`,
                  );
                },
                onDismiss: () => setRecoveryFailureDismissed(true),
              }
            : null
        }
        recentRecovery={
          recoveryDialogOpen && recoverySessions.length > 0
            ? {
                sessions: recoverySessions,
                onRestore: restoreRecoverySession,
                onDownloadBackup: downloadRecoveryBackup,
                onDeleteSession: deleteRecoverySessionFromDialog,
                onClose: () => setRecoveryDialogOpen(false),
              }
            : null
        }
        replaceGuard={
          replaceGuard !== null
            ? {
                intent: replaceGuard.intent,
                onCancel: cancelReplaceGuard,
                onConfirm: confirmReplaceGuard,
                onDownload: downloadCurrentProjectFromGuard,
              }
            : null
        }
        search={
          searchOpen
            ? {
                open: searchOpen,
                query: searchQuery,
                results: searchResults,
                onQueryChange: setSearchQuery,
                onSelect: selectSearchResult,
                onClose: closeSearch,
              }
            : null
        }
        instanceTable={
          instanceTableOpen
            ? {
                open: instanceTableOpen,
                project,
                connectivityIndex: projectConnectivityIndex,
                activeDocumentId: document.id,
                onClose: () => setInstanceTableOpen(false),
                onOpenInstance: openInstanceFromTable,
                onApply: (transactionId, edits) => {
                  const committed = commitStructure(transactionId, edits);
                  if (committed) {
                    setStatus(
                      `Updated ${edits.length} Cell${edits.length === 1 ? "" : "s"}`,
                    );
                  }
                  return committed;
                },
              }
            : null
        }
        insertComponent={
          insertDialogOpen
            ? {
                open: insertDialogOpen,
                styleProfileId: document.presentation.styleProfileId,
                recentSymbolIds,
                cells: cellInsertCandidates,
                externalDefinitions: externalSubcircuitInsertCandidates,
                scope: insertScope,
                initialSelectionId: insertInitialSelectionId,
                onApply: (request) =>
                  editorCommands.execute({
                    id: "insert.start",
                    launch: { kind: "quick", request },
                  }),
                onCancel: cancelComponentInsertFromHook,
              }
            : null
        }
        cellReset={
          pendingCellReset
            ? {
                documentName: document.name,
                pending: pendingCellReset,
                onCancel: cancelClearCanvas,
                onConfirm: confirmClearCanvas,
              }
            : null
        }
        cellManager={
          cellManagerOpen
            ? {
                open: cellManagerOpen,
                cells: cellManagerEntries,
                documents: project.documents,
                activeDocumentId: document.id,
                onClose: () => setCellManagerOpen(false),
                onCreate: (name) => {
                  createCell(name);
                  setCellManagerOpen(false);
                },
                onOpen: (documentId) => {
                  setCellManagerOpen(false);
                  switchDocument(documentId);
                },
                onRename: renameCell,
                onDelete: (documentId) => {
                  if (deleteCell(documentId)) {
                    setCellManagerOpen(false);
                  }
                },
                onJumpToCaller: jumpToCaller,
                onRenameTerminal: (documentId, terminalId, name) =>
                  renameCellTerminal(terminalId, name, documentId),
                onSetTerminalDirection: (documentId, terminalId, direction) =>
                  updateCellPinDirection(terminalId, direction, documentId),
                onMoveTerminal: (documentId, terminalId, delta) =>
                  moveCellTerminal(terminalId, delta, documentId),
                onSetFormalParameters: (documentId, formalParameters) =>
                  setCellFormalParameters(formalParameters, documentId),
                externalDefinitions: project.externalSubcircuitDefinitions,
                onSetExternalDefinition: setExternalSubcircuitDefinition,
              }
            : null
        }
        netlistPreflight={
          netlistPreflightOpen
            ? {
                open: netlistPreflightOpen,
                result: netlistAnalysis,
                electricalDiagnostics,
                onClose: () => setNetlistPreflightOpen(false),
                onNavigate: navigateToNetlistDiagnostic,
                onNavigateElectrical: jumpToProjectDiagnostic,
                onExport: (format) => exportDesignNetlist(format, true),
              }
            : null
        }
        publishGallery={
          publishGalleryOpen
            ? {
                draft: publishDraft,
                onDraftChange: setPublishDraft,
                defaultName: project.name,
                session: publishSession,
                gateReport: publishGates,
                updateTarget:
                  galleryEntryContext &&
                  publishSession &&
                  (publishSession.isAdmin ||
                    publishSession.role === "moderator" ||
                    (galleryEntryContext.ownerUserId !== null &&
                      publishSession.id === galleryEntryContext.ownerUserId))
                    ? {
                        id: galleryEntryContext.id,
                        name: galleryEntryContext.name,
                      }
                    : null,
                updateDefaults: galleryEntryContext
                  ? {
                      description: galleryEntryContext.description,
                      tags: galleryEntryContext.tags,
                    }
                  : null,
                publish: (fields) => publishProjectToGallery(project, fields),
                ...(galleryEntryContext
                  ? {
                      publishUpdate: (fields) =>
                        updateGalleryEntry(
                          galleryEntryContext.id,
                          project,
                          fields,
                        ),
                    }
                  : {}),
                onPublished: ({ id, name, updated, previewRevision }) => {
                  void primeGalleryPreview(id, previewRevision);
                  announceGalleryChange({
                    entryId: id,
                    ...(previewRevision === undefined
                      ? {}
                      : { previewRevision }),
                  });
                  galleryLoadGenerationRef.current += 1;
                  setGalleryRefreshSignal((previous) => previous + 1);
                  setPublishGalleryOpen(false);
                  setPublishDraft(null);
                  setStatus(
                    updated
                      ? `Updated "${name}" in the gallery`
                      : `Published "${name}" to the gallery`,
                  );
                },
                ...(galleryEntryContext
                  ? {
                      onShowHistory: () => {
                        setPublishGalleryOpen(false);
                        setVersionHistoryOpen(true);
                      },
                    }
                  : {}),
                onClose: () => setPublishGalleryOpen(false),
              }
            : null
        }
        versionHistory={
          versionHistoryOpen && galleryEntryContext
            ? {
                entryId: galleryEntryContext.id,
                entryName: galleryEntryContext.name,
                onRestored: ({ previewRevision }) => {
                  void primeGalleryPreview(
                    galleryEntryContext.id,
                    previewRevision,
                  );
                  galleryLoadGenerationRef.current += 1;
                  setGalleryRefreshSignal((previous) => previous + 1);
                  setVersionHistoryOpen(false);
                  setStatus("Version restored — reloading the entry");
                  void openGalleryEntryById(galleryEntryContext.id);
                },
                onClose: () => setVersionHistoryOpen(false),
              }
            : null
        }
        agentConnection={
          publicAgentUiEnabled && agentPanelOpen
            ? {
                open: agentPanelOpen,
                status: agentSession.status,
                claimCode: agentSession.claimCode,
                claimExpiresAt: agentSession.claimExpiresAt,
                scopes: agentSession.scopes,
                expiresAt: agentSession.expiresAt,
                error: agentSession.error,
                now: Date.now(),
                onGrant: agentSession.grant,
                onPause: agentSession.pause,
                onResume: agentSession.resume,
                onReconnect: agentSession.reconnect,
                onNewConnection: agentSession.newConnection,
                onRevoke: agentSession.revoke,
                onClose: () => setAgentPanelOpen(false),
              }
            : null
        }
        agentFileApproval={
          publicAgentUiEnabled && agentFileCandidate
            ? {
                candidate: agentFileCandidate,
                onReject: rejectAgentFileCandidate,
                onApprove: approveAgentFileCandidate,
              }
            : null
        }
      />
      <div
        className={
          visibleLibraryPanelOpen
            ? "app-workspace"
            : "app-workspace library-collapsed"
        }
        style={{ "--icm-shapes-width": `${libraryWidth}px` } as CSSProperties}
      >
        {leftPanelMode === "library" ? (
          <ShapesPanel
            styleProfileId={document.presentation.styleProfileId}
            open={visibleLibraryPanelOpen}
            onStartInsert={(launch) =>
              editorCommands.execute({ id: "insert.start", launch })
            }
          />
        ) : (
          <ExamplesPanel
            open={visibleLibraryPanelOpen}
            galleryExamples={galleryExamples}
            onOpenGalleryExample={(id) => void insertGalleryEntryById(id)}
            onOpenExample={openLibraryExample}
          />
        )}
        {visibleLibraryPanelOpen ? (
          <div
            className="library-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Library panel"
            aria-valuenow={libraryWidth}
            aria-valuemin={LIBRARY_WIDTH_MIN}
            aria-valuemax={LIBRARY_WIDTH_MAX}
            tabIndex={0}
            data-testid="library-resize-handle"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              libraryResizeOriginRef.current = {
                pointerX: event.clientX,
                width: libraryWidth,
              };
            }}
            onPointerMove={(event) => {
              const origin = libraryResizeOriginRef.current;
              if (!origin) return;
              setLibraryWidth(origin.width + (event.clientX - origin.pointerX));
            }}
            onPointerUp={(event) => {
              libraryResizeOriginRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 8;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setLibraryWidth(libraryWidth - step);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setLibraryWidth(libraryWidth + step);
              }
            }}
          />
        ) : null}
        <EditorPropertiesDock
          open={selectionOpen}
          shelfRef={selectionShelfRef}
          onToggle={() => {
            if (selectionOpen) exitCellSymbolLayout();
            // Narrow layouts have room for one side panel. Whichever the user
            // just asked for wins.
            else if (compactLayout) setCompactLibraryPanelOpen(false);
            setSelectionOpen((current) => !current);
            if (selectionOpen) setImportReviewOpen(false);
          }}
          summary={selectionShelfSummary}
          hasInspectableSelection={hasInspectableSelection}
          agentIndicator={
            publicAgentUiEnabled &&
            agentSession.status !== "idle" &&
            !agentStatusDismissed
              ? {
                  status: agentSession.status,
                  terminal:
                    agentSession.status === "revoked" ||
                    agentSession.status === "expired",
                }
              : null
          }
          documentSettings={
            documentSettingsOpen
              ? {
                  document,
                  onApplyStyle: (styleOverrides) => {
                    const result = transact([
                      {
                        kind: "set_presentation_style",
                        styleProfileId: document.presentation.styleProfileId,
                        styleOverrides,
                      },
                    ]);
                    if (result.ok) {
                      setStatus(
                        styleOverrides
                          ? "Updated document style"
                          : "Reset document style to profile defaults",
                      );
                    }
                  },
                  onChangeBulkDefault: updateMosBulkDefault,
                }
              : null
          }
          mosBulk={{
            connection:
              selectedInstance && selectedBulkResolution
                ? `${selectedInstance.id}.B → ${
                    selectedBulkResolution.net
                      ? (logicalNets.byBaseNetId.get(
                          selectedBulkResolution.net.id,
                        )?.name ?? selectedBulkResolution.net.id)
                      : "unresolved"
                  } · ${selectedBulkResolution.status}`
                : null,
            explicitRouteVisible: Boolean(selectedHiddenBulkNet),
            onDraw: drawSelectedMosBulk,
          }}
          routingGuidance={{
            total: flightlines.length,
            displayed: displayedFlightlines.length,
            view: routingGuidanceView,
            onViewChange: setRoutingGuidanceView,
          }}
          groupDisplay={{
            active: selectedIds.length > 1,
            referencesVisible: selectedGroupLabelsAllVisible,
            valuesVisible: selectedGroupValuesAllVisible,
            valuesAvailable: selectedGroupValueAvailable,
            onReferencesVisibleChange: (visible) =>
              setReferenceLabelsVisible(selectedIds, visible),
            onValuesVisibleChange: (visible) =>
              setValueLabelsVisible(selectedIds, visible),
          }}
          component={
            selectedInstance
              ? {
                  formalPort: selectedFormalTerminal
                    ? {
                        terminal: selectedFormalTerminal,
                        revision: document.revision,
                        onRename: renameSelectedFormalPort,
                        onDirectionChange: updateCellPinDirection,
                      }
                    : null,
                  cellSymbolLayout: selectedHierarchyCell
                    ? {
                        cell: selectedHierarchyCell,
                        enabled: cellSymbolLayoutEnabled,
                        onToggle: toggleCellSymbolLayout,
                        onBodySizeChange: (width, height) =>
                          setCellSymbolBodySize(
                            selectedHierarchyCell,
                            width,
                            height,
                          ),
                        onPortPlacementChange: (terminalId, side, offset) =>
                          setCellSymbolPortPlacement(
                            selectedHierarchyCell,
                            terminalId,
                            side,
                            offset,
                          ),
                      }
                    : null,
                  identity: {
                    instance: selectedInstance,
                    revision: document.revision,
                    cellName: document.netlist?.name ?? document.name,
                    formalTerminalSelected: Boolean(selectedFormalTerminal),
                    portNet: selectedPortNet
                      ? {
                          id: selectedPortNet.id,
                          logicalName: selectedPortLogicalName ?? "",
                          supply: Boolean(selectedSupplyMarker),
                        }
                      : null,
                    targetDescription:
                      selectedInstance.netlist &&
                      !(
                        selectedInstance.netlist.binding?.kind === "model" ||
                        selectedDevice?.targetPolicy === "required-model" ||
                        selectedExternalMosMapping
                      )
                        ? componentTargetDescription(
                            selectedInstance,
                            selectedHierarchyCell?.netlist?.name,
                            selectedExternalSubcircuit?.name,
                          )
                        : null,
                    capacitorPlateRows: selectedCapacitorPlateRows,
                    modelTarget:
                      selectedInstance.netlist &&
                      (selectedInstance.netlist.binding?.kind === "model" ||
                        selectedDevice?.targetPolicy === "required-model" ||
                        selectedExternalMosMapping)
                        ? {
                            defaultValue:
                              selectedInstance.netlist.binding?.kind === "model"
                                ? selectedInstance.netlist.binding.name
                                : selectedExternalMosMapping
                                  ? (selectedExternalSubcircuit?.name ?? "")
                                  : "",
                            suggestions:
                              selectedPropertyDevice?.symbolId === "nmos" ||
                              selectedPropertyDevice?.symbolId === "pmos"
                                ? reviewedSky130MosModelSuggestions(
                                    selectedPropertyDevice.symbolId,
                                  )
                                : [],
                            ...(selectedPropertyDevice?.symbolId === "nmos" ||
                            selectedPropertyDevice?.symbolId === "pmos"
                              ? {
                                  listId: `mos-model-options-${selectedPropertyDevice.symbolId}`,
                                }
                              : {}),
                            externalSubcircuit: Boolean(
                              selectedExternalMosMapping,
                            ),
                          }
                        : null,
                    onMarkerNameChange: (value) =>
                      commitElectricalMarkerName(selectedInstance.id, value),
                    onSchematicNameChange: updateSelectedSchematicName,
                    onReferenceChange: updateSelectedReference,
                    onModelTargetChange: updateSelectedModelTarget,
                  },
                  electrical: {
                    instance: selectedInstance,
                    parameters: propertyParametersForInstance(selectedInstance),
                    parameterValues: instancePropertyDraft.parameters,
                    firstInputRef: instanceValueInputRef,
                    referenceVisible:
                      selectedInstanceLabel !== undefined &&
                      selectedInstanceLabel.visible !== false,
                    valueVisible:
                      selectedInstanceValue !== null &&
                      selectedInstanceValue.visible !== false,
                    valueAvailable: selectedInstanceValueAvailable,
                    additionalParameters: additionalParameterDraft,
                    additionalParametersChanged:
                      additionalParameterDraftChanges,
                    onParameterChange: (key, value) =>
                      updateInstancePropertyDraft((current) => ({
                        ...current,
                        parameters: {
                          ...current.parameters,
                          [key]: value,
                        },
                      })),
                    onReferenceVisibilityChange: (checked) =>
                      setReferenceLabelsVisible([selectedInstance.id], checked),
                    onValueVisibilityChange: (checked) => {
                      if (checked) showSelectedInstanceValue();
                      else setValueLabelsVisible([selectedInstance.id], false);
                    },
                    onAdditionalParameterChange: updateAdditionalParameter,
                    onAdditionalParameterRemove: removeAdditionalParameter,
                    onAdditionalParameterAdd: addAdditionalParameter,
                    onAdditionalParametersApply: applyAdditionalParameters,
                    onAdditionalParametersCancel: cancelAdditionalParameters,
                  },
                  placement: {
                    instance: selectedInstance,
                    x: instancePropertyDraft.x,
                    y: instancePropertyDraft.y,
                    rotation: instancePropertyDraft.rotation,
                    draftChanged: hasInstancePropertyDraftChanges,
                    onXChange: (x) =>
                      updateInstancePropertyDraft((current) => ({
                        ...current,
                        x,
                      })),
                    onYChange: (y) =>
                      updateInstancePropertyDraft((current) => ({
                        ...current,
                        y,
                      })),
                    onRotate: () =>
                      editorCommands.execute({ id: "transform.rotate" }),
                    onMirror: (direction) =>
                      editorCommands.execute({
                        id: "transform.mirror",
                        direction,
                      }),
                    onReturnToTray: () =>
                      returnInstancesToTray([selectedInstance.id]),
                    ...(differentialOutputSibling(selectedInstance.symbolId)
                      ? {
                          onSwapOutputs: () =>
                            transact(
                              planDifferentialOutputSwap(
                                selectedInstance.id,
                                selectedInstance.symbolId,
                              ),
                            ),
                        }
                      : {}),
                    ...(selectedInstanceHasDifferentialInputs &&
                    differentialInputSibling(selectedInstance.symbolId)
                      ? {
                          onSwapInputs: () =>
                            transact(
                              planDifferentialInputSwap(
                                selectedInstance.id,
                                selectedInstance.symbolId,
                              ),
                            ),
                        }
                      : {}),
                    onDiscard: discardInstancePropertyDraft,
                  },
                }
              : null
          }
          drafting={
            selectedDrafting
              ? {
                  document,
                  resolver,
                  object: selectedDrafting,
                  inspectorSegment: draftingInspectorSegment,
                  tangentInput: draftingTangentInput,
                  bearingInput: draftingBearingInput,
                  onInspectorSegmentChange: setDraftingInspectorSegment,
                  onTangentInputChange: setDraftingTangentInput,
                  onBearingInputChange: setDraftingBearingInput,
                  onStyleChange: setDraftingStyle,
                  onGeometryChange: setDraftingGeometry,
                  onTangentAngleChange: setDraftingTangentAngle,
                  onBearingChange: setDraftingBearing,
                  onReverse: reverseSelectedDrafting,
                  onRotate: () =>
                    editorCommands.execute({ id: "transform.rotate" }),
                  onToggleLock: () => toggleDraftingLock(selectedDrafting),
                }
              : null
          }
          placementTray={{
            document,
            unplaced,
            returnablePlaced: returnablePlacedInstances,
            onPlaceAll: placeAllFromTray,
            onReturnAll: returnInstancesToTray,
            onSelect: (instance, label) => {
              selectOnly("instance", [instance.id]);
              setStatus(`Selected ${label}`);
            },
            onPlace: beginRetainedInstancePlacementFromHook,
          }}
          routeActions={{
            active: selectedRouteId !== null,
            netLabelInputRef: netLabelPropertyInputRef,
            netLabel: netLabelDraft,
            highlightActive: selectedHighlightIsActive,
            onNetLabelChange: updateNetLabelDraft,
            onDeleteNetLabel: deleteSelectedRouteNetLabel,
            onAddCurrentArrow: addCurrentArrow,
            onToggleHighlight: toggleHighlightedNet,
            onDeleteWire: deleteSelectedRouteConnection,
          }}
          endpointActions={{
            kind: selectedEndpoint
              ? selectedEndpoint.endpoint.kind === "junction"
                ? "junction"
                : "terminal"
              : null,
            noConnect: Boolean(selectedNoConnect),
            endpointNetId: selectedEndpointNetId,
            onDisconnect: () => disconnectSelectedEndpoint(false),
            onDeleteConnection: () => disconnectSelectedEndpoint(true),
            onToggleNoConnect: toggleSelectedNoConnectFromSelection,
            onDeleteJunction: deleteSelectedJunctionFromSelection,
          }}
          annotationActions={{
            kind:
              selectedAnnotation && isRoutedMarker(selectedAnnotation)
                ? "current-arrow"
                : selectedAnnotation && selectedNetLabelBinding
                  ? "net-label"
                  : null,
            highlightActive: selectedHighlightIsActive,
            onReverseCurrentArrow: reverseSelectedCurrentArrow,
            onDeleteCurrentArrow: deleteSelectedAnnotation,
            onToggleHighlight: toggleHighlightedNet,
          }}
          diagnostics={{
            snapshot: liveDiagnosticSnapshot,
            documentLabel: (documentId) =>
              project.documents.find((candidate) => candidate.id === documentId)
                ?.name ?? documentId,
            onSelectDiagnostic: jumpToProjectDiagnostic,
          }}
          netTrace={
            highlightedTrace && highlightedTrace.hops.length > 0
              ? {
                  trace: highlightedTrace,
                  documentLabel: (documentId) =>
                    project.documents.find(
                      (candidate) => candidate.id === documentId,
                    )?.name ?? documentId,
                  onNavigateHop: navigateTraceHop,
                }
              : null
          }
          importReview={
            importReviewOpen
              ? {
                  snapshot: {
                    selected:
                      selectedIds.length > 0
                        ? selectedIds.join(", ")
                        : (selectedRouteId ?? selectedAnnotationId ?? "None"),
                    internalRouteCount: internalSelection.internalRoutes.length,
                    revision: document.revision,
                    sourceStatus: document.sourceStatus,
                    documentCount: project.documents.length,
                    activeDocumentId: document.id,
                    activeInstanceCount: document.instances.length,
                    projectInstanceCount,
                    netCount: document.nets.length,
                    tool,
                    flightlineCount: flightlines.length,
                    crossingCount: crossings.length,
                    annotationCount: document.annotations.length,
                    status,
                  },
                  importReport,
                }
              : null
          }
          agent={
            publicAgentUiEnabled &&
            agentSession.status !== "idle" &&
            !agentStatusDismissed
              ? {
                  status: agentSession.status,
                  claimCode: agentSession.claimCode,
                  claimExpiresAt: agentSession.claimExpiresAt,
                  scopes: agentSession.scopes,
                  expiresAt: agentSession.expiresAt,
                  error: agentSession.error,
                  onPause: agentSession.pause,
                  onResume: agentSession.resume,
                  onReconnect: agentSession.reconnect,
                  onNewConnection: agentSession.newConnection,
                  onRevoke: agentSession.revoke,
                  expanded: agentDetailsOpen,
                  onToggleDetails: () => setAgentDetailsOpen((open) => !open),
                  onDismiss: () => {
                    setAgentDetailsOpen(false);
                    setAgentStatusDismissed(true);
                  },
                }
              : null
          }
        />
        <EditorCanvasSurface
          empty={canvasIsEmpty}
          className={[
            "schematic-canvas",
            tool === "wire" ? "wire-mode" : "",
            pendingSymbolId || vddRailMode || copyPlacement
              ? "component-mode"
              : "",
            tool === "arrow" ||
            tool === "construction-line" ||
            tool === "rectangle" ||
            tool === "circle"
              ? "drawing-mode"
              : "",
            projectedMovePreviewDocument ? "semantic-move-preview" : "",
            panPreview ? "pan-mode" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          eventHandlers={canvasEventHandlers}
          grid={{ visible: gridDotsVisible, viewBox }}
          sceneInnerHtml={sceneInnerHtml}
          cellSymbolLayout={
            selectedCellSymbolLayout
              ? {
                  placement: selectedCellSymbolLayout.instance.placement!,
                  body: selectedCellSymbolLayout.body,
                  pins: selectedCellSymbolLayout.pins.map(
                    ({ terminal, pin }) => ({
                      terminalId: terminal.id,
                      pin,
                    }),
                  ),
                  onDragStart: beginCellSymbolLayoutDrag,
                }
              : null
          }
          netHighlight={{
            highlight: highlightedNet,
            document,
            resolver,
            routeGeometryRecords,
          }}
          copyPreviewInnerHtml={copyPreviewInnerHtml}
          inputPlanes={{
            tool,
            viewBox,
            componentPlacementActive: Boolean(
              pendingSymbolId || vddRailMode || copyPlacement,
            ),
            copyPlacementActive: copyPlacement !== null,
          }}
          placementPreview={{
            vddRailMode,
            vddRailStart,
            previewPoint: componentPreviewPoint,
            powerRailStrokeWidth: styleProfile.strokes.powerRail,
            styleProfileId: document.presentation.styleProfileId,
            pendingSymbolId,
            ...(pendingPlacementSymbol
              ? { pendingSymbol: pendingPlacementSymbol }
              : {}),
            rotation: componentPlacementRotation,
            mirror: componentPlacementMirror,
          }}
          wiring={{
            netLabelEditorOpen,
            selectedRouteId,
            selectedRouteSegmentIndex,
            routeGeometryRecords,
            netLabelDraft,
            netLabelEditorInputRef,
            onNetLabelDraftChange: updateNetLabelDraft,
            onNetLabelSubmit: commitNetLabelEditing,
            onNetLabelEscape: () => {
              applyNetLabel();
              setNetLabelEditorOpen(false);
            },
            flightlines: displayedFlightlines,
            onFlightlineClick: handleFlightline,
            wireDraftPoints,
            bulkRoutePreview: wireSource?.routePresentation === "bulk-dashed",
            snapGuideLayerRef,
          }}
          routeHandles={{
            document,
            routeGeometryRecords,
            selectedRouteId,
            selectedRouteSegmentIndex,
            routeStretchPreview,
            tool,
            onHandlePointerDown: (event, routeId, segmentIndex, intent) => {
              const primaryInstanceId = selectedIds.at(-1);
              if (
                primaryInstanceId &&
                compositeSelectionOwnsHit("route", routeId)
              ) {
                beginMoveFromSelection(event, primaryInstanceId);
                return;
              }
              beginRouteStretch(event, routeId, segmentIndex, intent);
            },
          }}
          selectionHitLayer={{
            selection: {
              document,
              resolver,
              routeGeometryRecords,
              styleProfile,
              tool,
              selectedInstanceIds: selectedIds,
              selectedRouteId,
              supplementalRouteIds: supplementalSelection.routeIds,
              selectedInternalRouteIds,
              selectedAnnotationId,
              supplementalAnnotationIds: supplementalSelection.annotationIds,
              cellSymbolLayoutInstanceId: cellSymbolLayoutEnabled
                ? (selectedInstance?.id ?? null)
                : null,
              onInstanceClick: (instance, additive) => {
                if (suppressInstanceClick.current) {
                  suppressInstanceClick.current = false;
                  return;
                }
                selectInstanceFromSelection(instance.id, additive);
              },
              onInstanceOpen: (instance) => {
                if (referencedDocumentId(project, instance))
                  enterHierarchy(instance.id);
                else inspectInstance(instance.id);
              },
              onInstancePointerDown: (event, instance) => {
                // While R is armed the click turns the part rather than
                // picking it up, so the gesture reads as "rotate that one".
                if (rotateArmedInstance(instance.id)) {
                  event.stopPropagation();
                  event.preventDefault();
                  return;
                }
                beginMoveFromSelection(event, instance.id);
              },
              onRoutePointerDown: handleRoutePointerDown,
              onAnnotationPointerDown: beginAnnotationDrag,
              onAnnotationEdit: beginAnnotationTextEditing,
            },
            endpoints: {
              document,
              endpoints: wiringEndpoints,
              tool,
              selectedRoute,
              selectedRouteSegmentIndex,
              selectedEndpoint,
              supplementalJunctionIds: supplementalSelection.junctionIds,
              endpointLabel: endpointTestId,
              onEndpointActions: (candidate) => {
                selectEndpoint(candidate);
                setStatus(
                  `Endpoint actions: ${endpointTestId(candidate.endpoint)}`,
                );
              },
              onPowerRailStretch: beginRouteStretch,
              onJunctionSelect: (candidate) => {
                selectEndpoint(candidate);
                setStatus(`Selected ${endpointTestId(candidate.endpoint)}`);
              },
              onWireEndpoint: handleWireEndpoint,
            },
          }}
          draftingHitTargets={{
            document,
            resolver,
            tool,
            selectedDraftingId,
            supplementalDraftingIds: supplementalSelection.draftingIds,
            onPointerDown: (event, object, draggable) => {
              if (draggable) beginDraftingDrag(event, object);
              else {
                event.stopPropagation();
                selectDraftingObject(object.id);
              }
            },
            onConstructionLineEdit: (event, object) => {
              event.stopPropagation();
              insertConstructionVertex(
                object,
                pointFromClient(
                  event.clientX,
                  event.clientY,
                  event.currentTarget.ownerSVGElement!,
                ),
              );
            },
            onArrowEdit: (event, object) => {
              event.stopPropagation();
              insertArrowWaypoint(
                object,
                pointFromClient(
                  event.clientX,
                  event.clientY,
                  event.currentTarget.ownerSVGElement!,
                ),
              );
            },
            onTextEdit: beginDraftingTextEditing,
          }}
          draftingHandles={{
            document,
            resolver,
            selectedDraftingId,
            onHandlePointerDown: beginDraftingHandleDrag,
            onDeleteVertex: deleteConstructionVertex,
          }}
          interactionPreviews={{
            boxPreview,
            draftingSource,
            draftingWaypoints,
            draftingHover,
            draftingSnapPoint,
            tool,
            styleProfile,
            wirePreviewPoint,
            textEditing,
            textEditingBounds,
            viewBox,
            textEditingLocked,
            onTextUpdate: updateTextEditing,
            onTextCommit: commitTextEditing,
            onTextDelete: deleteTextEditing,
            ...(editingAnnotation &&
            isRoutedMarker(editingAnnotation) &&
            effectiveRouteAttachment(editingAnnotation)
              ? { onReverseCurrentArrow: reverseSelectedCurrentArrow }
              : {}),
          }}
        />
      </div>
      <EditorStatusbar
        visitStats={visitStats}
        status={status}
        tool={tool}
        vddRailMode={vddRailMode}
        pendingSymbolId={pendingSymbolId}
        wireOptionsOpen={wireOptionsOpen}
        wireRoutingMode={wireRoutingMode}
        wireCornerOrder={wireCornerOrder}
        recoveryLabel={recoveryStateLabel(recoveryState)}
        gridDotsVisible={gridDotsVisible}
        zoomPercent={zoomPercent}
        onToggleWireOptions={() => setWireOptionsOpen((open) => !open)}
        onWireRoutingModeChange={setWireRoutingMode}
        onWireCornerOrderChange={setWireCornerOrder}
        onToggleGridDots={() =>
          setGridDotsVisible((visible) => {
            setStatus(
              visible ? "Background dots hidden" : "Background dots shown",
            );
            return !visible;
          })
        }
        onZoomOut={() => zoomViewAtCenter(1.2)}
        onZoomIn={() => zoomViewAtCenter(0.84)}
        onFitView={() => editorCommands.execute({ id: "view.fit" })}
      />
    </main>
  );
}
