import {
  holdWorkspaceWindow,
  workspaceWindowId,
  type ProjectWorkspace,
} from "../document/project-workspace";
import { resolveAnnotationName } from "@icm/derived";
import { InstanceCodePanel } from "../features/properties/instance-code-panel";
import { NetlistCodePanel } from "../features/netlist-export/netlist-code-panel";
import { NetlistProfileCode } from "../features/netlist-export/netlist-profile-code";
import { useNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  placementModelTarget,
  placementProcessFill,
  processPlacementTarget,
  processReviewedLibrary,
  planNetlistProcess,
  prepareNetlistExample,
} from "../features/netlist-export/netlist-process";
import {
  DEFAULT_ARROW_PRESET,
  type ArrowPreset,
} from "../features/drafting/arrow-presets";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CSSProperties } from "react";
import "../styles/editor-entry.css";
import {
  instanceValueAnnotation,
  planSetVddConnectionMode,
  planRenameCellTerminal,
  planAngledWireRepairs,
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
  instanceCarriesReference,
  symbolSupportsValueAnnotation,
  resolveMosBulkConnection,
  supplyDefaultMosBulkNet,
  resolveDocumentStyleProfile,
  summarizeProjectCells,
} from "@icm/derived";
import type { HierarchyFrame } from "@icm/derived";
import {
  createEmptyProject,
  createId,
  defaultDraftTextDocument,
  flattenRichText,
  LINEAR_CONTROLLED_SOURCE_KINDS,
  controlledSourceExpressionSource,
} from "@icm/model";
import {
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  reviewedExternalModelSuggestions,
  deviceDescriptor,
  subcircuitDescriptor,
} from "@icm/devices";
import type {
  CircuitProject,
  DerivedPoint,
  GridRect,
  Point,
  Rotation,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import type { TextDraft } from "../features/text-editing/text-draft-overlay";
import { renderCrashRequested, sceneCrashRequested } from "./crash-test-hooks";
import { buildSceneSafely } from "./scene-safety";
import { externalSubcircuitSymbolId, hierarchicalSymbolId } from "@icm/symbols";
import { clipboardPreviewDocument } from "../features/clipboard/clipboard-preview";
import {
  prepareProjectCopy,
  applyProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { clipboardPlacementAnchor } from "../features/clipboard/copy-placement";
import { standaloneCopiedNetLabel } from "../features/clipboard/copied-net-label";
import { useCircuitClipboard } from "../features/clipboard/use-circuit-clipboard";
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
import type { CanvasDragSession } from "../canvas/canvas-drag-session";
import { instanceVisibleHitBox } from "../canvas/instance-geometry";
import { resolveSimulationTransport } from "../features/simulation/deployment-transport";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";
import { createCanvasHitController } from "../canvas/canvas-hit-controller";
import { LazyCellInterfaceConfirmationDialog as CellInterfaceConfirmationDialog } from "./lazy-editor-dialogs";
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
import {
  EditorServicesProvider,
  useEditorServices,
  type EditorServices,
} from "../services/editor-services";
import { normalizedStyleOverrides } from "../features/editor-shell/style-knobs";
import {
  keptDocumentStyleOfSelection,
  releaseKeptDocumentStyleEdit,
} from "../features/editor-shell/kept-document-style";
import { terminalCurrentDirectionPartners } from "../features/simulation/terminal-current-pick";
import { PUBLIC_SIMULATION_UI_ENABLED } from "../features/simulation/public-simulation-ui";
import { useCellSymbolLayout } from "../features/hierarchy/use-cell-symbol-layout";
import { selectedBlockSymbolTarget } from "../features/hierarchy/block-symbol-layout-target";
import { cellInsertLaunch } from "../features/component-insert/insert-launch";
import { useComponentPlacement } from "../features/component-insert/use-component-placement";
import { snapPendingComponentPlacement } from "../features/component-insert/placement-snap";
import { findPaletteSymbol } from "../features/component-insert/symbol-catalog";
import { useVisualClipboard } from "../features/clipboard/visual-clipboard";
import { deriveWireUnderSymbolWarnings } from "../canvas/wire-under-symbol";
import { createPlacementTrayCommands } from "../features/component-insert/placement-tray-commands";
import { componentTargetDescription } from "../features/properties/component-identity-properties";
import { componentSourceCode } from "../features/properties/component-source-code";
import {
  endpointTestId,
  instanceLabelAnnotationFor,
  maxRoutingCounter,
} from "./editor-document-helpers";
import {
  compactLayoutMatches,
  RenderCrashProbe,
} from "./editor-runtime-helpers";
import { EditorRightDock } from "./editor-right-dock";
import {
  EditorProjectDock,
  type EditorProjectPanelMode,
} from "./editor-project-dock";
import { EditorPropertiesDock } from "./editor-properties-dock";
import { LazyProjectCodePanel as ProjectCodePanel } from "./lazy-editor-dialogs";
import { LazyExamplesPanel as ExamplesPanel } from "./lazy-editor-dialogs";
import { recoverSourceDrafts } from "../features/simulation/source-draft-cache";
import { useProjectCheck } from "./use-project-check";
import { summarizeVisualDiagnostics } from "../features/selection/selection-inspector-details";
import {
  type HighlightedNetOrigin,
  useEditorDerivedModel,
} from "./use-editor-derived-model";
import type { RoutingGuidanceView } from "../interaction/interaction-state";
import { ShapesPanel } from "../features/editor-shell/shapes-panel";
import {
  type GalleryEntryContext,
  createGalleryExampleCommands,
} from "../features/editor-shell/gallery-example-commands";
import { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import {
  createProjectStructureCommands,
  cellPlacementIssue,
} from "../features/hierarchy/project-structure-commands";
import type { PublishGalleryDraft } from "../features/editor-shell/publish-gallery-dialog";
import { canUpdateGalleryPublication } from "../features/editor-shell/gallery-publish";
import { GalleryDailyLimitCard } from "../features/editor-shell/gallery-daily-limit-card";
import { projectWithTopologyRoot } from "../features/editor-shell/gallery-topology-project";
import { LazyGalleryTopologyTaskNotice as GalleryTopologyTaskNotice } from "./lazy-editor-dialogs";
import { LazyGalleryPublishedNotice as GalleryPublishedNotice } from "./lazy-editor-dialogs";
import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  useDocumentController,
} from "../document/document-controller";
import { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { ReplaceProjectOptions } from "../document/use-project-file-lifecycle";
import { useUnsavedWorkGuard } from "../document/use-unsaved-work-guard";
import { authoredObjectCount } from "../document/project-content";
import { createDraftingCommands } from "../features/drafting/drafting-commands";
import {
  createDraftingCreateController,
  buildDraftingCreateSnapIndex,
  type DrawAngleMode,
} from "../features/drafting/drafting-create-controller";
import {
  createDraftingDragController,
  type DraftingHandlePreview,
} from "../features/drafting/drafting-drag-controller";
import { createEditorTransactionCommands } from "./editor-transaction-commands";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type { ComponentEditorSession } from "./component-editor-session";
import {
  browserWorkspaceStore,
  useProjectTabSessions,
} from "./use-project-tab-sessions";
import { useNativeProjectTabs } from "./use-native-project-tabs";
import {
  createAgentWorkspaceHandler,
  createAgentWorkspaceTargets,
} from "./agent-workspace-requests";
import {
  useGalleryPublicationLink,
  useGalleryPublicationRecord,
  useGalleryPublishing,
  useGalleryRefresh,
} from "./use-gallery-publishing";
import {
  createLeaveForGallery,
  useBootLink,
  useGalleryTabEntry,
  useRestoredTabLinks,
} from "./use-gallery-entry";
import {
  useActiveSimulationFolder,
  useSimulationPickCommands,
  useSimulationPicking,
  useSimulationSurface,
} from "./use-simulation-surface";
import { EditorSimulationSurface } from "./editor-simulation-surface";
import { EditorDialogs } from "./editor-dialogs";
import { EditorComponentEditor } from "./editor-component-editor";
import { useEditorCommandRouter } from "./use-editor-command-router";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { EditorCanvasContextMenu, EditorMenuBar } from "./editor-menus";
import {
  useAgentProjectResources,
  useAgentStartupRecovery,
  useBrowserAgentHost,
  useEditorAgentConnection,
} from "./use-agent-hosts";
import { recoveryStateLabel } from "../components/recovery-banners";
import { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import { createAgentGalleryPublisher } from "../agent/agent-gallery-publish";
import { createAgentSemanticIntentHandler } from "../agent/agent-semantic-intent-handler";
import { PUBLIC_AGENT_UI_ENABLED } from "../agent/public-agent-ui";
import { WorkspaceAgentProvider } from "../agent/workspace-agent";
export { WorkspaceAgentProvider } from "../agent/workspace-agent";
import { referencedDocumentId } from "../document/editor-session";
import { useInteractionState } from "../interaction/interaction-state";
import type {
  EditorTool,
  PendingComponentPlacement,
} from "../interaction/interaction-state";
import { resolveTextEditingTarget } from "../features/text-editing/text-editing";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import {
  logicalNetChoiceForNet,
  logicalNetChoices,
  logicalSupplyNetChoice,
} from "../features/logical-net-choices";
import {
  advanceControlPick,
  type ControlPickState,
} from "../features/properties/controlled-source-canvas-pick";
import { currentControlOptions } from "../features/properties/current-control-options";
import {
  defaultRazaviSymbolVariantId,
  materializeRazaviProjectBulkConnections,
  razaviHiddenBulkRisk,
} from "../presentation/razavi-presentation";
import { useRecoveryCoordinator } from "../document/recovery-coordinator";
import { createProjectSnapshotSerializer } from "../document/project-snapshot-serializer";
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
import { instanceParameterVisibility } from "../features/instance-display/instance-parameter-display";
import { createSelectionPropertyCommands } from "../features/properties/selection-property-commands";
import {
  groupVisibilityTargets,
  planGroupPropertyCodeEdits,
} from "../features/properties/group-property-code-edits";
import { planPropertyApply } from "../features/properties/property-apply-plan";
import {
  groupBatchName,
  groupRenames,
  mergeRenamePlans,
} from "../features/properties/group-renames";
import {
  groupNamingStatus,
  planGroupNaming,
  shownPartName,
} from "../features/properties/group-naming";
import { instanceDisplayEdits } from "../features/instance-display/instance-display-edits";
import {
  batchAnnotationEdits,
  batchDraftingEdits,
} from "../features/properties/batch-property-apply";
import type { ComponentPropertyCodeValue } from "../features/properties/component-property-code";
import {
  commonGroupValue,
  groupForeground,
  groupParameterContext,
  groupPropertyItems,
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
import type { VisualSelectionKind } from "../features/selection/visual-selection";
import { planSelectionMove } from "../features/selection/selection-move-plan";
import {
  annotationHitBox,
  isRoutedMarker,
  netLabelPlacementTargetAtPoint,
  netLabelPlacementTargetForText,
} from "../features/wiring/route-interaction-geometry";
import {
  labelsOwnedBy,
  resolveLabelTethers,
} from "../features/wiring/label-tether";
import type { NetLabelPlacementTarget } from "../features/wiring/route-interaction-geometry";
import {
  netLabelBaselineAboveWire,
  netLabelBaselineForName,
  netLabelCapHeight,
  netLabelDirection,
  netLabelDirectionText,
  nextNetLabelDirection,
  turnedNetLabel,
  type NetLabelDirection,
} from "@icm/derived";
import { useWireCanvasController } from "../features/wiring/use-wire-canvas-controller";
import {
  EMPTY_WIRE_DRAFT_PREVIEW,
  resolveWireDraftPreview,
} from "../features/wiring/wire-draft-preview";
import type {
  PlacementOrientationOperation,
  ScreenFlip,
} from "../interaction/shortcut-orientation";
import { buildSceneSnapTargetIndex } from "../snap/candidates";
import { snapCoordinate } from "../snap/engine";
import type { SnapGuideLine } from "../snap/engine";

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
const DRAG_START_DISTANCE_PX = 4;
/** Drawing tools snap quietly: a line or shape is not pulled far. */
const SNAP_CAPTURE_RADIUS_PX = 4;
/**
 * A part or copy being placed reaches for a pin, wire or Junction as far as a
 * wire end or a moved part does, so a pin set down beside another one lands on
 * it and connects instead of a grid step away. It shared the quiet drawing
 * radius from 2026-09-04 until this was noticed as a lost "magnet".
 */
const PLACEMENT_SNAP_CAPTURE_RADIUS_PX = 7;
const NET_LABEL_SNAP_CAPTURE_RADIUS_PX = 12;

/** Persisted Junctions are grid points, including on ±45° Route segments. */

// Handle drags are geometry edits rather than translations.  Keep a complete
// transient object so the formal SVG renderer can redraw both a curved shaft
// and its arrow head from the same latest control point before pointer-up.
export interface AppProps {
  services: EditorServices;
  project?: CircuitProject;
  visitStats?: { pv: number; uv: number } | null;
  /** Override the deployment's Agent UI capability in tests. */
  publicAgentUiEnabled?: boolean;
  /** Override the deployment's analog Simulation UI capability in tests. */
  publicSimulationUiEnabled?: boolean;
  /** `/g/<id>` deep link: load this gallery entry after boot. */
  initialGalleryEntryId?: string | null;
}

export function App(props: AppProps) {
  const [boot, setBoot] = useState<{
    workspace: ProjectWorkspace | null;
    error?: string;
  } | null>(() =>
    typeof window === "undefined" || props.project ? { workspace: null } : null,
  );
  useEffect(() => {
    if (boot) return;
    let mounted = true;
    void Promise.resolve()
      .then(() => {
        const windowId = workspaceWindowId();
        // Marks this window open, so a fresh window never offers its tabs.
        holdWorkspaceWindow(windowId);
        return browserWorkspaceStore().read(
          windowId,
          window.location.pathname + window.location.search,
          {
            // An open request brings this window's tabs back and opens its
            // target beside them: a Gallery entry, a Cloud Project, or a new
            // circuit.
            allowRouteChange:
              Boolean(props.initialGalleryEntryId) ||
              new URLSearchParams(window.location.search).has("project") ||
              new URLSearchParams(window.location.search).get("new") === "1",
          },
        );
      })
      .then((workspace) => {
        if (mounted) setBoot({ workspace });
      })
      .catch(() => {
        if (mounted)
          setBoot({
            workspace: null,
            error:
              "Project tab storage is unavailable. Existing copies are retained; export your work before leaving.",
          });
      });
    return () => {
      mounted = false;
    };
  }, []);
  if (!boot) return <div role="status">Restoring project tabs…</div>;
  return (
    <EditorServicesProvider services={props.services}>
      <WorkspaceAgentProvider
        enabled={
          props.services.capabilities.agent &&
          (props.publicAgentUiEnabled ?? PUBLIC_AGENT_UI_ENABLED)
        }
      >
        <WorkspaceEditor
          {...props}
          restoredWorkspace={boot.workspace}
          workspaceError={boot.error ?? null}
        />
      </WorkspaceAgentProvider>
    </EditorServicesProvider>
  );
}

function propertiesMosBulkDefaultNetId(
  document: SchematicDocument,
  kind: "nmos" | "pmos",
  value: string,
): string | null {
  const selectedId =
    value === (kind === "nmos" ? "VSS" : "VDD")
      ? supplyDefaultMosBulkNet(document, kind)?.id
      : value;
  return (
    logicalNetChoiceForNet(logicalNetChoices(document), selectedId)?.netId ??
    null
  );
}

function WorkspaceEditor({
  project: initialProject,
  visitStats,
  publicAgentUiEnabled: requestedAgentUi = PUBLIC_AGENT_UI_ENABLED,
  publicSimulationUiEnabled:
    requestedSimulationUi = PUBLIC_SIMULATION_UI_ENABLED,
  initialGalleryEntryId = null,
  restoredWorkspace,
  workspaceError,
}: AppProps & {
  restoredWorkspace: ProjectWorkspace | null;
  workspaceError: string | null;
}) {
  const {
    identity,
    projectStore,
    nativeProjectStore,
    NativeFileCommands,
    exportDelivery,
    capabilities,
  } = useEditorServices();
  const publicAgentUiEnabled = capabilities.agent && requestedAgentUi;
  const publicSimulationUiEnabled =
    capabilities.simulation && requestedSimulationUi;
  const [restoringWorkspace, setRestoringWorkspace] = useState(
    restoredWorkspace !== null,
  );
  // Read once: the request is taken out of the address after it is handled,
  // so a refresh brings back what was drawn instead of starting again.
  const [bootRequestsNewProject] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [preparedInitialProject] = useState(
    () =>
      materializeRazaviProjectBulkConnections(
        initialProject ??
          createEmptyProject(createId("project"), "New Circuit"),
      ).project,
  );
  const [status, setStatus] = useState(workspaceError ?? "Ready");
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
  const { setGalleryRefreshSignal, galleryLoadGenerationRef } =
    useGalleryRefresh({
      capabilities,
      visibleLibraryPanelOpen,
    });

  const [recoveryFailureDismissed, setRecoveryFailureDismissed] =
    useState(false);
  // Feature name whose on-demand chunk vanished under a redeploy; the banner
  // offers the refresh that restores the current circuit.
  const [chunkLoadFailure, setChunkLoadFailure] = useState<string | null>(null);
  const [snapshotSerializer] = useState(() =>
    createProjectSnapshotSerializer(),
  );
  const {
    captureWorkingSession: captureRecoverySession,
    resumeWorkingSession: resumeRecoverySession,
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
  } = useRecoveryCoordinator(setStatus, {
    serializeProject: snapshotSerializer.serialize,
    // Every tab's copy is kept while the tab is open, not only the active
    // one's: a third edited tab once evicted the first one's unsaved work.
    openWorkingCopyIds: () => openWorkingCopyIdsRef.current(),
  });
  const openWorkingCopyIdsRef = useRef<() => readonly string[]>(() => []);
  const agentStartupRecovery = useAgentStartupRecovery({
    capabilities,
    restoredWorkspace,
    initialGalleryEntryId,
    recoveryWorkingCopyId,
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
    activateSession: activateDocumentSession,
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
  const {
    agentSemanticIntentRef,
    netlistPreferencesRef,
    agentPlanning,
    browserAgentHost,
  } = useBrowserAgentHost({
    editorDocumentController,
    projectSessionId,
    synchronizeExternalCommit,
    flushRecovery,
  });
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
  const simulationTransport = resolveSimulationTransport(
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
  const [modelEditorDefinitionId, setModelEditorDefinitionId] = useState<
    string | null
  >(null);
  const [modelEditorLocation, setModelEditorLocation] =
    useState<SimulationSourceLocation>();
  const openProjectModelSource = (
    sourceId: string,
    location?: SimulationSourceLocation,
  ) => {
    const definition = project.externalSubcircuitDefinitions.find(
      (d) => d.implementation?.sourceId === sourceId,
    );
    if (!definition) return;
    setModelEditorDefinitionId(definition.id);
    setModelEditorLocation(location);
    setCellManagerOpen(true);
  };
  const {
    activeSimulationFolderId,
    setActiveSimulationFolderId,
    activeSimulationFolder,
  } = useActiveSimulationFolder({
    project,
    projectSessionId,
  });
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
  // The canvas and the Netlist light the same parts. A part picked on the
  // canvas takes over from the one the netlist cursor named; an emptied
  // selection, as when the netlist cursor opens another Cell, keeps it.
  const canvasSelectionKey = visualSelection.instanceIds.join("\u0000");
  useEffect(() => {
    if (canvasSelectionKey) setNetlistFocusedInstance(null);
  }, [canvasSelectionKey]);
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
  netlistPreferencesRef.current = netlistPreferences.preferences;
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
  const [projectInfoOpen, setProjectInfoOpen] = useState(false);
  const projectNameEditing = useRef(false);
  const {
    publishGalleryOpen,
    setPublishGalleryOpen,
    openedFromCheckNotice,
    setOpenedFromCheckNotice,
    publishedNotice,
    setPublishedNotice,
    versionHistoryOpen,
    setVersionHistoryOpen,
    galleryDailyLimit,
    setGalleryDailyLimit,
    publishSession,
    cloudProjects,
    setCloudProjects,
    cloudProjectsReady,
    cloudListMutationRef,
    reloadCloudProjects,
    galleryEntryContext,
    setGalleryEntryContext,
    publicationLinkLoading,
    setPublicationLinkLoading,
    publicationLinkError,
    setPublicationLinkError,
    publicationLinkNotice,
    setPublicationLinkNotice,
    publicationLinkRetry,
    setPublicationLinkRetry,
    publishGates,
    publishQuota,
  } = useGalleryPublishing({
    identity,
    projectStore,
    project,
    resolver,
  });
  /** The tab guard's blocker, for Agent hosts built before it (#1462). */
  const projectSwitchBlockerRef = useRef<() => string | null>(() => null);
  const openProjectInTabRef = useRef<
    (
      project: CircuitProject,
      view: GridRect,
      options: ReplaceProjectOptions,
      background?: boolean,
    ) => Promise<boolean>
  >(async () => false);
  const {
    agentFileCandidate,
    setAgentFileCandidate,
    agentProjectResources,
    browserAgentFileHost,
    projectRunHistory,
    browserAgentSimulationHost,
    agentWorkspaceRef,
    agentGalleryPublicationRef,
    recordGalleryPublicationRef,
  } = useAgentProjectResources({
    editorDocumentController,
    projectSessionId,
    browserAgentHost,
    simulationTransport,
    projectSwitchBlockerRef,
    openProjectInTabRef,
  });
  const browserAgentProjectHost = useMemo(
    () =>
      new BrowserAgentProjectHost({
        projectTransactionOptions: EDITOR_PROJECT_TRANSACTION_OPTIONS,
        isProjectAvailable: () =>
          projectTabs
            .entries()
            .some(
              (entry) => entry.session.controller === editorDocumentController,
            ),
        publishToGallery: createAgentGalleryPublisher({
          // Only while this working copy is the one its tab shows.
          current: () => {
            const state = agentGalleryPublicationRef.current();
            return state.controller === editorDocumentController ? state : null;
          },
          published: (outcome, state) =>
            recordGalleryPublicationRef.current(
              outcome,
              state.sessionId,
              "agent",
            ),
        }),
        workspace: (request) => agentWorkspaceRef.current(request),
        getProjectSessionId: () => editorDocumentController.projectSessionId,
        getProject: () => editorDocumentController.project,
        getActiveDocumentId: () => editorDocumentController.document.id,
        commitProjectStructure: (nextProject, activeDocumentId) =>
          browserAgentHost.commitProjectStructure(
            nextProject,
            activeDocumentId,
          ),
        dispatchProjectTransaction: (request) =>
          browserAgentHost.dispatchProjectTransaction(request),
      }),
    [browserAgentHost, editorDocumentController, projectSessionId],
  );
  const {
    simulationPickMode,
    setSimulationPickModeState,
    analogSimulationState,
    setAnalogSimulationState,
    simulationSourceBuffer,
    analogSimulationOpened,
    analogSimulationOpen,
    analogSimulationMaximized,
    humanSimulationSession,
    openAnalogSimulation,
    minimizeAnalogSimulation,
    toggleAnalogSimulationMaximized,
    exitAnalogSimulation,
  } = useSimulationSurface({
    publicSimulationUiEnabled,
    dispatchProjectTransaction,
    editorDocumentController,
    projectSessionId,
    simulationTransport,
    setProjectPanel,
    projectRunHistory,
  });
  const [codeDraftDirty, setCodeDraftDirty] = useState(false);
  const noteCodeDraftDirty = useCallback((dirty: boolean) => {
    setCodeDraftDirty(dirty);
  }, []);
  const openGalleryProjectInTabRef = useRef<
    (
      project: CircuitProject,
      view: GridRect,
      context: GalleryEntryContext,
    ) => Promise<boolean>
  >(async () => false);
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
    captureFileSession,
    restoreFileSession,
    cloudBinding,
    nativeBinding,
    noteGalleryPublication,
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
    hasUnsavedChanges,
    hasUnsafeWork,
    noteProjectPublished,
    replaceActiveProject,
    saveProjectToCloud,
    saveProjectToNative,
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
    restoreSavedProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    downloadRecoveryBackup,
    deleteRecoverySessionFromDialog,
    openProjectFile,
    openCloudProjectById,
  } = useProjectFileLifecycle({
    projectStore,
    ...(nativeProjectStore ? { nativeProjectStore } : {}),
    exportDelivery,
    openProjectInTab: (project, view, options, background) =>
      openProjectInTabRef.current(project, view, options, background),
    restoreWorkingSession: agentStartupRecovery !== null,
    externalWorkspaceRestored: restoredWorkspace !== null,
    galleryEntryId: canUpdateGalleryPublication(
      galleryEntryContext,
      publishSession,
    )
      ? galleryEntryContext!.id
      : undefined,
    hasPendingEdits: () => simulationSourceBuffer.current?.dirty === true,
    beforeSnapshot: captureAuthoredProject,
    onRecoverBuffers: recoverSourceDrafts,
    describeOpenBlocker: () => projectSwitchBlockerRef.current(),
    project,
    projectSessionId,
    viewBox,
    defaultViewBox: DEFAULT_VIEWBOX,
    setStatus,
    onCloudProjectSaved: (saved) => {
      if (
        galleryEntryContext &&
        saved.galleryEntryId !== galleryEntryContext.id
      )
        setGalleryEntryContext(null);
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
    installProject: (nextProject, nextViewBox, options) => {
      browserAgentFileHost.clear();
      setAgentFileCandidate(null);
      setImportReport(null);
      setImportReviewOpen(false);
      setGalleryEntryContext(null);
      // Project Info belongs to the outgoing Project.
      setProjectInfoOpen(false);
      const nextDocument = replaceProject(nextProject);
      if (options.agentEdited) editorDocumentController.noteAgentEdit();
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
  const linkExistingPublication = useGalleryPublicationLink({
    projectStore,
    capabilities,
    project,
    editorDocumentController,
    projectSessionId,
    publishSession,
    galleryEntryContext,
    setGalleryEntryContext,
    setPublicationLinkLoading,
    setPublicationLinkError,
    setPublicationLinkNotice,
    publicationLinkRetry,
    cloudBinding,
    noteGalleryPublication,
  });

  const startupCloudRestoreAttemptedRef = useRef(false);
  const hasExplicitBootTarget =
    restoredWorkspace !== null ||
    initialGalleryEntryId !== null ||
    bootRequestsNewProject ||
    (typeof window !== "undefined" &&
      (() => {
        const search = new URLSearchParams(window.location.search);
        return (
          search.has("example") ||
          search.has("project") ||
          search.has("history")
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
  const {
    agentTargetRef,
    backgroundAgentHosts,
    agentSession,
    approveAgentFileCandidate,
    rejectAgentFileCandidate,
    openAgentConnection,
  } = useEditorAgentConnection({
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
  });
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
  const { commitStructure, transact, gateConnectivity, transactConnectivity } =
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
    editProjectInfo,
    deleteCell,
    updateCellPortDirection,
    moveCellPort,
    editCellParameter,
    setExternalSubcircuitDefinition,
    removeExternalSubcircuitDefinition,
    setCellSymbolBodySize,
    setCellSymbolPortPlacement,
    editCellTerminalAnnotation,
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
  const {
    openGalleryEntryById,
    refreshGalleryEntry,
    openLibraryExample,
    insertGalleryEntryById,
  } = createGalleryExampleCommands({
    defaultViewBox: DEFAULT_VIEWBOX,
    prepareLibraryExample: (example) =>
      prepareNetlistExample(
        example,
        netlistPreferences.preferences.profiles[netlistPreferences.selected],
      ),
    replaceActiveProject,
    openProjectInTab: (next, view, context) =>
      openGalleryProjectInTabRef.current(next, view, context),
    guardDirtyReplacement,
    beginCopyPlacement: (clipboard, anchor) => {
      prepareProjectCopy(project, document, clipboard);
      beginCopyPlacementInteraction(clipboard, anchor);
    },
    cancelAllTransientInteraction,
    setGalleryEntryContext,
    setStatus,
    setDailyOpenLimit: setGalleryDailyLimit,
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
   * over to their placement interaction on the first target.
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
  const [controlOptionPreview, setControlOptionPreview] = useState<{
    documentId: string;
    instanceId: string;
    netId: string;
  } | null>(null);
  const [controlPickState, setControlPickState] =
    useState<ControlPickState | null>(null);
  const controlPickMode =
    controlPickState?.kind === "voltage"
      ? "net"
      : controlPickState?.kind === "current"
        ? "sensor"
        : null;
  const {
    codeNetPreview,
    setCodeNetPreview,
    simulationPickNetsActive,
    simulationPickTerminalsActive,
    simulationPickActive,
    simulationHoverNetId,
    setSimulationHoverNetId,
    analogPickedNet,
    setAnalogPickedNet,
    analogPickedTerminal,
    setAnalogPickedTerminal,
    simulationTerminalPickStart,
    setSimulationTerminalPickStart,
  } = useSimulationPicking({
    document,
    projectSessionId,
    activeSimulationFolderId,
    analogSimulationOpen,
    simulationPickMode,
    setSimulationPickModeState,
    setControlPickState,
  });
  const routeCounter = useRef(0);
  const canvasDragSessionRef = useRef<CanvasDragSession | null>(null);
  /**
   * Last pointer position seen on the canvas, in document coordinates. A
   * placement that starts from the keyboard has no pointer event of its own,
   * so it seeds its preview from here instead of waiting for the next move.
   */
  const lastCanvasPointRef = useRef<Point | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  // Choosing a drawing tool leaves the text being written, as any other
  // interaction does.
  useEffect(() => {
    if (tool !== "pointer") setTextDraft(null);
  }, [tool]);
  const carriedCopyRef = useRef<{
    clipboard: SchematicClipboard;
    orientation: readonly PlacementOrientationOperation[];
  } | null>(null);

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
  const tabProjectInputRef = useRef<HTMLInputElement>(null);
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
    return rendered;
  }, [document, draftingHandlePreview, projectedMovePreviewDocument]);
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
  useEffect(() => {
    if (
      controlPickState &&
      selectedInstance?.id !== controlPickState.instanceId
    )
      setControlPickState(null);
  }, [selectedInstance?.id]);
  const selectedAnnotationOwnerInstanceId = selectedAnnotation
    ? annotationOwningInstanceId(selectedAnnotation)
    : undefined;
  const keptStyle = useMemo(
    () => keptDocumentStyleOfSelection(document, visualSelection),
    [document, visualSelection],
  );
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
  const draftingCreateSnapIndex = useMemo(
    () =>
      buildDraftingCreateSnapIndex(
        document,
        resolver,
        visibleEndpoints,
        routeGeometryRecords,
        sceneSnapTargetIndex,
      ),
    [
      document,
      resolver,
      visibleEndpoints,
      routeGeometryRecords,
      sceneSnapTargetIndex,
    ],
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
  const {
    simulationPickHighlight,
    codeNetHighlight,
    simulationCurrentEndpointKeys,
    pickAnalogSimulationNet,
    pickSimulationTerminal,
    setSimulationPickMode,
    setSimulationNetPickMode,
    setSimulationTerminalPickMode,
  } = useSimulationPickCommands({
    setStatus,
    project,
    document,
    projectConnectivityIndex,
    documentStack,
    activeSimulationFolder,
    analogSimulationOpen,
    simulationPickMode,
    setSimulationPickModeState,
    setControlPickState,
    controlPickMode,
    codeNetPreview,
    simulationPickNetsActive,
    simulationPickTerminalsActive,
    simulationHoverNetId,
    setSimulationHoverNetId,
    setAnalogPickedNet,
    setAnalogPickedTerminal,
    simulationTerminalPickStart,
    setSimulationTerminalPickStart,
    logicalNets,
    activateTool,
  });
  const controlOptionHighlight = useMemo(
    () =>
      selectionOpen &&
      !documentSettingsOpen &&
      controlOptionPreview?.documentId === document.id &&
      controlOptionPreview.instanceId === selectedInstance?.id
        ? computeNetHighlight(
            projectConnectivityIndex,
            document.id,
            controlOptionPreview.netId,
            undefined,
            documentStack,
          )
        : undefined,
    [
      selectionOpen,
      documentSettingsOpen,
      controlOptionPreview,
      document.id,
      selectedInstance?.id,
      projectConnectivityIndex,
      documentStack,
    ],
  );
  useEffect(() => {
    setControlOptionPreview(null);
  }, [selectionOpen, documentSettingsOpen, document.id, selectedInstance?.id]);
  const startControlPick = (): void => {
    if (
      !selectedInstance ||
      !LINEAR_CONTROLLED_SOURCE_KINDS.has(selectedInstance.symbolId)
    )
      return;
    activateTool("pointer");
    setSimulationPickModeState(null);
    setSimulationHoverNetId(null);
    const kind =
      selectedInstance.symbolId === "vcvs" ||
      selectedInstance.symbolId === "vccs"
        ? "voltage"
        : "current";
    setControlPickState({
      documentId: document.id,
      instanceId: selectedInstance.id,
      kind,
    });
    setStatus(
      kind === "voltage"
        ? "Pick control + Net, then control − Net · Each pick applies immediately; Esc stops picking"
        : "Pick control + terminal, then − terminal on the same device · Esc cancels",
    );
  };
  const currentControlDevices = document.instances.filter((instance) => {
    const descriptor = deviceDescriptor(instance.symbolId, project);
    return descriptor
      ? descriptor.deviceClass !== "net-marker"
      : Boolean(instance.netlist?.binding);
  });
  const isCurrentControlTerminal = (
    instanceId: string,
    pinName: string,
  ): boolean => {
    const instance = currentControlDevices.find(
      (item) => item.id === instanceId,
    );
    return Boolean(
      instance &&
      resolver
        .resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition.pins.some((pin) => pin.name === pinName),
    );
  };
  const controlSensorCandidate =
    controlPickMode === "sensor"
      ? (instanceId: string, pinName?: string) =>
          Boolean(
            pinName &&
            isCurrentControlTerminal(instanceId, pinName) &&
            (controlPickState?.kind === "current" && controlPickState.positive
              ? controlPickState.positive.instanceId === instanceId &&
                (controlPickState.positive.pinName === pinName ||
                  controlPickState.positive.partners.includes(pinName))
              : (() => {
                  const instance = document.instances.find(
                    (i) => i.id === instanceId,
                  );
                  return (
                    instance &&
                    terminalCurrentDirectionPartners(
                      instance,
                      pinName,
                      resolver
                        .resolve(instance.symbolId, instance.symbolVariantId)
                        ?.definition.pins.map((p) => p.name) ?? [],
                    ).length > 0
                  );
                })()),
          )
      : undefined;
  const pickControlledSourceTarget = (
    target:
      | { kind: "net"; netId: string }
      | { kind: "sensor"; instanceId: string }
      | { kind: "terminal"; instanceId: string; pinName: string },
  ): void => {
    if (!controlPickState) return;
    const result = advanceControlPick(
      controlPickState,
      document,
      target,
      isCurrentControlTerminal,
      (instanceId) => {
        const instance = document.instances.find((i) => i.id === instanceId);
        return instance
          ? (resolver
              .resolve(instance.symbolId, instance.symbolVariantId)
              ?.definition.pins.map((p) => p.name) ?? [])
          : [];
      },
    );
    if (result.kind === "await-negative") {
      setControlPickState(result.state);
      setStatus(result.message);
      return;
    }
    if (result.kind === "continue" || result.kind === "complete") {
      const instance = document.instances.find(
        (candidate) => candidate.id === controlPickState.instanceId,
      );
      if (!instance) {
        setControlPickState(null);
        setStatus("The controlled source is no longer in this Cell");
        return;
      }
      if (target.kind === "terminal") {
        suppressInstanceClick.current = true;
        window.setTimeout(() => {
          suppressInstanceClick.current = false;
        }, 0);
      }
      const previous = instance.netlist?.control;
      const unchanged =
        result.control.kind === "voltage"
          ? previous?.kind === "voltage" &&
            previous.positiveNetId === result.control.positiveNetId &&
            previous.negativeNetId === result.control.negativeNetId
          : previous?.kind === "terminal-current" &&
            previous.instanceId === result.control.instanceId &&
            previous.pinName === result.control.pinName &&
            previous.direction === result.control.direction;
      const applied = unchanged
        ? { ok: true }
        : transact([
            {
              kind: "set_instance_netlist",
              instanceId: instance.id,
              netlist: {
                ...(instance.netlist?.binding
                  ? { binding: instance.netlist.binding }
                  : {}),
                parameters: instance.netlist?.parameters ?? {},
                control: result.control,
              },
            },
          ]);
      if (applied.ok) {
        setControlPickState(result.kind === "continue" ? result.state : null);
        setSimulationHoverNetId(null);
      } else {
        setStatus("Could not apply controlled-source selection");
        return;
      }
    }
    setStatus(result.message);
  };
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
    escapeTextEditing,
    clearTextEditing,
    deleteTextEditing,
    netLabelPlacement,
    placeNetLabel,
    textEditing,
    updateTextEditing,
    updateNetLabelPlacementText,
    updateNetLabelPlacementPosition,
    turnNetLabelPlacement,
  } = usePropertiesEditor({
    document,
    resolver,
    selectedRoute,
    selectedRouteIds: visualSelection.routeIds,
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
    commitRailConnectionMode: (routeId, mode, edits) => {
      try {
        const structureEdits = planSetVddConnectionMode(
          project,
          document.id,
          routeId,
          mode,
        );
        const documentEdit = structureEdits.find(
          (edit) =>
            edit.kind === "transact_document" &&
            edit.documentId === document.id,
        );
        if (documentEdit?.kind === "transact_document") {
          // A simultaneous visibility edit must retain the role planner's
          // new binding, rather than restore the previous interface owner.
          documentEdit.edits.push(
            ...edits.map((edit) => {
              if (edit.kind !== "upsert_schematic_annotation") return edit;
              const roleEdit = documentEdit.edits.findLast(
                (candidate) =>
                  candidate.kind === "upsert_schematic_annotation" &&
                  candidate.annotation.id === edit.annotation.id,
              );
              return roleEdit?.kind === "upsert_schematic_annotation"
                ? {
                    ...edit,
                    annotation: {
                      ...edit.annotation,
                      binding: roleEdit.annotation.binding,
                    },
                  }
                : edit;
            }),
          );
        } else if (edits.length)
          structureEdits.push({
            kind: "transact_document",
            documentId: document.id,
            expectedRevision: document.revision,
            edits,
          });
        return (
          structureEdits.length === 0 ||
          commitStructure(
            `Set power rail connection to ${mode}`,
            structureEdits,
          )
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Power rail connection could not be changed",
        );
        return false;
      }
    },
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
      ? selectedInstance &&
        LINEAR_CONTROLLED_SOURCE_KINDS.has(selectedInstance.symbolId) &&
        selectedInstanceLabel.content
        ? controlledSourceExpressionSource(selectedInstanceLabel.content) ||
          null
        : resolveAnnotationName(document, selectedInstanceLabel).trim() || null
      : null;
  const selectedInstanceValue = selectedInstance
    ? instanceValueAnnotation(document, selectedInstance.id)
    : null;
  const selectedControl = selectedInstance?.netlist?.control;
  const currentControlSummary = (() => {
    if (!selectedControl || selectedControl.kind === "voltage")
      return undefined;
    const target = document.instances.find(
      (i) =>
        i.id ===
        (selectedControl.kind === "current"
          ? selectedControl.sensorInstanceId
          : selectedControl.instanceId),
    );
    if (!target) return "Control not selected";
    const pin =
      selectedControl.kind === "current" ? "+" : selectedControl.pinName;
    const names =
      resolver
        .resolve(target.symbolId, target.symbolVariantId)
        ?.definition.pins.map((p) => p.name) ?? [];
    const partner = pin
      ? terminalCurrentDirectionPartners(target, pin, names)[0]
      : undefined;
    const from = `${target.reference ?? "Device"}.${pin ?? "?"}`;
    const to = partner
      ? `${target.reference ?? "Device"}.${partner}`
      : (target.reference ?? "Device");
    return selectedControl.kind === "terminal-current" &&
      selectedControl.direction === "out"
      ? `${to} → ${from}`
      : `${from} → ${to}`;
  })();
  const controlSummary =
    selectedControl?.kind === "voltage"
      ? `+ ${logicalNetChoiceForNet(netChoices, selectedControl.positiveNetId)?.label ?? "unset"} · − ${logicalNetChoiceForNet(netChoices, selectedControl.negativeNetId)?.label ?? "unset"}`
      : currentControlSummary;
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
  const selectedGroupParameters = groupParameterContext(
    selectedGroupInstances,
    propertyParametersForInstance,
  );
  const selectedGroupContext = {
    ...selectedGroupParameters,
    reference: selectedGroupReferenceVisibility,
    value: selectedGroupValueVisibility,
    foreground: selectedGroupForeground,
    // Where the components differ, the batch lists what each one has.
    items:
      selectedGroupInstances.length < 2
        ? []
        : groupPropertyItems(selectedGroupInstances, {
            parametersFor: propertyParametersForInstance,
            parameterKeys: Object.keys(
              selectedGroupParameters.parameters ?? {},
            ),
            nameOf: (instance) =>
              document.netlist?.terminals.find((terminal) =>
                terminal.interfaceInstanceIds.includes(instance.id),
              )?.name ??
              instance.reference ??
              instance.id,
            // What its label shows: a display alias, or its own name.
            shownNameOf: (instance) => {
              const name =
                document.netlist?.terminals.find((terminal) =>
                  terminal.interfaceInstanceIds.includes(instance.id),
                )?.name ?? instance.reference;
              return name === undefined
                ? null
                : shownPartName(
                    instanceLabelAnnotationFor(document, instance.id),
                    name,
                  );
            },
            referenceVisible: (instance) => {
              const label = instanceLabelAnnotationFor(document, instance.id);
              return label !== undefined && label.visible !== false;
            },
            valueVisible: (instance) => {
              if (!symbolSupportsValueAnnotation(instance.symbolId))
                return null;
              const value = instanceValueAnnotation(document, instance.id);
              return value !== null && value.visible !== false;
            },
            defaultForeground: styleProfile.foreground,
          }),
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
  // Each selected label, or the labels of a lone selected part, draws a line
  // to what it belongs to, so a label that ends up near another part still
  // reads as its own.
  const labelTethers = useMemo(
    () =>
      resolveLabelTethers(
        { document, resolver, styleProfile, routeGeometryRecords, logicalNets },
        visualSelection.annotationIds.length > 0
          ? visualSelection.annotationIds
          : visualSelection.instanceIds.length === 1
            ? labelsOwnedBy(document, visualSelection.instanceIds[0]!)
            : [],
      ),
    [
      document,
      resolver,
      styleProfile,
      routeGeometryRecords,
      logicalNets,
      visualSelection,
    ],
  );
  const labelOwnerIds = useMemo(
    () =>
      labelTethers.flatMap((tether) =>
        tether.kind === "part" && tether.ownerId ? [tether.ownerId] : [],
      ),
    [labelTethers],
  );

  const {
    sourceForTarget,
    beginRouteStretch,
    drawSelectedMosBulk,
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
        if (
          !candidate.netlist ||
          cellPlacementIssue(project, document.id, candidate.id)
        )
          return [];
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
    [document.id, project, resolver],
  );
  const externalSubcircuitInsertCandidates = useMemo(
    () =>
      project.externalSubcircuitDefinitions.flatMap((definition) => {
        const mapping =
          definition.presentation || definition.implementation
            ? undefined
            : resolveReviewedExternalBinding(
                definition.name,
                definition.terminals.map((terminal) => terminal.name),
              );
        const symbol = resolver.resolve(
          definition.symbolId ??
            mapping?.symbolId ??
            externalSubcircuitSymbolId(definition.id),
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
  // The device the library's own tile already places in this Process
  // (SKY130's default transistors and BJTs, which arrive bound) gets no
  // second tile in Insert; other reviewed devices keep theirs.
  const insertDialogExternalCandidates = useMemo(
    () =>
      externalSubcircuitInsertCandidates.filter(({ masterName, symbol }) => {
        const reviewed = reviewedExternalBindingForMaster(masterName);
        return !(
          reviewed &&
          reviewed.symbolId === symbol.id &&
          processPlacementTarget(
            project,
            netlistPreferences.preferences,
            symbol.id,
          )?.toLowerCase() === masterName.toLowerCase()
        );
      }),
    [
      externalSubcircuitInsertCandidates,
      project,
      netlistPreferences.preferences,
    ],
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
    gateConnectivity,
    transactProject: (transactionId, edits) =>
      commitStructure(transactionId, edits),
    // A device drawn while working in a process is that process's device.
    processModelTarget: (symbolId) =>
      placementModelTarget(project, netlistPreferences.preferences, symbolId),
    processFill: (edits) =>
      placementProcessFill(
        project,
        netlistPreferences.preferences,
        document.id,
        edits,
      ),
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
  const selectionMoveController = createSelectionMoveController({
    document,
    resolver,
    visibleEndpoints,
    routeGeometryRecords,
    contactComponents,
    sceneSnapTargetIndex,
    annotationGrid,
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
          ? "Copy: click a part to pick up its copy · Esc cancels"
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
   * because their placement interaction takes over
   * and owns Esc from here.
   */
  function consumeArmedVerbOnInstance(instanceId: string): boolean {
    if (armedVerb === null) return false;
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return false;
    if (armedVerb === "copy") {
      setArmedVerb(null);
      selectOnly("instance", [instanceId]);
      suppressCommitClickRef.current = true;
      // The pointer-down target is authoritative; React selection state has
      // not updated yet, and this same click must not also place the copy.
      void circuitClipboard.copySelection(true, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: [instanceId],
      });
      return true;
    }
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
    transactCopy: (plan) => {
      const committed = commitProjectStructure(
        applyProjectCopyPlacement(
          plan,
          undefined,
          EDITOR_PROJECT_TRANSACTION_OPTIONS,
        ),
      );
      return { ok: true, revision: committed.revision };
    },
    commitCellTerminalSelection: removeCellTerminalSelection,
    setStatus,
    setSelectedEndpoint,
    resetSelection,
    replaceSelectionKind,
    selectOnly,
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
    moveController: selectionMoveController,
    snapCoordinate,
    updateInstanceSelection,
    suppressInstanceClickRef: suppressInstanceClick,
    logicalRadiusForPixels,
    snapGuides: paintSnapGuides,
    setProjectedMovePreview: setProjectedMovePreviewDocument,
    beginSelectionMoveInteraction,
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

  const internalSelection = useMemo(
    () =>
      deriveRoutingAffectedClosure(document, {
        instanceIds: selectedIds,
        routeIds: visualSelection.routeIds,
        junctionIds: visualSelection.junctionIds,
        annotationIds: visualSelection.annotationIds,
      }),
    [document, selectedIds, visualSelection],
  );
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
  const wireDraftPreview = useMemo(
    () =>
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
        : EMPTY_WIRE_DRAFT_PREVIEW,
    [
      document,
      resolver,
      wireSource,
      wirePreviewTarget,
      wireDraftSteps,
      wireRoutingMode,
      wireCornerOrder,
      visibleEndpoints,
    ],
  );
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
    // Text is written first, where the pointer is, and placed afterwards.
    beginTextPlacement: () => {
      cancelAllTransientInteraction();
      setTool("pointer");
      setTextDraft({
        content: defaultDraftTextDocument(""),
        sizeScale: 1,
        alignment: "middle",
        position: lastCanvasPointRef.current ?? {
          x: viewBox.x + viewBox.width / 2,
          y: viewBox.y + viewBox.height / 2,
        },
      });
      setStatus("Type the text, then Enter to place it · Esc cancels");
    },
  });
  const {
    snapPoint: snapDraftingPoint,
    handleCanvasClick: handleDraftingCanvasClick,
    finish: finishDraftingCreate,
    beginPointer: beginDraftingCreatePointer,
  } = createDraftingCreateController({
    snapIndex: draftingCreateSnapIndex,
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
    chooseWireShape,
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
      toggle: (routeId) => {
        const removing = visualSelection.routeIds.includes(routeId);
        selectVisualObject("route", routeId, true);
        setStatus(
          `${removing ? "Removed" : "Added"} wire ${routeId} ${removing ? "from" : "to"} the selection`,
        );
      },
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
        netLabelPlacement?.phase === "placing",
      ),
      componentPlacementPending: Boolean(
        pendingSymbolId && pendingComponentPlacement && !vddRailMode,
      ),
      tool,
      cellSymbolLayoutEnabled,
      simulationPickMode,
      controlPickMode,
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
      // Ends the placement a label drag has taken over, leaving that drag's
      // own session running.
      endComponentPlacement: () => {
        cancelInteraction();
        setComponentPreviewPoint(null);
        setStatus("Component placement ended");
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
        if (netId) pickAnalogSimulationNet(netId);
      },
      pickControlledSource: (kind, id) => {
        if (
          controlPickMode === "sensor" &&
          (kind === "instance" ||
            kind === "instance-label" ||
            kind === "annotation")
        ) {
          const annotation =
            kind === "instance-label" || kind === "annotation"
              ? document.annotations.find((candidate) => candidate.id === id)
              : undefined;
          const instanceId =
            kind === "instance"
              ? id
              : annotation
                ? annotationOwningInstanceId(annotation)
                : undefined;
          if (instanceId)
            pickControlledSourceTarget({ kind: "sensor", instanceId });
          return;
        }
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
        if (netId) pickControlledSourceTarget({ kind: "net", netId });
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
    setDocumentSettingsOpen(false);
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
      propertiesOpenBeforeProjectPanelRef.current =
        selectionOpen && !documentSettingsOpen;
    }
    setDocumentSettingsOpen(false);
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

  const circuitClipboard = useCircuitClipboard({
    project,
    document,
    selection: visualSelection,
    enabled:
      !componentEditor &&
      !userComponentsOpen &&
      !interfaceConfirmation &&
      !versionHistoryOpen,
    setStatus,
    beginPaste: (clipboard) => beginClipboardPlacement(clipboard),
  });

  /**
   * Put a copied fragment in the pointer's hand on this canvas. A copy carried
   * in from another project tab keeps the turns and flips it already had.
   */
  function beginClipboardPlacement(
    clipboard: SchematicClipboard,
    orientation?: readonly PlacementOrientationOperation[],
  ): void {
    if (getCurrentInteractionState().kind !== "idle") {
      setStatus("Finish or cancel the active tool before pasting");
      return;
    }
    prepareProjectCopy(project, document, clipboard);
    const anchor = clipboardPlacementAnchor(clipboard);
    if (!anchor) throw new Error("Copied objects have no placeable origin");
    cancelAllTransientInteraction();
    beginCopyPlacementInteraction(clipboard, anchor, orientation);
    seedCopyPreviewFromPointer();
    setStatus(
      `Paste ${clipboard.instances.length} components · click to place · Esc cancels`,
    );
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
    if (!capabilities.community) return;
    toggleExamplesPanelFromShell();
  }

  const { restoredGalleryLink, restoredCloudLink, restoredNewLink } =
    useBootLink({
      initialGalleryEntryId,
      restoredWorkspace,
      capabilities,
      bootRequestsNewProject,
      preparedInitialProject,
      setStatus,
      netlistPreferences,
      openProjectInTabRef,
      restoreAfterRefresh,
      replaceActiveProject,
      openCloudProjectById,
      openGalleryEntryById,
    });

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
    setTextDraft(null);
  }

  /** Enter in the Text tool's editor: carry what was written to the pointer. */
  function submitTextDraft(): void {
    const draft = textDraft;
    if (!draft) return;
    setTextDraft(null);
    const text = flattenRichText(draft.content).trim();
    if (!text) {
      setStatus("Nothing written; text cancelled");
      return;
    }
    startInsertFromHook({
      kind: "quick",
      request: {
        kind: "drafting-text",
        symbolId: "text",
        symbolName: "Text",
        text,
        content: draft.content,
        alignment: draft.alignment,
        sizeScale: draft.sizeScale,
        initialRotation: 0,
        editAfterPlacement: true,
      },
    });
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
  // A standard cell's rails are the gate's VDD/VSS supply rows (#1450).
  const selectedPropertyOnlyTerminal =
    selectedReviewedExternalBinding?.terminals.find(
      (terminal) => terminal.interaction === "property" && !terminal.supply,
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
  const selectedBuiltInSupplies = selectedInstance
    ? subcircuitDescriptor(selectedInstance.symbolId, project)?.ports.flatMap(
        (port) => (port.supply ? [port.supply] : []),
      )
    : undefined;

  const selectedCircuitBinding = selectedInstance?.netlist?.binding;
  const selectedAuthoredCircuit =
    selectedCircuitBinding?.kind === "external-subcircuit"
      ? project.externalSubcircuitDefinitions.find(
          (definition) =>
            definition.id === selectedCircuitBinding.definitionId &&
            definition.implementation?.kind === "source",
        )
      : undefined;

  const hasDefinitionSelection = Boolean(
    selectedInstance &&
    (!resolver.resolve(selectedInstance.symbolId)?.definition
      .hierarchicalBlock ||
      selectedAuthoredCircuit),
  );

  function openSelectedComponentDefinition(): void {
    if (!capabilities.community) {
      setStatus("Shared component editing is unavailable in this preview");
      return;
    }
    if (!selectedInstance) {
      setStatus("Select one component to edit its definition");
      return;
    }
    const external = selectedAuthoredCircuit;
    if (hasHierarchyEnterSelection && !external) {
      enterSelectedHierarchy();
      return;
    }
    const definition =
      project.componentDefinitions?.find(
        (item) => item.symbol.id === selectedInstance.symbolId,
      ) ??
      (external && resolver.resolve(selectedInstance.symbolId)
        ? { symbol: resolver.resolve(selectedInstance.symbolId)!.definition }
        : undefined);
    if (!definition) {
      setStatus("No component definition is available for this selection");
      return;
    }
    cancelAllTransientInteraction();
    setCanvasContextMenu(null);
    setComponentEditor({
      key: crypto.randomUUID(),
      projectSessionId,
      mode: "instance",
      definition: structuredClone(definition),
      ...(external ? { externalDefinitionId: external.id } : {}),
      target: {
        projectSessionId,
        documentId: document.id,
        instance: structuredClone(selectedInstance),
      },
    });
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
              : nextTool === "polyline"
                ? "Polyline: click vertices; double-click or Enter to finish"
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
  ): {
    point: Point;
    guides: readonly SnapGuideLine[];
    netLabelTarget?: NetLabelPlacementTarget;
  } {
    if (copyPlacement) {
      const copied = standaloneCopiedNetLabel(copyPlacement.clipboard);
      // The copy keeps its look and stands over its new wire as a new label
      // with that text does.
      const netLabelTarget = copied
        ? resolveNetLabelPlacementTarget(point, svg, undefined, undefined, {
            baselineAboveWire: netLabelBaselineForName(
              copied.name,
              copied.annotation.formatOverride,
              document.presentation,
              copied.annotation.sizeScale ?? 1,
            ),
            rotation: copied.annotation.rotation,
          })
        : null;
      if (netLabelTarget)
        return {
          point: netLabelTarget.labelPosition,
          guides: [],
          netLabelTarget,
        };
      return snapPendingCopyPlacement({
        movingAnchors: copyPreviewState.anchors,
        sceneSnapTargetIndex,
        anchor: copyPlacement.anchor,
        position: point,
        grid: document.presentation.grid,
        tolerance: logicalRadiusForPixels(
          svg,
          PLACEMENT_SNAP_CAPTURE_RADIUS_PX,
        ),
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
      tolerance: logicalRadiusForPixels(svg, PLACEMENT_SNAP_CAPTURE_RADIUS_PX),
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
    direction: NetLabelDirection | undefined = netLabelPlacement?.direction,
    /** The text the label carries, once known: it stands as close over a
     * horizontal wire as that text allows (#1300). */
    seat:
      | { baselineAboveWire: number; rotation?: number }
      | undefined = netLabelPlacement?.phase === "placing"
      ? {
          baselineAboveWire: netLabelBaselineAboveWire(
            netLabelPlacement.content,
            styleProfile,
            netLabelPlacement.sizeScale,
          ),
        }
      : undefined,
  ): NetLabelPlacementTarget | null {
    const target = netLabelPlacementTargetAtPoint(
      routeGeometryRecords,
      point,
      svg ? logicalRadiusForPixels(svg, NET_LABEL_SNAP_CAPTURE_RADIUS_PX) : 0,
      preferredRouteId,
      direction
        ? {
            direction,
            capHeight: netLabelCapHeight(
              styleProfile,
              netLabelPlacement?.sizeScale ?? 1,
            ),
          }
        : undefined,
    );
    return target && seat
      ? netLabelPlacementTargetForText(
          routeGeometryRecords,
          target,
          seat.rotation ?? target.rotation ?? 0,
          seat.baselineAboveWire,
        )
      : target;
  }

  /**
   * R on a Net Label: while placing it, the preview turns a quarter on the
   * wire it is over; once placed, every selected Net Label does. Each keeps
   * its distance from its wire and never runs across it.
   */
  function turnNetLabels(): void {
    if (netLabelPlacement?.phase === "placing") {
      const direction = nextNetLabelDirection(
        netLabelPlacement.direction ??
          netLabelDirection({
            rotation: netLabelPlacement.target?.rotation ?? 0,
            alignment:
              netLabelPlacement.target?.alignment ??
              netLabelPlacement.alignment,
          }),
      );
      const target = netLabelPlacement.target
        ? resolveNetLabelPlacementTarget(
            lastCanvasPointRef.current ?? netLabelPlacement.position,
            undefined,
            netLabelPlacement.target.routeId,
            direction,
          )
        : null;
      turnNetLabelPlacement(direction, target);
      paintSnapGuides(netLabelSnapGuides(target));
      return;
    }
    const geometryOf = (routeId: string) =>
      routeGeometryRecords.find(({ route }) => route.id === routeId)?.geometry;
    const turned = document.annotations.flatMap((annotation) => {
      if (!visualSelection.annotationIds.includes(annotation.id)) return [];
      if (annotation.locked) return [];
      const next = turnedNetLabel(
        annotation,
        geometryOf,
        styleProfile,
        document,
      );
      return next ? [next] : [];
    });
    if (!turned.length) return;
    if (
      transact(
        turned.map((annotation) => ({
          kind: "upsert_schematic_annotation" as const,
          annotation,
        })),
      ).ok
    )
      setStatus(
        `Net Label${turned.length === 1 ? "" : "s"} runs ${netLabelDirection(turned[0]!)} · R turns again`,
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
  const editorCommands = useEditorCommandRouter({
    setStatus,
    selectionOpen,
    setSearchOpen,
    closeSearch,
    document,
    canUndo,
    canRedo,
    visualSelection,
    replaceSelectionKind,
    setSelectionFilterOpen,
    documentSettingsOpen,
    setBoxPreview,
    getCurrentInteractionState,
    tool,
    transact,
    armedVerb,
    selectedEndpoint,
    highlightedNetOrigin,
    setHighlightedNetOrigin,
    canvasDragSessionRef,
    selectedDrafting,
    hasRotatableSelection,
    hasMirrorableSelection,
    hasInspectableSelection,
    rotatePendingComponentFromHook,
    mirrorPendingComponentFromHook,
    startInsertFromHook,
    rotateSelected,
    mirrorSelected,
    alignSelection,
    alignmentParticipantCount,
    armVerb,
    disarmVerb,
    beginKeyboardSelectionMoveFromSelection,
    deleteSelectionFromSelection,
    canBeginKeyboardSelectionMove,
    canTransformCommandMove,
    mirrorCommandMoveFromSelection,
    rotateCommandMoveFromSelection,
    addPlainText,
    fitView,
    panView,
    openProperties,
    closeProperties,
    circuitClipboard,
    selectAllObjects,
    clearEditorSelection,
    cancelAllTransientInteraction,
    activateTool,
    rotatePendingCopy,
    mirrorPendingCopy,
    paintSnapGuides,
    visualClipboard,
  });
  const { exportSvg, exportDesignNetlist, exportRaster, importSpiceFiles } =
    createEditorFileCommands({
      project,
      document,
      resolver,
      exportDelivery,
      defaultViewBox: DEFAULT_VIEWBOX,
      // Asked at export time, which is one of the moments an
      // electrical verdict belongs to.
      electricalWarningsPresent: () =>
        requestElectricalDiagnostics().length > 0,
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

  useEditorShortcuts({
    textEditing,
    commitTextEditing,
    document,
    readShortcutDependencies: () => ({
      projectStore,
      nativeProjectStore,
      setStatus,
      componentEditor,
      userComponentsOpen,
      setUserComponentsOpen,
      selectionOpen,
      setSelectionOpen,
      searchOpen,
      closeSearch,
      toggleLibraryPanel,
      document,
      documentStack,
      visualSelection,
      selectionFilterOpen,
      setSelectionFilterOpen,
      viewBox,
      documentSettingsOpen,
      setDocumentSettingsOpen,
      projectInfoOpen,
      setProjectInfoOpen,
      versionHistoryOpen,
      recoveryDialogOpen,
      setRecoveryDialogOpen,
      hasUnsafeWork,
      saveProjectToCloud,
      saveProjectToNative,
      exportProjectFile,
      setWireOptionsOpen,
      getCurrentInteractionState,
      tool,
      wireSource,
      wirePreviewPoint,
      wireDraftSteps,
      draftingSource,
      setWireDraftSteps,
      interfaceConfirmation,
      highlightedNetOrigin,
      controlPickState,
      setControlPickState,
      simulationPickActive,
      setSimulationHoverNetId,
      lastCanvasPointRef,
      projectInputRef,
      selectedRoute,
      selectedDrafting,
      hasHierarchyEnterSelection,
      hasInspectableSelection,
      selectedHighlightNetId,
      setSimulationPickMode,
      beginNetLabelEditing,
      cancelNetLabelEditing,
      commitInstancePropertyDraft,
      commitPendingNetLabelDraft,
      escapeTextEditing,
      netLabelPlacement,
      textEditing,
      finishWireAtPoint,
      cancelComponentInsertFromHook,
      insertDialogOpen,
      setDraftingStyle,
      finishDraftingCreate,
      cycleWireCornerShape,
      enterSelectedHierarchy,
      returnToParentDocument,
      toggleHighlightedNet,
      toggleProjectPanel,
      circuitClipboard,
      toggleExamplesPanel,
      openSelectedComponentDefinition,
      hasDefinitionSelection,
      activateTool,
      paintSnapGuides,
      resolveNetLabelPlacementTarget,
      turnNetLabels,
      editorCommands,
      openNativeProject,
    }),
  });

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
      snapPlacementPoint: (point, svg) =>
        resolvePendingPlacementPoint(point, svg).point,
      commitCopyPlacement: (point, svg) => {
        const placement = resolvePendingPlacementPoint(point, svg);
        commitCopyPlacementFromSelection(
          placement.point,
          placement.netLabelTarget,
        );
      },
      commitPendingPlacement: commitPendingPlacementAtFromHook,
      clearComponentPreview: () => setComponentPreviewPoint(null),
      clearVddRailPreview: () => setVddRailPreviewPoint(null),
      clearCopyPreview: () => {
        setCopyPreviewPoint(null);
        paintSnapGuides([]);
      },
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
      clearHover: () => {
        setDraftingHover(null);
        setDraftingSnapPoint(null);
        paintSnapGuides([]);
      },
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
      clearHover: () => {
        setWirePreview(null);
        paintSnapGuides([]);
      },
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

  const nativeWorkspaceSaving = useRef(false);
  const {
    createTabSession,
    restoredTabs,
    currentEditBlocker,
    projectSwitchBlocker,
    projectTabs,
    dropDiscardedWork,
    workspaceReopen,
    setWorkspaceReopen,
    reopenClosedWindowTabs,
  } = useProjectTabSessions({
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
  });
  useGalleryTabEntry({
    initialGalleryEntryId,
    restoredWorkspace,
    preparedInitialProject,
    project,
    projectSessionId,
    setGalleryDailyLimit,
    setGalleryEntryContext,
    codeDraftDirty,
    openGalleryProjectInTabRef,
    isDirtyWork,
    hasUnsafeWork,
    replaceActiveProject,
    createTabSession,
    projectTabs,
  });
  useRestoredTabLinks({
    restoringWorkspace,
    bootRequestsNewProject,
    setStatus,
    codeDraftDirty,
    openCloudProjectById,
    openGalleryEntryById,
    refreshGalleryEntry,
    restoredGalleryLink,
    restoredCloudLink,
    restoredNewLink,
    restoredTabs,
    projectTabs,
  });
  const {
    recentNativeFiles,
    nativeBusy,
    setNativeBusy,
    nativeOperation,
    refreshNativeFiles,
    openNativeProject,
    closeNativeTab,
    closeNativeTabs,
    saveNativeTab,
  } = useNativeProjectTabs({
    nativeProjectStore,
    setStatus,
    replaceGuard,
    recoveryDialogOpen,
    saveProjectToNative,
    isSaveInFlight,
    openProjectFile,
    createTabSession,
    currentEditBlocker,
    projectTabs,
    nativeWorkspaceSaving,
  });
  agentWorkspaceRef.current = createAgentWorkspaceHandler({
    projectStore,
    stageRecovery,
    flushRecovery,
    editorDocumentController,
    synchronizeExternalCommit,
    setCloudProjects,
    cloudListMutationRef,
    simulationSourceBuffer,
    codeDraftDirty,
    restoreFileSession,
    saveProjectToCloud,
    openCloudProjectById,
    renameProject,
    createTabSession,
    projectSwitchBlocker,
    projectTabs,
  });
  agentTargetRef.current = createAgentWorkspaceTargets({
    flushRecovery,
    synchronizeExternalCommit,
    agentPlanning,
    browserAgentHost,
    simulationTransport,
    projectSwitchBlockerRef,
    openProjectInTabRef,
    setAgentFileCandidate,
    agentProjectResources,
    browserAgentFileHost,
    browserAgentSimulationHost,
    agentWorkspaceRef,
    browserAgentProjectHost,
    backgroundAgentHosts,
    projectTabs,
  });
  const allowNextBrowserUnload = useUnsavedWorkGuard(projectTabs.hasUnsafeTabs);

  const recordGalleryPublication = useGalleryPublicationRecord({
    setStatus,
    setGalleryRefreshSignal,
    galleryLoadGenerationRef,
    editorDocumentController,
    setPublishedNotice,
    publishSession,
    galleryEntryContext,
    setGalleryEntryContext,
    agentGalleryPublicationRef,
    recordGalleryPublicationRef,
    cloudBinding,
    noteGalleryPublication,
    noteProjectPublished,
  });

  const leaveForGallery = createLeaveForGallery({
    project,
    stageRecovery,
    flushRecovery,
    captureAuthoredProject,
    cloudBinding,
    isDirtyWork,
    guardDirtyReplacement,
    dropDiscardedWork,
    allowNextBrowserUnload,
  });

  return (
    <main className="app-shell">
      {publishedNotice ? (
        <Suspense fallback={null}>
          <GalleryPublishedNotice
            notice={publishedNotice}
            onDismiss={() => setPublishedNotice(null)}
          />
        </Suspense>
      ) : null}
      {capabilities.community ? (
        <Suspense fallback={null}>
          <GalleryTopologyTaskNotice
            hidden={publishGalleryOpen}
            onOpen={() => {
              setOpenedFromCheckNotice(true);
              setPublishGalleryOpen(true);
            }}
          />
        </Suspense>
      ) : null}
      {interfaceConfirmation ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
      {renderCrashRequested() ? <RenderCrashProbe /> : null}
      <EditorMenuBar
        identity={identity}
        projectStore={projectStore}
        nativeProjectStore={nativeProjectStore}
        NativeFileCommands={NativeFileCommands}
        capabilities={capabilities}
        publicAgentUiEnabled={publicAgentUiEnabled}
        publicSimulationUiEnabled={publicSimulationUiEnabled}
        setStatus={setStatus}
        userComponentsOpen={userComponentsOpen}
        setUserComponentsOpen={setUserComponentsOpen}
        leftPanelMode={leftPanelMode}
        setSelectionOpen={setSelectionOpen}
        searchOpen={searchOpen}
        toggleLibraryPanel={toggleLibraryPanel}
        visibleLibraryPanelOpen={visibleLibraryPanelOpen}
        recoverySessions={recoverySessions}
        project={project}
        document={document}
        documentStack={documentStack}
        visualSelection={visualSelection}
        selectionFilterOpen={selectionFilterOpen}
        cellManagerOpen={cellManagerOpen}
        setCellManagerOpen={setCellManagerOpen}
        netlistPreflightOpen={netlistPreflightOpen}
        setNetlistPreflightOpen={setNetlistPreflightOpen}
        projectPanel={projectPanel}
        setProjectPanel={setProjectPanel}
        netlistPreferences={netlistPreferences}
        documentSettingsOpen={documentSettingsOpen}
        setDocumentSettingsOpen={setDocumentSettingsOpen}
        setProjectInfoOpen={setProjectInfoOpen}
        projectNameEditing={projectNameEditing}
        publishGalleryOpen={publishGalleryOpen}
        setPublishGalleryOpen={setPublishGalleryOpen}
        setOpenedFromCheckNotice={setOpenedFromCheckNotice}
        cloudProjects={cloudProjects}
        reloadCloudProjects={reloadCloudProjects}
        analogSimulationState={analogSimulationState}
        openAnalogSimulation={openAnalogSimulation}
        nativeBinding={nativeBinding}
        savedProjectBaseline={savedProjectBaseline}
        isDirtyWork={isDirtyWork}
        hasUnsavedChanges={hasUnsavedChanges}
        saveProjectToCloud={saveProjectToCloud}
        saveProjectToNative={saveProjectToNative}
        isSaveInFlight={isSaveInFlight}
        saveBusy={saveBusy}
        exportProjectFile={exportProjectFile}
        createNewProject={createNewProject}
        revertToSavedProjectBaseline={revertToSavedProjectBaseline}
        openRecoveryDialog={openRecoveryDialog}
        openProjectFile={openProjectFile}
        openCloudProjectById={openCloudProjectById}
        agentSession={agentSession}
        openAgentConnection={openAgentConnection}
        tool={tool}
        transact={transact}
        renameProject={renameProject}
        selectedEndpoint={selectedEndpoint}
        projectInputRef={projectInputRef}
        tabProjectInputRef={tabProjectInputRef}
        hasHierarchyEnterSelection={hasHierarchyEnterSelection}
        flightlines={flightlines}
        displayedFlightlines={displayedFlightlines}
        crossings={crossings}
        projectCheck={projectCheck}
        visualDiagnosticSummary={visualDiagnosticSummary}
        cellInsertCandidates={cellInsertCandidates}
        alignmentParticipantCount={alignmentParticipantCount}
        internalSelection={internalSelection}
        projectInstanceCount={projectInstanceCount}
        selectDocumentFromHierarchy={selectDocumentFromHierarchy}
        enterSelectedHierarchy={enterSelectedHierarchy}
        returnToTopDocument={returnToTopDocument}
        toggleProjectPanel={toggleProjectPanel}
        toggleExamplesPanel={toggleExamplesPanel}
        cancelAllTransientInteraction={cancelAllTransientInteraction}
        placeCellInstance={placeCellInstance}
        editorCommands={editorCommands}
        importSpiceFiles={importSpiceFiles}
        exportSvg={exportSvg}
        exportRaster={exportRaster}
        exportDesignNetlist={exportDesignNetlist}
        nativeWorkspaceSaving={nativeWorkspaceSaving}
        createTabSession={createTabSession}
        projectTabs={projectTabs}
        recentNativeFiles={recentNativeFiles}
        nativeBusy={nativeBusy}
        setNativeBusy={setNativeBusy}
        nativeOperation={nativeOperation}
        refreshNativeFiles={refreshNativeFiles}
        openNativeProject={openNativeProject}
        closeNativeTab={closeNativeTab}
        closeNativeTabs={closeNativeTabs}
        saveNativeTab={saveNativeTab}
        leaveForGallery={leaveForGallery}
      />
      <EditorDialogs
        projectStore={projectStore}
        nativeProjectStore={nativeProjectStore}
        exportDelivery={exportDelivery}
        publicAgentUiEnabled={publicAgentUiEnabled}
        setStatus={setStatus}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        agentPanelOpen={agentPanelOpen}
        setAgentPanelOpen={setAgentPanelOpen}
        closeSearch={closeSearch}
        galleryLoadGenerationRef={galleryLoadGenerationRef}
        setGalleryRefreshSignal={setGalleryRefreshSignal}
        recoveryFailureDismissed={recoveryFailureDismissed}
        setRecoveryFailureDismissed={setRecoveryFailureDismissed}
        chunkLoadFailure={chunkLoadFailure}
        setChunkLoadFailure={setChunkLoadFailure}
        recoveryState={recoveryState}
        recoverySessions={recoverySessions}
        project={project}
        document={document}
        dispatchProjectTransaction={dispatchProjectTransaction}
        editorDocumentController={editorDocumentController}
        projectSessionId={projectSessionId}
        galleryTopologyProject={galleryTopologyProject}
        projectConnectivityIndex={projectConnectivityIndex}
        setDocumentStack={setDocumentStack}
        cellManagerOpen={cellManagerOpen}
        setCellManagerOpen={setCellManagerOpen}
        modelEditorDefinitionId={modelEditorDefinitionId}
        setModelEditorDefinitionId={setModelEditorDefinitionId}
        modelEditorLocation={modelEditorLocation}
        setModelEditorLocation={setModelEditorLocation}
        netlistPreflightOpen={netlistPreflightOpen}
        setNetlistPreflightOpen={setNetlistPreflightOpen}
        netlistPreferences={netlistPreferences}
        netlistRootDocumentId={netlistRootDocumentId}
        projectInfoOpen={projectInfoOpen}
        setProjectInfoOpen={setProjectInfoOpen}
        publishGalleryOpen={publishGalleryOpen}
        setPublishGalleryOpen={setPublishGalleryOpen}
        openedFromCheckNotice={openedFromCheckNotice}
        versionHistoryOpen={versionHistoryOpen}
        setVersionHistoryOpen={setVersionHistoryOpen}
        publishSession={publishSession}
        cloudProjects={cloudProjects}
        galleryEntryContext={galleryEntryContext}
        publicationLinkLoading={publicationLinkLoading}
        publicationLinkError={publicationLinkError}
        publicationLinkNotice={publicationLinkNotice}
        setPublicationLinkRetry={setPublicationLinkRetry}
        publishGates={publishGates}
        publishQuota={publishQuota}
        openProjectInTabRef={openProjectInTabRef}
        agentFileCandidate={agentFileCandidate}
        cloudBinding={cloudBinding}
        replaceGuard={replaceGuard}
        replaceGuardSaving={replaceGuardSaving}
        recoveryDialogOpen={recoveryDialogOpen}
        startupRecovery={startupRecovery}
        setRecoveryDialogOpen={setRecoveryDialogOpen}
        isDirtyWork={isDirtyWork}
        downloadCurrentProjectBackup={downloadCurrentProjectBackup}
        cancelReplaceGuard={cancelReplaceGuard}
        confirmReplaceGuard={confirmReplaceGuard}
        saveAndContinueReplaceGuard={saveAndContinueReplaceGuard}
        dismissStartupRecovery={dismissStartupRecovery}
        restoreRecoverySession={restoreRecoverySession}
        downloadRecoveryBackup={downloadRecoveryBackup}
        deleteRecoverySessionFromDialog={deleteRecoverySessionFromDialog}
        linkExistingPublication={linkExistingPublication}
        startupCloudRestoreAttemptedRef={startupCloudRestoreAttemptedRef}
        agentSession={agentSession}
        approveAgentFileCandidate={approveAgentFileCandidate}
        rejectAgentFileCandidate={rejectAgentFileCandidate}
        commitStructure={commitStructure}
        createCell={createCell}
        renameCell={renameCell}
        editProjectInfo={editProjectInfo}
        deleteCell={deleteCell}
        updateCellPortDirection={updateCellPortDirection}
        moveCellPort={moveCellPort}
        editCellParameter={editCellParameter}
        setExternalSubcircuitDefinition={setExternalSubcircuitDefinition}
        removeExternalSubcircuitDefinition={removeExternalSubcircuitDefinition}
        openGalleryEntryById={openGalleryEntryById}
        publishDraft={publishDraft}
        setPublishDraft={setPublishDraft}
        searchResults={searchResults}
        requestElectricalDiagnostics={requestElectricalDiagnostics}
        cellInsertCandidates={cellInsertCandidates}
        externalSubcircuitInsertCandidates={externalSubcircuitInsertCandidates}
        insertDialogExternalCandidates={insertDialogExternalCandidates}
        cancelComponentInsertFromHook={cancelComponentInsertFromHook}
        insertDialogOpen={insertDialogOpen}
        insertInitialSelectionId={insertInitialSelectionId}
        insertScope={insertScope}
        recentSymbolIds={recentSymbolIds}
        switchDocument={switchDocument}
        jumpToCaller={jumpToCaller}
        navigateToLocator={navigateToLocator}
        navigateToNetlistDiagnostic={navigateToNetlistDiagnostic}
        selectSearchResult={selectSearchResult}
        jumpToProjectDiagnostic={jumpToProjectDiagnostic}
        cellManagerEntries={cellManagerEntries}
        editorCommands={editorCommands}
        exportDesignNetlist={exportDesignNetlist}
        workspaceReopen={workspaceReopen}
        setWorkspaceReopen={setWorkspaceReopen}
        reopenClosedWindowTabs={reopenClosedWindowTabs}
        recordGalleryPublication={recordGalleryPublication}
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
        {!capabilities.community || leftPanelMode === "library" ? (
          <ShapesPanel
            styleProfileId={document.presentation.styleProfileId}
            open={visibleLibraryPanelOpen}
            onStartInsert={(launch) =>
              editorCommands.execute({ id: "insert.start", launch })
            }
          />
        ) : (
          <Suspense
            fallback={
              <aside
                className="shapes-panel"
                aria-label="Insert from Gallery"
              />
            }
          >
            <ExamplesPanel
              open={visibleLibraryPanelOpen}
              onOpenGalleryExample={(id) => void insertGalleryEntryById(id)}
              onOpenExample={openLibraryExample}
            />
          </Suspense>
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
              <EditorSimulationSurface
                projectSessionId={projectSessionId}
                humanSimulationSession={humanSimulationSession}
                projectRunHistory={projectRunHistory}
                project={project}
                document={document}
                selectedInstance={selectedInstance}
                activeSimulationFolder={activeSimulationFolder}
                activeSimulationFolderId={activeSimulationFolderId}
                setActiveSimulationFolderId={setActiveSimulationFolderId}
                publicAgentUiEnabled={publicAgentUiEnabled}
                agentSession={agentSession}
                openAgentConnection={openAgentConnection}
                guardDirtyReplacement={guardDirtyReplacement}
                replaceActiveProject={replaceActiveProject}
                setAnalogSimulationState={setAnalogSimulationState}
                setStatus={setStatus}
                analogSimulationOpen={analogSimulationOpen}
                analogSimulationMaximized={analogSimulationMaximized}
                toggleAnalogSimulationMaximized={
                  toggleAnalogSimulationMaximized
                }
                minimizeAnalogSimulation={minimizeAnalogSimulation}
                exitAnalogSimulation={exitAnalogSimulation}
                transact={transact}
                openProjectModelSource={openProjectModelSource}
                simulationSourceBuffer={simulationSourceBuffer}
                dispatchProjectTransaction={dispatchProjectTransaction}
                simulationPickNetsActive={simulationPickNetsActive}
                analogPickedNet={analogPickedNet}
                setSimulationNetPickMode={setSimulationNetPickMode}
                simulationPickTerminalsActive={simulationPickTerminalsActive}
                analogPickedTerminal={analogPickedTerminal}
                setSimulationTerminalPickMode={setSimulationTerminalPickMode}
                navigateToLocator={navigateToLocator}
                setCodeNetPreview={setCodeNetPreview}
              />
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
                    onDirtyChange={noteCodeDraftDirty}
                    key={projectSessionId}
                    onApply={(edits) =>
                      commitStructure("edit-netlist-code", edits)
                    }
                    onFocusInstance={(instance) => {
                      if (instance && instance.documentId !== document.id)
                        selectDocumentFromHierarchy(instance.documentId);
                      setNetlistFocusedInstance(instance);
                    }}
                    selection={{
                      documentId: document.id,
                      instanceIds: visualSelection.instanceIds,
                    }}
                    onNavigateDiagnostic={(diagnostic) =>
                      navigateToNetlistDiagnostic(diagnostic, {
                        from: "Netlist",
                        keepPanel: true,
                      })
                    }
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
                    onFormatChange={netlistPreferences.selectFormat}
                    profiles={netlistPreferences.preferences.profiles}
                    selectedProcess={netlistPreferences.selected}
                    onProcessChange={netlistPreferences.selectProfile}
                    onDeviceTargetChange={netlistPreferences.setDeviceTarget}
                    onReset={netlistPreferences.reset}
                    onCopy={() =>
                      void exportDesignNetlist(
                        netlistPreferences.format,
                        netlistNamingProfile,
                      )
                    }
                    configurationError={netlistPreferences.error}
                  />
                ) : projectPanel === "instances" ? (
                  <InstanceCodePanel
                    onDirtyChange={noteCodeDraftDirty}
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
                    key={projectSessionId}
                    onDirtyChange={noteCodeDraftDirty}
                    project={project}
                    selection={{
                      documentId: document.id,
                      instanceIds: visualSelection.instanceIds,
                    }}
                    onApply={(
                      source,
                      baseline,
                      { formatProjectCode, planProjectCodeCommit },
                    ) => {
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
                      onApply: (value, current, applyLabelSubscriptCase) => {
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
                          value.bulkDefaults.nmos !== current.bulkDefaults.nmos
                        )
                          edits.push(
                            ...planMosBulkDefaultUpdate(
                              project,
                              document,
                              "nmos",
                              propertiesMosBulkDefaultNetId(
                                document,
                                "nmos",
                                value.bulkDefaults.nmos,
                              ),
                            ),
                          );
                        if (
                          value.bulkDefaults.pmos !== current.bulkDefaults.pmos
                        )
                          edits.push(
                            ...planMosBulkDefaultUpdate(
                              project,
                              document,
                              "pmos",
                              propertiesMosBulkDefaultNetId(
                                document,
                                "pmos",
                                value.bulkDefaults.pmos,
                              ),
                            ),
                          );
                        if (
                          JSON.stringify(value.labels) !==
                          JSON.stringify(current.labels)
                        ) {
                          try {
                            commitProjectStructure(
                              applyLabelSubscriptCase(
                                project,
                                document.id,
                                value.labels.subscript_case,
                                resolver,
                                edits,
                                value.labels.subscript_italic,
                                {
                                  underscoreSubscript:
                                    value.labels.underscore_subscript,
                                  subscriptAfterFirst:
                                    value.labels.subscript_after_first,
                                  firstLetterItalic:
                                    value.labels.first_letter_italic,
                                },
                              ),
                              document.id,
                            );
                          } catch (error) {
                            const message =
                              error instanceof Error
                                ? error.message
                                : "Could not rename labels";
                            setStatus(message);
                            return { ok: false as const, message };
                          }
                        } else if (edits.length > 0 && !transact(edits).ok) {
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
              keptStyle={{
                kept: keptStyle,
                onRelease: () => {
                  if (!keptStyle) return;
                  const result = transact([
                    releaseKeptDocumentStyleEdit(keptStyle),
                  ]);
                  if (result.ok)
                    setStatus("The copy now uses this drawing's style");
                },
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
                  // A shared switch turns every component; a dictionary
                  // turns each one by its own entry.
                  const labels = groupVisibilityTargets(
                    value.display.visualAnnotation,
                    selectedGroupReferenceVisibility,
                    selectedIds,
                    selectedGroupContext.items,
                    (item) => item.reference,
                  );
                  if (labels.show.length > 0)
                    edits.push(
                      ...referenceLabelVisibilityEdits(labels.show, true),
                    );
                  if (labels.hide.length > 0)
                    edits.push(
                      ...referenceLabelVisibilityEdits(labels.hide, false),
                    );
                  const values = groupVisibilityTargets(
                    value.display.value,
                    selectedGroupValueVisibility,
                    selectedGroupValueInstances.map((instance) => instance.id),
                    selectedGroupContext.items,
                    (item) => item.value,
                  );
                  if (values.show.length > 0 || values.hide.length > 0) {
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
                      candidateDocument.instances.some(
                        (instance) =>
                          values.show.includes(instance.id) &&
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
                    if (values.show.length > 0)
                      edits.push(
                        ...valueVisibilityEdits(
                          candidateDocument,
                          values.show,
                          true,
                        ),
                      );
                    if (values.hide.length > 0)
                      edits.push(
                        ...valueVisibilityEdits(
                          candidateDocument,
                          values.hide,
                          false,
                        ),
                      );
                  }
                  // A name entry changed renames that component: a Pin
                  // through its Cell interface, any other part through its
                  // Reference.
                  const renamePlan = groupRenames(value, selectedGroupContext);
                  if (!renamePlan.ok)
                    return { ok: false, message: renamePlan.message };
                  const pinPlans: ProjectStructureEdit[][] = [];
                  for (const rename of renamePlan.renames) {
                    const terminal = document.netlist?.terminals.find(
                      (candidate) =>
                        candidate.interfaceInstanceIds.includes(
                          rename.instanceId,
                        ),
                    );
                    if (terminal)
                      pinPlans.push(
                        planRenameCellTerminal(
                          project,
                          document.id,
                          terminal.id,
                          rename.name,
                          { mergeExistingPort: true },
                        ),
                      );
                    else
                      edits.push({
                        kind: "set_instance_reference",
                        instanceId: rename.instanceId,
                        reference: rename.name,
                      });
                  }
                  // One name for them all: the part that has it, or the one
                  // selected first that can take it, carries it; the others
                  // show it as a display alias.
                  const batchName = groupBatchName(value);
                  let namingStatus: string | null = null;
                  if (batchName !== null) {
                    const naming = planGroupNaming({
                      project,
                      document,
                      resolver,
                      instanceIds: selectedIds,
                      name: batchName,
                      labelFor: instanceLabelAnnotationFor,
                      newLabelFor: (source, instanceId) =>
                        instanceDisplayEdits(source, resolver, [instanceId], {
                          showReference: true,
                        }).flatMap((edit) =>
                          edit.kind === "upsert_schematic_annotation"
                            ? [edit.annotation]
                            : [],
                        )[0],
                    });
                    if (!naming.ok)
                      return { ok: false, message: naming.message };
                    edits.push(...naming.edits);
                    if (naming.structure.length > 0)
                      pinPlans.push(naming.structure);
                    if (naming.edits.length > 0 || naming.structure.length > 0)
                      namingStatus = groupNamingStatus(batchName, naming);
                  }
                  const structureEdits = pinPlans.length
                    ? mergeRenamePlans(pinPlans)
                    : [];
                  if (!structureEdits)
                    return {
                      ok: false,
                      message: "Rename these Pins one at a time",
                    };
                  if (edits.length === 0 && structureEdits.length === 0)
                    return { ok: true };
                  let applied: boolean;
                  if (structureEdits.length > 0) {
                    // One project transaction and one undo step, as for a
                    // single component.
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
                      "apply-group-property-code",
                      structureEdits,
                    );
                  } else applied = transact(edits).ok;
                  if (applied) {
                    setStatus(
                      namingStatus ??
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
                        // A Cell Pin's authored interface name is independent
                        // of its optional canvas annotation and opaque ID.
                        displayName:
                          selectedFormalTerminal?.name ?? selectedDisplayName,
                        itemName:
                          selectedFormalTerminal?.name ??
                          selectedDisplayName ??
                          selectedInstance.reference ??
                          selectedInstance.id,
                        defaultForeground: styleProfile.foreground,
                        revision: document.revision,
                        // A Cell Pin's name label is shown or hidden like a
                        // device Reference, though the Pin has no Reference;
                        // a placed Cell's X1, though its block's Symbol has
                        // no designator (#1317).
                        referenceVisible:
                          selectedLabelRenderable &&
                          (instanceCarriesReference(
                            selectedInstance,
                            project,
                          ) ||
                            selectedFormalTerminal !== undefined)
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
                        supplyTerminals: selectedBuiltInSupplies?.map(
                          (supply) => {
                            const netId =
                              document.nets.find((net) =>
                                net.terminals.some(
                                  (terminal) =>
                                    terminal.instanceId ===
                                      selectedInstance.id &&
                                    terminal.pinName === supply,
                                ),
                              )?.id ?? "";
                            const auto = logicalSupplyNetChoice(
                              document,
                              supply === "VDD" ? "vdd" : "ground",
                            );
                            return {
                              pinName: supply,
                              netId,
                              options: [
                                {
                                  value: "",
                                  label: auto
                                    ? `Auto · ${auto.label}`
                                    : "Auto · unresolved",
                                  previewNetId: auto?.netId ?? null,
                                },
                                ...netChoices.map((choice) => ({
                                  value: choice.netId,
                                  label: choice.label,
                                  baseNetIds: choice.baseNetIds,
                                })),
                              ],
                            };
                          },
                        ),
                        onPreviewControlNet: (netId: string | null) =>
                          setControlOptionPreview(
                            netId
                              ? {
                                  documentId: document.id,
                                  instanceId: selectedInstance.id,
                                  netId,
                                }
                              : null,
                          ),
                        ...(LINEAR_CONTROLLED_SOURCE_KINDS.has(
                          selectedInstance.symbolId,
                        )
                          ? {
                              controlPick:
                                controlPickState?.instanceId ===
                                selectedInstance.id
                                  ? {
                                      step:
                                        controlPickState.kind === "current"
                                          ? controlPickState.positive
                                            ? ("current-negative" as const)
                                            : ("current-positive" as const)
                                          : controlPickState.positiveNetId
                                            ? ("negative" as const)
                                            : ("positive" as const),
                                    }
                                  : null,
                              ...(controlSummary ? { controlSummary } : {}),
                              currentTerminalOptions: currentControlOptions(
                                currentControlDevices,
                                (target) =>
                                  resolver
                                    .resolve(
                                      target.symbolId,
                                      target.symbolVariantId,
                                    )
                                    ?.definition.pins.map((pin) => pin.name) ??
                                  [],
                              ),
                              controlNetOptions: [
                                { value: "", label: "Select Net" },
                                ...netChoices.map((choice) => ({
                                  value: choice.netId,
                                  label: choice.label,
                                  baseNetIds: choice.baseNetIds,
                                })),
                              ],
                              controlDeviceOptions: [
                                { value: "", label: "Select device" },
                                ...currentControlDevices.map((instance) => ({
                                  value: instance.id,
                                  label: instance.reference ?? instance.id,
                                })),
                              ],
                              controlTerminalOptions: [
                                { value: "", label: "Select terminal" },
                                ...(() => {
                                  const control =
                                    selectedInstance.netlist?.control;
                                  const id =
                                    control?.kind === "terminal-current"
                                      ? control.instanceId
                                      : control?.kind === "current"
                                        ? control.sensorInstanceId
                                        : undefined;
                                  const target = currentControlDevices.find(
                                    (item) => item.id === id,
                                  );
                                  return target
                                    ? (
                                        resolver.resolve(
                                          target.symbolId,
                                          target.symbolVariantId,
                                        )?.definition.pins ?? []
                                      ).map((pin) => ({
                                        value: pin.name,
                                        label: `${target.reference ?? target.id}.${pin.name}`,
                                      }))
                                    : [];
                                })(),
                              ],
                              onStartControlPick: startControlPick,
                              onCancelControlPick: () => {
                                setControlPickState(null);
                                setSimulationHoverNetId(null);
                                setStatus("Cancelled control pick");
                              },
                            }
                          : {}),
                        onApply: (value: ComponentPropertyCodeValue) => {
                          try {
                            const plan = planPropertyApply(
                              {
                                project,
                                document,
                                resolver,
                                instance: selectedInstance,
                                currentTarget:
                                  selectedInstance.netlist?.binding?.kind ===
                                  "model"
                                    ? selectedInstance.netlist.binding.name
                                    : selectedReviewedExternalBinding
                                      ? (selectedExternalSubcircuit?.name ?? "")
                                      : "",
                              },
                              value,
                            );
                            if (plan.kind === "rejected")
                              return {
                                ok: false as const,
                                message: plan.message,
                              };
                            if (plan.kind === "unchanged") {
                              setStatus(
                                `Canvas properties for ${selectedInstance.id} are already up to date`,
                              );
                              return { ok: true as const };
                            }
                            const applied =
                              plan.kind === "structure"
                                ? commitStructure(
                                    "apply-component-property-code",
                                    plan.structureEdits,
                                  )
                                : plan.kind === "connectivity"
                                  ? (transactConnectivity(
                                      plan.intent,
                                      plan.edits,
                                      {
                                        expectedElectricalEffect:
                                          plan.expectedElectricalEffect,
                                      },
                                    )?.ok ?? false)
                                  : transact(plan.edits).ok;
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
                      onOpenModel: selectedExternalSubcircuit
                        ? () => {
                            setModelEditorDefinitionId(
                              selectedExternalSubcircuit.id,
                            );
                            setModelEditorLocation(undefined);
                            setCellManagerOpen(true);
                          }
                        : undefined,
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
                              selectedPropertyDevice?.symbolId ??
                                selectedInstance.symbolId,
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
                                  selectedPropertyDevice?.symbolId ??
                                    selectedInstance.symbolId,
                                  processReviewedLibrary(
                                    project,
                                    netlistPreferences.preferences,
                                  ),
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
                        // An edit made for one of several selected labels is
                        // made for all of them.
                        const batch = batchAnnotationEdits(
                          document,
                          selectedAnnotation,
                          annotation,
                          visualSelection.annotationIds,
                        );
                        const result = transact([
                          { kind: "upsert_schematic_annotation", annotation },
                          ...batch,
                        ]);
                        if (result.ok)
                          setStatus(
                            batch.length > 0
                              ? `Updated ${batch.length + 1} labels`
                              : "Updated annotation properties",
                          );
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
                        // An edit made for one of several selected drawing
                        // objects is made for every one that has the setting.
                        const batch = batchDraftingEdits(
                          document,
                          resolver,
                          annotationGrid,
                          selectedDrafting,
                          object,
                          visualSelection.draftingIds,
                        );
                        const result = transact([
                          { kind: "upsert_drafting_object", object },
                          ...batch,
                        ]);
                        if (result.ok)
                          setStatus(
                            batch.length > 0
                              ? `Updated ${batch.length + 1} drawing objects`
                              : "Updated drawing properties",
                          );
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
                selectedWireCount: visualSelection.routeIds.length,
                onApply: applyRouteProperties,
                onToggleHighlight: toggleHighlightedNet,
                // The Cell-aware Delete path: a Power Rail whose label is a
                // Cell Pin takes the pin along in one structural transaction.
                onDeleteWire: () => {
                  if (selectedRouteId)
                    deleteSelectionFromSelection({
                      routeIds: [selectedRouteId],
                    });
                },
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
                (agentSession.status !== "idle" ||
                  agentSession.error !== null) &&
                !agentStatusDismissed
                  ? {
                      status: agentSession.status,
                      claimCode: agentSession.claimCode,
                      claimExpiresAt: agentSession.claimExpiresAt,
                      scopes: agentSession.scopes,
                      expiresAt: agentSession.expiresAt,
                      error: agentSession.error,
                      backgroundRequests: agentSession.backgroundRequests,
                      onPause: () => void agentSession.pause(),
                      onResume: () => void agentSession.resume(),
                      onReconnect: agentSession.reconnect,
                      onNewConnection: () => void agentSession.newConnection(),
                      pendingOperation: agentSession.pendingOperation,
                      onRevoke: () => void agentSession.revoke(),
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
            tool === "arrow" ||
            tool === "polyline" ||
            tool === "construction-line" ||
            tool === "rectangle" ||
            tool === "circle"
              ? "drawing-mode"
              : "",
            projectedMovePreviewDocument ? "semantic-move-preview" : "",
            panPreview ? "pan-mode" : "",
            simulationPickNetsActive || controlPickMode === "net"
              ? "simulation-net-pick-active"
              : "",
            controlPickMode === "sensor" ? "control-sensor-pick-active" : "",
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
            document: renderedDocument,
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
            labelOwnerIds,
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
            highlight:
              simulationPickNetsActive || controlPickMode === "net"
                ? simulationPickHighlight
                : (controlOptionHighlight ??
                  codeNetHighlight ??
                  highlightedNet),
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
          labelTethers={labelTethers}
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
                  ...(pendingComponentPlacement.content
                    ? {
                        draftingContent: pendingComponentPlacement.content,
                        draftingAlignment:
                          pendingComponentPlacement.alignment ?? "middle",
                        draftingSizeScale:
                          pendingComponentPlacement.sizeScale ?? 1,
                      }
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
            netLabelPlacement: netLabelPlacement?.direction
              ? {
                  ...netLabelPlacement,
                  look: netLabelDirectionText(netLabelPlacement.direction),
                }
              : netLabelPlacement,
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
              ...(controlSensorCandidate ? { controlSensorCandidate } : {}),
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
                if (simulationPickActive || controlPickState) return;
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
                  beginInstanceFormulaEditing(instance, presentation);
                  return;
                }
                inspectInstance(instance.id);
              },
              onRoutePointerDown: (event, routeId) => {
                // Reached only while a drawing tool is up: the pointer tool's
                // presses are claimed and stopped by the capture-phase router.
                if (controlPickState) {
                  event.stopPropagation();
                  event.preventDefault();
                  const route = document.routes.find(
                    (candidate) => candidate.id === routeId,
                  );
                  if (route && controlPickMode === "net")
                    pickControlledSourceTarget({
                      kind: "net",
                      netId: route.netId,
                    });
                  return;
                }
                if (simulationPickActive) {
                  event.stopPropagation();
                  event.preventDefault();
                  if (simulationPickNetsActive) {
                    const route = document.routes.find(
                      (candidate) => candidate.id === routeId,
                    );
                    if (route) pickAnalogSimulationNet(route.netId);
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
                if (simulationPickNetsActive || controlPickMode === "net")
                  setSimulationHoverNetId(netId);
              },
              onNetPointerLeave: () => {
                if (simulationPickNetsActive || controlPickMode === "net")
                  setSimulationHoverNetId(null);
              },
            },
            endpoints: {
              ...(controlSensorCandidate ? { controlSensorCandidate } : {}),
              controlCurrentPreview:
                controlPickState?.kind === "current"
                  ? { ...controlPickState.positive, direction: "into" }
                  : selectedControl?.kind === "terminal-current"
                    ? selectedControl
                    : selectedControl?.kind === "current"
                      ? {
                          instanceId: selectedControl.sensorInstanceId,
                          pinName: "+",
                          direction: "into",
                        }
                      : null,
              document,
              endpoints:
                controlPickMode === "sensor"
                  ? wiringEndpoints.filter(
                      (candidate) =>
                        candidate.endpoint.kind === "terminal" &&
                        controlSensorCandidate?.(
                          candidate.endpoint.instanceId,
                          candidate.endpoint.pinName,
                        ),
                    )
                  : simulationPickTerminalsActive
                    ? wiringEndpoints.filter(
                        (candidate) =>
                          candidate.endpoint.kind === "terminal" &&
                          simulationCurrentEndpointKeys.has(
                            `${candidate.endpoint.instanceId}\u0000${candidate.endpoint.pinName}`,
                          ),
                      )
                    : wiringEndpoints,
              tool,
              selectedRoute:
                simulationPickActive || controlPickState
                  ? undefined
                  : selectedRoute,
              selectedRouteSegmentIndex,
              selectedEndpoint,
              supplementalJunctionIds: supplementalSelection.junctionIds,
              selectionPolicy:
                simulationPickActive || controlPickState
                  ? unfilteredSelectionPolicy
                  : selectionPolicy,
              endpointLabel: endpointTestId,
              ...(controlPickMode === "sensor"
                ? {
                    terminalPickState: (terminal: {
                      instanceId: string;
                      pinName: string;
                    }) =>
                      controlPickState?.kind === "current" &&
                      controlPickState.positive
                        ? controlPickState.positive.instanceId ===
                            terminal.instanceId &&
                          controlPickState.positive.pinName === terminal.pinName
                          ? ("origin" as const)
                          : ("partner" as const)
                        : ("candidate" as const),
                  }
                : simulationPickTerminalsActive
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
              // Normal editing keeps its four-unit reach. Current Pick alone
              // gets a wider screen-stable target; its nearest-terminal rule
              // resolves overlaps independently of SVG paint order.
              endpointHitRadius: screenScaleHitRadius(
                viewBox.width,
                DEFAULT_VIEWBOX.width,
                controlPickMode === "sensor" ? 10 : 4,
              ),
              onRouteStretch: beginRouteStretch,
              onJunctionSelect: (candidate) => {
                if (controlPickState) {
                  if (controlPickMode === "net" && candidate.netId)
                    pickControlledSourceTarget({
                      kind: "net",
                      netId: candidate.netId,
                    });
                  return;
                }
                if (simulationPickActive) {
                  if (simulationPickNetsActive && candidate.netId)
                    pickAnalogSimulationNet(candidate.netId);
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
                if (controlPickState) {
                  event.stopPropagation();
                  event.preventDefault();
                  if (controlPickMode === "net" && candidate.netId)
                    pickControlledSourceTarget({
                      kind: "net",
                      netId: candidate.netId,
                    });
                  else if (
                    controlPickMode === "sensor" &&
                    candidate.endpoint.kind === "terminal"
                  )
                    pickControlledSourceTarget({
                      kind: "terminal",
                      instanceId: candidate.endpoint.instanceId,
                      pinName: candidate.endpoint.pinName,
                    });
                  return;
                }
                if (simulationPickActive) {
                  event.stopPropagation();
                  event.preventDefault();
                  if (simulationPickTerminalsActive)
                    pickSimulationTerminal(candidate);
                  else if (candidate.netId)
                    pickAnalogSimulationNet(candidate.netId);
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
                if (simulationPickNetsActive || controlPickMode === "net")
                  setSimulationHoverNetId(netId);
              },
              onNetPointerLeave: () => {
                if (simulationPickNetsActive || controlPickMode === "net")
                  setSimulationHoverNetId(null);
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
            onHandlePointerDown: (event, object, handle) => {
              if (!selectionPolicy.allowsDrafting(object, "handle")) return;
              beginDraftingHandleDrag(event, object, handle);
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
            onTextEscape: escapeTextEditing,
            onTextCancel: () => {
              clearTextEditing();
              setStatus("Cancelled text changes");
            },
            onTextDelete: deleteTextEditing,
            onDisplayAliasChange: setTextDisplayAlias,
          }}
          textDraft={{
            draft: textDraft,
            viewBox,
            onChange: (change) =>
              setTextDraft((current) =>
                current ? { ...current, ...change } : current,
              ),
            onSubmit: submitTextDraft,
            onCancel: () => {
              setTextDraft(null);
              setStatus("Text cancelled");
            },
          }}
          notice={
            galleryDailyLimit ? (
              <GalleryDailyLimitCard
                limit={galleryDailyLimit}
                onBackToGallery={leaveForGallery}
                onClose={() => setGalleryDailyLimit(null)}
              />
            ) : null
          }
        />
        {canvasContextMenu ? (
          <EditorCanvasContextMenu
            canvasContextMenu={canvasContextMenu}
            setCanvasContextMenu={setCanvasContextMenu}
            visualSelection={visualSelection}
            hasHierarchyEnterSelection={hasHierarchyEnterSelection}
            alignmentParticipantCount={alignmentParticipantCount}
            enterSelectedHierarchy={enterSelectedHierarchy}
            openSelectedComponentDefinition={openSelectedComponentDefinition}
            hasDefinitionSelection={hasDefinitionSelection}
            editorCommands={editorCommands}
          />
        ) : null}
      </div>
      <EditorComponentEditor
        project={project}
        projectSessionId={projectSessionId}
        resolver={resolver}
        dispatchProjectTransaction={dispatchProjectTransaction}
        externalSubcircuitInsertCandidates={externalSubcircuitInsertCandidates}
        setExternalSubcircuitDefinition={setExternalSubcircuitDefinition}
        removeExternalSubcircuitDefinition={removeExternalSubcircuitDefinition}
        copyText={(text) => exportDelivery.copyText(text)}
        onBeforePlace={() => {
          setCellManagerOpen(false);
          setModelEditorDefinitionId(null);
        }}
        capabilities={capabilities}
        setStatus={setStatus}
        componentEditor={componentEditor}
        setComponentEditor={setComponentEditor}
        componentLibraryRefresh={componentLibraryRefresh}
        setComponentLibraryRefresh={setComponentLibraryRefresh}
        userComponentsOpen={userComponentsOpen}
        setUserComponentsOpen={setUserComponentsOpen}
        commitProjectStructure={commitProjectStructure}
        editorDocumentController={editorDocumentController}
        synchronizeExternalCommit={synchronizeExternalCommit}
        definitionProjectRef={definitionProjectRef}
        selectOnly={selectOnly}
        cancelAllTransientInteraction={cancelAllTransientInteraction}
        editorCommands={editorCommands}
      />
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
        agentExpiring={
          agentSession.expiringSoon &&
          agentSession.status !== "expired" &&
          agentSession.status !== "revoked"
            ? { onKeep: agentSession.keepConnected }
            : null
        }
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
        onWireRoutingModeChange={(routingMode) =>
          chooseWireShape({ routingMode })
        }
        onWireCornerOrderChange={(cornerOrder) =>
          chooseWireShape({ cornerOrder })
        }
        onOpenAnalytics={() => {
          void guardDirtyReplacement("Open Analytics", async (discarded) => {
            if (discarded) await dropDiscardedWork();
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
