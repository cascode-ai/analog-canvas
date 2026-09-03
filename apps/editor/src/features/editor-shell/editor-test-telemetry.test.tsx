import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorTestTelemetry } from "./editor-test-telemetry";

describe("editor test telemetry", () => {
  it("publishes a hidden stable test snapshot", () => {
    const markup = renderToStaticMarkup(
      <EditorTestTelemetry
        snapshot={{
          selectedInternalRouteCount: 2,
          revision: 7,
          sourceStatus: "modified",
          documentCount: 3,
          activeDocumentId: "cell-main",
          activeInstanceCount: 4,
          instanceCount: 9,
          netCount: 5,
          activeTool: "wire",
          flightlineCount: 6,
          displayedFlightlineCount: 1,
          crossingCount: 2,
          annotationCount: 8,
          diagnosticCheckStatus: "current",
          structuralDiagnosticCount: 0,
          visualDiagnosticCount: 3,
          blockingDiagnosticCount: 1,
        }}
      />,
    );
    expect(markup).toContain('data-testid="editor-test-telemetry" hidden=""');
    expect(markup).toContain('data-testid="revision">7</output>');
    expect(markup).toContain(
      'data-testid="selected-internal-route-count">2</output>',
    );
    expect(markup).toContain(
      'data-testid="blocking-diagnostic-count">1</output>',
    );
  });
});
