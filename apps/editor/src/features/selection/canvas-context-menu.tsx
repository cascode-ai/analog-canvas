import { ContextMenu } from "../../components/context-menu";
import {
  EDGE_ALIGNMENT_MODES,
  type EdgeAlignmentMode,
} from "./align-selection";

export interface ContextMenuAction {
  label: string;
  enabled: boolean;
  execute: () => void;
}

export interface CanvasContextMenuProps {
  position: { x: number; y: number };
  /** Enabled when two or more alignable visual objects are selected. */
  alignmentEnabled: boolean;
  onAlign: (mode: EdgeAlignmentMode) => void;
  actions: readonly ContextMenuAction[];
  onClose: () => void;
}

/**
 * Shared right-click menu for visual selection. It stays deliberately small:
 * only operations that act directly on the current selection belong here.
 * An outside press both closes it and reaches the canvas, including
 * marquee/Alt framing and middle-button pan gestures.
 */
export function CanvasContextMenu({
  position,
  alignmentEnabled,
  onAlign,
  actions,
  onClose,
}: CanvasContextMenuProps) {
  const availableActions = actions.filter((action) => action.enabled);
  return (
    <ContextMenu
      position={position}
      testId="canvas-context-menu"
      onClose={onClose}
    >
      {alignmentEnabled ? (
        <div className="context-menu-section">
          <div className="context-menu-heading">Align</div>
          {EDGE_ALIGNMENT_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className="context-menu-item"
              data-testid={`context-align-${mode}`}
              onClick={() => {
                onAlign(mode);
                onClose();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {availableActions.length > 0 ? (
        <div className="context-menu-section">
          {availableActions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => {
                action.execute();
                onClose();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </ContextMenu>
  );
}
