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
});
