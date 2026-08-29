import type { InsertLaunch } from "../features/component-insert/insert-launch";
import type {
  EditorTool,
  InteractionMode,
} from "../interaction/interaction-state";
import type { ScreenFlip } from "../interaction/shortcut-orientation";
import type { EdgeAlignmentMode } from "../features/selection/align-selection";

export type EditorCommandRequest =
  | { id: "editor.cancel" }
  | { id: "history.undo" }
  | { id: "history.redo" }
  | { id: "selection.select-all" }
  | { id: "selection.clear" }
  | { id: "selection.delete" }
  | { id: "selection.copy" }
  | { id: "selection.move" }
  | { id: "selection.align"; mode: EdgeAlignmentMode }
  | { id: "transform.rotate"; deltaDegrees?: 90 | -90 }
  | { id: "transform.rotate-next" }
  | { id: "transform.mirror"; direction: ScreenFlip }
  | { id: "insert.start"; launch: InsertLaunch }
  | { id: "insert.open" }
  | { id: "insert.cell-pin" }
  | { id: "tool.activate"; tool: EditorTool }
  | { id: "drafting.add-text" }
  | { id: "properties.open" }
  | { id: "properties.close" }
  | { id: "view.fit" };

export interface EditorCommandState {
  enabled: boolean;
  active: boolean;
  reason?: string;
}

export interface EditorCommandResult {
  status: "executed" | "rejected";
  message?: string;
}

export interface EditorCommandContext {
  interactionMode: InteractionMode;
  activeTool: EditorTool;
  hasDeletableSelection: boolean;
  hasMoveSelection: boolean;
  hasAlignableSelection: boolean;
  hasRotatableSelection: boolean;
  hasMirrorableSelection: boolean;
  canTransformMove: boolean;
  hasInspectableSelection: boolean;
  propertiesOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  helpOpen: boolean;
  canvasDragActive: boolean;
  hasClearableDraftingSelection: boolean;
  hasActiveNetHighlight: boolean;
  /** A verb (rotate/copy/move/delete) is armed, waiting for a target click. */
  hasArmedVerb: boolean;
}

export interface EditorCommandOperations {
  closeHelp(): void;
  cancelCanvasDrag(): void;
  cancelInteraction(interactionMode: InteractionMode): void;
  clearDraftingSelection(): void;
  clearNetHighlight(): void;
  cancelPassive(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  clearSelection(): void;
  deleteSelection(): void;
  beginCopy(): void;
  beginMove(): void;
  alignSelection(mode: EdgeAlignmentMode): void;
  rotatePlacement(deltaDegrees: 90 | -90): void;
  rotateCopy(deltaDegrees: 90 | -90): void;
  rotateMove(deltaDegrees: 90 | -90): void;
  rotateSelection(deltaDegrees: 90 | -90): void;
  /** Wait for a part to be pointed at, then turn that one. */
  armRotate(): void;
  /** Drop whatever verb is armed without acting on anything. */
  disarmVerb(): void;
  mirrorPlacement(direction: ScreenFlip): void;
  mirrorCopy(direction: ScreenFlip): void;
  mirrorMove(direction: ScreenFlip): void;
  mirrorSelection(direction: ScreenFlip): void;
  startInsert(launch: InsertLaunch): void;
  openInsert(): void;
  placeCellPin(): void;
  activateTool(tool: EditorTool): void;
  addText(): void;
  openProperties(): void;
  closeProperties(): void;
  fitView(): void;
  report(message: string): void;
}

export interface EditorCommandRouter {
  state(request: EditorCommandRequest): EditorCommandState;
  execute(request: EditorCommandRequest): EditorCommandResult;
}

type EditorCommandRouterOptions = {
  getContext(): EditorCommandContext;
  operations: EditorCommandOperations;
};

function enabled(active = false): EditorCommandState {
  return { enabled: true, active };
}

function disabled(reason: string): EditorCommandState {
  return { enabled: false, active: false, reason };
}

type TransformOwner =
  | "component-placement"
  | "copy-placement"
  | "selection-move"
  | "idle-selection";

type TransformResolution =
  | { owner: TransformOwner; active: boolean }
  | { owner: "unavailable"; reason: string };

/** One exhaustive owner resolver shared by capability and execution. */
function resolveTransformOwner(
  context: EditorCommandContext,
  kind: "rotate" | "mirror",
): TransformResolution {
  if (context.interactionMode === "placing-component") {
    return { owner: "component-placement", active: true };
  }
  if (context.interactionMode === "copy-placement") {
    return { owner: "copy-placement", active: true };
  }
  if (context.interactionMode === "moving-selection") {
    return context.canTransformMove
      ? { owner: "selection-move", active: true }
      : {
          owner: "unavailable",
          reason: `${kind === "rotate" ? "Rotate" : "Mirror"} is unavailable for this Move selection`,
        };
  }
  const idleCapability =
    kind === "rotate"
      ? context.hasRotatableSelection
      : context.hasMirrorableSelection;
  if (context.interactionMode === "idle" && idleCapability) {
    return { owner: "idle-selection", active: false };
  }
  return {
    owner: "unavailable",
    reason:
      kind === "rotate"
        ? "Rotate is unavailable for the current interaction"
        : "Mirror is unavailable for the current selection",
  };
}

/**
 * Thin editor-local command plane. It owns cross-surface availability and
 * interaction arbitration, then delegates to the existing domain owners. It
 * deliberately knows nothing about Project JSON, Engine edits, geometry, or
 * electrical topology.
 */
export function createEditorCommandRouter(
  options: EditorCommandRouterOptions,
): EditorCommandRouter {
  const state = (request: EditorCommandRequest): EditorCommandState => {
    const context = options.getContext();
    switch (request.id) {
      case "editor.cancel":
        return enabled(
          context.helpOpen ||
            context.canvasDragActive ||
            context.interactionMode !== "idle" ||
            context.hasArmedVerb ||
            context.hasClearableDraftingSelection ||
            context.hasActiveNetHighlight,
        );
      case "history.undo":
        return context.canUndo ? enabled() : disabled("Nothing to undo");
      case "history.redo":
        return context.canRedo ? enabled() : disabled("Nothing to redo");
      case "selection.select-all":
      case "selection.clear":
        return enabled();
      case "selection.delete":
        // With nothing selected while idle, Delete arms the verb (Cadence
        // style): the next clicks delete what they point at.
        return context.hasDeletableSelection ||
          context.interactionMode === "idle"
          ? enabled()
          : disabled("Select an object before deleting it");
      case "selection.copy":
        if (
          context.interactionMode !== "idle" &&
          context.interactionMode !== "copy-placement"
        ) {
          return disabled("Finish or cancel the active tool before copying");
        }
        return enabled(context.interactionMode === "copy-placement");
      case "selection.move":
        if (
          context.interactionMode !== "idle" &&
          context.interactionMode !== "moving-selection"
        ) {
          return disabled("Finish or cancel the active tool before moving");
        }
        // With nothing selected while idle, M arms the verb: the next click
        // picks up the pointed-at part.
        return enabled(context.interactionMode === "moving-selection");
      case "selection.align":
        if (context.interactionMode !== "idle") {
          return disabled("Finish or cancel the active tool before aligning");
        }
        return context.hasAlignableSelection
          ? enabled()
          : disabled("Select at least two parts or text objects to align");
      case "transform.rotate": {
        const resolution = resolveTransformOwner(context, "rotate");
        return resolution.owner === "unavailable"
          ? disabled(resolution.reason)
          : enabled(resolution.active);
      }
      case "transform.rotate-next":
        // Arming needs nothing selected and nothing in progress: it is what R
        // does when there is not yet anything to turn.
        return context.interactionMode === "idle"
          ? enabled()
          : disabled("Finish the current action before rotating");
      case "transform.mirror": {
        const resolution = resolveTransformOwner(context, "mirror");
        return resolution.owner === "unavailable"
          ? disabled(resolution.reason)
          : enabled(resolution.active);
      }
      case "insert.start":
      case "insert.open":
      case "insert.cell-pin":
        return enabled(
          context.interactionMode === "placing-component" ||
            context.interactionMode === "placing-vdd-rail",
        );
      case "tool.activate":
        return enabled(context.activeTool === request.tool);
      case "drafting.add-text":
      case "view.fit":
        return enabled();
      case "properties.open":
        return context.hasInspectableSelection
          ? enabled(context.propertiesOpen)
          : disabled("Select an object before opening Properties");
      case "properties.close":
        return enabled(context.propertiesOpen);
    }
  };

  const execute = (request: EditorCommandRequest): EditorCommandResult => {
    const availability = state(request);
    if (!availability.enabled) {
      const message = availability.reason ?? "Command is unavailable";
      // Undo, redo, and Delete historically no-op when invoked from a
      // shortcut with nothing to act on. Menus still consume the disabled
      // state, but the shared command must not add a new status-bar side
      // effect merely because routing was unified.
      if (
        request.id !== "history.undo" &&
        request.id !== "history.redo" &&
        request.id !== "selection.delete"
      ) {
        options.operations.report(message);
      }
      return { status: "rejected", message };
    }

    const context = options.getContext();
    switch (request.id) {
      case "editor.cancel":
        if (context.helpOpen) {
          options.operations.closeHelp();
        } else if (context.canvasDragActive) {
          options.operations.cancelCanvasDrag();
        } else if (context.interactionMode !== "idle") {
          options.operations.cancelInteraction(context.interactionMode);
        } else if (context.hasArmedVerb) {
          options.operations.disarmVerb();
        } else if (context.hasClearableDraftingSelection) {
          options.operations.clearDraftingSelection();
        } else if (context.hasActiveNetHighlight) {
          options.operations.clearNetHighlight();
        } else {
          options.operations.cancelPassive();
        }
        break;
      case "history.undo":
        // History owners publish the circuit revision first, then let the
        // active interaction invalidate itself against that revision. This
        // preserves the precise cancellation reason and avoids double exits.
        options.operations.undo();
        break;
      case "history.redo":
        options.operations.redo();
        break;
      case "selection.select-all":
        options.operations.selectAll();
        break;
      case "selection.clear":
        options.operations.clearSelection();
        break;
      case "selection.delete":
        options.operations.deleteSelection();
        break;
      case "selection.copy":
        options.operations.beginCopy();
        break;
      case "selection.move":
        options.operations.beginMove();
        break;
      case "selection.align":
        options.operations.alignSelection(request.mode);
        break;
      case "transform.rotate-next":
        options.operations.armRotate();
        break;
      case "transform.rotate": {
        const deltaDegrees = request.deltaDegrees ?? 90;
        const resolution = resolveTransformOwner(context, "rotate");
        if (resolution.owner === "unavailable") break;
        switch (resolution.owner) {
          case "component-placement":
            options.operations.rotatePlacement(deltaDegrees);
            break;
          case "copy-placement":
            options.operations.rotateCopy(deltaDegrees);
            break;
          case "selection-move":
            options.operations.rotateMove(deltaDegrees);
            break;
          case "idle-selection":
            options.operations.rotateSelection(deltaDegrees);
            break;
        }
        break;
      }
      case "transform.mirror": {
        const resolution = resolveTransformOwner(context, "mirror");
        if (resolution.owner === "unavailable") break;
        switch (resolution.owner) {
          case "component-placement":
            options.operations.mirrorPlacement(request.direction);
            break;
          case "copy-placement":
            options.operations.mirrorCopy(request.direction);
            break;
          case "selection-move":
            options.operations.mirrorMove(request.direction);
            break;
          case "idle-selection":
            options.operations.mirrorSelection(request.direction);
            break;
        }
        break;
      }
      case "insert.start":
        if (context.interactionMode !== "idle") {
          options.operations.cancelInteraction(context.interactionMode);
        }
        options.operations.startInsert(request.launch);
        break;
      case "insert.open":
        if (context.interactionMode !== "idle") {
          options.operations.cancelInteraction(context.interactionMode);
        }
        options.operations.openInsert();
        break;
      case "insert.cell-pin":
        if (context.interactionMode !== "idle") {
          options.operations.cancelInteraction(context.interactionMode);
        }
        options.operations.placeCellPin();
        break;
      case "tool.activate":
        // Tool owners arbitrate their own re-entry and transition semantics.
        // Cancelling here first loses useful in-progress state such as a Wire
        // source when the user presses W again for the already-active tool.
        options.operations.activateTool(request.tool);
        break;
      case "drafting.add-text":
        options.operations.addText();
        break;
      case "properties.open":
        options.operations.openProperties();
        break;
      case "properties.close":
        options.operations.closeProperties();
        break;
      case "view.fit":
        options.operations.fitView();
        break;
    }
    return { status: "executed" };
  };

  return { state, execute };
}
