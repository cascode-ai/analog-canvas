import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorStatusbar } from "./editor-statusbar";

describe("editor statusbar", () => {
  it("renders the active wire options and recovery state", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="wire"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen
        wireRoutingMode="orthogonal"
        wireCornerOrder="horizontal-first"
        recoveryLabel="Saved locally"
        zoomPercent={100}
        shortcutHintsVisible={false}
        onToggleShortcutHints={vi.fn()}
        gridVisible
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
    expect(markup).toContain('data-testid="wire-options"');
    expect(markup).toContain("Saved locally");
    expect(markup).toContain('aria-label="Current zoom"');
    expect(markup).toContain('data-testid="statusbar-change-log"');
    expect(markup).toContain(
      'href="https://github.com/cascode-ai/analog-canvas/commits/main"',
    );
    expect(markup).not.toContain('aria-label="Annotation grid"');
    expect(markup).not.toContain('aria-label="Draw angle"');
    expect(markup).not.toContain('aria-label="Scroll wheel"');
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

  it("places an explicit shortcut-hints toggle beside the grid control", () => {
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
        shortcutHintsVisible
        onToggleShortcutHints={vi.fn()}
        gridVisible
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

    const hints = markup.indexOf('data-testid="statusbar-shortcut-hints"');
    const grid = markup.indexOf('data-testid="statusbar-grid-toggle"');
    expect(hints).toBeGreaterThan(-1);
    expect(hints).toBeLessThan(grid);
    expect(markup.slice(hints, grid)).toContain('aria-pressed="true"');
    expect(markup.slice(hints, grid)).toContain("Hints");
  });

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

  it("shows an error-severity issues badge with combined counts", () => {
    const markup = statusbarWithIssues({
      errorCount: 2,
      warningCount: 1,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="error"');
    expect(markup).toContain("2 errors, 1 warning");
    expect(markup).toContain("Action required");
  });

  it("shows a compact entry point only while selection is filtered", () => {
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
        selectionFilterSummary="Filter: Wires"
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
    expect(markup).toContain('data-testid="selection-filter-status"');
    expect(markup).toContain("Filter: Wires");
  });

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
    },
  );

  it("shows a warning-severity issues badge without errors", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 3,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-severity="warning"');
    expect(markup).toContain("3 warnings");
  });

  it("keeps a quiet zero-state badge as the discoverable entry point", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 0,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="none"');
    expect(markup).toContain("No issues");
  });
});
