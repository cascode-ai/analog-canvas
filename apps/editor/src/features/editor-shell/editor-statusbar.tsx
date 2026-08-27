import type { WireCornerOrder, WireRoutingMode } from "@icm/edit-engine";

import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";

function toolLabel(
  tool: EditorTool,
  vddRailMode: boolean,
  pendingSymbolId: string | null,
): string {
  if (vddRailMode) return "Drawing Power Rail";
  if (pendingSymbolId) return `Placing ${pendingSymbolId}`;
  if (tool === "pointer") return "Select";
  if (tool === "construction-line") return "Line";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export function EditorStatusbar({
  visitStats,
  status,
  tool,
  vddRailMode,
  pendingSymbolId,
  wireOptionsOpen,
  wireRoutingMode,
  wireCornerOrder,
  recoveryLabel,
  gridDotsVisible,
  zoomPercent,
  onToggleWireOptions,
  onWireRoutingModeChange,
  onWireCornerOrderChange,
  onToggleGridDots,
  onZoomOut,
  onZoomIn,
  onFitView,
}: {
  visitStats?: { pv: number; uv: number } | null | undefined;
  status: string;
  tool: EditorTool;
  vddRailMode: boolean;
  pendingSymbolId: string | null;
  wireOptionsOpen: boolean;
  wireRoutingMode: WireRoutingMode;
  wireCornerOrder: WireCornerOrder;
  recoveryLabel: string | null;
  gridDotsVisible: boolean;
  zoomPercent: number;
  onToggleWireOptions: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  onWireCornerOrderChange: (order: WireCornerOrder) => void;
  onToggleGridDots: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
}) {
  return (
    <footer className="app-statusbar">
      <div className="statusbar-left">
        <p className="editor-status" data-testid="status" aria-live="polite">
          {status}
        </p>
        <span className="statusbar-tool" data-testid="statusbar-tool">
          {toolLabel(tool, vddRailMode, pendingSymbolId)}
        </span>
        {tool === "wire" ? (
          <button
            type="button"
            className="statusbar-tool"
            onClick={onToggleWireOptions}
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
                  onWireRoutingModeChange(
                    event.currentTarget.value as WireRoutingMode,
                  )
                }
              >
                <option value="orthogonal">Orthogonal</option>
                <option value="octilinear">45° octilinear</option>
                <option value="free">Any angle</option>
              </select>
            </label>
            <label>
              Corner
              <select
                value={wireCornerOrder}
                onChange={(event) =>
                  onWireCornerOrderChange(
                    event.currentTarget.value as WireCornerOrder,
                  )
                }
              >
                <option value="auto">Auto</option>
                <option value="horizontal-first">Horizontal first</option>
                <option value="vertical-first">Vertical first</option>
                <option value="diagonal-first">Diagonal first</option>
                <option value="orthogonal-first">Orthogonal first</option>
              </select>
            </label>
          </span>
        ) : null}
        {recoveryLabel ? (
          <output
            className="statusbar-recovery"
            data-testid="recovery-state"
            aria-label="Browser recovery state"
          >
            {recoveryLabel}
          </output>
        ) : null}
      </div>
      {visitStats ? (
        <a
          className="statusbar-analytics"
          href="/analytics"
          data-testid="statusbar-analytics"
          title="Open visitor analytics"
        >
          {visitStats.uv.toLocaleString()} visitors ·{" "}
          {visitStats.pv.toLocaleString()} views
        </a>
      ) : null}
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
          onClick={onToggleGridDots}
        >
          <ToolIcon name="grid" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={onZoomOut}
        >
          <ToolIcon name="zoom-out" />
        </button>
        <output aria-label="Current zoom">{zoomPercent}%</output>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={onZoomIn}
        >
          <ToolIcon name="zoom-in" />
        </button>
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view (Home)"
          onClick={onFitView}
        >
          <ToolIcon name="fit" />
        </button>
      </div>
    </footer>
  );
}
