import { InstanceCodePanel } from "../features/properties/instance-code-panel";
import { NetlistCodePanel } from "../features/netlist-export/netlist-code-panel";
import { NetlistProfileCode } from "../features/netlist-export/netlist-profile-code";
import { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  planNetlistProcess,
  prepareNetlistExample,
} from "../features/netlist-export/netlist-process";
import { netlistDeviceFamily } from "../features/netlist-export/netlist-process-presets";
import {
  DEFAULT_ARROW_PRESET,
  type ArrowPreset,
} from "../features/drafting/arrow-presets";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentDefinition, Instance } from "@icm/model";
import type { SharedComponent } from "../features/user-components/component-library-contract";
import { publishedDefinition } from "../features/user-components/component-library-contract";
import {
  newComponentDefinition,
  planComponentDefinitionEdit,
  sharedComponentInsertRequest,
} from "../features/user-components/component-definition-edit";

const UserComponentsLibrary = lazy(
  () => import("../features/user-components/user-components-library"),
);
const ComponentDefinitionEditor = lazy(
  () => import("../features/user-components/component-definition-editor"),
);

interface ComponentEditorSession {
  key: string;
  definition: ComponentDefinition;
  mode: "new" | "instance" | "library";
  entry?: SharedComponent;
  target?: { projectSessionId: string; documentId: string; instance: Instance };
}
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import "../styles/editor-entry.css";
import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";
import {
  planProjectCellImport,
  planBindCellParameter,
  planSetDeviceModelTarget,
  planSetVddConnectionMode,
  planAngledWireRepairs,
  gateRoutingOperationPlan,
  type ProjectStructureEdit,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  buildProjectConnectivityIndex,
  computeNetHighlight,
  annotationOwningInstanceId,
  deriveProjectNetNameProjection,
  deriveRoutingAffectedClosure,
  diagnosticPresentationGroup,
  runErcChecks,
  resolveDraftingObjectGeometry,
  displayableInstanceValue,
  symbolCarriesReference,
  symbolSupportsValueAnnotation,
  resolveMosBulkConnection,
  resolveDocumentStyleProfile,
  summarizeProjectCells,
  resolveRouteAttachment,
  resolveAnnotationText,
} from "@icm/derived";
import type { HierarchyFrame } from "@icm/derived";
import {
  createEmptyProject,
  DEFAULT_PORT_LABEL_FORMAT,
  flattenRichText,
} from "@icm/model";
import {
  resolveReviewedExternalBinding,
  reviewedExternalModelSuggestions,
} from "@icm/devices";
import type {
  CircuitProject,
  DerivedPoint,
  DraftingObject,
  GridRect,
  LayoutGroup,
  Point,
  PortLabelFormatOptions,
  Rect,
  Rotation,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { renderCrashRequested, sceneCrashRequested } from "./crash-test-hooks";
import { buildSceneSafely } from "./scene-safety";
import { externalSubcircuitSymbolId, hierarchicalSymbolId } from "@icm/symbols";
import { clipboardPreviewDocument } from "../features/clipboard/clipboard";
import { prepareProjectCopy } from "../features/clipboard/project-copy";
import {
  copyPlacementAnchors,
  snapPendingCopyPlacement,
} from "../features/clipboard/copy-placement-snap";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import {
  canvasInsetsFromOverlays,
  type CameraRectInput,
  type CanvasInsets,
} from "../canvas/fit-view";
import {
  createCameraRuntime,
  type CameraRuntime,
} from "../canvas/camera-runtime";
import {
  startCanvasDragSession,
  type CanvasDragSession,
} from "../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../canvas/canvas-drag-visual";
import { instanceVisibleHitBox } from "../canvas/instance-geometry";
import {
  loadReleaseChannel,
  projectStoreCopy,
  type ReleaseChannel,
} from "../document/release-channel";
import { resolveSimulationTransport } from "../features/simulation/deployment-transport";
import { createCanvasHitController } from "../canvas/canvas-hit-controller";
import { CellInterfaceConfirmationDialog } from "../features/hierarchy/cell-interface-confirmation";
import { CellParameterDialog } from "../features/hierarchy/cell-parameter-dialog";
import type { CellInterfaceConfirmation } from "../features/hierarchy/project-structure-commands";
import { applyConfirmedCellInterfaceEdit } from "../features/hierarchy/project-structure-commands";
import { screenScaleHitRadius } from "../canvas/canvas-hit-resolver";
import { buildDiagnosticMarkers } from "../canvas/diagnostic-markers";
import {
  type RouteStretchPreview,
  useWireInteraction,
} from "../features/wiring/use-wire-interaction";
import type { BoxPreview, PanPreview } from "../canvas/canvas-gesture-model";
import {
  createCanvasGestureController,
  type WheelBehavior,
} from "../canvas/canvas-gesture-controller";
import { createEditorCanvasEventHandlers } from "../canvas/editor-canvas-event-handlers";
import {
  canvasPointFromClient,
  logicalRadiusForCanvasPixels,
  replaceCanvasSnapGuides,
} from "../canvas/canvas-viewport";
import { EditorCanvasSurface } from "../canvas/editor-canvas-surface";
import { createAnnotationDragController } from "../features/text-editing/annotation-drag-controller";
import { prepareDocumentFormulaArtifacts } from "../features/text-editing/formula-artifacts";
import {
  createEditorFileCommands,
  type SpiceImportReport,
} from "../features/editor-shell/editor-file-commands";
import { EditorStatusbar } from "../features/editor-shell/editor-statusbar";
import { documentSettingsCodeValue } from "../features/editor-shell/document-settings-code";
import { normalizedStyleOverrides } from "../features/editor-shell/style-knobs";
import {
  deriveSimulationProbeOptions,
  simulationProbeHierarchyPath,
} from "../features/simulation/simulation-probe-options";
import {
  sameSimulationOccurrence,
  terminalCurrentDirectionPartners,
} from "../features/simulation/terminal-current-pick";
import { TimingSimulationPanel } from "../features/simulation/timing-simulation-panel";
import { TIMING_UI_ENABLED } from "../features/simulation/timing-ui";
import { PUBLIC_SIMULATION_UI_ENABLED } from "../features/simulation/public-simulation-ui";
import {
  waveformDraftingObjects,
  type TimingWaveformLayout,
} from "../features/simulation/timing-waveform";
import { useCellSymbolLayout } from "../features/hierarchy/use-cell-symbol-layout";
import { selectedBlockSymbolTarget } from "../features/hierarchy/block-symbol-layout-target";
import {
  cellInsertLaunch,
  fullInsertLaunch,
} from "../features/component-insert/insert-launch";
import { useComponentPlacement } from "../features/component-insert/use-component-placement";
import { snapPendingComponentPlacement } from "../features/component-insert/placement-snap";
import { findPaletteSymbol } from "../features/component-insert/symbol-catalog";
import { CanvasContextMenu } from "../features/selection/canvas-context-menu";
import { useVisualClipboard } from "../features/clipboard/visual-clipboard";
import { deriveWireUnderSymbolWarnings } from "../canvas/wire-under-symbol";
import { createPlacementTrayCommands } from "../features/component-insert/placement-tray-commands";
import { componentTargetDescription } from "../features/properties/component-identity-properties";
import { componentSourceCode } from "../features/properties/component-source-code";
import { planElectricalMarkerName } from "../features/properties/electrical-marker-name";
import {
  endpointTestId,
  instanceLabelAnnotationFor,
  maxRoutingCounter,
} from "./editor-document-helpers";
import {
  compactLayoutMatches,
  dismissOpenCommandMenus,
  isTypingTarget,
  RenderCrashProbe,
} from "./editor-runtime-helpers";
import { EditorDialogLayer } from "./editor-dialog-layer";
import { EditorAppChrome } from "./editor-app-chrome";
import { EditorRightDock } from "./editor-right-dock";
import {
  EditorProjectDock,
  type EditorProjectPanelMode,
} from "./editor-project-dock";
import { EditorPropertiesDock } from "./editor-properties-dock";
import { ProjectCodePanel } from "../features/project-code/project-code-panel";
import {
  formatProjectCode,
  planProjectCodeCommit,
} from "../features/project-code/project-code";
import { LazySpiceSimulationSurface } from "./lazy-editor-dialogs";
import { recoverSourceDrafts } from "../features/simulation/source-draft-cache";
import { useProjectCheck } from "./use-project-check";
import { summarizeVisualDiagnostics } from "../features/selection/selection-inspector-details";
import {
  type HighlightedNetOrigin,
  useEditorDerivedModel,
} from "./use-editor-derived-model";
import type { RoutingGuidanceView } from "../interaction/interaction-state";
import {
  quickPlaceRequest,
  ShapesPanel,
} from "../features/editor-shell/shapes-panel";
import { ExamplesPanel } from "../features/editor-shell/examples-panel";
import { createGalleryExampleCommands } from "../features/editor-shell/gallery-example-commands";
import { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import { loadCloudProjectForCellImport } from "../features/hierarchy/cloud-cell-import";
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
import { projectWithTopologyRoot } from "../features/editor-shell/gallery-topology-project";
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
import { useUnsavedWorkGuard } from "../document/use-unsaved-work-guard";
import { authoredObjectCount } from "../document/project-content";
import { translateDraftingObject } from "../features/drafting/drafting-manipulation";
import {
  draftingGroupScaleRange,
  scaleDraftingGroup,
} from "../features/drafting/drafting-group-scale";
import { createDraftingCommands } from "../features/drafting/drafting-commands";
import {
  createDraftingCreateController,
  type DrawAngleMode,
} from "../features/drafting/drafting-create-controller";
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
import { BrowserAgentSimulationHost } from "../agent/browser-agent-simulation-host";
import { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import { ProjectRunHistory } from "../features/simulation/project-run-history";
import { createAgentSemanticIntentHandler } from "../agent/agent-semantic-intent-handler";
import { PUBLIC_AGENT_UI_ENABLED } from "../agent/public-agent-ui";
import { useAgentSession } from "../agent/use-agent-session";
import { peekAgentSessionRecovery } from "../agent/session-recovery";
import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
import { referencedDocumentId } from "../document/editor-session";
import { useInteractionState } from "../interaction/interaction-state";
import type {
  EditorTool,
  PendingComponentPlacement,
} from "../interaction/interaction-state";
import { resolveTextEditingTarget } from "../features/text-editing/text-editing";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import { logicalNetChoices } from "../features/logical-net-choices";
import {
  CLOUD_PROJECT_LIMIT,
  deleteCloudProject,
  listCloudProjects,
  type CloudProjectSummary,
} from "../features/editor-shell/cloud-projects";
import {
  defaultRazaviSymbolVariantId,
  materializeRazaviProjectBulkConnections,
  razaviHiddenBulkRisk,
} from "../presentation/razavi-presentation";
import { useRecoveryCoordinator } from "../document/recovery-coordinator";
import { useSelectionController } from "../features/selection/selection-controller";
import { SelectionFilterPopover } from "../features/selection/selection-filter-popover";
import {
  createSelectionPolicy,
  DEFAULT_SELECTION_FILTER,
  selectionFilterSummary,
  type SelectionFilter,
} from "../features/selection/selection-filter";
import { deriveSelectionInspectionModel } from "../features/selection/selection-inspection-model";
import { usePropertiesEditor } from "../features/properties/use-properties-editor";
import { deferFocus } from "../interaction/deferred-focus";
import { createPropertyEditPlanner } from "../features/properties/property-edit-planner";
import {
  instanceParameterVisibility,
  instanceParameterVisibilityEdits,
} from "../features/instance-display/instance-parameter-display";
import { createSelectionPropertyCommands } from "../features/properties/selection-property-commands";
import { planComponentPropertyCodeEdits } from "../features/properties/component-property-code-edits";
import { planGroupPropertyCodeEdits } from "../features/properties/group-property-code-edits";
import type { ComponentPropertyCodeValue } from "../features/properties/component-property-code";
import {
  commonGroupValue,
  groupForeground,
  groupParameterContext,
  type GroupPropertyCodeValue,
} from "../features/properties/group-property-code";
import {
  LIBRARY_WIDTH_MAX,
  LIBRARY_WIDTH_MIN,
  useEditorPanels,
} from "../features/editor-shell/use-editor-panels";
import { useSelectionInteraction } from "../features/selection/use-selection-interaction";
import {
  EMPTY_VISUAL_SELECTION,
  hasVisualSelection,
  pruneVisualSelection,
} from "../features/selection/visual-selection";
import { createSelectionMoveController } from "../features/selection/selection-move-controller";
import { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import { EDGE_ALIGNMENT_MODES } from "../features/selection/align-selection";
import type { VisualSelectionKind } from "../features/selection/visual-selection";
import { planSelectionMove } from "../features/selection/selection-move-plan";
import {
  annotationAnchor,
  annotationHitBox,
  closestNetConductorPoint,
  instanceValueAnnotation,
  isRoutedMarker,
  netLabelPlacementTargetAtPoint,
} from "../features/wiring/route-interaction-geometry";
import type { NetLabelPlacementTarget } from "../features/wiring/route-interaction-geometry";
import { useWireCanvasController } from "../features/wiring/use-wire-canvas-controller";
import {
  EMPTY_WIRE_DRAFT_PREVIEW,
  resolveWireDraftPreview,
} from "../features/wiring/wire-draft-preview";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import { buildSceneSnapTargetIndex } from "../snap/candidates";
import { snapCoordinate } from "../snap/engine";
import type { SnapGuideLine } from "../snap/engine";

interface PendingWaveformPlacement {
  groupId: string;
  objects: DraftingObject[];
  traceCount: number;
}

const DEFAULT_VIEWBOX: GridRect = { x: 0, y: 0, width: 960, height: 640 };
const RECENT_COMPONENTS_STORAGE_KEY = "icm.recent-components.v1";
const LIBRARY_PANEL_STORAGE_KEY = "icm.library-panel-open.v1";
const LIBRARY_WIDTH_STORAGE_KEY = "icm.library-panel-width.v1";
const PROPERTIES_WIDTH_STORAGE_KEY = "icm.properties-panel-width.v1";
const SIMULATION_WIDTH_STORAGE_KEY = "icm.simulation-panel-width.v2";
// The drag floor only keeps the panel from disappearing behind its own
// collapsed rail; how narrow the inspector is useful is the reader's call.
const PROPERTIES_WIDTH_MIN = 160;
const PROPERTIES_WIDTH_MAX = 760;
/** Only the untouched default opens this wide; a drag may go narrower. */
const PROPERTIES_WIDTH_DEFAULT_MIN = 280;
const PROPERTIES_WIDTH_RATIO = 0.24;
const SIMULATION_WIDTH_MIN = 320;
const SIMULATION_WIDTH_MAX = 1200;
const SIMULATION_WIDTH_RATIO = 0.4;

function defaultSimulationWidth(viewportWidth: number): number {
  return Math.round(
    Math.min(
      SIMULATION_WIDTH_MAX,
      Math.max(SIMULATION_WIDTH_MIN, viewportWidth * SIMULATION_WIDTH_RATIO),
    ),
  );
}

function defaultPropertiesWidth(viewportWidth: number): number {
  return Math.round(
    Math.min(
      PROPERTIES_WIDTH_MAX,
      Math.max(
        PROPERTIES_WIDTH_DEFAULT_MIN,
        viewportWidth * PROPERTIES_WIDTH_RATIO,
      ),
    ),
  );
}
const COMPACT_LAYOUT_MEDIA_QUERY = "(max-width: 860px)";
const PORT_LABEL_FORMAT_STORAGE_KEY = "icm.port-label-format.v1";
const DRAG_START_DISTANCE_PX = 4;
const SNAP_CAPTURE_RADIUS_PX = 4;
const NET_LABEL_SNAP_CAPTURE_RADIUS_PX = 12;

/** Persisted Junctions are grid points, including on ±45° Route segments. */

// Handle drags are geometry edits rather than translations.  Keep a complete
// transient object so the formal SVG renderer can redraw both a curved shaft
// and its arrow head from the same latest control point before pointer-up.
export interface AppProps {
  project?: CircuitProject;
  visitStats?: { pv: number; uv: number } | null;
  /** Override the deployment's Agent UI capability in tests. */
  publicAgentUiEnabled?: boolean;
  /** Override the deployment's analog Simulation UI capability in tests. */
  publicSimulationUiEnabled?: boolean;
  /** Test/staging seam; production Cloudflare builds keep timing tools hidden. */
  timingUiEnabled?: boolean;
  /** `/g/<id>` deep link: load this gallery entry after boot. */
  initialGalleryEntryId?: string | null;
}

export function App({
  project: initialProject,
  visitStats,
  publicAgentUiEnabled = PUBLIC_AGENT_UI_ENABLED,
  publicSimulationUiEnabled = PUBLIC_SIMULATION_UI_ENABLED,
  timingUiEnabled = TIMING_UI_ENABLED,
  initialGalleryEntryId = null,
}: AppProps) {
  const [preparedInitialProject] = useState(
    () =>
      materializeRazaviProjectBulkConnections(
        initialProject ?? createEmptyProject("project-main", "New Circuit"),
      ).project,
  );
  const [status, setStatus] = useState("Ready");
  const [componentEditor, setComponentEditor] =
    useState<ComponentEditorSession | null>(null);
  const [componentLibraryRefresh, setComponentLibraryRefresh] = useState(0);
  const [userComponentsOpen, setUserComponentsOpen] = useState(false);
  const libraryResizeOriginRef = useRef<{
    pointerX: number;
    width: number;
  } | null>(null);
  const simulationResizeOriginRef = useRef<{
    pointerX: number;
    width: number;
  } | null>(null);
  const propertiesResizeOriginRef = useRef<{
    pointerX: number;
    width: number;
  } | null>(null);
  const [propertiesWidth, setPropertiesWidthState] = useState(() => {
    if (typeof window === "undefined") return defaultPropertiesWidth(1100);
    try {
      const stored = Number(
        window.localStorage.getItem(PROPERTIES_WIDTH_STORAGE_KEY),
      );
      return Number.isFinite(stored) && stored > 0
        ? Math.min(PROPERTIES_WIDTH_MAX, Math.max(PROPERTIES_WIDTH_MIN, stored))
        : defaultPropertiesWidth(window.innerWidth);
    } catch {
      return defaultPropertiesWidth(window.innerWidth);
    }
  });
  const setPropertiesWidth = (width: number): void => {
    const next = Math.round(
      Math.min(PROPERTIES_WIDTH_MAX, Math.max(PROPERTIES_WIDTH_MIN, width)),
    );
    setPropertiesWidthState(next);
    try {
      window.localStorage.setItem(PROPERTIES_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // Resizing remains available when browser storage is unavailable.
    }
  };
  const [simulationWidth, setSimulationWidthState] = useState(() => {
    if (typeof window === "undefined") return defaultSimulationWidth(1100);
    try {
      const stored = Number(
        window.localStorage.getItem(SIMULATION_WIDTH_STORAGE_KEY),
      );
      return Number.isFinite(stored) && stored > 0
        ? Math.min(SIMULATION_WIDTH_MAX, Math.max(SIMULATION_WIDTH_MIN, stored))
        : defaultSimulationWidth(window.innerWidth);
    } catch {
      return defaultSimulationWidth(window.innerWidth);
    }
  });
  const setSimulationWidth = (width: number): void => {
    const next = Math.round(
      Math.min(SIMULATION_WIDTH_MAX, Math.max(SIMULATION_WIDTH_MIN, width)),
    );
    setSimulationWidthState(next);
    try {
      window.localStorage.setItem(SIMULATION_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // Resizing remains available when browser storage is unavailable.
    }
  };
  const {
    libraryPanelOpen,
    libraryWidth,
    setLibraryWidth,
    compactLayout,
    compactLibraryPanelOpen,
    setCompactLibraryPanelOpen,
    leftPanelMode,
    selectionOpen,
    setSelectionOpen,
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
    closeSearch,
    toggleExamplesPanel: toggleExamplesPanelFromShell,
    toggleLibraryPanel,
  } = useEditorPanels({
    initialCompact: compactLayoutMatches(COMPACT_LAYOUT_MEDIA_QUERY),
    compactMediaQuery: COMPACT_LAYOUT_MEDIA_QUERY,
    forceInitialLibraryOpen:
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("new") === "1",
    libraryStorageKey: LIBRARY_PANEL_STORAGE_KEY,
    libraryWidthStorageKey: LIBRARY_WIDTH_STORAGE_KEY,
  });
  const visibleLibraryPanelOpen = compactLayout
    ? compactLibraryPanelOpen
    : libraryPanelOpen;
  const [, setGalleryRefreshSignal] = useState(0);
  const galleryLoadGenerationRef = useRef(0);
  useEffect(() => {
    if (!visibleLibraryPanelOpen) return;
    return subscribeGalleryRefresh(() => {
      galleryLoadGenerationRef.current += 1;
      setGalleryRefreshSignal((previous) => previous + 1);
    });
  }, [visibleLibraryPanelOpen]);

  const [recoveryFailureDismissed, setRecoveryFailureDismissed] =
    useState(false);
  // Feature name whose on-demand chunk vanished under a redeploy; the banner
  // offers the refresh that restores the current circuit.
  const [chunkLoadFailure, setChunkLoadFailure] = useState<string | null>(null);
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
  const [agentStartupRecovery] = useState(() => {
    if (typeof window === "undefined") return null;
    const search = new URLSearchParams(window.location.search);
    if (
      initialGalleryEntryId !== null ||
      search.has("example") ||
      search.has("project") ||
      search.get("new") === "1"
    )
      return null;
    const saved = peekAgentSessionRecovery(window.sessionStorage);
    return saved?.projectSessionId === recoveryWorkingCopyId ? saved : null;
  });
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
  } = useDocumentController(preparedInitialProject, (project) => {
    // A commit landing outside the active pointer session invalidates it:
    // the session's completion would otherwise plan on the pointer-down
    // document and stamp the live revision, silently reverting this commit
    // (audit #8). The session's own commit runs after its cleanup, so this
    // is a no-op for ordinary drags.
    canvasDragSessionRef.current?.cancel();
    stageRecovery(project, { cloudBinding });
  });
  const galleryTopologyProject = useMemo(
    () => projectWithTopologyRoot(project, document.id),
    [document.id, project],
  );
  const definitionProjectRef = useRef({ project, projectSessionId });
  definitionProjectRef.current = { project, projectSessionId };
  const projectConnectivityIndex = useMemo(
    () => buildProjectConnectivityIndex(project, resolver),
    [project, resolver],
  );
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
        () => {
          synchronizeExternalCommit();
          // Agent commits have already crossed a network boundary. Start the
          // durable write immediately so a following render crash cannot lose
          // the acknowledged transaction inside the debounce window.
          void flushRecovery();
        },
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
    selectObjects: selectVisualObjects,
    selectObject: selectVisualObject,
    selectInstance: updateInstanceSelection,
    clearKinds: clearSelectionKinds,
    reset: resetSelection,
  } = useSelectionController();
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>(
    DEFAULT_SELECTION_FILTER,
  );
  const [selectionFilterOpen, setSelectionFilterOpen] = useState(false);
  const selectionPolicy = useMemo(
    () => createSelectionPolicy(document, selectionFilter),
    [document, selectionFilter],
  );
  const unfilteredSelectionPolicy = useMemo(
    () => createSelectionPolicy(document, DEFAULT_SELECTION_FILTER),
    [document],
  );
  const uniqueSuffixCounter = useRef(0);
  const [viewBox, setRawViewBox] = useState<GridRect>(DEFAULT_VIEWBOX);
  const cameraRuntimeRef = useRef<CameraRuntime | null>(null);
  if (!cameraRuntimeRef.current) {
    cameraRuntimeRef.current = createCameraRuntime(
      DEFAULT_VIEWBOX,
      setRawViewBox,
    );
  }
  const cameraRuntime = cameraRuntimeRef.current;
  useEffect(() => () => cameraRuntime.dispose(), [cameraRuntime]);
  const [shortcutHintsVisible, setShortcutHintsVisible] = useState(false);
  const [gridDotsVisible, setGridDotsVisible] = useState(true);
  // Which channel serves this build (Deployment rationale). Asked once; anything but a
  // clear "preview" is production, so the public site never wears its badge.
  const [releaseChannel, setReleaseChannel] =
    useState<ReleaseChannel>("production");
  useEffect(() => {
    let cancelled = false;
    void loadReleaseChannel().then((channel) => {
      if (!cancelled) setReleaseChannel(channel);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const projectStore = projectStoreCopy(releaseChannel);
  const simulationTransport = resolveSimulationTransport(
    releaseChannel,
    import.meta.env.VITE_ICM_SIMULATION_TRANSPORT,
  );
  // Annotations and drafting place on their own pitch; the Document grid
  // stays the electrical contract for devices, wires, and junctions.
  const [annotationGrid, setAnnotationGridState] = useState<1 | 5 | 10>(() => {
    if (typeof window === "undefined") return 5;
    const stored = Number(
      window.localStorage.getItem("icm.annotation-grid.v1"),
    );
    return stored === 1 || stored === 5 || stored === 10 ? stored : 5;
  });
  const setAnnotationGrid = (pitch: 1 | 5 | 10): void => {
    setAnnotationGridState(pitch);
    try {
      window.localStorage.setItem("icm.annotation-grid.v1", String(pitch));
    } catch {
      // Storage may be unavailable; the choice still applies to this session.
    }
  };
  const [portLabelFormat, setPortLabelFormatState] =
    useState<PortLabelFormatOptions>(() => {
      if (typeof window === "undefined") return DEFAULT_PORT_LABEL_FORMAT;
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(PORT_LABEL_FORMAT_STORAGE_KEY) ?? "null",
        ) as Partial<PortLabelFormatOptions> | null;
        if (
          stored &&
          ["preserve", "uppercase", "lowercase"].includes(
            stored.suffixCase ?? "",
          ) &&
          ["subscript", "baseline"].includes(stored.suffixPlacement ?? "")
        )
          return stored as PortLabelFormatOptions;
      } catch {
        // Invalid or unavailable storage falls back to the canonical defaults.
      }
      return DEFAULT_PORT_LABEL_FORMAT;
    });
  const setPortLabelFormat = (format: PortLabelFormatOptions): void => {
    setPortLabelFormatState(format);
    try {
      window.localStorage.setItem(
        PORT_LABEL_FORMAT_STORAGE_KEY,
        JSON.stringify(format),
      );
    } catch {
      // The Properties code remains authoritative for this session.
    }
  };
  const arrowPreset: ArrowPreset = DEFAULT_ARROW_PRESET;
  const [drawAngleMode, setDrawAngleModeState] = useState<DrawAngleMode>(() => {
    if (typeof window === "undefined") return "free";
    const stored = window.localStorage.getItem("icm.draw-angle.v1");
    return stored === "45" || stored === "orthogonal" ? stored : "free";
  });
  const [wheelBehavior, setWheelBehaviorState] = useState<WheelBehavior>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.localStorage.getItem("icm.wheel-behavior.v1");
    return stored === "zoom" || stored === "pan" ? stored : "auto";
  });
  const wheelBehaviorRef = useRef(wheelBehavior);
  wheelBehaviorRef.current = wheelBehavior;
  const setWheelBehavior = (behavior: WheelBehavior): void => {
    setWheelBehaviorState(behavior);
    try {
      window.localStorage.setItem("icm.wheel-behavior.v1", behavior);
    } catch {
      // Storage may be unavailable; the choice still applies to this session.
    }
  };
  const setDrawAngleMode = (mode: DrawAngleMode): void => {
    setDrawAngleModeState(mode);
    try {
      window.localStorage.setItem("icm.draw-angle.v1", mode);
    } catch {
      // Storage may be unavailable; the choice still applies to this session.
    }
  };
  const setViewBox = (
    next: GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput),
    grid = document.presentation.grid,
  ): void => {
    cameraRuntime.set(next, grid);
  };
  const [importReport, setImportReport] = useState<SpiceImportReport | null>(
    null,
  );
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [cellManagerOpen, setCellManagerOpen] = useState(false);
  const [activeSimulationFolderId, setActiveSimulationFolderId] = useState<
    string | null
  >(null);
  const activeSimulationFolder =
    project.simulationFolders.find(
      (folder) => folder.id === activeSimulationFolderId,
    ) ?? project.simulationFolders[0];
  useEffect(() => {
    setActiveSimulationFolderId(null);
  }, [projectSessionId]);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const canvasContextMenuSuppressed = useRef(false);
  const [netlistPreflightOpen, setNetlistPreflightOpen] = useState(false);
  const [projectPanel, setProjectPanel] =
    useState<EditorProjectPanelMode | null>("netlist");
  const [netlistFocusedInstance, setNetlistFocusedInstance] = useState<{
    documentId: string;
    instanceId: string;
  } | null>(null);
  useEffect(() => {
    // Explicit inspector actions (Q, double-click, Issues, import review)
    // take precedence over the Netlist panel opened at startup.
    if (selectionOpen) setProjectPanel(null);
  }, [selectionOpen]);
  const propertiesOpenBeforeProjectPanelRef = useRef(false);
  const [netlistNamingProfile, setNetlistNamingProfile] = useState<
    "native" | "cadence-bang"
  >("native");
  const netlistPreferences = useNetlistExportPreferences();
  const [netlistEntry, setNetlistEntry] = useState<{
    sessionId: string;
    documentId: string;
  } | null>(null);
  const netlistRootDocumentId =
    netlistEntry?.sessionId === projectSessionId &&
    project.documents.some((item) => item.id === netlistEntry.documentId)
      ? netlistEntry.documentId
      : undefined;
  const [documentSettingsOpen, setDocumentSettingsOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState<string | null>(null);
  const [publishGalleryOpen, setPublishGalleryOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [publishSession, setPublishSession] = useState<SessionUser | null>(
    null,
  );
  /** The signed-in account's private formal Projects, newest first. */
  const [cloudProjects, setCloudProjects] = useState<
    readonly CloudProjectSummary[]
  >([]);
  const [cloudProjectsReady, setCloudProjectsReady] = useState(false);
  const cloudListRequestRef = useRef(0);
  const cloudListMutationRef = useRef(0);
  const reloadCloudProjects = useCallback(async (): Promise<void> => {
    const request = ++cloudListRequestRef.current;
    const mutationAtStart = cloudListMutationRef.current;
    const outcome = await listCloudProjects();
    if (request !== cloudListRequestRef.current) return;
    setCloudProjectsReady(true);
    if (outcome.status !== "listed") return;
    // A Save or Delete acknowledged after this request began is newer than
    // the response, so the stale list must not erase that mutation.
    if (mutationAtStart !== cloudListMutationRef.current) return;
    setCloudProjects(outcome.projects);
  }, []);
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
  const [publishGates, setPublishGates] = useState<SubmissionGateReport | null>(
    null,
  );
  // Account state owns publishing authority and the private Cloud Project
  // list shown by the File menu.
  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser().then(async (user) => {
      if (cancelled) return;
      setPublishSession(user);
      if (!user) {
        setCloudProjectsReady(true);
        return;
      }
      await reloadCloudProjects();
    });
    return () => {
      cancelled = true;
    };
  }, [reloadCloudProjects]);

  useEffect(() => {
    if (!publishSession) return;
    const refreshAfterReturning = () => void reloadCloudProjects();
    window.addEventListener("focus", refreshAfterReturning);
    return () => window.removeEventListener("focus", refreshAfterReturning);
  }, [publishSession, reloadCloudProjects]);

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
  const [agentFileCandidate, setAgentFileCandidate] =
    useState<AgentFileCandidateSummary | null>(null);
  const browserAgentFileHost = useMemo(
    () =>
      new BrowserAgentFileHost({
        transport: simulationTransport,
        getProjectSessionId: () => editorDocumentController.projectSessionId,
        getProject: () => editorDocumentController.project,
        getDocument: (documentId) =>
          editorDocumentController.project.documents.find(
            (candidate) => candidate.id === documentId,
          ) ?? null,
        getResolver: () => editorDocumentController.resolver,
        onApprovalRequested: setAgentFileCandidate,
        dispatchProjectTransaction: (request) =>
          browserAgentHost.dispatchProjectTransaction(request),
      }),
    [editorDocumentController, projectSessionId, simulationTransport],
  );
  const projectRunHistory = useMemo(
    () => new ProjectRunHistory(editorDocumentController.project.id),
    [editorDocumentController, projectSessionId],
  );
  useEffect(() => {
    projectRunHistory.activate();
    return () => projectRunHistory.dispose();
  }, [projectRunHistory]);
  const browserAgentSimulationHost = useMemo(
    () =>
      new BrowserAgentSimulationHost({
        runHistory: projectRunHistory,
        owner: "agent",
        files: browserAgentFileHost.simulationFiles,
        getProjectSessionId: () => editorDocumentController.projectSessionId,
        getProject: () => editorDocumentController.project,
        transport: simulationTransport,
      }),
    [
      browserAgentFileHost.simulationFiles,
      projectRunHistory,
      editorDocumentController,
      projectSessionId,
      simulationTransport,
    ],
  );
  const browserAgentProjectHost = useMemo(
    () =>
      new BrowserAgentProjectHost({
        getProjectSessionId: () => editorDocumentController.projectSessionId,
        getProject: () => editorDocumentController.project,
        getActiveDocumentId: () => editorDocumentController.document.id,
        commitProjectStructure: (nextProject, activeDocumentId) => {
          editorDocumentController.commitProjectStructure(
            nextProject,
            activeDocumentId,
          );
          synchronizeExternalCommit();
          void flushRecovery();
        },
        dispatchProjectTransaction: (request) =>
          browserAgentHost.dispatchProjectTransaction(request),
      }),
    [browserAgentHost, editorDocumentController, projectSessionId],
  );
  const [analogSimulationState, setAnalogSimulationState] = useState<
    "closed" | "open" | "maximized" | "minimized"
  >("closed");
  const simulationSourceBuffer = useRef<{
    dirty: boolean;
    flush(): Promise<boolean>;
  } | null>(null);
  const analogSimulationOpened = analogSimulationState !== "closed";
  const analogSimulationOpen =
    analogSimulationState === "open" || analogSimulationState === "maximized";
  const analogSimulationMaximized = analogSimulationState === "maximized";
  const humanSimulationSession = useMemo(
    () =>
      analogSimulationOpened
        ? new BrowserSimulationSession({
            runHistory: projectRunHistory,
            owner: "human",
            getProjectSessionId: () =>
              editorDocumentController.projectSessionId,
            getProject: () => editorDocumentController.project,
            projectFiles: createSimulationProjectFileHost({
              getProject: () => editorDocumentController.project,
              getProjectSessionId: () =>
                editorDocumentController.projectSessionId,
              dispatch: (request) => dispatchProjectTransaction(request),
              actor: { kind: "human", id: "human-local" },
            }),
            transport: simulationTransport,
          })
        : null,
    [
      analogSimulationOpened,
      projectRunHistory,
      editorDocumentController,
      projectSessionId,
      simulationTransport,
    ],
  );
  useEffect(
    () => () => {
      void humanSimulationSession?.clear();
    },
    [humanSimulationSession],
  );
  const openAnalogSimulation = (): void => {
    if (!publicSimulationUiEnabled) return;
    setProjectPanel(null);
    setAnalogSimulationState("open");
  };
  const minimizeAnalogSimulation = (): void => {
    setSimulationPickModeState(null);
    setAnalogSimulationState("minimized");
  };
  const toggleAnalogSimulationMaximized = (): void => {
    setAnalogSimulationState((current) =>
      current === "maximized" ? "open" : "maximized",
    );
  };
  const exitAnalogSimulation = (): void => {
    setSimulationPickModeState(null);
    void humanSimulationSession?.clear();
    setAnalogSimulationState("closed");
  };
  const captureAuthoredProject = async () => {
    if (
      simulationSourceBuffer.current &&
      !(await simulationSourceBuffer.current.flush())
    ) {
      setStatus(
        "Source edits need attention; open Code. No work was discarded.",
      );
      return null;
    }
    return editorDocumentController.project;
  };
  const {
    cloudBinding,
    savedProjectBaseline,
    replaceGuard,
    replaceGuardSaving,
    recoveryDialogOpen,
    startupRecovery,
    startupCloudProjectId,
    canRestoreStartupCloudProject,
    restoreAfterRefresh,
    startupRestoreReady,
    setRecoveryDialogOpen,
    isDirtyWork,
    hasUnsafeWork,
    noteProjectSnapshotSafe,
    replaceActiveProject,
    saveProjectToCloud,
    isSaveInFlight,
    saveBusy,
    exportProjectFile,
    downloadCurrentProjectBackup,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    saveAndContinueReplaceGuard,
    dismissStartupRecovery,
    createNewProject,
    revertToSavedProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    openProjectFile,
    openCloudProjectById,
  } = useProjectFileLifecycle({
    restoreWorkingSession: agentStartupRecovery !== null,
    hasPendingEdits: () => simulationSourceBuffer.current?.dirty === true,
    beforeSnapshot: captureAuthoredProject,
    onRecoverBuffers: recoverSourceDrafts,
    project,
    projectSessionId,
    viewBox,
    defaultViewBox: DEFAULT_VIEWBOX,
    setStatus,
    projectStoreCopy: projectStore,
    onCloudProjectSaved: (saved) => {
      cloudListMutationRef.current += 1;
      setCloudProjects((current) => [
        saved,
        ...current.filter((candidate) => candidate.id !== saved.id),
      ]);
    },
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
      // Each newly opened circuit starts with its netlist. Ordinary edits and
      // user-driven panel changes do not reset the workspace.
      propertiesOpenBeforeProjectPanelRef.current = false;
      setSelectionOpen(false);
      setProjectPanel("netlist");
      if (compactLayout) setCompactLibraryPanelOpen(false);
      return nextDocument;
    },
  });
  const allowNextBrowserUnload = useUnsavedWorkGuard(hasUnsafeWork());
  const startupCloudRestoreAttemptedRef = useRef(false);
  const hasExplicitBootTarget =
    initialGalleryEntryId !== null ||
    (typeof window !== "undefined" &&
      (() => {
        const search = new URLSearchParams(window.location.search);
        return (
          search.has("example") ||
          search.has("project") ||
          search.get("new") === "1"
        );
      })());
  useEffect(() => {
    if (
      startupCloudRestoreAttemptedRef.current ||
      !cloudProjectsReady ||
      !publishSession ||
      !canRestoreStartupCloudProject ||
      hasExplicitBootTarget ||
      !startupCloudProjectId
    ) {
      return;
    }
    startupCloudRestoreAttemptedRef.current = true;
    setStatus("Opening recent Cloud Project…");
    void openCloudProjectById(startupCloudProjectId);
  }, [
    canRestoreStartupCloudProject,
    cloudProjectsReady,
    hasExplicitBootTarget,
    openCloudProjectById,
    publishSession,
    startupCloudProjectId,
  ]);
  const agentSession = useAgentSession({
    recover: !hasExplicitBootTarget,
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
      (startupRestoreReady ||
        recoveryWorkingCopyId !== agentStartupRecovery?.projectSessionId),
    project,
    projectSessionId: recoveryWorkingCopyId,
    host: browserAgentHost,
    fileHost: browserAgentFileHost,
    simulationHost: browserAgentSimulationHost,
    projectHost: browserAgentProjectHost,
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
    wirePreviewPoint,
    wirePreviewTarget,
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
    setWirePreview,
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
  const readCurrentWireSession = () => {
    const current = getCurrentInteractionState();
    return current.kind === "wire"
      ? {
          source: current.source,
          sourceRevision: current.sourceRevision,
          steps: current.steps,
          routingMode: current.routingMode,
          cornerOrder: current.cornerOrder,
        }
      : {
          source: null,
          sourceRevision: null,
          steps: [],
          routingMode: "orthogonal" as const,
          cornerOrder: "auto" as const,
        };
  };
  // Already derived for this revision by the connectivity index above; the
  // routing plan gate would otherwise derive it again over the same Document.
  const documentContactEvidence = projectConnectivityIndex.documents.get(
    document.id,
  )?.contactEvidence;
  const [interfaceConfirmation, setInterfaceConfirmation] = useState<{
    request: CellInterfaceConfirmation;
    snapshot: typeof project;
  } | null>(null);
  const [parameterBinding, setParameterBinding] = useState<{
    snapshot: CircuitProject;
    cell: SchematicDocument;
    instanceId: string;
    field: string;
    value: string;
    anchor: HTMLElement;
  } | null>(null);
  const { commitStructure, transact, transactConnectivity } =
    createEditorTransactionCommands({
      project,
      document,
      resolver,
      ...(documentContactEvidence
        ? { contactEvidence: documentContactEvidence }
        : {}),
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
    updateCellPortDirection,
    moveCellPort,
    editCellParameter,
    setExternalSubcircuitDefinition,
    removeExternalSubcircuitDefinition,
    setCellSymbolBodySize,
    setCellSymbolPortPlacement,
    editCellTerminalAnnotation,
    formatCellTerminalAnnotations,
    removeCellTerminalSelection,
    renameProject,
  } = createProjectStructureCommands({
    requestConfirmation: (request) =>
      setInterfaceConfirmation({ request, snapshot: project }),
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
      prepareLibraryExample: (example) =>
        prepareNetlistExample(
          example,
          netlistPreferences.preferences.profiles[netlistPreferences.selected],
        ),
      replaceActiveProject,
      guardDirtyReplacement,
      beginCopyPlacement: (clipboard, anchor) => {
        prepareProjectCopy(project, document, clipboard);
        beginCopyPlacementInteraction(clipboard, anchor);
      },
      cancelAllTransientInteraction,
      setGalleryEntryContext,
      setStatus,
    });
  const [draftingInspectorSegment, setDraftingInspectorSegment] = useState<{
    objectId: string;
    index: number;
  } | null>(null);
  const [selectedRouteSegmentIndex, setSelectedRouteSegmentIndex] = useState<
    number | null
  >(null);
  /** Survives the dialog closing, so a mistaken dismissal loses nothing. */
  const [publishDraft, setPublishDraft] = useState<PublishGalleryDraft | null>(
    null,
  );
  /**
   * A verb key pressed with nothing selected arms that verb: the next
   * object pointed at is the one acted on (Cadence-style verb-first).
   * Rotate and Delete stay armed for repeated clicks; Copy and Move hand
   * over to their own placement/move interactions on the first target.
   */
  const [armedVerb, setArmedVerb] = useState<
    "rotate" | "copy" | "move" | "move-detached" | "delete" | null
  >(null);
  /** The click paired with an armed-verb pickup must not commit a placement. */
  const suppressCommitClickRef = useRef(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<WireSource | null>(
    null,
  );
  const [bulkDrawInstanceId, setBulkDrawInstanceId] = useState<string | null>(
    null,
  );
  const [highlightedNetOrigin, setHighlightedNetOrigin] =
    useState<HighlightedNetOrigin | null>(null);
  const [codeNetPreview, setCodeNetPreview] =
    useState<HighlightedNetOrigin | null>(null);
  const [simulationWindowOpen, setSimulationWindowOpen] = useState(false);
  const [simulationPickMode, setSimulationPickModeState] = useState<
    "net" | "terminal" | null
  >(null);
  const simulationPickNetsActive = simulationPickMode === "net";
  const simulationPickTerminalsActive = simulationPickMode === "terminal";
  const simulationPickActive = simulationPickMode !== null;
  const [simulationHoverNetId, setSimulationHoverNetId] = useState<
    string | null
  >(null);
  const [simulationSavedNetIds, setSimulationSavedNetIds] = useState<
    Set<string>
  >(() => new Set());
  const [analogPickedNet, setAnalogPickedNet] = useState<{
    sequence: number;
    documentId: string;
    netId: string;
    occurrence?: readonly string[];
  } | null>(null);
  const [analogPickedTerminal, setAnalogPickedTerminal] = useState<{
    sequence: number;
    documentId: string;
    instanceId: string;
    pinName: string;
    directionPinName?: string;
    occurrence?: readonly string[];
  } | null>(null);
  const [simulationTerminalPickStart, setSimulationTerminalPickStart] =
    useState<{
      documentId: string;
      instanceId: string;
      pinName: string;
      partnerPinNames: readonly string[];
      occurrence?: readonly string[];
    } | null>(null);
  const [pendingWaveformPlacement, setPendingWaveformPlacement] =
    useState<PendingWaveformPlacement | null>(null);
  const [waveformPlacementPoint, setWaveformPlacementPoint] =
    useState<Point | null>(null);
  useEffect(() => {
    // Net-pick is a hierarchy traversal mode: keep it armed while the author
    // enters a DUT Cell, so an internal Net can be picked with its occurrence
    // path intact. Closing/minimising Simulation still cancels it explicitly.
    if (!analogSimulationOpen) setSimulationPickModeState(null);
    setSimulationTerminalPickStart(null);
    setSimulationHoverNetId(null);
    setSimulationSavedNetIds(new Set());
    setPendingWaveformPlacement(null);
    setWaveformPlacementPoint(null);
  }, [document.id]);
  useEffect(() => {
    setSimulationPickModeState(null);
    setAnalogPickedNet(null);
    setAnalogPickedTerminal(null);
    setSimulationTerminalPickStart(null);
  }, [projectSessionId]);
  useEffect(() => {
    setSimulationTerminalPickStart(null);
  }, [activeSimulationFolderId]);
  const routeCounter = useRef(0);
  const canvasDragSessionRef = useRef<CanvasDragSession | null>(null);
  /**
   * Last pointer position seen on the canvas, in document coordinates. A
   * placement that starts from the keyboard has no pointer event of its own,
   * so it seeds its preview from here instead of waiting for the next move.
   */
  const lastCanvasPointRef = useRef<Point | null>(null);

  /** Show a placement ghost under the cursor without waiting for a move. */
  function seedComponentPreviewFromPointer(
    kind: PendingComponentPlacement["kind"],
  ): void {
    const point = lastCanvasPointRef.current;
    if (!point) return;
    const pitch =
      kind === "drafting-text" ? annotationGrid : document.presentation.grid;
    setComponentPreviewPoint({
      x: snapCoordinate(point.x, pitch),
      y: snapCoordinate(point.y, pitch),
    });
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
  const documentViewBoxes = useRef(new Map<string, GridRect>());
  const [projectedMovePreviewDocument, setProjectedMovePreviewDocument] =
    useState<SchematicDocument | null>(null);
  const renderedDocument = useMemo(() => {
    let rendered = projectedMovePreviewDocument ?? document;
    if (draftingHandlePreview && rendered.drafting) {
      rendered = {
        ...rendered,
        drafting: {
          ...rendered.drafting,
          objects: rendered.drafting.objects.map((object) =>
            object.id === draftingHandlePreview.objectId
              ? draftingHandlePreview.object
              : object,
          ),
        },
      };
    }
    if (pendingWaveformPlacement && waveformPlacementPoint) {
      const previewObjects = pendingWaveformPlacement.objects.map((object) =>
        translateDraftingObject(
          object,
          waveformPlacementPoint,
          document.presentation.grid,
        ),
      );
      rendered = {
        ...rendered,
        drafting: {
          objects: [...(rendered.drafting?.objects ?? []), ...previewObjects],
        },
      };
    }
    return rendered;
  }, [
    document,
    draftingHandlePreview,
    pendingWaveformPlacement,
    projectedMovePreviewDocument,
    waveformPlacementPoint,
  ]);
  const lastGoodSceneRef = useRef<ReturnType<typeof buildSvgScene> | null>(
    null,
  );
  const [formulaArtifactRevision, setFormulaArtifactRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let releaseFormulaArtifacts: () => void = () => undefined;
    void prepareDocumentFormulaArtifacts(renderedDocument)
      .then((prepared) => {
        if (cancelled) {
          prepared.release();
          return;
        }
        releaseFormulaArtifacts = prepared.release;
        if (prepared.preparedNewArtifact) {
          setFormulaArtifactRevision((revision) => revision + 1);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(
            error instanceof Error
              ? error.message
              : "Formula preparation failed",
          );
        }
      });
    return () => {
      cancelled = true;
      releaseFormulaArtifacts();
    };
  }, [renderedDocument]);
  const committedSceneState = useMemo(() => {
    const outcome = buildSceneSafely(() => {
      if (sceneCrashRequested()) {
        throw new Error("scene build crashed (test hook)");
      }
      // Camera state belongs to the outer SVG viewBox. The formal body is
      // camera-independent; rebuilding it during pan/zoom repeats all route,
      // symbol, text, and drafting derivation without changing one visible
      // object.
      const documentConnectivity = projectConnectivityIndex.documents.get(
        document.id,
      );
      return buildSvgScene(document, resolver, {
        ...(documentConnectivity
          ? {
              routingGeometry: documentConnectivity.routingGeometry,
              contactEvidence: documentConnectivity.contactEvidence,
            }
          : {}),
      });
    }, lastGoodSceneRef.current);
    if (!outcome.degraded) lastGoodSceneRef.current = outcome.scene;
    return outcome;
  }, [document, formulaArtifactRevision, projectConnectivityIndex, resolver]);
  const sceneState = useMemo(() => {
    if (renderedDocument === document) return committedSceneState;
    const outcome = buildSceneSafely(() => {
      if (sceneCrashRequested()) {
        throw new Error("scene build crashed (test hook)");
      }
      return buildSvgScene(renderedDocument, resolver);
    }, lastGoodSceneRef.current);
    if (!outcome.degraded) lastGoodSceneRef.current = outcome.scene;
    return outcome;
  }, [committedSceneState, document, renderedDocument, resolver]);
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
    if (!copyPlacement) {
      return { scene: null, anchors: [], error: null };
    }
    try {
      const prepared = prepareProjectCopy(
        project,
        document,
        copyPlacement.clipboard,
      );
      const previewDocument = clipboardPreviewDocument(
        document,
        prepared.clipboard,
        { x: 0, y: 0 },
        copyPlacement.orientationOperations,
        prepared.resolver,
        copyPlacement.sequence,
      );
      return {
        scene: buildSvgScene(previewDocument, prepared.resolver),
        anchors: copyPlacementAnchors(previewDocument, prepared.resolver),
        error: null,
      };
    } catch (error) {
      return {
        scene: null,
        anchors: [],
        error:
          error instanceof Error
            ? error.message
            : "Copy preview could not be rendered",
      };
    }
  }, [
    copyPlacement?.clipboard,
    copyPlacement?.orientationOperations,
    copyPlacement?.sequence,
    project,
    document,
    resolver,
  ]);
  useEffect(() => {
    if (copyPreviewState.error) {
      setStatus(`Copy preview unavailable — ${copyPreviewState.error}`);
    }
  }, [copyPreviewState.error]);
  const copyPreviewInnerHtml = useMemo(
    () =>
      copyPreviewState.scene === null || !copyPlacement?.previewPoint
        ? null
        : { __html: copyPreviewState.scene.formalBody },
    [copyPlacement?.previewPoint, copyPreviewState.scene],
  );
  const copyPreviewTransform = copyPlacement?.previewPoint
    ? `translate(${copyPlacement.previewPoint.x - copyPlacement.anchor.x} ${
        copyPlacement.previewPoint.y - copyPlacement.anchor.y
      })`
    : undefined;
  // Every Instance the Cell holds but the sheet does not show. Import is one
  // way to get there and was once the only one the tray admitted, but a
  // returned or pasted Instance lands in the same state — and an Instance
  // nothing lists is one nobody can place or delete, while it still holds its
  // reference, its Net terminals and its place in the netlist.
  const unplaced = document.instances.filter(
    (instance) => instance.placement === null,
  );
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  const {
    selectedIds,
    supplementalSelection,
    selectedRouteId,
    selectedAnnotationId,
    selectedDraftingId,
    selectedInstance,
    selectedHierarchyCell,
    selectedDevice,
    selectedCapacitorPlateRows,
    selectedExternalSubcircuit,
    selectedReviewedExternalBinding,
    selectedPropertyDevice,
    selectedRoute,
    selectedMosBulkOwnerLabel,
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
  const selectedAnnotationOwnerInstanceId = selectedAnnotation
    ? annotationOwningInstanceId(selectedAnnotation)
    : undefined;
  useEffect(() => {
    if (
      parameterBinding &&
      (!selectionOpen ||
        selectedInstance?.id !== parameterBinding.instanceId ||
        document.id !== parameterBinding.cell.id)
    )
      setParameterBinding(null);
  }, [selectionOpen, selectedInstance?.id, document.id, parameterBinding]);
  const selectedComponentSourceCode = useMemo(
    () =>
      selectedInstance
        ? componentSourceCode(
            project,
            document.id,
            selectedInstance.id,
            resolver,
          )
        : null,
    [document.id, project, resolver, selectedInstance],
  );
  const selectedAnnotationOwnerInstance = selectedAnnotationOwnerInstanceId
    ? document.instances.find(
        (instance) => instance.id === selectedAnnotationOwnerInstanceId,
      )
    : undefined;
  const selectedAnnotationInheritedTextColor =
    selectedAnnotationOwnerInstance?.styleOverride?.foreground ??
    styleProfile.foreground;
  const {
    logicalNets,
    routeGeometryRecords,
    highlightedTrace,
    highlightedNet,
    selectedHighlightIsActive,
    searchResults,
    flightlines,
    displayedFlightlines,
    crossings,
    visibleEndpoints,
    wiringEndpoints,
    contactComponents,
  } = useEditorDerivedModel({
    project,
    document,
    resolver,
    projectConnectivityIndex,
    documentStack,
    highlightedNetOrigin,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
    searchActive: searchOpen,
    searchQuery,
    routingGuidanceView,
    wireSource,
    bulkDrawInstanceId,
  });
  const netChoices = useMemo(() => logicalNetChoices(document), [document]);
  useEffect(() => {
    setSimulationSavedNetIds((current) => {
      const canonical = new Set<string>();
      for (const netId of current) {
        const group = logicalNets.byBaseNetId.get(netId);
        if (group) canonical.add(group.baseNetIds[0]!);
      }
      if (
        canonical.size === current.size &&
        [...canonical].every((netId) => current.has(netId))
      ) {
        return current;
      }
      return canonical;
    });
  }, [logicalNets]);
  const selectedNetNameAnnotation =
    selectedAnnotation?.binding?.kind === "net-name" &&
    (selectedAnnotation.kind === "net-label" ||
      selectedAnnotation.kind === "power-label")
      ? selectedAnnotation
      : (selectedRouteNetLabel ?? null);
  const selectedNetNameClaim = selectedNetNameAnnotation
    ? document.connectivityEvidence.find(
        (evidence) =>
          evidence.kind === "name-claim" &&
          ((evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === selectedNetNameAnnotation.id) ||
            (evidence.owner.kind === "power-marker" &&
              selectedNetNameAnnotation.anchor.kind === "object" &&
              evidence.owner.objectId ===
                selectedNetNameAnnotation.anchor.objectId)),
      )
    : undefined;
  const selectedNetNameLogical = selectedNetNameAnnotation?.netId
    ? logicalNets.byBaseNetId.get(selectedNetNameAnnotation.netId)
    : undefined;
  const projectNetNameProjection = useMemo(
    () =>
      selectedNetNameLogical ? deriveProjectNetNameProjection(project) : null,
    [project, selectedNetNameLogical],
  );
  const selectedNetNameProjection = selectedNetNameLogical
    ? projectNetNameProjection?.byDocumentId
        .get(document.id)
        ?.get(selectedNetNameLogical.id)
    : undefined;
  const selectedNetPreferredSpelling =
    selectedNetNameProjection?.preferredSpelling ??
    selectedNetNameLogical?.name;
  const sceneSnapTargetIndex = useMemo(
    () => buildSceneSnapTargetIndex(document, resolver, visibleEndpoints),
    [document, resolver, visibleEndpoints],
  );
  const [issuesFocusToken, setIssuesFocusToken] = useState(0);
  const [issuesSectionOpen, setIssuesSectionOpen] = useState(false);
  const projectCheck = useProjectCheck({
    project,
    sessionId: projectSessionId,
    resolver,
    index: projectConnectivityIndex,
    save: saveProjectToCloud,
    beforeCheck: captureAuthoredProject,
    isSaving: isSaveInFlight,
    openIssues: openIssuesPanel,
  });
  const checkedSnapshot = projectCheck.result?.snapshot ?? null;
  const checkedElectricalDiagnostics = useMemo(
    () =>
      checkedSnapshot?.diagnostics.filter((item) => item.domain === "erc") ??
      [],
    [checkedSnapshot],
  );
  const visualDiagnostics = useMemo(
    () => projectCheck.result?.visualByDocument.get(document.id) ?? [],
    [projectCheck.result, document.id],
  );
  const visualDiagnosticSummary = useMemo(
    () =>
      summarizeVisualDiagnostics(
        projectCheck.status === "current" ? visualDiagnostics : [],
      ),
    [visualDiagnostics, projectCheck.status],
  );
  const angledWireRepairPlan = useMemo(
    () =>
      planAngledWireRepairs(
        document,
        resolver,
        projectConnectivityIndex.documents.get(document.id)?.routingGeometry,
      ),
    [document, resolver, projectConnectivityIndex],
  );
  // Independent Netlist adapter: creating the callback is free; only a report
  // or export executes ERC, once per immutable Project/resolver/index tuple.
  const requestElectricalDiagnostics = useMemo(() => {
    let findings: ReturnType<typeof runErcChecks> | undefined;
    return () =>
      (findings ??= runErcChecks(project, projectConnectivityIndex, resolver));
  }, [project, projectConnectivityIndex, resolver]);

  const diagnosticMarkers = useMemo(
    () =>
      projectCheck.status === "current"
        ? buildDiagnosticMarkers({
            document,
            resolver,
            connectivityIndex: projectConnectivityIndex,
            electricalDiagnostics: checkedElectricalDiagnostics,
            visualDiagnostics,
            reviewOpen: selectionOpen && issuesSectionOpen,
          })
        : [],
    [
      document,
      resolver,
      projectConnectivityIndex,
      projectCheck.status,
      checkedElectricalDiagnostics,
      visualDiagnostics,
      selectionOpen,
      issuesSectionOpen,
    ],
  );
  const issueCounts = useMemo(() => {
    let errorCount = 0;
    let warningCount = 0;
    for (const diagnostic of checkedSnapshot?.diagnostics ?? []) {
      if (diagnosticPresentationGroup(diagnostic) !== "actionable") continue;
      if (diagnostic.severity === "error") errorCount += 1;
      else if (diagnostic.severity === "warning") warningCount += 1;
    }
    return { errorCount, warningCount };
  }, [checkedSnapshot]);
  function openIssuesPanel(): void {
    // Narrow layouts have room for one side panel — same rule as the dock
    // toggle, but this entry point always OPENS.
    if (compactLayout) setCompactLibraryPanelOpen(false);
    setSelectionOpen(true);
    setIssuesFocusToken((token) => token + 1);
  }
  const simulationPickHighlight = useMemo(
    () =>
      simulationPickNetsActive && simulationHoverNetId
        ? computeNetHighlight(
            projectConnectivityIndex,
            document.id,
            simulationHoverNetId,
            undefined,
            documentStack,
          )
        : undefined,
    [
      document.id,
      documentStack,
      projectConnectivityIndex,
      simulationHoverNetId,
      simulationPickMode,
    ],
  );
  const codeNetHighlight = useMemo(
    () =>
      analogSimulationOpen &&
      codeNetPreview &&
      codeNetPreview.documentId === document.id &&
      JSON.stringify(codeNetPreview.hierarchyPath) ===
        JSON.stringify(documentStack)
        ? computeNetHighlight(
            projectConnectivityIndex,
            document.id,
            codeNetPreview.netId,
            undefined,
            documentStack,
          )
        : undefined,
    [
      analogSimulationOpen,
      codeNetPreview,
      document.id,
      documentStack,
      projectConnectivityIndex,
    ],
  );
  const canonicalSimulationNetId = (netId: string): string | null => {
    const group =
      logicalNets.byBaseNetId.get(netId) ??
      logicalNets.groups.find((candidate) => candidate.id === netId);
    return group?.baseNetIds[0] ?? null;
  };
  const simulationPickRootDocumentId =
    activeSimulationFolder?.input.circuitBindings.find(
      (binding) => binding.emission === "top-level",
    )?.documentId;
  const simulationPickOccurrence: readonly string[] | undefined =
    documentStack.length > 0
      ? documentStack.map((frame) => frame.instanceId)
      : simulationPickRootDocumentId === document.id
        ? []
        : undefined;
  const activeSimulationPickOccurrence = (): readonly string[] | undefined =>
    simulationPickOccurrence;
  const simulationCurrentProbeOptions = useMemo(
    () =>
      simulationPickTerminalsActive && simulationPickRootDocumentId
        ? deriveSimulationProbeOptions(project, simulationPickRootDocumentId)
            .terminalCurrent
        : [],
    [project, simulationPickRootDocumentId, simulationPickTerminalsActive],
  );
  const simulationCurrentTargetsInView = useMemo(
    () =>
      simulationCurrentProbeOptions.filter(
        ({ target }) =>
          target.documentId === document.id &&
          (simulationPickOccurrence === undefined ||
            sameSimulationOccurrence(
              target.occurrence,
              simulationPickOccurrence,
            )),
      ),
    [document.id, simulationCurrentProbeOptions, simulationPickOccurrence],
  );
  const simulationCurrentPinNamesByInstance = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const { target } of simulationCurrentTargetsInView) {
      const pins = result.get(target.instanceId) ?? [];
      if (!pins.includes(target.pinName)) pins.push(target.pinName);
      result.set(target.instanceId, pins);
    }
    return result;
  }, [simulationCurrentTargetsInView]);
  const simulationCurrentEndpointKeys = useMemo(
    () =>
      new Set(
        simulationCurrentTargetsInView.map(
          ({ target }) => `${target.instanceId}\u0000${target.pinName}`,
        ),
      ),
    [simulationCurrentTargetsInView],
  );
  const toggleSimulationSavedNet = (netId: string): void => {
    const baseNetId = canonicalSimulationNetId(netId);
    if (!baseNetId) {
      setStatus(`Could not resolve Net ${netId}`);
      return;
    }
    const group = logicalNets.byBaseNetId.get(baseNetId);
    if (analogSimulationOpen) {
      const occurrence = activeSimulationPickOccurrence();
      setAnalogPickedNet((current) => ({
        sequence: (current?.sequence ?? 0) + 1,
        documentId: document.id,
        netId: baseNetId,
        ...(occurrence === undefined ? {} : { occurrence }),
      }));
      setStatus(`Added voltage Output ${group?.name ?? baseNetId}`);
      return;
    }
    setSimulationSavedNetIds((current) => {
      const next = new Set(current);
      if (next.has(baseNetId)) next.delete(baseNetId);
      else next.add(baseNetId);
      return next;
    });
    setStatus(`Toggled saved Net ${group?.name ?? baseNetId}`);
  };
  const pickSimulationTerminal = (endpoint: WireSource): void => {
    if (endpoint.endpoint.kind !== "terminal" || !analogSimulationOpen) return;
    const terminal = endpoint.endpoint;
    const occurrence = activeSimulationPickOccurrence();
    const referenceFor = (instanceId: string): string =>
      document.instances.find((instance) => instance.id === instanceId)
        ?.reference ?? instanceId;
    const clickedKey = `${terminal.instanceId}\u0000${terminal.pinName}`;
    if (!simulationCurrentEndpointKeys.has(clickedKey)) {
      setStatus(
        `${referenceFor(terminal.instanceId)}.${terminal.pinName} is not a measurable current terminal in this Testbench occurrence`,
      );
      return;
    }
    const commitPick = (
      picked: {
        documentId: string;
        instanceId: string;
        pinName: string;
        occurrence?: readonly string[];
      },
      directionPinName?: string,
    ): void => {
      setAnalogPickedTerminal((current) => ({
        sequence: (current?.sequence ?? 0) + 1,
        ...picked,
        ...(directionPinName ? { directionPinName } : {}),
      }));
      setSimulationTerminalPickStart(null);
      const reference = referenceFor(picked.instanceId);
      setStatus(
        directionPinName
          ? `Added current ${reference}.${picked.pinName} → ${reference}.${directionPinName} · positive current enters ${picked.pinName}`
          : `Added terminal current ${reference}.${picked.pinName} · positive current enters the terminal`,
      );
    };
    if (
      simulationTerminalPickStart &&
      simulationTerminalPickStart.documentId === document.id &&
      simulationTerminalPickStart.instanceId === terminal.instanceId &&
      sameSimulationOccurrence(
        simulationTerminalPickStart.occurrence,
        occurrence,
      )
    ) {
      if (simulationTerminalPickStart.pinName === terminal.pinName) {
        setSimulationTerminalPickStart(null);
        setStatus("Current direction cancelled · choose the first terminal");
        return;
      }
      if (
        simulationTerminalPickStart.partnerPinNames.includes(terminal.pinName)
      ) {
        commitPick(simulationTerminalPickStart, terminal.pinName);
        return;
      }
    }

    const instance = document.instances.find(
      (candidate) => candidate.id === terminal.instanceId,
    );
    const measurablePins =
      simulationCurrentPinNamesByInstance.get(terminal.instanceId) ?? [];
    const partnerPinNames = instance
      ? terminalCurrentDirectionPartners(
          instance,
          terminal.pinName,
          measurablePins,
        )
      : [];
    const picked = {
      documentId: document.id,
      instanceId: terminal.instanceId,
      pinName: terminal.pinName,
      ...(occurrence === undefined ? {} : { occurrence }),
    };
    if (partnerPinNames.length === 0) {
      commitPick(picked);
      return;
    }
    setSimulationTerminalPickStart({ ...picked, partnerPinNames });
    setStatus(
      `Current starts at ${referenceFor(terminal.instanceId)}.${terminal.pinName} · choose ${partnerPinNames.join(" or ")} to confirm direction`,
    );
  };
  const setSimulationPickMode = (mode: "net" | "terminal" | null): void => {
    if (mode) activateTool("pointer");
    setSimulationPickModeState(mode);
    if (mode !== "terminal") setSimulationTerminalPickStart(null);
    if (mode !== "net") setSimulationHoverNetId(null);
    setStatus(
      mode === "net"
        ? "Pick Nets: click a wire, label, junction, or connected pin · Esc exits"
        : mode === "terminal"
          ? "Pick current: choose a device terminal, then its direction · Esc exits"
          : "Finished picking simulation Outputs",
    );
  };
  const setSimulationNetPickMode = (active: boolean): void =>
    setSimulationPickMode(active ? "net" : null);
  const setSimulationTerminalPickMode = (active: boolean): void =>
    setSimulationPickMode(active ? "terminal" : null);
  const selectedBlockLayout = useMemo(
    () => selectedBlockSymbolTarget(project, selectedInstance),
    [project, selectedInstance],
  );
  const {
    enabled: cellSymbolLayoutEnabled,
    layout: selectedCellSymbolLayout,
    activeDragPointerId: cellSymbolLayoutDragPointerId,
    cancelDrag: cancelCellSymbolLayoutDrag,
    exit: exitCellSymbolLayout,
    toggle: toggleCellSymbolLayout,
    beginDrag: beginCellSymbolLayoutDrag,
    previewDrag: previewCellSymbolLayoutDrag,
    completeDrag: completeCellSymbolLayoutDrag,
  } = useCellSymbolLayout({
    selectedInstance,
    target: selectedBlockLayout,
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
    netLabelScopeEdit,
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
    updateSelectedReference,
    deleteSelectedAnnotation,
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
    nextId: (prefix) => {
      uniqueSuffixCounter.current += 1;
      return `${prefix}-${uniqueSuffixCounter.current}`;
    },
  });
  const {
    setTextDisplayAlias,
    applyRouteProperties,
    beginAnnotationTextEditing,
    beginDraftingTextEditing,
    beginInstanceFormulaEditing,
    beginNetLabelEditing,
    cancelNetLabelEditing,
    commitInstancePropertyDraft,
    commitNetLabelScope,
    commitNetLabelEditing,
    commitPendingNetLabelDraft,
    commitTextEditing,
    clearTextEditing,
    deleteTextEditing,
    netLabelPlacement,
    placeNetLabel,
    textEditing,
    updateTextEditing,
    updateNetLabelPlacementText,
    updateNetLabelPlacementPosition,
  } = usePropertiesEditor({
    document,
    resolver,
    selectedRoute,
    selectedRouteNetLabel: selectedRouteNetLabel ?? null,
    selectedRouteNetLabels,
    selectedInstance,
    componentParametersForInstance: propertyParametersForInstance,
    transact,
    setStatus,
    replaceSelectionKind: (kind, ids) => replaceSelectionKind(kind, ids),
    selectOnly: (kind, ids) => selectOnly(kind, ids),
    selectDraftingObject,
    clearSelectionKinds,
    netLabelForRoute,
    netLabelEditsForRoute,
    netLabelScopeEdit,
    netNameEditsForAnnotation,
    instancePropertyEdits,
    referenceLabelVisibilityEdits,
    valueVisibilityEdits,
    isCellPinAnnotation: (annotation) => {
      const anchor = annotation.anchor;
      return (
        document.netlist?.terminals.some(
          (terminal) =>
            (annotation.binding?.kind === "cell-terminal-name" &&
              annotation.binding.terminalId === terminal.id) ||
            (anchor.kind === "object" &&
              terminal.interfaceInstanceIds.includes(anchor.objectId)),
        ) === true
      );
    },
    commitCellPinAnnotation: editCellTerminalAnnotation,
    nextId: (prefix) => {
      uniqueSuffixCounter.current += 1;
      return `${prefix}-${uniqueSuffixCounter.current}`;
    },
  });
  function selectedVisualIds(kind: VisualSelectionKind): readonly string[] {
    switch (kind) {
      case "instance":
        return visualSelection.instanceIds;
      case "route":
        return visualSelection.routeIds;
      case "junction":
        return visualSelection.junctionIds;
      case "annotation":
        return visualSelection.annotationIds;
      case "drafting":
        return visualSelection.draftingIds;
    }
  }

  function openVisualContextMenu(
    kind: VisualSelectionKind,
    objectIds: string | readonly string[],
    clientX: number,
    clientY: number,
  ): void {
    if (
      tool !== "pointer" ||
      getCurrentInteractionState().kind !== "idle" ||
      canvasDragSessionRef.current !== null
    )
      return;
    const ids = typeof objectIds === "string" ? [objectIds] : objectIds;
    if (!ids.every((id) => selectedVisualIds(kind).includes(id))) {
      selectVisualObjects(kind, ids, false);
    }
    setCanvasContextMenu({ x: clientX, y: clientY });
  }

  // Formula capability is owned by the resolved SymbolDefinition, never by a
  // symbol-id allowlist or any electrical/netlist descriptor.
  // A Symbol that hides its label never draws a reference: the label field
  // and the Reference toggle would be edits the drawing cannot show.
  const selectedLabelRenderable = selectedInstance
    ? resolver.resolve(
        selectedInstance.symbolId,
        selectedInstance.symbolVariantId,
      )?.definition.labelVisibility !== "hidden"
    : true;
  const selectedSignalFlowPresentation = selectedInstance
    ? resolver.resolve(
        selectedInstance.symbolId,
        selectedInstance.symbolVariantId,
      )?.definition.formulaPresentation
    : undefined;
  const selectedInstanceLabel = selectedInstance
    ? instanceLabelAnnotationFor(document, selectedInstance.id)
    : undefined;
  const selectedDisplayName =
    selectedInstanceLabel?.kind === "instance-label"
      ? flattenRichText(
          resolveAnnotationText(document, selectedInstanceLabel),
        ).trim() || null
      : null;
  const selectedInstanceValue = selectedInstance
    ? instanceValueAnnotation(document, selectedInstance.id)
    : null;
  const selectedGroupInstances = selectedIds.flatMap((id) => {
    const instance = document.instances.find((item) => item.id === id);
    return instance ? [instance] : [];
  });
  const selectedGroupReferenceVisibility = commonGroupValue(
    selectedIds.map((id) => {
      const label = instanceLabelAnnotationFor(document, id);
      return label !== undefined && label.visible !== false;
    }),
  );
  const selectedGroupValueInstances = selectedGroupInstances.filter(
    (instance) => symbolSupportsValueAnnotation(instance.symbolId),
  );
  const selectedGroupValueVisibility =
    selectedGroupValueInstances.length === 0
      ? null
      : commonGroupValue(
          selectedGroupValueInstances.map((instance) => {
            const value = instanceValueAnnotation(document, instance.id);
            return value !== null && value.visible !== false;
          }),
        );
  const selectedGroupForeground = groupForeground(
    selectedGroupInstances,
    styleProfile.foreground,
  );
  const selectedGroupContext = {
    ...groupParameterContext(
      selectedGroupInstances,
      propertyParametersForInstance,
    ),
    reference: selectedGroupReferenceVisibility,
    value: selectedGroupValueVisibility,
    foreground: selectedGroupForeground,
  };
  const wireUnderSymbolWarnings = useMemo(
    () =>
      deriveWireUnderSymbolWarnings(document, resolver, routeGeometryRecords),
    [document, resolver, routeGeometryRecords],
  );
  const wouldMoveIds = useMemo(() => {
    const ids = new Set(
      planSelectionMove(document, visualSelection).previewObjectIds,
    );
    // Boundary routes stretch rather than translate, but they move all the
    // same — the highlight covers everything a drag would change.
    const closure = deriveRoutingAffectedClosure(document, {
      instanceIds: visualSelection.instanceIds,
      routeIds: visualSelection.routeIds,
      junctionIds: visualSelection.junctionIds,
      annotationIds: visualSelection.annotationIds,
    });
    for (const routeId of closure.boundaryRoutes) ids.add(routeId);
    return ids;
  }, [document, visualSelection]);
  const netLabelTether = useMemo(() => {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === selectedAnnotationId,
    );
    if (!annotation || annotation.kind !== "net-label") return null;
    const anchor = annotation.anchor;
    const record =
      anchor.kind === "route"
        ? routeGeometryRecords.find(
            (candidate) => candidate.route.id === anchor.routeId,
          )
        : undefined;
    const attachment =
      record && anchor.kind === "route"
        ? resolveRouteAttachment(record.geometry, anchor)
        : null;
    const label = annotationAnchor(
      document,
      resolver,
      annotation,
      routeGeometryRecords,
      styleProfile,
    );
    const conductor =
      attachment?.conductorPoint ??
      (annotation.netId
        ? closestNetConductorPoint(
            routeGeometryRecords,
            annotation.netId,
            label,
          )
        : null);
    if (!conductor) return null;
    return {
      label,
      conductor,
      netName: annotation.netId ?? record?.route.netId ?? null,
    };
  }, [
    document,
    selectedAnnotationId,
    routeGeometryRecords,
    resolver,
    styleProfile,
  ]);

  const {
    sourceForTarget,
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
      readCurrentWireSession,
      setTool,
      setWireSource,
      setWirePreview,
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
          : resolveReviewedExternalBinding(
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
    // A device drawn while working in a process is that process's device.
    processModelTarget: (symbolId) => {
      const family = netlistDeviceFamily(symbolId);
      if (family !== "nmos" && family !== "pmos") return undefined;
      return (
        netlistPreferences.preferences.profiles[netlistPreferences.selected]
          .devices[family].target || undefined
      );
    },
    selectOnly,
    cancelAllTransientInteraction,
    cancelCanvasDrag: () => canvasDragSessionRef.current?.cancel(),
    clearTransientCanvasState,
    paintSnapGuides,
    beginVddRailInteraction,
    activateDrawingTool: setTool,
    beginComponentPlacement: (request) => {
      beginComponentPlacement(request);
      seedComponentPreviewFromPointer(request.kind);
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
    sceneSnapTargetIndex,
    transactConnectivity,
    setStatus,
    nextRoutingSuffix,
    ...(documentContactEvidence
      ? { contactEvidence: documentContactEvidence }
      : {}),
  });
  const {
    rotate: rotateSelected,
    mirror: mirrorSelected,
    align: alignSelection,
    alignmentParticipantCount,
  } = createSelectionTransformController({
    document,
    resolver,
    styleProfile,
    routeGeometryRecords,
    annotationGrid,
    selectedInstanceIds: selectedIds,
    selection: visualSelection,
    transact,
    setStatus,
  });

  /** Arm a verb so the next object pointed at is the one acted on. */
  function armVerb(
    verb: "rotate" | "copy" | "move" | "move-detached" | "delete",
  ): void {
    setArmedVerb(verb);
    setStatus(
      verb === "rotate"
        ? "Rotate: click a part to turn it, Escape to stop"
        : verb === "copy"
          ? "Copy: click a part to pick up a copy · Esc cancels"
          : verb === "move"
            ? "Move: click a part to pick it up · Esc cancels"
            : verb === "move-detached"
              ? "Move without wires: click a part to pick it up · Esc cancels"
              : "Delete: click objects to delete them · Esc exits",
    );
  }

  function disarmVerb(): void {
    setArmedVerb(null);
    setStatus("Cancelled");
  }

  /**
   * Apply the armed verb to one part. Returns false when nothing was armed.
   * Rotate and Delete remain armed for the next click; Copy and Move disarm
   * because their own interactions (copy placement, command move) take over
   * and own Esc from here.
   */
  function consumeArmedVerbOnInstance(instanceId: string): boolean {
    if (armedVerb === null) return false;
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return false;
    if (armedVerb === "rotate") {
      const next = (instance.placement.rotation + 90) % 360;
      const applied = transact([
        {
          kind: "rotate_instance",
          instanceId,
          rotation: next as Rotation,
        },
      ]);
      if (applied.ok) {
        setStatus(
          `Rotated ${instanceId} to ${next}° — click another, Escape to stop`,
        );
      }
      return true;
    }
    if (armedVerb === "copy") {
      setArmedVerb(null);
      selectOnly("instance", [instanceId]);
      suppressCommitClickRef.current = true;
      beginCopyPlacementFromSelection([instanceId]);
      return true;
    }
    if (armedVerb === "move" || armedVerb === "move-detached") {
      const detach = armedVerb === "move-detached";
      setArmedVerb(null);
      selectOnly("instance", [instanceId]);
      suppressCommitClickRef.current = true;
      beginKeyboardSelectionMoveFromSelection(
        {
          ...EMPTY_VISUAL_SELECTION,
          instanceIds: [instanceId],
        },
        { detach },
      );
      return true;
    }
    deleteSelectionFromSelection({ instanceIds: [instanceId] });
    setStatus(`Deleted ${instanceId} — click another, Esc exits`);
    return true;
  }

  /** Armed Delete applied to a non-instance object; stays armed. */
  function consumeArmedDeleteOnObject(
    kind: "routeIds" | "junctionIds" | "annotationIds" | "draftingIds",
    id: string,
  ): boolean {
    if (armedVerb !== "delete") return false;
    deleteSelectionFromSelection({ [kind]: [id] });
    setStatus(`Deleted ${id} — click another, Esc exits`);
    return true;
  }
  const { handleDrop, placeAll: placeAllFromTray } =
    createPlacementTrayCommands({
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
    project,
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
    transactCopy: (edits) => {
      const committed = commitStructure("copy-placement", [...edits]);
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
  const editingInstanceFormula =
    textEditingTarget?.owner === "instance-formula"
      ? textEditingTarget.object
      : undefined;
  const editingInstanceFormulaSymbol = editingInstanceFormula
    ? resolver.resolve(editingInstanceFormula.symbolId)
    : undefined;
  const textEditingBounds = editingAnnotation
    ? annotationHitBox(
        document,
        resolver,
        editingAnnotation,
        routeGeometryRecords,
        styleProfile,
      )
    : editingDrafting?.kind === "text"
      ? resolveDraftingObjectGeometry(document, resolver, editingDrafting)
          .bounds
      : editingInstanceFormulaSymbol && editingInstanceFormula
        ? instanceVisibleHitBox(
            editingInstanceFormula,
            editingInstanceFormulaSymbol,
          )
        : null;
  // A Symbol has no lock on its own body text; the other two owners do.
  const textEditingLocked =
    textEditingTarget !== null &&
    textEditingTarget?.owner !== "instance-formula" &&
    Boolean(textEditingTarget?.object.locked);

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
  const wireDraftPreview =
    wireSource && wirePreviewTarget
      ? resolveWireDraftPreview({
          document,
          resolver,
          source: wireSource,
          target: wirePreviewTarget,
          steps: wireDraftSteps,
          routingMode: wireRoutingMode,
          cornerOrder: wireCornerOrder,
          visibleEndpoints,
        })
      : EMPTY_WIRE_DRAFT_PREVIEW;
  const projectInstanceCount = project.documents.reduce(
    (count, candidate) => count + candidate.instances.length,
    0,
  );
  // Fit and auto-fit describe committed content, never a transient move,
  // handle, copy, or waveform preview. The committed formal scene already
  // measured those exact bounds, so keep that single successful derivation
  // instead of rebuilding the complete SVG solely to read its viewBox.
  const contentSceneBounds = committedSceneState.degraded
    ? null
    : committedSceneState.scene.viewBox;
  const zoomPercent = Math.round((DEFAULT_VIEWBOX.width / viewBox.width) * 100);
  const {
    insertConstructionVertex,
    insertArrowWaypoint,
    deleteConstructionVertex,
    setDraftingStyle,
    setDraftingStacking,
    toggleDraftingLock,
    addPlainText,
  } = createDraftingCommands({
    document,
    annotationGrid,
    resolver,
    selection: visualSelection,
    selectedDrafting,
    inspectorSegment: draftingInspectorSegment,
    transact,
    setStatus,
    beginTextPlacement: () =>
      startInsertFromHook({
        kind: "quick",
        request: {
          kind: "drafting-text",
          symbolId: "text",
          symbolName: "Text",
          text: "Design note",
          initialRotation: 0,
          editAfterPlacement: true,
        },
      }),
  });
  const {
    snapPoint: snapDraftingPoint,
    handleCanvasClick: handleDraftingCanvasClick,
    finish: finishDraftingCreate,
    beginPointer: beginDraftingCreatePointer,
  } = createDraftingCreateController({
    document,
    annotationGrid,
    angleMode: drawAngleMode,
    arrowPreset,
    pointer: {
      dragSessionRef: canvasDragSessionRef,
      pointFromClient: (x, y, svg) => pointFromClient(x, y, svg, false),
    },
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
    annotationGrid,
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
    setHandlePreview: setDraftingHandlePreview,
    transact,
    setStatus,
  });
  const { beginDrag: beginAnnotationDrag } = createAnnotationDragController({
    document,
    annotationGrid,
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
    selectAnnotation: (id, additive) =>
      selectVisualObject("annotation", id, additive),
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
      setWirePreview,
      setWireDraftSteps,
      setWireRoutingMode,
      setWireCornerOrder,
      readCurrentWireSession,
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
      sourceForTarget,
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
      selectionPolicy,
    },
    session: {
      getInteractionKind: () => getCurrentInteractionState().kind,
      placementOwnsCanvas: Boolean(
        (pendingSymbolId && pendingComponentPlacement) ||
        vddRailMode ||
        copyPlacement !== null ||
        pendingWaveformPlacement !== null ||
        netLabelPlacement?.phase === "placing",
      ),
      tool,
      cellSymbolLayoutEnabled,
      simulationPickMode,
    },
    actions: {
      beginInstanceMove: beginMoveFromSelection,
      beginVisualSelectionMove: beginVisualSelectionMoveFromSelection,
      beginAnnotationDrag,
      handleRoutePointerDown,
      beginDraftingDrag,
      beginDraftingGroupMove: (event, object, hitTarget) => {
        const groupIds = draftingSelectionIds(object.id);
        if (groupIds.length <= 1) return false;
        selectOnly("drafting", groupIds);
        beginVisualSelectionMoveFromSelection(
          event,
          {
            instanceIds: [],
            routeIds: [],
            junctionIds: [],
            annotationIds: [],
            draftingIds: groupIds,
          },
          hitTarget,
        );
        return true;
      },
      selectEndpoint,
      endpointStatusLabel: (endpoint) => endpointTestId(endpoint.endpoint),
      setStatus,
      suppressNextClick: () => {
        suppressInstanceClick.current = true;
      },
      pickSimulationNet: (kind, id) => {
        const netId =
          kind === "route"
            ? document.routes.find((route) => route.id === id)?.netId
            : kind === "annotation"
              ? document.annotations.find((annotation) => annotation.id === id)
                  ?.netId
              : kind === "junction"
                ? document.junctions.find((junction) => junction.id === id)
                    ?.netId
                : undefined;
        if (netId) toggleSimulationSavedNet(netId);
      },
      consumeArmedVerb: (kind, id) => {
        if (kind === "instance") return consumeArmedVerbOnInstance(id);
        if (kind === "route") return consumeArmedDeleteOnObject("routeIds", id);
        if (kind === "junction") {
          return consumeArmedDeleteOnObject("junctionIds", id);
        }
        if (kind === "annotation") {
          return consumeArmedDeleteOnObject("annotationIds", id);
        }
        if (kind === "drafting") {
          return consumeArmedDeleteOnObject("draftingIds", id);
        }
        return false;
      },
    },
  });
  const {
    fitView,
    panView,
    zoomViewAtCenter,
    handleWheel,
    zoomAtClientPoint,
    beginCanvasGesture,
    continueCanvasGesture,
    finishCanvasGesture,
  } = createCanvasGestureController({
    model: {
      document,
      resolver,
      routeGeometryRecords,
      styleProfile,
      selectionPolicy,
    },
    viewport: {
      defaultViewBox: DEFAULT_VIEWBOX,
      contentBounds: contentSceneBounds,
      getViewBox: cameraRuntime.current,
      setViewBox,
      scheduleViewBox: (next, grid = document.presentation.grid) =>
        cameraRuntime.schedule(next, grid),
      flushViewBox: cameraRuntime.flush,
      measureSurface: cameraRuntime.measureSurface,
      pointFromClient: (clientX, clientY, svg) =>
        pointFromClient(clientX, clientY, svg),
      rawPointFromClient: (clientX, clientY, svg) =>
        pointFromClient(clientX, clientY, svg, false),
      logicalRadiusForPixels,
      wheelBehavior: () => wheelBehaviorRef.current,
    },
    gestureSession: {
      setContextMenuSuppressed: (suppressed) => {
        canvasContextMenuSuppressed.current = suppressed;
        if (suppressed) setCanvasContextMenu(null);
      },
      boxPreview,
      setBoxPreview,
      panPreview,
      setPanPreview,
      getInteractionKind: () => getCurrentInteractionState().kind,
      paintSnapGuides,
      noteCanvasPoint: (_point, rawPoint, svg) => {
        // Preserve precision until the chosen tool applies its own grid.
        lastCanvasPointRef.current = rawPoint;
        if (netLabelPlacement?.phase === "placing") {
          const target = resolveNetLabelPlacementTarget(rawPoint, svg);
          updateNetLabelPlacementPosition(
            target?.labelPosition ?? rawPoint,
            target,
          );
          paintSnapGuides(netLabelSnapGuides(target));
        }
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
      snapPlacementPoint: resolvePendingPlacementPoint,
      setComponentPreviewPoint,
      vddRailMode,
      vddRailStart,
      setVddRailPreviewPoint,
      copyPlacementPending: copyPlacement !== null,
      setCopyPreviewPoint,
      waveformPlacementPending: pendingWaveformPlacement !== null,
      setWaveformPreviewPoint: (point) =>
        setWaveformPlacementPoint({
          x: snapCoordinate(point.x, document.presentation.grid),
          y: snapCoordinate(point.y, document.presentation.grid),
        }),
    },
    drafting: {
      tool,
      draftingSource,
      outlineArrow: arrowPreset.family === "outline",
      snapDraftingPoint,
      setDraftingHover,
      setDraftingSnapPoint,
    },
    wiring: {
      wireActive: wireSource !== null,
      resolveWireCanvasSnap,
      setWirePreview,
      cycleWireCornerShape,
    },
    cellSymbolLayout: {
      activeDragPointerId: cellSymbolLayoutDragPointerId,
      cancelDrag: cancelCellSymbolLayoutDrag,
      completeDrag: completeCellSymbolLayoutDrag,
    },
  });

  // Every opened schematic lands fitted — shelf, gallery, examples,
  // imports, and recoveries alike — exactly as if F were pressed once the
  // new document's content bounds exist. An empty project keeps the
  // default camera.
  const pendingAutoFitRef = useRef(false);
  const autoFitProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoFitProjectRef.current !== projectSessionId) {
      autoFitProjectRef.current = projectSessionId;
      pendingAutoFitRef.current = true;
    }
  }, [projectSessionId]);
  const autoFitBounds = contentSceneBounds;
  const autoFitHasContent = authoredObjectCount(project) > 0;
  useEffect(() => {
    if (!pendingAutoFitRef.current || !autoFitBounds) return;
    // One decision per open, taken the moment the scene bounds exist: a
    // project that arrives with content lands fitted; an empty one keeps
    // the default camera — and the request is spent either way, so the
    // first authored edit never yanks the camera afterwards.
    pendingAutoFitRef.current = false;
    if (!autoFitHasContent) return;
    // Silent: the open's own status ("Opened …", "Restored …") must
    // survive the landing fit.
    fitView({ announce: false });
  }, [autoFitBounds, autoFitHasContent, projectSessionId]);
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
    highlightedNetOrigin,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
    selectedHighlightIsActive,
    closeSearch,
    setSelectionOpen,
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
    setProjectPanel(null);
    setImportReviewOpen(false);
    setSelectionOpen(true);
    // Focus the header, not the first field: Q stays a pure toggle and
    // editing starts only when the user clicks an input.
    deferFocus(() => selectionShelfRef.current);
  }

  function closeProperties(): void {
    exitCellSymbolLayout();
    setSelectionOpen(false);
    setImportReviewOpen(false);
  }

  function showProjectPanel(mode: EditorProjectPanelMode): void {
    exitCellSymbolLayout();
    if (projectPanel === null) {
      propertiesOpenBeforeProjectPanelRef.current = selectionOpen;
    }
    setProjectPanel(mode);
    setSelectionOpen(false);
    setImportReviewOpen(false);
    if (compactLayout) setCompactLibraryPanelOpen(false);
  }

  function closeProjectPanel(): void {
    setProjectPanel(null);
    setSelectionOpen(propertiesOpenBeforeProjectPanelRef.current);
  }

  function toggleProjectPanel(mode: EditorProjectPanelMode): void {
    if (projectPanel === mode) {
      closeProjectPanel();
      return;
    }
    showProjectPanel(mode);
  }

  function selectAllObjects(): void {
    replaceSelection(selectionPolicy.selectAll());
    setSelectedEndpoint(null);
  }

  function applySelectionFilter(nextFilter: SelectionFilter): void {
    const nextPolicy = createSelectionPolicy(document, nextFilter);
    setSelectionFilter(nextFilter);
    replaceSelection(nextPolicy.retainSelection(visualSelection));
    if (
      selectedEndpoint &&
      !nextPolicy.allowsEndpoint(selectedEndpoint.endpoint.kind, "select")
    ) {
      setSelectedEndpoint(null);
    }
    if (!nextPolicy.allowsClass("route", "handle")) {
      setSelectedRouteSegmentIndex(null);
    }
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
  }

  function toggleExamplesPanel(): void {
    toggleExamplesPanelFromShell();
  }

  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (bootTargetHandled.current) return;
    bootTargetHandled.current = true;
    // A safe recovery refresh reloads the same URL: the pending restore owns
    // this boot. Re-running the URL's boot target here would fork the
    // working-copy identity and orphan the snapshot the restore is about to
    // read.
    if (restoreAfterRefresh) return;
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    // A tile on the shelf opens straight into its Project.
    const shelfProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );
    const requestsNewProject =
      new URLSearchParams(window.location.search).get("new") === "1";
    if (initialGalleryEntryId) {
      void openGalleryEntryById(initialGalleryEntryId, false);
      return;
    }
    if (requestsNewProject) {
      replaceActiveProject(preparedInitialProject, DEFAULT_VIEWBOX);
      setStatus("Created a new Project");
      return;
    }
    if (shelfProjectId) {
      setStatus("Opening your Cloud Project…");
      void openCloudProjectById(shelfProjectId);
      return;
    }
    if (exampleId) {
      const exampleProject = createLibraryExampleProject(exampleId);
      const example = libraryProjectExamples.find(
        (candidate) => candidate.id === exampleId,
      );
      if (exampleProject && example) {
        replaceActiveProject(
          prepareNetlistExample(
            exampleProject,
            netlistPreferences.preferences.profiles[
              netlistPreferences.selected
            ],
          ),
          DEFAULT_VIEWBOX,
        );
        setStatus(`Opened example: ${example.name}`);
      }
    }
  }, [initialGalleryEntryId, restoreAfterRefresh]);

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
    setArmedVerb(null);
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
  // A design routinely carries VDDH and VDDL, or VDD1 and VDD2, at once, so
  // VDD artwork keeps its authored supply name in either Cell Pin or Global mode.
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
  const selectedPropertyOnlyTerminal =
    selectedReviewedExternalBinding?.terminals.find(
      (terminal) => terminal.interaction === "property",
    );
  const selectedPropertyOnlyTerminalNet =
    selectedInstance && selectedPropertyOnlyTerminal
      ? document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === selectedInstance.id &&
              terminal.pinName === selectedPropertyOnlyTerminal.pinName,
          ),
        )
      : undefined;

  function openSelectedComponentDefinition(): void {
    if (!selectedInstance) {
      setStatus("Select one component to edit its definition");
      return;
    }
    if (hasHierarchyEnterSelection) {
      enterSelectedHierarchy();
      return;
    }
    const definition = project.componentDefinitions?.find(
      (item) => item.symbol.id === selectedInstance.symbolId,
    );
    if (!definition) {
      setStatus("No component definition is available for this selection");
      return;
    }
    cancelAllTransientInteraction();
    setCanvasContextMenu(null);
    setComponentEditor({
      key: crypto.randomUUID(),
      mode: "instance",
      definition: structuredClone(definition),
      target: {
        projectSessionId,
        documentId: document.id,
        instance: structuredClone(selectedInstance),
      },
    });
  }

  function insertSharedComponent(entry: SharedComponent): void {
    try {
      editorDocumentController.offerComponentDefinition(entry.definition);
      synchronizeExternalCommit();
      editorCommands.execute({
        id: "insert.start",
        launch: { kind: "quick", request: sharedComponentInsertRequest(entry) },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function componentEditPlan(definition: ComponentDefinition) {
    const target = componentEditor?.target;
    const live = definitionProjectRef.current;
    if (!target || live.projectSessionId !== target.projectSessionId)
      return {
        ok: false as const,
        message: "The Project changed. Reopen the component before applying.",
      };
    return planComponentDefinitionEdit(
      live.project,
      target.documentId,
      target.instance.id,
      target.instance,
      definition,
    );
  }

  function commitProjectName(): void {
    setProjectNameDraft(null);
    renameProject(projectNameDraft);
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
              ? arrowPreset.family === "outline"
                ? "Outline arrow: click to place, or drag to size (Esc cancels)"
                : "Arrow: click the start point"
              : nextTool === "construction-line"
                ? "Construction line: click the start point"
                : "Pointer ready",
    );
  }

  function rotatePendingCopy(delta: 45 | -45 | 90 | -90): void {
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

  function resolvePendingPlacementPoint(
    point: Point,
    svg: SVGSVGElement,
  ): { point: Point; guides: readonly SnapGuideLine[] } {
    if (copyPlacement) {
      return snapPendingCopyPlacement({
        movingAnchors: copyPreviewState.anchors,
        sceneSnapTargetIndex,
        anchor: copyPlacement.anchor,
        position: point,
        grid: document.presentation.grid,
        tolerance: logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
      });
    }
    const pitch =
      pendingComponentPlacement?.kind === "drafting-text"
        ? annotationGrid
        : document.presentation.grid;
    if (
      !pendingSymbolId ||
      (pendingComponentPlacement?.kind !== "symbol" &&
        pendingComponentPlacement?.kind !== "cell-pin")
    ) {
      return {
        point: {
          x: snapCoordinate(point.x, pitch),
          y: snapCoordinate(point.y, pitch),
        },
        guides: [],
      };
    }
    const symbolVariantId =
      pendingComponentPlacement.kind === "symbol"
        ? defaultRazaviSymbolVariantId(pendingSymbolId)
        : undefined;
    const snapped = snapPendingComponentPlacement({
      document,
      resolver,
      routeGeometryRecords,
      sceneSnapTargetIndex,
      symbolId: pendingSymbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      position: point,
      rotation: componentPlacementRotation,
      mirror: componentPlacementMirror,
      tolerance: logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
    });
    return { point: snapped.position, guides: snapped.snap.guides };
  }

  useEffect(() => {
    const svg = snapGuideLayerRef.current?.ownerSVGElement;
    const point = lastCanvasPointRef.current;
    if (!copyPlacement?.previewPoint || !svg || !point) return;
    // Rotation, reflection and repeated stamping change the geometry under a
    // stationary pointer too. Keep the ghost and its guides in agreement.
    const snapped = resolvePendingPlacementPoint(point, svg);
    setCopyPreviewPoint(snapped.point);
    paintSnapGuides(snapped.guides);
  }, [copyPreviewState, sceneSnapTargetIndex]);

  function paintSnapGuides(guides: readonly SnapGuideLine[]): void {
    replaceCanvasSnapGuides(snapGuideLayerRef.current, guides);
  }

  function resolveNetLabelPlacementTarget(
    point: Point,
    svg?: SVGSVGElement,
    preferredRouteId?: string,
  ): NetLabelPlacementTarget | null {
    return netLabelPlacementTargetAtPoint(
      routeGeometryRecords,
      point,
      svg ? logicalRadiusForPixels(svg, NET_LABEL_SNAP_CAPTURE_RADIUS_PX) : 0,
      preferredRouteId,
    );
  }

  function netLabelSnapGuides(
    target: NetLabelPlacementTarget | null,
  ): readonly SnapGuideLine[] {
    if (!target) return [];
    const horizontalOffset =
      Math.abs(target.labelPosition.x - target.conductorPoint.x) >=
      Math.abs(target.labelPosition.y - target.conductorPoint.y);
    return [
      horizontalOffset
        ? {
            axis: "y",
            coordinate: target.conductorPoint.y,
            from: Math.min(target.labelPosition.x, target.conductorPoint.x),
            to: Math.max(target.labelPosition.x, target.conductorPoint.x),
            kind: "route",
          }
        : {
            axis: "x",
            coordinate: target.conductorPoint.x,
            from: Math.min(target.labelPosition.y, target.conductorPoint.y),
            to: Math.max(target.labelPosition.y, target.conductorPoint.y),
            kind: "route",
          },
    ];
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

  const visualClipboard = useVisualClipboard({
    document,
    selection: visualSelection,
    resolver,
    report: setStatus,
    onChunkLoadFailure: setChunkLoadFailure,
  });
  // `canBeginKeyboardSelectionMove` runs `planSelectionMove`, a full move
  // plan, and the command router asks for enablement on every render — from
  // two call sites, editor-command.ts:188 and :307. The plan reads exactly
  // these two inputs, so a re-render that changes neither does not need to
  // re-plan the whole selection. `canBeginKeyboardSelectionMove` itself is a
  // fresh closure every render and so cannot be the dependency.
  const hasMoveSelection = useMemo(
    () => canBeginKeyboardSelectionMove(),
    [document, visualSelection],
  );
  const editorCommands = createEditorCommandRouter({
    getContext: () => ({
      interactionMode: getCurrentInteractionState().kind,
      activeTool: tool,
      canCopyVisualSelection:
        hasVisualSelection(visualSelection) && !visualClipboard.busy,
      hasDeletableSelection:
        hasVisualSelection(visualSelection) || selectedEndpoint !== null,
      hasMoveSelection,
      hasAlignableSelection: alignmentParticipantCount >= 2,
      hasRotatableSelection,
      hasMirrorableSelection,
      canTransformMove: canTransformCommandMove(),
      hasInspectableSelection,
      propertiesOpen: selectionOpen,
      canUndo,
      canRedo,
      canvasDragActive: canvasDragSessionRef.current !== null,
      hasClearableDraftingSelection:
        selectedDrafting?.kind === "arrow" ||
        selectedDrafting?.kind === "construction-line" ||
        selectedDrafting?.kind === "rectangle" ||
        selectedDrafting?.kind === "circle",
      hasActiveNetHighlight: highlightedNetOrigin !== null,
      hasArmedVerb: armedVerb !== null,
    }),
    operations: {
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
      clearNetHighlight: () => {
        setHighlightedNetOrigin(null);
        setStatus("Cleared Net highlight");
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
      // Verb keys with nothing to act on arm the verb instead (Cadence
      // style: command first, then click the target).
      deleteSelection: () => {
        if (hasVisualSelection(visualSelection) || selectedEndpoint !== null) {
          deleteSelectionFromSelection();
          return;
        }
        armVerb("delete");
      },
      beginCopy: () => {
        if (hasVisualSelection(visualSelection)) {
          beginCopyPlacementFromSelection();
          return;
        }
        armVerb("copy");
      },
      copyVisualSelection: visualClipboard.copy,
      openSelectionFilter: () => {
        closeSearch();
        setSelectionFilterOpen(true);
      },
      openSearch: () => {
        setSelectionFilterOpen(false);
        setSearchOpen(true);
      },
      beginMove: (detach) => {
        if (canBeginKeyboardSelectionMove()) {
          beginKeyboardSelectionMoveFromSelection(undefined, { detach });
          return;
        }
        armVerb(detach ? "move-detached" : "move");
      },
      alignSelection,
      rotatePlacement: rotatePendingComponentFromHook,
      rotateCopy: rotatePendingCopy,
      rotateMove: rotateCommandMoveFromSelection,
      rotateSelection: rotateSelected,
      armRotate: () => armVerb("rotate"),
      disarmVerb,
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
      panView,
      fitView,
      report: setStatus,
    },
  });
  const { exportSvg, exportDesignNetlist, exportRaster, importSpiceFiles } =
    createEditorFileCommands({
      project,
      document,
      resolver,
      defaultViewBox: DEFAULT_VIEWBOX,
      // Asked at export time, which is one of the moments an
      // electrical verdict belongs to.
      electricalWarningsPresent: () =>
        requestElectricalDiagnostics().length > 0,
      netlistPortCase: netlistPreferences.portCase,
      netlistRootDocumentId,
      netlistConfigurationError: netlistPreferences.error,
      guardDirtyReplacement,
      replaceActiveProject,
      showNetlist: (format, namingProfile) => {
        netlistPreferences.selectFormat(format);
        setNetlistNamingProfile(namingProfile);
        showProjectPanel("netlist");
      },
      setImportReport,
      setImportReviewOpen,
      setSelectionOpen,
      setStatus,
      onChunkLoadFailure: setChunkLoadFailure,
    });

  // Single entry point for selecting a drafting object. Editing is opened
  // separately (double-click/Enter) so selection and text caret ownership do
  // not fight drag gestures.
  function draftingSelectionIds(id: string): string[] {
    const group = document.layoutGroups.find((candidate) =>
      candidate.objectIds.includes(id),
    );
    if (!group) return [id];
    const draftingIds = new Set(
      (document.drafting?.objects ?? []).map((object) => object.id),
    );
    return group.objectIds.filter((objectId) => draftingIds.has(objectId));
  }

  function selectDraftingObject(id: string, additive = false): void {
    selectVisualObjects("drafting", draftingSelectionIds(id), additive);
    setDraftingInspectorSegment(null);
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
      if (componentEditor) return;
      if (userComponentsOpen) {
        if (event.key === "Escape") setUserComponentsOpen(false);
        return;
      }
      // The source workbench owns its keyboard scope, including portalled menus.
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".simulation-code-workspace, [data-workspace-interaction]",
        )
      )
        return;
      // The interface confirmation owns keys even though this router captures
      // at window level before the modal's React handlers.
      if (interfaceConfirmation) return;
      if (
        event.target instanceof Element &&
        event.target.closest(".cell-parameter-popover")
      )
        return;
      // File flyout arrows navigate the focused menu, never pan the canvas.
      if (
        event.target instanceof Element &&
        event.target.closest(".export-submenu") &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      if (event.key === "Escape" && netLabelPlacement) {
        event.preventDefault();
        cancelNetLabelEditing();
        paintSnapGuides([]);
        return;
      }
      if (event.key === "Escape" && simulationPickActive) {
        event.preventDefault();
        setSimulationPickMode(null);
        return;
      }
      if (event.key === "Escape" && pendingWaveformPlacement) {
        event.preventDefault();
        setPendingWaveformPlacement(null);
        setWaveformPlacementPoint(null);
        setStatus("Waveform placement cancelled");
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "Escape" && selectionFilterOpen) {
        event.preventDefault();
        setSelectionFilterOpen(false);
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
        // annotation, matching the Apply button. Explicit cancellation stays
        // available through the editor's Cancel action.
        commitTextEditing();
        return;
      }
      if (
        event.key === "Escape" &&
        isTypingTarget(event.target) &&
        event.target instanceof Element &&
        event.target.closest(".selection-dock") !== null
      ) {
        // JSON properties already commit live. Do not replay the legacy form
        // draft over them when leaving the editor (or discard incomplete JSON).
        // Other property forms retain their explicit Escape commit behavior.
        event.preventDefault();
        if (!event.target.closest(".component-property-code-editor")) {
          commitInstancePropertyDraft();
          commitPendingNetLabelDraft();
        }
        if (event.target instanceof HTMLElement) event.target.blur();
        return;
      }
      const currentInteraction = getCurrentInteractionState();
      const shortcut = resolveEditorShortcut(event, {
        isTyping: isTypingTarget(event.target),
        hasUnsavedWork: hasUnsafeWork(),
        interactionMode: currentInteraction.kind,
        canRotate: editorCommands.state({ id: "transform.rotate" }).enabled,
        canMirror: editorCommands.state({
          id: "transform.mirror",
          direction: "left-right",
        }).enabled,
        hasDraftingSelection: Boolean(selectedDrafting),
        hasInspectableSelection,
        hasHighlightableNet: selectedHighlightNetId !== null,
        hasActiveNetHighlight: highlightedNetOrigin !== null,
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
        hasDefinitionSelection: Boolean(
          selectedInstance &&
          !resolver.resolve(selectedInstance.symbolId)?.definition
            .hierarchicalBlock,
        ),
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
          void saveProjectToCloud();
          return;
        case "open":
          projectInputRef.current?.click();
          return;
        case "edit-net-label":
          activateTool("pointer");
          {
            const pointer = lastCanvasPointRef.current;
            const position = pointer
              ? {
                  x: snapCoordinate(pointer.x, document.presentation.grid),
                  y: snapCoordinate(pointer.y, document.presentation.grid),
                }
              : {
                  x: viewBox.x + viewBox.width / 2,
                  y: viewBox.y + viewBox.height / 2,
                };
            beginNetLabelEditing(
              position,
              selectedRoute
                ? resolveNetLabelPlacementTarget(
                    position,
                    undefined,
                    selectedRoute.id,
                  )
                : null,
            );
          }
          return;
        case "toggle-display-settings":
          activateTool("pointer");
          setDocumentSettingsOpen((open) => {
            const next = !open;
            setSelectionOpen(next || hasInspectableSelection);
            return next;
          });
          return;
        case "toggle-net-highlight":
          toggleHighlightedNet();
          return;
        case "toggle-panel":
          if (shortcut.panel === "gallery") {
            toggleExamplesPanel();
          } else if (shortcut.panel === "library") {
            toggleLibraryPanel();
          } else if (shortcut.panel === "netlist") {
            toggleProjectPanel("netlist");
          }
          return;
        case "enter-hierarchy":
          enterSelectedHierarchy();
          return;
        case "edit-component-definition":
          openSelectedComponentDefinition();
          return;
        case "return-to-parent":
          returnToParentDocument();
          return;
        case "hierarchy-selection-required":
          setStatus("Select one component to edit its definition");
          return;
        case "step-drafting-style": {
          if (!selectedDrafting) return;
          const scale = selectedDrafting.styleOverride?.strokeScale ?? 1;
          setDraftingStyle({
            strokeScale: stepBoundedScale(
              scale,
              [0.75, 1, 1.5, 2] as const,
              shortcut.increase,
            ),
          });
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

  const beginWaveformPlacement = (layout: TimingWaveformLayout): void => {
    const objects = waveformDraftingObjects(
      layout,
      { x: 0, y: 0 },
      (prefix) => {
        uniqueSuffixCounter.current += 1;
        return `${prefix}-${uniqueSuffixCounter.current}`;
      },
    );
    uniqueSuffixCounter.current += 1;
    const groupId = `waveform-group-${uniqueSuffixCounter.current}`;
    setSimulationPickMode(null);
    setPendingWaveformPlacement({
      groupId,
      objects,
      traceCount: layout.rows.length,
    });
    const pointer = lastCanvasPointRef.current;
    setWaveformPlacementPoint(
      pointer
        ? {
            x: snapCoordinate(pointer.x, document.presentation.grid),
            y: snapCoordinate(pointer.y, document.presentation.grid),
          }
        : null,
    );
    setStatus("Place waveform: move over the canvas and click · Esc cancels");
  };

  const commitWaveformPlacement = (point: Point): void => {
    if (!pendingWaveformPlacement) return;
    const snapped = {
      x: snapCoordinate(point.x, document.presentation.grid),
      y: snapCoordinate(point.y, document.presentation.grid),
    };
    const objects = pendingWaveformPlacement.objects.map((object) =>
      translateDraftingObject(object, snapped, document.presentation.grid),
    );
    const placed = transact([
      ...objects.map((object) => ({
        kind: "upsert_drafting_object" as const,
        object,
      })),
      {
        kind: "set_layout_group" as const,
        group: {
          id: pendingWaveformPlacement.groupId,
          kind: "custom" as const,
          objectIds: objects.map((object) => object.id),
          locked: false,
        },
      },
    ]);
    if (!placed.ok) return;
    selectOnly(
      "drafting",
      objects.map((object) => object.id),
    );
    setPendingWaveformPlacement(null);
    setWaveformPlacementPoint(null);
    setStatus(
      `Placed a grouped timing snapshot with ${pendingWaveformPlacement.traceCount} trace${pendingWaveformPlacement.traceCount === 1 ? "" : "s"}`,
    );
  };

  const beginWaveformGroupScale = (
    event: ReactPointerEvent<SVGElement>,
    group: LayoutGroup,
    bounds: Rect,
  ): void => {
    if (event.button !== 0 || group.locked) return;
    event.preventDefault();
    event.stopPropagation();
    canvasDragSessionRef.current?.cancel();
    const target = event.currentTarget;
    const svg = target.ownerSVGElement!;
    const pivot = { x: bounds.x, y: bounds.y };
    const originalRadius = Math.max(1, Math.hypot(bounds.width, bounds.height));
    const scaleRange = draftingGroupScaleRange(document, group.objectIds);
    if (!scaleRange) {
      setStatus("This waveform group cannot scale");
      return;
    }
    const factorAt = (client: Point): number => {
      const point = pointFromClient(client.x, client.y, svg, false);
      return Math.min(
        scaleRange.max,
        Math.max(
          scaleRange.min,
          Math.hypot(point.x - pivot.x, point.y - pivot.y) / originalRadius,
        ),
      );
    };
    const visual = startCanvasDragVisual(svg, group.objectIds);
    canvasDragSessionRef.current = startCanvasDragSession({
      target,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => visual.scale(pivot, factorAt(client)),
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual.restore();
        if (!dragged) return;
        const factor = factorAt(client);
        const objects = scaleDraftingGroup(
          document,
          group.objectIds,
          pivot,
          factor,
        );
        if (!objects) {
          setStatus("This waveform group contains an object that cannot scale");
          return;
        }
        if (
          transact(
            objects.map((object) => ({
              kind: "upsert_drafting_object" as const,
              object,
            })),
          ).ok
        ) {
          setStatus(`Scaled waveform to ${Math.round(factor * 100)}%`);
        }
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual.restore();
      },
    });
  };

  const canvasEventHandlers = createEditorCanvasEventHandlers({
    model: { tool, document, resolver, selectionPolicy },
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
      pressActsOnSelection: (target) => {
        const hitElement = target.closest("[data-canvas-hit-kind]");
        const kind = hitElement?.getAttribute("data-canvas-hit-kind");
        const id = hitElement?.getAttribute("data-canvas-hit-id");
        if (!kind || !id) return false;
        if (kind === "drafting") {
          return visualSelection.draftingIds.includes(id);
        }
        if (
          kind === "instance" ||
          kind === "instance-label" ||
          kind === "annotation" ||
          kind === "route" ||
          kind === "junction"
        ) {
          return compositeSelectionOwnsHit(kind, id);
        }
        return false;
      },
      handleCanvasHitPointerDown,
      openContextMenu: (target, clientX, clientY) => {
        if (
          canvasContextMenuSuppressed.current ||
          canvasDragSessionRef.current !== null ||
          simulationPickActive ||
          target.closest('[data-testid="canvas-text-editor"]')
        )
          return;
        const hit = target.closest("[data-canvas-hit-kind]");
        const kind = hit?.getAttribute("data-canvas-hit-kind");
        const id = hit?.getAttribute("data-canvas-hit-id");
        if (
          kind &&
          id &&
          (kind === "route" ||
            kind === "drafting" ||
            kind === "junction" ||
            kind === "instance" ||
            kind === "annotation") &&
          !selectionPolicy.allowsCanvasHit({ kind, id }, "context-menu")
        ) {
          if (hasVisualSelection(visualSelection)) {
            setCanvasContextMenu({ x: clientX, y: clientY });
          }
          return;
        }
        if (
          id &&
          (kind === "route" ||
            kind === "drafting" ||
            kind === "junction" ||
            kind === "instance" ||
            kind === "annotation")
        ) {
          openVisualContextMenu(kind, id, clientX, clientY);
        } else if (hasVisualSelection(visualSelection)) {
          setCanvasContextMenu({ x: clientX, y: clientY });
        }
      },
    },
    placement: {
      pendingSymbolId,
      pendingComponentPlacement: Boolean(pendingComponentPlacement),
      vddRailMode,
      waveformPlacementActive: pendingWaveformPlacement !== null,
      snapPlacementPoint: (point, svg) =>
        resolvePendingPlacementPoint(point, svg).point,
      commitCopyPlacement: commitCopyPlacementFromSelection,
      commitPendingPlacement: commitPendingPlacementAtFromHook,
      commitWaveformPlacement,
      clearComponentPreview: () => setComponentPreviewPoint(null),
      clearVddRailPreview: () => setVddRailPreviewPoint(null),
      clearCopyPreview: () => {
        setCopyPreviewPoint(null);
        paintSnapGuides([]);
      },
      clearWaveformPreview: () => setWaveformPlacementPoint(null),
    },
    gesture: {
      begin: beginCanvasGesture,
      continue: continueCanvasGesture,
      finish: finishCanvasGesture,
      cancelDrag: () => canvasDragSessionRef.current?.cancel(),
      onDrop: handleDrop,
    },
    drafting: {
      selected: selectedDrafting,
      sourceActive: draftingSource !== null,
      beginCreatePointer: beginDraftingCreatePointer,
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
        setWirePreview(null);
        setWireDraftSteps([]);
        setTool("pointer");
        setBulkDrawInstanceId(null);
        setStatus("Wire cancelled");
      },
    },
    netLabelPlacement: {
      active: netLabelPlacement?.phase === "placing",
      placeAt: (position, svg) => {
        const target = resolveNetLabelPlacementTarget(position, svg);
        placeNetLabel(target);
        if (target) paintSnapGuides([]);
      },
      clearHover: () => {
        if (netLabelPlacement?.phase === "placing") {
          updateNetLabelPlacementPosition(netLabelPlacement.position, null);
        }
        paintSnapGuides([]);
      },
    },
    report: setStatus,
    consumePickupClick: () => {
      if (!suppressCommitClickRef.current) return false;
      suppressCommitClickRef.current = false;
      return true;
    },
  });

  const openAgentConnection = () => {
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

  return (
    <main className="app-shell">
      {parameterBinding &&
      selectionOpen &&
      selectedInstance?.id === parameterBinding.instanceId &&
      document.id === parameterBinding.cell.id ? (
        <CellParameterDialog
          anchor={parameterBinding.anchor}
          cell={parameterBinding.cell}
          field={parameterBinding.field}
          value={parameterBinding.value}
          onCancel={() => setParameterBinding(null)}
          onApply={(name, defaultValue) => {
            if (project !== parameterBinding.snapshot)
              return {
                ok: false,
                message:
                  "Project changed. Close this dialog and select the field again.",
              };
            try {
              const edits = planBindCellParameter(
                project,
                parameterBinding.cell.id,
                parameterBinding.instanceId,
                parameterBinding.field,
                name,
                defaultValue,
              );
              const ok = commitStructure("bind-cell-parameter", edits);
              if (ok) {
                setParameterBinding(null);
                setStatus(`Using Cell parameter ${name}`);
              }
              return {
                ok,
                ...(!ok
                  ? {
                      message: "Could not bind the Cell parameter; see status.",
                    }
                  : {}),
              };
            } catch (error) {
              return {
                ok: false,
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not bind Cell parameter",
              };
            }
          }}
        />
      ) : null}
      {interfaceConfirmation ? (
        <CellInterfaceConfirmationDialog
          request={interfaceConfirmation.request}
          onCancel={() => setInterfaceConfirmation(null)}
          onConfirm={() => {
            setInterfaceConfirmation(null);
            try {
              applyConfirmedCellInterfaceEdit(
                interfaceConfirmation.request,
                interfaceConfirmation.snapshot,
                project,
              );
            } catch (error) {
              setStatus(
                error instanceof Error
                  ? error.message
                  : "Could not update Cell interface",
              );
            }
          }}
        />
      ) : null}
      {renderCrashRequested() ? <RenderCrashProbe /> : null}
      <EditorAppChrome
        {...(publicSimulationUiEnabled
          ? { simulationAction: openAnalogSimulation }
          : {})}
        simulationState={analogSimulationState}
        releaseChannel={releaseChannel}
        projectName={project.name}
        galleryEntryMetadata={galleryEntryContext}
        projectSchemaVersion={project.schemaVersion}
        projectNameDraft={projectNameDraft}
        hasUnsavedWork={isDirtyWork()}
        documentName={document.name}
        onProjectNameDraftChange={setProjectNameDraft}
        onProjectNameCommit={commitProjectName}
        onProjectNameCancel={() => setProjectNameDraft(null)}
        onOpenGallery={() => {
          void guardDirtyReplacement("Go to Gallery", async () => {
            const snapshot = await captureAuthoredProject();
            if (!snapshot) return;
            stageRecovery(snapshot, {
              unsavedAtSnapshot: isDirtyWork() || snapshot !== project,
              cloudBinding,
            });
            await flushRecovery();
            allowNextBrowserUnload();
            window.location.assign("/");
          });
        }}
        fileCommands={{
          projectStoreLabel: projectStore.plural,
          projectStoreItemLabel: projectStore.singular,
          cloudProjects,
          activeCloudProjectId: cloudBinding?.id ?? null,
          canRevert: savedProjectBaseline !== null && isDirtyWork(),
          hasRecoverySessions: recoverySessions.some(
            (session) =>
              session.latest?.unsavedAtSnapshot === true ||
              (session.latest !== null && session.latest.review !== "valid"),
          ),
          checkAndSave: {
            enabled: !saveBusy && !projectCheck.busy,
            execute: () => void projectCheck.checkAndSave(),
          },
          projectInputRef,
          onNewProject: createNewProject,
          onSave: () => void saveProjectToCloud(),
          onRefreshCloudProjects: () => void reloadCloudProjects(),
          onOpenCloudProject: (summary) =>
            void openCloudProjectById(summary.id),
          onDeleteCloudProject: (summary) => {
            if (
              !window.confirm(
                `Delete ${projectStore.singular} "${summary.name}"?`,
              )
            ) {
              return;
            }
            void deleteCloudProject(summary.id).then((outcome) => {
              if (outcome.status === "deleted") {
                cloudListMutationRef.current += 1;
                setCloudProjects(outcome.projects);
                setStatus(`Deleted ${projectStore.singular} ${summary.name}`);
                return;
              }
              setStatus(
                `Could not delete ${projectStore.singular} (${outcome.message})`,
              );
            });
          },
          onImportProject: (file) => void openProjectFile(file),
          onImportSpice: (files, namingProfile) =>
            void importSpiceFiles(files, namingProfile),
          onExportProject: exportProjectFile,
          onExportSvg: exportSvg,
          onExportRaster: (format) => void exportRaster(format),
          onRevert: revertToSavedProjectBaseline,
          onOpenRecovery: openRecoveryDialog,
        }}
        searchOpen={searchOpen}
        selectionFilterOpen={selectionFilterOpen}
        onManageCells={() => setCellManagerOpen(true)}
        userComponentsOpen={userComponentsOpen}
        onOpenUserComponents={() => {
          cancelAllTransientInteraction();
          setUserComponentsOpen(true);
        }}
        onInsertComponent={() =>
          editorCommands.execute({
            id: "insert.start",
            launch: fullInsertLaunch(),
          })
        }
        placeProjectCell={{
          enabled: cellInsertCandidates.length > 0,
          execute: placeCellInstance,
        }}
        onOpenSelectionFilter={() =>
          editorCommands.execute({ id: "selection.filter.open" })
        }
        onOpenSearch={() => editorCommands.execute({ id: "search.open" })}
        deleteSelection={{
          enabled:
            hasVisualSelection(visualSelection) || selectedEndpoint !== null,
          execute: () => editorCommands.execute({ id: "selection.delete" }),
        }}
        copySelectionImages={(["png", "svg"] as const).map((format) => ({
          label: `Copy selection as ${format.toUpperCase()}`,
          enabled: editorCommands.state({
            id: "selection.copy-image",
            format,
          }).enabled,
          execute: () =>
            editorCommands.execute({
              id: "selection.copy-image",
              format,
            }),
        }))}
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
        alignmentActions={
          alignmentParticipantCount >= 2
            ? EDGE_ALIGNMENT_MODES.map(({ mode, label }) => {
                const state = editorCommands.state({
                  id: "selection.align",
                  mode,
                });
                return {
                  mode,
                  label,
                  enabled: state.enabled,
                  execute: () =>
                    editorCommands.execute({ id: "selection.align", mode }),
                };
              })
            : []
        }
        instanceCodeOpen={projectPanel === "instances"}
        netlistPreflightOpen={netlistPreflightOpen}
        onOpenInstanceCode={() => {
          toggleProjectPanel("instances");
        }}
        netlistFormat={netlistPreferences.format}
        onOpenNetlistConfiguration={() => {
          toggleProjectPanel("netlist-configuration");
        }}
        onOpenNetlistPreflight={() => setNetlistPreflightOpen(true)}
        onExportNetlist={exportDesignNetlist}
        agentAction={
          publicAgentUiEnabled
            ? {
                label:
                  agentSession.status === "idle"
                    ? "Connect Agent"
                    : "Manage Agent",
                execute: openAgentConnection,
              }
            : null
        }
        publishGalleryOpen={publishGalleryOpen}
        onPublishGallery={() => {
          // The preview reads the gallery and never writes it (Deployment rationale);
          // saying so here beats a sign-in dialog with nowhere to sign in.
          if (releaseChannel === "preview") {
            setStatus(
              "Preview builds cannot publish to the gallery; publish from the production site.",
            );
            return;
          }
          setPublishGalleryOpen(true);
        }}
        drawingToolbar={{
          leftPanelMode,
          libraryPanelOpen: visibleLibraryPanelOpen,
          projectPanel:
            projectPanel === "project-code"
              ? "project-code"
              : projectPanel
                ? "netlist"
                : null,
          leftPanelsDisabled: false,
          styleProfileId: document.presentation.styleProfileId,
          onStartInsert: (launch) =>
            editorCommands.execute({ id: "insert.start", launch }),
          tool,
          documentSettingsOpen,
          undo: {
            enabled: editorCommands.state({ id: "history.undo" }).enabled,
            execute: () => editorCommands.execute({ id: "history.undo" }),
          },
          redo: {
            enabled: editorCommands.state({ id: "history.redo" }).enabled,
            execute: () => editorCommands.execute({ id: "history.redo" }),
          },
          onToggleExamples: toggleExamplesPanel,
          onToggleLibrary: toggleLibraryPanel,
          onToggleNetlist: () => toggleProjectPanel("netlist"),
          onToggleProjectCode: () => toggleProjectPanel("project-code"),
          onActivateTool: (nextTool) =>
            editorCommands.execute({
              id: "tool.activate",
              tool: nextTool,
            }),
          onAddText: () => editorCommands.execute({ id: "drafting.add-text" }),
          onOpenDocumentSettings: () => {
            setDocumentSettingsOpen((open) => !open);
            setProjectPanel(null);
            setSelectionOpen(true);
          },
          ...(timingUiEnabled
            ? {
                simulation: {
                  open: simulationWindowOpen,
                  onToggle: () => {
                    setSimulationWindowOpen((open) => {
                      if (open) setSimulationPickMode(null);
                      return !open;
                    });
                  },
                },
              }
            : {}),
        }}
        hierarchyToolbar={{
          documents: project.documents,
          activeDocumentId: document.id,
          topDocumentId: project.topDocumentId,
          navigationDepth: documentStack.length,
          canEnter: hasHierarchyEnterSelection,
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
            diagnosticCheckStatus: projectCheck.status,
            visualDiagnosticCount: visualDiagnosticSummary.observations.length,
            blockingDiagnosticCount: visualDiagnosticSummary.blockingCount,
          },
        }}
      />
      <EditorDialogLayer
        chunkLoadFailure={
          chunkLoadFailure === null
            ? null
            : {
                feature: chunkLoadFailure,
                onDismiss: () => setChunkLoadFailure(null),
              }
        }
        recoveryFailure={
          (recoveryState === "quota-exceeded" ||
            recoveryState === "unavailable" ||
            recoveryState === "failed") &&
          isDirtyWork() &&
          !recoveryFailureDismissed
            ? {
                state: recoveryState,
                onDownload: downloadCurrentProjectBackup,
                onDismiss: () => setRecoveryFailureDismissed(true),
              }
            : null
        }
        recoveryAvailable={
          startupRecovery?.latest
            ? {
                projectName: startupRecovery.projectName,
                updatedAt: startupRecovery.latest.updatedAt,
                onRestore: () => {
                  startupCloudRestoreAttemptedRef.current = true;
                  dismissStartupRecovery();
                  restoreRecoverySession(
                    startupRecovery.workingCopyId,
                    "latest",
                  );
                },
                onDownload: () =>
                  downloadRecoveryBackup(
                    startupRecovery.workingCopyId,
                    "latest",
                  ),
                onDismiss: dismissStartupRecovery,
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
                cloudProjectLimit: CLOUD_PROJECT_LIMIT,
                saving: replaceGuardSaving,
                onCancel: cancelReplaceGuard,
                onSaveAndContinue: saveAndContinueReplaceGuard,
                onDiscard: confirmReplaceGuard,
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
        cellManager={
          cellManagerOpen
            ? {
                open: cellManagerOpen,
                cells: cellManagerEntries,
                project,
                hierarchyCalls: projectConnectivityIndex.hierarchy.calls,
                onOpenOccurrence: (documentId, hierarchyPath) => {
                  navigateToLocator(
                    {
                      documentId,
                      hierarchyPath: [...hierarchyPath],
                      kind: "document",
                      objectId: documentId,
                    },
                    "Opened Cell occurrence",
                  );
                  setCellManagerOpen(false);
                },
                activeDocumentId: document.id,
                onClose: () => setCellManagerOpen(false),
                onCreate: (name) => {
                  createCell(name);
                  setCellManagerOpen(false);
                },
                onOpen: (documentId) => {
                  setCellManagerOpen(false);
                  setDocumentStack([]);
                  switchDocument(documentId);
                },
                onRename: renameCell,
                onReorder: (documentIds, topDocumentId) => {
                  commitStructure("reorder-cells", [
                    { kind: "reorder_documents", documentIds },
                    { kind: "set_top_document", documentId: topDocumentId },
                  ]);
                },
                onDelete: (documentId) => {
                  if (deleteCell(documentId)) {
                    setCellManagerOpen(false);
                  }
                },
                onJumpToCaller: jumpToCaller,
                onSetPortDirection: (documentId, portId, direction) =>
                  updateCellPortDirection(portId, direction, documentId),
                onMovePort: (documentId, portId, delta) =>
                  moveCellPort(portId, delta, documentId),
                onEditParameter: (documentId, name, change) =>
                  editCellParameter(name, change, documentId),
                externalDefinitions: project.externalSubcircuitDefinitions,
                onSetExternalDefinition: setExternalSubcircuitDefinition,
                onRemoveExternalDefinition: removeExternalSubcircuitDefinition,
                onPlaceExternal: (definitionId) => {
                  const candidate = externalSubcircuitInsertCandidates.find(
                    (item) => item.definitionId === definitionId,
                  );
                  if (!candidate) {
                    setStatus(
                      "The selected external master has no resolved symbol",
                    );
                    return;
                  }
                  setCellManagerOpen(false);
                  editorCommands.execute({
                    id: "insert.start",
                    launch: {
                      kind: "quick",
                      request: {
                        kind: "external-subcircuit",
                        definitionId,
                        symbolId: candidate.symbol.id,
                        symbolName: candidate.masterName,
                        masterName: candidate.masterName,
                        parameters: {},
                        initialRotation: 0,
                        showReference: !candidate.symbol.hierarchicalBlock,
                        referenceText: null,
                        showValue: true,
                      },
                    },
                  });
                },
                cloudProjects,
                activeCloudProjectId: cloudBinding?.id ?? null,
                onLoadCloudProject: loadCloudProjectForCellImport,
                onImportCloudCell: async (source, sourceDocumentId) => {
                  const plan = planProjectCellImport(
                    project,
                    source,
                    sourceDocumentId,
                  );
                  if (!plan.ok) {
                    return { ok: false, message: plan.message };
                  }
                  if (plan.status === "already-imported") {
                    setStatus(
                      "Cell is already imported; opened the existing copy",
                    );
                    return {
                      ok: true,
                      message: "Cell already imported",
                      documentId: plan.rootDocumentId,
                    };
                  }
                  const committed = commitStructure(
                    "import-cloud-cell",
                    [...plan.edits],
                    plan.rootDocumentId,
                  );
                  if (!committed) {
                    return {
                      ok: false,
                      message:
                        "Cell import was rejected; refresh and try again",
                    };
                  }
                  setStatus(
                    `Imported ${plan.importedDocumentIds.length} Cell${plan.importedDocumentIds.length === 1 ? "" : "s"} from ${source.name}`,
                  );
                  return {
                    ok: true,
                    message: "Cell imported",
                    documentId: plan.rootDocumentId,
                  };
                },
              }
            : null
        }
        netlistPreflight={
          netlistPreflightOpen
            ? {
                open: netlistPreflightOpen,
                project,
                format: netlistPreferences.format,
                portCase: netlistPreferences.portCase,
                rootDocumentId: netlistRootDocumentId,
                // The dialog only renders while open, so this IS the
                // explicit check the author asked for.
                electricalDiagnostics: requestElectricalDiagnostics(),
                onClose: () => setNetlistPreflightOpen(false),
                onNavigate: navigateToNetlistDiagnostic,
                onNavigateElectrical: jumpToProjectDiagnostic,
                onExport: (namingProfile) =>
                  exportDesignNetlist(netlistPreferences.format, namingProfile),
              }
            : null
        }
        publishGallery={
          publishGalleryOpen
            ? {
                draft: publishDraft,
                onDraftChange: setPublishDraft,
                defaultName: galleryEntryContext?.name ?? project.name,
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
                onPublished: ({
                  id,
                  name,
                  description,
                  tags,
                  updated,
                  previewRevision,
                }) => {
                  // The gallery now holds these exact bytes: leaving or
                  // refreshing loses nothing until the next edit.
                  noteProjectSnapshotSafe();
                  // Publishing establishes the same update-in-place binding
                  // as opening an existing Gallery entry. Keep it attached to
                  // this Project only; replacing the Project clears it above.
                  setGalleryEntryContext({
                    id,
                    name,
                    projectId: project.id,
                    ownerUserId: updated
                      ? (galleryEntryContext?.ownerUserId ??
                        publishSession?.id ??
                        null)
                      : (publishSession?.id ?? null),
                    author: updated
                      ? (galleryEntryContext?.author ??
                        publishSession?.displayName ??
                        "")
                      : (publishSession?.displayName ?? ""),
                    description,
                    tags,
                  });
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
          analogSimulationOpen
            ? `app-workspace simulation-mode${!visibleLibraryPanelOpen ? " library-collapsed" : ""}${analogSimulationMaximized ? " simulation-maximized" : ""}`
            : visibleLibraryPanelOpen
              ? "app-workspace"
              : "app-workspace library-collapsed"
        }
        style={
          {
            "--icm-shapes-width": `${libraryWidth}px`,
            "--icm-properties-width": `${propertiesWidth}px`,
            "--icm-simulation-width": `${simulationWidth}px`,
          } as CSSProperties
        }
      >
        {(selectionOpen || projectPanel !== null) &&
        !analogSimulationMaximized ? (
          <div
            className="properties-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Properties panel"
            aria-valuenow={propertiesWidth}
            aria-valuemin={PROPERTIES_WIDTH_MIN}
            aria-valuemax={PROPERTIES_WIDTH_MAX}
            tabIndex={0}
            data-testid="properties-resize-handle"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              propertiesResizeOriginRef.current = {
                pointerX: event.clientX,
                width: propertiesWidth,
              };
            }}
            onPointerMove={(event) => {
              const origin = propertiesResizeOriginRef.current;
              if (!origin) return;
              setPropertiesWidth(
                origin.width - (event.clientX - origin.pointerX),
              );
            }}
            onPointerUp={(event) => {
              propertiesResizeOriginRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 8;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setPropertiesWidth(propertiesWidth + step);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setPropertiesWidth(propertiesWidth - step);
              }
            }}
          />
        ) : null}
        {analogSimulationOpen && !analogSimulationMaximized ? (
          <div
            className="simulation-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Simulation panel"
            aria-valuenow={simulationWidth}
            aria-valuemin={SIMULATION_WIDTH_MIN}
            aria-valuemax={SIMULATION_WIDTH_MAX}
            tabIndex={0}
            data-testid="simulation-resize-handle"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              simulationResizeOriginRef.current = {
                pointerX: event.clientX,
                width: simulationWidth,
              };
            }}
            onPointerMove={(event) => {
              const origin = simulationResizeOriginRef.current;
              if (!origin) return;
              setSimulationWidth(
                origin.width - (event.clientX - origin.pointerX),
              );
            }}
            onPointerUp={(event) => {
              simulationResizeOriginRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 8;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setSimulationWidth(simulationWidth + step);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setSimulationWidth(simulationWidth - step);
              }
            }}
          />
        ) : null}
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
            topologyProject={galleryTopologyProject}
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
        <EditorRightDock
          simulationOpen={analogSimulationOpen}
          simulationOpened={analogSimulationOpened}
          maximized={analogSimulationMaximized}
          onRestoreSimulation={openAnalogSimulation}
          code={
            analogSimulationOpened && humanSimulationSession ? (
              <Suspense fallback={null}>
                <LazySpiceSimulationSurface
                  key={projectSessionId}
                  session={humanSimulationSession}
                  runHistory={projectRunHistory}
                  project={project}
                  activeDocumentId={document.id}
                  selectedCircuitObject={
                    selectedInstance
                      ? {
                          documentId: document.id,
                          instanceId: selectedInstance.id,
                        }
                      : undefined
                  }
                  selectedFolderId={activeSimulationFolder?.id ?? null}
                  onSelectFolderId={setActiveSimulationFolderId}
                  agentGuidance={
                    publicAgentUiEnabled
                      ? {
                          status: agentSession.status,
                          onOpen: openAgentConnection,
                        }
                      : undefined
                  }
                  onOpenExample={async (exampleProject) => {
                    await guardDirtyReplacement(
                      `Open ${exampleProject.name} example`,
                      () => {
                        replaceActiveProject(exampleProject, DEFAULT_VIEWBOX);
                        setActiveSimulationFolderId(
                          exampleProject.simulationFolders[0]?.id ?? null,
                        );
                        setAnalogSimulationState("open");
                        setStatus(
                          `Opened simulation example: ${exampleProject.name}`,
                        );
                      },
                    );
                  }}
                  open={analogSimulationOpen}
                  maximized={analogSimulationMaximized}
                  onToggleMaximized={toggleAnalogSimulationMaximized}
                  onMinimize={minimizeAnalogSimulation}
                  onExit={exitAnalogSimulation}
                  onHistoryBoundary={(direction) => {
                    transact([{ kind: direction }]);
                  }}
                  onSourceBuffer={(buffer) => {
                    simulationSourceBuffer.current = buffer;
                  }}
                  onSaveFolder={(
                    folder,
                    expectedRevision = project.structureRevision,
                  ) => {
                    const result = dispatchProjectTransaction({
                      transactionId: `upsert-simulation-${crypto.randomUUID()}`,
                      projectId: project.id,
                      expectedStructureRevision: expectedRevision,
                      actor: { kind: "human", id: "human-local" },
                      edits: [{ kind: "upsert_simulation_folder", folder }],
                    });
                    if (result.ok) {
                      setActiveSimulationFolderId(folder.id);
                      setStatus(
                        result.applied
                          ? `Updated simulation folder ${folder.name}`
                          : `Simulation folder ${folder.name} is already up to date`,
                      );
                      return {
                        status: result.applied ? "applied" : "unchanged",
                      };
                    }
                    const firstDiagnostic = result.diagnostics[0];
                    const message =
                      firstDiagnostic?.message ?? result.error.message;
                    setStatus(`${result.error.code}: ${message}`);
                    return {
                      status: "rejected",
                      problem: {
                        code: result.error.code,
                        message,
                        stage: "input",
                        recovery: "fix-input",
                        ...(result.diagnostics.length
                          ? {
                              diagnostics: result.diagnostics.map(
                                (diagnostic) => ({
                                  code: diagnostic.code,
                                  message: diagnostic.message,
                                  severity: diagnostic.severity,
                                  ...(diagnostic.path?.length
                                    ? { field: diagnostic.path.join(".") }
                                    : {}),
                                }),
                              ),
                            }
                          : {}),
                      },
                    };
                  }}
                  onDeleteFolder={(
                    folderId,
                    expectedRevision = project.structureRevision,
                  ) => {
                    const result = dispatchProjectTransaction({
                      transactionId: `remove-simulation-folder-${crypto.randomUUID()}`,
                      projectId: project.id,
                      expectedStructureRevision: expectedRevision,
                      actor: { kind: "human", id: "human-local" },
                      edits: [{ kind: "remove_simulation_folder", folderId }],
                    });
                    const committed = result.ok;
                    if (!result.ok)
                      setStatus(
                        `${result.error.code}: ${result.error.message}`,
                      );
                    if (committed && activeSimulationFolderId === folderId) {
                      setActiveSimulationFolderId(null);
                    }
                    return committed;
                  }}
                  pickNetsActive={simulationPickNetsActive}
                  pickedNet={analogPickedNet}
                  onPickNetsChange={setSimulationNetPickMode}
                  pickTerminalsActive={simulationPickTerminalsActive}
                  pickedTerminal={analogPickedTerminal}
                  onPickTerminalsChange={setSimulationTerminalPickMode}
                  onFocusDiagnostic={(locator) =>
                    navigateToLocator(locator, `Located ${locator.kind}`)
                  }
                  onPreviewSignal={(target) => {
                    const hierarchyPath =
                      target &&
                      simulationProbeHierarchyPath(
                        project,
                        target.rootDocumentId,
                        target.occurrence,
                      );
                    setCodeNetPreview(
                      target && hierarchyPath
                        ? {
                            documentId: target.documentId,
                            netId: target.netId,
                            hierarchyPath,
                          }
                        : null,
                    );
                  }}
                />
              </Suspense>
            ) : null
          }
          project={
            projectPanel ? (
              <EditorProjectDock>
                {projectPanel === "netlist-configuration" ? (
                  <NetlistProfileCode
                    text={netlistPreferences.text}
                    error={netlistPreferences.error}
                    onChange={(text) =>
                      netlistPreferences.changeText(text, (next) => {
                        const previous = netlistPreferences.preferences;
                        if (
                          next.selected === previous.selected &&
                          JSON.stringify(next.profiles[next.selected]) ===
                            JSON.stringify(previous.profiles[previous.selected])
                        )
                          return;
                        const edits = planNetlistProcess(
                          project,
                          next.profiles[next.selected],
                        );
                        if (
                          edits.length &&
                          !commitStructure("edit-netlist-process", edits)
                        )
                          throw new Error("Could not apply device mappings");
                      })
                    }
                  />
                ) : projectPanel === "netlist" ? (
                  <NetlistCodePanel
                    key={projectSessionId}
                    onApply={(edits) =>
                      commitStructure("edit-netlist-code", edits)
                    }
                    onFocusInstance={(instance) => {
                      if (instance && instance.documentId !== document.id)
                        selectDocumentFromHierarchy(instance.documentId);
                      setNetlistFocusedInstance(instance);
                    }}
                    project={project}
                    format={netlistPreferences.format}
                    rootDocumentId={netlistRootDocumentId}
                    onRootChange={(documentId) =>
                      setNetlistEntry(
                        documentId
                          ? { sessionId: projectSessionId, documentId }
                          : null,
                      )
                    }
                    namingProfile={netlistNamingProfile}
                    portCase={netlistPreferences.portCase}
                    onFormatChange={netlistPreferences.selectFormat}
                    onPortCaseChange={netlistPreferences.selectPortCase}
                    profiles={netlistPreferences.preferences.profiles}
                    selectedProcess={netlistPreferences.selected}
                    onProcessChange={netlistPreferences.selectProfile}
                    onDeviceTargetChange={netlistPreferences.setDeviceTarget}
                    onReset={netlistPreferences.reset}
                    configurationError={netlistPreferences.error}
                  />
                ) : projectPanel === "instances" ? (
                  <InstanceCodePanel
                    key={projectSessionId}
                    project={project}
                    onApply={(edits) => {
                      const committed = commitStructure(
                        "edit-instance-code",
                        edits,
                      );
                      if (committed)
                        setStatus(
                          `Updated instance code in ${edits.length} Cell${edits.length === 1 ? "" : "s"}`,
                        );
                      return committed;
                    }}
                  />
                ) : (
                  <ProjectCodePanel
                    project={project}
                    onApply={(source, baseline) => {
                      if (formatProjectCode(project) !== baseline) {
                        return {
                          ok: false,
                          message:
                            "The canvas or Agent changed this Project while you were editing. Reload the live code before applying.",
                        };
                      }
                      const plan = planProjectCodeCommit(
                        project,
                        source,
                        document.id,
                      );
                      if (!plan.ok) return plan;
                      if (!plan.changed) {
                        setStatus("Project Code is already up to date");
                        return { ok: true };
                      }
                      try {
                        resetInteractionState();
                        const nextDocument = commitProjectStructure(
                          plan.project,
                          plan.activeDocumentId,
                        );
                        documentViewBoxes.current = new Map();
                        setDocumentStack([]);
                        setViewBox(
                          DEFAULT_VIEWBOX,
                          nextDocument.presentation.grid,
                        );
                        setStatus("Applied complete Project Code");
                        return { ok: true };
                      } catch (error) {
                        return {
                          ok: false,
                          message:
                            error instanceof Error
                              ? error.message
                              : "Could not apply Project Code",
                        };
                      }
                    }}
                  />
                )}
              </EditorProjectDock>
            ) : null
          }
          properties={
            <EditorPropertiesDock
              open={selectionOpen}
              shelfRef={selectionShelfRef}
              onToggle={() => {
                if (selectionOpen) {
                  exitCellSymbolLayout();
                }
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
                      canvas: {
                        showGrid: gridDotsVisible,
                        annotationGrid,
                        drawAngle: drawAngleMode,
                        scrollBehavior: wheelBehavior,
                      },
                      portLabels: portLabelFormat,
                      portLabelCount: document.annotations.filter(
                        (annotation) =>
                          annotation.binding?.kind === "cell-terminal-name",
                      ).length,
                      onFormatPortLabels: (options) =>
                        formatCellTerminalAnnotations(document.id, options),
                      onApply: (value) => {
                        const current = documentSettingsCodeValue(
                          document,
                          {
                            showGrid: gridDotsVisible,
                            annotationGrid,
                            drawAngle: drawAngleMode,
                            scrollBehavior: wheelBehavior,
                          },
                          portLabelFormat,
                        );
                        const edits: SchematicEdit[] = [];
                        if (
                          JSON.stringify(value.appearance) !==
                          JSON.stringify(current.appearance)
                        ) {
                          edits.push({
                            kind: "set_presentation_style",
                            styleProfileId:
                              document.presentation.styleProfileId,
                            styleOverrides: normalizedStyleOverrides(
                              value.appearance,
                            ),
                          });
                        }
                        if (
                          value.bulkDefaults.nmosNet !==
                          current.bulkDefaults.nmosNet
                        )
                          edits.push(
                            ...planMosBulkDefaultUpdate(
                              document,
                              "nmos",
                              value.bulkDefaults.nmosNet,
                            ),
                          );
                        if (
                          value.bulkDefaults.pmosNet !==
                          current.bulkDefaults.pmosNet
                        )
                          edits.push(
                            ...planMosBulkDefaultUpdate(
                              document,
                              "pmos",
                              value.bulkDefaults.pmosNet,
                            ),
                          );
                        if (edits.length > 0 && !transact(edits).ok) {
                          return {
                            ok: false as const,
                            message: "Properties code was rejected",
                          };
                        }
                        if (value.canvas.showGrid !== gridDotsVisible)
                          setGridDotsVisible(value.canvas.showGrid);
                        if (value.canvas.annotationGrid !== annotationGrid)
                          setAnnotationGrid(value.canvas.annotationGrid);
                        if (value.canvas.drawAngle !== drawAngleMode)
                          setDrawAngleMode(value.canvas.drawAngle);
                        if (value.canvas.scrollBehavior !== wheelBehavior)
                          setWheelBehavior(value.canvas.scrollBehavior);
                        if (
                          value.portLabels.suffixCase !==
                            current.portLabels.suffixCase ||
                          value.portLabels.suffixPlacement !==
                            current.portLabels.suffixPlacement
                        )
                          setPortLabelFormat(value.portLabels);
                        setStatus("Updated Properties code");
                        return { ok: true as const };
                      },
                    }
                  : null
              }
              mosBulk={{
                connection:
                  selectedInstance && selectedBulkResolution
                    ? {
                        terminal: `${selectedInstance.reference ?? selectedInstance.id}.B`,
                        netName: selectedBulkResolution.net
                          ? (logicalNets.byBaseNetId.get(
                              selectedBulkResolution.net.id,
                            )?.name ?? selectedBulkResolution.net.id)
                          : null,
                        status: selectedBulkResolution.status,
                      }
                    : null,
                explicitRouteVisible: Boolean(selectedHiddenBulkNet),
                canDraw: Boolean(selectedInstance?.placement),
                onDraw: drawSelectedMosBulk,
              }}
              routingGuidance={{
                total: flightlines.length,
                displayed: displayedFlightlines.length,
                view: routingGuidanceView,
                onViewChange: setRoutingGuidanceView,
              }}
              groupProperties={{
                active: selectedIds.length > 1,
                count: selectedIds.length,
                selectionKey: JSON.stringify([
                  document.id,
                  [...selectedIds].sort(),
                ]),
                revision: document.revision,
                defaultForeground: styleProfile.foreground,
                context: selectedGroupContext,
                onApply: (value: GroupPropertyCodeValue) => {
                  const edits = planGroupPropertyCodeEdits(
                    selectedGroupInstances,
                    value,
                    selectedGroupContext,
                  );
                  if (
                    value.display.visualAnnotation !== "" &&
                    value.display.visualAnnotation !==
                      selectedGroupReferenceVisibility
                  )
                    edits.push(
                      ...referenceLabelVisibilityEdits(
                        selectedIds,
                        value.display.visualAnnotation,
                      ),
                    );
                  if (
                    value.display.value !== undefined &&
                    value.display.value !== "" &&
                    value.display.value !== selectedGroupValueVisibility
                  ) {
                    // Display creation must see parameter changes in this same
                    // transaction, including components that had no value yet.
                    const patches = new Map(
                      edits.flatMap((edit) =>
                        edit.kind === "patch_instance_netlist_parameters"
                          ? [[edit.instanceId, edit.set ?? {}] as const]
                          : [],
                      ),
                    );
                    const candidateDocument = {
                      ...document,
                      instances: document.instances.map((instance) => {
                        const set = patches.get(instance.id);
                        return set && instance.netlist
                          ? {
                              ...instance,
                              netlist: {
                                ...instance.netlist,
                                parameters: {
                                  ...instance.netlist.parameters,
                                  ...set,
                                },
                              },
                            }
                          : instance;
                      }),
                    };
                    if (
                      value.display.value &&
                      candidateDocument.instances.some(
                        (instance) =>
                          selectedIds.includes(instance.id) &&
                          symbolSupportsValueAnnotation(instance.symbolId) &&
                          displayableInstanceValue(instance).kind !==
                            "displayable",
                      )
                    )
                      return {
                        ok: false,
                        message:
                          "Set valid component values before enabling their display",
                      };
                    edits.push(
                      ...valueVisibilityEdits(
                        candidateDocument,
                        selectedIds,
                        value.display.value,
                      ),
                    );
                  }
                  if (edits.length === 0) return { ok: true };
                  if (transact(edits).ok) {
                    setStatus(
                      `Updated shared properties on ${selectedIds.length} components`,
                    );
                    return { ok: true };
                  }
                  return {
                    ok: false,
                    message: "Could not update the selected components",
                  };
                },
              }}
              component={
                selectedInstance
                  ? {
                      code: {
                        instance: selectedInstance,
                        ...(document.netlist
                          ? {
                              onUseCellParameter: (
                                field: string,
                                value: string,
                                anchor: HTMLElement,
                              ) =>
                                setParameterBinding({
                                  snapshot: project,
                                  cell: document,
                                  instanceId: selectedInstance.id,
                                  field,
                                  value,
                                  anchor,
                                }),
                            }
                          : {}),
                        displayName: selectedDisplayName,
                        itemName: selectedInstanceLabel
                          ? flattenRichText(
                              resolveAnnotationText(
                                document,
                                selectedInstanceLabel,
                              ),
                            )
                          : (selectedInstance.reference ?? selectedInstance.id),
                        defaultForeground: styleProfile.foreground,
                        revision: document.revision,
                        referenceVisible:
                          selectedLabelRenderable &&
                          symbolCarriesReference(selectedInstance.symbolId)
                            ? selectedInstanceLabel !== undefined &&
                              selectedInstanceLabel.visible !== false
                            : null,
                        valueVisible: symbolSupportsValueAnnotation(
                          selectedInstance.symbolId,
                        )
                          ? selectedInstanceValue !== null &&
                            selectedInstanceValue.visible !== false
                          : null,
                        parameterVisibility: instanceParameterVisibility(
                          document,
                          selectedInstance,
                        ),
                        connection: selectedSupplyMarker
                          ? selectedFormalTerminal
                            ? "cell-pin"
                            : "global"
                          : null,
                        netName:
                          selectedSupplyMarker && !selectedFormalTerminal
                            ? (selectedPortLogicalName ?? "")
                            : null,
                        onApply: (value: ComponentPropertyCodeValue) => {
                          try {
                            const edits: SchematicEdit[] =
                              planComponentPropertyCodeEdits(
                                document,
                                selectedInstance,
                                value,
                              );
                            if (
                              !selectedInstance.placement &&
                              value.placement
                            ) {
                              edits.push({
                                kind: "place_instance",
                                instanceId: selectedInstance.id,
                                placement: {
                                  position: {
                                    x: snapCoordinate(
                                      value.placement.coordinate[0],
                                      document.presentation.grid,
                                    ),
                                    y: snapCoordinate(
                                      value.placement.coordinate[1],
                                      document.presentation.grid,
                                    ),
                                  },
                                  rotation: value.placement.rotation,
                                  mirror: value.placement.mirror,
                                },
                              });
                            }
                            const candidateInstance = {
                              ...selectedInstance,
                              ...(value.parameters && selectedInstance.netlist
                                ? {
                                    netlist: {
                                      ...selectedInstance.netlist,
                                      parameters: Object.fromEntries(
                                        Object.entries(value.parameters).filter(
                                          ([, raw]) => raw.trim() !== "",
                                        ),
                                      ),
                                    },
                                  }
                                : {}),
                            };
                            const candidateDocument = {
                              ...document,
                              instances: document.instances.map((instance) =>
                                instance.id === selectedInstance.id
                                  ? candidateInstance
                                  : instance,
                              ),
                            };
                            if (value.display?.parameters) {
                              // Apply visibility before movement so the transaction transforms
                              // new and retained parameter anchors exactly once.
                              edits.unshift(
                                ...instanceParameterVisibilityEdits(
                                  candidateDocument,
                                  candidateInstance,
                                  resolver,
                                  value.display.parameters,
                                ),
                              );
                            }
                            const desiredReference =
                              value.display?.visualAnnotation;
                            const currentReference =
                              selectedInstanceLabel !== undefined &&
                              selectedInstanceLabel.visible !== false;
                            if (
                              typeof desiredReference === "boolean" &&
                              desiredReference !== currentReference
                            ) {
                              edits.push(
                                ...referenceLabelVisibilityEdits(
                                  [selectedInstance.id],
                                  desiredReference,
                                ),
                              );
                            }
                            const desiredValue = value.display?.value;
                            const currentValue =
                              selectedInstanceValue !== null &&
                              selectedInstanceValue.visible !== false;
                            if (
                              typeof desiredValue === "boolean" &&
                              desiredValue !== currentValue
                            ) {
                              if (
                                desiredValue &&
                                displayableInstanceValue(candidateInstance)
                                  .kind !== "displayable"
                              ) {
                                return {
                                  ok: false as const,
                                  message:
                                    "Set a valid component value before enabling its display",
                                };
                              }
                              edits.push(
                                ...valueVisibilityEdits(
                                  candidateDocument,
                                  [selectedInstance.id],
                                  desiredValue,
                                ),
                              );
                            }
                            if (
                              value.netName !== undefined &&
                              value.netName !== selectedPortLogicalName
                            ) {
                              const markerPlan = planElectricalMarkerName(
                                document,
                                selectedInstance.id,
                                value.netName,
                              );
                              if (markerPlan.status === "rejected") {
                                return {
                                  ok: false as const,
                                  message: markerPlan.message,
                                };
                              }
                              if (markerPlan.status === "ready") {
                                const gate = gateRoutingOperationPlan(
                                  document,
                                  markerPlan.operationPlan,
                                  { symbolResolver: resolver },
                                );
                                if (!gate.ok) {
                                  return {
                                    ok: false as const,
                                    message: gate.message,
                                  };
                                }
                                edits.push(...gate.edits);
                              }
                            }
                            const currentTarget =
                              selectedInstance.netlist?.binding?.kind ===
                              "model"
                                ? selectedInstance.netlist.binding.name
                                : selectedReviewedExternalBinding
                                  ? (selectedExternalSubcircuit?.name ?? "")
                                  : "";
                            const targetEdits: ProjectStructureEdit[] =
                              value.netlistTarget !== undefined &&
                              value.netlistTarget !== currentTarget
                                ? planSetDeviceModelTarget(
                                    project,
                                    document.id,
                                    selectedInstance.id,
                                    value.netlistTarget,
                                  )
                                : [];
                            const currentConnection = selectedSupplyMarker
                              ? selectedFormalTerminal
                                ? "cell-pin"
                                : "global"
                              : undefined;
                            const connectionEdits: ProjectStructureEdit[] =
                              selectedSupplyMarker &&
                              value.connection !== undefined &&
                              value.connection !== currentConnection
                                ? planSetVddConnectionMode(
                                    project,
                                    document.id,
                                    selectedSupplyMarker.id,
                                    value.connection,
                                  )
                                : [];
                            const structureEdits = [
                              ...targetEdits,
                              ...connectionEdits,
                            ];
                            if (
                              edits.length === 0 &&
                              structureEdits.length === 0
                            ) {
                              setStatus(
                                `Canvas properties for ${selectedInstance.id} are already up to date`,
                              );
                              return { ok: true as const };
                            }
                            let applied: boolean;
                            if (structureEdits.length > 0) {
                              // Merge structural document edits with the draft into
                              // one project transaction and one undo boundary.
                              const documentEdit = structureEdits.find(
                                (edit) =>
                                  edit.kind === "transact_document" &&
                                  edit.documentId === document.id,
                              );
                              if (documentEdit?.kind === "transact_document")
                                documentEdit.edits.push(...edits);
                              else if (edits.length)
                                structureEdits.push({
                                  kind: "transact_document",
                                  documentId: document.id,
                                  expectedRevision: document.revision,
                                  edits,
                                });
                              applied = commitStructure(
                                "apply-component-property-code",
                                structureEdits,
                              );
                            } else applied = transact(edits).ok;
                            if (!applied) {
                              return {
                                ok: false as const,
                                message:
                                  "Canvas property code was rejected; see the status bar",
                              };
                            }
                            setStatus(
                              `Applied Canvas property code to ${selectedInstance.id}`,
                            );
                            return { ok: true as const };
                          } catch (error) {
                            return {
                              ok: false as const,
                              message:
                                error instanceof Error
                                  ? error.message
                                  : "Could not apply component properties",
                            };
                          }
                        },
                      },
                      cellSymbolLayout: selectedBlockLayout
                        ? {
                            target: selectedBlockLayout,
                            enabled: cellSymbolLayoutEnabled,
                            onToggle: toggleCellSymbolLayout,
                            onBodySizeChange: (width, height) =>
                              setCellSymbolBodySize(
                                selectedBlockLayout,
                                width,
                                height,
                              ),
                            onPortPlacementChange: (terminalId, side, offset) =>
                              setCellSymbolPortPlacement(
                                selectedBlockLayout,
                                terminalId,
                                side,
                                offset,
                              ),
                          }
                        : null,
                      identity: {
                        instance: selectedInstance,
                        sourceCode: selectedComponentSourceCode!,
                        revision: document.revision,
                        targetDescription:
                          selectedInstance.netlist &&
                          !(
                            selectedInstance.netlist.binding?.kind ===
                              "model" ||
                            selectedDevice?.targetPolicy === "required-model" ||
                            selectedReviewedExternalBinding
                          )
                            ? componentTargetDescription(
                                selectedInstance,
                                selectedHierarchyCell?.netlist?.name,
                                selectedExternalSubcircuit?.name,
                              )
                            : null,
                        capacitorPlateRows: selectedCapacitorPlateRows,
                        propertyTerminal:
                          selectedInstance && selectedPropertyOnlyTerminal
                            ? {
                                label:
                                  selectedPropertyOnlyTerminal.role ===
                                  "substrate"
                                    ? "Substrate Net"
                                    : `${selectedPropertyOnlyTerminal.targetName} Net`,
                                pinName: selectedPropertyOnlyTerminal.pinName,
                                netId:
                                  selectedPropertyOnlyTerminalNet?.id ?? null,
                                options: netChoices.map((logicalNet) => ({
                                  netId: logicalNet.netId,
                                  label: logicalNet.label,
                                })),
                                onChange: (netId) => {
                                  const result = transact([
                                    {
                                      kind: "set_property_terminal_net",
                                      instanceId: selectedInstance.id,
                                      pinName:
                                        selectedPropertyOnlyTerminal.pinName,
                                      netId,
                                    },
                                  ]);
                                  if (result.ok) {
                                    setStatus(
                                      netId
                                        ? `Set ${selectedPropertyOnlyTerminal.targetName} to ${logicalNets.byBaseNetId.get(netId)?.name ?? netId}`
                                        : `Cleared ${selectedPropertyOnlyTerminal.targetName} Net`,
                                    );
                                  }
                                },
                              }
                            : null,
                        modelTarget:
                          selectedInstance.netlist &&
                          (selectedInstance.netlist.binding?.kind === "model" ||
                            selectedDevice?.targetPolicy === "required-model" ||
                            reviewedExternalModelSuggestions(
                              selectedPropertyDevice?.symbolId ?? "",
                            ).length > 0 ||
                            selectedReviewedExternalBinding)
                            ? {
                                defaultValue:
                                  selectedInstance.netlist.binding?.kind ===
                                  "model"
                                    ? selectedInstance.netlist.binding.name
                                    : selectedReviewedExternalBinding
                                      ? (selectedExternalSubcircuit?.name ?? "")
                                      : "",
                                suggestions: reviewedExternalModelSuggestions(
                                  selectedPropertyDevice?.symbolId ?? "",
                                ),
                                externalSubcircuit: Boolean(
                                  selectedReviewedExternalBinding,
                                ),
                              }
                            : null,
                        onReferenceChange: updateSelectedReference,
                        ...(selectedInstanceLabel && selectedInstance.placement
                          ? {
                              onEditAnnotation: () =>
                                beginAnnotationTextEditing(
                                  selectedInstanceLabel,
                                ),
                            }
                          : {}),
                        onModelTargetChange: updateSelectedModelTarget,
                      },
                      signalFlow: Boolean(selectedSignalFlowPresentation),
                      parameters:
                        propertyParametersForInstance(selectedInstance),
                    }
                  : null
              }
              annotationText={
                selectedAnnotation
                  ? {
                      annotation: selectedAnnotation,
                      document,
                      resolver,
                      inheritedColor: selectedAnnotationInheritedTextColor,
                      onApply: (annotation) => {
                        const result = transact([
                          { kind: "upsert_schematic_annotation", annotation },
                        ]);
                        if (result.ok)
                          setStatus("Updated annotation properties");
                        return result;
                      },
                    }
                  : null
              }
              netName={
                selectedRouteId === null &&
                selectedNetNameAnnotation &&
                selectedNetNameClaim?.kind === "name-claim"
                  ? {
                      annotationId: selectedNetNameAnnotation.id,
                      authoredScope: selectedNetNameClaim.scope,
                      editableScope:
                        selectedNetNameAnnotation.kind === "net-label",
                      effectiveScope:
                        selectedNetNameLogical?.scope ??
                        selectedNetNameClaim.scope,
                      ...(selectedNetPreferredSpelling
                        ? { preferredSpelling: selectedNetPreferredSpelling }
                        : {}),
                      spellings:
                        selectedNetNameProjection?.spellings ??
                        (selectedNetNameLogical?.name
                          ? [selectedNetNameLogical.name]
                          : []),
                      onScopeChange: (scope) =>
                        commitNetLabelScope(selectedNetNameAnnotation, scope),
                    }
                  : null
              }
              drafting={
                selectedDrafting
                  ? {
                      document,
                      resolver,
                      object: selectedDrafting,
                      defaultColor: styleProfile.foreground,
                      grid: annotationGrid,
                      onApply: (object) => {
                        const result = transact([
                          { kind: "upsert_drafting_object", object },
                        ]);
                        if (result.ok) setStatus("Updated drawing properties");
                        return result;
                      },
                      onStackingChange: setDraftingStacking,
                      onToggleLock: () => toggleDraftingLock(selectedDrafting),
                    }
                  : null
              }
              placementTray={{
                document,
                unplaced,
                onPlaceAll: placeAllFromTray,
                onSelect: (instance, label) => {
                  selectOnly("instance", [instance.id]);
                  setStatus(`Selected ${label}`);
                },
                onPlace: beginRetainedInstancePlacementFromHook,
              }}
              routeActions={{
                active: selectedRouteId !== null,
                document,
                resolver,
                route: selectedRoute ?? null,
                netLabel: selectedRouteNetLabel ?? null,
                bulkOwnerLabel: selectedMosBulkOwnerLabel,
                defaultColor: styleProfile.foreground,
                highlightActive: selectedHighlightIsActive,
                onApply: applyRouteProperties,
                onToggleHighlight: toggleHighlightedNet,
                onDeleteWire: deleteSelectedRouteConnection,
              }}
              endpointActions={{
                item: selectedEndpoint,
                color: styleProfile.foreground,
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
                onDeleteCurrentArrow: deleteSelectedAnnotation,
                onToggleHighlight: toggleHighlightedNet,
              }}
              diagnostics={{
                snapshot: checkedSnapshot,
                checkStatus: projectCheck.status,
                checkError: projectCheck.result?.error ?? null,
                documentLabel: (documentId) =>
                  project.documents.find(
                    (candidate) => candidate.id === documentId,
                  )?.name ?? documentId,
                onSelectDiagnostic: jumpToProjectDiagnostic,
                focusRequestToken: issuesFocusToken,
                onOpenStateChange: setIssuesSectionOpen,
                angledWireRepair: {
                  angledSegmentCount: angledWireRepairPlan.angledSegmentCount,
                  repairableSegmentCount:
                    angledWireRepairPlan.repairableSegmentCount,
                  repairableRouteCount:
                    angledWireRepairPlan.repairableRouteCount,
                  protectedRouteCount: angledWireRepairPlan.protectedRouteCount,
                  onRepair: () => {
                    if (angledWireRepairPlan.edits.length === 0) return;
                    const result = transact([...angledWireRepairPlan.edits]);
                    if (!result.ok) return;
                    setStatus(
                      `Straightened ${angledWireRepairPlan.repairableSegmentCount} non-standard angled wire segment${angledWireRepairPlan.repairableSegmentCount === 1 ? "" : "s"} in one undoable edit`,
                    );
                  },
                },
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
                            : (selectedRouteId ??
                              selectedAnnotationId ??
                              "None"),
                        internalRouteCount:
                          internalSelection.internalRoutes.length,
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
                      onToggleDetails: () =>
                        setAgentDetailsOpen((open) => !open),
                      onDismiss: () => {
                        setAgentDetailsOpen(false);
                        setAgentStatusDismissed(true);
                      },
                    }
                  : null
              }
            />
          }
        />
        <EditorCanvasSurface
          shortcutHintsVisible={shortcutHintsVisible}
          cameraRuntime={cameraRuntime}
          onWheel={handleWheel}
          onPinch={zoomAtClientPoint}
          className={[
            "schematic-canvas",
            tool === "wire" ? "wire-mode" : "",
            pendingSymbolId || vddRailMode || copyPlacement
              ? "component-mode"
              : "",
            pendingWaveformPlacement ? "waveform-placement-active" : "",
            tool === "arrow" ||
            tool === "construction-line" ||
            tool === "rectangle" ||
            tool === "circle"
              ? "drawing-mode"
              : "",
            projectedMovePreviewDocument ? "semantic-move-preview" : "",
            panPreview ? "pan-mode" : "",
            simulationPickNetsActive ? "simulation-net-pick-active" : "",
            simulationPickTerminalsActive
              ? "simulation-terminal-pick-active"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          eventHandlers={canvasEventHandlers}
          grid={{ visible: gridDotsVisible, viewBox }}
          sceneInnerHtml={sceneInnerHtml}
          selectionHalo={{
            document,
            resolver,
            styleProfile,
            selectedInstanceIds:
              netlistFocusedInstance?.documentId === document.id &&
              projectPanel === "netlist"
                ? [
                    ...new Set([
                      ...selectedIds,
                      netlistFocusedInstance.instanceId,
                    ]),
                  ]
                : selectedIds,
            wouldMoveIds,
          }}
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
                  onDragPreview: previewCellSymbolLayoutDrag,
                  onDragCancel: cancelCellSymbolLayoutDrag,
                }
              : null
          }
          netHighlight={{
            highlight: simulationPickNetsActive
              ? simulationPickHighlight
              : (codeNetHighlight ?? highlightedNet),
            document,
            resolver,
            routeGeometryRecords,
          }}
          wireUnderSymbol={{
            warnings: wireUnderSymbolWarnings,
            canSelectRoute: () =>
              selectionPolicy.allowsClass("route", "select"),
            onSelectRoute: (routeId) => {
              selectOnly("route", [routeId]);
              setStatus("Selected a wire buried under a symbol");
            },
          }}
          diagnosticMarkers={{
            markers: diagnosticMarkers,
            onSelectMarker: jumpToProjectDiagnostic,
          }}
          netLabelTether={netLabelTether}
          copyPreviewInnerHtml={copyPreviewInnerHtml}
          copyPreviewTransform={copyPreviewTransform}
          inputPlanes={{
            tool,
            viewBox,
            componentPlacementActive: Boolean(
              pendingSymbolId || vddRailMode || copyPlacement,
            ),
            copyPlacementActive: copyPlacement !== null,
          }}
          placementPreview={{
            styleProfile,
            ...(pendingComponentPlacement?.kind === "drafting-text"
              ? {
                  ...(pendingComponentPlacement.text !== undefined
                    ? { draftingText: pendingComponentPlacement.text }
                    : {}),
                  ...(pendingComponentPlacement.polarity
                    ? { draftingPolarity: pendingComponentPlacement.polarity }
                    : {}),
                }
              : {}),
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
            viewBox,
            netLabelPlacement,
            styleProfile,
            onNetLabelTextChange: updateNetLabelPlacementText,
            onNetLabelSubmit: commitNetLabelEditing,
            onNetLabelEscape: () => {
              cancelNetLabelEditing();
              paintSnapGuides([]);
            },
            flightlines: displayedFlightlines,
            onFlightlineClick: handleFlightline,
            wireDraftPreview,
            wireSnapTarget:
              wireSource && wirePreviewTarget?.kind !== "free"
                ? wirePreviewTarget?.point
                : undefined,
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
              wouldMoveIds,
              selectionPolicy,
              onInstanceClick: (instance, additive) => {
                if (simulationPickActive) return;
                if (suppressInstanceClick.current) {
                  suppressInstanceClick.current = false;
                  return;
                }
                selectInstanceFromSelection(instance.id, additive);
              },
              onInstanceOpen: (instance) => {
                if (referencedDocumentId(project, instance)) {
                  enterHierarchy(instance.id);
                  return;
                }
                // A Symbol that draws text inside its own body edits that text
                // where it is drawn, like every other text on the canvas. It
                // used to be reachable only from the Properties panel, which
                // made the same gesture mean two different things depending on
                // where the text happened to live.
                const presentation = resolver.resolve(
                  instance.symbolId,
                  instance.symbolVariantId,
                )?.definition.formulaPresentation;
                if (presentation) {
                  beginInstanceFormulaEditing(
                    instance,
                    presentation.defaultFormula,
                  );
                  return;
                }
                inspectInstance(instance.id);
              },
              onRoutePointerDown: (event, routeId) => {
                // Reached only while a drawing tool is up: the pointer tool's
                // presses are claimed and stopped by the capture-phase router.
                if (simulationPickActive) {
                  event.stopPropagation();
                  event.preventDefault();
                  if (simulationPickNetsActive) {
                    const route = document.routes.find(
                      (candidate) => candidate.id === routeId,
                    );
                    if (route) toggleSimulationSavedNet(route.netId);
                  }
                  return;
                }
                handleRoutePointerDown(event, routeId);
              },
              onInstanceContextMenu: (instance, clientX, clientY) => {
                // macOS fires contextmenu for Ctrl+left-press; while that
                // press is driving a drag session (the Ctrl+drag detach
                // move), the menu must not pop over it.
                if (canvasDragSessionRef.current !== null) return;
                openVisualContextMenu(
                  "instance",
                  instance.id,
                  clientX,
                  clientY,
                );
              },
              onAnnotationContextMenu: (annotation, clientX, clientY) =>
                openVisualContextMenu(
                  "annotation",
                  annotation.id,
                  clientX,
                  clientY,
                ),
              onAnnotationEdit: beginAnnotationTextEditing,
              onNetPointerEnter: (netId) => {
                if (simulationPickNetsActive) setSimulationHoverNetId(netId);
              },
              onNetPointerLeave: () => {
                if (simulationPickNetsActive) setSimulationHoverNetId(null);
              },
            },
            endpoints: {
              document,
              endpoints: simulationPickTerminalsActive
                ? wiringEndpoints.filter(
                    (candidate) =>
                      candidate.endpoint.kind === "terminal" &&
                      simulationCurrentEndpointKeys.has(
                        `${candidate.endpoint.instanceId}\u0000${candidate.endpoint.pinName}`,
                      ),
                  )
                : wiringEndpoints,
              tool,
              selectedRoute: simulationPickActive ? undefined : selectedRoute,
              selectedRouteSegmentIndex,
              selectedEndpoint,
              supplementalJunctionIds: supplementalSelection.junctionIds,
              selectionPolicy: simulationPickActive
                ? unfilteredSelectionPolicy
                : selectionPolicy,
              endpointLabel: endpointTestId,
              ...(simulationPickTerminalsActive
                ? {
                    terminalPickState: (terminal: {
                      kind: "terminal";
                      instanceId: string;
                      pinName: string;
                    }) =>
                      simulationTerminalPickStart?.instanceId ===
                        terminal.instanceId &&
                      simulationTerminalPickStart.pinName === terminal.pinName
                        ? ("origin" as const)
                        : simulationTerminalPickStart?.instanceId ===
                              terminal.instanceId &&
                            simulationTerminalPickStart.partnerPinNames.includes(
                              terminal.pinName,
                            )
                          ? ("partner" as const)
                          : ("candidate" as const),
                  }
                : {}),
              onEndpointActions: (candidate, clientX, clientY) => {
                if (
                  candidate.endpoint.kind === "junction" &&
                  tool === "pointer" &&
                  getCurrentInteractionState().kind === "idle"
                ) {
                  openVisualContextMenu(
                    "junction",
                    candidate.endpoint.junctionId,
                    clientX,
                    clientY,
                  );
                  return;
                }
                selectEndpoint(candidate);
                setStatus(
                  `Endpoint actions: ${endpointTestId(candidate.endpoint)}`,
                );
              },
              // The same four units at one hundred percent, but held at that
              // size on screen as the view zooms out, where the dot used to
              // shrink until it could not be hit. Growing it at the default
              // view would change which target wins a shared point, and this
              // is a reach fix, not a priority change.
              endpointHitRadius: screenScaleHitRadius(
                viewBox.width,
                DEFAULT_VIEWBOX.width,
                4,
              ),
              onRouteStretch: beginRouteStretch,
              onJunctionSelect: (candidate) => {
                if (simulationPickActive) {
                  if (simulationPickNetsActive && candidate.netId)
                    toggleSimulationSavedNet(candidate.netId);
                  return;
                }
                if (
                  candidate.endpoint.kind === "junction" &&
                  consumeArmedDeleteOnObject(
                    "junctionIds",
                    candidate.endpoint.junctionId,
                  )
                ) {
                  return;
                }
                selectEndpoint(candidate);
                setStatus(`Selected ${endpointTestId(candidate.endpoint)}`);
              },
              onWireEndpoint: (event, candidate) => {
                if (simulationPickActive) {
                  event.stopPropagation();
                  event.preventDefault();
                  if (simulationPickTerminalsActive)
                    pickSimulationTerminal(candidate);
                  else if (candidate.netId)
                    toggleSimulationSavedNet(candidate.netId);
                  return;
                }
                // Middle press over an endpoint cycles the wire corner just
                // like over bare canvas; it must never commit the wire.
                if (event.button === 1 && tool === "wire") {
                  event.stopPropagation();
                  event.preventDefault();
                  cycleWireCornerShape();
                  return;
                }
                if (tool === "wire" && event.button === 0) {
                  event.stopPropagation();
                  // Commit on the canvas click capture, just like a route or
                  // the background. The DOM hit radius must not select a
                  // different electrical target from the hover resolver.
                } else {
                  handleWireEndpoint(event, candidate);
                }
              },
              onNetPointerEnter: (netId) => {
                if (simulationPickNetsActive) setSimulationHoverNetId(netId);
              },
              onNetPointerLeave: () => {
                if (simulationPickNetsActive) setSimulationHoverNetId(null);
              },
            },
          }}
          draftingHitTargets={{
            document,
            resolver,
            tool,
            selectedDraftingId,
            supplementalDraftingIds: supplementalSelection.draftingIds,
            selectionPolicy,
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
            onTextContextMenu: (object, clientX, clientY) =>
              openVisualContextMenu(
                "drafting",
                draftingSelectionIds(object.id),
                clientX,
                clientY,
              ),
          }}
          draftingHandles={{
            document,
            resolver,
            selectedDraftingId:
              selectedDrafting &&
              selectionPolicy.allowsDrafting(selectedDrafting, "handle")
                ? selectedDraftingId
                : null,
            selectedDraftingIds:
              selectionPolicy.retainSelection(visualSelection).draftingIds,
            onHandlePointerDown: (event, object, handle) => {
              if (!selectionPolicy.allowsDrafting(object, "handle")) return;
              beginDraftingHandleDrag(event, object, handle);
            },
            onGroupScalePointerDown: (event, group, bounds) => {
              if (
                !group.objectIds.every((id) => {
                  const object = document.drafting?.objects.find(
                    (candidate) => candidate.id === id,
                  );
                  return (
                    object !== undefined &&
                    selectionPolicy.allowsDrafting(object, "handle")
                  );
                })
              )
                return;
              beginWaveformGroupScale(event, group, bounds);
            },
            onDeleteVertex: deleteConstructionVertex,
          }}
          interactionPreviews={{
            boxPreview,
            draftingSource,
            arrowPreset,
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
            onTextCancel: () => {
              clearTextEditing();
              setStatus("Cancelled text changes");
            },
            onTextDelete: deleteTextEditing,
            onDisplayAliasChange: setTextDisplayAlias,
          }}
        />
        {canvasContextMenu ? (
          <CanvasContextMenu
            position={canvasContextMenu}
            alignmentEnabled={alignmentParticipantCount >= 2}
            onAlign={(mode) =>
              editorCommands.execute({ id: "selection.align", mode })
            }
            actions={[
              {
                label: "Edit Component Definition (E)",
                enabled: Boolean(
                  selectedInstance &&
                  !resolver.resolve(selectedInstance.symbolId)?.definition
                    .hierarchicalBlock,
                ),
                execute: openSelectedComponentDefinition,
              },
              ...(hasHierarchyEnterSelection
                ? [
                    {
                      label: "Enter Cell (E)",
                      enabled: true,
                      execute: enterSelectedHierarchy,
                    },
                  ]
                : []),
              {
                label: "Properties (Q)",
                enabled: editorCommands.state({ id: "properties.open" })
                  .enabled,
                execute: () =>
                  editorCommands.execute({ id: "properties.open" }),
              },
              {
                label: "Duplicate (C)",
                enabled:
                  hasVisualSelection(visualSelection) &&
                  editorCommands.state({ id: "selection.copy" }).enabled,
                execute: () => editorCommands.execute({ id: "selection.copy" }),
              },
              {
                label: "Rotate 90° (R)",
                enabled: editorCommands.state({ id: "transform.rotate" })
                  .enabled,
                execute: () =>
                  editorCommands.execute({ id: "transform.rotate" }),
              },
              {
                label: "Mirror left/right (Shift+R)",
                enabled: editorCommands.state({
                  id: "transform.mirror",
                  direction: "left-right",
                }).enabled,
                execute: () =>
                  editorCommands.execute({
                    id: "transform.mirror",
                    direction: "left-right",
                  }),
              },
              {
                label: "Mirror top/bottom (Ctrl+R)",
                enabled: editorCommands.state({
                  id: "transform.mirror",
                  direction: "top-bottom",
                }).enabled,
                execute: () =>
                  editorCommands.execute({
                    id: "transform.mirror",
                    direction: "top-bottom",
                  }),
              },
              {
                label: "Delete",
                enabled: hasVisualSelection(visualSelection),
                execute: () =>
                  editorCommands.execute({ id: "selection.delete" }),
              },
            ]}
            onClose={() => setCanvasContextMenu(null)}
          />
        ) : null}
      </div>
      {timingUiEnabled ? (
        <TimingSimulationPanel
          key={document.id}
          document={document}
          open={simulationWindowOpen}
          savedNetIds={simulationSavedNetIds}
          pickNetsActive={simulationPickNetsActive}
          onOpenChange={(open) => {
            setSimulationWindowOpen(open);
            if (!open) setSimulationPickMode(null);
          }}
          onPickNetsChange={setSimulationNetPickMode}
          onToggleSavedNet={toggleSimulationSavedNet}
          onSetSavedNets={(netIds) => setSimulationSavedNetIds(new Set(netIds))}
          onStatus={setStatus}
          onPlaceOnCanvas={beginWaveformPlacement}
        />
      ) : null}
      {componentEditor ? (
        <Suspense fallback={null}>
          <ComponentDefinitionEditor
            key={componentEditor.key}
            definition={componentEditor.definition}
            mode={componentEditor.mode}
            {...(componentEditor.entry ? { entry: componentEditor.entry } : {})}
            validateApply={(definition) => {
              if (!componentEditor.target) return null;
              const plan = componentEditPlan(
                publishedDefinition(definition, componentEditor.key, 1),
              );
              return plan.ok ? null : plan.message;
            }}
            onSaved={(entry) => {
              setComponentLibraryRefresh((value) => value + 1);
              if (componentEditor.target) {
                const plan = componentEditPlan(entry.definition);
                if (!plan.ok) return plan.message;
                try {
                  commitProjectStructure(plan.project, plan.activeDocumentId);
                  selectOnly("instance", [componentEditor.target.instance.id]);
                  setStatus(
                    "Saved publicly and applied to the selected component",
                  );
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              } else if (componentEditor.mode === "new")
                insertSharedComponent(entry);
              if (componentEditor.mode !== "library") setComponentEditor(null);
              return null;
            }}
            onManaged={() => setComponentLibraryRefresh((value) => value + 1)}
            onClose={() => setComponentEditor(null)}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <UserComponentsLibrary
          open={userComponentsOpen}
          refresh={componentLibraryRefresh}
          onClose={() => setUserComponentsOpen(false)}
          onCreate={() => {
            cancelAllTransientInteraction();
            setComponentEditor({
              key: crypto.randomUUID(),
              mode: "new",
              definition: newComponentDefinition(),
            });
          }}
          onEdit={(entry) => {
            cancelAllTransientInteraction();
            setComponentEditor({
              key: crypto.randomUUID(),
              mode: "library",
              definition: entry.definition,
              entry,
            });
          }}
          onInsert={insertSharedComponent}
        />
      </Suspense>
      <SelectionFilterPopover
        open={selectionFilterOpen}
        filter={selectionFilter}
        onChange={applySelectionFilter}
        onClose={() => setSelectionFilterOpen(false)}
      />
      <EditorStatusbar
        visitStats={visitStats}
        status={status}
        tool={tool}
        vddRailMode={vddRailMode}
        pendingSymbolId={pendingSymbolId}
        wireOptionsOpen={wireOptionsOpen}
        wireRoutingMode={wireRoutingMode}
        wireCornerOrder={wireCornerOrder}
        recoveryLabel={isDirtyWork() ? recoveryStateLabel(recoveryState) : null}
        zoomPercent={zoomPercent}
        shortcutHintsVisible={shortcutHintsVisible}
        onToggleShortcutHints={() =>
          setShortcutHintsVisible((visible) => !visible)
        }
        gridVisible={gridDotsVisible}
        onToggleGrid={() => {
          setGridDotsVisible(!gridDotsVisible);
          setStatus(gridDotsVisible ? "Grid off" : "Grid on");
        }}
        selectionFilterSummary={selectionFilterSummary(selectionFilter)}
        onOpenSelectionFilter={() =>
          editorCommands.execute({ id: "selection.filter.open" })
        }
        issues={{
          checkStatus: projectCheck.status,
          errorCount: issueCounts.errorCount,
          warningCount: issueCounts.warningCount,
          onOpen: openIssuesPanel,
        }}
        onToggleWireOptions={() => setWireOptionsOpen((open) => !open)}
        onWireRoutingModeChange={setWireRoutingMode}
        onWireCornerOrderChange={setWireCornerOrder}
        onOpenAnalytics={() => {
          void guardDirtyReplacement("Open Analytics", () => {
            allowNextBrowserUnload();
            window.location.assign("/analytics");
          });
        }}
        onZoomOut={() => zoomViewAtCenter(1.2)}
        onZoomIn={() => zoomViewAtCenter(0.84)}
        onFitView={() => editorCommands.execute({ id: "view.fit" })}
      />
    </main>
  );
}
import { createSimulationProjectFileHost } from "../features/simulation/project-file-host";
