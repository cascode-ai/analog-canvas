import type { Flightline } from "@icm/derived";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorWiringOverlay } from "./editor-wiring-overlay";

describe("editor wiring overlay", () => {
  it("renders net editing, guidance, and a bulk wire preview in layer order", () => {
    const flightline = {
      id: "guide-1",
      netId: "net-1",
      fromNetId: "net-1",
      toNetId: "net-1",
      fromPoint: { x: 10, y: 30 },
      toPoint: { x: 90, y: 30 },
    } as Flightline;
    const markup = renderToStaticMarkup(
      <svg>
        <EditorWiringOverlay
          netLabelPlacement={{
            phase: "naming",
            draft: "OUT",
            position: { x: 50, y: 20 },
          }}
          netLabelEditorInputRef={createRef<HTMLInputElement>()}
          onNetLabelDraftChange={vi.fn()}
          onNetLabelSubmit={vi.fn()}
          onNetLabelEscape={vi.fn()}
          flightlines={[flightline]}
          onFlightlineClick={vi.fn()}
          wireDraftPreview={{
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 20, y: 20 },
            ],
            contacts: [{ x: 10, y: 10 }],
          }}
          bulkRoutePreview
          snapGuideLayerRef={createRef<SVGGElement>()}
        />
      </svg>,
    );

    expect(markup).toContain('data-testid="net-label-editor"');
    expect(markup).toContain('value="OUT"');
    expect(markup).toContain('data-testid="flightline-hit"');
    expect(markup).toContain('class="wire-preview bulk-route-preview"');
    // A pass-through contact is drawn, so a wire crossing a pin looks the way
    // it will behave once the release makes that connection.
    expect(markup).toContain('data-testid="wire-preview-contact"');
    expect(markup).toContain('cx="10"');
    expect(markup).toContain('data-layer="snap-guides"');
  });

  it("renders a floating Net Label ghost after naming", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <EditorWiringOverlay
          netLabelPlacement={{
            phase: "placing",
            draft: "SIGNAL",
            position: { x: 80, y: 40 },
          }}
          netLabelEditorInputRef={createRef<HTMLInputElement>()}
          onNetLabelDraftChange={vi.fn()}
          onNetLabelSubmit={vi.fn()}
          onNetLabelEscape={vi.fn()}
          flightlines={[]}
          onFlightlineClick={vi.fn()}
          wireDraftPreview={{ points: [], contacts: [] }}
          bulkRoutePreview={false}
          snapGuideLayerRef={createRef<SVGGElement>()}
        />
      </svg>,
    );

    expect(markup).not.toContain('data-testid="net-label-editor"');
    expect(markup).toContain('data-testid="net-label-placement-preview"');
    expect(markup).toContain("SIGNAL");
    expect(markup).toContain('x="80"');
    expect(markup).toContain('y="40"');
  });
});
