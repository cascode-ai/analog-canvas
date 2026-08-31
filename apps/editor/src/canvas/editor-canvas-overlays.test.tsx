import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Diagnostic } from "@icm/derived";

import { DiagnosticMarkersOverlay } from "./editor-canvas-overlays";

const finding: Diagnostic = {
  id: "visual:doc:VISUAL_AMBIGUOUS_JUNCTION:J1",
  domain: "visual",
  code: "VISUAL_AMBIGUOUS_JUNCTION",
  severity: "error",
  confidence: "high",
  gateEligible: true,
  message: "Junction J1 lies on unrelated route R9",
  primary: {
    documentId: "doc",
    hierarchyPath: [],
    kind: "junction",
    objectId: "J1",
  },
  related: [],
  parameters: {},
};

describe("DiagnosticMarkersOverlay", () => {
  it("renders severity-colored rings at finding points", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticMarkersOverlay
        markers={[
          {
            key: "100,40",
            point: { x: 100, y: 40 },
            severity: "error",
            count: 1,
            diagnostic: finding,
          },
          {
            key: "200,40",
            point: { x: 200, y: 40 },
            severity: "warning",
            count: 1,
            diagnostic: { ...finding, id: "erc:2", severity: "warning" },
          },
        ]}
        onSelectMarker={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="diagnostic-markers"');
    expect(markup).toContain('data-severity="error"');
    expect(markup).toContain('data-severity="warning"');
    expect(markup).toContain('class="diagnostic-marker-ring"');
  });

  it("adds a numeral only for clustered findings", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticMarkersOverlay
        markers={[
          {
            key: "100,40",
            point: { x: 100, y: 40 },
            severity: "error",
            count: 3,
            diagnostic: finding,
          },
        ]}
        onSelectMarker={vi.fn()}
      />,
    );
    expect(markup).toContain('class="diagnostic-marker-count"');
    expect(markup).toContain(">3</text>");
  });

  it("renders nothing without markers", () => {
    expect(
      renderToStaticMarkup(
        <DiagnosticMarkersOverlay markers={[]} onSelectMarker={vi.fn()} />,
      ),
    ).toBe("");
  });
});
