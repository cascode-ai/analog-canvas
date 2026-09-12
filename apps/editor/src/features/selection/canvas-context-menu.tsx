import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
 */
export function CanvasContextMenu({
  position,
  alignmentEnabled,
  onAlign,
  actions,
  onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(position);
  const availableActions = actions.filter((action) => action.enabled);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPlaced({
      x: Math.max(
        4,
        Math.min(position.x, window.innerWidth - bounds.width - 4),
      ),
      y: Math.max(
        4,
        Math.min(position.y, window.innerHeight - bounds.height - 4),
      ),
    });
  }, [position]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    // Non-modal dismissal: the same outside press still reaches the canvas,
    // including marquee/Alt framing and middle-button pan gestures.
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      data-testid="canvas-context-menu"
      role="menu"
      style={{ left: placed.x, top: placed.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
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
    </div>
  );
}
