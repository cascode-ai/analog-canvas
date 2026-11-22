import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorStatusbar } from "./editor-statusbar";

describe("editor statusbar", () => {
  it("offers Keep connected in an Agent session's final minute", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        agentExpiring={{ onKeep: vi.fn() }}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="agent-expiring"');
    expect(markup).toContain("Agent connection ends in 1 minute");
    expect(markup).toContain('data-testid="agent-keep-connected"');
    expect(markup).toContain(">Keep connected</button>");
  });

  it.each([
    [true, "Grid On", "hide"],
    [false, "Grid Off", "show"],
  ] as const)(
    "offers a one-click grid toggle (visible=%s)",
    (gridVisible, label, action) => {
      const markup = renderToStaticMarkup(
        <EditorStatusbar
          status="Ready"
          tool="pointer"
          vddRailMode={false}
          pendingSymbolId={null}
          wireOptionsOpen={false}
          wireRoutingMode="orthogonal"
          wireCornerOrder="auto"
          recoveryLabel={null}
          zoomPercent={100}
          shortcutHintsVisible={false}
          onToggleShortcutHints={vi.fn()}
          gridVisible={gridVisible}
          onToggleGrid={vi.fn()}
          selectionFilterSummary={null}
          onOpenSelectionFilter={vi.fn()}
          onToggleWireOptions={vi.fn()}
          onWireRoutingModeChange={vi.fn()}
          onWireCornerOrderChange={vi.fn()}
          onOpenAnalytics={vi.fn()}
          onZoomOut={vi.fn()}
          onZoomIn={vi.fn()}
          onFitView={vi.fn()}
        />,
      );
      expect(markup).toContain('data-testid="statusbar-grid-toggle"');
      expect(markup).toContain(`aria-pressed="${gridVisible}"`);
      // The label is the full-width form; half-width CSS hides it and the
      // accessible name stays "Grid".
      expect(markup).toContain(
        `<span class="statusbar-grid-label">${label}</span>`,
      );
      expect(markup).toContain('aria-label="Grid"');
      expect(markup).toContain(`click to ${action} the background grid`);
    },
  );
  function statusbarWithIssues(issues: {
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    errorCount: number;
    warningCount: number;
    onOpen(): void;
  }) {
    return renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        issues={issues}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
  }

  it.each([
    [2, 1, "error", "2 errors, 1 warning"],
    [0, 3, "warning", "3 warnings"],
    [0, 0, "none", "No issues"],
  ] as const)(
    "badges %s errors and %s warnings as %s",
    (errorCount, warningCount, severity, text) => {
      const markup = statusbarWithIssues({
        errorCount,
        warningCount,
        onOpen: vi.fn(),
      });
      expect(markup).toContain(`data-severity="${severity}"`);
      expect(markup).toContain(text);
    },
  );
  it.each(["unchecked", "checking", "stale", "failed"] as const)(
    "does not present %s evidence as a current verdict",
    (checkStatus) => {
      const markup = statusbarWithIssues({
        checkStatus,
        errorCount: 2,
        warningCount: 3,
        onOpen: vi.fn(),
      });
      expect(markup).toContain('data-severity="none"');
      expect(markup).not.toContain("2 errors");
      expect(markup).not.toContain("No issues");
      expect(markup).toContain(`data-check-status="${checkStatus}"`);
      if (checkStatus === "unchecked") {
        expect(markup).toContain(
          "No check has run — open Issues and choose Check and Save",
        );
      }
    },
  );
});
