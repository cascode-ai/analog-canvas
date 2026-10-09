// The editor's keyboard shortcuts, and the outside press that closes open
// menus and commits text being edited.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { HierarchyFrame } from "@icm/derived";
import type {
  CircuitProject,
  GridRect,
  Point,
  SchematicDocument,
} from "@icm/model";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type { useDocumentController } from "../document/document-controller";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import type { useCircuitClipboard } from "../features/clipboard/use-circuit-clipboard";
import type { useComponentPlacement } from "../features/component-insert/use-component-placement";
import type { createDraftingCommands } from "../features/drafting/drafting-commands";
import type { createDraftingCreateController } from "../features/drafting/drafting-create-controller";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { createEditorNavigationController } from "../features/hierarchy/editor-navigation-controller";
import type { CellInterfaceConfirmation } from "../features/hierarchy/project-structure-commands";
import type { ControlPickState } from "../features/properties/controlled-source-canvas-pick";
import type { usePropertiesEditor } from "../features/properties/use-properties-editor";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { deriveSelectionInspectionModel } from "../features/selection/selection-inspection-model";
import type { NetLabelPlacementTarget } from "../features/wiring/route-interaction-geometry";
import type { useWireCanvasController } from "../features/wiring/use-wire-canvas-controller";
import type { useWireInteraction } from "../features/wiring/use-wire-interaction";
import {
  resolveEditorShortcut,
  shouldConsumeEditorEscape,
  stepBoundedScale,
} from "../interaction/editor-shortcuts";
import type {
  EditorTool,
  useInteractionState,
} from "../interaction/interaction-state";
import type { EditorServices } from "../services/editor-services";
import { snapCoordinate } from "../snap/engine";
import type { SnapGuideLine } from "../snap/engine";
import type { ComponentEditorSession } from "./component-editor-session";
import type { EditorProjectPanelMode } from "./editor-project-dock";
import {
  dismissOpenCommandMenus,
  isTypingTarget,
} from "./editor-runtime-helpers";
import type { HighlightedNetOrigin } from "./use-editor-derived-model";
import type { useNativeProjectTabs } from "./use-native-project-tabs";
import type {
  useSimulationPickCommands,
  useSimulationPicking,
} from "./use-simulation-surface";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type SelectionController = ReturnType<typeof useSelectionController>;
type InteractionState = ReturnType<
  typeof useInteractionState<SchematicClipboard>
>;
type SelectionInspection = ReturnType<typeof deriveSelectionInspectionModel>;
type PropertiesEditor = ReturnType<typeof usePropertiesEditor>;
type ComponentPlacement = ReturnType<typeof useComponentPlacement>;
type NavigationController = ReturnType<typeof createEditorNavigationController>;
type SimulationPicking = ReturnType<typeof useSimulationPicking>;
type SimulationPickCommands = ReturnType<typeof useSimulationPickCommands>;

interface EditorShortcutDependencies {
  projectStore: EditorServices["projectStore"];
  nativeProjectStore: EditorServices["nativeProjectStore"];
  setStatus: Dispatch<SetStateAction<string>>;
  componentEditor: ComponentEditorSession | null;
  userComponentsOpen: boolean;
  setUserComponentsOpen: Dispatch<SetStateAction<boolean>>;
  selectionOpen: EditorPanels["selectionOpen"];
  setSelectionOpen: EditorPanels["setSelectionOpen"];
  searchOpen: EditorPanels["searchOpen"];
  closeSearch: EditorPanels["closeSearch"];
  toggleLibraryPanel: EditorPanels["toggleLibraryPanel"];
  document: SchematicDocument;
  resolver: DocumentControllerState["resolver"];
  documentStack: HierarchyFrame[];
  visualSelection: SelectionController["selection"];
  selectionFilterOpen: boolean;
  setSelectionFilterOpen: Dispatch<SetStateAction<boolean>>;
  viewBox: GridRect;
  documentSettingsOpen: boolean;
  setDocumentSettingsOpen: Dispatch<SetStateAction<boolean>>;
  projectInfoOpen: boolean;
  setProjectInfoOpen: Dispatch<SetStateAction<boolean>>;
  versionHistoryOpen: boolean;
  recoveryDialogOpen: ProjectFileLifecycle["recoveryDialogOpen"];
  setRecoveryDialogOpen: ProjectFileLifecycle["setRecoveryDialogOpen"];
  hasUnsafeWork: ProjectFileLifecycle["hasUnsafeWork"];
  saveProjectToCloud: ProjectFileLifecycle["saveProjectToCloud"];
  saveProjectToNative: ProjectFileLifecycle["saveProjectToNative"];
  exportProjectFile: ProjectFileLifecycle["exportProjectFile"];
  setWireOptionsOpen: Dispatch<SetStateAction<boolean>>;
  getCurrentInteractionState: InteractionState["getCurrentState"];
  tool: InteractionState["tool"];
  wireSource: InteractionState["wireSource"];
  wirePreviewPoint: InteractionState["wirePreviewPoint"];
  wireDraftSteps: InteractionState["wireDraftSteps"];
  draftingSource: InteractionState["draftingSource"];
  setWireDraftSteps: InteractionState["setWireDraftSteps"];
  interfaceConfirmation: {
    request: CellInterfaceConfirmation;
    snapshot: CircuitProject;
  } | null;
  highlightedNetOrigin: HighlightedNetOrigin | null;
  controlPickState: ControlPickState | null;
  setControlPickState: Dispatch<SetStateAction<ControlPickState | null>>;
  simulationPickActive: boolean;
  setSimulationHoverNetId: SimulationPicking["setSimulationHoverNetId"];
  lastCanvasPointRef: RefObject<Point | null>;
  projectInputRef: RefObject<HTMLInputElement | null>;
  selectedInstance: SelectionInspection["selectedInstance"];
  selectedRoute: SelectionInspection["selectedRoute"];
  selectedDrafting: SelectionInspection["selectedDrafting"];
  hasHierarchyEnterSelection: boolean;
  hasInspectableSelection: boolean;
  selectedHighlightNetId: SelectionInspection["selectedHighlightNetId"];
  setSimulationPickMode: SimulationPickCommands["setSimulationPickMode"];
  beginNetLabelEditing: PropertiesEditor["beginNetLabelEditing"];
  cancelNetLabelEditing: PropertiesEditor["cancelNetLabelEditing"];
  commitInstancePropertyDraft: PropertiesEditor["commitInstancePropertyDraft"];
  commitPendingNetLabelDraft: PropertiesEditor["commitPendingNetLabelDraft"];
  escapeTextEditing: PropertiesEditor["escapeTextEditing"];
  netLabelPlacement: PropertiesEditor["netLabelPlacement"];
  textEditing: PropertiesEditor["textEditing"];
  finishWireAtPoint: ReturnType<typeof useWireInteraction>["finishWireAtPoint"];
  cancelComponentInsertFromHook: ComponentPlacement["cancelComponentInsert"];
  insertDialogOpen: ComponentPlacement["insertDialogOpen"];
  setDraftingStyle: ReturnType<
    typeof createDraftingCommands
  >["setDraftingStyle"];
  finishDraftingCreate: ReturnType<
    typeof createDraftingCreateController
  >["finish"];
  cycleWireCornerShape: ReturnType<
    typeof useWireCanvasController
  >["cycleWireCornerShape"];
  enterSelectedHierarchy: NavigationController["enterSelectedHierarchy"];
  returnToParentDocument: NavigationController["returnToParentDocument"];
  toggleHighlightedNet: NavigationController["toggleHighlightedNet"];
  toggleProjectPanel: (mode: EditorProjectPanelMode) => void;
  circuitClipboard: ReturnType<typeof useCircuitClipboard>;
  toggleExamplesPanel: () => void;
  openSelectedComponentDefinition: () => void;
  activateTool: (nextTool: EditorTool) => void;
  paintSnapGuides: (guides: readonly SnapGuideLine[]) => void;
  resolveNetLabelPlacementTarget: (
    point: Point,
    svg?: SVGSVGElement,
    preferredRouteId?: string,
  ) => NetLabelPlacementTarget | null;
  turnNetLabels: () => void;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  openNativeProject: ReturnType<
    typeof useNativeProjectTabs
  >["openNativeProject"];
}

/** Installs the editor's key handler and the outside-press dismissal. */
export function useEditorShortcuts({
  textEditing,
  commitTextEditing,
  document,
  readShortcutDependencies,
}: {
  textEditing: PropertiesEditor["textEditing"];
  commitTextEditing: PropertiesEditor["commitTextEditing"];
  document: SchematicDocument;
  /** Read after each render, when the handler for that render is made. */
  readShortcutDependencies: () => EditorShortcutDependencies;
}) {
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
    shortcutHandlerRef.current = createEditorShortcutHandler(
      readShortcutDependencies(),
    );
  });
  useEffect(() => {
    // Keep the listener installed while a canvas preview flush publishes state
    // earlier in the same key event. Replacing it would drop that Enter event.
    const dispatch = (event: KeyboardEvent) =>
      shortcutHandlerRef.current(event);
    window.addEventListener("keydown", dispatch, true);
    return () => window.removeEventListener("keydown", dispatch, true);
  }, []);
}

function createEditorShortcutHandler({
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
  resolver,
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
  selectedInstance,
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
  activateTool,
  paintSnapGuides,
  resolveNetLabelPlacementTarget,
  turnNetLabels,
  editorCommands,
  openNativeProject,
}: EditorShortcutDependencies) {
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
  return onKeyDown;
}
