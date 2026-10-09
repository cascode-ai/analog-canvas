// The editor's command router: what each command may do now, and the
// operations its keys, menus and toolbars run.
import {
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { WireSource } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import type { BoxPreview } from "../canvas/canvas-gesture-model";
import type { createCanvasGestureController } from "../canvas/canvas-gesture-controller";
import type { CanvasDragSession } from "../canvas/canvas-drag-session";
import { createEditorCommandRouter } from "../commands/editor-command";
import type { useDocumentController } from "../document/document-controller";
import type { SchematicClipboard } from "../features/clipboard/clipboard";
import type { useCircuitClipboard } from "../features/clipboard/use-circuit-clipboard";
import type { useVisualClipboard } from "../features/clipboard/visual-clipboard";
import { fullInsertLaunch } from "../features/component-insert/insert-launch";
import type { useComponentPlacement } from "../features/component-insert/use-component-placement";
import type { createDraftingCommands } from "../features/drafting/drafting-commands";
import { quickPlaceRequest } from "../features/editor-shell/shapes-panel";
import type { useEditorPanels } from "../features/editor-shell/use-editor-panels";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { deriveSelectionInspectionModel } from "../features/selection/selection-inspection-model";
import type { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import type { useSelectionInteraction } from "../features/selection/use-selection-interaction";
import { hasVisualSelection } from "../features/selection/visual-selection";
import type {
  EditorTool,
  useInteractionState,
} from "../interaction/interaction-state";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import type { SnapGuideLine } from "../snap/engine";
import type { createEditorTransactionCommands } from "./editor-transaction-commands";
import type { HighlightedNetOrigin } from "./use-editor-derived-model";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type EditorPanels = ReturnType<typeof useEditorPanels>;
type SelectionController = ReturnType<typeof useSelectionController>;
type InteractionState = ReturnType<
  typeof useInteractionState<SchematicClipboard>
>;
type TransactionCommands = ReturnType<typeof createEditorTransactionCommands>;
type SelectionInspection = ReturnType<typeof deriveSelectionInspectionModel>;
type ComponentPlacement = ReturnType<typeof useComponentPlacement>;
type SelectionTransform = ReturnType<typeof createSelectionTransformController>;
type SelectionInteraction = ReturnType<typeof useSelectionInteraction>;
type CanvasGesture = ReturnType<typeof createCanvasGestureController>;
type ArmedVerb = "rotate" | "copy" | "move" | "move-detached" | "delete";

/** The command router App's keys, menus and toolbars run through. */
export function useEditorCommandRouter({
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
}: {
  setStatus: Dispatch<SetStateAction<string>>;
  selectionOpen: EditorPanels["selectionOpen"];
  setSearchOpen: EditorPanels["setSearchOpen"];
  closeSearch: EditorPanels["closeSearch"];
  document: SchematicDocument;
  canUndo: DocumentControllerState["canUndo"];
  canRedo: DocumentControllerState["canRedo"];
  visualSelection: SelectionController["selection"];
  replaceSelectionKind: SelectionController["replaceKind"];
  setSelectionFilterOpen: Dispatch<SetStateAction<boolean>>;
  documentSettingsOpen: boolean;
  setBoxPreview: Dispatch<SetStateAction<BoxPreview | null>>;
  getCurrentInteractionState: InteractionState["getCurrentState"];
  tool: InteractionState["tool"];
  transact: TransactionCommands["transact"];
  armedVerb: ArmedVerb | null;
  selectedEndpoint: WireSource | null;
  highlightedNetOrigin: HighlightedNetOrigin | null;
  setHighlightedNetOrigin: Dispatch<
    SetStateAction<HighlightedNetOrigin | null>
  >;
  canvasDragSessionRef: RefObject<CanvasDragSession | null>;
  selectedDrafting: SelectionInspection["selectedDrafting"];
  hasRotatableSelection: boolean;
  hasMirrorableSelection: boolean;
  hasInspectableSelection: boolean;
  rotatePendingComponentFromHook: ComponentPlacement["rotatePendingComponent"];
  mirrorPendingComponentFromHook: ComponentPlacement["mirrorPendingComponent"];
  startInsertFromHook: ComponentPlacement["startInsert"];
  rotateSelected: SelectionTransform["rotate"];
  mirrorSelected: SelectionTransform["mirror"];
  alignSelection: SelectionTransform["align"];
  alignmentParticipantCount: number;
  armVerb: (verb: ArmedVerb) => void;
  disarmVerb: () => void;
  beginKeyboardSelectionMoveFromSelection: SelectionInteraction["beginKeyboardSelectionMove"];
  deleteSelectionFromSelection: SelectionInteraction["deleteSelection"];
  canBeginKeyboardSelectionMove: SelectionInteraction["canBeginKeyboardSelectionMove"];
  canTransformCommandMove: SelectionInteraction["canTransformCommandMove"];
  mirrorCommandMoveFromSelection: SelectionInteraction["mirrorCommandMove"];
  rotateCommandMoveFromSelection: SelectionInteraction["rotateCommandMove"];
  addPlainText: ReturnType<typeof createDraftingCommands>["addPlainText"];
  fitView: CanvasGesture["fitView"];
  panView: CanvasGesture["panView"];
  openProperties: () => void;
  closeProperties: () => void;
  circuitClipboard: ReturnType<typeof useCircuitClipboard>;
  selectAllObjects: () => void;
  clearEditorSelection: () => void;
  cancelAllTransientInteraction: () => void;
  activateTool: (nextTool: EditorTool) => void;
  rotatePendingCopy: (delta: 45 | -45 | 90 | -90) => void;
  mirrorPendingCopy: (direction: ScreenFlip) => void;
  paintSnapGuides: (guides: readonly SnapGuideLine[]) => void;
  visualClipboard: ReturnType<typeof useVisualClipboard>;
}) {
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
  return editorCommands;
}
