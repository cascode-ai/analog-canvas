import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";
import { deviceDescriptor } from "@icm/devices";

import {
  compileWireDraft,
  createConnectivityProposal,
  createFreeWireAnchor,
  gateConnectivityProposal,
  createRouteWireAnchor,
  proposeEndpointRouteAttachment,
  proposeGroupMoveEdits,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeWireCommitThroughContacts,
  proposeWireSegmentMove,
  planEnsureNamedNet,
  planCreateCell,
  planDeleteCell,
  planRenameCell,
  planRemoveCellTerminalMarkers,
  planRenameCellTerminal,
  planReorderCellTerminal,
  planSetCellSymbolPresentation,
  planEditCellTerminalAnnotation,
  planSetCellTerminalPlacement,
  planUpdateCellTerminalDirection,
  planSetMosModelTarget,
  planInstanceUnplacement,
  proposeSetCellFormalParameters,
  proposeUpsertExternalSubcircuitDefinition,
  findCellTerminalCaller,
  type ProjectStructureEdit,
  type EditTransactionResult,
  type ConnectivityIntent,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import { createFormalExportSource, safeExportBaseName } from "@icm/exporters";
import {
  exportFormalArtifactsInBrowser,
  rasterizeFormalSvgInBrowser,
} from "@icm/exporters/browser";
import { analyzeDesignNetlist, printDesignNetlist } from "@icm/netlist";
import type { NetlistDiagnostic, NetlistFormat } from "@icm/netlist";
import {
  buildProjectConnectivityIndex,
  buildProjectSearchIndex,
  deriveCrossings,
  deriveInternalGroupSelection,
  derivePowerRailComponent,
  diagnoseProjectSnapshot,
  diagnoseVisualQuality,
  endpointKey,
  findHierarchyPath,
  findHierarchyPaths,
  hasDifferentialInputs,
  isMosBulkTerminal,
  isSchematicAnnotationVisible,
  isVisibleEndpoint,
  resolveEndpointPoint,
  resolveDraftingObjectGeometry,
  resolveElectricalContactTargets,
  displayableInstanceValue,
  resolveNetLabelBinding,
  resolveMosBulkConnection,
  resolveDocumentStyleProfile,
  resolveRouteAttachment,
  resolveRouteTap,
  summarizeProjectCells,
  traceHierarchyNet,
} from "@icm/derived";
import type {
  Diagnostic,
  Flightline,
  GlobalNetTraceHop,
  HierarchyFrame,
  HierarchyNetTraceHop,
  ObjectLocator,
  SearchResult,
} from "@icm/derived";
import {
  createEmptyProject,
  createEmptyDocument,
  createId,
  defaultDraftTextDocument,
  flattenRichText,
  inverseTransformPoint,
  snapGridPoint,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";
import type {
  Annotation,
  CircuitProject,
  DerivedPoint,
  ExternalSubcircuitDefinition,
  DraftingObject,
  GridRect,
  Point,
  Rect,
  RichTextDocument,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { importSpiceSources } from "@icm/spice";
import { renderCrashRequested, sceneCrashRequested } from "./crash-test-hooks";
import { buildSceneSafely } from "./scene-safety";
import {
  builtInSymbols,
  externalSubcircuitSymbolId,
  findUnsupportedProjectSymbolIds,
  hierarchicalSymbolId,
  InMemorySymbolResolver,
  resolvePdkSymbolMapping,
  reviewedSky130MosModelSuggestions,
} from "@icm/symbols";
import {
  clipboardPlacementAnchor,
  clipboardPreviewDocument,
  copySelection,
} from "../features/clipboard/clipboard";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import { startCanvasDragSession } from "../canvas/canvas-drag-session";
import {
  fitCameraToBounds,
  normalizeCameraRect,
  zoomCameraAtAnchor,
  type CameraRectInput,
} from "../canvas/fit-view";
import type { CanvasDragSession } from "../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../canvas/canvas-drag-visual";
import {
  rankCanvasHits,
  resolveCanvasHitAtPoint,
} from "../canvas/canvas-hit-resolver";
import {
  type RouteStretchPreview,
  useWireInteraction,
} from "../features/wiring/use-wire-interaction";
import {
  centerOfBounds,
  clamp,
  closestPointOnSegment,
  normalizedBearing,
  normalizedRect,
  polylineBounds,
  serializePolylinePoints,
} from "../canvas/canvas-geometry";
import { CanvasTextEditorOverlay } from "../features/text-editing/canvas-text-editor-overlay";
import {
  ComponentPlacementPreview,
  InsertComponentDialog,
} from "../features/component-insert/insert-component-dialog";
import {
  cellInsertLaunch,
  fullInsertLaunch,
} from "../features/component-insert/insert-launch";
import { useComponentPlacement } from "../features/component-insert/use-component-placement";
import { planPlaceAllUnplacedInstances } from "../features/component-insert/placement-tray";
import { missingDefaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";
import { DisplayToggle } from "../features/component-insert/display-toggle";
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
  componentParameters,
  externalMosComponentParameters,
} from "../features/component-insert/component-parameters";
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
import {
  bindingForEditedModel,
  initialInstanceNetlist,
  netlistReferenceMatchesPlacement,
  nextInstanceDesignator,
} from "../features/netlist-export/netlist-authoring";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import {
  quickPlaceRequest,
  ShapesPanel,
} from "../features/editor-shell/shapes-panel";
import {
  differentialOutputSibling,
  planDifferentialOutputSwap,
} from "../features/editor-shell/differential-output-swap";
import { ExamplesPanel } from "../features/editor-shell/examples-panel";
import { convertRectangleToHierarchy } from "../features/hierarchy/rectangle-to-cell";
import { CellManagerDialog } from "../features/hierarchy/cell-manager-dialog";
import { NetlistPreflightDialog } from "../features/netlist-export/netlist-preflight-dialog";
import { parseProject } from "@icm/project-protocol";
import { StyleDialog } from "../features/editor-shell/style-dialog";
import { PublishGalleryDialog } from "../features/editor-shell/publish-gallery-dialog";
import {
  publishProjectToGallery,
  updateGalleryEntry,
} from "../features/editor-shell/gallery-publish";
import { fetchSessionUser, type SessionUser } from "../components/account";
import {
  evaluateSubmissionGates,
  type SubmissionGateReport,
} from "@icm/derived";
import {
  createUserExamplesStore,
  type UserExampleSummary,
} from "../document/user-examples-store";
import {
  proposeConnectedInstanceDeletion,
  proposeVisualSelectionDeletion,
} from "../features/selection/delete-selection";
import {
  createLibraryExampleProject,
  libraryProjectExamples,
  type LibraryProjectExample,
} from "../examples/library-examples";
import { useDocumentController } from "../document/document-controller";
import {
  applyDraftingHandle,
  applyDraftingStylePatch,
  deleteConstructionVertex as deleteConstructionVertexObject,
  draftingDragOrigin,
  insertArrowWaypoint as insertArrowWaypointObject,
  insertConstructionVertex as insertConstructionVertexObject,
  rotateDraftingObject,
  setDraftingBearing as setDraftingObjectBearing,
  setDraftingTangentAngle as setDraftingObjectTangentAngle,
  translateDraftingObject,
} from "../features/drafting/drafting-manipulation";
import type {
  DraftingHandle,
  DraftingStylePatch,
} from "../features/drafting/drafting-manipulation";
import { DraftingCreatePreview } from "../features/drafting/drafting-create-preview";
import {
  proposeRectangleLabel,
  rectangleInteriorAt,
  rectangleLabelFor,
} from "../features/drafting/rectangle-label";
import {
  marqueeMode,
  marqueeSelection,
} from "../features/selection/marquee-selection";
import {
  draftingPathData,
  quadraticMidpoint,
  quadraticTangentAngle,
} from "../features/drafting/drafting-path";
import {
  resolveEditorShortcut,
  stepBoundedScale,
} from "../interaction/editor-shortcuts";
import { EditorHelpDialog } from "../components/editor-help-dialog";
import { EditorAboutDialog } from "../components/editor-about-dialog";
import { ReplaceGuardDialog } from "../components/replace-guard-dialog";
import { RecentRecoveryDialog } from "../components/recent-recovery-dialog";
import {
  RecoveryFailureBanner,
  recoveryStateLabel,
} from "../components/recovery-banners";
import { ProjectSearchDialog } from "../features/search/project-search-dialog";
import {
  AgentPropertiesSection,
  ConnectAgentPanel,
} from "../agent/connect-agent-panel";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { PUBLIC_AGENT_UI_ENABLED } from "../agent/public-agent-ui";
import { useAgentSession } from "../agent/use-agent-session";
import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
import { referencedDocumentId } from "../document/editor-session";
import { useInteractionState } from "../interaction/interaction-state";
import type { EditorTool } from "../interaction/interaction-state";
import { resolveTextEditingTarget } from "../features/text-editing/text-editing";
import { planMosBulkDefaultUpdate } from "../features/component-insert/mos-bulk-defaults";
import {
  defaultRazaviSymbolVariantId,
  materializeRazaviProjectBulkConnections,
  razaviHiddenBulkRisk,
  razaviManualBulkConnectionEdits,
  razaviMosPresentationEdits,
} from "../presentation/razavi-presentation";
import { createRoutingDemoProject } from "../demos/routing-demo";
import { createVisualDemoProject } from "../demos/visual-demo";
import { useRecoveryCoordinator } from "../document/recovery-coordinator";
import type {
  BrowserRecoveryFormalFileHint,
  BrowserRecoverySource,
} from "../document/browser-recovery-contract";
import {
  downloadTextArtifact,
  formatProjectOpenDiagnostics,
  requestProjectDownload,
  saveProjectArtifact,
  stageProjectFile,
  type ProjectFileState,
} from "../document/project-file-service";
import type { BrowserRecoveryGeneration } from "../document/browser-recovery-contract";
import { projectFileBaseName } from "../document/project-file-service";
import { useSelectionController } from "../features/selection/selection-controller";
import { usePropertiesEditor } from "../features/properties/use-properties-editor";
import { InstanceTableDialog } from "../features/properties/instance-table-dialog";
import { capacitorPlatePropertyRows } from "../features/properties/capacitor-plate-properties";
import {
  LIBRARY_WIDTH_MAX,
  LIBRARY_WIDTH_MIN,
  useEditorPanels,
} from "../features/editor-shell/use-editor-panels";
import {
  type InstanceMovePreview,
  useSelectionInteraction,
} from "../features/selection/use-selection-interaction";
import {
  NetTraceSection,
  ProjectDiagnosticsSection,
  SelectionInspectorDetails,
  summarizeVisualDiagnostics,
} from "../features/selection/selection-inspector-details";
import type { SpiceImportReport } from "../features/selection/selection-inspector-details";
import {
  hasVisualSelection,
  pruneVisualSelection,
} from "../features/selection/visual-selection";
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
  defaultInstanceLabel,
  defaultInstanceValue,
  dragNetLabelAttachmentAtPoint,
  dragRouteAttachmentAtPoint,
  effectiveRouteAttachment,
  endpointNetId,
  instanceHitBox,
  instanceValueAnnotation,
  isRoutedMarker,
  looseRouteAnchorIds,
  NET_LABEL_MAX_NORMAL_OFFSET,
} from "../features/wiring/route-interaction-geometry";
import { reflectOrientation } from "../interaction/shortcut-orientation";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import {
  buildDraftingAnchors,
  buildInstanceAnchors,
  buildSceneSnapTargets,
  endpointSnapAnchor,
} from "../snap/candidates";
import {
  logicalToleranceForScale,
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
const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";
const COMPACT_LAYOUT_MEDIA_QUERY = "(max-width: 860px)";
const DRAG_START_DISTANCE_PX = 4;
const SNAP_CAPTURE_RADIUS_PX = 7;

/** Persisted Junctions are grid points, including on ±45° Route segments. */
function snapPointOnRouteGrid(
  pointer: Point,
  from: Point,
  to: Point,
  grid: number,
): Point {
  const projected = closestPointOnSegment(pointer, from, to);
  if (from.y === to.y) {
    return { x: snapCoordinate(projected.x, grid), y: from.y };
  }
  if (from.x === to.x) {
    return { x: from.x, y: snapCoordinate(projected.y, grid) };
  }
  // Octilinear diagonal: choosing one grid coordinate determines the other.
  // Endpoints already satisfy the grid invariant, so the paired coordinate
  // remains integral and on-grid too.
  const slope = Math.sign(to.y - from.y) * Math.sign(to.x - from.x);
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const x = clamp(snapCoordinate(projected.x, grid), minX, maxX);
  return { x, y: from.y + slope * (x - from.x) };
}

type DragPreview = InstanceMovePreview;

interface BoxPreview {
  start: DerivedPoint;
  end: DerivedPoint;
  pointerId: number;
  /**
   * Left-drag selects what the box touches; right-drag (or Alt+left-drag)
   * zooms to fit it.
   */
  intent: "select" | "zoom";
}

interface PanPreview {
  clientStart: Point;
  viewBoxStart: GridRect;
  pointerId: number;
  dragged: boolean;
}

interface AnnotationDragPreview {
  annotationId: string;
  originalPosition: Point;
  pointerStart: DerivedPoint;
}

// Handle drags are geometry edits rather than translations.  Keep a complete
// transient object so the formal SVG renderer can redraw both a curved shaft
// and its arrow head from the same latest control point before pointer-up.
interface DraftingHandlePreview {
  objectId: string;
  object: DraftingObject;
}

type SupplementalSelection = Omit<VisualSelection, "instanceIds">;

const EMPTY_SUPPLEMENTAL_SELECTION: SupplementalSelection = {
  routeIds: [],
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
};

interface ReplaceGuardState {
  intent: string;
  perform: () => void | Promise<void>;
}

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
  const aboutButtonRef = useRef<HTMLButtonElement>(null);
  const aboutCloseRef = useRef<HTMLButtonElement>(null);
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
    aboutOpen,
    setAboutOpen,
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
    closeAbout,
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
    aboutButtonRef,
    aboutCloseRef,
  });
  const [restoreAfterRefresh] = useState(() => {
    if (typeof window === "undefined") return false;
    const requested =
      window.sessionStorage.getItem(REFRESH_RESTORE_STORAGE_KEY) === "true";
    if (requested) {
      window.sessionStorage.removeItem(REFRESH_RESTORE_STORAGE_KEY);
    }
    return requested;
  });

  const visibleLibraryPanelOpen = compactLayout
    ? compactLibraryPanelOpen
    : libraryPanelOpen;

  const refreshRestoreAttemptedRef = useRef(false);
  // Formal-file lifecycle of the current working copy, orthogonal to recovery
  // state: a commit makes it dirty again, only a confirmed File System
  // Access close or an explicit download transitions it out of dirty.
  const [fileState, setFileState] = useState<ProjectFileState>("new");
  const fileStateBaselineRef = useRef<{
    session: string;
    revision: number;
  } | null>(null);
  const [replaceGuard, setReplaceGuard] = useState<ReplaceGuardState | null>(
    null,
  );
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
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
  const [netlistPreflightOpen, setNetlistPreflightOpen] = useState(false);
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [publishGalleryOpen, setPublishGalleryOpen] = useState(false);
  const [publishSession, setPublishSession] = useState<SessionUser | null>(
    null,
  );
  const [galleryEntryContext, setGalleryEntryContext] = useState<{
    id: string;
    ownerUserId: string | null;
  } | null>(null);
  const [publishGates, setPublishGates] = useState<SubmissionGateReport | null>(
    null,
  );
  useEffect(() => {
    if (!publishGalleryOpen) return;
    let cancelled = false;
    void fetchSessionUser().then((user) => {
      if (!cancelled) setPublishSession(user);
    });
    // The same evaluator the worker enforces, run live on the open Project.
    setPublishGates(
      evaluateSubmissionGates(
        project,
        new InMemorySymbolResolver(builtInSymbols),
      ),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluated once per dialog open
  }, [publishGalleryOpen]);
  const userExamplesStore = useRef(createUserExamplesStore());
  const [userExamples, setUserExamples] = useState<UserExampleSummary[]>([]);
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
  const [cellSymbolLayoutEnabled, setCellSymbolLayoutEnabled] = useState(false);
  const [
    cellSymbolLayoutTargetInstanceId,
    setCellSymbolLayoutTargetInstanceId,
  ] = useState<string | null>(null);
  const [cellSymbolLayoutDrag, setCellSymbolLayoutDrag] = useState<{
    kind: "body" | "pin";
    pointerId: number;
    terminalId?: string;
  } | null>(null);
  const [panPreview, setPanPreview] = useState<PanPreview | null>(null);
  const [wireOptionsOpen, setWireOptionsOpen] = useState(false);
  const [routingGuidanceView, setRoutingGuidanceView] = useState<
    "focused" | "all" | "hidden"
  >("focused");
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
    rotateCopyPlacement,
    mirrorCopyPlacement,
    setWireSource,
    setWirePreviewPoint,
    setWireDraftSteps,
    setWireRoutingMode,
    toggleWireRoutingMode,
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
  const [selectedEndpoint, setSelectedEndpoint] = useState<WireSource | null>(
    null,
  );
  const [bulkDrawInstanceId, setBulkDrawInstanceId] = useState<string | null>(
    null,
  );
  const [highlightedNetOrigin, setHighlightedNetOrigin] = useState<{
    documentId: string;
    netId: string;
    endpoint?: RouteEndpoint;
  } | null>(null);
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
  const renderedDocument = useMemo(() => {
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
  }, [document, draftingHandlePreview]);
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
  const copyPreviewScene = useMemo(() => {
    if (!copyPlacement || !copyPlacement.previewPoint) return null;
    const offset = {
      x: copyPlacement.previewPoint.x - copyPlacement.anchor.x,
      y: copyPlacement.previewPoint.y - copyPlacement.anchor.y,
    };
    try {
      return buildSvgScene(
        clipboardPreviewDocument(
          document,
          copyPlacement.clipboard,
          offset,
          copyPlacement.orientationOperations,
          resolver,
        ),
        resolver,
        { bounds: viewBox },
      );
    } catch {
      // A transient copy preview is never worth crashing the render for.
      return null;
    }
  }, [copyPlacement, document, resolver, viewBox]);
  const copyPreviewInnerHtml = useMemo(
    () =>
      copyPreviewScene === null
        ? null
        : { __html: copyPreviewScene.formalBody },
    [copyPreviewScene],
  );
  const unplaced = document.instances.filter(
    (instance) => instance.placement === null,
  );
  const returnablePlacedInstances = document.instances.filter(
    (instance) => instance.placement !== null,
  );
  const selectedIds = visualSelection.instanceIds;
  const projectConnectivityIndex = useMemo(
    () => buildProjectConnectivityIndex(project, resolver),
    [project, resolver],
  );
  const netlistAnalysis = useMemo(
    () => analyzeDesignNetlist(project),
    [project],
  );
  const highlightedTrace = useMemo(
    () =>
      highlightedNetOrigin
        ? traceHierarchyNet(
            projectConnectivityIndex,
            highlightedNetOrigin.documentId,
            highlightedNetOrigin.netId,
            highlightedNetOrigin.endpoint,
          )
        : undefined,
    [highlightedNetOrigin, projectConnectivityIndex],
  );
  const highlightedNet = useMemo(
    () =>
      highlightedTrace?.highlights.find(
        (highlight) => highlight.documentId === document.id,
      ),
    [document.id, highlightedTrace],
  );
  const highlightedNetId = highlightedNet?.netId ?? null;
  const liveDiagnosticSnapshot = useMemo(
    () => diagnoseProjectSnapshot(project, resolver, projectConnectivityIndex),
    [project, projectConnectivityIndex, resolver],
  );
  const searchResults = useMemo(
    () =>
      buildProjectSearchIndex(project, {
        connectivityIndex: projectConnectivityIndex,
      }).search(searchQuery),
    [project, projectConnectivityIndex, searchQuery],
  );
  const supplementalSelection: SupplementalSelection = {
    routeIds: visualSelection.routeIds,
    junctionIds: visualSelection.junctionIds,
    annotationIds: visualSelection.annotationIds,
    draftingIds: visualSelection.draftingIds,
  };
  const selectedRouteId = visualSelection.routeIds.at(-1) ?? null;
  const selectedAnnotationId = visualSelection.annotationIds.at(-1) ?? null;
  const selectedDraftingId = visualSelection.draftingIds.at(-1) ?? null;
  const selectedId = selectedIds.at(-1) ?? null;
  const selectedInstance =
    selectedIds.length === 1
      ? document.instances.find((instance) => instance.id === selectedId)
      : undefined;
  const selectedInstanceHasDifferentialInputs = (() => {
    if (!selectedInstance) return false;
    const resolved = resolver.resolve(selectedInstance.symbolId);
    return resolved ? hasDifferentialInputs(resolved) : false;
  })();
  const selectedHierarchyCell = selectedInstance
    ? project.documents.find(
        (candidate) =>
          candidate.id === referencedDocumentId(project, selectedInstance),
      )
    : undefined;
  const selectedDevice = selectedInstance
    ? deviceDescriptor(selectedInstance.symbolId)
    : undefined;
  const selectedCapacitorPlateRows = selectedInstance
    ? capacitorPlatePropertyRows(document, selectedInstance)
    : null;
  const selectedBinding = selectedInstance?.netlist?.binding;
  const selectedExternalSubcircuit =
    selectedBinding?.kind === "external-subcircuit"
      ? project.externalSubcircuitDefinitions.find(
          (definition) => definition.id === selectedBinding.definitionId,
        )
      : undefined;
  const selectedExternalMosMapping = selectedExternalSubcircuit
    ? (() => {
        const mapping = resolvePdkSymbolMapping(
          selectedExternalSubcircuit.name,
          selectedExternalSubcircuit.terminals.length,
        );
        return mapping &&
          selectedExternalSubcircuit.terminals.every(
            (terminal, index) =>
              terminal.name.toLowerCase() ===
              mapping.pinNames[index]?.toLowerCase(),
          )
          ? mapping
          : undefined;
      })()
    : undefined;
  const selectedPropertyDevice =
    selectedDevice ??
    (selectedExternalMosMapping
      ? deviceDescriptor(selectedExternalMosMapping.symbolId)
      : undefined);
  const selectedCellSymbolLayout = useMemo(() => {
    if (
      !cellSymbolLayoutEnabled ||
      !selectedInstance?.placement ||
      !selectedHierarchyCell?.netlist
    ) {
      return null;
    }
    const definition = resolver.resolve(selectedInstance.symbolId)?.definition;
    const body = definition?.primitives.find(
      (primitive) => primitive.kind === "polygon",
    );
    if (!definition || !body || body.kind !== "polygon") return null;
    const xs = body.points.map((point) => point.x);
    const ys = body.points.map((point) => point.y);
    return {
      child: selectedHierarchyCell,
      instance: selectedInstance,
      body: {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      },
      pins: selectedHierarchyCell.netlist.terminals.flatMap((terminal) => {
        const pin = definition.pins.find(
          (candidate) => candidate.name === terminal.name,
        );
        return pin ? [{ terminal, pin }] : [];
      }),
    };
  }, [
    cellSymbolLayoutEnabled,
    resolver,
    selectedHierarchyCell,
    selectedInstance,
  ]);
  const selectedRoute = selectedRouteId
    ? document.routes.find((route) => route.id === selectedRouteId)
    : undefined;
  // Labels are electrically associated with a Net, not intrinsically with a
  // Route. The editor's own label id is useful as a preference only: imported
  // projects and older documents legitimately use arbitrary annotation ids.
  const selectedRouteNetLabels = selectedRoute
    ? document.annotations.filter(
        (annotation) =>
          annotation.kind === "net-label" &&
          annotation.netId === selectedRoute.netId,
      )
    : [];
  const selectedRouteNetLabel = selectedRoute
    ? (selectedRouteNetLabels.find(
        (annotation) => annotation.id === `net-label-${selectedRoute.id}`,
      ) ??
      selectedRouteNetLabels.find(
        (annotation) =>
          resolveNetLabelBinding(document, resolver, annotation)?.routeId ===
          selectedRoute.id,
      ))
    : undefined;
  const selectedAnnotation = selectedAnnotationId
    ? document.annotations.find(
        (annotation) => annotation.id === selectedAnnotationId,
      )
    : undefined;
  const selectedNetLabelBinding = selectedAnnotation
    ? resolveNetLabelBinding(document, resolver, selectedAnnotation)
    : null;
  const selectedDrafting = selectedDraftingId
    ? document.drafting?.objects.find(
        (object) => object.id === selectedDraftingId,
      )
    : undefined;
  const hasHierarchyEnterSelection = Boolean(
    (selectedInstance && referencedDocumentId(project, selectedInstance)) ||
    selectedDrafting?.kind === "rectangle",
  );
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
    instancePropertyEdits,
    referenceLabelVisibilityEdits,
    valueVisibilityEdits,
    isCellPortAnnotation: (annotation) => {
      const anchor = annotation.anchor;
      if (anchor.kind !== "object") return false;
      const interfaceInstanceId = anchor.objectId;
      return (
        document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(interfaceInstanceId),
        ) === true
      );
    },
    commitCellPortAnnotation: (annotation, name) => {
      if (annotation.anchor.kind !== "object") return false;
      const interfaceInstanceId = annotation.anchor.objectId;
      const terminal = document.netlist?.terminals.find((candidate) =>
        candidate.interfaceInstanceIds.includes(interfaceInstanceId),
      );
      if (!terminal) return false;
      try {
        const {
          content,
          formatOverride,
          binding: _binding,
          ...annotationPresentation
        } = annotation;
        const editedContent = formatOverride ?? content;
        const semanticContent = semanticTextDocument(name, "formal-port");
        const normalizedAnnotation: Annotation = {
          ...annotationPresentation,
          binding: {
            kind: "cell-terminal-name",
            terminalId: terminal.id,
          },
          ...(editedContent &&
          JSON.stringify(editedContent) !== JSON.stringify(semanticContent)
            ? { formatOverride: editedContent }
            : {}),
        };
        const renamed = terminal.name !== name;
        const edits = planEditCellTerminalAnnotation(
          project,
          document.id,
          terminal.id,
          normalizedAnnotation,
          name,
        );
        if (edits.length === 0) {
          setStatus(`Cell Port ${terminal.name} is already current`);
          return true;
        }
        const committed = commitStructure("edit-cell-port-label", edits);
        if (committed) {
          setStatus(
            renamed
              ? `Renamed formal port to ${name}`
              : `Formatted Cell Port ${name}`,
          );
        }
        return committed;
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Could not rename port",
        );
        return false;
      }
    },
  });
  const hasRotatableSelection =
    selectedIds.some((id) =>
      document.instances.some(
        (instance) => instance.id === id && instance.placement !== null,
      ),
    ) ||
    visualSelection.draftingIds.some((id) => {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      return (
        object?.kind === "arrow" ||
        object?.kind === "construction-line" ||
        object?.kind === "rectangle"
      );
    });
  const hasInspectableSelection = Boolean(
    selectedIds.length > 0 ||
    selectedRoute ||
    selectedAnnotation ||
    selectedDrafting ||
    selectedEndpoint,
  );
  const selectionShelfSummary = selectedInstance
    ? `${selectedInstance.id} · ${selectedInstance.symbolId}`
    : selectedIds.length > 1
      ? `${selectedIds.length} components`
      : selectedRoute
        ? `Route · ${
            document.nets.find((net) => net.id === selectedRoute.netId)?.name ??
            selectedRoute.netId
          }`
        : selectedAnnotation
          ? `Annotation · ${selectedAnnotation.kind}`
          : selectedDrafting
            ? `Drawing · ${selectedDrafting.kind}`
            : selectedEndpoint?.endpoint.kind === "junction"
              ? "Junction"
              : selectedEndpoint
                ? "Endpoint"
                : "None";
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
  const selectedNoConnect =
    selectedEndpoint && selectedEndpoint.endpoint.kind !== "junction"
      ? document.noConnects.find(
          (noConnect) =>
            endpointKey(noConnect.endpoint) ===
            endpointKey(selectedEndpoint.endpoint),
        )
      : undefined;
  const selectedEndpointNetId = selectedEndpoint
    ? endpointNetId(document, selectedEndpoint.endpoint)
    : null;
  const selectedHighlightNetId =
    selectedRoute?.netId ??
    selectedEndpointNetId ??
    selectedNetLabelBinding?.netId ??
    null;
  const selectedHighlightEndpoint =
    selectedRoute?.from ??
    selectedEndpoint?.endpoint ??
    selectedNetLabelBinding?.endpoint;
  const selectedHighlightIsActive = Boolean(
    selectedHighlightNetId &&
    highlightedNetOrigin?.documentId === document.id &&
    highlightedNetOrigin.netId === selectedHighlightNetId &&
    (!highlightedNetOrigin.endpoint ||
      (selectedHighlightEndpoint &&
        endpointKey(highlightedNetOrigin.endpoint) ===
          endpointKey(selectedHighlightEndpoint))),
  );
  const flightlines = useMemo(
    () =>
      document.nets.flatMap(
        (net) =>
          projectConnectivityIndex.documents.get(document.id)?.nets.get(net.id)
            ?.routingGuidance ?? [],
      ),
    [document.id, document.nets, projectConnectivityIndex],
  );
  const displayedFlightlines = useMemo(() => {
    // Routing guidance is derived exclusively from imported Net intent. It is
    // not Document UI state: labelling, moving, or deleting a Route must never
    // dismiss another imported Net's unresolved topology. A highlighted Net
    // already has the stronger conductor overlay, so omit only that Net's
    // guides rather than suppressing the complete imported document.
    if (routingGuidanceView === "hidden") return [];
    const focusedNetIds = new Set(
      [wireSource?.netId, selectedHighlightNetId, highlightedNetId].filter(
        (netId): netId is string => netId !== null && netId !== undefined,
      ),
    );
    const scoped =
      routingGuidanceView === "focused" && focusedNetIds.size > 0
        ? flightlines.filter((flightline) =>
            focusedNetIds.has(flightline.netId),
          )
        : flightlines;
    return highlightedNetId
      ? scoped.filter((flightline) => flightline.netId !== highlightedNetId)
      : scoped;
  }, [
    flightlines,
    highlightedNetId,
    routingGuidanceView,
    selectedHighlightNetId,
    wireSource?.netId,
  ]);
  const crossings = useMemo(
    () =>
      deriveCrossings(
        document,
        resolver,
        projectConnectivityIndex.documents.get(document.id)?.routingGeometry,
      ),
    [document, projectConnectivityIndex, resolver],
  );
  const visualDiagnostics = useMemo(
    () => diagnoseVisualQuality(document, resolver),
    [document, resolver],
  );
  const visualDiagnosticSummary = useMemo(
    () => summarizeVisualDiagnostics(visualDiagnostics),
    [visualDiagnostics],
  );
  const visibleEndpoints: WireSource[] = useMemo(
    () => [
      ...document.instances.flatMap((instance) => {
        if (!instance.placement) return [];
        const resolved = resolver.resolve(
          instance.symbolId,
          instance.symbolVariantId,
        );
        if (!resolved) return [];
        return resolved.definition.pins
          .filter((pin) =>
            isVisibleEndpoint(document, resolver, {
              kind: "terminal",
              instanceId: instance.id,
              pinName: pin.name,
            }),
          )
          .map((pin): WireSource => {
            const endpoint: RouteEndpoint = {
              kind: "terminal",
              instanceId: instance.id,
              pinName: pin.name,
            };
            return {
              endpoint,
              netId: endpointNetId(document, endpoint),
              point:
                resolveEndpointPoint(document, resolver, endpoint) ??
                transformPoint(
                  pin.at,
                  instance.placement!.position,
                  instance.placement!,
                ),
              preludeEdits: [],
              ...(isMosBulkTerminal(document, endpoint)
                ? { routePresentation: "bulk-dashed" as const }
                : {}),
            };
          });
      }),
      ...document.junctions
        .filter((junction) => {
          const role = junction.role ?? "branch";
          return role === "branch" || role === "route-anchor";
        })
        .map((junction): WireSource => ({
          endpoint: { kind: "junction", junctionId: junction.id },
          netId: junction.netId,
          point: junction.position,
          preludeEdits: [],
        })),
    ],
    [document, resolver],
  );
  const visibleBulkEndpoints: WireSource[] = useMemo(
    () =>
      document.instances.flatMap((instance): WireSource[] => {
        if (!instance.placement || bulkDrawInstanceId !== instance.id) {
          return [];
        }
        const resolved = resolver.resolve(
          instance.symbolId,
          instance.symbolVariantId,
        );
        const anchor = resolved?.variant?.auxiliaryPins?.find(
          (pin) => pin.name === "B",
        );
        if (!anchor) return [];
        const endpoint: RouteEndpoint = {
          kind: "terminal",
          instanceId: instance.id,
          pinName: "B",
        };
        return [
          {
            endpoint,
            netId: endpointNetId(document, endpoint),
            point: transformPoint(
              anchor.at,
              instance.placement.position,
              instance.placement,
            ),
            preludeEdits: [],
            routePresentation: "bulk-dashed",
          },
        ];
      }),
    [bulkDrawInstanceId, document, resolver],
  );
  const wiringEndpoints = useMemo(() => {
    const byKey = new Map<string, WireSource>();
    for (const endpoint of [...visibleEndpoints, ...visibleBulkEndpoints]) {
      byKey.set(endpointKey(endpoint.endpoint), endpoint);
    }
    return [...byKey.values()];
  }, [visibleBulkEndpoints, visibleEndpoints]);
  const routeGeometryRecords = useMemo(
    () =>
      document.routes.flatMap((route) => {
        const geometry = projectConnectivityIndex.documents
          .get(document.id)
          ?.routingGeometry.routes.get(route.id);
        if (!geometry) return [];
        return [{ route, geometry }];
      }),
    [document, projectConnectivityIndex],
  );
  const contactComponents = useMemo(
    () =>
      [
        ...(projectConnectivityIndex.documents
          .get(document.id)
          ?.nets.values() ?? []),
      ].flatMap((net) => net.routedComponents),
    [document.id, projectConnectivityIndex],
  );
  const {
    beginRouteStretch,
    drawSelectedMosBulk,
    deleteSelectedRouteConnection,
    editSelectedRouteJog,
    fixWirePoint,
    finishWireAtPoint,
    handleFlightline,
    handleWireRoutePointerDown,
    handleWireEndpoint,
    commitWire,
    selectRoute,
  } = useWireInteraction({
    document,
    resolver,
    selectedInstance,
    selectedRouteId,
    selectedRouteSegmentIndex,
    visibleEndpoints,
    routeGeometryRecords,
    wireSource,
    wireSourceRevision,
    wireWaypoints,
    wireDraftSteps,
    wireRoutingMode,
    wireCornerOrder,
    nextRoutingSuffix,
    transact,
    setStatus,
    setTool,
    setWireSource,
    setWirePreviewPoint,
    setWireDraftSteps,
    completeWire,
    clearTransientCanvasState,
    cancelInteraction,
    setBulkDrawInstanceId,
    replaceRouteSelection: (routeIds) =>
      replaceSelectionKind("route", routeIds),
    selectOnly,
    setSelectedRouteSegmentIndex,
    setSelectedEndpoint,
    canvasDragSessionRef,
    setRouteStretchPreview,
    pointFromClient,
    logicalRadiusForPixels,
    contactComponents,
    createRouteAnchor: routeAnchor,
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
        const symbol = resolver.resolve(
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
  const pendingPlacementSymbol = pendingSymbolId
    ? resolver.resolve(pendingSymbolId)?.definition
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
    beginComponentPlacement: (request) => {
      beginComponentPlacement(request);
      seedComponentPreviewFromPointer();
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
    beginCopyPlacement: beginCopyPlacementFromSelection,
    beginKeyboardSelectionMove: beginKeyboardSelectionMoveFromSelection,
    beginMove: beginMoveFromSelection,
    beginVisualSelectionMove: beginVisualSelectionMoveFromSelection,
    commitCopyPlacement: commitCopyPlacementFromSelection,
    commitCommandMove: commitCommandMoveFromSelection,
    clearCommandMoveSession: clearCommandMoveSessionFromSelection,
    deleteSelectedJunction: deleteSelectedJunctionFromSelection,
    deleteSelection: deleteSelectionFromSelection,
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
    copyPlacement,
    getInteractionKind: () => getCurrentInteractionState().kind,
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
    nextUniqueSuffix: () => {
      uniqueSuffixCounter.current += 1;
      return uniqueSuffixCounter.current;
    },
    nextNoConnectId,
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
    beginSelectionMoveInteraction,
    hasSelectedRoute: Boolean(selectedRoute),
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

  const internalSelection = deriveInternalGroupSelection(document, selectedIds);
  const selectedInternalRouteIds = new Set(internalSelection.routeIds);
  const selectedInternalJunctionIds = new Set(internalSelection.junctionIds);
  const selectedInternalObjectIds = new Set([
    ...internalSelection.netIds,
    ...internalSelection.routeIds,
    ...internalSelection.junctionIds,
  ]);
  const wireFixedPoints = wireSource
    ? compileWireDraft(wireSource, wireSource, wireDraftSteps).points
    : [];
  const wireDraftPoints =
    wireSource && wirePreviewPoint
      ? compileWireDraft(
          wireSource,
          { point: wirePreviewPoint },
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

  function compositeSelectionOwnsHit(
    kind: "instance" | "instance-label" | "annotation" | "route" | "junction",
    id: string,
  ): boolean {
    const hasCompositeSelection =
      selectedIds.length > 0 &&
      (selectedIds.length > 1 ||
        visualSelection.routeIds.length > 0 ||
        visualSelection.junctionIds.length > 0 ||
        visualSelection.annotationIds.length > 0 ||
        visualSelection.draftingIds.length > 0);
    if (!hasCompositeSelection) return false;
    if (kind === "instance" || kind === "instance-label") {
      return selectedIds.includes(id);
    }
    if (kind === "route") {
      return (
        visualSelection.routeIds.includes(id) ||
        selectedInternalRouteIds.has(id)
      );
    }
    if (kind === "junction") {
      return (
        visualSelection.junctionIds.includes(id) ||
        selectedInternalJunctionIds.has(id)
      );
    }
    const annotation = document.annotations.find(
      (candidate) => candidate.id === id,
    );
    return Boolean(
      visualSelection.annotationIds.includes(id) ||
      (annotation?.anchor.kind === "object" &&
        (selectedIds.includes(annotation.anchor.objectId) ||
          selectedInternalObjectIds.has(annotation.anchor.objectId))),
    );
  }

  useEffect(() => {
    if (!selectedRouteId) setSelectedRouteSegmentIndex(null);
  }, [selectedRouteId]);

  useEffect(() => {
    if (!cellSymbolLayoutEnabled) return;
    // Symbol geometry is definition-level, but its canvas grips belong to one
    // selected parent instance. Do not let them survive a selection change.
    if (
      selectedInstance?.id !== cellSymbolLayoutTargetInstanceId ||
      !selectedHierarchyCell?.netlist
    ) {
      exitCellSymbolLayout();
    }
  }, [
    cellSymbolLayoutEnabled,
    cellSymbolLayoutTargetInstanceId,
    selectedHierarchyCell?.netlist,
    selectedInstance?.id,
  ]);

  useEffect(() => {
    if (!selectionOpen && cellSymbolLayoutEnabled) exitCellSymbolLayout();
  }, [cellSymbolLayoutEnabled, selectionOpen]);

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
    void refreshUserExamples();
  }

  function toggleExamplesPanel(): void {
    toggleExamplesPanelFromShell();
    void refreshUserExamples();
  }

  // Landing-page deep links: `/g/<id>` opens a published gallery entry and
  // `/editor?example=<id>` opens a bundled example. Both replace the fresh
  // boot Project only; ordinary sessions never re-run these.
  const bootTargetHandled = useRef(false);
  useEffect(() => {
    if (bootTargetHandled.current) return;
    bootTargetHandled.current = true;
    const exampleId = new URLSearchParams(window.location.search).get(
      "example",
    );
    if (initialGalleryEntryId) {
      void (async () => {
        try {
          const response = await fetch(
            `/api/gallery/${initialGalleryEntryId}`,
            { credentials: "same-origin" },
          );
          if (!response.ok) {
            setStatus("This gallery entry is unavailable");
            return;
          }
          const payload = (await response.json()) as {
            entry?: { name?: string };
            ownerUserId?: string | null;
            projectText?: string;
          };
          if (!payload.projectText) {
            setStatus("This gallery entry is unavailable");
            return;
          }
          const galleryProject = parseProject(payload.projectText);
          replaceActiveProject(galleryProject);
          setGalleryEntryContext({
            id: initialGalleryEntryId,
            ownerUserId: payload.ownerUserId ?? null,
          });
          setStatus(
            `Opened gallery circuit: ${payload.entry?.name ?? galleryProject.name}`,
          );
        } catch {
          setStatus("This gallery entry is unavailable");
        }
      })();
      return;
    }
    if (exampleId) {
      const exampleProject = createLibraryExampleProject(exampleId);
      const example = libraryProjectExamples.find(
        (candidate) => candidate.id === exampleId,
      );
      if (exampleProject && example) {
        replaceActiveProject(exampleProject);
        setStatus(`Opened example: ${example.name}`);
      }
    }
  }, [initialGalleryEntryId]);

  async function refreshUserExamples(): Promise<void> {
    const outcome = await userExamplesStore.current.list();
    if (outcome.status === "ready") setUserExamples(outcome.examples);
  }

  async function saveCurrentProjectAsExample(): Promise<void> {
    const outcome = await userExamplesStore.current.save(project, {
      id: crypto.randomUUID(),
      name: project.name,
      savedAt: new Date().toISOString(),
    });
    if (outcome.status === "stored") {
      await refreshUserExamples();
      setStatus(`Saved "${outcome.record.name}" to My examples`);
      showExamplesPanel();
      return;
    }
    setStatus(
      outcome.status === "rejected-too-large"
        ? "Cannot save example: the Project snapshot is too large"
        : `Cannot save example: ${outcome.message}`,
    );
  }

  async function openUserExample(id: string): Promise<void> {
    const outcome = await userExamplesStore.current.read(id);
    if (outcome.status !== "ready") {
      setStatus(
        outcome.status === "missing"
          ? "This saved example no longer exists"
          : `Cannot open saved example: ${
              outcome.status === "invalid" ? outcome.message : outcome.message
            }`,
      );
      void refreshUserExamples();
      return;
    }
    void guardDirtyReplacement(`Open ${outcome.record.name} example`, () => {
      replaceActiveProject(outcome.project);
      setStatus(`Opened my example: ${outcome.record.name}`);
    });
  }

  async function exportUserExample(id: string): Promise<void> {
    const outcome = await userExamplesStore.current.read(id);
    if (outcome.status !== "ready") {
      setStatus("Cannot export: this saved example is unavailable");
      return;
    }
    download(
      outcome.record.projectText,
      "application/json",
      "icproj.json",
      outcome.record.name,
    );
    setStatus(`Exported my example: ${outcome.record.name}`);
  }

  async function deleteUserExample(id: string): Promise<void> {
    const outcome = await userExamplesStore.current.remove(id);
    setStatus(
      outcome.status === "deleted"
        ? "Deleted saved example"
        : `Cannot delete saved example: ${outcome.message}`,
    );
    await refreshUserExamples();
  }

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
  }

  function selectEndpoint(candidate: WireSource): void {
    setSelectedEndpoint(candidate);
    if (candidate.endpoint.kind === "junction") {
      selectOnly("junction", [candidate.endpoint.junctionId]);
    } else {
      resetSelection();
    }
  }

  function switchDocument(nextDocumentId: string): void {
    if (nextDocumentId === document.id) return;
    documentViewBoxes.current.set(document.id, viewBox);
    const nextDocument = openDocument(nextDocumentId);
    if (!nextDocument) {
      setStatus(`Document not found: ${nextDocumentId}`);
      return;
    }
    setViewBox(
      documentViewBoxes.current.get(nextDocument.id) ?? DEFAULT_VIEWBOX,
      nextDocument.presentation.grid,
    );
    resetInteractionState();
    setStatus(`Opened Cell ${nextDocument.name}`);
  }

  function openInstanceFromTable(documentId: string, instanceId: string): void {
    const paths = findHierarchyPaths(
      projectConnectivityIndex,
      project.topDocumentId,
      documentId,
    );
    // A reused definition remains a single table row. Navigation still needs
    // one concrete caller context, so use the deterministic first valid path.
    setDocumentStack(paths?.[0] ? [...paths[0]] : []);
    switchDocument(documentId);
    selectOnly("instance", [instanceId]);
    setInstanceTableOpen(false);
    setStatus(
      paths && paths.length > 1
        ? `Opened ${documentId}.${instanceId} via one of ${paths.length} caller paths`
        : `Opened ${documentId}.${instanceId}`,
    );
  }

  function commitStructure(
    transactionId: string,
    edits: ProjectStructureEdit[],
    activeDocumentId = document.id,
  ): boolean {
    const result = dispatchProjectTransaction(
      {
        transactionId,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "human-local" },
        edits,
      },
      activeDocumentId,
    );
    if (result.ok && result.applied) return true;
    const message = result.ok
      ? "The structural transaction made no change"
      : (result.diagnostics[0]?.message ?? result.error.message);
    setStatus(`Could not update Cell structure: ${message}`);
    return false;
  }

  function createCell(name: string): void {
    name = name.trim();
    if (!name) return;
    const child = createEmptyDocument(createId("document"), name);
    child.netlist!.name = name;
    child.presentation = structuredClone(document.presentation);
    if (commitStructure("create-cell", planCreateCell(child), child.id)) {
      setDocumentStack([]);
      setStatus(`Created Cell ${name}`);
    }
  }

  function renameCell(documentId: string, name: string): void {
    const target = project.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!target) return;
    name = name.trim();
    if (!name || name === target.name) return;
    if (
      commitStructure("rename-cell", planRenameCell(project, documentId, name))
    ) {
      setStatus(`Renamed Cell to ${name}`);
    }
  }

  function jumpToCaller(parentDocumentId: string, instanceId: string): void {
    const path = findHierarchyPath(
      projectConnectivityIndex,
      project.topDocumentId,
      parentDocumentId,
    );
    if (!path) {
      setStatus("Caller path could not be resolved");
      return;
    }
    setDocumentStack([...path]);
    switchDocument(parentDocumentId);
    selectOnly("instance", [instanceId]);
    setCellManagerOpen(false);
    setStatus(`Opened caller ${parentDocumentId}.${instanceId}`);
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
    startInsertFromHook(cellInsertLaunch());
    setStatus("Choose a Cell, then place it on the canvas");
  }

  function updateCellPortDirection(
    terminalId: string,
    direction: "input" | "output" | "inout" | "passive",
    targetDocumentId = document.id,
  ): void {
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === targetDocumentId,
    );
    if (!targetDocument?.netlist) return;
    if (
      commitStructure(
        "update-cell-port-direction",
        planUpdateCellTerminalDirection(
          project,
          targetDocumentId,
          terminalId,
          direction,
        ),
      )
    ) {
      setStatus("Updated Cell port direction");
    }
  }

  function renameCellTerminal(
    terminalId: string,
    name: string,
    targetDocumentId = document.id,
  ): void {
    const nextName = name.trim();
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === targetDocumentId,
    );
    const terminal = targetDocument?.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    if (!terminal || !nextName || terminal.name === nextName) return;
    try {
      if (
        commitStructure(
          "rename-cell-interface-terminal",
          planRenameCellTerminal(
            project,
            targetDocumentId,
            terminalId,
            nextName,
          ),
        )
      ) {
        setStatus(`Renamed formal port to ${nextName}`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not rename port",
      );
    }
  }

  function moveCellTerminal(
    terminalId: string,
    delta: -1 | 1,
    targetDocumentId = document.id,
  ): void {
    const edits = planReorderCellTerminal(
      project,
      targetDocumentId,
      terminalId,
      delta,
    );
    if (edits.length === 0) return;
    if (commitStructure("reorder-cell-interface-terminal", edits)) {
      setStatus("Reordered formal terminal interface");
    }
  }

  function setCellFormalParameters(
    formalParameters: NonNullable<
      SchematicDocument["netlist"]
    >["formalParameters"],
    targetDocumentId = document.id,
  ): void {
    try {
      const proposal = proposeSetCellFormalParameters(
        project,
        targetDocumentId,
        formalParameters.map((parameter) => ({
          name: parameter.name.trim(),
          ...(parameter.defaultValue?.trim()
            ? { defaultValue: parameter.defaultValue.trim() }
            : {}),
        })),
      );
      if (commitStructure("set-cell-formal-parameters", [...proposal.edits])) {
        setStatus("Updated Cell formal parameters");
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not update Cell formal parameters",
      );
    }
  }

  function setExternalSubcircuitDefinition(
    definition: ExternalSubcircuitDefinition,
  ): void {
    try {
      const proposal = proposeUpsertExternalSubcircuitDefinition(
        project,
        definition,
      );
      if (proposal.diagnostics.length > 0) {
        setStatus(
          `Cannot update external interface: ${proposal.diagnostics[0]}`,
        );
        return;
      }
      if (
        commitStructure("upsert-external-subcircuit-interface", [
          ...proposal.edits,
        ])
      ) {
        setStatus(`Updated external subcircuit ${definition.name}`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not update external subcircuit interface",
      );
    }
  }

  function setCellSymbolBodySize(
    child: SchematicDocument,
    width: number,
    height: number,
  ): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width % 10 !== 0 ||
      height % 10 !== 0
    ) {
      setStatus("Cell symbol size must use positive 10-unit grid values");
      return;
    }
    const current = child.presentation.cellSymbol;
    if (
      commitStructure(
        "resize-cell-symbol",
        planSetCellSymbolPresentation(project, child.id, {
          ...(current?.pinPlacements
            ? { pinPlacements: current.pinPlacements }
            : {}),
          minimumBodySize: { width, height },
        }),
      )
    ) {
      setStatus(`Resized ${child.name} symbol for every parent instance`);
    }
  }

  function setCellSymbolPortPlacement(
    child: SchematicDocument,
    terminalId: string,
    side: "north" | "east" | "south" | "west" | "auto",
    offset: number,
  ): void {
    try {
      if (
        commitStructure(
          "move-cell-symbol-pin",
          planSetCellTerminalPlacement(
            project,
            child.id,
            terminalId,
            side,
            offset,
          ),
        )
      ) {
        setStatus(`Moved Cell symbol pin in every parent instance`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not move Cell symbol pin",
      );
    }
  }

  function exitCellSymbolLayout(): void {
    setCellSymbolLayoutDrag(null);
    setCellSymbolLayoutEnabled(false);
    setCellSymbolLayoutTargetInstanceId(null);
  }

  function toggleCellSymbolLayout(): void {
    if (cellSymbolLayoutEnabled) {
      exitCellSymbolLayout();
      return;
    }
    if (!selectedHierarchyCell || !selectedInstance?.placement) return;
    setCellSymbolLayoutTargetInstanceId(selectedInstance.id);
    setCellSymbolLayoutEnabled(true);
  }

  function beginCellSymbolLayoutDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    kind: "body" | "pin",
    terminalId?: string,
  ): void {
    if (!selectedCellSymbolLayout) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCellSymbolLayoutDrag({
      kind,
      pointerId: event.pointerId,
      ...(terminalId ? { terminalId } : {}),
    });
  }

  function completeCellSymbolLayoutDrag(
    event: ReactPointerEvent<SVGSVGElement>,
  ): boolean {
    const drag = cellSymbolLayoutDrag;
    const layout = selectedCellSymbolLayout;
    if (!drag || drag.pointerId !== event.pointerId || !layout) return false;
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    const local = inverseTransformPoint(
      point,
      layout.instance.placement!.position,
      layout.instance.placement!,
    );
    setCellSymbolLayoutDrag(null);
    if (drag.kind === "body") {
      setCellSymbolBodySize(
        layout.child,
        Math.max(10, snapCoordinate(Math.abs(local.x) * 2, 10)),
        Math.max(10, snapCoordinate(Math.abs(local.y) * 2, 10)),
      );
      return true;
    }
    if (!drag.terminalId) return true;
    if (drag.kind === "pin") {
      const distances = [
        ["west", Math.abs(local.x - layout.body.left)],
        ["east", Math.abs(local.x - layout.body.right)],
        ["north", Math.abs(local.y - layout.body.top)],
        ["south", Math.abs(local.y - layout.body.bottom)],
      ] as const;
      const side = distances.reduce((closest, candidate) =>
        candidate[1] < closest[1] ? candidate : closest,
      )[0];
      const offset = snapCoordinate(
        side === "west" || side === "east" ? local.y : local.x,
        10,
      );
      setCellSymbolPortPlacement(layout.child, drag.terminalId, side, offset);
      return true;
    }
    return true;
  }

  const selectedFormalTerminal = selectedInstance
    ? document.netlist?.terminals.find((terminal) =>
        terminal.interfaceInstanceIds.includes(selectedInstance.id),
      )
    : undefined;
  const selectedPortNet =
    selectedInstance &&
    (selectedInstance.symbolId === "port" ||
      selectedInstance.symbolId === "port-filled")
      ? document.nets.find((net) =>
          net.terminals.some(
            (terminal) => terminal.instanceId === selectedInstance.id,
          ),
        )
      : undefined;
  function renameSelectedNetPort(name: string): void {
    if (!selectedPortNet || selectedFormalTerminal) return;
    name = name.trim();
    if (!name || name === selectedPortNet.name) return;
    // Naming a Free Net Port joins an existing Net of that name instead of
    // leaving two same-name Nets behind, exactly as placing a named Port does.
    const plan = planEnsureNamedNet(document, {
      candidateNetId: selectedPortNet.id,
      name,
    });
    if (!plan.ok) {
      setStatus(plan.message);
      return;
    }
    if (plan.edits.length === 0 || transact([...plan.edits]).ok) {
      setStatus(`Renamed Net Port to ${plan.name}`);
    }
  }
  function renameSelectedFormalPort(name: string): void {
    if (!selectedFormalTerminal) return;
    name = name.trim();
    if (!name || name === selectedFormalTerminal.name) return;
    try {
      const edits = planRenameCellTerminal(
        project,
        document.id,
        selectedFormalTerminal.id,
        name,
      );
      if (commitStructure("rename-cell-port", edits)) {
        setStatus(`Renamed formal port to ${name}`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not rename port",
      );
    }
  }

  function deleteSelectedFormalPort(): void {
    if (!selectedFormalTerminal || !selectedInstance) return;
    try {
      const edits = planRemoveCellTerminalMarkers(
        project,
        document.id,
        [selectedInstance.id],
        proposeConnectedInstanceDeletion(
          document,
          resolver,
          [selectedInstance.id],
          ++uniqueSuffixCounter.current,
        ),
      );
      if (commitStructure("delete-cell-port", edits)) {
        resetSelection();
        setStatus(
          selectedFormalTerminal.interfaceInstanceIds.length > 1
            ? `Deleted formal port marker ${selectedFormalTerminal.name}`
            : `Deleted formal port ${selectedFormalTerminal.name}`,
        );
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not delete port",
      );
    }
  }

  function deleteCurrentSelection(): void {
    const formalTerminals = (document.netlist?.terminals ?? []).filter(
      (terminal) =>
        terminal.interfaceInstanceIds.some((instanceId) =>
          visualSelection.instanceIds.includes(instanceId),
        ),
    );
    if (formalTerminals.length === 0) {
      deleteSelectionFromSelection();
      return;
    }
    const protectedTerminalIds = new Set(
      formalTerminals
        .filter(
          (terminal) =>
            terminal.interfaceInstanceIds.every((instanceId) =>
              visualSelection.instanceIds.includes(instanceId),
            ) &&
            Boolean(
              findCellTerminalCaller(project, document.id, terminal.name),
            ),
        )
        .map((terminal) => terminal.id),
    );
    const selectedFormalMarkerIds = formalTerminals.flatMap((terminal) =>
      terminal.interfaceInstanceIds.filter((instanceId) =>
        visualSelection.instanceIds.includes(instanceId),
      ),
    );
    const protectedInstanceIds = new Set(
      formalTerminals
        .filter((terminal) => protectedTerminalIds.has(terminal.id))
        .flatMap((terminal) => terminal.interfaceInstanceIds),
    );
    const removableMarkerIds = selectedFormalMarkerIds.filter(
      (instanceId) => !protectedInstanceIds.has(instanceId),
    );
    const deletionSelection = {
      ...visualSelection,
      instanceIds: visualSelection.instanceIds.filter(
        (instanceId) => !protectedInstanceIds.has(instanceId),
      ),
      annotationIds: visualSelection.annotationIds.filter((annotationId) => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === annotationId,
        );
        return !(
          annotation?.anchor.kind === "object" &&
          protectedInstanceIds.has(annotation.anchor.objectId)
        );
      }),
    };
    try {
      const deletionEdits = proposeVisualSelectionDeletion(
        document,
        resolver,
        deletionSelection,
        ++uniqueSuffixCounter.current,
      );
      if (removableMarkerIds.length > 0) {
        if (
          commitStructure(
            "delete-cell-port-selection",
            planRemoveCellTerminalMarkers(
              project,
              document.id,
              removableMarkerIds,
              deletionEdits,
            ),
          )
        ) {
          if (protectedInstanceIds.size > 0) {
            replaceSelection({
              ...visualSelection,
              instanceIds: [...protectedInstanceIds],
              annotationIds: visualSelection.annotationIds.filter(
                (annotationId) =>
                  document.annotations.some(
                    (annotation) =>
                      annotation.id === annotationId &&
                      annotation.anchor.kind === "object" &&
                      protectedInstanceIds.has(annotation.anchor.objectId),
                  ),
              ),
            });
          } else {
            resetSelection();
          }
          setStatus(
            protectedInstanceIds.size > 0
              ? `Deleted selection; kept ${protectedInstanceIds.size} Cell Port${protectedInstanceIds.size === 1 ? "" : "s"} with parent wiring`
              : "Deleted selected schematic objects",
          );
        }
        return;
      }
      if (deletionEdits.length > 0 && transact(deletionEdits).ok) {
        replaceSelection({
          ...visualSelection,
          instanceIds: [...protectedInstanceIds],
          annotationIds: visualSelection.annotationIds.filter((annotationId) =>
            document.annotations.some(
              (annotation) =>
                annotation.id === annotationId &&
                annotation.anchor.kind === "object" &&
                protectedInstanceIds.has(annotation.anchor.objectId),
            ),
          ),
        });
        setStatus(
          "Deleted selected objects; kept Cell Ports with parent wiring",
        );
        return;
      }
      setStatus("Cell Port is kept because it is still wired in a parent Cell");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function navigateToLocator(
    locator: ObjectLocator,
    statusMessage: string,
  ): void {
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === locator.documentId,
    );
    if (!targetDocument) {
      setStatus(`Document not found: ${locator.documentId}`);
      return;
    }
    const derivedPath = findHierarchyPath(
      projectConnectivityIndex,
      project.topDocumentId,
      locator.documentId,
    );
    const hierarchyPath =
      locator.hierarchyPath.length > 0
        ? locator.hierarchyPath
        : (derivedPath ?? []);
    documentViewBoxes.current.set(document.id, viewBox);
    const opened = openDocument(locator.documentId);
    if (!opened) {
      setStatus(`Document not found: ${locator.documentId}`);
      return;
    }
    setDocumentStack([...hierarchyPath]);
    setViewBox(
      documentViewBoxes.current.get(opened.id) ?? DEFAULT_VIEWBOX,
      opened.presentation.grid,
    );
    resetInteractionState();

    const focusPoint = (point: Point) =>
      setViewBox(
        {
          x: point.x - 80,
          y: point.y - 60,
          width: 160,
          height: 120,
        },
        opened.presentation.grid,
      );
    const endpoint =
      locator.kind === "terminal"
        ? locator.endpoint
        : locator.kind === "no-connect"
          ? opened.noConnects.find(
              (noConnect) => noConnect.id === locator.objectId,
            )?.endpoint
          : undefined;
    if (endpoint) {
      const point =
        endpoint.kind === "terminal"
          ? (() => {
              const instance = opened.instances.find(
                (candidate) => candidate.id === endpoint.instanceId,
              );
              const resolved = instance
                ? resolver.resolve(instance.symbolId, instance.symbolVariantId)
                : undefined;
              const pin = resolved?.definition.pins.find(
                (candidate) => candidate.name === endpoint.pinName,
              );
              return instance?.placement && pin
                ? transformPoint(
                    pin.at,
                    instance.placement.position,
                    instance.placement,
                  )
                : null;
            })()
          : null;
      if (point) {
        setSelectedEndpoint({
          endpoint,
          netId: endpointNetId(opened, endpoint),
          point,
          preludeEdits: [],
        });
        focusPoint(point);
      }
    } else if (locator.kind === "instance") {
      const instance = opened.instances.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("instance", [locator.objectId]);
      if (instance?.placement) focusPoint(instance.placement.position);
    } else if (locator.kind === "route") {
      const route = opened.routes.find((item) => item.id === locator.objectId);
      selectOnly("route", [locator.objectId]);
      const centerline = route
        ? projectConnectivityIndex.documents
            .get(opened.id)
            ?.routingGeometry.routes.get(route.id)?.centerline
        : undefined;
      if (centerline?.[0]) focusPoint(centerline[0]);
    } else if (locator.kind === "junction") {
      const junction = opened.junctions.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("junction", [locator.objectId]);
      if (junction) focusPoint(junction.position);
    } else if (locator.kind === "annotation") {
      const annotation = opened.annotations.find(
        (item) => item.id === locator.objectId,
      );
      selectOnly("annotation", [locator.objectId]);
      const position =
        annotation?.anchor.kind === "free"
          ? annotation.anchor.position
          : annotation?.anchor.fallbackPosition;
      if (position) focusPoint(position);
    } else if (locator.kind === "net") {
      setHighlightedNetOrigin({
        documentId: opened.id,
        netId: locator.objectId,
      });
      const route = opened.routes.find(
        (item) => item.netId === locator.objectId,
      );
      const centerline = route
        ? projectConnectivityIndex.documents
            .get(opened.id)
            ?.routingGeometry.routes.get(route.id)?.centerline
        : undefined;
      if (centerline?.[0]) focusPoint(centerline[0]);
    }
    setSelectionOpen(true);
    setStatus(statusMessage);
  }

  function navigateToNetlistDiagnostic(diagnostic: NetlistDiagnostic): void {
    navigateToLocator(diagnostic.primary, `Preflight: ${diagnostic.message}`);
    if (diagnostic.primary.kind !== "document") return;
    const target = project.documents.find(
      (candidate) => candidate.id === diagnostic.primary.documentId,
    );
    if (!target) return;
    setViewBox(
      fitCameraToBounds(
        buildSvgScene(target, resolver).viewBox,
        target.presentation.grid,
      ),
      target.presentation.grid,
    );
  }

  function applyAgentSemanticIntent(
    request: AgentHostSemanticIntentRequest,
  ): AgentHostSemanticIntentResult {
    const intent = request.intent;
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === request.documentId,
    );
    if (!targetDocument) {
      return {
        ok: false,
        code: "DOCUMENT_NOT_FOUND",
        message: `Document ${request.documentId} is not present in this Project`,
      };
    }
    const activateDocument = (message: string) => {
      const hierarchyPath =
        findHierarchyPath(
          projectConnectivityIndex,
          project.topDocumentId,
          targetDocument.id,
        ) ?? [];
      navigateToLocator(
        {
          documentId: targetDocument.id,
          hierarchyPath,
          kind: "document",
          objectId: targetDocument.id,
        },
        message,
      );
    };
    const fail = (
      code: string,
      message: string,
    ): AgentHostSemanticIntentResult => ({
      ok: false,
      code,
      message,
    });

    switch (intent.kind) {
      case "activate-document":
        activateDocument(`Agent activated Cell ${targetDocument.name}`);
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      case "fit-document": {
        activateDocument(`Agent fit Cell ${targetDocument.name}`);
        setViewBox(
          fitCameraToBounds(
            buildSvgScene(targetDocument, resolver).viewBox,
            targetDocument.presentation.grid,
          ),
          targetDocument.presentation.grid,
        );
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      }
      case "clear-focus":
        resetInteractionState();
        setHighlightedNetOrigin(null);
        setSelectionOpen(false);
        setStatus("Agent cleared semantic focus");
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      case "highlight-net": {
        const net = targetDocument.nets.find(
          (candidate) => candidate.id === intent.netId,
        );
        if (!net) {
          return fail(
            "OBJECT_NOT_FOUND",
            `Net ${intent.netId} is not present in Document ${targetDocument.id}`,
          );
        }
        activateDocument(`Agent highlighted Net ${net.name ?? net.id}`);
        highlightNet(net.id, targetDocument.id, intent.endpoint);
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [net.id],
          netId: net.id,
        };
      }
      case "select": {
        const { locator } = intent;
        if (locator.documentId !== targetDocument.id) {
          return fail(
            "DOCUMENT_MISMATCH",
            "A semantic locator must address the transaction Document",
          );
        }
        const expectedHierarchyPath = findHierarchyPath(
          projectConnectivityIndex,
          project.topDocumentId,
          targetDocument.id,
        );
        if (
          !expectedHierarchyPath ||
          expectedHierarchyPath.length !== locator.hierarchyPath.length ||
          expectedHierarchyPath.some(
            (frame, index) =>
              frame.parentDocumentId !==
                locator.hierarchyPath[index]?.parentDocumentId ||
              frame.instanceId !== locator.hierarchyPath[index]?.instanceId ||
              frame.childDocumentId !==
                locator.hierarchyPath[index]?.childDocumentId,
          )
        ) {
          return fail(
            "LOCATOR_MISMATCH",
            "The locator hierarchy path is not reachable from this Project top Cell",
          );
        }
        const exists = (() => {
          switch (locator.kind) {
            case "instance":
              return targetDocument.instances.some(
                (item) => item.id === locator.objectId,
              );
            case "net":
              return targetDocument.nets.some(
                (item) => item.id === locator.objectId,
              );
            case "route":
              return targetDocument.routes.some(
                (item) => item.id === locator.objectId,
              );
            case "junction":
              return targetDocument.junctions.some(
                (item) => item.id === locator.objectId,
              );
            case "annotation":
              return targetDocument.annotations.some(
                (item) => item.id === locator.objectId,
              );
            case "no-connect":
              return targetDocument.noConnects.some(
                (item) => item.id === locator.objectId,
              );
            case "terminal": {
              const endpoint = locator.endpoint;
              if (endpoint?.kind !== "terminal") return false;
              const instance = targetDocument.instances.find(
                (item) => item.id === endpoint.instanceId,
              );
              const resolved = instance
                ? resolver.resolve(instance.symbolId, instance.symbolVariantId)
                : null;
              return (
                resolved?.definition.pins.some(
                  (pin) => pin.name === endpoint.pinName,
                ) ?? false
              );
            }
          }
        })();
        if (!exists) {
          return fail(
            "OBJECT_NOT_FOUND",
            `Locator ${locator.kind} ${locator.objectId} is not present in Document ${targetDocument.id}`,
          );
        }
        const objectLocator: ObjectLocator = {
          documentId: locator.documentId,
          hierarchyPath: locator.hierarchyPath,
          kind: locator.kind,
          objectId: locator.objectId,
          ...(locator.endpoint ? { endpoint: locator.endpoint } : {}),
        };
        navigateToLocator(
          objectLocator,
          `Agent selected ${locator.kind} ${locator.objectId}`,
        );
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [locator.objectId],
          ...(locator.kind === "net" ? { netId: locator.objectId } : {}),
        };
      }
    }
  }

  agentSemanticIntentRef.current = applyAgentSemanticIntent;

  function enterHierarchy(instanceId: string): void {
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const targetId = instance ? referencedDocumentId(project, instance) : null;
    if (!targetId) {
      setStatus(`${instanceId} has no child Cell`);
      return;
    }
    setDocumentStack((current) => [
      ...current,
      {
        parentDocumentId: document.id,
        instanceId,
        childDocumentId: targetId,
      },
    ]);
    switchDocument(targetId);
  }

  function enterSelectedHierarchy(): void {
    if (
      selectedInstance &&
      referencedDocumentId(project, selectedInstance) !== null
    ) {
      enterHierarchy(selectedInstance.id);
      return;
    }
    if (selectedDrafting?.kind !== "rectangle") {
      setStatus(
        "Select a rectangle or hierarchical block before entering a Cell",
      );
      return;
    }
    try {
      const converted = convertRectangleToHierarchy(
        project,
        document.id,
        selectedDrafting.id,
      );
      commitProjectStructure(converted.project, document.id);
      setDocumentStack((current) => [
        ...current,
        {
          parentDocumentId: converted.parentDocumentId,
          instanceId: converted.instanceId,
          childDocumentId: converted.childDocumentId,
        },
      ]);
      switchDocument(converted.childDocumentId);
      setStatus(`Created and entered Cell ${converted.cellName}`);
    } catch (error) {
      setStatus(
        `Could not create Cell: ${
          error instanceof Error ? error.message : "unexpected failure"
        }`,
      );
    }
  }

  function returnToParentDocument(): void {
    const frame = documentStack.at(-1);
    if (!frame) return;
    setDocumentStack((current) => current.slice(0, -1));
    switchDocument(frame.parentDocumentId);
  }

  function returnToTopDocument(): void {
    setDocumentStack([]);
    switchDocument(project.topDocumentId);
  }

  function replaceActiveProject(
    nextProject: CircuitProject,
    nextViewBox: GridRect = DEFAULT_VIEWBOX,
    options: {
      source?: BrowserRecoverySource;
      keepWorkingCopy?: boolean;
      formalFileHint?: BrowserRecoveryFormalFileHint;
    } = {},
  ): SchematicDocument {
    // Drop any pending recovery write for the outgoing project so it cannot
    // revive after Save/Discard/Open/Import/Restore/demo-load swaps the
    // project, then give the incoming project its own working-copy identity
    // (an explicit-refresh restore keeps the identity it is continuing).
    cancelRecovery();
    if (options.keepWorkingCopy !== true) {
      beginRecoveryWorkingCopy(options.source ?? "new");
    }
    if (options.formalFileHint !== undefined) {
      noteRecoveryFormalFileHint(options.formalFileHint);
    }
    browserAgentFileHost.clear();
    setAgentFileCandidate(null);
    setImportReport(null);
    setImportReviewOpen(false);
    const prepared = materializeRazaviProjectBulkConnections(nextProject);
    const nextDocument = replaceProject(prepared.project);
    documentViewBoxes.current = new Map();
    setDocumentStack([]);
    setViewBox(nextViewBox, nextDocument.presentation.grid);
    resetInteractionState();
    setFileState(options.source === "opened-file" ? "opened" : "new");
    // Seed the incoming working copy immediately; the outgoing project's
    // stored records are retained under its own session.
    stageRecovery(prepared.project);
    return nextDocument;
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

  function jumpToProjectDiagnostic(diagnostic: Diagnostic): void {
    navigateToLocator(
      diagnostic.primary,
      `${diagnostic.domain.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
    );
  }

  function applyResult(result: EditTransactionResult): void {
    if (!result.ok) {
      const detail = result.diagnostics[0]?.message;
      setStatus(
        detail && detail !== result.error.message
          ? `${result.error.code}: ${result.error.message} — ${detail}`
          : `${result.error.code}: ${result.error.message}`,
      );
      return;
    }
    setStatus(
      result.applied
        ? `Committed revision ${result.revision}`
        : `Dry run for revision ${result.proposedRevision}`,
    );
  }

  function transact(
    edits: SchematicEdit[],
    options: {
      completesWireSession?: boolean;
      preserveInteraction?: boolean;
    } = {},
  ): EditTransactionResult {
    let result: EditTransactionResult;
    try {
      result = transactDocument(edits);
    } catch (error) {
      // The controller fence normally converts engine failures into typed
      // rejections; this catch covers the thin React wrapper around it.
      // Either way the committed circuit is unchanged, so only the transient
      // interaction state needs to be dropped.
      cancelAllTransientInteraction();
      const message =
        error instanceof Error ? error.message : "unexpected failure";
      setStatus(
        `INTERNAL_ERROR: ${message} — operation cancelled; circuit unchanged`,
      );
      return {
        ok: false,
        applied: false,
        revision: document.revision,
        document,
        error: { code: "INTERNAL_ERROR", message },
        diagnostics: [],
      };
    }
    applyResult(result);
    if (!result.ok && result.error.code === "INTERNAL_ERROR") {
      cancelAllTransientInteraction();
    }
    const currentInteraction = getCurrentInteractionState();
    const preservesCurrentInteraction =
      options.preserveInteraction ||
      (currentInteraction.kind === "wire" && options.completesWireSession);
    if (
      result.ok &&
      currentInteraction.kind !== "idle" &&
      !preservesCurrentInteraction
    ) {
      const cancelledKind = currentInteraction.kind;
      cancelAllTransientInteraction();
      setStatus(
        cancelledKind === "wire"
          ? `Committed revision ${result.revision}; Wire cancelled because the circuit changed`
          : `Committed revision ${result.revision}; active tool cancelled because the circuit changed`,
      );
    }
    return result;
  }

  /**
   * Connectivity edits are still persisted as the established typed edits.
   * This fence gives every GUI producer the same Cell/revision contract before
   * it reaches that mutation boundary.
   */
  function transactConnectivity(
    intent: ConnectivityIntent,
    edits: readonly SchematicEdit[],
    preview?: unknown,
    options: {
      completesWireSession?: boolean;
      preserveInteraction?: boolean;
    } = {},
  ): EditTransactionResult | null {
    const proposal = createConnectivityProposal(document, {
      intent,
      edits,
      diagnostics: [],
      ...(preview === undefined ? {} : { preview }),
    });
    const gate = gateConnectivityProposal(document, proposal);
    if (!gate.ok) {
      setStatus(gate.message);
      return null;
    }
    return transact([...gate.edits], options);
  }

  const clearableObjectCount =
    document.instances.length +
    document.nets.length +
    document.routes.length +
    document.junctions.length +
    document.noConnects.length +
    document.annotations.length +
    document.layoutGroups.length +
    document.constraints.length +
    (document.mosBulkDefaults ? 1 : 0) +
    (document.drafting?.objects.length ?? 0);

  function clearCanvas(): void {
    if (clearableObjectCount === 0) {
      setStatus(`Cell ${document.name} is already clear`);
      return;
    }
    const confirmed = window.confirm(
      `Clear all content from Cell "${document.name}"? You can undo this action.`,
    );
    if (!confirmed) {
      setStatus("Clear canvas cancelled");
      return;
    }
    const result = transact([{ kind: "clear_document" }]);
    if (!result.ok) return;
    resetInteractionState();
    setStatus(`Cleared Cell ${document.name} · Undo restores it`);
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
          : nextTool === "arrow"
            ? "Arrow: click the start point"
            : nextTool === "construction-line"
              ? "Construction line: click the start point"
              : "Pointer ready",
    );
  }

  /**
   * Examples join the drawing instead of replacing it: the example's content
   * is attached to the placement cursor like an ordinary copy, so existing
   * work is never overwritten. A hierarchical example cannot be flattened
   * onto one Document, so it still opens as its own Project behind the
   * ordinary dirty guard.
   */
  function openLibraryExample(example: LibraryProjectExample): void {
    const exampleProject = createLibraryExampleProject(example.id);
    if (!exampleProject) {
      setStatus(`Example is unavailable: ${example.name}`);
      return;
    }
    const exampleDocument = exampleProject.documents.find(
      (candidate) => candidate.id === exampleProject.topDocumentId,
    );
    if (!exampleDocument || exampleProject.documents.length > 1) {
      void guardDirtyReplacement(`Open ${example.name} example`, () => {
        replaceActiveProject(exampleProject);
        setStatus(`Opened example: ${example.name}`);
      });
      return;
    }
    const clipboard = copySelection(
      exampleDocument,
      exampleDocument.instances.map((instance) => instance.id),
    );
    const anchor = clipboard ? clipboardPlacementAnchor(clipboard) : null;
    if (!clipboard || !anchor) {
      setStatus(`Example has nothing to place: ${example.name}`);
      return;
    }
    cancelAllTransientInteraction();
    beginCopyPlacementInteraction(clipboard, anchor);
    setStatus(
      `Place ${example.name} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
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

  function loadRoutingDemo(): void {
    const demo = createRoutingDemoProject();
    replaceActiveProject(demo);
    setStatus("Loaded Phase 3 routing demo");
  }

  function routeAnchor(
    routeId: string,
    point: Point,
    segmentIndex: number,
  ): WireSource {
    const route = document.routes.find(
      (candidate) => candidate.id === routeId,
    )!;
    const suffix = nextRoutingSuffix();
    // Route taps are persisted geometry. Snap the projected screen hit back to
    // the document grid before splitRoute validates it, avoiding sub-pixel SVG
    // transform residue at an otherwise exact corner.
    return createRouteWireAnchor(
      document,
      route,
      point,
      segmentIndex,
      document.presentation.grid,
      suffix,
    );
  }

  function handleRoutePointerDown(
    event: ReactPointerEvent<SVGElement>,
    routeId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void {
    if (vddRailMode || (pendingSymbolId && pendingComponentPlacement)) return;
    if (
      getCurrentInteractionState().kind === "moving-selection" &&
      selectedIds.length > 0
    ) {
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId)
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
      return;
    }
    if (tool !== "pointer") {
      handleWireRoutePointerDown(event, routeId, hitTarget);
      return;
    }
    event.stopPropagation();
    if (event.altKey) {
      setStatus("Snap suppressed while Alt is held");
      return;
    }
    const routeRecord = routeGeometryRecords.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!routeRecord) return;
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const pointer = pointFromClient(event.clientX, event.clientY, svg, false);
    const tap = resolveRouteTap(
      routeRecord.geometry,
      pointer,
      logicalRadiusForPixels(svg, 7),
    );
    const segmentIndex = tap?.address.segmentIndex ?? 0;
    if (getCurrentInteractionState().kind === "moving-selection") {
      const movePlan = planSelectionMove(document, visualSelection);
      if (movePlan.previewObjectIds.length > 0) {
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          hitTarget,
        );
        return;
      }
      cancelInteraction();
    }
    selectRoute(routeId, segmentIndex);
    beginRouteStretch(
      event,
      routeId,
      segmentIndex,
      routeRecord.route.presentation === "power-rail"
        ? "move-power-rail"
        : looseRouteAnchorIds(document, routeRecord.route) !== null
          ? "move-loose-route"
          : "stretch-segment",
      hitTarget,
    );
  }

  function constrainAnnotationPosition(
    annotation: Annotation,
    candidate: DerivedPoint,
  ): Point {
    if (
      (annotation.kind === "instance-label" ||
        annotation.kind === "instance-value") &&
      annotation.anchor.kind === "object"
    ) {
      const anchor = annotation.anchor;
      const instance = document.instances.find(
        (item) => item.id === anchor.objectId,
      );
      if (instance?.placement) {
        const resolved = resolver.resolve(
          instance.symbolId,
          instance.symbolVariantId,
        );
        const radius = Math.ceil(
          Math.max(
            resolved?.definition.viewBox.width ?? 60,
            resolved?.definition.viewBox.height ?? 60,
          ) /
            2 +
            30,
        );
        return snapGridPoint(
          {
            x: clamp(
              candidate.x,
              instance.placement.position.x - radius,
              instance.placement.position.x + radius,
            ),
            y: clamp(
              candidate.y,
              instance.placement.position.y - radius,
              instance.placement.position.y + radius,
            ),
          },
          document.presentation.grid,
        );
      }
    }
    if (annotation.kind === "net-label" && annotation.netId) {
      const candidates = routeGeometryRecords
        .filter(({ route }) => route.netId === annotation.netId)
        .flatMap(({ geometry }) =>
          geometry.centerline
            .slice(0, -1)
            .map((from, index) =>
              closestPointOnSegment(
                candidate,
                from,
                geometry.centerline[index + 1]!,
              ),
            ),
        );
      const closest = candidates.sort((left, right) => {
        const leftDistance =
          (left.x - candidate.x) ** 2 + (left.y - candidate.y) ** 2;
        const rightDistance =
          (right.x - candidate.x) ** 2 + (right.y - candidate.y) ** 2;
        return leftDistance - rightDistance;
      })[0];
      if (closest) {
        return snapGridPoint(
          {
            x: clamp(
              candidate.x,
              closest.x - NET_LABEL_MAX_NORMAL_OFFSET,
              closest.x + NET_LABEL_MAX_NORMAL_OFFSET,
            ),
            y: clamp(
              candidate.y,
              closest.y - NET_LABEL_MAX_NORMAL_OFFSET,
              closest.y + NET_LABEL_MAX_NORMAL_OFFSET,
            ),
          },
          document.presentation.grid,
        );
      }
    }
    return snapGridPoint(candidate, document.presentation.grid);
  }

  function draggedAnnotationAtPosition(
    annotation: Annotation,
    candidate: DerivedPoint,
  ): Annotation {
    const currentAttachment = effectiveRouteAttachment(annotation);
    if (isRoutedMarker(annotation) && currentAttachment) {
      const attached = dragRouteAttachmentAtPoint(
        routeGeometryRecords,
        candidate,
        currentAttachment,
      );
      if (!attached) return annotation;
      const anchor =
        annotation.anchor.kind === "route"
          ? {
              ...annotation.anchor,
              segmentIndex: attached.routeAttachment.segmentIndex,
              t: attached.routeAttachment.t,
              normalOffset: attached.routeAttachment.normalOffset,
              direction: attached.routeAttachment.direction,
              fallbackPosition: attached.position,
            }
          : annotation.anchor;
      return {
        ...annotation,
        anchor,
      };
    }
    if (annotation.kind === "net-label" && annotation.anchor.kind === "route") {
      const attached = dragNetLabelAttachmentAtPoint(
        routeGeometryRecords,
        candidate,
        annotation.anchor.routeId,
      );
      if (!attached) return annotation;
      return {
        ...annotation,
        anchor: {
          ...annotation.anchor,
          segmentIndex: attached.segmentIndex,
          t: attached.t,
          normalOffset: attached.normalOffset,
          fallbackPosition: attached.labelPosition,
        },
      };
    }

    const position = constrainAnnotationPosition(annotation, candidate);
    if (annotation.anchor.kind === "object") {
      const anchor = annotation.anchor;
      const instance = document.instances.find(
        (item) => item.id === anchor.objectId,
      );
      if (instance?.placement) {
        return {
          ...annotation,
          anchor: {
            ...annotation.anchor,
            localOffset: {
              x: position.x - instance.placement.position.x,
              y: position.y - instance.placement.position.y,
            },
            fallbackPosition: position,
          },
        };
      }
    }
    return {
      ...annotation,
      anchor:
        annotation.anchor.kind === "free"
          ? { kind: "free", position }
          : { ...annotation.anchor, fallbackPosition: position },
    };
  }

  function beginAnnotationDrag(
    event: ReactPointerEvent<SVGElement>,
    annotation: Annotation,
    hitTarget: SVGElement = event.currentTarget,
  ): void {
    if (event.button !== 0) return;
    if (getCurrentInteractionState().kind === "moving-selection") {
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId)
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
      else
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          hitTarget,
        );
      return;
    }
    event.stopPropagation();
    selectOnly("annotation", [annotation.id]);
    setSelectedEndpoint(null);
    if (annotation.locked) {
      setStatus("Selected locked annotation");
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setStatus(`Selected annotation ${annotation.id}`);
      return;
    }
    canvasDragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const pointerStart = pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const currentAttachment = effectiveRouteAttachment(annotation);
    const record = currentAttachment
      ? routeGeometryRecords.find(
          ({ route }) => route.id === currentAttachment.routeId,
        )
      : undefined;
    const markerPlacement =
      record && currentAttachment
        ? resolveRouteAttachment(record.geometry, currentAttachment)
        : null;
    const preview: AnnotationDragPreview = {
      annotationId: annotation.id,
      originalPosition: {
        ...(isRoutedMarker(annotation) && markerPlacement
          ? markerPlacement.labelPoint
          : annotation.anchor.kind === "free"
            ? annotation.anchor.position
            : annotation.anchor.fallbackPosition),
      },
      pointerStart,
    };
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [annotation.id]));
    const positionAt = (clientX: number, clientY: number): DerivedPoint => {
      const pointer = pointFromClient(clientX, clientY, svg, false);
      return {
        x: preview.originalPosition.x + pointer.x - preview.pointerStart.x,
        y: preview.originalPosition.y + pointer.y - preview.pointerStart.y,
      };
    };
    canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => {
        const position = positionAt(client.x, client.y);
        // Route-attached current markers used to preview by replacing their
        // annotation in `renderedDocument`. That invalidated and rebuilt the
        // whole formal SVG scene once per pointer frame. A marker is one
        // indivisible visual object, so a lightweight temporary translation is
        // sufficient during the gesture; the exact route attachment is still
        // resolved and persisted once on pointer release below.
        dragVisual().translate({
          x: position.x - preview.originalPosition.x,
          y: position.y - preview.originalPosition.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        if (dragged) {
          completeAnnotationDrag(preview, positionAt(client.x, client.y));
        }
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual?.restore();
      },
    });
  }

  function completeAnnotationDrag(
    preview: AnnotationDragPreview,
    position: DerivedPoint,
  ): void {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === preview.annotationId,
    );
    if (!annotation) return;
    transact([
      {
        kind: "upsert_schematic_annotation",
        annotation: draggedAnnotationAtPosition(
          annotation,
          snapGridPoint(position, document.presentation.grid),
        ),
      },
    ]);
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
    const grid = document.presentation.grid;
    const matrix = svg.getScreenCTM();
    if (matrix) {
      const clientPoint = svg.createSVGPoint();
      clientPoint.x = clientX;
      clientPoint.y = clientY;
      const localPoint = clientPoint.matrixTransform(matrix.inverse());
      return {
        x: snapToGrid ? snapCoordinate(localPoint.x, grid) : localPoint.x,
        y: snapToGrid ? snapCoordinate(localPoint.y, grid) : localPoint.y,
      };
    }
    const bounds = svg.getBoundingClientRect();
    const x =
      viewBox.x + ((clientX - bounds.left) / bounds.width) * viewBox.width;
    const y =
      viewBox.y + ((clientY - bounds.top) / bounds.height) * viewBox.height;
    return {
      x: snapToGrid ? snapCoordinate(x, grid) : x,
      y: snapToGrid ? snapCoordinate(y, grid) : y,
    };
  }

  function logicalRadiusForPixels(svg: SVGSVGElement, pixels: number): number {
    const matrix = svg.getScreenCTM();
    if (!matrix) return pixels;
    const xScale = Math.hypot(matrix.a, matrix.b);
    const yScale = Math.hypot(matrix.c, matrix.d);
    const scale = (xScale + yScale) / 2;
    return logicalToleranceForScale(pixels, scale);
  }

  function paintSnapGuides(guides: readonly SnapGuideLine[]): void {
    const layer = snapGuideLayerRef.current;
    if (!layer) return;
    layer.replaceChildren(
      ...guides.map((guide) => {
        const line = globalThis.document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        line.setAttribute("class", "smart-snap-guide");
        line.setAttribute("data-testid", `snap-guide-${guide.axis}`);
        line.setAttribute(
          "x1",
          String(guide.axis === "x" ? guide.coordinate : guide.from - 24),
        );
        line.setAttribute(
          "y1",
          String(guide.axis === "y" ? guide.coordinate : guide.from - 24),
        );
        line.setAttribute(
          "x2",
          String(guide.axis === "x" ? guide.coordinate : guide.to + 24),
        );
        line.setAttribute(
          "y2",
          String(guide.axis === "y" ? guide.coordinate : guide.to + 24),
        );
        return line;
      }),
    );
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

  function resolveWireCanvasSnap(
    point: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
  ): {
    point: Point;
    endpoint?: WireSource;
    route?: { routeId: string; segmentIndex: number; point: Point };
    ambiguous?: boolean;
    guides: SnapGuideLine[];
  } {
    if (suppressSnap) return { point, guides: [] };
    const routeTargets = routeGeometryRecords.flatMap(({ route, geometry }) =>
      geometry.centerline.slice(0, -1).map((from, segmentIndex) => ({
        anchor: {
          id: `wire-route:${route.id}:${segmentIndex}`,
          point: snapPointOnRouteGrid(
            point,
            from,
            geometry.centerline[segmentIndex + 1]!,
            document.presentation.grid,
          ),
          kind: "route" as const,
        },
        routeId: route.id,
        segmentIndex,
      })),
    );
    const endpointTargets = wiringEndpoints.map((source) => ({
      source,
      anchor: endpointSnapAnchor(source),
    }));
    const activeSourceAnchorId = wireSource
      ? endpointSnapAnchor(wireSource).id
      : null;
    const resolved = resolvePointSnap(
      point,
      [
        ...endpointTargets.map((candidate) => candidate.anchor),
        ...routeTargets.map((candidate) => candidate.anchor),
      ],
      {
        grid: document.presentation.grid,
        tolerance: logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
        profile: SNAP_PROFILES.wire,
        ...(activeSourceAnchorId
          ? { excludedTargetIds: new Set([activeSourceAnchorId]) }
          : {}),
      },
    );
    const snappedPoint = {
      x: point.x + resolved.delta.x,
      y: point.y + resolved.delta.y,
    };
    const atPoint = (candidate: { anchor: { id: string; point: Point } }) =>
      candidate.anchor.id !== activeSourceAnchorId &&
      Math.abs(candidate.anchor.point.x - snappedPoint.x) < 1e-6 &&
      Math.abs(candidate.anchor.point.y - snappedPoint.y) < 1e-6;
    const contactTargets = resolveElectricalContactTargets(
      document,
      resolver,
      [
        ...endpointTargets.filter(atPoint).map((candidate) => ({
          kind: "endpoint" as const,
          id: candidate.anchor.id,
          point: candidate.anchor.point,
          netId: candidate.source.netId,
          endpoint: candidate.source.endpoint,
        })),
        ...routeTargets.filter(atPoint).map((candidate) => ({
          kind: "route" as const,
          id: candidate.anchor.id,
          point: candidate.anchor.point,
          netId: document.routes.find(
            (route) => route.id === candidate.routeId,
          )!.netId,
          routeId: candidate.routeId,
          segmentIndex: candidate.segmentIndex,
        })),
      ],
      contactComponents,
    );
    const ambiguous = contactTargets.length > 1;
    const contact = ambiguous ? undefined : contactTargets[0];
    const endpoint = contact?.endpoint
      ? endpointTargets.find(
          (candidate) => candidate.anchor.id === contact.endpoint!.id,
        )?.source
      : undefined;
    const route =
      !endpoint && contact?.route
        ? routeTargets.find(
            (candidate) => candidate.anchor.id === contact.route!.id,
          )
        : undefined;
    return {
      point: snappedPoint,
      ...(ambiguous ? { ambiguous: true } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(route
        ? {
            route: {
              routeId: route.routeId,
              segmentIndex: route.segmentIndex,
              point: snappedPoint,
            },
          }
        : {}),
      guides: resolved.guides,
    };
  }

  function applyWireCanvasPoint(
    rawPoint: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
    finish: boolean,
  ): void {
    const resolved = resolveWireCanvasSnap(rawPoint, svg, suppressSnap);
    paintSnapGuides([]);
    if (resolved.ambiguous) {
      setStatus(
        "Ambiguous connection: choose one endpoint or conductor away from the overlap",
      );
      return;
    }
    if (resolved.endpoint) {
      if (!wireSource) {
        setWireSource(resolved.endpoint, document.revision);
        setWirePreviewPoint(resolved.endpoint.point);
        setWireDraftSteps([]);
      } else if (
        endpointKey(wireSource.endpoint) !==
        endpointKey(resolved.endpoint.endpoint)
      ) {
        commitWire(resolved.endpoint);
      } else {
        setStatus("Choose a different endpoint");
      }
      return;
    }
    if (resolved.route) {
      const anchor = routeAnchor(
        resolved.route.routeId,
        resolved.route.point,
        resolved.route.segmentIndex,
      );
      if (!wireSource) {
        setWireSource(anchor, document.revision);
        setWirePreviewPoint(anchor.point);
        setWireDraftSteps([]);
      } else {
        commitWire(anchor);
      }
      return;
    }
    if (finish) finishWireAtPoint(resolved.point);
    else fixWirePoint(resolved.point);
  }

  function handleCanvasHitPointerDown(
    event: ReactPointerEvent<SVGSVGElement>,
  ): void {
    if (
      (pendingSymbolId && pendingComponentPlacement) ||
      vddRailMode ||
      copyPlacement !== null
    ) {
      return;
    }
    if (getCurrentInteractionState().kind === "moving-selection") {
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId) {
        beginMoveFromSelection(event, primaryInstanceId, event.currentTarget);
      } else {
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          event.currentTarget,
        );
      }
      return;
    }
    if (tool !== "pointer" || event.button !== 0) return;
    if (
      cellSymbolLayoutEnabled &&
      (event.target as Element).closest(
        '[data-testid="cell-symbol-layout-overlay"]',
      )
    ) {
      // The canvas capture layer ranks the underlying scene through
      // elementsFromPoint(). Layout grips intentionally outrank that scene so
      // a selected hierarchy instance cannot start an ordinary move first.
      return;
    }
    if ((event.target as Element).closest(".draft-handle, .route-handle")) {
      return;
    }
    const hit = resolveCanvasHitAtPoint(
      event.currentTarget.ownerDocument,
      { x: event.clientX, y: event.clientY },
      event.altKey ? 1 : 0,
    );
    if (!hit || hit.kind === "handle") return;
    const hitTarget = hit.element as SVGElement;
    event.preventDefault();
    event.stopPropagation();

    if (
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (hit.kind === "instance" ||
        hit.kind === "instance-label" ||
        hit.kind === "annotation" ||
        hit.kind === "route" ||
        hit.kind === "junction") &&
      compositeSelectionOwnsHit(hit.kind, hit.id)
    ) {
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId) {
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
        return;
      }
    }

    if (hit.kind === "instance") {
      beginMoveFromSelection(event, hit.id, hitTarget);
      return;
    }
    if (hit.kind === "annotation") {
      const annotation = document.annotations.find(
        (candidate) => candidate.id === hit.id,
      );
      if (annotation) beginAnnotationDrag(event, annotation, hitTarget);
      return;
    }
    if (hit.kind === "route") {
      handleRoutePointerDown(event, hit.id, hitTarget);
      return;
    }
    if (hit.kind === "drafting") {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === hit.id,
      );
      if (object) beginDraftingDrag(event, object, hitTarget);
      return;
    }
    const endpoint = visibleEndpoints.find(
      (candidate) =>
        candidate.endpoint.kind === "junction" &&
        candidate.endpoint.junctionId === hit.id,
    );
    if (endpoint) {
      selectEndpoint(endpoint);
      setStatus(`Selected ${endpointTestId(endpoint.endpoint)}`);
    }
  }

  function handleDrop(event: DragEvent<SVGSVGElement>): void {
    event.preventDefault();
    const instanceId = event.dataTransfer.getData("application/x-icm-instance");
    if (!instanceId) {
      return;
    }
    const placement = {
      position: pointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
      ),
      rotation: 0 as const,
      mirror: "none" as const,
    };
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const displayAnnotations = instance
      ? missingDefaultInstanceDisplayAnnotations(
          document,
          { ...instance, placement },
          resolver,
          styleProfile,
        )
      : [];
    transact([
      {
        kind: "place_instance",
        instanceId,
        placement,
      },
      ...displayAnnotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ]);
    selectOnly("instance", [instanceId]);
  }

  function placeAllFromTray(): void {
    const edits = planPlaceAllUnplacedInstances(document, viewBox);
    if (edits.length === 0) {
      setStatus("The Placement Tray is empty");
      return;
    }
    const displayEdits = edits.flatMap((edit) => {
      if (edit.kind !== "place_instance") return [];
      const instance = document.instances.find(
        (candidate) => candidate.id === edit.instanceId,
      );
      if (!instance) return [];
      return missingDefaultInstanceDisplayAnnotations(
        document,
        { ...instance, placement: edit.placement },
        resolver,
        styleProfile,
      ).map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      }));
    });
    if (transact([...edits, ...displayEdits]).ok) {
      resetSelection();
      setStatus(
        `Placed ${edits.length} retained ${edits.length === 1 ? "Instance" : "Instances"} in a deterministic canvas grid`,
      );
    }
  }

  function returnInstancesToTray(instanceIds: readonly string[]): void {
    if (instanceIds.length === 0) {
      setStatus("There are no returnable placed Instances");
      return;
    }
    try {
      const edits = planInstanceUnplacement(
        document,
        resolver,
        instanceIds,
        ++uniqueSuffixCounter.current,
      );
      if (edits.length === 0) {
        setStatus("Those Instances are already retained in the Placement Tray");
        return;
      }
      if (transact(edits).ok) {
        resetSelection();
        const returnedFormalPort = instanceIds.some((instanceId) =>
          document.netlist?.terminals.some((terminal) =>
            terminal.interfaceInstanceIds.includes(instanceId),
          ),
        );
        setStatus(
          `Returned ${instanceIds.length} ${instanceIds.length === 1 ? "Instance" : "Instances"} to the Placement Tray; ${returnedFormalPort ? "Cell interfaces and " : ""}electrical facts were retained`,
        );
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not return to tray",
      );
    }
  }

  function placementTrayIdentity(
    instance: SchematicDocument["instances"][number],
  ): string {
    const formalName = document.netlist?.terminals.find((terminal) =>
      terminal.interfaceInstanceIds.includes(instance.id),
    )?.name;
    const netPortName =
      instance.symbolId === "port" || instance.symbolId === "port-filled"
        ? document.nets.find((net) =>
            net.terminals.some(
              (terminal) => terminal.instanceId === instance.id,
            ),
          )?.name
        : undefined;
    const schematicName = flattenRichText(
      instance.schematicName ?? { runs: [] },
    );
    const reference =
      instance.schematicReference ?? instance.netlist?.reference ?? null;
    const secondary = formalName ?? netPortName ?? schematicName;
    const identity =
      reference && secondary && reference !== secondary
        ? `${reference} · ${secondary}`
        : (reference ?? secondary ?? "Unreferenced");
    return `${identity} · ${instance.symbolId}`;
  }

  function selectionVisualMoveEdits(
    movePlan: SelectionMovePlan,
    delta: Point,
  ): SchematicEdit[] {
    return [
      ...movePlan.freeAnnotationIds.flatMap((annotationId) => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === annotationId,
        );
        if (!annotation || annotation.anchor.kind !== "free") return [];
        return [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: {
              ...annotation,
              anchor: {
                kind: "free" as const,
                position: snapGridPoint(
                  {
                    x: annotation.anchor.position.x + delta.x,
                    y: annotation.anchor.position.y + delta.y,
                  },
                  document.presentation.grid,
                ),
              },
            },
          },
        ];
      }),
      ...movePlan.draftingIds.flatMap((draftingId) => {
        const object = document.drafting?.objects.find(
          (candidate) => candidate.id === draftingId,
        );
        return object
          ? [
              {
                kind: "upsert_drafting_object" as const,
                object: translateDraftingObject(
                  object,
                  delta,
                  document.presentation.grid,
                ),
              },
            ]
          : [];
      }),
    ];
  }

  function completeVisualSelectionMove(
    movePlan: SelectionMovePlan,
    delta: Point,
  ): void {
    if (delta.x === 0 && delta.y === 0) return;
    const looseRouteEdits = movePlan.looseRouteIds.flatMap(
      (routeId) => proposeLooseRouteTranslation(document, routeId, delta).edits,
    );
    const result = transactConnectivity(
      "move_connected_selection",
      [...looseRouteEdits, ...selectionVisualMoveEdits(movePlan, delta)],
      { delta, looseRouteIds: movePlan.looseRouteIds },
    );
    if (result?.ok && movePlan.fixedObjectIds.length > 0) {
      setStatus(
        `Moved selection; ${movePlan.fixedObjectIds.length} attached object(s) remained fixed`,
      );
    }
  }

  function commandMoveVisualOrigin(movePlan: SelectionMovePlan): Point {
    const freeAnnotation = movePlan.freeAnnotationIds
      .map((id) =>
        document.annotations.find((annotation) => annotation.id === id),
      )
      .find((annotation) => annotation?.anchor.kind === "free");
    return (
      movePlan.draftingIds
        .flatMap((id) => {
          const object = document.drafting?.objects.find(
            (candidate) => candidate.id === id,
          );
          const origin = object ? draftingDragOrigin(object) : null;
          return origin ? [origin] : [];
        })
        .find((point): point is Point => point !== null) ??
      (freeAnnotation?.anchor.kind === "free"
        ? freeAnnotation.anchor.position
        : undefined) ??
      movePlan.looseRouteIds
        .map(
          (id) =>
            routeGeometryRecords.find((record) => record.route.id === id)
              ?.geometry.centerline[0],
        )
        .find((point): point is Point => point !== undefined) ?? { x: 0, y: 0 }
    );
  }

  function instanceMoveAt(
    preview: DragPreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
  ) {
    const rawDelta = {
      x: position.x - preview.pointerStart.x,
      y: position.y - preview.pointerStart.y,
    };
    const movingIds = new Set(preview.instanceIds);
    const movingAnchors = buildInstanceAnchors(
      document,
      resolver,
      visibleEndpoints,
      movingIds,
    );
    const routeTargets: SnapAnchor[] = suppressSnap
      ? []
      : movingAnchors.flatMap((moving): SnapAnchor[] => {
          if (moving.electrical?.kind !== "endpoint") return [];
          const movedPoint = {
            x: moving.point.x + rawDelta.x,
            y: moving.point.y + rawDelta.y,
          };
          return routeGeometryRecords.flatMap(({ route, geometry }) => {
            const belongsToMovingInstance = [route.from, route.to].some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                movingIds.has(endpoint.instanceId),
            );
            if (belongsToMovingInstance) return [];
            return geometry.centerline
              .slice(0, -1)
              .flatMap((from, segmentIndex) => {
                const point = closestPointOnSegment(
                  movedPoint,
                  from,
                  geometry.centerline[segmentIndex + 1]!,
                );
                if (
                  Math.hypot(point.x - movedPoint.x, point.y - movedPoint.y) >
                  tolerance
                ) {
                  return [];
                }
                return [
                  {
                    id: `move-route:${moving.id}:${route.id}:${segmentIndex}`,
                    point,
                    kind: "route" as const,
                    acceptsMovingAnchorId: moving.id,
                    electrical: {
                      kind: "route" as const,
                      routeId: route.id,
                      segmentIndex,
                      netId: route.netId,
                    },
                  },
                ];
              });
          });
        });
    const staticTargets = buildSceneSnapTargets(
      document,
      resolver,
      visibleEndpoints,
      movingIds,
    );
    let snap: SnapResult = suppressSnap
      ? { delta: rawDelta, guides: [] }
      : resolveTranslationSnap(
          {
            rawDelta,
            movingAnchors,
            targetAnchors: [...staticTargets, ...routeTargets],
            primaryAnchorId: `instance:${preview.primaryInstanceId}:origin`,
            grid: document.presentation.grid,
            tolerance,
            profile: SNAP_PROFILES.instanceMove,
          },
          previous,
        );
    if (snap.electricalMatch?.target.electrical?.kind === "route") {
      const point = snap.electricalMatch.target.point;
      const coincidentRoutes = routeTargets.filter(
        (target) =>
          target.electrical?.kind === "route" &&
          target.point.x === point.x &&
          target.point.y === point.y,
      );
      const conductors = resolveElectricalContactTargets(
        document,
        resolver,
        coincidentRoutes.flatMap((target) =>
          target.electrical?.kind === "route"
            ? [
                {
                  kind: "route" as const,
                  id: target.id,
                  point: target.point,
                  netId: target.electrical.netId,
                  routeId: target.electrical.routeId,
                  segmentIndex: target.electrical.segmentIndex,
                },
              ]
            : [],
        ),
        contactComponents,
      );
      if (conductors.length > 1) {
        snap = resolveTranslationSnap(
          {
            rawDelta,
            movingAnchors,
            targetAnchors: staticTargets,
            primaryAnchorId: `instance:${preview.primaryInstanceId}:origin`,
            grid: document.presentation.grid,
            tolerance,
            profile: SNAP_PROFILES.instanceMove,
          },
          previous,
        );
      }
    }
    const moves = preview.instanceIds.map((instanceId) => {
      const original = preview.originalPositions[instanceId]!;
      return {
        instanceId,
        position: snapGridPoint(
          {
            x: original.x + snap.delta.x,
            y: original.y + snap.delta.y,
          },
          document.presentation.grid,
        ),
      };
    });
    return { snap, moves };
  }

  function completeInstanceMove(
    preview: DragPreview,
    position: DerivedPoint,
    tolerance: number,
    suppressSnap: boolean,
    previous?: SnapResult,
  ): void {
    const { snap: resolvedSnap, moves } = instanceMoveAt(
      preview,
      position,
      tolerance,
      suppressSnap,
      previous,
    );
    const electricalMatch = resolvedSnap.electricalMatch;
    const delta = {
      x:
        moves[0]!.position.x -
        preview.originalPositions[moves[0]!.instanceId]!.x,
      y:
        moves[0]!.position.y -
        preview.originalPositions[moves[0]!.instanceId]!.y,
    };
    if (delta.x !== 0 || delta.y !== 0) {
      try {
        const groupMove = proposeGroupMoveEdits(document, resolver, moves);
        const looseRouteEdits = preview.movePlan.looseRouteIds.flatMap(
          (routeId) =>
            proposeLooseRouteTranslation(document, routeId, delta).edits,
        );
        const visualEdits = selectionVisualMoveEdits(preview.movePlan, delta);
        const movingElectrical = electricalMatch?.moving.electrical;
        const targetElectrical = electricalMatch?.target.electrical;
        const projected = structuredClone(document);
        for (const move of moves) {
          const instance = projected.instances.find(
            (candidate) => candidate.id === move.instanceId,
          );
          if (instance?.placement) instance.placement.position = move.position;
        }
        const contactEdits: SchematicEdit[] =
          movingElectrical?.kind === "endpoint" &&
          targetElectrical?.kind === "route"
            ? proposeEndpointRouteAttachment(
                projected,
                movingElectrical.endpoint,
                movingElectrical.netId,
                targetElectrical.routeId,
                electricalMatch!.target.point,
                targetElectrical.segmentIndex,
                `move-${nextRoutingSuffix()}`,
              ).edits
            : movingElectrical?.kind === "endpoint" &&
                targetElectrical?.kind === "endpoint"
              ? [
                  {
                    kind: "connect_endpoints" as const,
                    from: movingElectrical.endpoint,
                    to: targetElectrical.endpoint,
                    ...(!movingElectrical.netId && !targetElectrical.netId
                      ? { newNetId: `net-ui-${nextRoutingSuffix()}` }
                      : {}),
                  },
                ]
              : [];
        const result = transactConnectivity(
          targetElectrical?.kind === "route"
            ? "attach_endpoint_to_wire"
            : targetElectrical?.kind === "endpoint"
              ? "connect_without_wire"
              : "move_connected_selection",
          [
            ...groupMove.edits,
            ...looseRouteEdits,
            ...visualEdits,
            ...contactEdits,
          ],
          { moves, electricalMatch },
        );
        if (result?.ok && electricalMatch) {
          setStatus("Snapped pin endpoints and connected them without a wire");
        }
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Local stretch failed",
        );
      }
    }
  }

  function rotateSelected(deltaDegrees: 90 | -90 = 90): void {
    const instanceEdits = selectedIds.flatMap((id): SchematicEdit[] => {
      const instance = document.instances.find(
        (candidate) => candidate.id === id,
      );
      if (!instance?.placement) return [];
      const next =
        (((instance.placement.rotation + deltaDegrees) % 360) + 360) % 360;
      return [
        {
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation: next as 0 | 90 | 180 | 270,
        },
      ];
    });
    // Drafting rotation: R now also rotates a selected drafting object. An arrow
    // pivots about its resolved center; a construction line pivots about the
    // center of its bounds. Purely geometric — never changes electrical Nets.
    const draftingEdits = visualSelection.draftingIds.flatMap(
      (id): SchematicEdit[] => {
        const object = document.drafting?.objects.find(
          (candidate) => candidate.id === id,
        );
        if (!object) return [];
        const next = rotateDraftingObject(
          object,
          resolveDraftingObjectGeometry(document, resolver, object),
          deltaDegrees,
          document.presentation.grid,
        );
        return next ? [{ kind: "upsert_drafting_object", object: next }] : [];
      },
    );
    const edits = [...instanceEdits, ...draftingEdits];
    if (edits.length > 0) transact(edits);
  }

  function mirrorSelected(direction: ScreenFlip = "left-right"): void {
    const edits = selectedIds.flatMap((id): SchematicEdit[] => {
      const instance = document.instances.find(
        (candidate) => candidate.id === id,
      );
      if (!instance?.placement) return [];
      const orientation = reflectOrientation(instance.placement, direction);
      return [
        {
          kind: "mirror_instance",
          instanceId: instance.id,
          mirror: orientation.mirror,
        },
        ...(orientation.rotation === instance.placement.rotation
          ? []
          : [
              {
                kind: "rotate_instance" as const,
                instanceId: instance.id,
                rotation: orientation.rotation,
              },
            ]),
      ];
    });
    if (edits.length > 0) transact(edits);
  }

  function download(
    bytes: BlobPart,
    mediaType: string,
    extension: string,
    baseName = project.name,
  ): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeExportBaseName(baseName)}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function saveProjectFile(): Promise<void> {
    // Saving or downloading never clears the browser recovery copies. Only a
    // confirmed File System Access close reports a confirmed write; the
    // fallback download is reported as requested, not saved.
    const outcome = await saveProjectArtifact(project);
    if (outcome.status === "write-confirmed") {
      noteRecoveryFormalFileHint({
        name: outcome.fileName,
        lastConfirmedWriteAt: outcome.at,
      });
      setFileState("write-confirmed");
      setStatus(`Saved ${outcome.fileName} (write confirmed)`);
      return;
    }
    if (outcome.status === "download-requested") {
      noteRecoveryFormalFileHint({
        name: outcome.fileName,
        lastDownloadRequestedAt: new Date().toISOString(),
      });
      setFileState("download-requested");
      setStatus(`Download requested: ${outcome.fileName}`);
      return;
    }
    if (outcome.status === "picker-cancelled") {
      setStatus("Save cancelled");
      return;
    }
    if (outcome.status === "permission-denied") {
      setStatus(
        `Save location unavailable and download failed: ${outcome.message}`,
      );
      return;
    }
    if (outcome.status === "write-failed") {
      setFileState("write-failed");
      setStatus(
        `Save failed at ${outcome.stage}: ${outcome.message} — recovery kept; download the Project instead`,
      );
      return;
    }
    setStatus(`Project could not be serialized: ${outcome.message}`);
  }

  function isDirtyWork(): boolean {
    return fileState === "dirty" || fileState === "write-failed";
  }

  /**
   * Protect outgoing dirty work before Open/Import/Replace: first confirm the
   * newest revision is stored in recovery; if recovery cannot confirm, let
   * the human choose between downloading, replacing anyway, and cancelling.
   */
  async function guardDirtyReplacement(
    intent: string,
    perform: () => void | Promise<void>,
  ): Promise<void> {
    if (!isDirtyWork()) {
      await perform();
      return;
    }
    stageRecovery(project);
    const recoveryAfterFlush = await flushRecovery();
    if (recoveryAfterFlush === "stored") {
      await perform();
      return;
    }
    setReplaceGuard({ intent, perform });
  }

  function cancelReplaceGuard(): void {
    setReplaceGuard(null);
  }

  function confirmReplaceGuard(): void {
    const guard = replaceGuard;
    if (!guard) return;
    setReplaceGuard(null);
    void guard.perform();
  }

  function downloadCurrentProjectFromGuard(): void {
    const outcome = requestProjectDownload(project);
    if (outcome.status === "download-requested") {
      setFileState("download-requested");
      setStatus(`Download requested: ${outcome.fileName}`);
    } else {
      setStatus(`Download failed: ${outcome.message}`);
    }
  }

  function openRecoveryDialog(): void {
    // Refresh summaries so the dialog reflects records written after the
    // startup discovery (including this session's own latest commits).
    void (async () => {
      await discoverRecovery();
      setRecoveryDialogOpen(true);
    })();
  }

  function restoreRecoverySession(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await readRecoveryProject(workingCopyId, generation);
      if (read.status !== "valid") {
        setStatus(
          read.status === "unsupported-schema"
            ? "Recovery uses a newer Project schema and cannot be restored; download it instead"
            : `Recovery is not readable: ${
                read.status === "missing" ? "no stored record" : read.message
              }`,
        );
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      // Restoring forks a fresh working copy instead of overwriting the
      // stored record another tab may still be writing.
      const recoveredDocument = replaceActiveProject(
        read.project,
        DEFAULT_VIEWBOX,
        { source: "recovered" },
      );
      setRecoveryDialogOpen(false);
      await discoverRecovery();
      setStatus(`Restored recovery revision ${recoveredDocument.revision}`);
    })();
  }

  function downloadRecoveryBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await readRecoveryProject(workingCopyId, generation);
      const summary = recoverySessions.find(
        (session) => session.workingCopyId === workingCopyId,
      );
      if (read.status === "valid" || read.status === "unsupported-schema") {
        const text =
          read.status === "valid" ? read.record.projectText : read.projectText;
        const name =
          summary?.projectName ??
          (read.status === "valid" ? read.record.projectName : "recovery");
        const fileName = `${projectFileBaseName(name)}-backup.icproj.json`;
        const outcome = downloadTextArtifact(text, fileName);
        setStatus(
          outcome.status === "download-requested"
            ? `Download requested: ${outcome.fileName}`
            : `Download failed: ${outcome.message}`,
        );
        return;
      }
      setStatus(
        `Backup not available: ${
          read.status === "missing" ? "no stored record" : read.message
        }`,
      );
    })();
  }

  function deleteRecoverySessionFromDialog(workingCopyId: string): void {
    void (async () => {
      const removed = await deleteRecoverySession(workingCopyId);
      await discoverRecovery();
      setStatus(
        removed ? "Deleted recovery copy" : "Could not delete recovery copy",
      );
    })();
  }

  useEffect(() => {
    if (!restoreAfterRefresh || !recoveryReady) return;
    if (refreshRestoreAttemptedRef.current) return;
    refreshRestoreAttemptedRef.current = true;
    void (async () => {
      // An explicit in-app Refresh may restore only the exact working copy
      // recorded for that refresh, validated before installation.
      const read = await readRecoveryProject(recoveryWorkingCopyId, "latest");
      if (read.status !== "valid") {
        setStatus("No restorable recovery was found for this refresh");
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      const restoredDocument = replaceActiveProject(
        read.project,
        DEFAULT_VIEWBOX,
        { source: "recovered", keepWorkingCopy: true },
      );
      setStatus(`Restored recovery revision ${restoredDocument.revision}`);
    })();
  }, [restoreAfterRefresh, recoveryReady, recoveryWorkingCopyId]);

  // Any committed revision inside one Project session makes the working copy
  // dirty relative to its formal file again. A replacement re-baselines via
  // its own projectSessionId and sets the state explicitly.
  useEffect(() => {
    const baseline = fileStateBaselineRef.current;
    if (baseline === null || baseline.session !== projectSessionId) {
      fileStateBaselineRef.current = {
        session: projectSessionId,
        revision: document.revision,
      };
      return;
    }
    if (baseline.revision !== document.revision) {
      fileStateBaselineRef.current = {
        session: projectSessionId,
        revision: document.revision,
      };
      setFileState("dirty");
    }
  }, [document.revision, projectSessionId]);

  function refreshApp(): void {
    void (async () => {
      stageRecovery(project);
      // Wait for the IndexedDB write to settle before reloading; recovery
      // correctness otherwise does not depend on last-moment page events.
      await flushRecovery();
      window.sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
      window.location.reload();
    })();
  }

  async function openProjectFile(file: File | null): Promise<void> {
    if (!file) return;
    await guardDirtyReplacement(`Open ${file.name}`, async () => {
      const staged = await stageProjectFile(file, (candidate) =>
        findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
      );
      if (staged.status === "rejected") {
        // A rejected user file keeps a code and path in the status line so
        // the reason survives later status updates.
        setStatus(
          `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
        );
        return;
      }
      // A successful open retains the outgoing Project's recovery records
      // and immediately seeds the incoming Project's own working copy.
      replaceActiveProject(staged.project, DEFAULT_VIEWBOX, {
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
      });
      if (staged.migrated) setFileState("dirty");
      setStatus(
        staged.migrated
          ? `Opened and upgraded ${staged.fileName} from schema ${staged.sourceSchemaVersion} to schema ${staged.project.schemaVersion} — save the Project to keep the upgrade`
          : `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
      );
    });
  }

  function loadVisualDemo(): void {
    const next = createVisualDemoProject();
    replaceActiveProject(next, { x: 20, y: -10, width: 430, height: 350 });
    setStatus("Loaded Phase 5 visual demo");
  }

  // Single entry point for selecting a drafting object. Editing is opened
  // separately (double-click/Enter) so selection and text caret ownership do
  // not fight drag gestures.
  function selectDraftingObject(id: string): void {
    selectOnly("drafting", [id]);
    setDraftingInspectorSegment(null);
    setDraftingTangentInput(null);
    setDraftingBearingInput(null);
  }

  // A drafting drag commits exactly one typed transaction on pointerup. Its
  // geometry is kind-aware: arrows move their free endpoints and construction
  // lines move their points, rather than mutating the unused base anchor.
  function beginDraftingDrag(
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    hitTarget: SVGElement = event.currentTarget,
  ): void {
    if (event.button !== 0 || object.locked) return;
    if (getCurrentInteractionState().kind === "moving-selection") {
      const primaryInstanceId = selectedIds.at(-1);
      if (primaryInstanceId)
        beginMoveFromSelection(event, primaryInstanceId, hitTarget);
      else
        beginVisualSelectionMoveFromSelection(
          event,
          visualSelection,
          hitTarget,
        );
      return;
    }
    const origin = draftingDragOrigin(object);
    if (!origin) {
      selectDraftingObject(object.id);
      setStatus("This anchored drawing moves with its attachment");
      return;
    }
    event.stopPropagation();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      selectDraftingObject(object.id);
      setStatus(`Selected drawing ${object.id}`);
      return;
    }
    canvasDragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const start = pointFromClient(event.clientX, event.clientY, svg, false);
    const original = { ...origin };
    selectDraftingObject(object.id);
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [object.id]));
    const tolerance = logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX);
    const movingAnchors = [
      {
        id: `drafting:${object.id}:origin`,
        point: original,
        kind: "drafting" as const,
      },
      ...buildDraftingAnchors(document, resolver, new Set([object.id])),
    ];
    const targetAnchors = buildSceneSnapTargets(
      document,
      resolver,
      visibleEndpoints,
      new Set(),
      new Set([object.id]),
    );
    let lastSnap: SnapResult | undefined;
    const positionAt = (
      clientX: number,
      clientY: number,
      suppressSnap: boolean,
      previous?: SnapResult,
    ): { position: Point; snap: SnapResult } => {
      const point = pointFromClient(clientX, clientY, svg, false);
      const rawDelta = { x: point.x - start.x, y: point.y - start.y };
      const resolved: SnapResult = suppressSnap
        ? { delta: rawDelta, guides: [] }
        : resolveTranslationSnap(
            {
              rawDelta,
              movingAnchors,
              targetAnchors,
              primaryAnchorId: `drafting:${object.id}:origin`,
              grid: document.presentation.grid,
              tolerance,
              profile: SNAP_PROFILES.draftingMove,
            },
            previous,
          );
      return {
        position: {
          x: original.x + resolved.delta.x,
          y: original.y + resolved.delta.y,
        },
        snap: resolved,
      };
    };
    canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => {
        const resolved = positionAt(
          client.x,
          client.y,
          Boolean(client.altKey),
          lastSnap,
        );
        lastSnap = resolved.snap;
        paintSnapGuides(resolved.snap.guides);
        dragVisual().translate({
          x: resolved.position.x - original.x,
          y: resolved.position.y - original.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
        if (dragged) {
          const position = positionAt(
            client.x,
            client.y,
            Boolean(client.altKey),
            lastSnap,
          ).position;
          const latest = document.drafting?.objects.find(
            (item) => item.id === object.id,
          );
          if (
            latest &&
            (position.x !== original.x || position.y !== original.y)
          ) {
            transact([
              {
                kind: "upsert_drafting_object",
                object: translateDraftingObject(
                  latest,
                  {
                    x: position.x - original.x,
                    y: position.y - original.y,
                  },
                  document.presentation.grid,
                ),
              },
            ]);
          }
        }
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
      },
    });
  }

  // Drag a single endpoint (arrow from/to) or vertex (construction-line index).
  // Mirrors beginDraftingDrag's session discipline (cancel on Escape, commit
  // once on pointerup from the ref) but mutates only the named handle, leaving
  // the rest of the object's geometry in place. The arrow head always rides the
  // tip because the renderer derives it from `to`.
  function beginDraftingHandleDrag(
    event: ReactPointerEvent<SVGElement>,
    object: DraftingObject,
    handle: DraftingHandle,
  ): void {
    if (event.button !== 0 || object.locked) return;
    event.stopPropagation();
    canvasDragSessionRef.current?.cancel();
    const hitTarget = event.currentTarget;
    const svg = hitTarget.ownerSVGElement!;
    const originalGeometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
    );
    if (handle.kind === "curve") {
      setDraftingInspectorSegment({ objectId: object.id, index: handle.index });
      setDraftingTangentInput(null);
    }
    selectDraftingObject(object.id);

    canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => {
        const snapped = snapDraftingPoint(
          pointFromClient(client.x, client.y, svg),
          Boolean(client.altKey),
          event.shiftKey,
          undefined,
          logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
        );
        paintSnapGuides(snapped.guides);
        setDraftingHandlePreview({
          objectId: object.id,
          object: applyDraftingHandle(
            object,
            handle,
            snapped.point,
            originalGeometry,
            document.presentation.grid,
          ),
        });
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        paintSnapGuides([]);
        if (dragged) {
          const point = snapDraftingPoint(
            pointFromClient(client.x, client.y, svg),
            Boolean(client.altKey),
            event.shiftKey,
            undefined,
            logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
          ).point;
          const latest = document.drafting?.objects.find(
            (item) => item.id === object.id,
          );
          if (latest) {
            const next = applyDraftingHandle(
              latest,
              handle,
              point,
              originalGeometry,
              document.presentation.grid,
            );
            if (next !== latest) {
              transact([{ kind: "upsert_drafting_object", object: next }]);
            }
          }
        }
        setDraftingHandlePreview(null);
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        setDraftingHandlePreview(null);
        paintSnapGuides([]);
      },
    });
  }

  // Insert a vertex on a construction line at the clicked point, on the nearest
  // segment. Commits one transaction. Used by the construction-line hit shape's
  // double-click handler.
  function insertConstructionVertex(
    object: Extract<DraftingObject, { kind: "construction-line" }>,
    point: Point,
  ): void {
    const next = insertConstructionVertexObject(object, point);
    if (!next) return;
    // An explicit vertex is a straightening operation for the selected
    // segment. It avoids silently reinterpreting a Bézier control after the
    // segment count changes.
    transact([
      {
        kind: "upsert_drafting_object",
        object: next.object,
      },
    ]);
    setStatus(`Inserted vertex ${next.index}`);
  }

  // Free arrows share the same midpoint editing model as construction lines.
  // The inserted point is deliberately a waypoint, never an endpoint anchor:
  // an attached arrow endpoint therefore remains attached after reshaping.
  function insertArrowWaypoint(
    object: Extract<DraftingObject, { kind: "arrow" }>,
    point: Point,
  ): void {
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "arrow") return;
    const next = insertArrowWaypointObject(object, geometry, point);
    if (!next) return;
    transact([
      {
        kind: "upsert_drafting_object",
        object: next.object,
      },
    ]);
    setStatus(`Inserted arrow bend ${next.index + 1}`);
  }

  // Delete a vertex from a construction line by index; refuse below 2 vertices.
  function deleteConstructionVertex(
    object: Extract<DraftingObject, { kind: "construction-line" }>,
    index: number,
  ): void {
    const next = deleteConstructionVertexObject(object, index);
    if (next.kind === "minimum") {
      setStatus("A construction line needs at least two vertices");
      return;
    }
    if (next.kind !== "updated") return;
    transact([{ kind: "upsert_drafting_object", object: next.object }]);
    setStatus(`Deleted vertex ${index}`);
  }

  // Apply a bounded style change to the selected drafting object(s). `patch` is
  // merged into styleOverride (undefined keys clear that property). One
  // upsert_drafting_object transaction per object. Applies to free arrows and
  // construction lines; route current markers keep their own binding.
  function setDraftingStyle(patch: DraftingStylePatch): void {
    const ids = visualSelection.draftingIds;
    if (ids.length === 0) return;
    const edits: SchematicEdit[] = [];
    for (const id of ids) {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      if (!object) continue;
      const nextObject = applyDraftingStylePatch(object, patch);
      if (!nextObject) continue;
      edits.push({
        kind: "upsert_drafting_object",
        object: nextObject,
      });
    }
    if (edits.length > 0) {
      const result = transact(edits);
      if (result.ok) setStatus("Updated drawing style");
    } else if (ids.length > 0) {
      setStatus("Drawing is locked; unlock it before editing its style");
    }
  }

  function setDraftingTangentAngle(angleDegrees: number): void {
    if (
      !selectedDrafting ||
      selectedDrafting.locked ||
      (selectedDrafting.kind !== "arrow" &&
        selectedDrafting.kind !== "construction-line") ||
      !Number.isFinite(angleDegrees)
    ) {
      return;
    }
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      selectedDrafting,
    );
    if (geometry.kind !== selectedDrafting.kind) return;
    const index =
      draftingInspectorSegment?.objectId === selectedDrafting.id
        ? draftingInspectorSegment.index
        : Math.max(0, geometry.curveControls.findIndex(Boolean));
    if (index >= geometry.points.length - 1) return;
    const next = setDraftingObjectTangentAngle(
      selectedDrafting,
      geometry,
      index,
      angleDegrees,
      document.presentation.grid,
    );
    if (!next) return;
    transact([
      {
        kind: "upsert_drafting_object",
        object: next,
      },
    ]);
  }

  function setDraftingBearing(bearingDegrees: number): void {
    if (
      !selectedDrafting ||
      selectedDrafting.locked ||
      (selectedDrafting.kind !== "arrow" &&
        selectedDrafting.kind !== "construction-line" &&
        selectedDrafting.kind !== "rectangle") ||
      !Number.isFinite(bearingDegrees)
    ) {
      return;
    }
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      selectedDrafting,
    );
    const next = setDraftingObjectBearing(
      selectedDrafting,
      geometry,
      bearingDegrees,
      document.presentation.grid,
    );
    if (next.kind === "attached-arrow") {
      setStatus(
        "An attached arrow cannot rotate without detaching its endpoints",
      );
      return;
    }
    if (next.kind !== "updated") return;
    transact([{ kind: "upsert_drafting_object", object: next.object }]);
  }

  function toggleDraftingLock(object: DraftingObject): void {
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: { ...object, locked: !object.locked },
      },
    ]);
    if (result?.ok) {
      setStatus(
        object.locked
          ? "Drawing unlocked; it can now be edited or deleted"
          : "Drawing locked; unlock it before editing or deleting",
      );
    }
  }

  function addPlainText(): void {
    uniqueSuffixCounter.current += 1;
    const id = `note-${uniqueSuffixCounter.current}`;
    const position = snapGridPoint(
      {
        x: Math.round(viewBox.x + viewBox.width / 2),
        y: Math.round(viewBox.y + viewBox.height - 20),
      },
      document.presentation.grid,
    );
    const textObject: Extract<DraftingObject, { kind: "text" }> = {
      id,
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position },
      content: defaultDraftTextDocument("Design note"),
      alignment: "middle",
      rotation: 0,
      typographyToken: "label",
    };
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: textObject,
      },
    ]);
    if (result.ok) {
      beginDraftingTextEditing(textObject);
      setStatus(`Added drafting text ${id}`);
    }
  }

  function addConstructionLine(): void {
    uniqueSuffixCounter.current += 1;
    const id = `construction-${uniqueSuffixCounter.current}`;
    const center = snapGridPoint(
      {
        x: Math.round(viewBox.x + viewBox.width / 2),
        y: Math.round(viewBox.y + viewBox.height / 2),
      },
      document.presentation.grid,
    );
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: {
          id,
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: center },
          points: [
            { x: center.x - 80, y: center.y },
            { x: center.x + 80, y: center.y },
          ],
          lineStyle: "dashed",
        },
      },
    ]);
    if (result.ok) setStatus(`Added construction line ${id}`);
  }

  function addFreeArrow(): void {
    uniqueSuffixCounter.current += 1;
    const id = `arrow-${uniqueSuffixCounter.current}`;
    const center = snapGridPoint(
      {
        x: Math.round(viewBox.x + viewBox.width / 2),
        y: Math.round(viewBox.y + viewBox.height / 2),
      },
      document.presentation.grid,
    );
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: {
          id,
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: center },
          from: { kind: "free", position: { x: center.x - 60, y: center.y } },
          to: { kind: "free", position: { x: center.x + 60, y: center.y } },
        },
      },
    ]);
    if (result.ok) setStatus(`Added free arrow ${id}`);
  }

  function addCurrentArrow(): void {
    if (!selectedRoute) {
      setStatus("Select a wire segment before adding a current arrow");
      return;
    }
    const segmentIndex = Math.min(
      selectedRouteSegmentIndex ?? 0,
      selectedRoute.segmentModes.length - 1,
    );
    const record = routeGeometryRecords.find(
      ({ route }) => route.id === selectedRoute.id,
    );
    const from = record?.geometry.centerline[segmentIndex];
    const to = record?.geometry.centerline[segmentIndex + 1];
    if (!from || !to) {
      setStatus("Selected wire segment cannot accept a current arrow");
      return;
    }
    uniqueSuffixCounter.current += 1;
    const id = `current-${uniqueSuffixCounter.current}`;
    const fallbackPosition = snapGridPoint(
      { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      document.presentation.grid,
    );
    const result = transact([
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          id,
          kind: "route-marker",
          markerKind: "current",
          content: semanticTextDocument("I_x", "route-marker"),
          anchor: {
            kind: "route",
            routeId: selectedRoute.id,
            segmentIndex,
            t: 0.5,
            normalOffset: -14,
            direction: "forward",
            orientation: "follow",
            fallbackPosition,
          },
          alignment: "middle",
          rotation: 0,
          locked: false,
        },
      },
    ]);
    if (result.ok) {
      selectOnly("annotation", [id]);
      setStatus(`Added current arrow on ${selectedRoute.id}`);
    }
  }

  function netLabelForRoute(
    route: SchematicDocument["routes"][number],
  ): Annotation | undefined {
    const candidates = document.annotations.filter(
      (annotation) =>
        annotation.kind === "net-label" && annotation.netId === route.netId,
    );
    return (
      candidates.find(
        (annotation) => annotation.id === `net-label-${route.id}`,
      ) ??
      candidates.find(
        (annotation) =>
          resolveNetLabelBinding(document, resolver, annotation)?.routeId ===
          route.id,
      )
    );
  }

  function netLabelEditsForRoute(
    route: SchematicDocument["routes"][number],
    rawName: string,
    presentation?: {
      alignment: "start" | "middle" | "end";
      sizeScale: number;
      formatOverride?: RichTextDocument;
    },
  ): SchematicEdit[] | null {
    const net = document.nets.find((candidate) => candidate.id === route.netId);
    if (!net) return null;
    const existingLabel = netLabelForRoute(route);
    const name = rawName.trim();
    if (!name) {
      return existingLabel
        ? [
            {
              kind: "remove_schematic_annotation",
              annotationId: existingLabel.id,
            },
          ]
        : null;
    }
    const namedNetPlan = planEnsureNamedNet(document, {
      candidateNetId: net.id,
      name,
    });
    if (!namedNetPlan.ok) return null;
    const targetNetId = namedNetPlan.netId;
    const geometry = routeGeometryRecords.find(
      ({ route: candidate }) => candidate.id === route.id,
    )?.geometry;
    if (!geometry) return null;
    const segment = Math.max(
      0,
      Math.floor((geometry.centerline.length - 1) / 2),
    );
    const from = geometry.centerline[segment]!;
    const to = geometry.centerline[segment + 1] ?? from;
    const position = snapGridPoint(
      (existingLabel
        ? existingLabel.anchor.kind === "free"
          ? existingLabel.anchor.position
          : existingLabel.anchor.fallbackPosition
        : undefined) ?? {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2 - 8,
      },
      document.presentation.grid,
    );
    const previousAnchor =
      existingLabel?.anchor.kind === "route" &&
      existingLabel.anchor.routeId === route.id
        ? existingLabel.anchor
        : null;
    const edits: SchematicEdit[] = [...namedNetPlan.edits];
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        id: existingLabel?.id ?? `net-label-${route.id}`,
        kind: "net-label",
        binding: { kind: "net-name", netId: targetNetId },
        netId: targetNetId,
        // A dragged route anchor survives a name edit; new labels start at
        // the middle segment with the default normal offset.
        anchor: previousAnchor
          ? { ...previousAnchor, fallbackPosition: position }
          : {
              kind: "route",
              routeId: route.id,
              segmentIndex: segment,
              t: 0.5,
              normalOffset: -8,
              direction: "forward",
              orientation: "follow",
              fallbackPosition: position,
            },
        alignment:
          presentation?.alignment ?? existingLabel?.alignment ?? "middle",
        rotation: 0,
        locked: false,
        ...(presentation?.sizeScale !== undefined
          ? { sizeScale: presentation.sizeScale }
          : existingLabel?.sizeScale !== undefined
            ? { sizeScale: existingLabel.sizeScale }
            : {}),
        ...(presentation?.formatOverride
          ? { formatOverride: presentation.formatOverride }
          : {}),
      },
    });
    return edits;
  }

  function referenceLabelVisibilityEdits(
    instanceIds: readonly string[],
    visible: boolean,
  ): SchematicEdit[] {
    const edits: SchematicEdit[] = [];
    for (const instanceId of instanceIds) {
      const instance = document.instances.find(
        (item) => item.id === instanceId,
      );
      if (!instance) continue;
      const label = instanceLabelAnnotationFor(document, instanceId);
      if (label) {
        const { visible: _currentVisibility, ...rest } = label;
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: visible ? rest : { ...rest, visible: false },
        });
      } else if (visible) {
        const created = defaultInstanceLabel(
          document,
          instance,
          resolver,
          styleProfile,
        );
        if (created) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: created,
          });
        }
      }
    }
    return edits;
  }

  function valueVisibilityEdits(
    source: SchematicDocument,
    instanceIds: readonly string[],
    visible: boolean,
  ): SchematicEdit[] {
    const edits: SchematicEdit[] = [];
    for (const instanceId of instanceIds) {
      const instance = source.instances.find((item) => item.id === instanceId);
      if (!instance) continue;
      const value = instanceValueAnnotation(source, instanceId);
      if (value) {
        const { visible: _currentVisibility, ...rest } = value;
        if (visible) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: rest,
          });
        } else {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: { ...rest, visible: false },
          });
        }
      } else if (visible) {
        const created = defaultInstanceValue(
          source,
          instance,
          resolver,
          styleProfile,
        );
        if (created) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: created,
          });
        }
      }
    }
    return edits;
  }

  function instancePropertyEdits(draft: {
    instanceId: string | null;
    parameters: Record<string, string>;
    x: string;
    y: string;
    rotation: "0" | "90" | "180" | "270";
  }): { edits: SchematicEdit[]; invalidPosition: boolean } {
    if (!draft.instanceId) return { edits: [], invalidPosition: false };
    const instance = document.instances.find(
      (item) => item.id === draft.instanceId,
    );
    if (!instance) return { edits: [], invalidPosition: false };
    const edits: SchematicEdit[] = [];
    const baseNetlist =
      instance.netlist ??
      initialInstanceNetlist(document, instance.symbolId, {});
    if (baseNetlist) {
      const netlistParameters = { ...baseNetlist.parameters };
      const set: Record<string, string> = {};
      const unset: string[] = [];
      for (const parameter of propertyParametersForInstance(instance)) {
        const value = (draft.parameters[parameter.key] ?? "").trim();
        const current = netlistParameters[parameter.key];
        if (value === "") {
          delete netlistParameters[parameter.key];
          if (current !== undefined) unset.push(parameter.key);
        } else {
          netlistParameters[parameter.key] = value;
          if (current !== value) set[parameter.key] = value;
        }
      }

      const nextNetlist = {
        ...baseNetlist,
        parameters: netlistParameters,
      };
      if (!instance.netlist) {
        edits.push({
          kind: "set_instance_netlist",
          instanceId: instance.id,
          netlist: nextNetlist,
        });
      } else if (Object.keys(set).length > 0 || unset.length > 0) {
        edits.push({
          kind: "patch_instance_netlist_parameters",
          instanceId: instance.id,
          ...(Object.keys(set).length > 0 ? { set } : {}),
          ...(unset.length > 0 ? { unset } : {}),
        });
      }
    }

    let invalidPosition = false;
    if (instance.placement) {
      const x = Number(draft.x);
      const y = Number(draft.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        invalidPosition = true;
      } else {
        const position = {
          x: snapCoordinate(x, document.presentation.grid),
          y: snapCoordinate(y, document.presentation.grid),
        };
        if (
          position.x !== instance.placement.position.x ||
          position.y !== instance.placement.position.y
        ) {
          edits.push({
            kind: "move_instance",
            instanceId: instance.id,
            position,
          });
        }
      }
      const rotation = Number(draft.rotation) as 0 | 90 | 180 | 270;
      if (rotation !== instance.placement.rotation) {
        edits.push({
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation,
        });
      }
    }
    return { edits, invalidPosition };
  }

  function updateSelectedModelTarget(value: string): void {
    if (!selectedInstance?.netlist) return;
    if (
      selectedPropertyDevice?.symbolId === "nmos" ||
      selectedPropertyDevice?.symbolId === "pmos"
    ) {
      try {
        const edits = planSetMosModelTarget(
          project,
          document.id,
          selectedInstance.id,
          value,
        );
        if (edits.length === 0) return;
        if (commitStructure("set-mos-model-target", edits)) {
          const target = value.trim();
          const mapping = target
            ? resolvePdkSymbolMapping(target, 4)
            : undefined;
          setStatus(
            mapping
              ? `Set external X target ${target}`
              : target
                ? `Set model target ${target}`
                : `Cleared model target for ${selectedInstance.id}`,
          );
        }
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Could not set MOS model target",
        );
      }
      return;
    }
    const binding = bindingForEditedModel(selectedInstance.symbolId, value);
    const nextBinding = binding ?? null;
    const currentBinding = selectedInstance.netlist.binding ?? null;
    if (JSON.stringify(nextBinding) === JSON.stringify(currentBinding)) return;
    if (
      transact([
        {
          kind: "set_instance_binding",
          instanceId: selectedInstance.id,
          binding: nextBinding,
        },
      ]).ok
    ) {
      setStatus(
        nextBinding?.kind === "model"
          ? `Set model target ${nextBinding.name}`
          : `Cleared model target for ${selectedInstance.id}`,
      );
    }
  }

  function propertyParametersForInstance(
    instance: SchematicDocument["instances"][number],
  ) {
    const binding = instance.netlist?.binding;
    if (binding?.kind === "external-subcircuit") {
      const definition = project.externalSubcircuitDefinitions.find(
        (candidate) => candidate.id === binding.definitionId,
      );
      const mapping = definition
        ? resolvePdkSymbolMapping(definition.name, definition.terminals.length)
        : undefined;
      if (
        definition &&
        (mapping?.symbolId === "nmos" || mapping?.symbolId === "pmos") &&
        definition.terminals.every(
          (terminal, index) =>
            terminal.name.toLowerCase() ===
            mapping.pinNames[index]?.toLowerCase(),
        )
      ) {
        return externalMosComponentParameters(mapping.symbolId);
      }
    }
    return componentParameters(instance.symbolId);
  }

  function updateSelectedSchematicName(value: string): void {
    if (!selectedInstance) return;
    const content = defaultDraftTextDocument(value.trim());
    if (
      JSON.stringify(selectedInstance.schematicName ?? null) ===
      JSON.stringify(content)
    ) {
      return;
    }
    if (
      transact([
        {
          kind: "set_instance_schematic_name",
          instanceId: selectedInstance.id,
          content,
        },
      ]).ok
    ) {
      setStatus(`Renamed schematic label to ${value.trim()}`);
    }
  }

  function updateSelectedReference(value: string): void {
    if (!selectedInstance?.netlist) return;
    const reference = value.trim();
    if (!reference) {
      setStatus("Netlist reference cannot be empty");
      return;
    }
    if (reference === selectedInstance.netlist.reference) return;
    if (
      transact([
        {
          kind: "set_instance_reference",
          instanceId: selectedInstance.id,
          reference,
        },
      ]).ok
    ) {
      setStatus(`Set netlist reference to ${reference}`);
    }
  }

  /*
   * Text sessions use one persistence proposal for both annotation and
   * drafting owners. The tagged target keeps their typed edit differences at
   * the boundary rather than branching through the floating editor lifecycle.
   */
  function deleteSelectedAnnotation(): void {
    if (!selectedAnnotation) return;
    const result = transact([
      {
        kind: "remove_schematic_annotation",
        annotationId: selectedAnnotation.id,
      },
    ]);
    if (result.ok) replaceSelectionKind("annotation", []);
  }

  function reverseSelectedCurrentArrow(): void {
    if (!selectedAnnotation || !isRoutedMarker(selectedAnnotation)) {
      return;
    }
    const attachment = effectiveRouteAttachment(selectedAnnotation);
    if (!attachment) return;
    const direction: "forward" | "reverse" =
      attachment.direction === "forward" ? "reverse" : "forward";
    // A route-marker stores direction on its route VisualAnchor.
    const anchor =
      selectedAnnotation.kind === "route-marker" &&
      selectedAnnotation.anchor.kind === "route"
        ? { ...selectedAnnotation.anchor, direction }
        : selectedAnnotation.anchor;
    const result = transact([
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...selectedAnnotation,
          anchor,
        },
      },
    ]);
    if (result.ok) setStatus(`Current arrow points ${direction}`);
  }

  function alignSelectedInstances(): void {
    if (selectedIds.length < 2) {
      setStatus("Select at least two instances to align");
      return;
    }
    const result = transact([
      { kind: "align_instances", instanceIds: selectedIds, axis: "y" },
    ]);
    if (result.ok)
      setStatus(`Aligned ${selectedIds.length} selected instances`);
  }

  function exportSvg(): void {
    const source = createFormalExportSource(document, resolver, {
      title: project.name,
    });
    download(source.svg, "image/svg+xml", "svg");
    setStatus(`Exported revision ${document.revision}`);
  }

  function exportDesignNetlist(
    format: NetlistFormat,
    warningsReviewed = false,
  ): void {
    if (!netlistAnalysis.ir) {
      setNetlistPreflightOpen(true);
      setStatus("Resolve Netlist Preflight findings before export");
      return;
    }
    if (netlistAnalysis.diagnostics.length > 0 && !warningsReviewed) {
      setNetlistPreflightOpen(true);
      setStatus("Review Netlist Preflight warnings before export");
      return;
    }
    const artifact = printDesignNetlist(format, netlistAnalysis.ir);
    download(artifact.text, artifact.mediaType, artifact.extension.slice(1));
    setStatus(
      `Download requested: ${safeExportBaseName(project.name)}${artifact.extension}`,
    );
  }

  async function exportRaster(format: "png" | "pdf"): Promise<void> {
    setStatus(`Preparing ${format.toUpperCase()} export`);
    try {
      const source = createFormalExportSource(document, resolver, {
        title: project.name,
      });
      if (format === "png") {
        const png = await rasterizeFormalSvgInBrowser(source);
        download(png.bytes as BlobPart, png.mediaType, "png");
      } else {
        const { pdf } = await exportFormalArtifactsInBrowser(source);
        download(pdf as BlobPart, "application/pdf", "pdf");
      }
      setStatus(
        `Exported ${format.toUpperCase()} revision ${document.revision}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function importSpiceFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }
    const selectedFiles = [...files];
    const sourceInputs = await Promise.all(
      selectedFiles.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const conventionalEntries = sourceInputs.filter((input) =>
      /\.(?:cir|sp|spi)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter(
      (input) => input.path.split("/").at(-1)?.toLowerCase() === "circuit.spi",
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      setStatus(
        `Select one unambiguous .cir, .sp, or .spi entry and its local include files; found ${entryCandidates.length}`,
      );
      return;
    }
    setStatus("Importing SPICE sources");
    try {
      const result = await importSpiceSources(
        sourceInputs,
        entryCandidates[0]!.path,
      );
      const nextImportReport: SpiceImportReport = {
        entryPath: entryCandidates[0]!.path,
        diagnostics: result.diagnostics,
      };
      if (!result.project || !result.successful) {
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        const firstError = result.diagnostics.find(
          (item) => item.severity === "error",
        );
        setStatus(firstError?.message ?? "SPICE import failed");
        return;
      }
      const instanceCount = result.project.documents.reduce(
        (count, candidate) => count + candidate.instances.length,
        0,
      );
      await guardDirtyReplacement("Import SPICE sources", () => {
        replaceActiveProject(result.project!, DEFAULT_VIEWBOX, {
          source: "spice-import",
        });
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        setStatus(
          `Imported ${result.project!.documents.length} Documents and ${instanceCount} structural instances`,
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  }

  function fitView(): void {
    setViewBox(
      fitCameraToBounds(
        contentScene?.viewBox ?? DEFAULT_VIEWBOX,
        document.presentation.grid,
      ),
    );
    setStatus("Fit Document");
  }

  function zoomViewAtCenter(factor: number): void {
    setViewBox((current) =>
      zoomCameraAtAnchor(current, factor, { x: 0.5, y: 0.5 }),
    );
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>): void {
    // Ctrl/Command+wheel is a browser-reserved page-zoom gesture. The canvas
    // owns an unmodified wheel gesture only while the pointer is over it, so
    // schematic navigation stays useful without fighting the host browser.
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
    const factor = event.deltaY < 0 ? 0.88 : 1.14;
    setViewBox((current) => zoomCameraAtAnchor(current, factor, anchor));
  }

  function beginCanvasGesture(event: ReactPointerEvent<SVGSVGElement>): void {
    if (getCurrentInteractionState().kind === "moving-selection") return;
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanPreview({
        clientStart: { x: event.clientX, y: event.clientY },
        viewBoxStart: viewBox,
        pointerId: event.pointerId,
        dragged: false,
      });
      return;
    }
    // Frame-zoom entry: right-drag, or Alt+left-drag for environments whose
    // system software (screenshot tools, mouse-driver gestures) hooks the
    // right button before the browser can see the drag. Modes that commit on
    // the next left click, and the drafting/wire tools whose right click
    // cancels them, stay outside this gesture.
    const frameZoomDrag =
      event.button === 2 || (event.button === 0 && event.altKey);
    if (frameZoomDrag) {
      if (
        (pendingSymbolId && pendingComponentPlacement) ||
        vddRailMode ||
        copyPlacement !== null ||
        tool === "wire" ||
        tool === "construction-line" ||
        tool === "arrow" ||
        tool === "rectangle"
      ) {
        return;
      }
      if (
        event.target !== event.currentTarget &&
        (event.target as Element).tagName !== "rect"
      ) {
        return;
      }
      const zoomStart = pointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      setBoxPreview({
        start: zoomStart,
        end: zoomStart,
        pointerId: event.pointerId,
        intent: "zoom",
      });
      return;
    }
    if (event.button !== 0) return;
    // Placement deliberately commits on the matching click below. Pointer-down
    // must not start the normal selection/move gesture while that click is
    // pending, regardless of which SVG child was hit.
    if (
      (pendingSymbolId && pendingComponentPlacement) ||
      vddRailMode ||
      copyPlacement !== null
    )
      return;
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (
      event.target !== event.currentTarget &&
      (event.target as Element).tagName !== "rect"
    )
      return;
    if (tool === "wire") return;
    // Arrow / Construction line use a two-phase click model (mirroring wire):
    // click to set the start, hover to preview, click to commit. They bypass the
    // pointer-capture gesture trio here; creation lives in the SVG onClick and
    // continueCanvasGesture hover handling.
    if (
      tool === "construction-line" ||
      tool === "arrow" ||
      tool === "rectangle"
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setBoxPreview({
      start: point,
      end: point,
      pointerId: event.pointerId,
      intent: "select",
    });
  }

  function continueCanvasGesture(
    event: ReactPointerEvent<SVGSVGElement>,
  ): void {
    if (getCurrentInteractionState().kind === "moving-selection") {
      updateCommandMovePreviewFromSelection(
        pointFromClient(event.clientX, event.clientY, event.currentTarget),
        event.currentTarget,
        event.altKey,
      );
      return;
    }
    if (panPreview?.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const dx =
        ((event.clientX - panPreview.clientStart.x) / bounds.width) *
        panPreview.viewBoxStart.width;
      const dy =
        ((event.clientY - panPreview.clientStart.y) / bounds.height) *
        panPreview.viewBoxStart.height;
      const moved =
        Math.hypot(
          event.clientX - panPreview.clientStart.x,
          event.clientY - panPreview.clientStart.y,
        ) >= DRAG_START_DISTANCE_PX;
      if (moved && !panPreview.dragged)
        setPanPreview({ ...panPreview, dragged: true });
      setViewBox({
        ...panPreview.viewBoxStart,
        x: Math.round(panPreview.viewBoxStart.x - dx),
        y: Math.round(panPreview.viewBoxStart.y - dy),
      });
      return;
    }
    const point = pointFromClient(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    lastCanvasPointRef.current = point;
    if (vddRailMode) {
      const snapped = {
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      };
      setVddRailPreviewPoint(
        vddRailStart
          ? constrainedPowerRailEndpoint(vddRailStart, snapped)
          : snapped,
      );
      return;
    }
    if (pendingSymbolId) {
      setComponentPreviewPoint(point);
      return;
    }
    if (copyPlacement) {
      setCopyPreviewPoint({
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      });
      return;
    }
    if (boxPreview?.pointerId === event.pointerId) {
      setBoxPreview({ ...boxPreview, end: point });
    }
    // Two-phase drafting: keep the preview anchored to the snap-aware hover point.
    if (
      (tool === "arrow" ||
        tool === "construction-line" ||
        tool === "rectangle") &&
      draftingSource !== null
    ) {
      const snapped = snapDraftingPoint(
        point,
        event.altKey,
        event.shiftKey,
        draftingSource ?? undefined,
        logicalRadiusForPixels(event.currentTarget, SNAP_CAPTURE_RADIUS_PX),
      );
      setDraftingHover(snapped.point);
      setDraftingSnapPoint(snapped.snap);
      paintSnapGuides(snapped.guides);
    }
    if (tool === "wire" && wireSource) {
      const rawPoint = pointFromClient(
        event.clientX,
        event.clientY,
        event.currentTarget,
        false,
      );
      const resolved = resolveWireCanvasSnap(
        rawPoint,
        event.currentTarget,
        event.altKey,
      );
      setWirePreviewPoint(resolved.point);
      paintSnapGuides(resolved.guides);
    }
  }

  function finishCanvasGesture(event: ReactPointerEvent<SVGSVGElement>): void {
    if (
      event.type === "pointercancel" &&
      cellSymbolLayoutDrag?.pointerId === event.pointerId
    ) {
      setCellSymbolLayoutDrag(null);
      return;
    }
    if (completeCellSymbolLayoutDrag(event)) return;
    if (panPreview?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (!panPreview.dragged && getCurrentInteractionState().kind === "wire") {
        toggleWireRoutingMode();
        setStatus(
          `Wire mode: ${wireRoutingMode === "orthogonal" ? "45° octilinear" : "orthogonal"}`,
        );
      }
      setPanPreview(null);
      return;
    }
    if (boxPreview?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (boxPreview.intent === "zoom") {
      const rect = normalizedRect(boxPreview.start, boxPreview.end);
      setBoxPreview(null);
      // A right press barely moved is an ordinary right click, not a frame.
      if (
        rect.width > document.presentation.grid &&
        rect.height > document.presentation.grid
      ) {
        setViewBox(fitCameraToBounds(rect, document.presentation.grid));
        setStatus("Zoomed to framed region");
      }
      return;
    }
    const rect = normalizedRect(boxPreview.start, boxPreview.end);
    const clicked =
      rect.width <= document.presentation.grid &&
      rect.height <= document.presentation.grid;
    // Classic directional marquee: a left-to-right drag is a window (full
    // containment required), a right-to-left drag is a crossing (any overlap
    // selects). Geometry alone decides membership.
    const selection = clicked
      ? { instanceIds: [], ...EMPTY_SUPPLEMENTAL_SELECTION }
      : marqueeSelection(
          document,
          resolver,
          routeGeometryRecords,
          styleProfile,
          rect,
          marqueeMode(boxPreview.start, boxPreview.end),
        );
    replaceSelection(selection);
    setSelectedEndpoint(null);
    setBoxPreview(null);
    const count =
      selection.instanceIds.length +
      selection.routeIds.length +
      selection.junctionIds.length +
      selection.annotationIds.length +
      selection.draftingIds.length;
    setStatus(count > 0 ? `Selected ${count} objects` : "Selection cleared");
  }

  // Drafting uses the shared Snap Engine. It may align visually to electrical
  // geometry, but this profile never creates a Net or junction.
  // closest point on any route segment, or any existing drafting vertex — within
  // DRAFTING_SNAP_RADIUS — wins; grid snap is the fallback. Shift locks the
  // resulting segment from the origin to horizontal/vertical/45°. Purely visual
  // — never creates a Net, junction, or short.
  function snapDraftingPoint(
    point: DerivedPoint,
    altKey: boolean,
    shiftKey: boolean,
    origin?: Point,
    tolerance = document.presentation.grid,
  ): { point: Point; snap: Point | null; guides: SnapGuideLine[] } {
    if (altKey) {
      const constrained =
        shiftKey && origin ? constrainAngle(origin, point) : point;
      return {
        point: snapGridPoint(constrained, document.presentation.grid),
        snap: null,
        guides: [],
      };
    }
    const routeTargets = routeGeometryRecords.flatMap(({ route, geometry }) =>
      geometry.centerline.slice(0, -1).map((from, segmentIndex) => ({
        id: `route:${route.id}:${segmentIndex}`,
        point: closestPointOnSegment(
          point,
          from,
          geometry.centerline[segmentIndex + 1]!,
        ),
        kind: "route" as const,
      })),
    );
    const resolved = resolvePointSnap(
      point,
      [
        ...buildSceneSnapTargets(document, resolver, visibleEndpoints),
        ...routeTargets,
      ],
      {
        grid: document.presentation.grid,
        tolerance,
        profile: SNAP_PROFILES.draftingHandle,
      },
    );
    let snapped: DerivedPoint = {
      x: point.x + resolved.delta.x,
      y: point.y + resolved.delta.y,
    };
    const hasObjectSnap =
      (resolved.xMatch && resolved.xMatch.targetKind !== "grid") ||
      (resolved.yMatch && resolved.yMatch.targetKind !== "grid");
    // Closest point on each route segment (visual snap to conductors; no
    // electrical effect — drafting never joins a Net by proximity).
    if (shiftKey && origin) {
      snapped = constrainAngle(origin, snapped);
    }
    return {
      point: snapGridPoint(snapped, document.presentation.grid),
      snap: hasObjectSnap
        ? snapGridPoint(snapped, document.presentation.grid)
        : null,
      guides: resolved.guides,
    };
  }

  function constrainAngle(origin: Point, target: DerivedPoint): DerivedPoint {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4; // 45° increments
    const locked = Math.round(angle / step) * step;
    const length = Math.hypot(dx, dy);
    return {
      x: Math.round(origin.x + Math.cos(locked) * length),
      y: Math.round(origin.y + Math.sin(locked) * length),
    };
  }

  // Handle a canvas click while the Arrow / Construction line tool is active.
  // Mirrors the wire tool's click model: first click fixes the start (and a snap
  // candidate), hover updates the preview, the next click commits. Construction
  // lines append a vertex per intermediate click; arrows commit on click #2.
  function handleDraftingCanvasClick(
    rawPoint: Point,
    altKey: boolean,
    shiftKey: boolean,
    tolerance: number,
  ): void {
    if (
      tool !== "arrow" &&
      tool !== "construction-line" &&
      tool !== "rectangle"
    )
      return;
    const { point, snap } = snapDraftingPoint(
      rawPoint,
      altKey,
      shiftKey,
      draftingSource ?? undefined,
      tolerance,
    );
    if (draftingSource === null) {
      setDraftingSource(point);
      setDraftingHover(point);
      setDraftingSnapPoint(snap);
      setDraftingWaypoints([]);
      setStatus(
        tool === "arrow"
          ? "Arrow: click the end point (Enter to finish, Esc to cancel)"
          : tool === "rectangle"
            ? "Rectangle: click the opposite corner (Esc to cancel)"
            : "Construction line: click next vertex (Enter to finish, Esc to cancel)",
      );
      return;
    }
    if (tool === "arrow" || tool === "rectangle") {
      commitDraftingCreate(tool, draftingSource, point);
      clearDraftingCreate();
      return;
    }
    // construction-line: each click appends a vertex; commit happens on Enter
    // or double-click (finishDraftingCreate).
    setDraftingWaypoints((current) => [...current, point]);
    setDraftingHover(point);
    setDraftingSnapPoint(snap);
    setStatus(`Construction line: ${draftingWaypoints.length + 1} bend(s)`);
  }

  // Finish construction-line creation from the accumulated waypoints + hover,
  // or finish an arrow from its source + hover. One transaction.
  function finishDraftingCreate(): void {
    if (
      tool !== "arrow" &&
      tool !== "construction-line" &&
      tool !== "rectangle"
    )
      return;
    if (draftingSource === null) return;
    const end = draftingHover ?? draftingSource;
    if (tool === "arrow" || tool === "rectangle") {
      if (draftingSource.x !== end.x || draftingSource.y !== end.y) {
        commitDraftingCreate(tool, draftingSource, end);
      }
    } else {
      const points = [draftingSource, ...draftingWaypoints];
      if (
        end.x !== points[points.length - 1]!.x ||
        end.y !== points[points.length - 1]!.y
      ) {
        points.push(end);
      }
      if (points.length >= 2) {
        commitDraftingCreateVertices(points);
      }
    }
    clearDraftingCreate();
  }

  // P1: commit a drafting object at the final end point.
  function commitDraftingCreate(
    activeTool: EditorTool,
    start: Point,
    end: Point,
  ): void {
    uniqueSuffixCounter.current += 1;
    const snappedStart = snapGridPoint(start, document.presentation.grid);
    const snappedEnd = snapGridPoint(end, document.presentation.grid);
    if (activeTool === "construction-line") {
      const id = `construction-${uniqueSuffixCounter.current}`;
      const result = transact([
        {
          kind: "upsert_drafting_object",
          object: {
            id,
            kind: "construction-line",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: snappedStart },
            points: [snappedStart, snappedEnd],
            lineStyle: "dashed",
          },
        },
      ]);
      if (result.ok) setStatus(`Added construction line ${id}`);
    } else if (activeTool === "arrow") {
      const id = `arrow-${uniqueSuffixCounter.current}`;
      const result = transact([
        {
          kind: "upsert_drafting_object",
          object: {
            id,
            kind: "arrow",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: snappedStart },
            from: {
              kind: "free",
              position: snappedStart,
            },
            to: {
              kind: "free",
              position: snappedEnd,
            },
          },
        },
      ]);
      if (result.ok) setStatus(`Added free arrow ${id}`);
    } else if (activeTool === "rectangle") {
      const width = Math.round(Math.abs(snappedEnd.x - snappedStart.x));
      const height = Math.round(Math.abs(snappedEnd.y - snappedStart.y));
      if (width < 1 || height < 1) {
        setStatus("Rectangle needs non-zero width and height");
        return;
      }
      const id = `rectangle-${uniqueSuffixCounter.current}`;
      const center = snapGridPoint(
        {
          x: Math.round((snappedStart.x + snappedEnd.x) / 2),
          y: Math.round((snappedStart.y + snappedEnd.y) / 2),
        },
        document.presentation.grid,
      );
      const result = transact([
        {
          kind: "upsert_drafting_object",
          object: {
            id,
            kind: "rectangle",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: center },
            center,
            width,
            height,
            rotation: 0,
            lineStyle: "solid",
          },
        },
      ]);
      if (result.ok) setStatus(`Added rectangle ${id}`);
    }
    setTool("pointer");
  }

  // Commit a multi-vertex construction line from the two-phase click model.
  function commitDraftingCreateVertices(points: Point[]): void {
    if (points.length < 2) return;
    uniqueSuffixCounter.current += 1;
    const id = `construction-${uniqueSuffixCounter.current}`;
    const snappedPoints = points.map((point) =>
      snapGridPoint(point, document.presentation.grid),
    );
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: {
          id,
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: snappedPoints[0]! },
          points: snappedPoints,
          lineStyle: "dashed",
        },
      },
    ]);
    if (result.ok) {
      setStatus(`Added construction line ${id}`);
      setTool("pointer");
    }
  }

  function disconnectSelectedEndpoint(removeRoutes: boolean): void {
    if (!selectedEndpoint || selectedEndpoint.endpoint.kind === "junction") {
      return;
    }
    const routeEdits = removeRoutes
      ? document.routes
          .filter(
            (route) =>
              endpointKey(route.from) ===
                endpointKey(selectedEndpoint.endpoint) ||
              endpointKey(route.to) === endpointKey(selectedEndpoint.endpoint),
          )
          .map((route): SchematicEdit => ({
            kind: "remove_route_geometry",
            routeId: route.id,
          }))
      : [];
    const result = transactConnectivity(
      "disconnect_endpoint",
      [
        ...routeEdits,
        { kind: "disconnect_endpoint", endpoint: selectedEndpoint.endpoint },
      ],
      { removeRoutes },
    );
    if (result?.ok) {
      setSelectedEndpoint(null);
      setStatus(
        removeRoutes ? "Deleted endpoint connection" : "Disconnected endpoint",
      );
    }
  }

  function nextNoConnectId(): string {
    const occupied = new Set([
      ...document.instances.map((instance) => instance.id),
      ...document.nets.map((net) => net.id),
      ...document.routes.map((route) => route.id),
      ...document.junctions.map((junction) => junction.id),
      ...document.noConnects.map((noConnect) => noConnect.id),
      ...document.annotations.map((annotation) => annotation.id),
      ...document.layoutGroups.map((group) => group.id),
      ...document.constraints.map((constraint) => constraint.id),
      ...(document.drafting?.objects ?? []).map((object) => object.id),
    ]);
    let id: string;
    do {
      uniqueSuffixCounter.current += 1;
      id = `no-connect-ui-${uniqueSuffixCounter.current}`;
    } while (occupied.has(id));
    return id;
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
        hasRotatableSelection,
        hasDraftingSelection: Boolean(selectedDrafting),
        hasInspectableSelection,
        hasMoveSelection: hasVisualSelection(visualSelection),
        hasRouteSelection: Boolean(selectedRoute),
        hasHighlightableNet: selectedHighlightNetId !== null,
        wireReadyToFinish: Boolean(wireSource && wirePreviewPoint),
        draftingReadyToFinish:
          (tool === "arrow" ||
            tool === "construction-line" ||
            tool === "rectangle") &&
          draftingSource !== null,
        helpOpen: helpOpen || aboutOpen,
        canvasDragActive: canvasDragSessionRef.current !== null,
        hasClearableDraftingSelection:
          selectedDrafting?.kind === "arrow" ||
          selectedDrafting?.kind === "construction-line" ||
          selectedDrafting?.kind === "rectangle",
        hasRemovableWireWaypoint: Boolean(
          wireSource && wireDraftSteps.length > 0,
        ),
        propertiesOpen: selectionOpen,
        hasHierarchyEnterSelection,
        canReturnToParent: documentStack.length > 0,
      });
      if (!shortcut) return;

      const escapeIntent =
        shortcut.kind === "close-help" ||
        shortcut.kind === "cancel-canvas-drag" ||
        shortcut.kind === "cancel-interaction" ||
        shortcut.kind === "clear-drafting-selection" ||
        shortcut.kind === "cancel-passive";
      if (!escapeIntent) event.preventDefault();

      switch (shortcut.kind) {
        case "block-browser-refresh":
          setStatus("Refresh blocked to protect the current circuit");
          return;
        case "block-browser-bookmark":
          setStatus("Browser bookmark shortcut blocked while editing");
          return;
        case "undo":
        case "redo":
          transact([{ kind: shortcut.kind }]);
          return;
        case "copy":
          beginCopyPlacementFromSelection();
          return;
        case "begin-selection-move":
          beginKeyboardSelectionMoveFromSelection();
          return;
        case "move-selection-required":
          setStatus("Select objects before moving them");
          return;
        case "save":
          saveProjectFile();
          return;
        case "open":
          projectInputRef.current?.click();
          return;
        case "select-all":
          replaceSelection({
            instanceIds: document.instances
              .filter((instance) => instance.placement)
              .map((instance) => instance.id),
            routeIds: document.routes.map((route) => route.id),
            junctionIds: document.junctions.map((junction) => junction.id),
            annotationIds: document.annotations.map(
              (annotation) => annotation.id,
            ),
            draftingIds: (document.drafting?.objects ?? []).map(
              (object) => object.id,
            ),
          });
          setSelectedEndpoint(null);
          return;
        case "clear-selection":
          resetSelection();
          setSelectedEndpoint(null);
          setSelectedRouteSegmentIndex(null);
          setStatus("Selection cleared");
          return;
        case "reverse-current-marker":
          reverseSelectedCurrentArrow();
          return;
        case "open-component-insert":
          startInsertFromHook(fullInsertLaunch());
          return;
        case "place-port": {
          const request = quickPlaceRequest(
            document.presentation.styleProfileId,
            "port",
          );
          if (request) startInsertFromHook({ kind: "quick", request });
          return;
        }
        case "rotate-placement":
          rotatePendingComponentFromHook(shortcut.deltaDegrees);
          return;
        case "rotate-copy-placement":
          rotatePendingCopy(shortcut.deltaDegrees);
          return;
        case "mirror-placement":
          mirrorPendingComponentFromHook(shortcut.direction);
          return;
        case "mirror-copy-placement":
          mirrorPendingCopy(shortcut.direction);
          return;
        case "rotate":
          rotateSelected(shortcut.deltaDegrees);
          return;
        case "mirror":
          mirrorSelected(shortcut.direction);
          return;
        case "activate-tool":
          activateTool(shortcut.tool);
          return;
        case "add-text":
          addPlainText();
          return;
        case "open-properties":
          openProperties();
          return;
        case "close-properties":
          exitCellSymbolLayout();
          setSelectionOpen(false);
          setImportReviewOpen(false);
          return;
        case "property-selection-required":
          setStatus("Select an object before opening Properties");
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
          setStatus(
            "Select a rectangle or hierarchical block before entering a Cell",
          );
          return;
        case "fit-view":
          fitView();
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
        case "close-help":
          if (helpOpen) closeHelp();
          else closeAbout();
          return;
        case "cancel-canvas-drag":
          canvasDragSessionRef.current?.cancel();
          setStatus("Cancelled canvas drag");
          return;
        case "cancel-interaction": {
          const cancelledKind = getCurrentInteractionState().kind;
          cancelAllTransientInteraction();
          setStatus(
            cancelledKind === "copy-placement"
              ? "Copy placement cancelled"
              : cancelledKind === "placing-vdd-rail"
                ? "Power Rail cancelled"
                : cancelledKind === "placing-component"
                  ? "Component placement cancelled"
                  : cancelledKind === "drawing"
                    ? "Drawing cancelled"
                    : "Cancelled active tool",
          );
          return;
        }
        case "clear-drafting-selection":
          replaceSelectionKind("drafting", []);
          setStatus("Cleared drawing selection");
          return;
        case "cancel-passive":
          setBoxPreview(null);
          paintSnapGuides([]);
          setStatus("Cancelled");
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
        case "delete-selection":
          deleteCurrentSelection();
          return;
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  function selectSearchResult(result: SearchResult): void {
    navigateToLocator(
      result.locator,
      `Selected ${result.locator.kind} ${result.locator.objectId}`,
    );
    closeSearch();
  }

  function highlightNet(
    netId: string,
    documentId = document.id,
    endpoint?: RouteEndpoint,
  ): void {
    setHighlightedNetOrigin({
      documentId,
      netId,
      ...(endpoint ? { endpoint } : {}),
    });
    setStatus(`Highlighted Net ${netId}`);
  }

  function toggleHighlightedNet(): void {
    const netId = selectedHighlightNetId;
    if (!netId) {
      setStatus(
        "Select a wire, connected pin, or Net Label before highlighting a Net",
      );
      return;
    }
    if (selectedHighlightIsActive) {
      setHighlightedNetOrigin(null);
      setStatus(`Cleared Net highlight ${netId}`);
      return;
    }
    highlightNet(netId, document.id, selectedHighlightEndpoint);
  }

  function navigateTraceHop(
    hop: HierarchyNetTraceHop | GlobalNetTraceHop,
  ): void {
    navigateToLocator(
      {
        documentId: hop.to.documentId,
        hierarchyPath: [],
        kind: "net",
        objectId: hop.to.netId,
      },
      hop.direction === "global"
        ? `Traced global Net ${hop.foldedName} to ${hop.to.netId}`
        : `Traced Net ${hop.to.netId} via ${hop.frame.instanceId}.${hop.frame.parentPinName}`,
    );
  }

  return (
    <main className="app-shell">
      {renderCrashRequested() ? <RenderCrashProbe /> : null}
      <header className="app-chrome">
        <div className="app-chrome-main">
          <div className="app-brand">
            <a
              className="gallery-home-link"
              href="/"
              aria-label="Back to the gallery"
              title="Back to the gallery"
            >
              <span className="app-brand-mark" aria-hidden="true" />
              <h1 title="Analog Canvas">Analog Canvas</h1>
            </a>
            <div className="app-brand-copy">
              <p title={`${project.name} / ${document.name}`}>
                {project.name} /{" "}
                <span data-testid="active-document-name">{document.name}</span>
              </p>
            </div>
          </div>
          <nav
            className="app-command-surface"
            aria-label="Editor commands"
            onClick={(event) => {
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(".command-popover button")
              ) {
                dismissOpenCommandMenus();
              }
            }}
          >
            <div className="menubar-row">
              <details className="command-menu" name="editor-command-menu">
                <summary>File</summary>
                <div className="command-popover">
                  <button type="button" onClick={saveProjectFile}>
                    Save Project
                  </button>
                  <button type="button" onClick={refreshApp}>
                    Refresh app
                  </button>
                  <label className="file-import">
                    Open Project
                    <input
                      ref={projectInputRef}
                      data-testid="project-file"
                      type="file"
                      accept=".json,.icproj.json,application/json"
                      onChange={(event) =>
                        void openProjectFile(
                          event.currentTarget.files?.[0] ?? null,
                        )
                      }
                    />
                  </label>
                  <label className="file-import">
                    Import SPICE
                    <input
                      data-testid="spice-files"
                      type="file"
                      accept=".spi,.cir,.sp,.inc,.lib"
                      multiple
                      onChange={(event) =>
                        void importSpiceFiles(event.currentTarget.files)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveCurrentProjectAsExample()}
                  >
                    Save as Example
                  </button>
                  <span className="command-group-label">Export</span>
                  <button
                    type="button"
                    aria-label="Export SVG"
                    onClick={exportSvg}
                  >
                    SVG
                  </button>
                  <button
                    type="button"
                    aria-label="Export PNG"
                    onClick={() => void exportRaster("png")}
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    aria-label="Export PDF"
                    onClick={() => void exportRaster("pdf")}
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    aria-label="Export SPICE netlist"
                    onClick={() => exportDesignNetlist("spice")}
                  >
                    SPICE netlist
                  </button>
                  <button
                    type="button"
                    aria-label="Export Spectre netlist"
                    onClick={() => exportDesignNetlist("spectre")}
                  >
                    Spectre netlist
                  </button>
                  {recoverySessions.length > 0 ? (
                    <button type="button" onClick={openRecoveryDialog}>
                      Recover recent work…
                    </button>
                  ) : null}
                </div>
              </details>
              <details className="command-menu" name="editor-command-menu">
                <summary>Edit</summary>
                <div className="command-popover">
                  <button
                    type="button"
                    onClick={() => transact([{ kind: "undo" }])}
                    disabled={!canUndo}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={() => transact([{ kind: "redo" }])}
                    disabled={!canRedo}
                  >
                    Redo
                  </button>
                  <button
                    type="button"
                    onClick={deleteCurrentSelection}
                    disabled={
                      !hasVisualSelection(visualSelection) && !selectedEndpoint
                    }
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    disabled={clearableObjectCount === 0}
                  >
                    Clear canvas
                  </button>
                  <button
                    type="button"
                    onClick={() => rotateSelected()}
                    disabled={selectedIds.length === 0}
                  >
                    <ToolIcon name="rotate" />
                    Rotate
                  </button>
                  <button
                    type="button"
                    onClick={() => mirrorSelected("left-right")}
                    disabled={selectedIds.length === 0}
                  >
                    Mirror left/right (Shift+R)
                  </button>
                  <button
                    type="button"
                    onClick={() => mirrorSelected("top-bottom")}
                    disabled={selectedIds.length === 0}
                  >
                    Mirror top/bottom (Ctrl+R)
                  </button>
                  {selectedIds.length > 1 ? (
                    <button type="button" onClick={alignSelectedInstances}>
                      Align
                    </button>
                  ) : null}
                </div>
              </details>
              <details className="command-menu" name="editor-command-menu">
                <summary>Netlist</summary>
                <div className="command-popover">
                  <span className="command-group-label">Authoring</span>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={instanceTableOpen}
                    onClick={() => setInstanceTableOpen(true)}
                  >
                    Instance Table…
                  </button>
                  <span className="command-group-label">Validation</span>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={netlistPreflightOpen}
                    onClick={() => setNetlistPreflightOpen(true)}
                  >
                    Run Preflight…
                  </button>
                </div>
              </details>
              {publicAgentUiEnabled ? (
                <details className="command-menu" name="editor-command-menu">
                  <summary>Agent</summary>
                  <div className="command-popover">
                    <button
                      type="button"
                      onClick={() => {
                        if (agentSession.status === "idle") {
                          setAgentPanelOpen(true);
                          return;
                        }
                        setSelectionOpen(true);
                        setAgentDetailsOpen(true);
                      }}
                    >
                      {agentSession.status === "idle"
                        ? "Connect Agent"
                        : "Manage Agent"}
                    </button>
                  </div>
                </details>
              ) : null}
              <button
                type="button"
                data-testid="project-search-button"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen(true)}
              >
                Search
              </button>
              <button
                type="button"
                data-testid="publish-gallery-button"
                aria-haspopup="dialog"
                aria-expanded={publishGalleryOpen}
                title="Publish to Gallery"
                onClick={() => setPublishGalleryOpen(true)}
              >
                Publish to Gallery
              </button>
            </div>
          </nav>
          <div className="app-chrome-actions">
            <a
              className="analytics-link"
              href="/analytics"
              aria-label="Open visitor analytics"
            >
              {visitStats ? (
                <>
                  <span>{visitStats.uv.toLocaleString()} visitors</span>
                  <span aria-hidden="true">·</span>
                  <span>{visitStats.pv.toLocaleString()} views</span>
                </>
              ) : (
                "Analytics"
              )}
            </a>
            <button
              type="button"
              className="menubar-help"
              ref={aboutButtonRef}
              aria-haspopup="dialog"
              aria-expanded={aboutOpen}
              aria-controls="editor-about-dialog"
              onClick={() => setAboutOpen(true)}
            >
              About
            </button>
            <button
              type="button"
              className="menubar-help"
              ref={helpButtonRef}
              aria-haspopup="dialog"
              aria-expanded={helpOpen}
              aria-controls="editor-help-dialog"
              onClick={() => setHelpOpen(true)}
            >
              Help
            </button>
          </div>
        </div>
        <div
          className="toolbar-row draw-toolbar"
          aria-label="Drawing tools"
          data-testid="draw-toolbar"
        >
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-insert"
            title="Insert component (I)"
            onClick={() => startInsertFromHook(fullInsertLaunch())}
          >
            <ToolIcon name="insert" />
            <span>Insert</span>
          </button>
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-wire"
            aria-pressed={tool === "wire"}
            title="Wire (W)"
            onClick={() => activateTool("wire")}
          >
            <ToolIcon name="wire" />
            <span>Wire</span>
          </button>
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-text"
            aria-label="Text"
            title="Text (T)"
            onClick={addPlainText}
          >
            <ToolIcon name="text" />
            <span>Text</span>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-arrow"
            aria-pressed={tool === "arrow"}
            title="Arrow (A)"
            onClick={() => activateTool("arrow")}
          >
            <ToolIcon name="arrow" />
            <span>Arrow</span>
          </button>
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-line"
            aria-pressed={tool === "construction-line"}
            title="Construction line (K)"
            onClick={() => activateTool("construction-line")}
          >
            <ToolIcon name="line" />
            <span>Line</span>
          </button>
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-rectangle"
            aria-pressed={tool === "rectangle"}
            title="Rectangle (R)"
            onClick={() => activateTool("rectangle")}
          >
            <ToolIcon name="rectangle" />
            <span>Rect</span>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="draw-tool"
            data-testid="draw-tool-document-style"
            aria-haspopup="dialog"
            aria-expanded={styleDialogOpen}
            title="Document style"
            onClick={() => setStyleDialogOpen(true)}
          >
            <ToolIcon name="style" />
            <span>Style</span>
          </button>
        </div>
        <div className="toolbar-row" aria-label="Document hierarchy">
          <div
            className="document-nav"
            aria-label="Cell navigation"
            data-testid="cell-navigation"
          >
            <a
              className="toolbar-gallery-link"
              href="/"
              title="Back to the gallery"
              aria-label="Back to the gallery feed"
              data-testid="toolbar-gallery-link"
            >
              ← Gallery
            </a>
            <button
              type="button"
              onClick={returnToParentDocument}
              disabled={documentStack.length === 0}
              title="Return to the parent Cell (Shift+E)"
            >
              Up
            </button>
            <button
              type="button"
              onClick={returnToTopDocument}
              disabled={document.id === project.topDocumentId}
              title="Return to the top Cell"
            >
              Top
            </button>
            <select
              aria-label="Cells"
              data-testid="document-selector"
              value={document.id}
              onChange={(event) => {
                const nextDocumentId = event.currentTarget.value;
                const paths = findHierarchyPaths(
                  projectConnectivityIndex,
                  project.topDocumentId,
                  nextDocumentId,
                );
                setDocumentStack(paths?.length === 1 ? [...paths[0]!] : []);
                switchDocument(nextDocumentId);
                if (paths && paths.length > 1) {
                  setStatus(
                    `Opened shared Cell without caller context (${paths.length} instance paths)`,
                  );
                }
              }}
            >
              {project.documents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id === project.topDocumentId
                    ? `${candidate.name} (top)`
                    : candidate.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={enterSelectedHierarchy}
              disabled={!hasHierarchyEnterSelection}
              title="Enter the selected Cell, or create one from a rectangle (E)"
            >
              Enter Cell
            </button>
            <div className="cell-command-row" data-testid="cell-command-menu">
              <button type="button" onClick={() => setCellManagerOpen(true)}>
                Manage Cells…
              </button>
              <button
                type="button"
                onClick={placeCellInstance}
                disabled={project.documents.length < 2}
              >
                Place Cell
              </button>
            </div>
          </div>
        </div>
        <div data-testid="editor-test-telemetry" hidden>
          <output data-testid="selected-internal-route-count">
            {internalSelection.routeIds.length}
          </output>
          <output data-testid="revision">{document.revision}</output>
          <output data-testid="source-status">{document.sourceStatus}</output>
          <output data-testid="document-count">
            {project.documents.length}
          </output>
          <output data-testid="active-document-id">{document.id}</output>
          <output data-testid="active-instance-count">
            {document.instances.length}
          </output>
          <output data-testid="instance-count">{projectInstanceCount}</output>
          <output data-testid="net-count">{document.nets.length}</output>
          <output data-testid="active-tool">{tool}</output>
          <output data-testid="flightline-count">{flightlines.length}</output>
          <output data-testid="displayed-flightline-count">
            {displayedFlightlines.length}
          </output>
          <output data-testid="crossing-count">{crossings.length}</output>
          <output data-testid="annotation-count">
            {document.annotations.length}
          </output>
          <output data-testid="structural-diagnostic-count">
            {visualDiagnosticSummary.structural.length}
          </output>
          <output data-testid="visual-diagnostic-count">
            {visualDiagnosticSummary.observations.length}
          </output>
          <output data-testid="blocking-diagnostic-count">
            {visualDiagnosticSummary.blockingCount}
          </output>
        </div>
      </header>
      {helpOpen ? (
        <EditorHelpDialog closeButtonRef={helpCloseRef} onClose={closeHelp} />
      ) : null}
      {aboutOpen ? (
        <EditorAboutDialog
          closeButtonRef={aboutCloseRef}
          onClose={closeAbout}
        />
      ) : null}
      {(recoveryState === "quota-exceeded" ||
        recoveryState === "unavailable" ||
        recoveryState === "failed") &&
      !recoveryFailureDismissed ? (
        <RecoveryFailureBanner
          state={recoveryState}
          onDownload={() => {
            const outcome = requestProjectDownload(project);
            setStatus(
              outcome.status === "download-requested"
                ? `Download requested: ${outcome.fileName}`
                : `Download failed: ${outcome.message}`,
            );
          }}
          onDismiss={() => setRecoveryFailureDismissed(true)}
        />
      ) : null}
      {recoveryDialogOpen && recoverySessions.length > 0 ? (
        <RecentRecoveryDialog
          sessions={recoverySessions}
          onRestore={restoreRecoverySession}
          onDownloadBackup={downloadRecoveryBackup}
          onDeleteSession={deleteRecoverySessionFromDialog}
          onClose={() => setRecoveryDialogOpen(false)}
        />
      ) : null}
      {replaceGuard !== null ? (
        <ReplaceGuardDialog
          intent={replaceGuard.intent}
          onCancel={cancelReplaceGuard}
          onConfirm={confirmReplaceGuard}
          onDownload={downloadCurrentProjectFromGuard}
        />
      ) : null}
      <ProjectSearchDialog
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
        onQueryChange={setSearchQuery}
        onSelect={selectSearchResult}
        onClose={closeSearch}
      />
      <InstanceTableDialog
        open={instanceTableOpen}
        project={project}
        connectivityIndex={projectConnectivityIndex}
        activeDocumentId={document.id}
        onClose={() => setInstanceTableOpen(false)}
        onOpenInstance={openInstanceFromTable}
        onApply={(transactionId, edits) => {
          const committed = commitStructure(transactionId, edits);
          if (committed) {
            setStatus(
              `Updated ${edits.length} Cell${edits.length === 1 ? "" : "s"}`,
            );
          }
          return committed;
        }}
      />
      <InsertComponentDialog
        open={insertDialogOpen}
        styleProfileId={document.presentation.styleProfileId}
        recentSymbolIds={recentSymbolIds}
        cells={cellInsertCandidates}
        externalDefinitions={externalSubcircuitInsertCandidates}
        scope={insertScope}
        initialSelectionId={insertInitialSelectionId}
        onApply={(request) => startInsertFromHook({ kind: "quick", request })}
        onCancel={cancelComponentInsertFromHook}
      />
      <CellManagerDialog
        open={cellManagerOpen}
        cells={cellManagerEntries}
        documents={project.documents}
        activeDocumentId={document.id}
        onClose={() => setCellManagerOpen(false)}
        onCreate={(name) => {
          createCell(name);
          setCellManagerOpen(false);
        }}
        onOpen={(documentId) => {
          setCellManagerOpen(false);
          switchDocument(documentId);
        }}
        onRename={renameCell}
        onDelete={(documentId) => {
          const target = project.documents.find(
            (candidate) => candidate.id === documentId,
          );
          if (!target) return;
          if (
            commitStructure(
              "delete-cell",
              planDeleteCell(project, documentId),
              project.topDocumentId,
            )
          ) {
            setCellManagerOpen(false);
            setStatus(`Deleted Cell ${target.name}`);
          }
        }}
        onJumpToCaller={jumpToCaller}
        onRenameTerminal={(documentId, terminalId, name) =>
          renameCellTerminal(terminalId, name, documentId)
        }
        onSetTerminalDirection={(documentId, terminalId, direction) =>
          updateCellPortDirection(terminalId, direction, documentId)
        }
        onMoveTerminal={(documentId, terminalId, delta) =>
          moveCellTerminal(terminalId, delta, documentId)
        }
        onSetFormalParameters={(documentId, formalParameters) =>
          setCellFormalParameters(formalParameters, documentId)
        }
        externalDefinitions={project.externalSubcircuitDefinitions}
        onSetExternalDefinition={setExternalSubcircuitDefinition}
      />
      <NetlistPreflightDialog
        open={netlistPreflightOpen}
        result={netlistAnalysis}
        onClose={() => setNetlistPreflightOpen(false)}
        onNavigate={navigateToNetlistDiagnostic}
        onExport={(format) => exportDesignNetlist(format, true)}
      />
      {styleDialogOpen ? (
        <StyleDialog
          overrides={document.presentation.styleOverrides}
          onApply={(styleOverrides) => {
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
          }}
          onClose={() => setStyleDialogOpen(false)}
        />
      ) : null}
      {publishGalleryOpen ? (
        <PublishGalleryDialog
          defaultName={project.name}
          session={publishSession}
          gateReport={publishGates}
          updateTarget={
            galleryEntryContext &&
            publishSession &&
            (publishSession.isAdmin ||
              publishSession.role === "moderator" ||
              (galleryEntryContext.ownerUserId !== null &&
                publishSession.id === galleryEntryContext.ownerUserId))
              ? { id: galleryEntryContext.id }
              : null
          }
          publish={(fields) => publishProjectToGallery(project, fields)}
          publishUpdate={
            galleryEntryContext
              ? (fields) =>
                  updateGalleryEntry(galleryEntryContext.id, project, fields)
              : undefined
          }
          onPublished={({ name, pending, updated }) => {
            setPublishGalleryOpen(false);
            setStatus(
              updated
                ? pending
                  ? `Submitted the update to "${name}" for review`
                  : `Updated "${name}" in the gallery`
                : pending
                  ? `Submitted "${name}" for review`
                  : `Published "${name}" to the gallery`,
            );
          }}
          onClose={() => setPublishGalleryOpen(false)}
        />
      ) : null}
      {publicAgentUiEnabled ? (
        <ConnectAgentPanel
          open={agentPanelOpen}
          status={agentSession.status}
          claimCode={agentSession.claimCode}
          claimExpiresAt={agentSession.claimExpiresAt}
          scopes={agentSession.scopes}
          expiresAt={agentSession.expiresAt}
          error={agentSession.error}
          now={Date.now()}
          onGrant={agentSession.grant}
          onPause={agentSession.pause}
          onResume={agentSession.resume}
          onReconnect={agentSession.reconnect}
          onNewConnection={agentSession.newConnection}
          onRevoke={agentSession.revoke}
          onClose={() => {
            setAgentPanelOpen(false);
          }}
        />
      ) : null}
      {publicAgentUiEnabled && agentFileCandidate ? (
        <div className="agent-panel" data-testid="agent-file-approval">
          <section
            className="agent-dialog"
            role="dialog"
            aria-label="Approve Agent file import"
          >
            <div className="agent-panel-header">
              <h2>Approve Agent file import</h2>
            </div>
            <p>
              The Agent staged a {agentFileCandidate.kind} candidate. It has not
              changed this Project. Replacing it will end the current Agent
              session.
            </p>
            <dl className="agent-file-candidate-summary">
              <div>
                <dt>Project</dt>
                <dd>{agentFileCandidate.projectName}</dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>{agentFileCandidate.documentCount}</dd>
              </div>
              <div>
                <dt>Instances</dt>
                <dd>{agentFileCandidate.instanceCount}</dd>
              </div>
            </dl>
            {agentFileCandidate.diagnostics.length > 0 ? (
              <ul className="agent-panel-audit">
                {agentFileCandidate.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.severity}-${index}`}>
                    <span>{diagnostic.severity}</span>
                    <span>{diagnostic.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="agent-panel-controls">
              <button
                type="button"
                data-testid="agent-file-reject"
                onClick={rejectAgentFileCandidate}
              >
                Reject
              </button>
              <button
                type="button"
                data-testid="agent-file-approve"
                onClick={approveAgentFileCandidate}
              >
                Replace Project
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <div
        className={
          visibleLibraryPanelOpen
            ? "app-workspace"
            : "app-workspace library-collapsed"
        }
        style={{ "--icm-shapes-width": `${libraryWidth}px` } as CSSProperties}
      >
        <aside className="tool-rail" aria-label="Tool rail">
          <button
            type="button"
            className="tool-rail-button examples-toggle"
            title={
              leftPanelMode === "examples" && visibleLibraryPanelOpen
                ? "Hide circuit examples"
                : "Show circuit examples"
            }
            aria-pressed={
              leftPanelMode === "examples" && visibleLibraryPanelOpen
            }
            aria-controls="examples-panel"
            aria-expanded={
              leftPanelMode === "examples" && visibleLibraryPanelOpen
            }
            data-testid="examples-toggle"
            onClick={toggleExamplesPanel}
          >
            <ToolIcon name="examples" />
            <span>Examples</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            title={
              visibleLibraryPanelOpen
                ? "Hide component library"
                : "Show component library"
            }
            aria-pressed={visibleLibraryPanelOpen}
            aria-controls="shapes-library-panel"
            aria-expanded={visibleLibraryPanelOpen}
            data-testid="library-toggle"
            onClick={toggleLibraryPanel}
          >
            <ToolIcon name="library" />
            <span>Library</span>
          </button>
        </aside>
        {leftPanelMode === "library" ? (
          <ShapesPanel
            styleProfileId={document.presentation.styleProfileId}
            open={visibleLibraryPanelOpen}
            onStartInsert={startInsertFromHook}
          />
        ) : (
          <ExamplesPanel
            open={visibleLibraryPanelOpen}
            onOpenExample={openLibraryExample}
            userExamples={userExamples}
            onOpenUserExample={(id) => void openUserExample(id)}
            onExportUserExample={(id) => void exportUserExample(id)}
            onDeleteUserExample={(id) => void deleteUserExample(id)}
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
        <aside
          className={selectionOpen ? "selection-dock open" : "selection-dock"}
          aria-label="Properties"
          role="complementary"
        >
          <section className="selection-shelf" aria-label="Selection">
            <button
              type="button"
              ref={selectionShelfRef}
              className="selection-shelf-header"
              data-testid="selection-shelf"
              aria-expanded={selectionOpen}
              onClick={() => {
                if (selectionOpen) exitCellSymbolLayout();
                setSelectionOpen((current) => !current);
                if (selectionOpen) setImportReviewOpen(false);
              }}
            >
              <span className="selection-shelf-title">
                <ToolIcon name="inspect" />
                <span>Properties</span>
                {publicAgentUiEnabled &&
                agentSession.status !== "idle" &&
                !agentStatusDismissed ? (
                  <span
                    className={`agent-shelf-indicator ${
                      agentSession.status === "revoked" ||
                      agentSession.status === "expired"
                        ? "terminal"
                        : ""
                    }`}
                    title={`Agent: ${agentSession.status}`}
                    aria-label={`Agent: ${agentSession.status}`}
                  />
                ) : null}
              </span>
              <span className="selection-shelf-summary">
                {selectionShelfSummary}
                {hasInspectableSelection ? (
                  <span
                    className="selection-shelf-indicator"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </button>
            <div className="selection-panel" hidden={!selectionOpen}>
              {selectedInstance && selectedBulkResolution ? (
                <section
                  className="context-actions"
                  aria-label="MOS bulk connection"
                >
                  <h2>Bulk</h2>
                  <button
                    type="button"
                    className="bulk-draw-action"
                    data-testid="draw-bulk-connection"
                    onClick={drawSelectedMosBulk}
                  >
                    Draw bulk connection
                  </button>
                  <p>
                    {selectedInstance.id}.B →{" "}
                    {selectedBulkResolution.net
                      ? (selectedBulkResolution.net.name ??
                        selectedBulkResolution.net.id)
                      : "unresolved"}
                    {" · "}
                    {selectedBulkResolution.status}
                  </p>
                  {selectedHiddenBulkNet ? (
                    <p>Explicit bulk is shown with a Razavi dashed route.</p>
                  ) : null}
                  <label>
                    Default NMOS bulk Net
                    <select
                      aria-label="Default NMOS bulk Net"
                      value={document.mosBulkDefaults?.nmosNetId ?? ""}
                      onChange={(event) =>
                        updateMosBulkDefault(
                          "nmos",
                          event.currentTarget.value || null,
                        )
                      }
                    >
                      <option value="">None</option>
                      {document.nets.map((net) => (
                        <option key={net.id} value={net.id}>
                          {net.name ?? net.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Default PMOS bulk Net
                    <select
                      aria-label="Default PMOS bulk Net"
                      value={document.mosBulkDefaults?.pmosNetId ?? ""}
                      onChange={(event) =>
                        updateMosBulkDefault(
                          "pmos",
                          event.currentTarget.value || null,
                        )
                      }
                    >
                      <option value="">None</option>
                      {document.nets.map((net) => (
                        <option key={net.id} value={net.id}>
                          {net.name ?? net.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ) : null}
              {flightlines.length > 0 ? (
                <section
                  className="context-actions"
                  aria-label="Routing guidance"
                >
                  <h2>Imported routing guidance</h2>
                  <div className="component-mirror-row">
                    {(
                      [
                        ["focused", "Focused"],
                        ["all", "All"],
                        ["hidden", "Hide"],
                      ] as const
                    ).map(([view, label]) => (
                      <button
                        type="button"
                        aria-pressed={routingGuidanceView === view}
                        key={view}
                        onClick={() => setRoutingGuidanceView(view)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <small>
                    {displayedFlightlines.length} shown / {flightlines.length}{" "}
                    derived. Guidance exists only for imported Nets.
                  </small>
                </section>
              ) : null}
              {!hasInspectableSelection ? (
                <p className="inspect-empty">Select an object to inspect.</p>
              ) : null}
              {selectedIds.length > 1 ? (
                <section
                  className="property-section"
                  aria-label="Group display toggles"
                >
                  <div className="property-section-heading">Canvas labels</div>
                  <div className="display-toggle-row">
                    <DisplayToggle
                      label="Reference"
                      checked={selectedGroupLabelsAllVisible}
                      onChange={(checked) =>
                        setReferenceLabelsVisible(selectedIds, checked)
                      }
                    />
                    <DisplayToggle
                      label="Value"
                      checked={selectedGroupValuesAllVisible}
                      disabled={!selectedGroupValueAvailable}
                      help={
                        selectedGroupValueAvailable
                          ? undefined
                          : "Fill device parameters first"
                      }
                      onChange={(checked) =>
                        setValueLabelsVisible(selectedIds, checked)
                      }
                    />
                  </div>
                </section>
              ) : null}
              {selectedInstance ? (
                <section
                  className="property-section component-properties"
                  aria-label="Component properties"
                >
                  {selectedFormalTerminal ? (
                    <div
                      className="formal-port-properties"
                      aria-label="Cell Port properties"
                    >
                      <label>
                        <span>Terminal name</span>
                        <input
                          key={`${selectedFormalTerminal.id}-${document.revision}-terminal-name`}
                          aria-label="Cell Port terminal name"
                          defaultValue={selectedFormalTerminal.name}
                          onBlur={(event) =>
                            renameSelectedFormalPort(event.currentTarget.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Direction</span>
                        <select
                          aria-label="Cell Port direction"
                          value={selectedFormalTerminal.direction}
                          onChange={(event) =>
                            updateCellPortDirection(
                              selectedFormalTerminal.id,
                              event.currentTarget
                                .value as typeof selectedFormalTerminal.direction,
                            )
                          }
                        >
                          <option value="input">Input</option>
                          <option value="output">Output</option>
                          <option value="inout">Inout</option>
                          <option value="passive">Passive</option>
                        </select>
                      </label>
                      <small>
                        This Port defines the Cell interface and every parent
                        symbol automatically.
                      </small>
                    </div>
                  ) : null}
                  {selectedHierarchyCell ? (
                    <div
                      className="cell-symbol-layout-properties"
                      aria-label="Cell symbol layout"
                    >
                      <div className="property-section-heading">
                        Cell symbol layout
                      </div>
                      <small>
                        Editing <strong>{selectedHierarchyCell.name}</strong>.
                        These definition-level changes apply to every parent
                        instance; connected routes follow the moved pin.
                      </small>
                      <button
                        type="button"
                        className="cell-symbol-layout-toggle"
                        aria-pressed={cellSymbolLayoutEnabled}
                        onClick={toggleCellSymbolLayout}
                      >
                        {cellSymbolLayoutEnabled
                          ? "Done editing canvas layout"
                          : "Edit symbol layout on canvas"}
                      </button>
                      {cellSymbolLayoutEnabled ? (
                        <small>
                          Drag the corner to resize, or a pin dot to change its
                          side and offset.
                        </small>
                      ) : null}
                      <div className="component-geometry-row">
                        <label>
                          Width
                          <input
                            key={`${selectedHierarchyCell.id}-${selectedHierarchyCell.revision}-symbol-width`}
                            aria-label="Cell symbol width"
                            defaultValue={String(
                              selectedHierarchyCell.presentation.cellSymbol
                                ?.minimumBodySize?.width ?? 100,
                            )}
                            inputMode="numeric"
                            onBlur={(event) =>
                              setCellSymbolBodySize(
                                selectedHierarchyCell,
                                Number(event.currentTarget.value),
                                selectedHierarchyCell.presentation.cellSymbol
                                  ?.minimumBodySize?.height ?? 60,
                              )
                            }
                          />
                        </label>
                        <label>
                          Height
                          <input
                            key={`${selectedHierarchyCell.id}-${selectedHierarchyCell.revision}-symbol-height`}
                            aria-label="Cell symbol height"
                            defaultValue={String(
                              selectedHierarchyCell.presentation.cellSymbol
                                ?.minimumBodySize?.height ?? 60,
                            )}
                            inputMode="numeric"
                            onBlur={(event) =>
                              setCellSymbolBodySize(
                                selectedHierarchyCell,
                                selectedHierarchyCell.presentation.cellSymbol
                                  ?.minimumBodySize?.width ?? 100,
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                      </div>
                      {selectedHierarchyCell.netlist?.terminals.map(
                        (terminal) => {
                          const pinPlacement =
                            selectedHierarchyCell.presentation.cellSymbol?.pinPlacements?.find(
                              (placement) =>
                                placement.terminalId === terminal.id,
                            );
                          return (
                            <div
                              key={terminal.id}
                              className="cell-symbol-pin-layout-row"
                            >
                              <strong>{terminal.name}</strong>
                              <label>
                                Side
                                <select
                                  key={`${selectedHierarchyCell.revision}-${terminal.id}-side`}
                                  aria-label={`Cell symbol ${terminal.name} pin side`}
                                  defaultValue={pinPlacement?.side ?? "auto"}
                                  onChange={(event) =>
                                    setCellSymbolPortPlacement(
                                      selectedHierarchyCell,
                                      terminal.id,
                                      event.currentTarget.value as
                                        | "north"
                                        | "east"
                                        | "south"
                                        | "west"
                                        | "auto",
                                      pinPlacement?.offset ?? 0,
                                    )
                                  }
                                >
                                  <option value="auto">Auto</option>
                                  <option value="west">Left</option>
                                  <option value="east">Right</option>
                                  <option value="north">Top</option>
                                  <option value="south">Bottom</option>
                                </select>
                              </label>
                              <label>
                                Offset
                                <input
                                  key={`${selectedHierarchyCell.revision}-${terminal.id}-offset`}
                                  aria-label={`Cell symbol ${terminal.name} pin offset`}
                                  defaultValue={String(
                                    pinPlacement?.offset ?? 0,
                                  )}
                                  inputMode="numeric"
                                  onBlur={(event) =>
                                    setCellSymbolPortPlacement(
                                      selectedHierarchyCell,
                                      terminal.id,
                                      pinPlacement?.side ?? "auto",
                                      Number(event.currentTarget.value),
                                    )
                                  }
                                />
                              </label>
                            </div>
                          );
                        },
                      )}
                    </div>
                  ) : null}
                  <div
                    className="property-card property-identity-card"
                    aria-label="Component identity"
                  >
                    <div className="property-section-heading">Identity</div>
                    <dl className="component-readonly-fields">
                      {selectedPortNet && !selectedFormalTerminal ? (
                        <div>
                          <dt>Net name</dt>
                          <dd>
                            <input
                              key={`${selectedPortNet.id}-${document.revision}-net-port-name`}
                              aria-label="Net Port name"
                              defaultValue={selectedPortNet.name ?? ""}
                              onBlur={(event) =>
                                renameSelectedNetPort(event.currentTarget.value)
                              }
                            />
                          </dd>
                        </div>
                      ) : !selectedFormalTerminal ? (
                        <div>
                          <dt>Schematic label</dt>
                          <dd>
                            <input
                              key={`${selectedInstance.id}-${document.revision}-schematic-label`}
                              aria-label="Component schematic label"
                              defaultValue={flattenRichText(
                                selectedInstance.schematicName ??
                                  defaultDraftTextDocument(
                                    selectedInstance.schematicReference ??
                                      selectedInstance.netlist?.reference ??
                                      "",
                                  ),
                              )}
                              placeholder="Schematic label"
                              onBlur={(event) =>
                                updateSelectedSchematicName(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </dd>
                        </div>
                      ) : null}
                      {selectedInstance.netlist ? (
                        <div>
                          <dt>Netlist reference</dt>
                          <dd>
                            <input
                              key={`${selectedInstance.id}-${document.revision}-netlist-reference`}
                              aria-label="Component netlist reference"
                              defaultValue={selectedInstance.netlist.reference}
                              onBlur={(event) =>
                                updateSelectedReference(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Symbol</dt>
                        <dd>{selectedInstance.symbolId}</dd>
                      </div>
                      <div>
                        <dt>Device class</dt>
                        <dd>{selectedPropertyDevice?.deviceClass ?? "none"}</dd>
                      </div>
                      <div>
                        <dt>Cell</dt>
                        <dd>{document.netlist?.name ?? document.name}</dd>
                      </div>
                    </dl>
                  </div>
                  {selectedCapacitorPlateRows ? (
                    <div
                      className="property-card property-terminal-card"
                      role="group"
                      aria-label="Capacitor plate terminals"
                    >
                      <div className="property-section-heading">
                        Electrical terminals
                      </div>
                      <dl className="component-readonly-fields">
                        {selectedCapacitorPlateRows.map((row) => (
                          <div key={row.role}>
                            <dt>{row.label}</dt>
                            <dd aria-label={`${row.label} terminal`}>
                              Pin {row.pinName} ·{" "}
                              {row.netName ?? row.netId ?? "Unconnected"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <small>
                        Plate roles are defined by the device. Change their Net
                        connections through wiring or orientation, not by
                        renaming the roles.
                      </small>
                    </div>
                  ) : null}
                  {selectedInstance.netlist ? (
                    <div
                      className="property-card property-target-card"
                      aria-label="Netlist target"
                    >
                      <div className="property-section-heading">
                        Netlist target
                      </div>
                      {selectedInstance.netlist.binding?.kind === "model" ||
                      selectedDevice?.targetPolicy === "required-model" ||
                      selectedExternalMosMapping ? (
                        <label>
                          Model
                          <input
                            key={`${selectedInstance.id}-${document.revision}-model-target`}
                            aria-label="Component model target"
                            list={
                              selectedPropertyDevice?.symbolId === "nmos" ||
                              selectedPropertyDevice?.symbolId === "pmos"
                                ? `mos-model-options-${selectedPropertyDevice.symbolId}`
                                : undefined
                            }
                            defaultValue={
                              selectedInstance.netlist.binding?.kind === "model"
                                ? selectedInstance.netlist.binding.name
                                : selectedExternalMosMapping
                                  ? selectedExternalSubcircuit?.name
                                  : ""
                            }
                            placeholder="Model name"
                            onBlur={(event) =>
                              updateSelectedModelTarget(
                                event.currentTarget.value,
                              )
                            }
                          />
                          {selectedPropertyDevice?.symbolId === "nmos" ||
                          selectedPropertyDevice?.symbolId === "pmos" ? (
                            <datalist
                              id={`mos-model-options-${selectedPropertyDevice.symbolId}`}
                            >
                              {reviewedSky130MosModelSuggestions(
                                selectedPropertyDevice.symbolId,
                              ).map((model) => (
                                <option value={model} key={model} />
                              ))}
                            </datalist>
                          ) : null}
                          {selectedExternalMosMapping ? (
                            <small>External subcircuit · X reference</small>
                          ) : null}
                        </label>
                      ) : selectedInstance.netlist.binding?.kind ===
                        "primitive" ? (
                        <small>
                          Built-in primitive:{" "}
                          {selectedInstance.netlist.binding.deviceClass}
                        </small>
                      ) : selectedInstance.netlist.binding?.kind ===
                        "subcircuit" ? (
                        <small>
                          Internal Cell:{" "}
                          {selectedHierarchyCell?.netlist?.name ?? "unresolved"}
                        </small>
                      ) : selectedInstance.netlist.binding?.kind ===
                        "external-subcircuit" ? (
                        <small>
                          External subcircuit:{" "}
                          {selectedExternalSubcircuit?.name ?? "unresolved"}
                        </small>
                      ) : selectedInstance.netlist.binding?.kind ===
                        "unresolved-subcircuit" ? (
                        <small>
                          Unresolved subcircuit:{" "}
                          {selectedInstance.netlist.binding.name}
                        </small>
                      ) : (
                        <small>No target is bound yet.</small>
                      )}
                    </div>
                  ) : null}
                  <div className="property-card property-parameters-card">
                    <div className="property-section-heading">Parameters</div>
                    <div className="component-parameter-grid">
                      {propertyParametersForInstance(selectedInstance).map(
                        (parameter, index) => (
                          <label key={parameter.key} title={parameter.help}>
                            <span className="property-parameter-name">
                              {parameter.label}
                              {parameter.unit ? ` / ${parameter.unit}` : ""}
                              <em>({parameter.help})</em>
                            </span>
                            <input
                              ref={
                                index === 0 ? instanceValueInputRef : undefined
                              }
                              aria-label={`Component ${parameter.label.toLowerCase()}`}
                              inputMode={parameter.inputMode}
                              value={
                                instancePropertyDraft.parameters[
                                  parameter.key
                                ] ?? ""
                              }
                              placeholder={parameter.placeholder}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                updateInstancePropertyDraft((current) => ({
                                  ...current,
                                  parameters: {
                                    ...current.parameters,
                                    [parameter.key]: value,
                                  },
                                }));
                              }}
                            />
                          </label>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="property-card property-display-card">
                    <div className="property-section-heading">Display</div>
                    <div
                      className="display-toggle-row"
                      aria-label="Component display toggles"
                    >
                      <DisplayToggle
                        label={
                          selectedInstance.symbolId === "port" ||
                          selectedInstance.symbolId === "port-filled"
                            ? "Port label"
                            : "Reference"
                        }
                        checked={
                          selectedInstanceLabel !== undefined &&
                          selectedInstanceLabel.visible !== false
                        }
                        onChange={(checked) =>
                          setReferenceLabelsVisible(
                            [selectedInstance.id],
                            checked,
                          )
                        }
                      />
                      <DisplayToggle
                        label="Value"
                        checked={
                          selectedInstanceValue !== null &&
                          selectedInstanceValue.visible !== false
                        }
                        disabled={!selectedInstanceValueAvailable}
                        help={
                          selectedInstanceValueAvailable
                            ? undefined
                            : "Set the device parameters first"
                        }
                        onChange={(checked) => {
                          if (checked) {
                            showSelectedInstanceValue();
                          } else {
                            setValueLabelsVisible([selectedInstance.id], false);
                          }
                        }}
                      />
                    </div>
                  </div>
                  {selectedInstance.netlist ? (
                    <details className="property-details">
                      <summary>
                        <span>Advanced parameters</span>
                        <small>{additionalParameterDraft.length}</small>
                      </summary>
                      <div
                        className="additional-parameters"
                        aria-label="Additional parameters"
                      >
                        <small>
                          Model- or dialect-specific raw values. Apply commits
                          all rows as one undoable edit.
                        </small>
                        {additionalParameterDraft.map((parameter, index) => (
                          <div
                            className="component-geometry-row"
                            key={parameter.id}
                          >
                            <label>
                              Name
                              <input
                                aria-label={`Additional parameter name ${index + 1}`}
                                value={parameter.name}
                                onChange={(event) =>
                                  updateAdditionalParameter(parameter.id, {
                                    name: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Value
                              <input
                                aria-label={`Additional parameter value ${index + 1}`}
                                value={parameter.value}
                                onChange={(event) =>
                                  updateAdditionalParameter(parameter.id, {
                                    value: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              aria-label={`Remove additional parameter ${index + 1}`}
                              onClick={() =>
                                removeAdditionalParameter(parameter.id)
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="component-mirror-row">
                          <button
                            type="button"
                            onClick={addAdditionalParameter}
                          >
                            Add parameter
                          </button>
                          {additionalParameterDraftChanges ? (
                            <>
                              <button
                                type="button"
                                onClick={applyAdditionalParameters}
                              >
                                Apply parameters
                              </button>
                              <button
                                type="button"
                                onClick={cancelAdditionalParameters}
                              >
                                Cancel parameter edits
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  ) : null}
                  {selectedInstance.importProvenance ? (
                    <div
                      className="property-card"
                      aria-label="Imported source evidence"
                    >
                      <div className="property-section-heading">
                        Imported source evidence
                      </div>
                      <small>
                        {selectedInstance.importProvenance.kind}:{" "}
                        {selectedInstance.importProvenance.sourceTarget}
                      </small>
                    </div>
                  ) : null}
                  {selectedInstance.placement ? (
                    <div className="property-card property-placement-card">
                      <div className="property-section-heading">Placement</div>
                      <div
                        className="component-geometry-row"
                        aria-label="Component geometry"
                      >
                        <label>
                          X
                          <input
                            aria-label="Component X position"
                            inputMode="decimal"
                            value={instancePropertyDraft.x}
                            onChange={(event) => {
                              const x = event.currentTarget.value;
                              updateInstancePropertyDraft((current) => ({
                                ...current,
                                x,
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Y
                          <input
                            aria-label="Component Y position"
                            inputMode="decimal"
                            value={instancePropertyDraft.y}
                            onChange={(event) => {
                              const y = event.currentTarget.value;
                              updateInstancePropertyDraft((current) => ({
                                ...current,
                                y,
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Rotate
                          <select
                            aria-label="Component rotation"
                            value={instancePropertyDraft.rotation}
                            onChange={(event) => {
                              const rotation = event.currentTarget.value as
                                "0" | "90" | "180" | "270";
                              updateInstancePropertyDraft((current) => ({
                                ...current,
                                rotation,
                              }));
                            }}
                          >
                            <option value="0">0°</option>
                            <option value="90">90°</option>
                            <option value="180">180°</option>
                            <option value="270">270°</option>
                          </select>
                        </label>
                      </div>
                      <div
                        className="component-mirror-row"
                        aria-label="Mirror component"
                      >
                        <button
                          type="button"
                          aria-label="Mirror component left to right, Shift+R"
                          title="Mirror left/right (Shift+R)"
                          onClick={() => mirrorSelected("left-right")}
                        >
                          Mirror left/right
                        </button>
                        <button
                          type="button"
                          aria-label="Mirror component top to bottom, Ctrl+R"
                          title="Mirror top/bottom (Ctrl+R)"
                          onClick={() => mirrorSelected("top-bottom")}
                        >
                          Mirror top/bottom
                        </button>
                        {differentialOutputSibling(
                          selectedInstance.symbolId,
                        ) ? (
                          <button
                            type="button"
                            data-testid="swap-differential-outputs"
                            aria-label="Swap the + and - outputs"
                            title="Swap the + and - outputs"
                            onClick={() =>
                              transact(
                                planDifferentialOutputSwap(
                                  selectedInstance.id,
                                  selectedInstance.symbolId,
                                ),
                              )
                            }
                          >
                            Swap + / − outputs
                          </button>
                        ) : null}
                        {selectedInstanceHasDifferentialInputs ? (
                          <button
                            type="button"
                            data-testid="swap-differential-inputs"
                            aria-label="Swap the + and - inputs"
                            title="Swap + / - inputs (Ctrl+R)"
                            onClick={() => mirrorSelected("top-bottom")}
                          >
                            Swap + / − inputs
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label="Return component to Placement Tray"
                          onClick={() =>
                            returnInstancesToTray([selectedInstance.id])
                          }
                        >
                          Return to tray
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {hasInstancePropertyDraftChanges ? (
                    <button
                      type="button"
                      className="property-discard"
                      onClick={discardInstancePropertyDraft}
                    >
                      Discard changes
                    </button>
                  ) : null}
                </section>
              ) : null}
              {selectedDrafting
                ? (() => {
                    const geometry = resolveDraftingObjectGeometry(
                      document,
                      resolver,
                      selectedDrafting,
                    );
                    if (
                      geometry.kind !== "arrow" &&
                      geometry.kind !== "construction-line" &&
                      geometry.kind !== "rectangle"
                    ) {
                      return null;
                    }
                    const lineStyle =
                      selectedDrafting.styleOverride?.lineStyle ??
                      (selectedDrafting.kind === "construction-line" ||
                      selectedDrafting.kind === "rectangle"
                        ? selectedDrafting.lineStyle
                        : "solid");
                    const isRectangle = geometry.kind === "rectangle";
                    const points = isRectangle
                      ? geometry.corners
                      : geometry.points;
                    const curveControls = isRectangle
                      ? points.slice(0, -1).map(() => null)
                      : geometry.curveControls;
                    const segmentIndex =
                      draftingInspectorSegment?.objectId === selectedDrafting.id
                        ? draftingInspectorSegment.index
                        : Math.max(0, curveControls.findIndex(Boolean));
                    const tangentAngle = isRectangle
                      ? 0
                      : quadraticTangentAngle(
                          points[segmentIndex]!,
                          curveControls[segmentIndex] ?? null,
                          points[segmentIndex + 1]!,
                        );
                    const tangentInputKey = `${selectedDrafting.id}:${segmentIndex}`;
                    const realizedAngleText = String(
                      Math.round(tangentAngle * 10) / 10,
                    );
                    const tangentInputValue =
                      draftingTangentInput?.key === tangentInputKey
                        ? draftingTangentInput.value
                        : realizedAngleText;
                    const bearing = isRectangle
                      ? geometry.rotation
                      : normalizedBearing(points[0]!, points[1]!);
                    const realizedBearingText = String(
                      Math.round(bearing * 10) / 10,
                    );
                    const bearingInputValue =
                      draftingBearingInput?.objectId === selectedDrafting.id
                        ? draftingBearingInput.value
                        : realizedBearingText;
                    return (
                      <section
                        className="context-actions drawing-properties"
                        aria-label="Drawing style"
                        data-testid="drafting-properties"
                      >
                        <h2>Drawing style</h2>
                        <label>
                          Line style
                          <select
                            aria-label="Line style"
                            value={lineStyle}
                            disabled={selectedDrafting.locked}
                            onChange={(event) =>
                              setDraftingStyle({
                                lineStyle: event.currentTarget.value as
                                  "solid" | "dashed" | "dotted",
                              })
                            }
                          >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                          </select>
                        </label>
                        <label>
                          Stroke width
                          <select
                            aria-label="Stroke width"
                            value={String(
                              selectedDrafting.styleOverride?.strokeScale ?? 1,
                            )}
                            disabled={selectedDrafting.locked}
                            onChange={(event) =>
                              setDraftingStyle({
                                strokeScale: Number(
                                  event.currentTarget.value,
                                ) as 0.75 | 1 | 1.5 | 2,
                              })
                            }
                          >
                            <option value="0.75">0.75×</option>
                            <option value="1">1×</option>
                            <option value="1.5">1.5×</option>
                            <option value="2">2×</option>
                          </select>
                        </label>
                        {selectedDrafting.kind === "construction-line" &&
                        points.length > 2 ? (
                          <label>
                            Curve segment
                            <select
                              aria-label="Curve segment"
                              value={String(segmentIndex)}
                              disabled={selectedDrafting.locked}
                              onChange={(event) => {
                                setDraftingInspectorSegment({
                                  objectId: selectedDrafting.id,
                                  index: Number(event.currentTarget.value),
                                });
                                setDraftingTangentInput(null);
                              }}
                            >
                              {points.slice(0, -1).map((_, index) => (
                                <option key={index} value={index}>
                                  Segment {index + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {!isRectangle ? (
                          <label>
                            Tangent angle (°)
                            <input
                              aria-label="Tangent angle"
                              type="number"
                              min="0"
                              max="170"
                              step="1"
                              value={tangentInputValue}
                              disabled={selectedDrafting.locked}
                              placeholder={realizedAngleText}
                              onFocus={() => {
                                setDraftingTangentInput({
                                  key: tangentInputKey,
                                  value: "",
                                });
                              }}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setDraftingTangentInput({
                                  key: tangentInputKey,
                                  value,
                                });
                                const angle = Number(value);
                                if (value !== "" && Number.isFinite(angle)) {
                                  setDraftingTangentAngle(angle);
                                }
                              }}
                              onBlur={() => setDraftingTangentInput(null)}
                            />
                          </label>
                        ) : null}
                        <label>
                          Bearing (°)
                          <input
                            aria-label="Drawing bearing"
                            type="number"
                            min="0"
                            max="359"
                            step="1"
                            value={bearingInputValue}
                            disabled={selectedDrafting.locked}
                            placeholder={realizedBearingText}
                            onFocus={() =>
                              setDraftingBearingInput({
                                objectId: selectedDrafting.id,
                                value: "",
                              })
                            }
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setDraftingBearingInput({
                                objectId: selectedDrafting.id,
                                value,
                              });
                              const bearing = Number(value);
                              if (value !== "" && Number.isFinite(bearing)) {
                                setDraftingBearing(bearing);
                              }
                            }}
                            onBlur={() => setDraftingBearingInput(null)}
                          />
                        </label>
                        {selectedDrafting.kind === "arrow" ? (
                          <>
                            <label>
                              Arrow head
                              <select
                                aria-label="Arrow head"
                                value={
                                  selectedDrafting.styleOverride?.arrowHead ??
                                  "filled"
                                }
                                disabled={selectedDrafting.locked}
                                onChange={(event) =>
                                  setDraftingStyle({
                                    arrowHead: event.currentTarget.value as
                                      "none" | "filled" | "open",
                                  })
                                }
                              >
                                <option value="none">No head</option>
                                <option value="filled">Filled</option>
                                <option value="open">Open</option>
                              </select>
                            </label>
                            <label>
                              Arrow head size
                              <select
                                aria-label="Arrow head size"
                                value={String(
                                  selectedDrafting.styleOverride
                                    ?.arrowHeadScale ?? 1,
                                )}
                                disabled={selectedDrafting.locked}
                                onChange={(event) =>
                                  setDraftingStyle({
                                    arrowHeadScale: Number(
                                      event.currentTarget.value,
                                    ) as 0.75 | 1 | 1.25 | 1.5,
                                  })
                                }
                              >
                                <option value="0.75">0.75×</option>
                                <option value="1">1×</option>
                                <option value="1.25">1.25×</option>
                                <option value="1.5">1.5×</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={selectedDrafting.locked}
                              onClick={() => {
                                const { from, to } = selectedDrafting;
                                transact([
                                  {
                                    kind: "upsert_drafting_object",
                                    object: {
                                      ...selectedDrafting,
                                      from: to,
                                      to: from,
                                      waypoints: [
                                        ...(selectedDrafting.waypoints ?? []),
                                      ].reverse(),
                                      curveControls: [
                                        ...(selectedDrafting.curveControls ??
                                          []),
                                      ].reverse(),
                                    },
                                  },
                                ]);
                              }}
                            >
                              Reverse
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          disabled={selectedDrafting.locked}
                          onClick={() => rotateSelected()}
                        >
                          <ToolIcon name="rotate" />
                          Rotate
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDraftingLock(selectedDrafting)}
                        >
                          <ToolIcon name="lock" />
                          {selectedDrafting.locked ? "Unlock" : "Lock"}
                        </button>
                      </section>
                    );
                  })()
                : null}
              <section
                className="context-actions placement-tray"
                aria-label="Placement Tray"
              >
                <h2>Placement Tray</h2>
                <p>
                  {unplaced.length} retained · drag to the canvas, choose Place,
                  or arrange every retained Instance in a starter grid.
                </p>
                <div className="component-mirror-row">
                  <button
                    type="button"
                    onClick={placeAllFromTray}
                    disabled={unplaced.length === 0}
                  >
                    Place all
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      returnInstancesToTray(
                        returnablePlacedInstances.map(
                          (instance) => instance.id,
                        ),
                      )
                    }
                    disabled={returnablePlacedInstances.length === 0}
                  >
                    Return all
                  </button>
                </div>
                {unplaced.length === 0 ? (
                  <small>No retained Instances.</small>
                ) : (
                  <div className="placement-tray-list">
                    {unplaced.map((instance) => (
                      <div
                        className="placement-tray-entry"
                        draggable
                        data-testid={`unplaced-${instance.id}`}
                        key={instance.id}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "application/x-icm-instance",
                            instance.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            selectOnly("instance", [instance.id]);
                            setStatus(
                              `Selected ${placementTrayIdentity(instance)}`,
                            );
                          }}
                        >
                          {placementTrayIdentity(instance)}
                        </button>
                        <button
                          type="button"
                          aria-label={`Place ${placementTrayIdentity(instance)} from tray`}
                          onClick={() =>
                            beginRetainedInstancePlacementFromHook(instance.id)
                          }
                        >
                          Place…
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {selectedRouteId ? (
                <section className="context-actions" aria-label="Route actions">
                  <h2>Electrical route</h2>
                  <label>
                    Electrical Net label
                    <input
                      ref={netLabelPropertyInputRef}
                      aria-label="Electrical Net label"
                      value={netLabelDraft}
                      onChange={(event) =>
                        updateNetLabelDraft(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button type="button" onClick={deleteSelectedRouteNetLabel}>
                    Delete Net label
                  </button>
                  <button type="button" onClick={addCurrentArrow}>
                    Add current arrow
                  </button>
                  <button
                    type="button"
                    onClick={() => editSelectedRouteJog("insert")}
                  >
                    Add wire jog
                  </button>
                  <button
                    type="button"
                    onClick={() => editSelectedRouteJog("remove")}
                  >
                    Straighten selected jog
                  </button>
                  <button type="button" onClick={toggleHighlightedNet}>
                    {selectedHighlightIsActive
                      ? "Clear Net highlight (H)"
                      : "Highlight Net (H)"}
                  </button>
                  <button type="button" onClick={deleteSelectedRouteConnection}>
                    Delete wire
                  </button>
                </section>
              ) : null}
              {selectedEndpoint &&
              selectedEndpoint.endpoint.kind !== "junction" ? (
                <section
                  className="context-actions"
                  aria-label="Endpoint actions"
                >
                  <h2>Endpoint</h2>
                  <button
                    type="button"
                    onClick={() => disconnectSelectedEndpoint(false)}
                  >
                    Disconnect endpoint
                  </button>
                  <button
                    type="button"
                    onClick={() => disconnectSelectedEndpoint(true)}
                  >
                    Delete connection
                  </button>
                  <button
                    type="button"
                    onClick={toggleSelectedNoConnectFromSelection}
                    disabled={
                      !selectedNoConnect && selectedEndpointNetId !== null
                    }
                  >
                    {selectedNoConnect ? "Clear No Connect" : "Mark No Connect"}
                  </button>
                  {!selectedNoConnect && selectedEndpointNetId ? (
                    <small>
                      Disconnect this endpoint before marking No Connect.
                    </small>
                  ) : null}
                </section>
              ) : null}
              {selectedEndpoint?.endpoint.kind === "junction" ? (
                <section
                  className="context-actions"
                  aria-label="Junction actions"
                >
                  <h2>Junction</h2>
                  <button
                    type="button"
                    onClick={deleteSelectedJunctionFromSelection}
                  >
                    Delete junction and attached wires
                  </button>
                </section>
              ) : null}
              {selectedAnnotation && isRoutedMarker(selectedAnnotation) ? (
                <section
                  className="context-actions"
                  aria-label="Current arrow actions"
                >
                  <h2>Current arrow</h2>
                  <button type="button" onClick={reverseSelectedCurrentArrow}>
                    Reverse direction (X)
                  </button>
                  <small>Drag to slide along the wire or move its label.</small>
                  <button type="button" onClick={deleteSelectedAnnotation}>
                    Delete current arrow
                  </button>
                </section>
              ) : null}
              {selectedAnnotation &&
              !isRoutedMarker(selectedAnnotation) &&
              selectedNetLabelBinding ? (
                <section
                  className="context-actions"
                  aria-label="Annotation actions"
                >
                  <h2>Annotation</h2>
                  <button type="button" onClick={toggleHighlightedNet}>
                    {selectedHighlightIsActive
                      ? "Clear Net highlight (H)"
                      : "Highlight Net (H)"}
                  </button>
                </section>
              ) : null}
              <ProjectDiagnosticsSection
                snapshot={liveDiagnosticSnapshot}
                documentLabel={(documentId) =>
                  project.documents.find(
                    (candidate) => candidate.id === documentId,
                  )?.name ?? documentId
                }
                onSelectDiagnostic={jumpToProjectDiagnostic}
              />
              {highlightedTrace && highlightedTrace.hops.length > 0 ? (
                <NetTraceSection
                  trace={highlightedTrace}
                  documentLabel={(documentId) =>
                    project.documents.find(
                      (candidate) => candidate.id === documentId,
                    )?.name ?? documentId
                  }
                  onNavigateHop={navigateTraceHop}
                />
              ) : null}
              {importReviewOpen ? (
                <section className="import-review" aria-label="Import Review">
                  <h2>Import Review</h2>
                  <SelectionInspectorDetails
                    snapshot={{
                      selected:
                        selectedIds.length > 0
                          ? selectedIds.join(", ")
                          : (selectedRouteId ?? selectedAnnotationId ?? "None"),
                      internalRouteCount: internalSelection.routeIds.length,
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
                    }}
                    importReport={importReport}
                  />
                </section>
              ) : null}
              {publicAgentUiEnabled &&
              agentSession.status !== "idle" &&
              !agentStatusDismissed ? (
                <AgentPropertiesSection
                  status={agentSession.status}
                  claimCode={agentSession.claimCode}
                  claimExpiresAt={agentSession.claimExpiresAt}
                  scopes={agentSession.scopes}
                  expiresAt={agentSession.expiresAt}
                  error={agentSession.error}
                  onPause={agentSession.pause}
                  onResume={agentSession.resume}
                  onReconnect={agentSession.reconnect}
                  onNewConnection={agentSession.newConnection}
                  onRevoke={agentSession.revoke}
                  expanded={agentDetailsOpen}
                  onToggleDetails={() => setAgentDetailsOpen((open) => !open)}
                  onDismiss={() => {
                    setAgentDetailsOpen(false);
                    setAgentStatusDismissed(true);
                  }}
                />
              ) : null}
            </div>
          </section>
        </aside>
        <section className="canvas-panel">
          {canvasIsEmpty ? (
            <div
              className="canvas-empty-state"
              data-testid="canvas-empty-state"
            >
              <strong>Start a schematic</strong>
              <span>
                Press <kbd>I</kbd> to insert a component or <kbd>W</kbd> to
                wire.
              </span>
            </div>
          ) : null}
          <svg
            className={[
              "schematic-canvas",
              tool === "wire" ? "wire-mode" : "",
              pendingSymbolId || vddRailMode ? "component-mode" : "",
              tool === "arrow" ||
              tool === "construction-line" ||
              tool === "rectangle"
                ? "drawing-mode"
                : "",
              panPreview ? "pan-mode" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="schematic-canvas"
            role="img"
            aria-label="Schematic canvas"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onWheel={handleWheel}
            onClickCapture={(event) => {
              if (getCurrentInteractionState().kind === "moving-selection") {
                if (event.detail === 1) {
                  event.preventDefault();
                  event.stopPropagation();
                  commitCommandMoveFromSelection(
                    pointFromClient(
                      event.clientX,
                      event.clientY,
                      event.currentTarget,
                    ),
                    event.currentTarget,
                  );
                }
                return;
              }
              if (
                !vddRailMode &&
                (!pendingSymbolId || !pendingComponentPlacement)
              )
                return;
              if (event.detail > 1) return;
              event.stopPropagation();
              const rawPoint = pointFromClient(
                event.clientX,
                event.clientY,
                event.currentTarget,
              );
              commitPendingPlacementAtFromHook({
                x: snapCoordinate(rawPoint.x, document.presentation.grid),
                y: snapCoordinate(rawPoint.y, document.presentation.grid),
              });
            }}
            onPointerDownCapture={(event) => {
              const target = event.target as Element;
              if (target.closest('[data-testid="canvas-text-editor"]')) {
                // The SVG capture layer otherwise re-ranks the canvas below
                // this HTML editor through elementsFromPoint() before the
                // editor's own bubbling handlers can stop the event.
                return;
              }
              if (
                cellSymbolLayoutEnabled &&
                target.closest('[data-testid="cell-symbol-layout-overlay"]')
              ) {
                return;
              }
              if (cellSymbolLayoutEnabled) {
                // Layout grips are a short-lived edit mode. Any ordinary
                // canvas action leaves it first, so the next hit can use the
                // regular selection and movement rules.
                exitCellSymbolLayout();
              }
              if (getCurrentInteractionState().kind === "moving-selection") {
                event.stopPropagation();
                return;
              }
              if (
                selectedDrafting &&
                (selectedDrafting.kind === "arrow" ||
                  selectedDrafting.kind === "construction-line" ||
                  selectedDrafting.kind === "rectangle") &&
                !target.closest(
                  `[data-testid="drafting-hit-${selectedDrafting.id}"]`,
                ) &&
                !target.closest(
                  `[data-testid="drafting-handles-${selectedDrafting.id}"]`,
                )
              ) {
                replaceSelectionKind("drafting", []);
              }
              handleCanvasHitPointerDown(event);
            }}
            onPointerDown={beginCanvasGesture}
            onPointerMove={continueCanvasGesture}
            onPointerLeave={() => {
              if (pendingSymbolId) setComponentPreviewPoint(null);
              if (vddRailMode) setVddRailPreviewPoint(null);
              if (copyPlacement) setCopyPreviewPoint(null);
            }}
            onPointerUp={finishCanvasGesture}
            onPointerCancel={finishCanvasGesture}
            onClick={(event) => {
              if (copyPlacement) {
                if (event.detail > 1) return;
                const point = pointFromClient(
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                );
                commitCopyPlacementFromSelection({
                  x: snapCoordinate(point.x, document.presentation.grid),
                  y: snapCoordinate(point.y, document.presentation.grid),
                });
                return;
              }
              const target = event.target as Element;
              const onBackground =
                target === event.currentTarget || target.tagName === "rect";
              if (
                (tool === "arrow" ||
                  tool === "construction-line" ||
                  tool === "rectangle") &&
                event.detail === 1 &&
                onBackground
              ) {
                handleDraftingCanvasClick(
                  pointFromClient(
                    event.clientX,
                    event.clientY,
                    event.currentTarget,
                  ),
                  event.altKey,
                  event.shiftKey,
                  logicalRadiusForPixels(
                    event.currentTarget,
                    SNAP_CAPTURE_RADIUS_PX,
                  ),
                );
                return;
              }
              if (tool !== "wire" || event.detail !== 1) return;
              applyWireCanvasPoint(
                pointFromClient(
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                  false,
                ),
                event.currentTarget,
                event.altKey,
                false,
              );
            }}
            onDoubleClick={(event) => {
              const target = event.target as Element;
              if (tool === "pointer") {
                // Movement ranks electrical geometry before labels, but a
                // deliberate double-click is an editing request. Look through
                // the same point candidates for text instead of forcing users
                // to Alt-cycle a route-attached label before editing it.
                const pointHits = rankCanvasHits(
                  event.currentTarget.ownerDocument.elementsFromPoint(
                    event.clientX,
                    event.clientY,
                  ),
                );
                const annotationHit = pointHits.find(
                  (hit) => hit.kind === "annotation",
                );
                const annotation = annotationHit
                  ? document.annotations.find(
                      (candidate) => candidate.id === annotationHit.id,
                    )
                  : undefined;
                if (annotation) {
                  event.preventDefault();
                  event.stopPropagation();
                  canvasDragSessionRef.current?.cancel();
                  beginAnnotationTextEditing(annotation);
                  return;
                }
                // A double-click on empty space inside a drafting rectangle is
                // the same editing intent aimed at the box: open its centered
                // label, creating the anchored text on first use. Electrical
                // geometry under the pointer keeps its own double-click
                // meaning, so wires crossing a group frame never open a label.
                const electricalHit = pointHits.some(
                  (hit) =>
                    hit.kind !== "annotation" &&
                    hit.kind !== "instance-label" &&
                    hit.kind !== "drafting",
                );
                const interiorPoint = pointFromClient(
                  event.clientX,
                  event.clientY,
                  event.currentTarget,
                );
                const rectangle = electricalHit
                  ? null
                  : rectangleInteriorAt(document, resolver, interiorPoint);
                if (rectangle) {
                  event.preventDefault();
                  event.stopPropagation();
                  canvasDragSessionRef.current?.cancel();
                  const existingLabel = rectangleLabelFor(
                    document,
                    rectangle.id,
                  );
                  if (existingLabel) {
                    beginDraftingTextEditing(existingLabel);
                    return;
                  }
                  uniqueSuffixCounter.current += 1;
                  const label = proposeRectangleLabel(
                    rectangle,
                    `note-${uniqueSuffixCounter.current}`,
                  );
                  if (
                    transact([
                      { kind: "upsert_drafting_object", object: label },
                    ]).ok
                  ) {
                    beginDraftingTextEditing(label);
                    setStatus(`Editing label of ${rectangle.id}`);
                  }
                  return;
                }
              }
              if (
                tool === "arrow" ||
                tool === "construction-line" ||
                tool === "rectangle"
              ) {
                if (target !== event.currentTarget && target.tagName !== "rect")
                  return;
                finishDraftingCreate();
                return;
              }
              if (
                tool !== "wire" ||
                (target !== event.currentTarget && target.tagName !== "rect")
              )
                return;
              const point = pointFromClient(
                event.clientX,
                event.clientY,
                event.currentTarget,
                false,
              );
              const resolved = resolveWireCanvasSnap(
                point,
                event.currentTarget,
                event.altKey,
              );
              if (
                wireSource?.endpoint.kind === "junction" &&
                wireSource.preludeEdits.some(
                  (edit) => edit.kind === "add_junction" && edit.createNet,
                ) &&
                wireSource.point.x === resolved.point.x &&
                wireSource.point.y === resolved.point.y
              ) {
                setStatus("Choose a different point to finish the wire");
                return;
              }
              applyWireCanvasPoint(
                point,
                event.currentTarget,
                event.altKey,
                true,
              );
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (
                tool === "arrow" ||
                tool === "construction-line" ||
                tool === "rectangle"
              ) {
                if (draftingSource !== null) {
                  clearDraftingCreate();
                  setStatus("Drawing cancelled");
                }
                return;
              }
              if (tool === "wire") {
                setWireSource(null, null);
                setWirePreviewPoint(null);
                setWireDraftSteps([]);
                setTool("pointer");
                setBulkDrawInstanceId(null);
                setStatus("Wire cancelled");
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {gridDotsVisible ? (
              <>
                <defs>
                  <pattern
                    id="grid"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle className="canvas-grid-dot" cx="0" cy="0" r="0.7" />
                  </pattern>
                </defs>
                <rect
                  data-testid="canvas-grid-dots"
                  x={viewBox.x}
                  y={viewBox.y}
                  width={viewBox.width}
                  height={viewBox.height}
                  fill="url(#grid)"
                />
              </>
            ) : null}
            <g dangerouslySetInnerHTML={sceneInnerHtml} />
            {selectedCellSymbolLayout
              ? (() => {
                  const placement =
                    selectedCellSymbolLayout.instance.placement!;
                  const world = (point: { x: number; y: number }) =>
                    transformPoint(point, placement.position, placement);
                  const bodyCorner = world({
                    x: selectedCellSymbolLayout.body.right,
                    y: selectedCellSymbolLayout.body.bottom,
                  });
                  return (
                    <g
                      className="cell-symbol-layout-overlay"
                      data-testid="cell-symbol-layout-overlay"
                    >
                      <circle
                        data-testid="cell-symbol-body-handle"
                        className="cell-symbol-layout-handle body"
                        cx={bodyCorner.x}
                        cy={bodyCorner.y}
                        r="5"
                        onPointerDown={(event) =>
                          beginCellSymbolLayoutDrag(event, "body")
                        }
                      />
                      {selectedCellSymbolLayout.pins.map(
                        ({ terminal, pin }) => {
                          const bodyPoint =
                            pin.direction === "west"
                              ? {
                                  x: selectedCellSymbolLayout.body.left,
                                  y: pin.at.y,
                                }
                              : pin.direction === "east"
                                ? {
                                    x: selectedCellSymbolLayout.body.right,
                                    y: pin.at.y,
                                  }
                                : pin.direction === "north"
                                  ? {
                                      x: pin.at.x,
                                      y: selectedCellSymbolLayout.body.top,
                                    }
                                  : {
                                      x: pin.at.x,
                                      y: selectedCellSymbolLayout.body.bottom,
                                    };
                          const pinPoint = world(bodyPoint);
                          return (
                            <g key={terminal.id}>
                              <circle
                                data-testid={`cell-symbol-pin-handle-${terminal.id}`}
                                className="cell-symbol-layout-handle pin"
                                cx={pinPoint.x}
                                cy={pinPoint.y}
                                r="4.5"
                                onPointerDown={(event) =>
                                  beginCellSymbolLayoutDrag(
                                    event,
                                    "pin",
                                    terminal.id,
                                  )
                                }
                              />
                            </g>
                          );
                        },
                      )}
                    </g>
                  );
                })()
              : null}
            {highlightedNet ? (
              <g
                data-testid="net-highlight-overlay"
                data-net-id={highlightedNet.netId}
                className="net-highlight-overlay"
                pointerEvents="none"
              >
                {routeGeometryRecords
                  .filter(({ route }) =>
                    highlightedNet.routes.includes(route.id),
                  )
                  .map(({ route, geometry }) => (
                    <polyline
                      key={route.id}
                      className="net-highlight-halo"
                      points={serializePolylinePoints(geometry.centerline)}
                    />
                  ))}
                {routeGeometryRecords
                  .filter(({ route }) =>
                    highlightedNet.routes.includes(route.id),
                  )
                  .map(({ route, geometry }) => (
                    <polyline
                      key={`${route.id}-core`}
                      className="net-highlight-core"
                      points={serializePolylinePoints(geometry.centerline)}
                    />
                  ))}
                {document.junctions
                  .filter((junction) =>
                    highlightedNet.junctions.includes(junction.id),
                  )
                  .map((junction) => (
                    <circle
                      key={junction.id}
                      cx={junction.position.x}
                      cy={junction.position.y}
                      r="4.5"
                    />
                  ))}
                {highlightedNet.visibleEndpoints.flatMap((endpoint) => {
                  const point = resolveEndpointPoint(
                    document,
                    resolver,
                    endpoint,
                  );
                  if (!point) return [];
                  return [
                    <circle
                      key={`endpoint:${endpointKey(endpoint)}`}
                      className="net-highlight-endpoint"
                      cx={point.x}
                      cy={point.y}
                      r="5.5"
                    />,
                  ];
                })}
              </g>
            ) : null}
            {copyPreviewInnerHtml !== null ? (
              <g
                data-testid="copy-placement-preview"
                className="copy-placement-preview"
                dangerouslySetInnerHTML={copyPreviewInnerHtml}
              />
            ) : null}
            {tool === "wire" ? (
              <rect
                data-testid="wire-input-plane"
                className="wire-input-plane"
                x={viewBox.x}
                y={viewBox.y}
                width={viewBox.width}
                height={viewBox.height}
              />
            ) : null}
            {pendingSymbolId || vddRailMode || copyPlacement ? (
              <rect
                data-testid={
                  copyPlacement
                    ? "copy-placement-input-plane"
                    : "component-input-plane"
                }
                className="component-input-plane"
                x={viewBox.x}
                y={viewBox.y}
                width={viewBox.width}
                height={viewBox.height}
              />
            ) : null}
            <g data-layer="editor-overlay">
              {vddRailMode ? (
                vddRailStart && componentPreviewPoint ? (
                  <line
                    data-testid="vdd-rail-preview"
                    className="vdd-rail-preview"
                    x1={vddRailStart.x}
                    y1={vddRailStart.y}
                    x2={componentPreviewPoint.x}
                    y2={componentPreviewPoint.y}
                    strokeWidth={styleProfile.strokes.powerRail}
                  />
                ) : componentPreviewPoint ? (
                  <ComponentPlacementPreview
                    styleProfileId={document.presentation.styleProfileId}
                    symbolId="vdd"
                    position={componentPreviewPoint}
                    rotation={0}
                  />
                ) : null
              ) : pendingSymbolId && componentPreviewPoint ? (
                <ComponentPlacementPreview
                  styleProfileId={document.presentation.styleProfileId}
                  symbolId={pendingSymbolId}
                  {...(pendingPlacementSymbol
                    ? { symbol: pendingPlacementSymbol }
                    : {})}
                  position={componentPreviewPoint}
                  rotation={componentPlacementRotation}
                  mirror={componentPlacementMirror}
                />
              ) : null}
              {netLabelEditorOpen && selectedRoute
                ? (() => {
                    const geometry = routeGeometryRecords.find(
                      ({ route }) => route.id === selectedRoute.id,
                    )?.geometry;
                    if (!geometry) return null;
                    const segmentIndex = Math.min(
                      selectedRouteSegmentIndex ?? 0,
                      geometry.centerline.length - 2,
                    );
                    const from = geometry.centerline[segmentIndex]!;
                    const to = geometry.centerline[segmentIndex + 1]!;
                    const x = Math.round((from.x + to.x) / 2 - 58);
                    const y = Math.round((from.y + to.y) / 2 - 34);
                    return (
                      <foreignObject
                        data-testid="net-label-editor"
                        x={x}
                        y={y}
                        width="116"
                        height="32"
                      >
                        <form
                          className="net-label-editor"
                          onPointerDown={(event) => event.stopPropagation()}
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitNetLabelEditing();
                          }}
                        >
                          <input
                            ref={netLabelEditorInputRef}
                            aria-label="Net Label"
                            value={netLabelDraft}
                            onChange={(event) =>
                              updateNetLabelDraft(event.currentTarget.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                // Escape saves the edit like Enter does.
                                applyNetLabel();
                                setNetLabelEditorOpen(false);
                              }
                            }}
                          />
                        </form>
                      </foreignObject>
                    );
                  })()
                : null}
              {displayedFlightlines.map((flightline) => (
                <g key={flightline.id}>
                  <line
                    data-testid="flightline-hit"
                    className="flightline-hit"
                    data-net-id={flightline.netId}
                    x1={flightline.fromPoint.x}
                    y1={flightline.fromPoint.y}
                    x2={flightline.toPoint.x}
                    y2={flightline.toPoint.y}
                    onClick={(event) => handleFlightline(event, flightline)}
                  />
                  <line
                    data-testid="flightline"
                    className="flightline"
                    data-net-id={flightline.netId}
                    x1={flightline.fromPoint.x}
                    y1={flightline.fromPoint.y}
                    x2={flightline.toPoint.x}
                    y2={flightline.toPoint.y}
                  />
                </g>
              ))}
              {wireDraftPoints.length >= 2 ? (
                <polyline
                  data-testid="wire-preview"
                  className={
                    wireSource?.routePresentation === "bulk-dashed"
                      ? "wire-preview bulk-route-preview"
                      : "wire-preview"
                  }
                  points={serializePolylinePoints(wireDraftPoints)}
                />
              ) : null}
              <g ref={snapGuideLayerRef} data-layer="snap-guides" />
              {routeGeometryRecords
                .filter(({ route }) => route.id === selectedRouteId)
                .map(({ route, geometry }) => {
                  const segmentIndex = Math.min(
                    selectedRouteSegmentIndex ?? 0,
                    geometry.centerline.length - 2,
                  );
                  const from = geometry.centerline[segmentIndex]!;
                  const to = geometry.centerline[segmentIndex + 1]!;
                  const translatesWholeRoute =
                    looseRouteAnchorIds(document, route) !== null;
                  const powerRail =
                    route.presentation === "power-rail"
                      ? derivePowerRailComponent(document, route.id)
                      : null;
                  const powerRailEnds = powerRail?.endpointJunctionIds
                    .map((junctionId) =>
                      document.junctions.find(
                        (junction) => junction.id === junctionId,
                      ),
                    )
                    .filter(
                      (junction): junction is NonNullable<typeof junction> =>
                        Boolean(junction),
                    )
                    .sort((left, right) => {
                      return left.position.x === right.position.x
                        ? left.position.y - right.position.y
                        : left.position.x - right.position.x;
                    });
                  const routeCenter = centerOfBounds(
                    polylineBounds(geometry.centerline),
                  );
                  const preview =
                    routeStretchPreview?.routeId === route.id
                      ? routeStretchPreview.point
                      : null;
                  const handlePointerDown = (
                    event: ReactPointerEvent<SVGElement>,
                    intent: RouteStretchPreview["intent"],
                  ) => {
                    const primaryInstanceId = selectedIds.at(-1);
                    if (
                      primaryInstanceId &&
                      compositeSelectionOwnsHit("route", route.id)
                    ) {
                      beginMoveFromSelection(event, primaryInstanceId);
                      return;
                    }
                    beginRouteStretch(event, route.id, segmentIndex, intent);
                  };
                  return (
                    <g key={`handle-${route.id}`}>
                      <circle
                        data-testid={`route-handle-${route.id}`}
                        data-canvas-hit-kind="handle"
                        data-canvas-hit-id={`route-handle-${route.id}`}
                        className="route-handle"
                        cx={
                          powerRail
                            ? routeCenter.x
                            : translatesWholeRoute
                              ? (preview?.x ?? routeCenter.x)
                              : from.y === to.y
                                ? (from.x + to.x) / 2
                                : (preview?.x ?? (from.x + to.x) / 2)
                        }
                        cy={
                          powerRail
                            ? routeCenter.y
                            : translatesWholeRoute
                              ? (preview?.y ?? routeCenter.y)
                              : from.x === to.x
                                ? (from.y + to.y) / 2
                                : (preview?.y ?? (from.y + to.y) / 2)
                        }
                        r="6"
                        onPointerDown={(event) =>
                          handlePointerDown(
                            event,
                            powerRail
                              ? "move-power-rail"
                              : translatesWholeRoute
                                ? "move-loose-route"
                                : "stretch-segment",
                          )
                        }
                        pointerEvents={tool === "wire" ? "none" : undefined}
                      />
                      {powerRailEnds?.map((junction, index) => (
                        <circle
                          key={`power-rail-handle-${route.id}-${index}`}
                          data-testid={`power-rail-handle-${route.id}-${index === 0 ? "start" : "end"}`}
                          data-canvas-hit-kind="handle"
                          data-canvas-hit-id={`power-rail-handle-${route.id}-${index === 0 ? "start" : "end"}`}
                          className="route-handle"
                          cx={junction.position.x}
                          cy={junction.position.y}
                          r="6"
                          onPointerDown={(event) =>
                            handlePointerDown(
                              event,
                              index === 0
                                ? "resize-power-rail-start"
                                : "resize-power-rail-end",
                            )
                          }
                          pointerEvents={tool === "wire" ? "none" : undefined}
                        />
                      ))}
                    </g>
                  );
                })}
              {document.instances
                .filter((instance) => instance.placement !== null)
                .map((instance) => {
                  const hitBox = instanceHitBox(instance, resolver);
                  if (!hitBox) return null;
                  if (
                    cellSymbolLayoutEnabled &&
                    selectedInstance?.id === instance.id
                  ) {
                    // The layout overlay is the exclusive interaction surface
                    // for the selected Cell instance while editing its
                    // definition. Rendering the generic hit box here still
                    // wins elementsFromPoint() even with pointer-events:none.
                    return null;
                  }
                  const childDocumentId = referencedDocumentId(
                    project,
                    instance,
                  );
                  return (
                    <rect
                      key={instance.id}
                      data-testid={`hit-${instance.id}`}
                      data-canvas-hit-kind="instance"
                      data-canvas-hit-id={instance.id}
                      data-drag-object-id={instance.id}
                      {...hitBox}
                      className={
                        selectedIds.includes(instance.id)
                          ? "hit-target selected"
                          : "hit-target"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        if (suppressInstanceClick.current) {
                          suppressInstanceClick.current = false;
                          return;
                        }
                        selectInstanceFromSelection(
                          instance.id,
                          event.shiftKey || event.ctrlKey,
                        );
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (childDocumentId) {
                          enterHierarchy(instance.id);
                          return;
                        }
                        inspectInstance(instance.id);
                      }}
                      onPointerDown={(event) =>
                        beginMoveFromSelection(event, instance.id)
                      }
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  );
                })}
              {routeGeometryRecords.map(({ route, geometry }) => (
                <polyline
                  key={route.id}
                  data-testid={`route-hit-${route.id}`}
                  data-canvas-hit-kind="route"
                  data-canvas-hit-id={route.id}
                  data-drag-object-id={route.id}
                  className={
                    selectedRouteId === route.id ||
                    supplementalSelection.routeIds.includes(route.id) ||
                    selectedInternalRouteIds.has(route.id)
                      ? "route-hit selected"
                      : "route-hit"
                  }
                  points={serializePolylinePoints(geometry.centerline)}
                  onPointerDown={(event) =>
                    handleRoutePointerDown(event, route.id)
                  }
                  onClick={(event) => event.stopPropagation()}
                />
              ))}
              {wiringEndpoints.map((candidate) => {
                const powerRailEnds =
                  selectedRoute?.presentation === "power-rail"
                    ? (derivePowerRailComponent(document, selectedRoute.id)
                        ?.endpointJunctionIds.map((junctionId) =>
                          document.junctions.find(
                            (junction) => junction.id === junctionId,
                          ),
                        )
                        .filter(
                          (
                            junction,
                          ): junction is NonNullable<typeof junction> =>
                            Boolean(junction),
                        )
                        .sort(
                          (left, right) => left.position.x - right.position.x,
                        ) ?? [])
                    : [];
                const candidateJunctionId =
                  candidate.endpoint.kind === "junction"
                    ? candidate.endpoint.junctionId
                    : null;
                const powerRailEndIndex =
                  candidateJunctionId !== null
                    ? powerRailEnds.findIndex(
                        (junction) => junction.id === candidateJunctionId,
                      )
                    : -1;
                return (
                  <circle
                    key={`${candidate.netId}:${endpointTestId(candidate.endpoint)}`}
                    data-testid={endpointTestId(candidate.endpoint)}
                    data-canvas-hit-kind={
                      candidate.endpoint.kind === "junction"
                        ? "junction"
                        : undefined
                    }
                    data-canvas-hit-id={
                      candidate.endpoint.kind === "junction"
                        ? candidate.endpoint.junctionId
                        : undefined
                    }
                    data-drag-object-id={
                      candidate.endpoint.kind === "junction"
                        ? candidate.endpoint.junctionId
                        : undefined
                    }
                    className={
                      tool === "wire" ||
                      (candidate.endpoint.kind === "junction" &&
                        supplementalSelection.junctionIds.includes(
                          candidate.endpoint.junctionId,
                        )) ||
                      (selectedEndpoint?.endpoint.kind === "junction" &&
                        candidate.endpoint.kind === "junction" &&
                        selectedEndpoint.endpoint.junctionId ===
                          candidate.endpoint.junctionId)
                        ? "endpoint-hit active"
                        : "endpoint-hit"
                    }
                    cx={candidate.point.x}
                    cy={candidate.point.y}
                    r={4}
                    onClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectEndpoint(candidate);
                      setStatus(
                        `Endpoint actions: ${endpointTestId(candidate.endpoint)}`,
                      );
                    }}
                    onPointerDown={(event) => {
                      if (
                        tool === "pointer" &&
                        selectedRoute &&
                        powerRailEndIndex >= 0
                      ) {
                        beginRouteStretch(
                          event,
                          selectedRoute.id,
                          selectedRouteSegmentIndex ?? 0,
                          powerRailEndIndex === 0
                            ? "resize-power-rail-start"
                            : "resize-power-rail-end",
                        );
                        return;
                      }
                      if (
                        tool === "pointer" &&
                        candidate.endpoint.kind === "junction"
                      ) {
                        event.stopPropagation();
                        selectEndpoint(candidate);
                        setStatus(
                          `Selected ${endpointTestId(candidate.endpoint)}`,
                        );
                        return;
                      }
                      handleWireEndpoint(event, candidate);
                    }}
                  />
                );
              })}
              {document.annotations
                .filter((annotation) =>
                  isSchematicAnnotationVisible(document, annotation),
                )
                .map((annotation) => {
                  const anchor = annotationAnchor(
                    document,
                    resolver,
                    annotation,
                    routeGeometryRecords,
                    styleProfile,
                  );
                  const hitBox = annotationHitBox(
                    document,
                    annotation,
                    anchor,
                    routeGeometryRecords,
                    styleProfile,
                  );
                  const selected =
                    selectedAnnotationId === annotation.id ||
                    supplementalSelection.annotationIds.includes(annotation.id);
                  return (
                    <rect
                      key={`annotation-hit-${annotation.id}`}
                      data-testid={`annotation-hit-${annotation.id}`}
                      data-canvas-hit-kind="annotation"
                      data-canvas-hit-id={annotation.id}
                      data-drag-object-id={annotation.id}
                      className={
                        selected
                          ? "hit-target annotation-text-hit selected"
                          : "hit-target annotation-text-hit"
                      }
                      {...hitBox}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) =>
                        beginAnnotationDrag(event, annotation)
                      }
                      pointerEvents={tool === "wire" ? "none" : undefined}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        beginAnnotationTextEditing(annotation);
                      }}
                    />
                  );
                })}
              {(document.drafting?.objects ?? []).map((object) => {
                // WP-R5/P1: every drafting object gets a selectable/deletable hit
                // shape derived from the shared geometry. P1: use the object's
                // actual shape (stroke polyline/line for lines and arrows) instead
                // of a full bounding rect, so large leader/callout boxes do not
                // block the canvas underneath.
                const geometry = resolveDraftingObjectGeometry(
                  document,
                  resolver,
                  object,
                );
                const draggable = !object.locked && draftingDragOrigin(object);
                const selected =
                  selectedDraftingId === object.id ||
                  supplementalSelection.draftingIds.includes(object.id)
                    ? "annotation-hit selected"
                    : "annotation-hit";
                const textSelected =
                  selectedDraftingId === object.id ||
                  supplementalSelection.draftingIds.includes(object.id)
                    ? "hit-target annotation-text-hit selected"
                    : "hit-target annotation-text-hit";
                const onDown = (event: ReactPointerEvent<SVGElement>): void => {
                  if (draggable) {
                    beginDraftingDrag(event, object);
                  } else {
                    event.stopPropagation();
                    selectDraftingObject(object.id);
                  }
                };
                if (
                  object.kind === "construction-line" &&
                  geometry.kind === "construction-line"
                ) {
                  const points = object.points
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ");
                  const hasCurve = geometry.curveControls.some(Boolean);
                  const commonProps = {
                    "data-testid": `drafting-hit-${object.id}`,
                    "data-canvas-hit-kind": "drafting",
                    "data-canvas-hit-id": object.id,
                    "data-drag-object-id": object.id,
                    className: selected,
                    fill: "none",
                    onPointerDown: onDown,
                    onDoubleClick: (event: ReactMouseEvent<SVGElement>) => {
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
                    pointerEvents: tool === "wire" ? "none" : undefined,
                  };
                  return hasCurve ? (
                    <path
                      key={`drafting-hit-${object.id}`}
                      {...commonProps}
                      d={draftingPathData(
                        geometry.points,
                        geometry.curveControls,
                      )}
                    />
                  ) : (
                    <polyline
                      key={`drafting-hit-${object.id}`}
                      {...commonProps}
                      points={points}
                    />
                  );
                }
                if (object.kind === "arrow" && geometry.kind === "arrow") {
                  return geometry.curveControls.some(Boolean) ? (
                    <path
                      key={`drafting-hit-${object.id}`}
                      data-testid={`drafting-hit-${object.id}`}
                      data-canvas-hit-kind="drafting"
                      data-canvas-hit-id={object.id}
                      data-drag-object-id={object.id}
                      className={selected}
                      d={draftingPathData(
                        geometry.points,
                        geometry.curveControls,
                      )}
                      fill="none"
                      onPointerDown={onDown}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        insertArrowWaypoint(
                          object,
                          pointFromClient(
                            event.clientX,
                            event.clientY,
                            event.currentTarget.ownerSVGElement!,
                          ),
                        );
                      }}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  ) : (
                    <polyline
                      key={`drafting-hit-${object.id}`}
                      data-testid={`drafting-hit-${object.id}`}
                      data-canvas-hit-kind="drafting"
                      data-canvas-hit-id={object.id}
                      data-drag-object-id={object.id}
                      className={selected}
                      points={geometry.points
                        .map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                      fill="none"
                      onPointerDown={onDown}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        insertArrowWaypoint(
                          object,
                          pointFromClient(
                            event.clientX,
                            event.clientY,
                            event.currentTarget.ownerSVGElement!,
                          ),
                        );
                      }}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  );
                }
                if (
                  object.kind === "rectangle" &&
                  geometry.kind === "rectangle"
                ) {
                  return (
                    <polygon
                      key={`drafting-hit-${object.id}`}
                      data-testid={`drafting-hit-${object.id}`}
                      data-canvas-hit-kind="drafting"
                      data-canvas-hit-id={object.id}
                      data-drag-object-id={object.id}
                      className={`${selected} drafting-rectangle-hit`}
                      points={serializePolylinePoints(geometry.corners)}
                      fill="none"
                      onPointerDown={onDown}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  );
                }
                if (object.kind === "leader" && geometry.kind === "leader") {
                  return (
                    <line
                      key={`drafting-hit-${object.id}`}
                      data-testid={`drafting-hit-${object.id}`}
                      data-canvas-hit-kind="drafting"
                      data-canvas-hit-id={object.id}
                      data-drag-object-id={object.id}
                      className={selected}
                      x1={geometry.anchor.x}
                      y1={geometry.anchor.y}
                      x2={geometry.target.x}
                      y2={geometry.target.y}
                      onPointerDown={onDown}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  );
                }
                if (object.kind === "callout" && geometry.kind === "callout") {
                  return (
                    <g
                      key={`drafting-hit-${object.id}`}
                      data-testid={`drafting-hit-${object.id}`}
                      data-canvas-hit-kind="drafting"
                      data-canvas-hit-id={object.id}
                      data-drag-object-id={object.id}
                      onPointerDown={onDown}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    >
                      <line
                        className={selected}
                        x1={geometry.textPosition.x}
                        y1={geometry.textPosition.y}
                        x2={geometry.target.x}
                        y2={geometry.target.y}
                      />
                      <rect className={selected} {...geometry.textBounds} />
                    </g>
                  );
                }
                return (
                  <rect
                    key={`drafting-hit-${object.id}`}
                    data-testid={`drafting-hit-${object.id}`}
                    data-canvas-hit-kind="drafting"
                    data-canvas-hit-id={object.id}
                    data-drag-object-id={object.id}
                    className={object.kind === "text" ? textSelected : selected}
                    {...geometry.bounds}
                    onPointerDown={onDown}
                    onDoubleClick={(event) => {
                      if (object.kind !== "text") return;
                      event.stopPropagation();
                      beginDraftingTextEditing(object);
                    }}
                  />
                );
              })}
              {selectedDraftingId
                ? (() => {
                    const object = document.drafting?.objects.find(
                      (candidate) => candidate.id === selectedDraftingId,
                    );
                    if (!object || object.locked) return null;
                    const geometry = resolveDraftingObjectGeometry(
                      document,
                      resolver,
                      object,
                    );
                    if (object.kind === "arrow" && geometry.kind === "arrow") {
                      return (
                        <g
                          data-testid={`drafting-handles-${object.id}`}
                          data-canvas-hit-kind="handle"
                          data-canvas-hit-id={`drafting-handles-${object.id}`}
                        >
                          <circle
                            className="draft-handle"
                            data-testid={`draft-handle-from-${object.id}`}
                            cx={geometry.from.x}
                            cy={geometry.from.y}
                            r="5"
                            onPointerDown={(event) =>
                              beginDraftingHandleDrag(event, object, {
                                kind: "from",
                              })
                            }
                          />
                          {geometry.points.slice(1, -1).map((point, index) => (
                            <circle
                              key={`draft-arrow-waypoint-${index}`}
                              className="draft-handle"
                              data-testid={`draft-handle-waypoint-${index}-${object.id}`}
                              cx={point.x}
                              cy={point.y}
                              r="5"
                              onPointerDown={(event) =>
                                beginDraftingHandleDrag(event, object, {
                                  kind: "waypoint",
                                  index,
                                })
                              }
                            />
                          ))}
                          {geometry.points.slice(0, -1).map((point, index) => {
                            const next = geometry.points[index + 1]!;
                            const midpoint = quadraticMidpoint(
                              point,
                              geometry.curveControls[index] ?? null,
                              next,
                            );
                            return (
                              <rect
                                key={`draft-arrow-segment-${index}`}
                                className="draft-handle draft-midpoint-handle"
                                data-testid={`draft-handle-segment-${index}-${object.id}`}
                                x={midpoint.x - 3}
                                y={midpoint.y - 3}
                                width="6"
                                height="6"
                                transform={`rotate(45 ${midpoint.x} ${midpoint.y})`}
                                onPointerDown={(event) =>
                                  beginDraftingHandleDrag(event, object, {
                                    kind: "curve",
                                    index,
                                  })
                                }
                              />
                            );
                          })}
                          <circle
                            className="draft-handle"
                            data-testid={`draft-handle-to-${object.id}`}
                            cx={geometry.to.x}
                            cy={geometry.to.y}
                            r="5"
                            onPointerDown={(event) =>
                              beginDraftingHandleDrag(event, object, {
                                kind: "to",
                              })
                            }
                          />
                        </g>
                      );
                    }
                    if (
                      object.kind === "construction-line" &&
                      geometry.kind === "construction-line"
                    ) {
                      return (
                        <g
                          data-testid={`drafting-handles-${object.id}`}
                          data-canvas-hit-kind="handle"
                          data-canvas-hit-id={`drafting-handles-${object.id}`}
                        >
                          {geometry.vertices.map((vertex, index) => (
                            <circle
                              key={`draft-vx-${index}`}
                              className="draft-handle"
                              data-testid={`draft-handle-vx-${index}-${object.id}`}
                              cx={vertex.x}
                              cy={vertex.y}
                              r="5"
                              onPointerDown={(event) =>
                                beginDraftingHandleDrag(event, object, {
                                  kind: "vertex",
                                  index,
                                })
                              }
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                deleteConstructionVertex(object, index);
                              }}
                            />
                          ))}
                          {geometry.vertices
                            .slice(0, -1)
                            .map((vertex, index) => {
                              const next = geometry.vertices[index + 1]!;
                              const midpoint = quadraticMidpoint(
                                vertex,
                                geometry.curveControls[index] ?? null,
                                next,
                              );
                              return (
                                <rect
                                  key={`draft-line-segment-${index}`}
                                  className="draft-handle draft-midpoint-handle"
                                  data-testid={`draft-handle-segment-${index}-${object.id}`}
                                  x={midpoint.x - 3}
                                  y={midpoint.y - 3}
                                  width="6"
                                  height="6"
                                  transform={`rotate(45 ${midpoint.x} ${midpoint.y})`}
                                  onPointerDown={(event) =>
                                    beginDraftingHandleDrag(event, object, {
                                      kind: "curve",
                                      index,
                                    })
                                  }
                                />
                              );
                            })}
                        </g>
                      );
                    }
                    if (
                      object.kind === "rectangle" &&
                      geometry.kind === "rectangle"
                    ) {
                      return (
                        <g data-testid={`drafting-handles-${object.id}`}>
                          {geometry.corners.map((corner, index) => (
                            <rect
                              key={`draft-rectangle-corner-${index}`}
                              className="draft-handle"
                              data-testid={`draft-handle-corner-${index}-${object.id}`}
                              x={corner.x - 4}
                              y={corner.y - 4}
                              width="8"
                              height="8"
                              onPointerDown={(event) =>
                                beginDraftingHandleDrag(event, object, {
                                  kind: "rectangle-corner",
                                  index,
                                })
                              }
                            />
                          ))}
                        </g>
                      );
                    }
                    return null;
                  })()
                : null}
              {boxPreview ? (
                <rect
                  data-testid={
                    boxPreview.intent === "zoom" ? "zoom-box" : "selection-box"
                  }
                  className={
                    boxPreview.intent === "zoom"
                      ? "zoom-box"
                      : `selection-box selection-box--${marqueeMode(
                          boxPreview.start,
                          boxPreview.end,
                        )}`
                  }
                  {...normalizedRect(boxPreview.start, boxPreview.end)}
                />
              ) : null}
              {draftingSource && draftingHover ? (
                <DraftingCreatePreview
                  tool={tool}
                  start={draftingSource}
                  waypoints={draftingWaypoints}
                  hover={draftingHover}
                  snap={draftingSnapPoint}
                  styleProfile={styleProfile}
                />
              ) : null}
              {tool === "wire" && wirePreviewPoint ? (
                <circle
                  className="snap-preview"
                  cx={wirePreviewPoint.x}
                  cy={wirePreviewPoint.y}
                  r="4"
                />
              ) : null}
              {textEditing && textEditingBounds ? (
                <CanvasTextEditorOverlay
                  session={textEditing}
                  bounds={textEditingBounds}
                  viewBox={viewBox}
                  disabled={textEditingLocked}
                  onUpdate={updateTextEditing}
                  onCommit={commitTextEditing}
                  onDelete={deleteTextEditing}
                  {...(editingAnnotation &&
                  isRoutedMarker(editingAnnotation) &&
                  effectiveRouteAttachment(editingAnnotation)
                    ? { onReverseCurrentArrow: reverseSelectedCurrentArrow }
                    : {})}
                />
              ) : null}
            </g>
          </svg>
        </section>
      </div>
      <footer className="app-statusbar">
        <div className="statusbar-left">
          <p className="editor-status" data-testid="status" aria-live="polite">
            {status}
          </p>
          <span className="statusbar-tool" data-testid="statusbar-tool">
            {vddRailMode
              ? "Drawing Power Rail"
              : pendingSymbolId
                ? `Placing ${pendingSymbolId}`
                : tool === "pointer"
                  ? "Select"
                  : tool === "construction-line"
                    ? "Line"
                    : tool.charAt(0).toUpperCase() + tool.slice(1)}
          </span>
          {tool === "wire" ? (
            <button
              type="button"
              className="statusbar-tool"
              onClick={() => setWireOptionsOpen((open) => !open)}
              aria-expanded={wireOptionsOpen}
            >
              {wireRoutingMode === "orthogonal" ? "Orthogonal" : "45°"} · F3
            </button>
          ) : null}
          {tool === "wire" && wireOptionsOpen ? (
            <span className="wire-options" data-testid="wire-options">
              <label>
                Route
                <select
                  value={wireRoutingMode}
                  onChange={(event) =>
                    setWireRoutingMode(
                      event.target.value as typeof wireRoutingMode,
                    )
                  }
                >
                  <option value="orthogonal">Orthogonal</option>
                  <option value="octilinear">45° octilinear</option>
                </select>
              </label>
              <label>
                Corner
                <select
                  value={wireCornerOrder}
                  onChange={(event) =>
                    setWireCornerOrder(
                      event.target.value as typeof wireCornerOrder,
                    )
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="diagonal-first">Diagonal first</option>
                  <option value="orthogonal-first">Orthogonal first</option>
                </select>
              </label>
            </span>
          ) : null}
          {recoveryStateLabel(recoveryState) === null ? null : (
            <output
              className="statusbar-recovery"
              data-testid="recovery-state"
              aria-label="Browser recovery state"
            >
              {recoveryStateLabel(recoveryState)}
            </output>
          )}
        </div>
        <div className="canvas-controls" aria-label="Canvas view controls">
          <button
            type="button"
            aria-label={
              gridDotsVisible ? "Hide background dots" : "Show background dots"
            }
            aria-pressed={gridDotsVisible}
            title={
              gridDotsVisible ? "Hide background dots" : "Show background dots"
            }
            onClick={() => setGridDotsVisible((visible) => !visible)}
          >
            <ToolIcon name="grid" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomViewAtCenter(1.2)}
          >
            <ToolIcon name="zoom-out" />
          </button>
          <output aria-label="Current zoom">{zoomPercent}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomViewAtCenter(0.84)}
          >
            <ToolIcon name="zoom-in" />
          </button>
          <button
            type="button"
            aria-label="Fit view"
            title="Fit view (Home)"
            onClick={fitView}
          >
            <ToolIcon name="fit" />
          </button>
        </div>
      </footer>
    </main>
  );
}
