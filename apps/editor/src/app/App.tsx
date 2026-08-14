import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";

import {
  buildManualWirePath,
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeEndpointRouteAttachment,
  proposeGroupMoveEdits,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeWireCommitThroughContacts,
  proposeWireSegmentMove,
  proposeVisualRouteDeletion,
  type EditTransactionResult,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import { createFormalExportSource, safeExportBaseName } from "@icm/exporters";
import {
  exportFormalArtifactsInBrowser,
  rasterizeFormalSvgInBrowser,
} from "@icm/exporters/browser";
import {
  buildProjectConnectivityIndex,
  buildProjectSearchIndex,
  deriveCrossings,
  deriveInternalGroupSelection,
  derivePowerRailComponent,
  diagnoseVisualQuality,
  endpointKey,
  findHierarchyPath,
  isVisibleEndpoint,
  moveRouteSegment,
  diagnoseProject,
  resolveEndpointPoint,
  resolveDraftingObjectGeometry,
  resolveElectricalContactTargets,
  resolveNetLabelBinding,
  resolveMosBulkConnection,
  resolveSchematicStyleProfile,
  routeAttachmentPlacement,
  traceHierarchyNet,
} from "@icm/derived";
import type {
  Diagnostic,
  Flightline,
  HierarchyFrame,
  HierarchyNetTraceHop,
  ObjectLocator,
  RoutePolyline,
  SearchResult,
} from "@icm/derived";
import {
  createEmptyProject,
  defaultDraftTextDocument,
  flattenRichText,
  powerNetNormalizations,
  snapGridPoint,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";
import type {
  Annotation,
  CircuitProject,
  DerivedPoint,
  DraftingObject,
  GridRect,
  Point,
  Rect,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { importSpiceSources } from "@icm/spice";
import type { SpiceDiagnostic } from "@icm/spice";
import { builtInSymbols, findUnsupportedProjectSymbolIds } from "@icm/symbols";
import {
  clipboardPlacementAnchor,
  clipboardPreviewDocument,
  copySelection,
  proposePaste,
} from "../features/clipboard/clipboard";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import { startCanvasDragSession } from "../canvas/canvas-drag-session";
import {
  fitCameraToBounds,
  normalizeCameraRect,
  type CameraRectInput,
} from "../canvas/fit-view";
import type { CanvasDragSession } from "../canvas/canvas-drag-session";
import { startCanvasDragVisual } from "../canvas/canvas-drag-visual";
import { resolveCanvasHitAtPoint } from "../canvas/canvas-hit-resolver";
import {
  centerOfBounds,
  clamp,
  closestPointOnSegment,
  normalizedBearing,
  normalizedRect,
  serializePolylinePoints,
} from "../canvas/canvas-geometry";
import { CanvasTextEditorOverlay } from "../features/text-editing/canvas-text-editor-overlay";
import {
  ComponentPlacementPreview,
  InsertComponentDialog,
} from "../features/component-insert/insert-component-dialog";
import type { ComponentInsertRequest } from "../features/component-insert/insert-component-dialog";
import { constructVddRailEdits } from "../features/component-insert/vdd-rail";
import {
  proposePlacementContact,
  proposedStandalonePowerConnection,
} from "../features/component-insert/placement-connectivity";
import {
  componentParameters,
  effectiveComponentParameterValue,
} from "../features/component-insert/component-parameters";
import { initialInstanceNetlist } from "../features/netlist-export/netlist-authoring";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import { ShapesPanel } from "../features/editor-shell/shapes-panel";
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
  resolveEditorShortcut,
  stepBoundedScale,
} from "../interaction/editor-shortcuts";
import { EditorHelpDialog } from "../components/editor-help-dialog";
import { ReplaceGuardDialog } from "../components/replace-guard-dialog";
import { RecentRecoveryDialog } from "../components/recent-recovery-dialog";
import {
  RecoveryFailureBanner,
  StartupRecoveryBanner,
  recoveryStateLabel,
} from "../components/recovery-banners";
import { ProjectSearchDialog } from "../features/search/project-search-dialog";
import {
  AgentPropertiesSection,
  ConnectAgentPanel,
} from "../agent/connect-agent-panel";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { useAgentSession } from "../agent/use-agent-session";
import type { AgentFileCandidateSummary } from "@icm/agent-adapter";
import { referencedDocumentId } from "../document/editor-session";
import { useInteractionState } from "../interaction/interaction-state";
import type { EditorTool } from "../interaction/interaction-state";
import {
  createTextEditingSession,
  proposeTextEditingCommit,
  resolveTextEditingTarget,
  textDeletionEdit,
  updateTextEditingSession,
} from "../features/text-editing/text-editing";
import type { TextEditingSession } from "../features/text-editing/text-editing";
import {
  defaultRazaviSymbolVariantId,
  materializeRazaviProjectBulkConnections,
  razaviHiddenBulkRisk,
  razaviManualBulkConnectionEdits,
  razaviMosPresentationEdits,
} from "../presentation/razavi-presentation";
import {
  explicitAnnotationRemovals,
  proposeConnectedInstanceDeletion,
} from "../features/selection/delete-selection";
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
import {
  NetTraceSection,
  ProjectDiagnosticsSection,
  SelectionInspectorDetails,
  summarizeVisualDiagnostics,
} from "../features/selection/selection-inspector-details";
import {
  hasVisualSelection,
  pruneVisualSelection,
} from "../features/selection/visual-selection";
import type { VisualSelection } from "../features/selection/visual-selection";
import {
  annotationAnchor,
  annotationHitBox,
  attachmentAtPoint,
  defaultInstanceLabel,
  dragRouteAttachmentAtPoint,
  effectiveRouteAttachment,
  endpointNetId,
  instanceHitBox,
  isRoutedMarker,
  looseRouteAnchorIds,
} from "../features/wiring/route-interaction-geometry";
import { reflectOrientation } from "../interaction/shortcut-orientation";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import { resolveRouteTap, type RouteTap } from "../features/wiring/route-tap";
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
const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";
const DRAG_START_DISTANCE_PX = 4;
const SNAP_CAPTURE_RADIUS_PX = 7;

interface DragPreview {
  instanceIds: string[];
  primaryInstanceId: string;
  originalPositions: Record<string, Point>;
  pointerStart: DerivedPoint;
}
interface BoxPreview {
  start: DerivedPoint;
  end: DerivedPoint;
  pointerId: number;
}

interface PanPreview {
  clientStart: Point;
  viewBoxStart: GridRect;
  pointerId: number;
}

interface RouteStretchPreview {
  routeId: string;
  segmentIndex: number;
  kind:
    | "segment"
    | "translate"
    | "power-rail-translate"
    | "power-rail-resize-start"
    | "power-rail-resize-end";
  start: DerivedPoint;
  point: DerivedPoint;
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
}

function dismissOpenCommandMenus(): boolean {
  const openMenus = Array.from(
    globalThis.document.querySelectorAll<HTMLDetailsElement>(
      ".command-menu[open]",
    ),
  );
  for (const menu of openMenus) menu.open = false;
  return openMenus.length > 0;
}

function endpointTestId(endpoint: RouteEndpoint): string {
  switch (endpoint.kind) {
    case "terminal":
      return `terminal-${endpoint.instanceId}-${endpoint.pinName}`;
    case "junction":
      return `junction-${endpoint.junctionId}`;
  }
}

function draftingPathData(
  points: readonly Point[],
  curveControls: readonly (Point | null)[],
): string {
  const start = points[0]!;
  let data = `M ${start.x} ${start.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const end = points[index + 1]!;
    const control = curveControls[index];
    data += control
      ? ` Q ${control.x} ${control.y} ${end.x} ${end.y}`
      : ` L ${end.x} ${end.y}`;
  }
  return data;
}

function quadraticMidpoint(
  from: Point,
  control: Point | null,
  to: Point,
): Point {
  return control
    ? {
        x: (from.x + 2 * control.x + to.x) / 4,
        y: (from.y + 2 * control.y + to.y) / 4,
      }
    : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

// A quadratic Bézier evaluated at t=0.5 is (P0 + 2C + P1)/4. Inverting it
// makes the visible midpoint the direct manipulation handle the user drags.
function quadraticTangentAngle(
  from: Point,
  control: Point | null,
  to: Point,
): number {
  if (!control) return 0;
  const start = { x: control.x - from.x, y: control.y - from.y };
  const end = { x: to.x - control.x, y: to.y - control.y };
  const startLength = Math.hypot(start.x, start.y);
  const endLength = Math.hypot(end.x, end.y);
  if (startLength < 1e-6 || endLength < 1e-6) return 0;
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (start.x * end.x + start.y * end.y) / (startLength * endLength),
    ),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function maxRoutingCounter(document: SchematicDocument): number {
  const ids = [
    ...document.instances.map((item) => item.id),
    ...document.nets.map((item) => item.id),
    ...document.routes.map((item) => item.id),
    ...document.junctions.map((item) => item.id),
    ...document.annotations.map((item) => item.id),
    ...document.layoutGroups.map((item) => item.id),
    ...document.constraints.map((item) => item.id),
  ];
  let maximum = 0;
  for (const id of ids) {
    for (const match of id.matchAll(
      /(?:route-ui|junction-ui|net-ui)-(\d+)/gu,
    )) {
      maximum = Math.max(maximum, Number(match[1]));
    }
  }
  return maximum;
}

function rectsIntersect(left: Rect, right: Rect): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function segmentIntersectsRect(from: Point, to: Point, rect: Rect): boolean {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  const delta = { x: to.x - from.x, y: to.y - from.y };
  let entry = 0;
  let exit = 1;
  const boundaries: ReadonlyArray<readonly [number, number]> = [
    [-delta.x, from.x - rect.x],
    [delta.x, rect.x + rect.width - from.x],
    [-delta.y, from.y - rect.y],
    [delta.y, rect.y + rect.height - from.y],
  ];

  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

function rectangleBoundaryIntersectsRect(
  corners: readonly Point[],
  rect: Rect,
): boolean {
  return corners.some((corner, index) =>
    segmentIntersectsRect(corner, corners[(index + 1) % corners.length]!, rect),
  );
}

function polylineBounds(points: readonly Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export function App({ project: initialProject, visitStats }: AppProps) {
  const [preparedInitialProject] = useState(
    () =>
      materializeRazaviProjectBulkConnections(
        initialProject ?? createEmptyProject("project-main", "New Circuit"),
      ).project,
  );
  const [status, setStatus] = useState("Ready");
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(false);
  const [agentStatusDismissed, setAgentStatusDismissed] = useState(false);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(LIBRARY_PANEL_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [recentSymbolIds, setRecentSymbolIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(RECENT_COMPONENTS_STORAGE_KEY) ?? "[]",
      );
      return Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
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
  const [recoveryBannerDismissed, setRecoveryBannerDismissed] = useState(false);
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
  const [importDiagnostics, setImportDiagnostics] = useState<SpiceDiagnostic[]>(
    [],
  );
  const [importReviewOpen, setImportReviewOpen] = useState(false);
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
    project,
    projectSessionId,
    host: browserAgentHost,
    fileHost: browserAgentFileHost,
  });
  useEffect(() => {
    setAgentStatusDismissed(false);
  }, [agentSession.status]);
  const [boxPreview, setBoxPreview] = useState<BoxPreview | null>(null);
  const [panPreview, setPanPreview] = useState<PanPreview | null>(null);
  const [routeStretchPreview, setRouteStretchPreview] =
    useState<RouteStretchPreview | null>(null);
  const [draftingHandlePreview, setDraftingHandlePreview] =
    useState<DraftingHandlePreview | null>(null);
  const [annotationDragPreview, setAnnotationDragPreview] =
    useState<Annotation | null>(null);
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
    draftingSource,
    draftingHover,
    draftingWaypoints,
    draftingSnapPoint,
    componentPlacementRotation,
    componentPreviewPoint,
    vddRailMode,
    vddRailStart,
    copyPlacement,
    setTool,
    beginComponentPlacement,
    setComponentPreviewPoint,
    rotateComponentPlacement,
    beginVddRailPlacement: beginVddRailInteraction,
    setVddRailStart,
    setVddRailPreviewPoint,
    completeVddRailPlacement,
    beginCopyPlacement: beginCopyPlacementInteraction,
    setCopyPreviewPoint,
    rotateCopyPlacement,
    setWireSource,
    setWirePreviewPoint,
    setWireWaypoints,
    completeWire,
    setDraftingSource,
    setDraftingHover,
    setDraftingWaypoints,
    setDraftingSnapPoint,
    clearDraftingCreate,
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
  const [netLabelDraft, setNetLabelDraft] = useState("");
  const [netLabelEditorOpen, setNetLabelEditorOpen] = useState(false);
  const [instancePropertyDraft, setInstancePropertyDraft] = useState<{
    instanceId: string | null;
    parameters: Record<string, string>;
    x: string;
    y: string;
    rotation: "0" | "90" | "180" | "270";
  }>({
    instanceId: null,
    parameters: {},
    x: "",
    y: "",
    rotation: "0",
  });
  const [textEditing, setTextEditing] = useState<TextEditingSession | null>(
    null,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedNetOrigin, setHighlightedNetOrigin] = useState<{
    documentId: string;
    netId: string;
    endpoint?: RouteEndpoint;
  } | null>(null);
  const routeCounter = useRef(0);
  const canvasDragSessionRef = useRef<CanvasDragSession | null>(null);
  const instanceCounter = useRef(0);
  const copyCounter = useRef(0);
  const suppressInstanceClick = useRef(false);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const selectionShelfRef = useRef<HTMLButtonElement>(null);
  const instanceValueInputRef = useRef<HTMLInputElement>(null);
  const netLabelPropertyInputRef = useRef<HTMLInputElement>(null);
  const netLabelEditorInputRef = useRef<HTMLInputElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const documentViewBoxes = useRef(new Map<string, GridRect>());
  const renderedDocument = useMemo(() => {
    if (!draftingHandlePreview && !annotationDragPreview) return document;
    return {
      ...document,
      annotations: annotationDragPreview
        ? document.annotations.map((annotation) =>
            annotation.id === annotationDragPreview.id
              ? annotationDragPreview
              : annotation,
          )
        : document.annotations,
      ...(draftingHandlePreview && document.drafting
        ? {
            drafting: {
              ...document.drafting,
              objects: document.drafting.objects.map((object) =>
                object.id === draftingHandlePreview.objectId
                  ? draftingHandlePreview.object
                  : object,
              ),
            },
          }
        : {}),
    };
  }, [annotationDragPreview, document, draftingHandlePreview]);
  const scene = useMemo(
    () => buildSvgScene(renderedDocument, resolver, { bounds: viewBox }),
    [renderedDocument, resolver, viewBox],
  );
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
    return buildSvgScene(
      clipboardPreviewDocument(
        document,
        copyPlacement.clipboard,
        offset,
        copyPlacement.rotation,
      ),
      resolver,
      { bounds: viewBox },
    );
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
  const selectedIds = visualSelection.instanceIds;
  const projectConnectivityIndex = useMemo(
    () => buildProjectConnectivityIndex(project, resolver),
    [project, resolver],
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
  const projectDiagnostics = useMemo(
    () => diagnoseProject(project, resolver, projectConnectivityIndex),
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
  const hasImportedHierarchy = useMemo(
    () =>
      project.documents.some((candidate) =>
        candidate.instances.some(
          (instance) => referencedDocumentId(project, instance) !== null,
        ),
      ),
    [project],
  );
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
  const styleProfile = resolveSchematicStyleProfile(
    document.presentation.styleProfileId,
  );
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
            ?.flightlines ?? [],
      ),
    [document.id, document.nets, projectConnectivityIndex],
  );
  const displayedFlightlines = useMemo(() => {
    // Flightlines guide placement and partial routing of imported topology.
    // They are intentionally independent from sourceStatus: placement changes
    // geometry without changing the imported electrical intent. A deliberate
    // geometry/Net-label edit dismisses guidance through the persisted state.
    // Net highlighting already provides a stronger complete-conductor overlay.
    if (
      !document.sourceBinding ||
      document.flightlineGuidance === "dismissed" ||
      highlightedNetId
    ) {
      return [];
    }
    return flightlines;
  }, [document, flightlines, highlightedNetId]);
  const crossings = useMemo(
    () => deriveCrossings(document, resolver),
    [document, resolver],
  );
  const visualDiagnostics = useMemo(
    () => diagnoseVisualQuality(document, resolver),
    [document, resolver],
  );
  const visualDiagnosticSummary = useMemo(
    () => summarizeVisualDiagnostics(visualDiagnostics),
    [visualDiagnostics],
  );
  const structuralDiagnostics = visualDiagnosticSummary.structural;
  const visualObservations = visualDiagnosticSummary.observations;
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
              ...(pin.name === "B"
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
  useEffect(() => {
    const normalizationEdits = powerNetNormalizations(document).length
      ? [{ kind: "normalize_power_nets" as const }]
      : [];
    const edits = normalizationEdits;
    if (edits.length === 0) return;
    const result = transact(edits);
    if (result.ok) {
      setStatus(
        `Normalized ${normalizationEdits.length} explicit power-Net rule(s)`,
      );
    }
  }, [document, resolver, visibleEndpoints]);
  const routePolylines = useMemo(
    () =>
      document.routes.flatMap((route) => {
        const geometry = projectConnectivityIndex.documents
          .get(document.id)
          ?.routeGeometry.get(route.id);
        if (!geometry) return [];
        const polyline: RoutePolyline = {
          routeId: geometry.routeId,
          netId: geometry.netId,
          points: [...geometry.centerline],
          segmentModes: geometry.segments.map((segment) => segment.mode),
        };
        return [{ route, polyline }];
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
        editingAnnotation,
        annotationAnchor(
          document,
          resolver,
          editingAnnotation,
          routePolylines,
          styleProfile,
        ),
        routePolylines,
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
    ? [wireSource.point, ...wireWaypoints]
    : [];
  const wireDraftPoints =
    wireSource && wirePreviewPoint
      ? buildManualWirePath(
          wireSource,
          { point: wirePreviewPoint },
          wireWaypoints,
        ).points
      : wireFixedPoints;
  const projectInstanceCount = project.documents.reduce(
    (count, candidate) => count + candidate.instances.length,
    0,
  );
  const contentScene = buildSvgScene(document, resolver);
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
    const pruned = pruneVisualSelection(visualSelection, document);
    if (pruned !== visualSelection) replaceSelection(pruned);
  }, [document, visualSelection]);

  useEffect(() => {
    if (!selectedRoute) {
      setNetLabelDraft("");
      setNetLabelEditorOpen(false);
      return;
    }
    setNetLabelDraft(
      selectedRouteNetLabel
        ? flattenRichText(selectedRouteNetLabel.content)
        : "",
    );
  }, [selectedRoute, selectedRouteNetLabel]);

  useEffect(() => {
    if (!selectedInstance) {
      setInstancePropertyDraft({
        instanceId: null,
        parameters: {},
        x: "",
        y: "",
        rotation: "0",
      });
      return;
    }
    setInstancePropertyDraft({
      instanceId: selectedInstance.id,
      parameters: Object.fromEntries(
        componentParameters(selectedInstance.symbolId).map((parameter) => [
          parameter.key,
          effectiveComponentParameterValue(selectedInstance, parameter),
        ]),
      ),
      x: selectedInstance.placement
        ? String(selectedInstance.placement.position.x)
        : "",
      y: selectedInstance.placement
        ? String(selectedInstance.placement.position.y)
        : "",
      rotation: String(selectedInstance.placement?.rotation ?? 0) as
        "0" | "90" | "180" | "270",
    });
  }, [selectedInstance]);

  function openProperties(): void {
    setImportReviewOpen(false);
    setSelectionOpen(true);
    requestAnimationFrame(() => {
      if (selectedRoute) {
        netLabelPropertyInputRef.current?.focus();
      } else if (selectedInstance) {
        instanceValueInputRef.current?.focus();
      } else {
        selectionShelfRef.current?.focus();
      }
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

  function toggleLibraryPanel(): void {
    setLibraryPanelOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(LIBRARY_PANEL_STORAGE_KEY, String(next));
      } catch {
        // The Library remains usable when storage is unavailable.
      }
      return next;
    });
  }

  function resetInteractionState(): void {
    cancelAllTransientInteraction();
    resetSelection();
    setSelectedRouteSegmentIndex(null);
    setTextEditing(null);
    setSelectedEndpoint(null);
  }

  function cancelAllTransientInteraction(): void {
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
            ?.routeGeometry.get(route.id)?.centerline
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
            ?.routeGeometry.get(route.id)?.centerline
        : undefined;
      if (centerline?.[0]) focusPoint(centerline[0]);
    }
    setSelectionOpen(true);
    setStatus(statusMessage);
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
      setStatus(`${instanceId} has no imported child Cell`);
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

  function jumpToVisualDiagnostic(
    diagnostic: (typeof visualDiagnostics)[number],
  ): void {
    const ids = diagnostic.objectIds;
    const instanceIds = ids.filter((id) =>
      document.instances.some((instance) => instance.id === id),
    );
    const routeId = ids.find((id) =>
      document.routes.some((route) => route.id === id),
    );
    const annotationId = ids.find((id) =>
      document.annotations.some((annotation) => annotation.id === id),
    );
    replaceSelection({
      instanceIds,
      routeIds: routeId ? [routeId] : [],
      junctionIds: [],
      annotationIds: annotationId ? [annotationId] : [],
      draftingIds: [],
    });
    setSelectedEndpoint(null);
    const target =
      diagnostic.bounds ??
      (diagnostic.point
        ? {
            x: diagnostic.point.x - 60,
            y: diagnostic.point.y - 60,
            width: 120,
            height: 120,
          }
        : null);
    if (target) {
      const padding = 30;
      setViewBox({
        x: target.x - padding,
        y: target.y - padding,
        width: Math.max(160, target.width + padding * 2),
        height: Math.max(120, target.height + padding * 2),
      });
    }
    setStatus(`${diagnostic.code}: ${ids.join(", ") || "Document"}`);
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
    const result = transactDocument(edits);
    applyResult(result);
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

  function openInsertComponentDialog(): void {
    cancelAllTransientInteraction();
    setInsertDialogOpen(true);
    setStatus("Choose a component to place");
  }

  function beginInsertedComponentPlacement(
    request: ComponentInsertRequest,
  ): void {
    const { symbolId, symbolName } = request;
    const nextRecent = [
      symbolId,
      ...recentSymbolIds.filter((candidate) => candidate !== symbolId),
    ].slice(0, 8);
    setRecentSymbolIds(nextRecent);
    try {
      window.localStorage.setItem(
        RECENT_COMPONENTS_STORAGE_KEY,
        JSON.stringify(nextRecent),
      );
    } catch {
      // Browsers may deny storage in private or embedded contexts. Recency is
      // convenience-only and must never block component placement.
    }
    setInsertDialogOpen(false);
    canvasDragSessionRef.current?.cancel();
    clearTransientCanvasState();
    paintSnapGuides([]);
    if (request.kind === "vdd-rail") {
      beginVddRailInteraction();
      setStatus("Place VDD Rail: click the first end · Esc cancels");
      return;
    }
    beginComponentPlacement(request);
    setStatus(`Place ${symbolName} on the canvas · R rotates · Esc cancels`);
  }

  function cancelComponentInsert(): void {
    setInsertDialogOpen(false);
    cancelAllTransientInteraction();
    setStatus("Component insertion cancelled");
  }

  function rotatePendingComponent(delta: 90 | -90): void {
    rotateComponentPlacement(delta);
    setStatus(`Component rotation ${delta > 0 ? "+90°" : "−90°"}`);
  }

  function rotatePendingCopy(delta: 90 | -90): void {
    if (!copyPlacement) return;
    rotateCopyPlacement(delta);
    setStatus("Place rotated copy · R rotates · Esc cancels");
  }

  function loadRoutingDemo(): void {
    const demo = createRoutingDemoProject();
    replaceActiveProject(demo);
    setStatus("Loaded Phase 3 routing demo");
  }

  function handleWireEndpoint(
    event: ReactPointerEvent<SVGCircleElement>,
    candidate: WireSource,
  ): void {
    event.stopPropagation();
    if (event.altKey) {
      setStatus("Snap suppressed while Alt is held");
      return;
    }
    setTool("wire");
    if (!wireSource) {
      setWireSource(candidate, document.revision);
      setWirePreviewPoint(candidate.point);
      setWireWaypoints([]);
      setStatus(`Wire source: ${endpointTestId(candidate.endpoint)}`);
      return;
    }
    if (endpointKey(wireSource.endpoint) === endpointKey(candidate.endpoint)) {
      setStatus("Choose a different endpoint");
      return;
    }
    commitWire(candidate);
  }

  function handleFlightline(
    event: ReactMouseEvent<SVGLineElement>,
    flightline: Flightline,
  ): void {
    event.stopPropagation();
    const from: WireSource = {
      endpoint: flightline.from,
      netId: flightline.netId,
      point: flightline.fromPoint,
      preludeEdits: [],
      ...(flightline.from.kind === "terminal" && flightline.from.pinName === "B"
        ? { routePresentation: "bulk-dashed" }
        : {}),
    };
    const to: WireSource = {
      endpoint: flightline.to,
      netId: flightline.netId,
      point: flightline.toPoint,
      preludeEdits: [],
      ...(flightline.to.kind === "terminal" && flightline.to.pinName === "B"
        ? { routePresentation: "bulk-dashed" }
        : {}),
    };
    setTool("wire");
    if (wireSource) {
      const candidate =
        endpointKey(wireSource.endpoint) === endpointKey(from.endpoint)
          ? to
          : from;
      if (
        endpointKey(wireSource.endpoint) !== endpointKey(candidate.endpoint)
      ) {
        commitWire(candidate);
      }
      return;
    }
    setWireSource(from, document.revision);
    setWirePreviewPoint(to.point);
    setWireWaypoints([]);
    setStatus(`Wire source: flightline on ${flightline.netId}`);
  }

  function commitWire(candidate: WireSource): void {
    if (!wireSource) return;
    if (wireSourceRevision !== document.revision) {
      clearTransientCanvasState();
      cancelInteraction();
      setBulkDrawInstanceId(null);
      setStatus("Wire cancelled because its source revision is stale");
      return;
    }
    const suffix = nextRoutingSuffix();
    const proposal = proposeWireCommitThroughContacts(
      wireSource,
      candidate,
      wireWaypoints,
      visibleEndpoints.filter(
        (endpoint) => endpoint.endpoint.kind === "terminal",
      ),
      suffix,
    );
    const bulkEndpoint = [wireSource.endpoint, candidate.endpoint].find(
      (endpoint) => endpoint.kind === "terminal" && endpoint.pinName === "B",
    );
    const defaultBoundInstance =
      bulkEndpoint?.kind === "terminal"
        ? document.instances.find(
            (instance) => instance.id === bulkEndpoint.instanceId,
          )
        : undefined;
    const edits = defaultBoundInstance?.mosBulkBinding
      ? [
          {
            kind: "clear_mos_bulk_default" as const,
            instanceId: defaultBoundInstance.id,
          },
          ...proposal.edits.map((edit) => {
            if (edit.kind !== "connect_endpoints") return edit;
            const target =
              edit.from.kind === "terminal" && edit.from.pinName === "B"
                ? edit.to
                : edit.from;
            return {
              ...edit,
              from: target,
              to: {
                kind: "terminal" as const,
                instanceId: defaultBoundInstance.id,
                pinName: "B",
              },
            };
          }),
        ]
      : proposal.edits;
    const result = transact(edits, { completesWireSession: true });
    if (result.ok) {
      completeWire();
      setBulkDrawInstanceId(null);
      setStatus(
        `Committed route at revision ${result.revision} · Wire remains active · Esc exits`,
      );
    }
  }

  function drawSelectedMosBulk(): void {
    if (!selectedInstance?.placement) return;
    const resolved = resolver.resolve(
      selectedInstance.symbolId,
      selectedInstance.symbolVariantId,
    );
    const anchor = resolved?.variant?.auxiliaryPins?.find(
      (pin) => pin.name === "B",
    );
    if (!anchor) {
      setStatus("Selected instance has no Razavi bulk anchor");
      return;
    }
    const endpoint: RouteEndpoint = {
      kind: "terminal",
      instanceId: selectedInstance.id,
      pinName: "B",
    };
    const source: WireSource = {
      endpoint,
      // A materialized default is cleared in the same commit before the new
      // explicit route is connected. Treat it as unowned while planning so
      // the planner cannot merge VSS/VDD with the chosen body-bias Net.
      netId: selectedInstance.mosBulkBinding
        ? null
        : endpointNetId(document, endpoint),
      point: transformPoint(
        anchor.at,
        selectedInstance.placement.position,
        selectedInstance.placement,
      ),
      preludeEdits: document.noConnects.flatMap((noConnect) =>
        noConnect.endpoint.kind === "terminal" &&
        noConnect.endpoint.instanceId === selectedInstance.id &&
        noConnect.endpoint.pinName === "B"
          ? [{ kind: "remove_no_connect" as const, noConnectId: noConnect.id }]
          : [],
      ),
      routePresentation: "bulk-dashed",
    };
    setBulkDrawInstanceId(selectedInstance.id);
    setTool("wire");
    setWireSource(source, document.revision);
    setWirePreviewPoint(source.point);
    setWireWaypoints([]);
    setStatus(`Drawing ${selectedInstance.id}.B bulk connection`);
  }

  function freeWireAnchor(
    point: Point,
    netId: string,
    createNet: boolean,
  ): WireSource {
    return createFreeWireAnchor(point, netId, createNet, nextRoutingSuffix());
  }

  function fixWirePoint(point: Point): void {
    if (!wireSource) {
      const netId = `net-ui-${nextRoutingSuffix()}`;
      const source = freeWireAnchor(point, netId, true);
      setWireSource(source, document.revision);
      setWirePreviewPoint(point);
      setWireWaypoints([]);
      setStatus("Wire source: free grid point");
      return;
    }
    const fixed = buildManualWirePath(wireSource, { point }, wireWaypoints);
    // Keep the clicked point as an in-progress waypoint. The path builder
    // treats it as a fixed bend on the next click while retaining the source
    // terminal's escape segment.
    setWireWaypoints(fixed.points.slice(1));
    setWirePreviewPoint(point);
    setStatus(
      `Wire bend ${fixed.points.length - 1}; double-click or Enter to finish`,
    );
  }

  function finishWireAtPoint(point: Point): void {
    if (!wireSource) {
      fixWirePoint(point);
      return;
    }
    const netId = wireSource.netId ?? `net-ui-${nextRoutingSuffix()}`;
    commitWire(freeWireAnchor(point, netId, wireSource.netId === null));
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
    event.stopPropagation();
    if (event.altKey) {
      setStatus("Snap suppressed while Alt is held");
      return;
    }
    const routeRecord = routePolylines.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!routeRecord) return;
    const svg = hitTarget.ownerSVGElement!;
    const pointer = pointFromClient(event.clientX, event.clientY, svg, false);
    const tap = resolveRouteTap(
      routeRecord.polyline.points,
      pointer,
      logicalRadiusForPixels(svg, 7),
    );
    if (tool === "pointer") {
      const segmentIndex = tap?.segmentIndex ?? 0;
      selectRoute(routeId, segmentIndex);
      beginRouteStretch(
        event,
        routeId,
        segmentIndex,
        routeRecord.route.presentation === "power-rail"
          ? "power-rail-translate"
          : looseRouteAnchorIds(document, routeRecord.route) !== null
            ? "translate"
            : "segment",
        hitTarget,
      );
      return;
    }
    if (!tap) {
      setStatus("Wire must start or end inside a route segment");
      return;
    }
    const overlappingTargets = routePolylines.flatMap((candidate) => {
      const candidateTap = resolveRouteTap(
        candidate.polyline.points,
        pointer,
        logicalRadiusForPixels(svg, 7),
      );
      return candidateTap
        ? [
            {
              kind: "route" as const,
              id: `route:${candidate.route.id}:${candidateTap.segmentIndex}`,
              point: candidateTap.point,
              netId: candidate.route.netId,
              routeId: candidate.route.id,
              segmentIndex: candidateTap.segmentIndex,
            },
          ]
        : [];
    });
    if (
      resolveElectricalContactTargets(
        document,
        resolver,
        overlappingTargets,
        contactComponents,
      ).length > 1
    ) {
      setStatus(
        "Ambiguous intersection: choose one conductor away from the crossing",
      );
      return;
    }
    const anchor = routeAnchor(routeId, tap.point, tap.segmentIndex);
    if (!wireSource) {
      setWireSource(anchor, document.revision);
      setWirePreviewPoint(tap.point);
      setWireWaypoints([]);
      setStatus(`Wire source: route ${routeId}`);
    } else {
      commitWire(anchor);
    }
  }

  function selectRoute(routeId: string, segmentIndex = 0): void {
    selectOnly("route", [routeId]);
    setSelectedRouteSegmentIndex(segmentIndex);
    setSelectedEndpoint(null);
    setStatus(`Selected route ${routeId}, segment ${segmentIndex + 1}`);
  }

  function deleteSelectedRouteConnection(): void {
    if (!selectedRouteId) return;
    const route = document.routes.find(
      (candidate) => candidate.id === selectedRouteId,
    );
    if (!route) return;
    const result = transact(
      proposeVisualRouteDeletion(document, [route.id], []).edits,
    );
    if (result.ok) {
      replaceSelectionKind("route", []);
      setStatus(`Deleted wire ${route.id}`);
    }
  }

  function beginRouteStretch(
    event: ReactPointerEvent<SVGElement>,
    routeId: string,
    segmentIndex: number,
    kind: RouteStretchPreview["kind"] = "segment",
    hitTarget: SVGElement = event.currentTarget,
  ): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    canvasDragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const start = pointFromClient(event.clientX, event.clientY, svg, false);
    const record = routePolylines.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!record) return;
    const powerRail =
      kind === "power-rail-translate" ||
      kind === "power-rail-resize-start" ||
      kind === "power-rail-resize-end"
        ? derivePowerRailComponent(document, routeId)
        : null;
    const anchorIds =
      kind === "translate"
        ? (looseRouteAnchorIds(document, record.route) ?? [])
        : (powerRail?.junctionIds ?? []);
    const translatedRouteIds =
      kind === "power-rail-translate"
        ? (powerRail?.routeIds ?? [routeId])
        : [routeId];
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [
        ...translatedRouteIds,
        ...anchorIds,
      ]));
    const preview: RouteStretchPreview = {
      routeId,
      segmentIndex,
      kind,
      start,
      point: start,
    };
    setRouteStretchPreview(preview);
    canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => {
        const point = pointFromClient(client.x, client.y, svg, false);
        if (kind === "translate" || kind === "power-rail-translate") {
          dragVisual().translate({
            x: point.x - start.x,
            y: point.y - start.y,
          });
          return;
        }
        if (
          kind === "power-rail-resize-start" ||
          kind === "power-rail-resize-end"
        ) {
          // The persisted proposal resizes the outer rail fragment, which may
          // differ from the selected fragment after a tap. Avoid previewing a
          // misleading single-segment drag; the end handle remains the cue.
          return;
        }
        try {
          const proposal = moveRouteSegment(
            record.polyline,
            segmentIndex,
            point,
          );
          dragVisual().setPolyline([
            record.polyline.points[0]!,
            ...proposal.waypoints,
            record.polyline.points.at(-1)!,
          ]);
        } catch {
          // Keep the last valid preview; commit reports the geometry error.
        }
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        if (dragged) {
          completeRouteStretch(
            preview,
            pointFromClient(client.x, client.y, svg, false),
          );
        }
        setRouteStretchPreview(null);
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        setRouteStretchPreview(null);
      },
    });
  }

  function completeRouteStretch(
    preview: RouteStretchPreview,
    point: DerivedPoint,
  ): void {
    const record = routePolylines.find(
      (candidate) => candidate.route.id === preview.routeId,
    );
    if (!record) return;
    try {
      if (preview.kind === "translate") {
        const anchorIds = looseRouteAnchorIds(document, record.route);
        if (!anchorIds) {
          throw new Error(
            "Only a route with two loose ends can move as a whole",
          );
        }
        const delta = {
          x: snapCoordinate(
            point.x - preview.start.x,
            document.presentation.grid,
          ),
          y: snapCoordinate(
            point.y - preview.start.y,
            document.presentation.grid,
          ),
        };
        if (delta.x !== 0 || delta.y !== 0) {
          const result = transact(
            proposeLooseRouteTranslation(document, record.route.id, delta)
              .edits,
          );
          if (result.ok) setStatus(`Moved loose route ${record.route.id}`);
        }
      } else if (preview.kind === "power-rail-translate") {
        const delta = {
          x: snapCoordinate(
            point.x - preview.start.x,
            document.presentation.grid,
          ),
          y: snapCoordinate(
            point.y - preview.start.y,
            document.presentation.grid,
          ),
        };
        if (delta.x !== 0 || delta.y !== 0) {
          const result = transact(
            proposePowerRailTranslation(
              document,
              resolver,
              record.route.id,
              delta,
            ).edits,
          );
          if (result.ok) setStatus(`Moved VDD rail ${record.route.id}`);
        }
      } else if (
        preview.kind === "power-rail-resize-start" ||
        preview.kind === "power-rail-resize-end"
      ) {
        const result = transact(
          proposePowerRailEndpointResize(
            document,
            resolver,
            record.route.id,
            preview.kind === "power-rail-resize-start" ? "start" : "end",
            snapCoordinate(point.x, document.presentation.grid),
          ).edits,
        );
        if (result.ok) setStatus(`Resized VDD rail ${record.route.id}`);
      } else {
        const proposal = proposeWireSegmentMove(
          document,
          resolver,
          record.route.id,
          preview.segmentIndex,
          {
            x: snapCoordinate(point.x, document.presentation.grid),
            y: snapCoordinate(point.y, document.presentation.grid),
          },
        );
        const result = transact(proposal.edits);
        if (result.ok) setStatus(`Moved route segment ${record.route.id}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Route move failed");
    }
  }

  function constrainAnnotationPosition(
    annotation: Annotation,
    candidate: DerivedPoint,
  ): Point {
    if (
      annotation.kind === "instance-label" &&
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
      const candidates = routePolylines
        .filter(({ route }) => route.netId === annotation.netId)
        .flatMap(({ polyline }) =>
          polyline.points
            .slice(0, -1)
            .map((from, index) =>
              closestPointOnSegment(
                candidate,
                from,
                polyline.points[index + 1]!,
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
            x: clamp(candidate.x, closest.x - 30, closest.x + 30),
            y: clamp(candidate.y, closest.y - 30, closest.y + 30),
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
        routePolylines,
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
      ? routePolylines.find(
          ({ route }) => route.id === currentAttachment.routeId,
        )
      : undefined;
    const markerPlacement =
      record && currentAttachment
        ? routeAttachmentPlacement(record.polyline, currentAttachment)
        : null;
    const preview: AnnotationDragPreview = {
      annotationId: annotation.id,
      originalPosition: {
        ...(isRoutedMarker(annotation) && markerPlacement
          ? markerPlacement.labelPosition
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
        if (isRoutedMarker(annotation)) {
          setAnnotationDragPreview(
            draggedAnnotationAtPosition(annotation, position),
          );
          return;
        }
        dragVisual().translate({
          x: position.x - preview.originalPosition.x,
          y: position.y - preview.originalPosition.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        setAnnotationDragPreview(null);
        if (dragged) {
          completeAnnotationDrag(preview, positionAt(client.x, client.y));
        }
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        setAnnotationDragPreview(null);
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
    const routeTargets = routePolylines.flatMap(({ route, polyline }) =>
      polyline.points.slice(0, -1).map((from, segmentIndex) => ({
        anchor: {
          id: `wire-route:${route.id}:${segmentIndex}`,
          point: closestPointOnSegment(
            point,
            from,
            polyline.points[segmentIndex + 1]!,
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
        setWireWaypoints([]);
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
        setWireWaypoints([]);
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
    if (tool !== "pointer" || event.button !== 0) return;
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
        beginMove(event, primaryInstanceId, hitTarget);
        return;
      }
    }

    if (hit.kind === "instance") {
      beginMove(event, hit.id, hitTarget);
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
    transact([
      {
        kind: "place_instance",
        instanceId,
        placement: {
          position: pointFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
          ),
          rotation: 0,
          mirror: "none",
        },
      },
    ]);
    selectOnly("instance", [instanceId]);
  }

  function placeNewComponent(
    symbolId: string,
    position: Point,
    placementRequest: NonNullable<typeof pendingComponentPlacement>,
  ): void {
    instanceCounter.current += 1;
    const prefix: Record<string, string> = {
      resistor: "R",
      capacitor: "C",
      nmos: "M",
      pmos: "M",
      "voltage-source": "V",
      "current-source": "I",
      ground: "GND",
      port: "P",
      "port-filled": "P",
    };
    let id = `${prefix[symbolId] ?? "X"}${instanceCounter.current}`;
    while (document.instances.some((instance) => instance.id === id)) {
      instanceCounter.current += 1;
      id = `${prefix[symbolId] ?? "X"}${instanceCounter.current}`;
    }
    const symbolVariantId = defaultRazaviSymbolVariantId(symbolId);
    const instance = {
      id,
      symbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      placement: {
        position,
        rotation: componentPlacementRotation,
        mirror: "none" as const,
      },
      properties: placementRequest.properties,
      netlist: initialInstanceNetlist(
        document,
        symbolId,
        placementRequest.properties,
      ),
    };
    // The persisted annotation is the only visible instance-label authority.
    const defaultLabel = defaultInstanceLabel(
      document,
      instance,
      resolver,
      styleProfile,
    );
    const instanceLabel =
      placementRequest.showReference && defaultLabel
        ? {
            ...defaultLabel,
            content: semanticTextDocument(
              placementRequest.referenceText ?? instance.id,
              "instance-label",
            ),
          }
        : null;
    const contact = proposePlacementContact(
      document,
      resolver,
      instance,
      visibleEndpoints,
    );
    const standalonePower =
      contact.matched || contact.ambiguous
        ? { edits: [], matched: false, ambiguous: false }
        : proposedStandalonePowerConnection(document, instance);
    // Build only the future global-Net facts needed to decide hidden B policy.
    // The real transaction below remains the sole persistence boundary.
    const projectedDocument = structuredClone(document);
    projectedDocument.instances.push(instance);
    for (const edit of [...contact.edits, ...standalonePower.edits]) {
      if (edit.kind !== "connect_endpoints" || !edit.newNetId) continue;
      projectedDocument.nets.push({
        id: edit.newNetId,
        ...(edit.newNetName ? { name: edit.newNetName } : {}),
        scope: edit.newNetScope ?? "local",
        terminals: [edit.from, edit.to]
          .filter(
            (
              endpoint,
            ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
              endpoint.kind === "terminal",
          )
          .map(({ instanceId, pinName }) => ({ instanceId, pinName }))
          .filter(
            (terminal, index, terminals) =>
              terminals.findIndex(
                (candidate) =>
                  candidate.instanceId === terminal.instanceId &&
                  candidate.pinName === terminal.pinName,
              ) === index,
          ),
      });
    }
    const bulkEdits = razaviManualBulkConnectionEdits(
      projectedDocument,
      projectedDocument.instances,
    );
    const result = transact(
      [
        {
          kind: "add_instance",
          instance,
        },
        ...contact.edits,
        ...standalonePower.edits,
        ...bulkEdits,
        ...(instanceLabel
          ? [
              {
                kind: "upsert_schematic_annotation" as const,
                annotation: instanceLabel,
              },
            ]
          : []),
      ],
      { preserveInteraction: true },
    );
    if (result.ok) {
      selectOnly("instance", [id]);
      setComponentPreviewPoint(position);
      setStatus(
        contact.ambiguous
          ? `Added ${id} (${symbolId}); overlapping pins are ambiguous, wire explicitly · click to place another · Esc exits`
          : contact.matched
            ? `Added ${id} (${symbolId}) and connected its contacted pin · click to place another · Esc exits`
            : `Added ${id} (${symbolId}) · click to place another · Esc exits`,
      );
    }
  }

  function placeVddRail(start: Point, end: Point): void {
    instanceCounter.current += 1;
    let instanceId = `VDD${instanceCounter.current}`;
    const vddRailIdsExist = (candidate: string): boolean => {
      const key = candidate.toLowerCase();
      return (
        document.instances.some((instance) => instance.id === candidate) ||
        document.routes.some((route) => route.id === `route-${key}-rail`) ||
        document.junctions.some(
          (junction) =>
            junction.id === `junction-${key}-start` ||
            junction.id === `junction-${key}-end`,
        ) ||
        document.annotations.some(
          (annotation) => annotation.id === `label-${candidate}`,
        )
      );
    };
    while (vddRailIdsExist(instanceId)) {
      instanceCounter.current += 1;
      instanceId = `VDD${instanceCounter.current}`;
    }
    const routeId = `route-${instanceId.toLowerCase()}-rail`;
    const existingVddNet =
      document.nets.find(
        (net) =>
          net.id === "net-global-vdd" &&
          net.scope === "global" &&
          (net.powerDomain ?? "none") === "vdd",
      ) ??
      document.nets.find(
        (net) =>
          net.scope === "global" && (net.powerDomain ?? "none") === "vdd",
      );
    const result = transact(
      constructVddRailEdits({
        instanceId,
        start,
        end,
        ...(existingVddNet ? { netId: existingVddNet.id } : {}),
      }),
    );
    if (!result.ok) return;
    selectOnly("route", [routeId]);
    completeVddRailPlacement();
    setStatus(`Added VDD rail ${instanceId}`);
  }

  function commitPendingPlacementAt(point: Point): void {
    if (vddRailMode) {
      if (!vddRailStart) {
        setVddRailStart(point);
        setVddRailPreviewPoint(point);
        setStatus("VDD rail: click the right end (Esc cancels)");
      } else if (point.x === vddRailStart.x) {
        setStatus("VDD rail needs a non-zero horizontal length");
      } else {
        placeVddRail(vddRailStart, { x: point.x, y: vddRailStart.y });
      }
      return;
    }
    if (!pendingSymbolId || !pendingComponentPlacement) return;
    placeNewComponent(pendingSymbolId, point, pendingComponentPlacement);
  }

  function selectInstance(instanceId: string, additive: boolean): void {
    setSelectedEndpoint(null);
    updateInstanceSelection(instanceId, additive);
  }

  function beginMove(
    event: ReactPointerEvent<SVGElement>,
    instanceId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void {
    if (tool !== "pointer" || event.button !== 0) return;
    event.stopPropagation();
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) {
      return;
    }
    const hasSelectionModifier =
      event.shiftKey || event.ctrlKey || event.metaKey;
    suppressInstanceClick.current =
      hitTarget.getAttribute("data-canvas-hit-kind") === "instance";
    if (hasSelectionModifier) {
      selectInstance(instanceId, hasSelectionModifier);
      setStatus(`Selected ${instanceId}`);
      return;
    }
    const movingIds = selectedIds.includes(instanceId)
      ? selectedIds
      : [instanceId];
    if (!selectedIds.includes(instanceId)) selectInstance(instanceId, false);
    canvasDragSessionRef.current?.cancel();
    const svg = hitTarget.ownerSVGElement!;
    const pointerStart = pointFromClient(
      event.clientX,
      event.clientY,
      svg,
      false,
    );
    const preview: DragPreview = {
      instanceIds: movingIds,
      primaryInstanceId: instanceId,
      originalPositions: Object.fromEntries(
        movingIds.map((id) => {
          const candidate = document.instances.find((item) => item.id === id)!;
          return [id, { ...candidate.placement!.position }];
        }),
      ),
      pointerStart,
    };
    const attachedAnnotationIds = document.annotations
      .filter(
        (annotation) =>
          annotation.anchor.kind === "object" &&
          movingIds.includes(annotation.anchor.objectId),
      )
      .map((annotation) => annotation.id);
    const movingInternalSelection = deriveInternalGroupSelection(
      document,
      movingIds,
    );
    const movingInternalObjectIds = new Set([
      ...movingInternalSelection.netIds,
      ...movingInternalSelection.routeIds,
      ...movingInternalSelection.junctionIds,
    ]);
    const movingInternalAnnotationIds = document.annotations
      .filter((annotation) => {
        const routeAttachment = effectiveRouteAttachment(annotation);
        return (
          (annotation.anchor.kind === "object" &&
            movingInternalObjectIds.has(annotation.anchor.objectId)) ||
          (routeAttachment !== null &&
            movingInternalSelection.routeIds.includes(routeAttachment.routeId))
        );
      })
      .map((annotation) => annotation.id);
    let visual: ReturnType<typeof startCanvasDragVisual> | null = null;
    const dragVisual = () =>
      (visual ??= startCanvasDragVisual(svg, [
        ...new Set([
          ...movingIds,
          ...movingInternalSelection.routeIds,
          ...movingInternalSelection.junctionIds,
          ...attachedAnnotationIds,
          ...movingInternalAnnotationIds,
        ]),
      ]));
    const tolerance = logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX);
    let lastSnap: SnapResult | undefined;
    canvasDragSessionRef.current = startCanvasDragSession({
      target: hitTarget,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      thresholdPx: DRAG_START_DISTANCE_PX,
      onPreview: (client) => {
        const position = pointFromClient(client.x, client.y, svg, false);
        const resolved = instanceMoveAt(
          preview,
          position,
          tolerance,
          Boolean(client.altKey),
          lastSnap,
        );
        lastSnap = resolved.snap;
        paintSnapGuides(resolved.snap.guides);
        const primary = resolved.moves.find(
          (move) => move.instanceId === preview.primaryInstanceId,
        )!;
        const original = preview.originalPositions[preview.primaryInstanceId]!;
        dragVisual().translate({
          x: primary.position.x - original.x,
          y: primary.position.y - original.y,
        });
      },
      onFinish: ({ client, dragged }) => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
        if (dragged) {
          completeInstanceMove(
            preview,
            pointFromClient(client.x, client.y, svg, false),
            tolerance,
            Boolean(client.altKey),
            lastSnap,
          );
        }
      },
      onCancel: () => {
        canvasDragSessionRef.current = null;
        visual?.restore();
        paintSnapGuides([]);
      },
    });
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
          return routePolylines.flatMap(({ route, polyline }) => {
            const belongsToMovingInstance = [route.from, route.to].some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                movingIds.has(endpoint.instanceId),
            );
            if (belongsToMovingInstance) return [];
            return polyline.points
              .slice(0, -1)
              .flatMap((from, segmentIndex) => {
                const point = closestPointOnSegment(
                  movedPoint,
                  from,
                  polyline.points[segmentIndex + 1]!,
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
        const result = transact([...groupMove.edits, ...contactEdits]);
        if (result.ok && electricalMatch) {
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
  ): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeExportBaseName(project.name)}.${extension}`;
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
    setRecoveryBannerDismissed(true);
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
      setRecoveryBannerDismissed(true);
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
      setRecoveryBannerDismissed(true);
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
      setImportDiagnostics([]);
      setImportReviewOpen(false);
      setStatus(
        `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
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
    if (result.ok) {
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
    const record = routePolylines.find(
      ({ route }) => route.id === selectedRoute.id,
    );
    const from = record?.polyline.points[segmentIndex];
    const to = record?.polyline.points[segmentIndex + 1];
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

  function applyNetLabel(): void {
    if (!selectedRoute) return;
    const net = document.nets.find(
      (candidate) => candidate.id === selectedRoute.netId,
    );
    if (!net) return;
    const existingLabel = selectedRouteNetLabel;
    const labelId = existingLabel?.id ?? `net-label-${selectedRoute.id}`;
    const name = netLabelDraft.trim();
    if (!name) {
      if (existingLabel) {
        const result = transact([
          {
            kind: "remove_schematic_annotation",
            annotationId: existingLabel.id,
          },
        ]);
        if (result.ok) {
          replaceSelectionKind("annotation", []);
          setStatus(
            `Deleted Net Label ${flattenRichText(existingLabel.content)}`,
          );
        }
      } else {
        setStatus("Selected Route has no Net Label");
      }
      return;
    }
    const sameNameNet = document.nets.find(
      (candidate) => candidate.id !== net.id && candidate.name === name,
    );
    const targetNetId = sameNameNet?.id ?? net.id;
    const polyline = routePolylines.find(
      ({ route }) => route.id === selectedRoute.id,
    )?.polyline;
    if (!polyline) return;
    const segment = Math.max(0, Math.floor((polyline.points.length - 1) / 2));
    const from = polyline.points[segment]!;
    const to = polyline.points[segment + 1] ?? from;
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
    const edits: SchematicEdit[] = sameNameNet
      ? [
          {
            kind: "merge_nets",
            targetNetId,
            sourceNetId: net.id,
          },
        ]
      : [{ kind: "set_net_name", netId: net.id, name }];
    edits.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        id: labelId,
        kind: "net-label",
        content: semanticTextDocument(name, "net-label"),
        netId: targetNetId,
        anchor: {
          kind: "route",
          routeId: selectedRoute.id,
          segmentIndex: segment,
          t: 0.5,
          normalOffset: -8,
          direction: "forward",
          orientation: "follow",
          fallbackPosition: position,
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    });
    const result = transact(edits);
    if (result.ok) {
      replaceSelectionKind("annotation", [labelId]);
      setStatus(
        sameNameNet
          ? `Connected Nets through label ${name}`
          : `Named Net ${name}`,
      );
    }
  }

  function deleteSelectedRouteNetLabel(): void {
    if (!selectedRoute) return;
    const label = selectedRouteNetLabel;
    if (!label) {
      setStatus(
        selectedRouteNetLabels.length > 1
          ? "This Net has multiple labels; select the label to delete"
          : "Selected Route has no Net Label",
      );
      return;
    }
    const result = transact([
      { kind: "remove_schematic_annotation", annotationId: label.id },
    ]);
    if (result.ok) {
      replaceSelectionKind("annotation", []);
      setNetLabelDraft("");
      setStatus(`Deleted Net Label ${flattenRichText(label.content)}`);
    }
  }

  function applyInstanceProperties(): void {
    if (
      !selectedInstance ||
      instancePropertyDraft.instanceId !== selectedInstance.id
    ) {
      return;
    }
    const edits: SchematicEdit[] = [];
    const baseNetlist =
      selectedInstance.netlist ??
      initialInstanceNetlist(
        document,
        selectedInstance.symbolId,
        selectedInstance.properties,
      );
    const netlistParameters = { ...baseNetlist.parameters };
    for (const parameter of componentParameters(selectedInstance.symbolId)) {
      const value = (
        instancePropertyDraft.parameters[parameter.key] ?? ""
      ).trim();
      if (value === "") delete netlistParameters[parameter.key];
      else netlistParameters[parameter.key] = value;
    }

    const nextNetlist = {
      ...baseNetlist,
      parameters: netlistParameters,
    };
    if (
      JSON.stringify(nextNetlist) !== JSON.stringify(selectedInstance.netlist)
    ) {
      edits.push({
        kind: "set_instance_netlist",
        instanceId: selectedInstance.id,
        netlist: nextNetlist,
      });
    }

    if (selectedInstance.placement) {
      const x = Number(instancePropertyDraft.x);
      const y = Number(instancePropertyDraft.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        setStatus("Position must contain finite X and Y coordinates");
        return;
      }
      const position = {
        x: snapCoordinate(x, document.presentation.grid),
        y: snapCoordinate(y, document.presentation.grid),
      };
      if (
        position.x !== selectedInstance.placement.position.x ||
        position.y !== selectedInstance.placement.position.y
      ) {
        edits.push({
          kind: "move_instance",
          instanceId: selectedInstance.id,
          position,
        });
      }
      const rotation = Number(instancePropertyDraft.rotation) as
        0 | 90 | 180 | 270;
      if (rotation !== selectedInstance.placement.rotation) {
        edits.push({
          kind: "rotate_instance",
          instanceId: selectedInstance.id,
          rotation,
        });
      }
    }

    if (edits.length === 0) {
      setStatus("Component properties are unchanged");
      return;
    }
    const result = transact(edits);
    if (result.ok) setStatus(`Updated properties for ${selectedInstance.id}`);
  }

  function discardInstancePropertyDraft(): void {
    if (!selectedInstance) return;
    setInstancePropertyDraft({
      instanceId: selectedInstance.id,
      parameters: Object.fromEntries(
        componentParameters(selectedInstance.symbolId).map((parameter) => [
          parameter.key,
          effectiveComponentParameterValue(selectedInstance, parameter),
        ]),
      ),
      x: selectedInstance.placement
        ? String(selectedInstance.placement.position.x)
        : "",
      y: selectedInstance.placement
        ? String(selectedInstance.placement.position.y)
        : "",
      rotation: String(selectedInstance.placement?.rotation ?? 0) as
        "0" | "90" | "180" | "270",
    });
    setStatus(`Discarded property edits for ${selectedInstance.id}`);
  }

  function beginNetLabelEditing(): void {
    if (!selectedRoute || wireSource) {
      setStatus("Select a wire segment before adding a Net Label");
      return;
    }
    setNetLabelEditorOpen(true);
    requestAnimationFrame(() => netLabelEditorInputRef.current?.focus());
  }

  function commitNetLabelEditing(): void {
    applyNetLabel();
    setNetLabelEditorOpen(false);
  }

  function beginAnnotationTextEditing(annotation: Annotation): void {
    selectOnly("annotation", [annotation.id]);
    setTextEditing(
      createTextEditingSession({
        owner: "annotation",
        object: annotation,
      }),
    );
  }

  function beginDraftingTextEditing(
    object: Extract<DraftingObject, { kind: "text" }>,
  ): void {
    selectDraftingObject(object.id);
    setTextEditing(
      createTextEditingSession({
        owner: "drafting",
        object,
      }),
    );
  }

  function updateTextEditing(
    change: Partial<Pick<TextEditingSession, "content" | "sizeScale">>,
  ): void {
    setTextEditing((current) =>
      current ? updateTextEditingSession(current, change) : null,
    );
  }

  function deleteTextEditing(): void {
    if (!textEditing) return;
    const result = transact([textDeletionEdit(textEditing)]);
    if (result.ok) {
      clearSelectionKinds(["annotation", "drafting"]);
      setTextEditing(null);
      setStatus(`Deleted text ${textEditing.id}`);
    }
  }

  function commitTextEditing(): void {
    if (!textEditing) return;
    const proposal = proposeTextEditingCommit(document, textEditing);
    if (proposal.kind === "blocked") return;
    if (proposal.kind === "unchanged") {
      setTextEditing(null);
      return;
    }
    const result = transact([proposal.edit]);
    if (!result.ok) return;
    if (proposal.kind === "delete") {
      clearSelectionKinds(["annotation", "drafting"]);
      setStatus(`Deleted text ${proposal.id}`);
    } else {
      setStatus(`Updated text ${proposal.id}`);
    }
    setTextEditing(null);
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
      setImportDiagnostics(result.diagnostics);
      if (!result.project || !result.successful) {
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
        setImportReviewOpen(true);
        setSelectionOpen(true);
        setStatus(
          `Imported ${result.project!.documents.length} Documents and ${instanceCount} Razavi-supported instances`,
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  }

  function fitView(): void {
    setViewBox(
      fitCameraToBounds(contentScene.viewBox, document.presentation.grid),
    );
    setStatus("Fit Document");
  }

  function zoomViewAtCenter(factor: number): void {
    setViewBox((current) => {
      const center = {
        x: current.x + current.width / 2,
        y: current.y + current.height / 2,
      };
      const width = Math.max(
        120,
        Math.min(5000, Math.round(current.width * factor)),
      );
      const height = Math.max(
        80,
        Math.min(3500, Math.round(current.height * factor)),
      );
      return {
        x: Math.round(center.x - width / 2),
        y: Math.round(center.y - height / 2),
        width,
        height,
      };
    });
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>): void {
    // Ctrl/Command+wheel is a browser-reserved page-zoom gesture. The canvas
    // owns an unmodified wheel gesture only while the pointer is over it, so
    // schematic navigation stays useful without fighting the host browser.
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratioX = (event.clientX - bounds.left) / bounds.width;
    const ratioY = (event.clientY - bounds.top) / bounds.height;
    const factor = event.deltaY < 0 ? 0.88 : 1.14;
    setViewBox((current) => {
      const width = Math.max(
        120,
        Math.min(5000, Math.round(current.width * factor)),
      );
      const height = Math.max(
        80,
        Math.min(3500, Math.round(current.height * factor)),
      );
      const cursorX = current.x + ratioX * current.width;
      const cursorY = current.y + ratioY * current.height;
      return {
        x: Math.round(cursorX - ratioX * width),
        y: Math.round(cursorY - ratioY * height),
        width,
        height,
      };
    });
  }

  function beginCanvasGesture(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanPreview({
        clientStart: { x: event.clientX, y: event.clientY },
        viewBoxStart: viewBox,
        pointerId: event.pointerId,
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
    setBoxPreview({ start: point, end: point, pointerId: event.pointerId });
  }

  function continueCanvasGesture(
    event: ReactPointerEvent<SVGSVGElement>,
  ): void {
    if (panPreview?.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const dx =
        ((event.clientX - panPreview.clientStart.x) / bounds.width) *
        panPreview.viewBoxStart.width;
      const dy =
        ((event.clientY - panPreview.clientStart.y) / bounds.height) *
        panPreview.viewBoxStart.height;
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
    if (vddRailMode) {
      setVddRailPreviewPoint(
        vddRailStart
          ? {
              x: snapCoordinate(point.x, document.presentation.grid),
              y: vddRailStart.y,
            }
          : point,
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
    if (panPreview?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      setPanPreview(null);
      return;
    }
    if (boxPreview?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const rect = normalizedRect(boxPreview.start, boxPreview.end);
    const clicked =
      rect.width <= document.presentation.grid &&
      rect.height <= document.presentation.grid;
    const ids = clicked
      ? []
      : [
          ...new Set(
            document.instances
              .filter((instance) => {
                const bounds = instanceHitBox(instance, resolver);
                return bounds !== null && rectsIntersect(bounds, rect);
              })
              .map((instance) => instance.id),
          ),
        ];
    const supplemental = clicked
      ? EMPTY_SUPPLEMENTAL_SELECTION
      : {
          routeIds: routePolylines
            .filter(({ polyline }) =>
              rectsIntersect(polylineBounds(polyline.points), rect),
            )
            .map(({ route }) => route.id),
          junctionIds: document.junctions
            .filter((junction) => pointInRect(junction.position, rect))
            .map((junction) => junction.id),
          annotationIds: document.annotations
            .filter((annotation) =>
              rectsIntersect(
                annotationHitBox(
                  annotation,
                  annotationAnchor(
                    document,
                    resolver,
                    annotation,
                    routePolylines,
                    styleProfile,
                  ),
                  routePolylines,
                  styleProfile,
                ),
                rect,
              ),
            )
            .map((annotation) => annotation.id),
          draftingIds: (document.drafting?.objects ?? [])
            .filter((object) => {
              const geometry = resolveDraftingObjectGeometry(
                document,
                resolver,
                object,
              );
              return geometry.kind === "rectangle"
                ? rectangleBoundaryIntersectsRect(geometry.corners, rect)
                : rectsIntersect(geometry.bounds, rect);
            })
            .map((object) => object.id),
        };
    replaceSelection({
      instanceIds: ids,
      ...supplemental,
    });
    setSelectedEndpoint(null);
    setBoxPreview(null);
    const count =
      ids.length +
      supplemental.routeIds.length +
      supplemental.junctionIds.length +
      supplemental.annotationIds.length +
      supplemental.draftingIds.length;
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
    const routeTargets = routePolylines.flatMap(({ route, polyline }) =>
      polyline.points.slice(0, -1).map((from, segmentIndex) => ({
        id: `route:${route.id}:${segmentIndex}`,
        point: closestPointOnSegment(
          point,
          from,
          polyline.points[segmentIndex + 1]!,
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

  function deleteSelection(): void {
    const initialRouteIds = new Set(visualSelection.routeIds);
    const selectedAnnotationIds = new Set(visualSelection.annotationIds);
    const selectedDraftingIds = new Set(visualSelection.draftingIds);
    const selectedJunctionIds = new Set([
      ...visualSelection.junctionIds,
      ...(selectedEndpoint?.endpoint.kind === "junction"
        ? [selectedEndpoint.endpoint.junctionId]
        : []),
    ]);
    const hasMixedSelection =
      initialRouteIds.size > 0 ||
      selectedAnnotationIds.size > 0 ||
      selectedDraftingIds.size > 0 ||
      selectedJunctionIds.size > 0;
    if (
      initialRouteIds.size === 1 &&
      selectedAnnotationIds.size === 0 &&
      selectedDraftingIds.size === 0 &&
      selectedJunctionIds.size === 0 &&
      selectedIds.length === 0
    ) {
      deleteSelectedRouteConnection();
      return;
    }
    if (hasMixedSelection) {
      const visualRouteDeletion = proposeVisualRouteDeletion(
        document,
        [...initialRouteIds],
        [...selectedJunctionIds],
      );
      uniqueSuffixCounter.current += 1;
      try {
        const instanceEdits =
          selectedIds.length > 0
            ? proposeConnectedInstanceDeletion(
                document,
                resolver,
                selectedIds,
                uniqueSuffixCounter.current,
              )
            : [];
        // Instance deletion already removes every annotation attached to the
        // instance. A marquee can select both visual objects, but emitting the
        // same remove_schematic_annotation edit twice makes the second
        // operation fail
        // with OBJECT_NOT_FOUND and rolls back the whole transaction.
        const explicitAnnotationIds = explicitAnnotationRemovals(
          document,
          selectedIds,
          [...selectedAnnotationIds].filter(
            (annotationId) =>
              !visualRouteDeletion.annotationIds.includes(annotationId),
          ),
        );
        const result = transact([
          ...instanceEdits,
          ...visualRouteDeletion.edits,
          ...explicitAnnotationIds.map((annotationId): SchematicEdit => ({
            kind: "remove_schematic_annotation",
            annotationId,
          })),
          ...[...selectedDraftingIds].map((objectId): SchematicEdit => ({
            kind: "remove_drafting_object",
            objectId,
          })),
        ]);
        if (result.ok) {
          resetSelection();
          setSelectedEndpoint(null);
          setStatus("Deleted selected schematic objects");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Delete failed");
      }
      return;
    }
    if (selectedEndpoint?.endpoint.kind === "junction") {
      deleteSelectedJunction();
      return;
    }
    if (selectedAnnotationId) {
      deleteSelectedAnnotation();
      return;
    }
    if (selectedDraftingId) {
      const result = transact([
        { kind: "remove_drafting_object", objectId: selectedDraftingId },
      ]);
      if (result.ok) {
        replaceSelectionKind("drafting", []);
        setStatus(`Deleted drafting object ${selectedDraftingId}`);
      }
      return;
    }
    if (selectedRouteId) {
      deleteSelectedRouteConnection();
      return;
    }
    if (selectedIds.length === 0) return;
    uniqueSuffixCounter.current += 1;
    try {
      const result = transact(
        proposeConnectedInstanceDeletion(
          document,
          resolver,
          selectedIds,
          uniqueSuffixCounter.current,
        ),
      );
      if (result.ok) {
        replaceSelectionKind("instance", []);
        setStatus(
          "Deleted component selection; connected wires remain dangling",
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function deleteSelectedJunction(): void {
    if (selectedEndpoint?.endpoint.kind !== "junction") return;
    const junctionId = selectedEndpoint.endpoint.junctionId;
    const proposal = proposeVisualRouteDeletion(document, [], [junctionId]);
    const result = transact(proposal.edits);
    if (result.ok) {
      setSelectedEndpoint(null);
      setStatus(
        `Deleted junction and ${proposal.routeIds.length} attached routes`,
      );
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
            kind: "make_flightline",
            routeId: route.id,
          }))
      : [];
    const result = transact([
      ...routeEdits,
      { kind: "disconnect_endpoint", endpoint: selectedEndpoint.endpoint },
    ]);
    if (result.ok) {
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

  function toggleSelectedNoConnect(): void {
    if (!selectedEndpoint || selectedEndpoint.endpoint.kind === "junction") {
      return;
    }
    if (selectedNoConnect) {
      const result = transact([
        { kind: "remove_no_connect", noConnectId: selectedNoConnect.id },
      ]);
      if (result.ok) {
        setStatus(
          `Cleared No Connect on ${endpointTestId(selectedEndpoint.endpoint)}`,
        );
      }
      return;
    }
    if (selectedEndpointNetId) {
      setStatus("Disconnect this endpoint before marking it No Connect");
      return;
    }
    const result = transact([
      {
        kind: "add_no_connect",
        noConnect: {
          id: nextNoConnectId(),
          endpoint: selectedEndpoint.endpoint,
        },
      },
    ]);
    if (result.ok) {
      setStatus(
        `Marked ${endpointTestId(selectedEndpoint.endpoint)} No Connect`,
      );
    }
  }

  function beginCopyPlacement(): void {
    const currentInteraction = getCurrentInteractionState();
    if (currentInteraction.kind === "copy-placement") {
      setStatus("Copy placement is already active · Esc cancels");
      return;
    }
    if (currentInteraction.kind !== "idle") {
      setStatus("Finish or cancel the active tool before copying");
      return;
    }
    const copied = copySelection(document, selectedIds);
    if (!copied) {
      setStatus("Select at least one component to copy");
      return;
    }
    const anchor = clipboardPlacementAnchor(copied);
    if (!anchor) {
      setStatus("Selected components have no placeable origin");
      return;
    }
    canvasDragSessionRef.current?.cancel();
    clearTransientCanvasState();
    paintSnapGuides([]);
    beginCopyPlacementInteraction(copied, anchor);
    setStatus(
      `Place copy of ${copied.instances.length} components · R rotates · Esc cancels`,
    );
  }

  function commitCopyPlacement(point: Point): void {
    if (!copyPlacement) return;
    copyCounter.current += 1;
    const proposal = proposePaste(
      document,
      copyPlacement.clipboard,
      {
        x: point.x - copyPlacement.anchor.x,
        y: point.y - copyPlacement.anchor.y,
      },
      copyCounter.current,
    );
    if (proposal.errors.length > 0) {
      copyCounter.current -= 1;
      setStatus(proposal.errors[0]!);
      cancelAllTransientInteraction();
      return;
    }
    const rotationEdits: SchematicEdit[] =
      copyPlacement.rotation === 0
        ? []
        : proposal.instanceIds.map((instanceId, index) => ({
            kind: "rotate_instance" as const,
            instanceId,
            rotation: (((copyPlacement.clipboard.instances[index]?.placement
              ?.rotation ?? 0) +
              copyPlacement.rotation) %
              360) as 0 | 90 | 180 | 270,
          }));
    const result = transact([...proposal.edits, ...rotationEdits], {
      preserveInteraction: true,
    });
    if (result.ok) {
      selectOnly("instance", proposal.instanceIds);
      setCopyPreviewPoint(point);
      setStatus(
        `Copied ${proposal.instanceIds.length} components · click to place another · Esc exits`,
      );
    }
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
        setTextEditing(null);
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
      if (event.key === "Escape" && dismissOpenCommandMenus()) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && textEditing) {
        event.preventDefault();
        setTextEditing(null);
        setStatus("Cancelled text editing");
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
        hasRouteSelection: Boolean(selectedRoute),
        hasHighlightableNet: selectedHighlightNetId !== null,
        wireReadyToFinish: Boolean(wireSource && wirePreviewPoint),
        draftingReadyToFinish:
          (tool === "arrow" ||
            tool === "construction-line" ||
            tool === "rectangle") &&
          draftingSource !== null,
        helpOpen,
        canvasDragActive: canvasDragSessionRef.current !== null,
        hasClearableDraftingSelection:
          selectedDrafting?.kind === "arrow" ||
          selectedDrafting?.kind === "construction-line" ||
          selectedDrafting?.kind === "rectangle",
        hasRemovableWireWaypoint: Boolean(
          wireSource && wireWaypoints.length > 0,
        ),
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
        case "undo":
        case "redo":
          transact([{ kind: shortcut.kind }]);
          return;
        case "copy":
          beginCopyPlacement();
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
        case "reverse-current-marker":
          reverseSelectedCurrentArrow();
          return;
        case "open-component-insert":
          openInsertComponentDialog();
          return;
        case "rotate-placement":
          rotatePendingComponent(shortcut.deltaDegrees);
          return;
        case "rotate-copy-placement":
          rotatePendingCopy(shortcut.deltaDegrees);
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
        case "finish-drafting":
          finishDraftingCreate();
          return;
        case "close-help":
          closeHelp();
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
                ? "VDD rail cancelled"
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
          setWireWaypoints(wireWaypoints.slice(0, -1));
          setStatus("Removed last wire bend");
          return;
        case "blocked-interaction-command":
          setStatus(
            `${shortcut.command} is unavailable while an active tool owns the canvas · Esc cancels`,
          );
          return;
        case "delete-selection":
          deleteSelection();
          return;
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  useEffect(() => {
    if (helpOpen) helpCloseRef.current?.focus();
  }, [helpOpen]);

  function closeHelp(): void {
    setHelpOpen(false);
    requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function closeSearch(): void {
    setSearchOpen(false);
    setSearchQuery("");
  }

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

  function navigateTraceHop(hop: HierarchyNetTraceHop): void {
    navigateToLocator(
      {
        documentId: hop.to.documentId,
        hierarchyPath: [],
        kind: "net",
        objectId: hop.to.netId,
      },
      `Traced Net ${hop.to.netId} via ${hop.frame.instanceId}.${hop.frame.parentPinName}`,
    );
  }

  return (
    <main className="app-shell">
      <header className="app-chrome">
        <div className="app-chrome-main">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden="true" />
            <div className="app-brand-copy">
              <h1 title="Interactive Circuit Maker">Circuit Maker</h1>
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
                    onClick={deleteSelection}
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
                    Mirror top/bottom (Shift+V)
                  </button>
                  {selectedIds.length > 1 ? (
                    <button type="button" onClick={alignSelectedInstances}>
                      Align
                    </button>
                  ) : null}
                </div>
              </details>
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
              <details className="command-menu" name="editor-command-menu">
                <summary>Draw</summary>
                <div className="command-popover">
                  <button type="button" onClick={openInsertComponentDialog}>
                    <ToolIcon name="insert" />
                    Insert component (I)
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === "wire"}
                    onClick={() => activateTool("wire")}
                  >
                    <ToolIcon name="wire" />
                    Wire (W)
                  </button>
                  <button
                    type="button"
                    aria-label="Text"
                    onClick={addPlainText}
                  >
                    <ToolIcon name="text" />
                    Text (T)
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === "arrow"}
                    onClick={() => activateTool("arrow")}
                  >
                    <ToolIcon name="arrow" />
                    Arrow (A)
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === "construction-line"}
                    onClick={() => activateTool("construction-line")}
                  >
                    <ToolIcon name="line" />
                    Construction line (K)
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === "rectangle"}
                    onClick={() => activateTool("rectangle")}
                  >
                    <ToolIcon name="rectangle" />
                    Rectangle (R)
                  </button>
                </div>
              </details>
              <button
                type="button"
                data-testid="project-search-button"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen(true)}
              >
                Search
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
        {hasImportedHierarchy ? (
          <div className="toolbar-row" aria-label="Document hierarchy">
            <div
              className="document-nav"
              aria-label="Imported cell navigation"
              data-testid="cell-navigation"
            >
              <button
                type="button"
                onClick={returnToParentDocument}
                disabled={documentStack.length === 0}
                title="Return to the parent imported cell"
              >
                Up
              </button>
              <button
                type="button"
                onClick={returnToTopDocument}
                disabled={document.id === project.topDocumentId}
                title="Return to the top imported cell"
              >
                Top
              </button>
              <select
                aria-label="Imported Cells"
                data-testid="document-selector"
                value={document.id}
                onChange={(event) => {
                  setDocumentStack([]);
                  switchDocument(event.currentTarget.value);
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
                onClick={() =>
                  selectedInstance && enterHierarchy(selectedInstance.id)
                }
                disabled={
                  !selectedInstance ||
                  referencedDocumentId(project, selectedInstance) === null
                }
                title="Enter the selected imported subcircuit"
              >
                Enter Cell
              </button>
            </div>
          </div>
        ) : null}
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
      {recoveryReady &&
      recoverySessions.length > 0 &&
      !recoveryBannerDismissed &&
      !recoveryDialogOpen ? (
        <StartupRecoveryBanner
          onOpen={openRecoveryDialog}
          onDismiss={() => setRecoveryBannerDismissed(true)}
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
      <InsertComponentDialog
        open={insertDialogOpen}
        styleProfileId={document.presentation.styleProfileId}
        recentSymbolIds={recentSymbolIds}
        onApply={beginInsertedComponentPlacement}
        onCancel={cancelComponentInsert}
      />
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
      {agentFileCandidate ? (
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
          libraryPanelOpen ? "app-workspace" : "app-workspace library-collapsed"
        }
      >
        <aside className="tool-rail" aria-label="Tool rail">
          <button
            type="button"
            className="tool-rail-button"
            title={
              libraryPanelOpen
                ? "Hide component library"
                : "Show component library"
            }
            aria-pressed={libraryPanelOpen}
            aria-controls="shapes-library-panel"
            aria-expanded={libraryPanelOpen}
            data-testid="library-toggle"
            onClick={toggleLibraryPanel}
          >
            <ToolIcon name="library" />
            <span>Library</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            aria-pressed={tool === "wire"}
            title="Wire (W)"
            onClick={() => activateTool("wire")}
          >
            <ToolIcon name="wire" />
            <span>Wire</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            title="Text (T)"
            aria-label="Text"
            onClick={addPlainText}
          >
            <ToolIcon name="text" />
            <span>Text</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            aria-pressed={tool === "arrow"}
            title="Arrow (A)"
            onClick={() => activateTool("arrow")}
          >
            <ToolIcon name="arrow" />
            <span>Arrow</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            aria-pressed={tool === "construction-line"}
            title="Construction line (K)"
            onClick={() => activateTool("construction-line")}
          >
            <ToolIcon name="line" />
            <span>Line</span>
          </button>
          <button
            type="button"
            className="tool-rail-button"
            aria-pressed={tool === "rectangle"}
            title="Rectangle"
            onClick={() => activateTool("rectangle")}
          >
            <ToolIcon name="rectangle" />
            <span>Rect</span>
          </button>
        </aside>
        <ShapesPanel
          styleProfileId={document.presentation.styleProfileId}
          recentSymbolIds={recentSymbolIds}
          open={libraryPanelOpen}
          onOpenInsert={openInsertComponentDialog}
          onQuickPlace={beginInsertedComponentPlacement}
        />
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
                setSelectionOpen((current) => !current);
                if (selectionOpen) setImportReviewOpen(false);
              }}
            >
              <span className="selection-shelf-title">
                <ToolIcon name="inspect" />
                <span>Properties</span>
                {agentSession.status !== "idle" && !agentStatusDismissed ? (
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
                {selectedIds.length > 0
                  ? selectedIds.join(", ")
                  : (selectedRouteId ??
                    selectedAnnotationId ??
                    selectedDraftingId ??
                    "None")}
                {hasInspectableSelection ? (
                  <span
                    className="selection-shelf-indicator"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </button>
            <div className="selection-panel" hidden={!selectionOpen}>
              {!hasInspectableSelection ? (
                <p className="inspect-empty">Select an object to inspect.</p>
              ) : null}
              {selectedIds.length > 1 ? (
                <section className="selection-overview">
                  <span>Component group</span>
                  <h2>{selectedIds.length} components</h2>
                  <p>{selectedIds.join(", ")}</p>
                </section>
              ) : null}
              {selectedInstance?.placement ? (
                <section className="selection-overview">
                  <span>Component</span>
                  <h2>{selectedInstance.id}</h2>
                  <dl>
                    <dt>Symbol</dt>
                    <dd>{selectedInstance.symbolId}</dd>
                  </dl>
                </section>
              ) : null}
              {selectedInstance ? (
                <section
                  className="context-actions"
                  aria-label="Component properties"
                >
                  <h2>Component properties</h2>
                  {componentParameters(selectedInstance.symbolId).map(
                    (parameter, index) => (
                      <label key={parameter.key} title={parameter.help}>
                        <span className="property-parameter-name">
                          {parameter.label}
                          {parameter.unit ? ` / ${parameter.unit}` : ""}
                          <em>({parameter.help})</em>
                        </span>
                        <input
                          ref={index === 0 ? instanceValueInputRef : undefined}
                          aria-label={`Component ${parameter.label.toLowerCase()}`}
                          inputMode={parameter.inputMode}
                          value={
                            instancePropertyDraft.parameters[parameter.key] ??
                            ""
                          }
                          placeholder={parameter.placeholder}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setInstancePropertyDraft((current) => ({
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
                  {selectedInstance.placement ? (
                    <>
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
                              setInstancePropertyDraft((current) => ({
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
                              setInstancePropertyDraft((current) => ({
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
                              setInstancePropertyDraft((current) => ({
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
                          ↔ Shift+R
                        </button>
                        <button
                          type="button"
                          aria-label="Mirror component top to bottom, Shift+V"
                          title="Mirror top/bottom (Shift+V)"
                          onClick={() => mirrorSelected("top-bottom")}
                        >
                          ↕ Shift+V
                        </button>
                      </div>
                    </>
                  ) : null}
                  <button type="button" onClick={applyInstanceProperties}>
                    Apply component properties
                  </button>
                  <button type="button" onClick={discardInstancePropertyDraft}>
                    Cancel property edits
                  </button>
                </section>
              ) : null}
              {selectedRoute ? (
                <section className="selection-overview">
                  <span>Electrical route</span>
                  <h2>{selectedRoute.id}</h2>
                  <dl>
                    <dt>Net</dt>
                    <dd>
                      {document.nets.find(
                        (net) => net.id === selectedRoute.netId,
                      )?.name ?? selectedRoute.netId}
                    </dd>
                    <dt>Segment</dt>
                    <dd>{(selectedRouteSegmentIndex ?? 0) + 1}</dd>
                  </dl>
                </section>
              ) : null}
              {selectedAnnotation ? (
                <section className="selection-overview">
                  <span>Annotation</span>
                  <h2>{selectedAnnotation.id}</h2>
                  <dl>
                    <dt>Kind</dt>
                    <dd>{selectedAnnotation.kind}</dd>
                    <dt>Locked</dt>
                    <dd>{selectedAnnotation.locked ? "Yes" : "No"}</dd>
                  </dl>
                </section>
              ) : null}
              {selectedDrafting ? (
                <section className="selection-overview">
                  <span>Drawing</span>
                  <h2>{selectedDrafting.id}</h2>
                  <dl>
                    <dt>Kind</dt>
                    <dd>{selectedDrafting.kind}</dd>
                    <dt>Locked</dt>
                    <dd>{selectedDrafting.locked ? "Yes" : "No"}</dd>
                  </dl>
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
              {unplaced.length > 0 ? <h3>Unplaced Instances</h3> : null}
              {unplaced.map((instance) => (
                <button
                  type="button"
                  draggable
                  data-testid={`unplaced-${instance.id}`}
                  key={instance.id}
                  onClick={() => {
                    selectOnly("instance", [instance.id]);
                    setStatus(`Selected ${instance.id}`);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-icm-instance",
                      instance.id,
                    );
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  {instance.id} · {instance.symbolId}
                </button>
              ))}
              {selectedInstance && selectedBulkResolution ? (
                <section
                  className="context-actions"
                  aria-label="MOS bulk connection"
                >
                  <h2>Bulk</h2>
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
                  <button type="button" onClick={drawSelectedMosBulk}>
                    Draw bulk connection
                  </button>
                </section>
              ) : null}
              {selectedRouteId ? (
                <section className="context-actions" aria-label="Route actions">
                  <h2>Route</h2>
                  <p>Segment {(selectedRouteSegmentIndex ?? 0) + 1} selected</p>
                  <label>
                    Electrical Net label
                    <input
                      ref={netLabelPropertyInputRef}
                      aria-label="Electrical Net label"
                      value={netLabelDraft}
                      onChange={(event) =>
                        setNetLabelDraft(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button type="button" onClick={applyNetLabel}>
                    Apply Net label
                  </button>
                  <button type="button" onClick={deleteSelectedRouteNetLabel}>
                    Delete Net label
                  </button>
                  <button type="button" onClick={addCurrentArrow}>
                    Add current arrow
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
                    onClick={toggleSelectedNoConnect}
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
                  <button type="button" onClick={deleteSelectedJunction}>
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
              {selectedAnnotation && !isRoutedMarker(selectedAnnotation) ? (
                <section
                  className="context-actions"
                  aria-label="Annotation actions"
                >
                  <h2>Annotation</h2>
                  {selectedNetLabelBinding ? (
                    <button type="button" onClick={toggleHighlightedNet}>
                      {selectedHighlightIsActive
                        ? "Clear Net highlight (H)"
                        : "Highlight Net (H)"}
                    </button>
                  ) : null}
                  <button type="button" onClick={deleteSelectedAnnotation}>
                    {selectedAnnotation.kind === "net-label"
                      ? "Delete selected Net label"
                      : "Delete annotation"}
                  </button>
                </section>
              ) : null}
              {projectDiagnostics.length > 0 ? (
                <ProjectDiagnosticsSection
                  diagnostics={projectDiagnostics}
                  documentLabel={(documentId) =>
                    project.documents.find(
                      (candidate) => candidate.id === documentId,
                    )?.name ?? documentId
                  }
                  onSelectDiagnostic={jumpToProjectDiagnostic}
                />
              ) : null}
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
                    importDiagnostics={importDiagnostics}
                    visualSummary={visualDiagnosticSummary}
                    onSelectVisualDiagnostic={jumpToVisualDiagnostic}
                  />
                </section>
              ) : null}
              {agentSession.status !== "idle" && !agentStatusDismissed ? (
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
              commitPendingPlacementAt({
                x: snapCoordinate(rawPoint.x, document.presentation.grid),
                y: snapCoordinate(rawPoint.y, document.presentation.grid),
              });
            }}
            onPointerDownCapture={(event) => {
              const target = event.target as Element;
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
                commitCopyPlacement({
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
                setWireWaypoints([]);
                setTool("pointer");
                setBulkDrawInstanceId(null);
                setStatus("Wire cancelled");
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
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
              x={viewBox.x}
              y={viewBox.y}
              width={viewBox.width}
              height={viewBox.height}
              fill="url(#grid)"
            />
            <g dangerouslySetInnerHTML={sceneInnerHtml} />
            {highlightedNet ? (
              <g
                data-testid="net-highlight-overlay"
                data-net-id={highlightedNet.netId}
                className="net-highlight-overlay"
                pointerEvents="none"
              >
                {routePolylines
                  .filter(({ route }) =>
                    highlightedNet.routes.includes(route.id),
                  )
                  .map(({ route, polyline }) => (
                    <polyline
                      key={route.id}
                      className="net-highlight-halo"
                      points={serializePolylinePoints(polyline.points)}
                    />
                  ))}
                {routePolylines
                  .filter(({ route }) =>
                    highlightedNet.routes.includes(route.id),
                  )
                  .map(({ route, polyline }) => (
                    <polyline
                      key={`${route.id}-core`}
                      className="net-highlight-core"
                      points={serializePolylinePoints(polyline.points)}
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
                    y2={vddRailStart.y}
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
                  position={componentPreviewPoint}
                  rotation={componentPlacementRotation}
                />
              ) : null}
              {netLabelEditorOpen && selectedRoute
                ? (() => {
                    const polyline = routePolylines.find(
                      ({ route }) => route.id === selectedRoute.id,
                    )?.polyline;
                    if (!polyline) return null;
                    const segmentIndex = Math.min(
                      selectedRouteSegmentIndex ?? 0,
                      polyline.points.length - 2,
                    );
                    const from = polyline.points[segmentIndex]!;
                    const to = polyline.points[segmentIndex + 1]!;
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
                              setNetLabelDraft(event.currentTarget.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
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
              {routePolylines
                .filter(({ route }) => route.id === selectedRouteId)
                .map(({ route, polyline }) => {
                  const segmentIndex = Math.min(
                    selectedRouteSegmentIndex ?? 0,
                    polyline.points.length - 2,
                  );
                  const from = polyline.points[segmentIndex]!;
                  const to = polyline.points[segmentIndex + 1]!;
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
                    .sort((left, right) => left.position.x - right.position.x);
                  const routeCenter = centerOfBounds(
                    polylineBounds(polyline.points),
                  );
                  const preview =
                    routeStretchPreview?.routeId === route.id
                      ? routeStretchPreview.point
                      : null;
                  const handlePointerDown = (
                    event: ReactPointerEvent<SVGElement>,
                    kind: RouteStretchPreview["kind"],
                  ) => {
                    const primaryInstanceId = selectedIds.at(-1);
                    if (
                      primaryInstanceId &&
                      compositeSelectionOwnsHit("route", route.id)
                    ) {
                      beginMove(event, primaryInstanceId);
                      return;
                    }
                    beginRouteStretch(event, route.id, segmentIndex, kind);
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
                              ? "power-rail-translate"
                              : translatesWholeRoute
                                ? "translate"
                                : "segment",
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
                                ? "power-rail-resize-start"
                                : "power-rail-resize-end",
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
                        selectInstance(
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
                      onPointerDown={(event) => beginMove(event, instance.id)}
                      pointerEvents={tool === "wire" ? "none" : undefined}
                    />
                  );
                })}
              {routePolylines.map(({ route, polyline }) => (
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
                  points={serializePolylinePoints(polyline.points)}
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
                            ? "power-rail-resize-start"
                            : "power-rail-resize-end",
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
              {document.annotations.map((annotation) => {
                const anchor = annotationAnchor(
                  document,
                  resolver,
                  annotation,
                  routePolylines,
                  styleProfile,
                );
                const hitBox = annotationHitBox(
                  annotation,
                  anchor,
                  routePolylines,
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
                  data-testid="selection-box"
                  className="selection-box"
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
                  onCancel={() => setTextEditing(null)}
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
              ? "Drawing VDD rail"
              : pendingSymbolId
                ? `Placing ${pendingSymbolId}`
                : tool === "pointer"
                  ? "Select"
                  : tool === "construction-line"
                    ? "Line"
                    : tool.charAt(0).toUpperCase() + tool.slice(1)}
          </span>
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
        <div className="canvas-controls" aria-label="Canvas zoom controls">
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
