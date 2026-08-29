import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  EDGE_ALIGNMENT_MODES,
  type EdgeAlignmentMode,
} from "./align-selection";

export interface ContextMenuAction {
  label: string;
  enabled: boolean;
  execute: () => void;
}

export interface ContextMenuVariant {
  symbolId: string;
  name: string;
}

export interface CanvasContextMenuProps {
  position: { x: number; y: number };
  /** Same-shape symbols the single selected device can swap into. */
  variants: readonly ContextMenuVariant[];
  renderVariantArtwork: (symbolId: string) => ReactNode;
  onSwapVariant: (symbolId: string) => void;
  /** Enabled when two or more alignable visual objects are selected. */
  alignmentEnabled: boolean;
  onAlign: (mode: EdgeAlignmentMode) => void;
  actions: readonly ContextMenuAction[];
  onClose: () => void;
}

/**
 * Shared right-click menu for visual selection. Device-only variant tiles are
 * supplied only for a single selected instance; alignment and everyday
 * commands apply to the full mixed visual selection.
 */
export function CanvasContextMenu({
  position,
  variants,
  renderVariantArtwork,
  onSwapVariant,
  alignmentEnabled,
  onAlign,
  actions,
  onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(position);

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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="canvas-context-menu-backdrop"
      data-testid="canvas-context-menu-backdrop"
      onPointerDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="canvas-context-menu"
        data-testid="canvas-context-menu"
        role="menu"
        style={{ left: placed.x, top: placed.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {variants.length > 0 ? (
          <div className="context-menu-section">
            <div className="context-menu-heading">Swap device</div>
            <div className="context-menu-variants" role="group">
              {variants.map((variant) => (
                <button
                  key={variant.symbolId}
                  type="button"
                  role="menuitem"
                  className="context-menu-variant"
                  title={variant.name}
                  data-testid={`context-swap-${variant.symbolId}`}
                  onClick={() => {
                    onSwapVariant(variant.symbolId);
                    onClose();
                  }}
                >
                  {renderVariantArtwork(variant.symbolId)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
        {actions.length > 0 ? (
          <div className="context-menu-section">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className="context-menu-item"
                disabled={!action.enabled}
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
    </div>
  );
}
