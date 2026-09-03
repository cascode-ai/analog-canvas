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
        gridDotsVisible
        drawAngleMode="free"
        wheelBehavior="auto"
        onWheelBehaviorChange={vi.fn()}
        onDrawAngleModeChange={vi.fn()}
        annotationGrid={5}
        zoomPercent={100}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onToggleGridDots={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onAnnotationGridChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="wire-options"');
    expect(markup).toContain("Saved locally");
    expect(markup).toContain('aria-label="Current zoom"');
    expect(markup).toContain('aria-label="Annotation grid"');
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
        gridDotsVisible
        drawAngleMode="free"
        wheelBehavior="auto"
        onWheelBehaviorChange={vi.fn()}
        onDrawAngleModeChange={vi.fn()}
        annotationGrid={5}
        zoomPercent={100}
        issues={issues}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onToggleGridDots={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onAnnotationGridChange={vi.fn()}
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
