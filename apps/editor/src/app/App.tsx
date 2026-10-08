import { parseProject, serializeProject } from "@icm/project-protocol";
import { flushSync } from "react-dom";
import type {
  RecentProjectFile,
  NativeSaveOutcome,
} from "../hosts/native-project-store";
import {
  createProjectWorkspaceStore,
  holdWorkspaceWindow,
  journalProjectWorkspace,
  openWorkspaceWindows,
  workspaceWindowId,
  type ProjectWorkspace,
} from "../document/project-workspace";
import {
  findWorkspaceReopenOffer,
  type WorkspaceReopenSummary,
} from "../document/workspace-reopen";
import { resolveAnnotationName } from "@icm/derived";
import {
  branchGalleryVersion,
  loadGalleryVersionProject,
} from "../components/gallery-version-project";
import { InstanceCodePanel } from "../features/properties/instance-code-panel";
import { NetlistCodePanel } from "../features/netlist-export/netlist-code-panel";
import { NetlistProfileCode } from "../features/netlist-export/netlist-profile-code";
import {
  useNetlistExportPreferences,
  type NetlistExportPreferences,
} from "../features/netlist-export/netlist-export-preferences";
import {
  placementModelTarget,
  placementProcessFill,
  processPlacementTarget,
  processReviewedLibrary,
  planNetlistProcess,
  prepareNetlistExample,
  processTargetForShortName,
} from "../features/netlist-export/netlist-process";
import {
  DEFAULT_ARROW_PRESET,
  type ArrowPreset,
} from "../features/drafting/arrow-presets";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentDefinition, Instance } from "@icm/model";
import type { SharedComponent } from "../features/user-components/component-library-contract";
import { publishedDefinition } from "../features/user-components/component-library-contract";
import {
  newComponentDefinition,
  sharedComponentInsertRequest,
} from "../features/user-components/component-definition-edit";

const loadNativeProjectWorkspace = () =>
  import("../hosts/native-project-workspace");

const UserComponentsLibrary = lazy(
  () => import("../features/user-components/user-components-library"),
);

interface ComponentEditorSession {
  key: string;
  definition: ComponentDefinition;
  mode: "new" | "instance" | "library";
  entry?: SharedComponent;
  target?: { projectSessionId: string; documentId: string; instance: Instance };
}
import type { CSSProperties } from "react";
import "../styles/editor-entry.css";
import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";
import {
  instanceValueAnnotation,
  planProjectCellImport,
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
import { clipboardPreviewDocument } from "../features/clipboard/clipboard";
import {
  prepareProjectCopy,
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import type {
  AgentProjectResourceRequest,
  AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import { clipboardPlacementAnchor } from "../features/clipboard/clipboard";
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
import {
  deriveSimulationProbeOptions,
  simulationProbeHierarchyPath,
} from "../features/simulation/simulation-probe-options";
import {
  sameSimulationOccurrence,
  terminalCurrentDirectionPartners,
} from "../features/simulation/terminal-current-pick";
import { PUBLIC_SIMULATION_UI_ENABLED } from "../features/simulation/public-simulation-ui";
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
import { LazyProjectCodePanel as ProjectCodePanel } from "./lazy-editor-dialogs";
import { LazySpiceSimulationSurface } from "./lazy-editor-dialogs";
import { LazyExamplesPanel as ExamplesPanel } from "./lazy-editor-dialogs";
import { LazyComponentDefinitionEditor as ComponentDefinitionEditor } from "./lazy-editor-dialogs";
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
import {
  type GalleryEntryContext,
  createGalleryExampleCommands,
} from "../features/editor-shell/gallery-example-commands";
import { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import {
  createProjectStructureCommands,
  cellPlacementIssue,
} from "../features/hierarchy/project-structure-commands";
import { loadCloudProjectForCellImport } from "../features/hierarchy/cloud-cell-import";
import type { PublishGalleryDraft } from "../features/editor-shell/publish-gallery-dialog";
import {
  publishProjectToGallery,
  updateGalleryEntry,
  canUpdateGalleryPublication,
  loadGalleryPublicationContext,
  loadGalleryQuota,
  type GalleryPublicationRecord,
  type GalleryQuota,
} from "../features/editor-shell/gallery-publish";
import {
  announceGalleryChange,
  localhostExamplesEnabled,
  primeGalleryPreview,
  subscribeGalleryRefresh,
} from "../gallery-client";
import { projectWithTopologyRoot } from "../features/editor-shell/gallery-topology-project";
import { LazyGalleryTopologyTaskNotice as GalleryTopologyTaskNotice } from "./lazy-editor-dialogs";
import { LazyGalleryPublishedNotice as GalleryPublishedNotice } from "./lazy-editor-dialogs";
import type { GalleryPublishedNoticeState } from "../features/editor-shell/gallery-published-notice";
import type { SessionUser } from "../components/account";
import {
  evaluateSubmissionGates,
  type SubmissionGateReport,
} from "@icm/derived";
import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import { useProjectTabs } from "../document/use-project-tabs";
import { ProjectTabs } from "../features/editor-shell/project-tabs";
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
import {
  resolveEditorShortcut,
  shouldConsumeEditorEscape,
  stepBoundedScale,
} from "../interaction/editor-shortcuts";
import { createEditorCommandRouter } from "../commands/editor-command";
import { createEditorTransactionCommands } from "./editor-transaction-commands";
import { recoveryStateLabel } from "../components/recovery-banners";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import type { BrowserAgentPlanningContext } from "../agent/browser-agent-command";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { BrowserAgentSimulationHost } from "../agent/browser-agent-simulation-host";
import { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import {
  createAgentGalleryPublisher,
  type AgentGalleryPublication,
} from "../agent/agent-gallery-publish";
import { BrowserSimulationSession } from "../features/simulation/browser-simulation-session";
import { ProjectRunHistory } from "../features/simulation/project-run-history";
import { createAgentSemanticIntentHandler } from "../agent/agent-semantic-intent-handler";
import { PUBLIC_AGENT_UI_ENABLED } from "../agent/public-agent-ui";
import {
  useEditorAgentSession,
  WorkspaceAgentProvider,
} from "../agent/workspace-agent";
import type { UseAgentSessionOptions } from "../agent/use-agent-session";
import { peekAgentSessionRecovery } from "../agent/session-recovery";
export { WorkspaceAgentProvider } from "../agent/workspace-agent";
import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
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
import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";
import { projectChangeToken } from "../document/project-session-lifecycle";
import { captureProjectSaveSnapshot } from "../document/project-save-coordinator";
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
import {
  hasResettableLabels,
  resetLabelLookEdits,
} from "../features/instance-display/reset-label-look";
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
import { EDGE_ALIGNMENT_MODES } from "../features/selection/align-selection";
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

let workspaceStore: ReturnType<typeof createProjectWorkspaceStore> | undefined;
function browserWorkspaceStore() {
  return (workspaceStore ??= createProjectWorkspaceStore());
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

/**
 * Takes `new=1` out of the address once the new circuit is open. The address
 * is what the window's tabs are saved under, so a refresh then brings back
 * what was drawn, and only a fresh New Circuit starts another.
 */
function forgetNewProjectRequest(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("new") !== "1") return;
  url.searchParams.delete("new");
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
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
  const [, setGalleryRefreshSignal] = useState(0);
  const galleryLoadGenerationRef = useRef(0);
  useEffect(() => {
    if (!capabilities.community || !visibleLibraryPanelOpen) return;
    return subscribeGalleryRefresh(() => {
      galleryLoadGenerationRef.current += 1;
      setGalleryRefreshSignal((previous) => previous + 1);
    });
  }, [capabilities.community, visibleLibraryPanelOpen]);

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
  const [agentStartupRecovery] = useState(() => {
    if (
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
        undefined,
        agentPlanning,
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
  const [publishGalleryOpen, setPublishGalleryOpen] = useState(false);
  // Opened from the duplicate check's notice, which asks for that check's
  // results whatever circuit it checked (#1417).
  const [openedFromCheckNotice, setOpenedFromCheckNotice] = useState(false);
  const [publishedNotice, setPublishedNotice] =
    useState<GalleryPublishedNoticeState | null>(null);
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
    if (!projectStore) {
      setCloudProjectsReady(true);
      return;
    }
    const request = ++cloudListRequestRef.current;
    const mutationAtStart = cloudListMutationRef.current;
    const outcome = await projectStore.list();
    if (request !== cloudListRequestRef.current) return;
    setCloudProjectsReady(true);
    if (outcome.status !== "listed") return;
    // A Save or Delete acknowledged after this request began is newer than
    // the response, so the stale list must not erase that mutation.
    if (mutationAtStart !== cloudListMutationRef.current) return;
    setCloudProjects(outcome.projects);
  }, [projectStore]);
  const [galleryEntryContext, setGalleryEntryContext] =
    useState<GalleryEntryContext | null>(null);
  const [publicationLinkLoading, setPublicationLinkLoading] = useState(false);
  const [publicationLinkError, setPublicationLinkError] = useState<
    string | null
  >(null);
  const [publicationLinkNotice, setPublicationLinkNotice] = useState<
    string | null
  >(null);
  const [publicationLinkRetry, setPublicationLinkRetry] = useState(0);
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
    if (!identity) return;
    void identity.getSessionUser().then(async (user) => {
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
  }, [identity, reloadCloudProjects]);

  useEffect(() => {
    if (!publishSession) return;
    const refreshAfterReturning = () => void reloadCloudProjects();
    window.addEventListener("focus", refreshAfterReturning);
    return () => window.removeEventListener("focus", refreshAfterReturning);
  }, [publishSession, reloadCloudProjects]);

  const [publishQuota, setPublishQuota] = useState<GalleryQuota | null>(null);
  // What the account may still publish today, read each time the dialog opens.
  const publishAccountId = publishSession?.id ?? null;
  useEffect(() => {
    // An earlier count is no promise for this opening: say nothing until read.
    setPublishQuota(null);
    if (!publishGalleryOpen || !publishAccountId) return;
    let cancelled = false;
    void loadGalleryQuota().then((quota) => {
      if (!cancelled) setPublishQuota(quota);
    });
    return () => {
      cancelled = true;
    };
  }, [publishGalleryOpen, publishAccountId]);
  useEffect(() => {
    if (!publishGalleryOpen) return;
    let cancelled = false;
    if (!identity) return;
    void identity.getSessionUser().then((user) => {
      if (!cancelled) setPublishSession(user);
    });
    // The same evaluator the worker enforces, run live on the open Project.
    setPublishGates(evaluateSubmissionGates(project, resolver));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluated once per dialog open
  }, [identity, publishGalleryOpen]);
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
      resources.get(resourceKey)?.files ??
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
        getActiveDocumentId: () => editorDocumentController.document.id,
        commitProjectStructure: (next, active) =>
          browserAgentHost.commitProjectStructure(next, active),
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
      }),
    [editorDocumentController, resourceKey, simulationTransport],
  );
  const projectRunHistory = useMemo(
    () =>
      resources.get(resourceKey)?.history ??
      new ProjectRunHistory(editorDocumentController.project.id),
    [editorDocumentController, resourceKey],
  );
  useEffect(() => {
    projectRunHistory.activate();
  }, [projectRunHistory]);
  const browserAgentSimulationHost = useMemo(
    () =>
      resources.get(resourceKey)?.simulation ??
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
      resourceKey,
      simulationTransport,
    ],
  );
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
  const [codeDraftDirty, setCodeDraftDirty] = useState(false);
  const noteCodeDraftDirty = useCallback((dirty: boolean) => {
    setCodeDraftDirty(dirty);
  }, []);
  const openProjectInTabRef = useRef<
    (
      project: CircuitProject,
      view: GridRect,
      options: ReplaceProjectOptions,
      background?: boolean,
    ) => Promise<boolean>
  >(async () => false);
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
  useEffect(() => {
    let cancelled = false;
    setPublicationLinkError(null);
    setPublicationLinkNotice(null);
    if (
      !capabilities.community ||
      !projectStore ||
      !cloudBinding ||
      galleryEntryContext
    ) {
      setPublicationLinkLoading(false);
      return;
    }
    setPublicationLinkLoading(true);
    void (async () => {
      try {
        // Read current metadata even for recovery: another tab may have changed the source.
        const listed = await projectStore.list();
        const saved =
          listed.status === "listed"
            ? listed.projects.find((item) => item.id === cloudBinding.id)
            : null;
        if (!saved)
          throw new Error(
            "Could not load the saved Project’s publication link. Retry before publishing.",
          );
        const entryId = saved.galleryEntryId ?? null;
        const context = entryId
          ? await loadGalleryPublicationContext(entryId, project.id)
          : null;
        if (cancelled) return;
        noteGalleryPublication(entryId);
        if (context) {
          setGalleryEntryContext(context);
        } else if (entryId) {
          setPublicationLinkNotice(
            "The original Gallery entry is unavailable. Publishing creates a new entry; the Shelf draft is preserved.",
          );
        }
      } catch (error) {
        if (!cancelled)
          setPublicationLinkError(
            error instanceof Error
              ? error.message
              : "Could not load the publication link.",
          );
      } finally {
        if (!cancelled) setPublicationLinkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cloudBinding?.id,
    projectSessionId,
    galleryEntryContext,
    publicationLinkRetry,
    projectStore,
  ]);

  const linkExistingPublication = async (input: string): Promise<void> => {
    const match = input
      .trim()
      .match(/^(?:https?:\/\/[^/]+)?\/g\/([^/?#]+)(?:[?#].*)?$/u);
    const id = match?.[1] ?? input.trim();
    if (!/^[a-zA-Z0-9-]+$/u.test(id))
      throw new Error("Paste a Gallery link or entry id.");
    const sessionId = editorDocumentController.projectSessionId;
    const context = await loadGalleryPublicationContext(id, project.id);
    if (!context || !canUpdateGalleryPublication(context, publishSession))
      throw new Error("Choose a Gallery entry you own or may edit.");
    if (sessionId !== editorDocumentController.projectSessionId)
      throw new Error("The active Project changed. Reopen Publish.");
    setGalleryEntryContext(context);
  };

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
  const agentSession = useEditorAgentSession({
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
    resolveWorkspace: (workspaceId) => agentTargetRef.current(workspaceId),
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
  const [codeNetPreview, setCodeNetPreview] =
    useState<HighlightedNetOrigin | null>(null);
  const [controlOptionPreview, setControlOptionPreview] = useState<{
    documentId: string;
    instanceId: string;
    netId: string;
  } | null>(null);
  const [simulationPickMode, setSimulationPickModeState] = useState<
    "net" | "terminal" | null
  >(null);
  const [controlPickState, setControlPickState] =
    useState<ControlPickState | null>(null);
  const controlPickMode =
    controlPickState?.kind === "voltage"
      ? "net"
      : controlPickState?.kind === "current"
        ? "sensor"
        : null;
  const simulationPickNetsActive = simulationPickMode === "net";
  const simulationPickTerminalsActive = simulationPickMode === "terminal";
  const simulationPickActive = simulationPickMode !== null;
  const [simulationHoverNetId, setSimulationHoverNetId] = useState<
    string | null
  >(null);
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
  useEffect(() => {
    // Net-pick is a hierarchy traversal mode: keep it armed while the author
    // enters a DUT Cell, so an internal Net can be picked with its occurrence
    // path intact. Closing/minimising Simulation still cancels it explicitly.
    if (!analogSimulationOpen) setSimulationPickModeState(null);
    setSimulationTerminalPickStart(null);
    setSimulationHoverNetId(null);
    setControlPickState(null);
  }, [document.id]);
  useEffect(() => {
    setSimulationPickModeState(null);
    setAnalogPickedNet(null);
    setAnalogPickedTerminal(null);
    setSimulationTerminalPickStart(null);
    setControlPickState(null);
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
  const simulationPickHighlight = useMemo(
    () =>
      (simulationPickNetsActive || controlPickMode === "net") &&
      simulationHoverNetId
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
      controlPickMode,
    ],
  );
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
  const pickAnalogSimulationNet = (netId: string): void => {
    const baseNetId = canonicalSimulationNetId(netId);
    if (!baseNetId) {
      setStatus(`Could not resolve Net ${netId}`);
      return;
    }
    const group = logicalNets.byBaseNetId.get(baseNetId);
    const occurrence = activeSimulationPickOccurrence();
    setAnalogPickedNet((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      documentId: document.id,
      netId: baseNetId,
      ...(occurrence === undefined ? {} : { occurrence }),
    }));
    setStatus(`Added voltage Output ${group?.name ?? baseNetId}`);
  };
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
    if (mode) setControlPickState(null);
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
    completeVisualSelectionMove,
    snapCoordinate,
    annotationGrid,
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

  // A Gallery URL is an explicit open intent, even when another project tab
  // was active when this browser window last saved its workspace.
  const restoredGalleryLink = useRef(
    capabilities.community && restoredWorkspace && !restoreAfterRefresh
      ? initialGalleryEntryId
      : null,
  );
  const restoredCloudLink = useRef(
    restoredWorkspace && !restoreAfterRefresh && !initialGalleryEntryId
      ? new URLSearchParams(window.location.search).get("project")
      : null,
  );
  // So is New Circuit: it opens a new tab beside the ones brought back,
  // rather than showing the circuit this window drew last.
  const restoredNewLink = useRef(
    restoredWorkspace !== null &&
      !restoreAfterRefresh &&
      bootRequestsNewProject,
  );

  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (!capabilities.community || bootTargetHandled.current) return;
    bootTargetHandled.current = true;
    // A safe recovery refresh reloads the same URL: the pending restore owns
    // this boot. Re-running the URL's boot target here would fork the
    // working-copy identity and orphan the snapshot the restore is about to
    // read.
    if (restoreAfterRefresh || restoredWorkspace) return;
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    // A tile on the shelf opens straight into its Project.
    const shelfProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );
    const requestsNewProject = bootRequestsNewProject;
    if (initialGalleryEntryId) {
      void openGalleryEntryById(initialGalleryEntryId, false, true);
      return;
    }
    const historySearch = new URLSearchParams(window.location.search);
    const historyEntryId = historySearch.get("history");
    if (historyEntryId) {
      const versionId = historySearch.get("version");
      const versionNo = Number(historySearch.get("versionNo"));
      if (!versionId || !Number.isInteger(versionNo) || versionNo < 1) {
        setStatus("Invalid historical branch link");
        return;
      }
      setStatus("Opening historical version as a new branch…");
      void loadGalleryVersionProject(historyEntryId, versionId)
        .then(async (snapshot) => {
          await openProjectInTabRef.current(
            branchGalleryVersion(snapshot, versionNo),
            DEFAULT_VIEWBOX,
            { source: "opened-file", persistenceState: "dirty" },
          );
        })
        .catch((error: unknown) =>
          setStatus(error instanceof Error ? error.message : String(error)),
        );
      return;
    }
    if (requestsNewProject) {
      replaceActiveProject(preparedInitialProject, DEFAULT_VIEWBOX);
      setStatus("Created a new Project");
      return;
    }
    if (shelfProjectId) {
      setStatus("Opening your Cloud Project…");
      void openCloudProjectById(shelfProjectId, true);
      return;
    }
    if (exampleId) {
      if (!localhostExamplesEnabled()) {
        setStatus("Built-in examples are available only on localhost");
        return;
      }
      void import("../examples/library-examples")
        .then(({ createLibraryExampleProject, libraryProjectExamples }) => {
          const exampleProject = createLibraryExampleProject(exampleId);
          const example = libraryProjectExamples.find(
            (candidate) => candidate.id === exampleId,
          );
          if (!exampleProject || !example) return;
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
        })
        .catch(() => {
          setStatus("Built-in example could not load");
        });
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

  function openSelectedComponentDefinition(): void {
    if (!capabilities.community) {
      setStatus("Shared component editing is unavailable in this preview");
      return;
    }
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

  function componentEditPlan(
    definition: ComponentDefinition,
    planComponentDefinitionEdit: typeof import("../features/user-components/component-definition-plan").planComponentDefinitionEdit,
  ) {
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
        agentEdited: true,
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
      propertiesOpen: selectionOpen && !documentSettingsOpen,
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
        if (getCurrentInteractionState().kind === "copy-placement") {
          setStatus("Copy placement is already active · Esc cancels");
          return;
        }
        if (!hasVisualSelection(visualSelection)) {
          armVerb("copy");
          return;
        }
        void circuitClipboard.copySelection(true);
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

  useEffect(() => {
    function dismissOnOutsidePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetElement =
        target instanceof Element ? target : target.parentElement;
      if (
        textEditing &&
        !targetElement?.closest(
          '[data-testid="canvas-text-editor"], [data-canvas-text-editor-part]',
        )
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
  }, [textEditing, document]);

  const shortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (versionHistoryOpen) return;
      // Project Info is modal: the canvas never handles its keys.
      // This router sees Escape first, so it closes the dialog here.
      if (projectInfoOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setProjectInfoOpen(false);
        }
        return;
      }
      if (
        event.target instanceof Element &&
        (event.target.closest(".project-tab-name-input") ||
          event.target.closest(".gallery-topology-comparison") ||
          (event.target.closest(".project-menu") &&
            ["Escape", "ArrowUp", "ArrowDown", "Home", "End"].includes(
              event.key,
            )) ||
          (event.target.closest(".project-tabs") &&
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)))
      )
        return;
      if (componentEditor) return;
      if (userComponentsOpen) {
        if (event.key === "Escape") setUserComponentsOpen(false);
        return;
      }
      // The source workbench owns its keyboard scope, including portalled menus.
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".simulation-code-workspace, [data-workspace-interaction], .inline-confirm",
        )
      )
        return;
      // The interface confirmation owns keys even though this router captures
      // at window level before the modal's React handlers.
      if (interfaceConfirmation) return;
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
      if (event.key === "Escape" && controlPickState) {
        event.preventDefault();
        setControlPickState(null);
        setSimulationHoverNetId(null);
        setStatus("Cancelled control pick");
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "Escape" && recoveryDialogOpen) {
        // This router runs first, at window level: close the dialog here, as
        // for Search, or Escape never reaches the dialog's own handler.
        event.preventDefault();
        setRecoveryDialogOpen(false);
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
        // Valid drafts commit; invalid drafts must still let the user leave.
        escapeTextEditing();
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
        netLabelTurn:
          netLabelPlacement?.phase === "placing"
            ? "placing"
            : document.annotations.some(
                  (annotation) =>
                    annotation.kind === "net-label" &&
                    !annotation.locked &&
                    visualSelection.annotationIds.includes(annotation.id),
                )
              ? "selection"
              : undefined,
        hasInspectableSelection,
        hasHighlightableNet: selectedHighlightNetId !== null,
        hasActiveNetHighlight: highlightedNetOrigin !== null,
        wireReadyToFinish: Boolean(wireSource && wirePreviewPoint),
        draftingReadyToFinish:
          (tool === "arrow" ||
            tool === "polyline" ||
            tool === "construction-line" ||
            tool === "rectangle" ||
            tool === "circle") &&
          draftingSource !== null,
        hasRemovableWireWaypoint: Boolean(
          wireSource && wireDraftSteps.length > 0,
        ),
        propertiesOpen: selectionOpen && !documentSettingsOpen,
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
      if (escapeIntent && shouldConsumeEditorEscape(currentInteraction.kind)) {
        // Placement, copy and drawing modes own Escape. Safari otherwise lets
        // the key continue to its browser/full-screen shortcut after the
        // editor cancels the gesture, which can close the surrounding browser
        // UI. Consume the event only while an editor interaction is active;
        // an idle Escape remains available to the browser.
        event.preventDefault();
        event.stopPropagation();
        if (
          globalThis.document.fullscreenElement &&
          typeof globalThis.document.exitFullscreen === "function"
        ) {
          void globalThis.document.exitFullscreen().catch(() => {
            // Fullscreen may already have been closed by the browser.
          });
        }
      } else if (!escapeIntent) event.preventDefault();

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
        case "paste-selection":
          void circuitClipboard.pasteSelection();
          return;
        case "save":
          void (nativeProjectStore
            ? saveProjectToNative()
            : projectStore
              ? saveProjectToCloud()
              : exportProjectFile());
          return;
        case "open":
          if (nativeProjectStore) void openNativeProject();
          else projectInputRef.current?.click();
          return;
        case "turn-net-labels":
          turnNetLabels();
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
        case "cycle-wire-corner":
          cycleWireCornerShape();
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
    shortcutHandlerRef.current = onKeyDown;
  });
  useEffect(() => {
    // Keep the listener installed while a canvas preview flush publishes state
    // earlier in the same key event. Replacing it would drop that Enter event.
    const dispatch = (event: KeyboardEvent) =>
      shortcutHandlerRef.current(event);
    window.addEventListener("keydown", dispatch, true);
    return () => window.removeEventListener("keydown", dispatch, true);
  }, []);

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
  const workspaceLastText = useRef("");
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
      const tabs = workspace.tabs.map(({ id, session }) => {
        const { controller, cellViews, ...rest } = session;
        const portable: PortableTab = {
          ...rest,
          cellViews: [...cellViews],
          projectText: snapshotSerializer.serialize(controller.project),
          activeDocumentId: controller.document.id,
          agentEdited: controller.agentEdited,
        };
        return { id, session: portable };
      });
      const text = JSON.stringify({ activeId: workspace.activeId, tabs });
      if (text !== workspaceLastText.current) {
        const record: ProjectWorkspace = {
          version: 1,
          windowId: workspaceWindowId(),
          url: window.location.pathname + window.location.search,
          savedAt: Date.now(),
          activeId: workspace.activeId,
          tabs,
        };
        workspaceLastText.current = text;
        workspaceLastRecord.current = record;
        workspaceSaveQueue.current = workspaceSaveQueue.current
          .then(() => browserWorkspaceStore().write(record))
          .then(
            () => releaseReopenedWorkspace(record),
            () => {
              workspaceLastText.current = "";
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
      if (
        isSaveInFlight() ||
        nativeWorkspaceSaving.current ||
        replaceGuard ||
        recoveryDialogOpen ||
        publishGalleryOpen ||
        componentEditor ||
        documentSettingsOpen ||
        versionHistoryOpen ||
        projectInfoOpen ||
        projectNameEditing.current ||
        textEditing ||
        codeDraftDirty
      ) {
        setStatus(
          "Finish or cancel the current edit or dialog before switching project tabs. No work was discarded.",
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
      await flushRecovery();
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
    let incoming: {
      session: TabSession;
      cloudId: string | null;
      active: boolean;
    }[];
    try {
      incoming = offer.record.tabs
        .map((tab) => {
          const saved = tab.session as PortableTab;
          return {
            session: tabSessionFromPortable(saved),
            cloudId: saved.file.cloudBinding?.id ?? null,
            active: tab.id === offer.record.activeId,
          };
        })
        .filter(({ cloudId }) => !cloudId || !openCloudIds.has(cloudId));
    } catch {
      setWorkspaceReopen(null);
      setStatus(
        "Those tabs could not be reopened. Their recovery copies are kept: File → Recover Unsaved Work…",
      );
      return;
    }
    if (!incoming.length) {
      // Every one of them is open here already.
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
    setStatus(
      incoming.length === 1
        ? "Reopened 1 tab from your last window"
        : `Reopened ${incoming.length} tabs from your last window`,
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
  openGalleryProjectInTabRef.current = (next, view, context) => {
    // A fresh deep link has only a boot placeholder, not a user Project to
    // preserve. Fill it so opening a Gallery circuit does not leave an empty
    // extra tab; restored workspaces always take the additive path below.
    if (
      !restoredWorkspace &&
      initialGalleryEntryId === context.id &&
      projectTabs.tabs.length === 1 &&
      project.id === preparedInitialProject.id &&
      !isDirtyWork() &&
      !hasUnsafeWork() &&
      !codeDraftDirty
    ) {
      replaceActiveProject(next, view);
      setGalleryEntryContext(context);
      return Promise.resolve(true);
    }
    return projectTabs.open(
      () => ({
        ...createTabSession(next, view, {
          source: "opened-file",
          persistenceState: "unbound",
        }),
        publication: context,
      }),
      null,
      context.id,
    );
  };
  useEffect(() => {
    const entryId = restoredGalleryLink.current;
    if (restoringWorkspace || !entryId) return;
    const matching = projectTabs
      .entries()
      .find(({ session }) => session.publication?.id === entryId);
    if (matching && matching.id !== projectTabs.activeId) {
      void projectTabs.select(matching.id).then((selected) => {
        if (!selected) restoredGalleryLink.current = null;
      });
      return;
    }
    restoredGalleryLink.current = null;
    if (!matching) {
      void openGalleryEntryById(entryId, false, true);
    } else if (
      !matching.session.dirty &&
      !matching.session.unsafe &&
      !codeDraftDirty
    ) {
      void refreshGalleryEntry(matching.session.publication!);
    }
  }, [restoringWorkspace, projectTabs.activeId]);
  useEffect(() => {
    const cloudId = restoredCloudLink.current;
    if (restoringWorkspace || !cloudId) return;
    restoredCloudLink.current = null;
    void openCloudProjectById(cloudId, true);
  }, [restoringWorkspace]);
  useEffect(() => {
    if (restoringWorkspace || !restoredNewLink.current) return;
    restoredNewLink.current = false;
    forgetNewProjectRequest();
    // Tabs that could not be restored leave their message standing.
    if (restoredTabs.value) setStatus("Created a new Project");
  }, [restoringWorkspace]);
  useEffect(() => {
    // A new circuit this window opened fresh is simply the working one now.
    if (bootRequestsNewProject && !restoredNewLink.current)
      forgetNewProjectRequest();
  }, []);
  const [recentNativeFiles, setRecentNativeFiles] = useState<
    RecentProjectFile[]
  >([]);
  const [nativeBusy, setNativeBusy] = useState(false);
  const nativeOperation = useRef(false);
  const nativeWorkspaceSaving = useRef(false);
  const refreshNativeFiles = async () => {
    if (!nativeProjectStore) return;
    try {
      setRecentNativeFiles(await nativeProjectStore.recent());
    } catch (error) {
      setStatus(`Recent Projects unavailable: ${String(error)}`);
    }
  };
  async function openNativeProject(recentId?: string) {
    if (!nativeProjectStore || nativeOperation.current || isSaveInFlight())
      return;
    nativeOperation.current = true;
    setNativeBusy(true);
    try {
      const { openNativeFile } = await loadNativeProjectWorkspace();
      await openNativeFile(
        nativeProjectStore,
        {
          entries: projectTabs.entries,
          select: projectTabs.select,
          open: openProjectFile,
          report: setStatus,
        },
        recentId,
      );
      await refreshNativeFiles();
    } finally {
      nativeOperation.current = false;
      setNativeBusy(false);
    }
  }
  function closeNativeTab(id: string) {
    return closeNativeTabs([id]);
  }
  /** Closes native tabs, releasing each closed tab's file. */
  async function closeNativeTabs(ids: readonly string[]) {
    const bindings = projectTabs
      .entries()
      .filter((entry) => ids.includes(entry.id))
      .flatMap(({ id, session }) =>
        session.file.nativeBinding
          ? [{ id, binding: session.file.nativeBinding }]
          : [],
      );
    await projectTabs.closeMany(ids, () => createTabSession());
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    for (const { id, binding } of bindings)
      if (!projectTabs.entries().some((entry) => entry.id === id))
        await nativeProjectStore?.release(binding.id);
  }
  async function saveNativeTab(id: string): Promise<NativeSaveOutcome> {
    if (!nativeProjectStore)
      return { status: "failed", message: "Local storage is unavailable" };
    if (id === projectTabs.activeId) {
      if (
        projectInfoOpen ||
        projectNameEditing.current ||
        textEditing ||
        componentEditor ||
        documentSettingsOpen ||
        codeDraftDirty
      )
        return {
          status: "failed",
          message:
            "Finish or cancel the current edit before saving and closing.",
        };
      return saveProjectToNative();
    }
    const { saveBackgroundNativeTab } = await loadNativeProjectWorkspace();
    return saveBackgroundNativeTab(
      nativeProjectStore,
      projectTabs,
      id,
      captureProjectSaveSnapshot,
    );
  }

  const nativeWorkspaceState = () => ({
    dirty: projectTabs
      .entries()
      .filter(({ session }) => session.dirty || session.unsafe)
      .map(({ id, session }) => ({
        id,
        name: session.controller.project.name,
      })),
    busy:
      isSaveInFlight() ||
      projectTabs.busy ||
      nativeOperation.current ||
      nativeWorkspaceSaving.current,
    pendingEdits:
      projectInfoOpen ||
      projectNameEditing.current ||
      !!textEditing ||
      !!componentEditor ||
      documentSettingsOpen ||
      codeDraftDirty ||
      !!replaceGuard ||
      recoveryDialogOpen,
  });
  const nativeBridgeRef = useRef({
    state: nativeWorkspaceState,
    save: async (): Promise<{ status: string; message?: string }> => ({
      status: "cancelled",
    }),
  });
  nativeBridgeRef.current = {
    state: nativeWorkspaceState,
    save: async () => {
      const { saveNativeWorkspace } = await loadNativeProjectWorkspace();
      return saveNativeWorkspace(
        nativeWorkspaceState,
        saveNativeTab,
        (busy) => {
          nativeWorkspaceSaving.current = busy;
          setNativeBusy(busy);
        },
      );
    },
  };
  useEffect(() => {
    if (!nativeProjectStore) return;
    const target = window as unknown as Record<string, unknown>;
    const bridge = {
      state: () => nativeBridgeRef.current.state(),
      save: () => nativeBridgeRef.current.save(),
    };
    target.__analogCanvasDesktop = bridge;
    return () => {
      if (target.__analogCanvasDesktop === bridge)
        delete target.__analogCanvasDesktop;
    };
  }, [nativeProjectStore]);
  agentWorkspaceRef.current = async (envelope, targetWorkspaceId) => {
    const request = envelope.request;
    const { copyWorkspaceCell, listWorkspaceProjects, workspaceResponses } =
      await import("../agent/workspace-copy");
    const { fail, success } = workspaceResponses(envelope.requestId);
    try {
      const entries = projectTabs.entries();
      if (request.action === "list")
        return success({
          action: "list",
          activeWorkspaceId: projectTabs.activeId,
          projects: listWorkspaceProjects(entries),
        });
      if (request.action === "activate") {
        if (!entries.some((e) => e.id === request.workspaceId))
          return fail("WORKSPACE_NOT_FOUND", "Workspace is no longer open");
        const applied = await projectTabs.select(request.workspaceId);
        return applied
          ? success({ action: "activate", applied })
          : fail(
              "WORKSPACE_BUSY",
              "Finish the current edit before switching Projects",
            );
      }
      if (request.action === "open") {
        const result = await openCloudProjectById(
          request.cloudProjectId,
          true,
          request.background === true,
        );
        return result.applied
          ? success({
              action: "open",
              applied: true,
              workspaceId: projectTabs
                .entries()
                .find(
                  (item) =>
                    item.session.file.cloudBinding?.id ===
                    request.cloudProjectId,
                )?.id,
            })
          : fail(
              "CLOUD_OPEN_FAILED",
              result.message ?? "Cloud Project was not opened",
            );
      }
      if (request.action === "save") {
        if (!projectStore)
          return fail("INVALID_REQUEST", "Cloud storage is unavailable");
        if (targetWorkspaceId && targetWorkspaceId !== projectTabs.activeId) {
          const target = entries.find((item) => item.id === targetWorkspaceId);
          if (!target)
            return fail(
              "WORKSPACE_NOT_FOUND",
              "Working copy is no longer open",
            );
          const controller = target.session.controller;
          const snapshot = captureProjectSaveSnapshot(
            controller.project,
            controller.projectSessionId,
            () => {
              const live = projectTabs
                .entries()
                .find(
                  (item) =>
                    item.id === targetWorkspaceId &&
                    item.session.controller === controller,
                );
              return live
                ? {
                    id: controller.projectSessionId,
                    project: controller.project,
                  }
                : null;
            },
          );
          const candidate = snapshot.project;
          target.session.file.persistenceState = "saving";
          projectTabs.changed();
          const outcome = await projectStore.save(
            candidate,
            request.asNew ? null : target.session.file.cloudBinding,
          );
          const liveTarget = projectTabs
            .entries()
            .find(
              (item) =>
                item.id === targetWorkspaceId &&
                item.session.controller === controller,
            );
          if (!liveTarget)
            return fail(
              "WORKSPACE_NOT_FOUND",
              "Working copy closed while Cloud save was in flight; check the Cloud Project shelf",
            );
          if (outcome.status === "saved") {
            const stillCurrent =
              snapshot.matchesCurrentProject() &&
              (targetWorkspaceId !== projectTabs.activeId ||
                (!codeDraftDirty &&
                  simulationSourceBuffer.current?.dirty !== true));
            liveTarget.session.file.cloudBinding = {
              id: outcome.project.id,
              revision: outcome.project.revision,
              galleryEntryId: outcome.project.galleryEntryId ?? null,
            };
            liveTarget.session.file.savedBaseline = {
              project: candidate,
              viewBox: { ...liveTarget.session.view },
            };
            liveTarget.session.file.persistenceState = stillCurrent
              ? "clean"
              : "dirty";
            liveTarget.session.dirty = !stillCurrent;
            liveTarget.session.unsafe = !stillCurrent;
            if (targetWorkspaceId === projectTabs.activeId) {
              restoreFileSession(liveTarget.session.file);
              stageRecovery(controller.project, {
                cloudBinding: liveTarget.session.file.cloudBinding,
                unsavedAtSnapshot: !stillCurrent,
              });
              void flushRecovery();
            }
            cloudListMutationRef.current += 1;
            setCloudProjects((current) => [
              outcome.project,
              ...current.filter((item) => item.id !== outcome.project.id),
            ]);
            projectTabs.changed();
            const { id, name, revision, updatedAt, schemaVersion } =
              outcome.project;
            return success({
              action: "save",
              project: { id, name, revision, updatedAt, schemaVersion },
            });
          }
          liveTarget.session.file.persistenceState =
            outcome.status === "conflict"
              ? "conflict"
              : outcome.status === "unreachable"
                ? "offline"
                : "failed";
          if (targetWorkspaceId === projectTabs.activeId)
            restoreFileSession(liveTarget.session.file);
          projectTabs.changed();
          return fail(
            `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
            outcome.status === "conflict"
              ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
              : "message" in outcome
                ? outcome.message
                : `Cloud save ${outcome.status}; local work retained`,
          );
        }
        const outcome = await saveProjectToCloud(
          undefined,
          request.asNew === true,
        );
        if (outcome.status !== "saved")
          return fail(
            `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
            outcome.status === "conflict"
              ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
              : "message" in outcome
                ? outcome.message
                : `Cloud save ${outcome.status}; local work retained`,
          );
        const { id, name, revision, updatedAt, schemaVersion } =
          outcome.project;
        return success({
          action: "save",
          project: { id, name, revision, updatedAt, schemaVersion },
        });
      }
      if (request.action === "new") {
        // A blank working copy, as the tab strip's + opens one.
        const open = new Set(entries.map((item) => item.id));
        const blank = createEmptyProject(
          createId("project"),
          request.name?.trim() || "New Circuit",
          createId("document"),
        );
        const applied = request.background
          ? projectTabs.openBackground(() => createTabSession(blank))
          : await projectTabs.open(() => createTabSession(blank));
        const workspaceId = projectTabs
          .entries()
          .find((item) => !open.has(item.id))?.id;
        return applied && workspaceId
          ? success({ action: "new", applied: true, workspaceId })
          : fail(
              "WORKSPACE_BUSY",
              "Finish the current edit before opening a Project",
            );
      }
      if (request.action === "rename") {
        const name = request.name.trim();
        const workspaceId =
          request.workspaceId ?? targetWorkspaceId ?? projectTabs.activeId;
        const target = entries.find((item) => item.id === workspaceId);
        if (!target)
          return fail("WORKSPACE_NOT_FOUND", "Working copy is no longer open");
        if (!name)
          return fail("INVALID_REQUEST", "A Project name cannot be blank");
        const controller = target.session.controller;
        if (controller.project.name === name)
          return success({ action: "rename", applied: false, workspaceId });
        if (workspaceId === projectTabs.activeId) {
          // The Project menu's own rename: one undoable Project edit.
          renameProject(name);
          if (editorDocumentController.project.name !== name)
            return fail("RENAME_REJECTED", "The Project name was not changed");
        } else {
          const result = controller.dispatchProjectTransaction({
            transactionId: `agent-rename-project-${envelope.requestId}`,
            projectId: controller.project.id,
            expectedStructureRevision: controller.project.structureRevision,
            actor: { kind: "agent", id: "workspace" },
            edits: [{ kind: "rename_project", name }],
          });
          if (!result.ok || !result.applied)
            return fail("RENAME_REJECTED", "The Project name was not changed");
          target.session.dirty = true;
          if (target.session.file.persistenceState === "clean")
            target.session.file.persistenceState = "dirty";
          projectTabs.changed();
        }
        controller.noteAgentEdit();
        return success({ action: "rename", applied: true, workspaceId });
      }
      const source = entries.find((e) => e.id === request.sourceWorkspaceId)
        ?.session.controller;
      const target = entries.find((e) => e.id === request.targetWorkspaceId);
      if (!target)
        return fail("WORKSPACE_NOT_FOUND", "Target Project is no longer open");
      const copied = copyWorkspaceCell(
        request,
        source,
        target.session.controller,
        {
          captureProjectCopy,
          planProjectCopyPlacement,
          applyProjectCopyPlacement: (plan, actor) =>
            applyProjectCopyPlacement(
              plan,
              actor,
              EDITOR_PROJECT_TRANSACTION_OPTIONS,
            ),
        },
      );
      if ("error" in copied)
        return fail(copied.error.code, copied.error.message);
      if (target.id === projectTabs.activeId) {
        synchronizeExternalCommit();
        void flushRecovery();
      } else {
        target.session.dirty = true;
        target.session.unsafe = true;
        target.session.file.persistenceState = "dirty";
      }
      projectTabs.changed();
      return success(copied.result);
    } catch (error) {
      return fail(
        "WORKSPACE_OPERATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  agentTargetRef.current = (workspaceId) => {
    const entry = projectTabs.entries().find((item) => item.id === workspaceId);
    if (!entry) return null;
    if (workspaceId === projectTabs.activeId)
      return {
        host: browserAgentHost,
        fileHost: browserAgentFileHost,
        simulationHost: browserAgentSimulationHost,
        projectHost: browserAgentProjectHost,
      };
    const controller = entry.session.controller;
    const available = () =>
      projectTabs
        .entries()
        .some(
          (item) =>
            item.id === workspaceId && item.session.controller === controller,
        );
    const cached = backgroundAgentHosts.current.get(controller);
    if (cached?.sessionId === controller.projectSessionId) return cached;
    const committed = () => {
      const current = projectTabs
        .entries()
        .find(
          (item) =>
            item.id === workspaceId && item.session.controller === controller,
        );
      if (!current) return;
      if (workspaceId === projectTabs.activeId) {
        synchronizeExternalCommit();
        void flushRecovery();
      } else {
        current.session.dirty = true;
        current.session.unsafe = true;
        current.session.file.persistenceState = "dirty";
      }
      projectTabs.changed();
    };
    const host = new BrowserAgentHost(
      controller,
      committed,
      undefined,
      available,
      agentPlanning,
    );
    const existing = agentProjectResources.current
      .get(controller)
      ?.get(`${controller.projectSessionId}:${simulationTransport}`);
    const fileHost =
      existing?.files ??
      new BrowserAgentFileHost({
        transport: simulationTransport,
        getProjectSessionId: () =>
          available() ? controller.projectSessionId : "closed",
        getProject: () => controller.project,
        getDocument: (id) =>
          controller.project.documents.find((item) => item.id === id) ?? null,
        getResolver: () => controller.resolver,
        onApprovalRequested: setAgentFileCandidate,
        getActiveDocumentId: () => controller.document.id,
        commitProjectStructure: (next, active) =>
          host.commitProjectStructure(next, active),
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
          host.dispatchProjectTransaction(request),
      });
    const history =
      existing?.history ?? new ProjectRunHistory(controller.project.id);
    history.activate();
    const simulationHost =
      existing?.simulation ??
      new BrowserAgentSimulationHost({
        runHistory: history,
        owner: "agent",
        files: fileHost.simulationFiles,
        getProjectSessionId: () =>
          available() ? controller.projectSessionId : "closed",
        getProject: () => controller.project,
        transport: simulationTransport,
      });
    const projectHost = new BrowserAgentProjectHost({
      projectTransactionOptions: EDITOR_PROJECT_TRANSACTION_OPTIONS,
      workspace: (request) => agentWorkspaceRef.current(request, workspaceId),
      // A tab in the background has nothing on show to publish.
      publishToGallery: createAgentGalleryPublisher({
        current: () => null,
        published: () => {},
      }),
      getProjectSessionId: () =>
        available() ? controller.projectSessionId : "closed",
      getProject: () => controller.project,
      getActiveDocumentId: () => controller.document.id,
      commitProjectStructure: (next, activeDocumentId) =>
        host.commitProjectStructure(next, activeDocumentId),
      dispatchProjectTransaction: (request) =>
        host.dispatchProjectTransaction(request),
    });
    const target = {
      sessionId: controller.projectSessionId,
      host,
      fileHost,
      simulationHost,
      projectHost,
    };
    backgroundAgentHosts.current.set(controller, target);
    if (!existing) {
      let group = agentProjectResources.current.get(controller);
      if (!group) {
        group = new Map();
        agentProjectResources.current.set(controller, group);
      }
      group.set(`${controller.projectSessionId}:${simulationTransport}`, {
        files: fileHost,
        history,
        simulation: simulationHost,
      });
    }
    return target;
  };
  const allowNextBrowserUnload = useUnsavedWorkGuard(projectTabs.hasUnsafeTabs);

  agentGalleryPublicationRef.current = () => ({
    controller: editorDocumentController,
    sessionId: editorDocumentController.projectSessionId,
    project: editorDocumentController.project,
    linked: galleryEntryContext,
    cloudBinding,
  });
  /**
   * What a publication to the Gallery leaves behind, whether a person used
   * the Publish dialog or an Agent published: the working copy is bound to the
   * entry, the wall refreshes, and a notice says where it went. A working copy
   * that changed meanwhile only announces the change.
   */
  function recordGalleryPublication(
    {
      id,
      name,
      description,
      tags,
      aiGenerated,
      updated,
      previewRevision,
      ownerUserId,
      author,
    }: GalleryPublicationRecord,
    sessionId: string,
    by: "person" | "agent",
  ): boolean {
    if (editorDocumentController.projectSessionId !== sessionId) {
      announceGalleryChange({ entryId: id });
      return false;
    }
    // The gallery now holds these exact bytes: leaving, refreshing or closing
    // the tab loses nothing until the next edit.
    noteProjectPublished();
    noteGalleryPublication(id);
    // Publishing establishes the same update-in-place binding as opening an
    // existing Gallery entry. Keep it attached to this Project only;
    // replacing the Project clears it above.
    setGalleryEntryContext({
      id,
      name,
      projectId: editorDocumentController.project.id,
      ownerUserId: updated
        ? (ownerUserId ??
          galleryEntryContext?.ownerUserId ??
          publishSession?.id ??
          null)
        : (publishSession?.id ?? null),
      author: updated
        ? (author ??
          galleryEntryContext?.author ??
          publishSession?.displayName ??
          "")
        : (publishSession?.displayName ?? ""),
      description,
      tags,
      aiGenerated,
    });
    void primeGalleryPreview(id, previewRevision);
    announceGalleryChange({
      entryId: id,
      ...(previewRevision === undefined ? {} : { previewRevision }),
    });
    galleryLoadGenerationRef.current += 1;
    setGalleryRefreshSignal((previous) => previous + 1);
    setStatus(
      by === "agent"
        ? updated
          ? `The Agent updated "${name}" in the gallery`
          : `The Agent published "${name}" to the gallery`
        : updated
          ? `Updated "${name}" in the gallery`
          : `Published "${name}" to the gallery`,
    );
    setPublishedNotice({ id, name, updated });
    return true;
  }
  recordGalleryPublicationRef.current = recordGalleryPublication;

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
      <EditorAppChrome
        communityEnabled={capabilities.community}
        externalLinksEnabled={capabilities.externalLinks}
        identityEnabled={identity !== null}
        projectTabs={
          <>
            <ProjectTabs
              cloudEnabled={projectStore !== null}
              tabs={projectTabs.tabs}
              activeId={projectTabs.activeId}
              busy={
                projectTabs.busy ||
                (nativeProjectStore !== undefined && (nativeBusy || saveBusy))
              }
              onSelect={projectTabs.select}
              onRename={(id, name) => {
                if (id === projectTabs.activeId) renameProject(name);
              }}
              onEditingChange={(editing) => {
                projectNameEditing.current = editing;
              }}
              onClose={(id) => {
                if (nativeProjectStore) void closeNativeTab(id);
                else void projectTabs.close(id, () => createTabSession());
              }}
              onCloseMany={(ids) => {
                if (nativeProjectStore) void closeNativeTabs(ids);
                else void projectTabs.closeMany(ids, () => createTabSession());
              }}
              {...(nativeProjectStore
                ? {
                    onSaveClose: async (id: string) => {
                      const { saveAndCloseNativeTab } =
                        await loadNativeProjectWorkspace();
                      return saveAndCloseNativeTab(id, {
                        busy: () =>
                          nativeOperation.current ||
                          nativeWorkspaceSaving.current ||
                          isSaveInFlight(),
                        setBusy: (busy) => {
                          nativeWorkspaceSaving.current = busy;
                          setNativeBusy(busy);
                        },
                        save: saveNativeTab,
                        entries: projectTabs.entries,
                        close: closeNativeTab,
                        report: setStatus,
                      });
                    },
                  }
                : {})}
              onNew={() => {
                void projectTabs.open(() => createTabSession());
              }}
              onOpenFile={() =>
                nativeProjectStore
                  ? void openNativeProject()
                  : tabProjectInputRef.current?.click()
              }
              cloudProjects={cloudProjects}
              onRefreshShelf={() => {
                void reloadCloudProjects();
              }}
              onOpenShelf={(id) => {
                void openCloudProjectById(id, true);
              }}
            />
            <input
              ref={tabProjectInputRef}
              hidden
              type="file"
              accept=".json,.icproj.json"
              data-testid="tab-project-file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void openProjectFile(file, { inTab: true });
              }}
            />
          </>
        }
        {...(publicSimulationUiEnabled
          ? { simulationAction: openAnalogSimulation }
          : {})}
        simulationState={analogSimulationState}
        projectName={project.name}
        projectSchemaVersion={project.schemaVersion}
        hasUnsavedWork={hasUnsavedChanges()}
        onOpenGallery={() => {
          void guardDirtyReplacement("Go to Gallery", async (discarded) => {
            if (discarded) await dropDiscardedWork();
            else {
              const snapshot = await captureAuthoredProject();
              if (!snapshot) return;
              stageRecovery(snapshot, {
                unsavedAtSnapshot: isDirtyWork() || snapshot !== project,
                cloudBinding,
              });
              await flushRecovery();
            }
            allowNextBrowserUnload();
            window.location.assign("/");
          });
        }}
        fileCommands={{
          ...(NativeFileCommands ? { NativeFileCommands } : {}),
          ...(nativeProjectStore
            ? {
                nativeFiles: {
                  projectName: project.name,
                  path: nativeBinding?.path ?? null,
                  recent: recentNativeFiles,
                  busy: nativeBusy || saveBusy,
                  refresh: () => void refreshNativeFiles(),
                  open: (id?: string) => void openNativeProject(id),
                  saveAs: () => void saveProjectToNative(undefined, true),
                  forget: (id: string) => {
                    void nativeProjectStore
                      .forget(id)
                      .then(refreshNativeFiles)
                      .catch((error: unknown) => setStatus(String(error)));
                  },
                },
              }
            : {}),
          cloudEnabled: projectStore !== null,
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
          onSave: () =>
            void (nativeProjectStore
              ? saveProjectToNative()
              : projectStore
                ? saveProjectToCloud()
                : exportProjectFile()),
          onImportProject: (file) => void openProjectFile(file),
          onImportSpice: (files, namingProfile) =>
            void importSpiceFiles(files, namingProfile),
          onExportProject: exportProjectFile,
          onExportSvg: exportSvg,
          onExportRaster: (format) => void exportRaster(format),
          onRevert: revertToSavedProjectBaseline,
          onOpenRecovery: openRecoveryDialog,
          onOpenInfo: () => setProjectInfoOpen(true),
        }}
        searchOpen={searchOpen}
        selectionFilterOpen={selectionFilterOpen}
        cellManagerOpen={cellManagerOpen}
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
          setOpenedFromCheckNotice(false);
          setPublishGalleryOpen(true);
        }}
        drawingToolbar={{
          communityEnabled: capabilities.community,
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
          resetLabels: {
            enabled: hasResettableLabels(document),
            execute: () => {
              const edits = resetLabelLookEdits(document, project);
              if (edits.length === 0) {
                setStatus("Every label already has the default look");
                return;
              }
              if (transact(edits).ok)
                setStatus(
                  `Reset ${edits.length} label${edits.length === 1 ? "" : "s"} to the default size and look`,
                );
            },
          },
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
            projectName: project.name,
            activeDocumentId: document.id,
            activeDocumentName: document.name,
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
        workspaceReopen={
          workspaceReopen
            ? {
                names: workspaceReopen.summary.names,
                savedAt: workspaceReopen.summary.savedAt,
                onReopen: () => void reopenClosedWindowTabs(),
                onDismiss: () => setWorkspaceReopen(null),
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
                cloudProjectLimit: projectStore?.limit ?? 0,
                exportOnly: projectStore === null,
                nativeSave: nativeProjectStore !== undefined,
                saving: replaceGuardSaving,
                onCancel: cancelReplaceGuard,
                onSaveAndContinue: saveAndContinueReplaceGuard,
                onDiscard: confirmReplaceGuard,
              }
            : null
        }
        projectInfo={
          projectInfoOpen
            ? {
                name: project.name,
                documentName: document.name,
                publication: galleryEntryContext,
                onSave: editProjectInfo,
                onClose: () => setProjectInfoOpen(false),
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
                externalDefinitions: insertDialogExternalCandidates,
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
                initialExternalId: modelEditorDefinitionId,
                initialModelLocation: modelEditorLocation,
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
                onClose: () => {
                  setCellManagerOpen(false);
                  setModelEditorDefinitionId(null);
                  setModelEditorLocation(undefined);
                },
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
                onCopyModelText: (text) => exportDelivery.copyText(text),
                onApplyModelSource: (edit) => {
                  const result = dispatchProjectTransaction({
                    transactionId: `model-${crypto.randomUUID()}`,
                    projectId: project.id,
                    expectedStructureRevision: project.structureRevision,
                    actor: { kind: "human", id: "human-local" },
                    edits: [edit],
                  });
                  return {
                    ok: result.ok,
                    definitionId: edit.definitions[0]!.definitionId,
                    message: result.ok
                      ? "Applied shared model definition"
                      : (result.diagnostics[0]?.message ??
                        result.error.message),
                  };
                },
                onSaveModelDraft: (edits, definitionId) => {
                  const result = dispatchProjectTransaction({
                    transactionId: `model-draft-${crypto.randomUUID()}`,
                    projectId: project.id,
                    expectedStructureRevision: project.structureRevision,
                    actor: { kind: "human", id: "human-local" },
                    edits,
                  });
                  return {
                    ok: result.ok,
                    definitionId,
                    message: result.ok
                      ? "Saved draft. Applied model bytes are unchanged."
                      : (result.diagnostics[0]?.message ??
                        result.error.message),
                  };
                },
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
                  setModelEditorDefinitionId(null);
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
                onPlaceCell: (childDocumentId) => {
                  const candidate = cellInsertCandidates.find(
                    (c) => c.childDocumentId === childDocumentId,
                  );
                  if (!candidate) return;
                  setCellManagerOpen(false);
                  setModelEditorDefinitionId(null);
                  editorCommands.execute({
                    id: "insert.start",
                    launch: {
                      kind: "quick",
                      request: {
                        kind: "cell",
                        symbolId: candidate.symbol.id,
                        symbolName: candidate.cellName,
                        childDocumentId,
                        cellName: candidate.cellName,
                        parameters: {},
                        initialRotation: 0,
                        showReference: false,
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
                  const committed = commitStructure("import-cloud-cell", [
                    ...plan.edits,
                  ]);
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
                topologyProject: galleryTopologyProject,
                openedFromCheckNotice,
                publicationLinkLoading,
                publicationLinkError,
                publicationLinkNotice,
                onRetryPublicationLink: () =>
                  setPublicationLinkRetry((value) => value + 1),
                ...(cloudBinding
                  ? { onLinkExisting: linkExistingPublication }
                  : {}),
                updateTarget: canUpdateGalleryPublication(
                  galleryEntryContext,
                  publishSession,
                )
                  ? {
                      id: galleryEntryContext!.id,
                      name: galleryEntryContext!.name,
                    }
                  : null,
                updateDefaults: galleryEntryContext
                  ? {
                      description: galleryEntryContext.description,
                      tags: galleryEntryContext.tags,
                      aiGenerated: galleryEntryContext.aiGenerated === true,
                    }
                  : null,
                agentEdited: editorDocumentController.agentEdited,
                quota: publishQuota,
                publish: (fields) =>
                  publishProjectToGallery(project, fields, fetch, cloudBinding),
                ...(galleryEntryContext
                  ? {
                      publishUpdate: (fields) =>
                        updateGalleryEntry(
                          galleryEntryContext.id,
                          project,
                          fields,
                          fetch,
                          cloudBinding,
                        ),
                    }
                  : {}),
                onPublished: (outcome) => {
                  if (
                    recordGalleryPublication(
                      outcome,
                      projectSessionId,
                      "person",
                    )
                  ) {
                    setPublishGalleryOpen(false);
                    setPublishDraft(null);
                  }
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
                onBranch: async (snapshot) => {
                  // The tab guard reads the committed dialog state. Waiting a
                  // frame can still race a concurrent React render here.
                  flushSync(() => setVersionHistoryOpen(false));
                  return openProjectInTabRef.current(
                    snapshot,
                    DEFAULT_VIEWBOX,
                    { source: "opened-file", persistenceState: "dirty" },
                  );
                },
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
                pendingOperation: agentSession.pendingOperation,
                claimCode: agentSession.claimCode,
                claimExpiresAt: agentSession.claimExpiresAt,
                scopes: agentSession.scopes,
                expiresAt: agentSession.expiresAt,
                error: agentSession.error,
                backgroundRequests: agentSession.backgroundRequests,
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
                  onOpenModelSource={openProjectModelSource}
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
                      exportDesignNetlist(
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
                      onPause: agentSession.pause,
                      onResume: agentSession.resume,
                      onReconnect: agentSession.reconnect,
                      onNewConnection: agentSession.newConnection,
                      pendingOperation: agentSession.pendingOperation,
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
                label: "Copy (C)",
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
      {capabilities.community && componentEditor ? (
        <Suspense fallback={null}>
          <ComponentDefinitionEditor
            key={componentEditor.key}
            definition={componentEditor.definition}
            mode={componentEditor.mode}
            {...(componentEditor.entry ? { entry: componentEditor.entry } : {})}
            validateApply={(definition, planner) => {
              if (!componentEditor.target) return null;
              const plan = componentEditPlan(
                publishedDefinition(definition, componentEditor.key, 1),
                planner,
              );
              return plan.ok ? null : plan.message;
            }}
            onSaved={(entry, planner) => {
              setComponentLibraryRefresh((value) => value + 1);
              if (componentEditor.target) {
                const plan = componentEditPlan(entry.definition, planner);
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
      {capabilities.community ? (
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
      ) : null}
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
import { createSimulationProjectFileHost } from "../features/simulation/project-file-host";
