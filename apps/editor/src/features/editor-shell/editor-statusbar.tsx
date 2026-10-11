import type { WireCornerOrder, WireRoutingMode } from "@icm/edit-engine";

import type { EditorTool } from "../../interaction/interaction-state";
import {
  SITE_CHANGE_LOG_URL,
  SITE_PRIVACY_PATH,
} from "../../components/site-resource-links";
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

function toolTitle(
  tool: EditorTool,
  vddRailMode: boolean,
  pendingSymbolId: string | null,
): string {
  if (vddRailMode) return "Drawing a power rail on the canvas";
  if (pendingSymbolId) return `Placing ${pendingSymbolId} on the canvas`;
  if (tool === "pointer") return "Select objects on the canvas";
  if (tool === "construction-line") return "Draw a construction line";
  return `Active tool: ${toolLabel(tool, false, null)}`;
}

function wireRoutingModeLabel(mode: WireRoutingMode): string {
  if (mode === "orthogonal") return "Orthogonal";
  if (mode === "octilinear") return "45°";
  return "Any angle";
}

function issuesBadge(issues: {
  errorCount: number;
  warningCount: number;
  checkStatus?: import("../../app/project-check").ProjectCheckStatus;
}): {
  severity: "error" | "warning" | "none";
  label: string;
  title: string;
} {
  if (issues.checkStatus && issues.checkStatus !== "current") {
    return {
      severity: "none",
      label:
        issues.checkStatus === "stale"
          ? "Check out of date"
          : issues.checkStatus === "failed"
            ? "Check failed"
            : issues.checkStatus === "checking"
              ? "Checking…"
              : "Not checked",
      title: "No check has run — open Issues and choose Check and Save",
    };
  }
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  if (issues.errorCount > 0) {
    return {
      severity: "error",
      label:
        issues.warningCount > 0
          ? `${plural(issues.errorCount, "error")}, ${plural(issues.warningCount, "warning")}`
          : plural(issues.errorCount, "error"),
      title: "Action required — open the issues list",
    };
  }
  if (issues.warningCount > 0) {
    return {
      severity: "warning",
      label: plural(issues.warningCount, "warning"),
      title: "Review findings — open the issues list",
    };
  }
  return {
    severity: "none",
    label: "No issues found",
    title: "Open the issues list",
  };
}

export function EditorStatusbar({
  externalLinksEnabled = true,
  visitStats,
  status,
  tool,
  vddRailMode,
  pendingSymbolId,
  wireOptionsOpen,
  wireRoutingMode,
  wireCornerOrder,
  recoveryLabel,
  zoomPercent,
  shortcutHintsVisible,
  gridVisible,
  issues,
  selectionFilterSummary,
  agentExpiring = null,
  onOpenSelectionFilter,
  onToggleWireOptions,
  onWireRoutingModeChange,
  onWireCornerOrderChange,
  onOpenAnalytics,
  onToggleShortcutHints,
  onToggleGrid,
  onZoomOut,
  onZoomIn,
  onFitView,
}: {
  externalLinksEnabled?: boolean;
  visitStats?: { pv: number; uv: number } | null | undefined;
  status: string;
  tool: EditorTool;
  vddRailMode: boolean;
  pendingSymbolId: string | null;
  wireOptionsOpen: boolean;
  wireRoutingMode: WireRoutingMode;
  wireCornerOrder: WireCornerOrder;
  recoveryLabel: string | null;
  zoomPercent: number;
  /** Whether the on-canvas keyboard reference is visible. */
  shortcutHintsVisible: boolean;
  /** Whether the canvas paints its background grid dots. */
  gridVisible: boolean;
  selectionFilterSummary: string | null;
  /** The Agent session's final minute, with the one action that keeps it. */
  agentExpiring?: { onKeep: () => void } | null;
  issues?: {
    errorCount: number;
    warningCount: number;
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    onOpen: () => void;
  };
  onToggleWireOptions: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  onWireCornerOrderChange: (order: WireCornerOrder) => void;
  onOpenAnalytics: () => void;
  onToggleShortcutHints: () => void;
  onToggleGrid: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
  onOpenSelectionFilter: () => void;
}) {
  return (
    <footer className="app-statusbar">
      <div className="statusbar-left">
        <p className="editor-status" data-testid="status" aria-live="polite">
          {status}
        </p>
        {/* The chips drop whole when the bar is short of room. */}
        <div className="statusbar-chips">
          {agentExpiring ? (
            <span
              className="statusbar-agent-expiring"
              role="status"
              data-testid="agent-expiring"
            >
              Agent connection ends in 1 minute
              <button
                type="button"
                data-testid="agent-keep-connected"
                onClick={agentExpiring.onKeep}
              >
                Keep connected
              </button>
            </span>
          ) : null}
          {/* Selecting is the resting state: only another tool is news. */}
          {tool !== "pointer" || vddRailMode || pendingSymbolId ? (
            <span
              className="statusbar-tool"
              data-testid="statusbar-tool"
              title={toolTitle(tool, vddRailMode, pendingSymbolId)}
              aria-label={toolTitle(tool, vddRailMode, pendingSymbolId)}
            >
              {toolLabel(tool, vddRailMode, pendingSymbolId)}
            </span>
          ) : null}
          {selectionFilterSummary ? (
            <button
              type="button"
              className="statusbar-tool"
              data-testid="selection-filter-status"
              onClick={onOpenSelectionFilter}
              title="Choose Selectable Objects (Ctrl+Shift+F)"
            >
              {selectionFilterSummary}
            </button>
          ) : null}
          {tool === "wire" ? (
            <button
              type="button"
              className="statusbar-tool"
              data-testid="wire-options-toggle"
              onClick={onToggleWireOptions}
              aria-expanded={wireOptionsOpen}
              title="Wire options (F3) · / or middle-click cycles the corner"
            >
              {wireRoutingModeLabel(wireRoutingMode)} · F3
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
          {issues
            ? (() => {
                const badge = issuesBadge(issues);
                return (
                  <button
                    type="button"
                    className="statusbar-issues"
                    data-testid="statusbar-issues"
                    data-check-status={issues.checkStatus ?? "current"}
                    data-severity={badge.severity}
                    title={badge.title}
                    aria-label={`${badge.label}. ${badge.title}`}
                    onClick={issues.onOpen}
                  >
                    {badge.label}
                  </button>
                );
              })()
            : null}
        </div>
      </div>
      {visitStats ? (
        <a
          className="statusbar-analytics"
          href="/analytics"
          data-testid="statusbar-analytics"
          title="Open visitor analytics"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            onOpenAnalytics();
          }}
        >
          {visitStats.uv.toLocaleString()} visitors ·{" "}
          {visitStats.pv.toLocaleString()} views
        </a>
      ) : null}
      <div className="statusbar-view-controls">
        {externalLinksEnabled ? (
          <>
            <a
              className="statusbar-change-log"
              data-testid="statusbar-change-log"
              href={SITE_CHANGE_LOG_URL}
              target="_blank"
              rel="noreferrer"
            >
              Change Log
            </a>
            {/* A new tab, like Change Log: the drawing stays open here. */}
            <a
              className="statusbar-change-log statusbar-privacy"
              data-testid="statusbar-privacy"
              href={SITE_PRIVACY_PATH}
              target="_blank"
              rel="noreferrer"
            >
              Privacy
            </a>
          </>
        ) : null}
        <button
          type="button"
          className="statusbar-hints-toggle"
          data-testid="statusbar-shortcut-hints"
          aria-pressed={shortcutHintsVisible}
          title={
            shortcutHintsVisible
              ? "Hide keyboard shortcut hints"
              : "Show keyboard shortcut hints"
          }
          onClick={onToggleShortcutHints}
        >
          Hints
        </button>
        {/* One click away, unlike the canvas.showGrid setting. The label
            collapses to the icon in half-width windows. */}
        <button
          type="button"
          className="statusbar-grid-toggle"
          data-testid="statusbar-grid-toggle"
          aria-label="Grid"
          aria-pressed={gridVisible}
          title={
            gridVisible
              ? "Grid On — click to hide the background grid"
              : "Grid Off — click to show the background grid"
          }
          onClick={onToggleGrid}
        >
          <ToolIcon name="grid" />
          <span className="statusbar-grid-label">
            {gridVisible ? "Grid On" : "Grid Off"}
          </span>
        </button>
        <div className="canvas-controls" aria-label="Canvas view controls">
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
      </div>
    </footer>
  );
}
