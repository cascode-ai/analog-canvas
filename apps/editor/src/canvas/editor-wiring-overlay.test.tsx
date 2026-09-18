import type { Flightline } from "@icm/derived";
import { semanticTextDocument } from "@icm/model";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EditorWiringOverlay,
  NetLabelEditorOverlay,
} from "./editor-wiring-overlay";

describe("editor wiring overlay", () => {
  it("keeps the naming editor separate from wiring guidance and previews", () => {
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
          viewBox={{ x: 0, y: 0, width: 960, height: 640 }}
          netLabelPlacement={{
            phase: "naming",
            content: semanticTextDocument("OUT", "net-label"),
            sizeScale: 1,
            alignment: "start",
            position: { x: 50, y: 20 },
          }}
          onNetLabelTextChange={vi.fn()}
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

    expect(markup).not.toContain('data-testid="net-label-editor"');
    expect(markup).toContain('data-testid="flightline-hit"');
    expect(markup).toContain('class="wire-preview bulk-route-preview"');
    // A pass-through contact is drawn, so a wire crossing a pin looks the way
    // it will behave once the release makes that connection.
    expect(markup).toContain('data-testid="wire-preview-contact"');
    expect(markup).toContain('cx="10"');
    expect(markup).toContain('data-layer="snap-guides"');
  });

  it("renders Net Label naming as its own interactive top overlay", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <NetLabelEditorOverlay
          viewBox={{ x: 0, y: 0, width: 960, height: 640 }}
          netLabelPlacement={{
            phase: "naming",
            content: semanticTextDocument("OUT", "net-label"),
            sizeScale: 1,
            alignment: "start",
            position: { x: 50, y: 20 },
          }}
          onNetLabelTextChange={vi.fn()}
          onNetLabelSubmit={vi.fn()}
          onNetLabelEscape={vi.fn()}
        />
      </svg>,
    );

    expect(markup).toContain('data-testid="net-label-editor"');
    expect(markup).toContain('data-layer="net-label-editor-overlay"');
    expect(markup).toContain('data-testid="canvas-text-editor"');
    expect(markup).toContain('aria-label="Italic"');
    expect(markup).toContain("font-style:italic");
  });

  it("renders a floating Net Label ghost after naming", () => {
    const markup = renderToStaticMarkup(
      <svg>
        <EditorWiringOverlay
          viewBox={{ x: 0, y: 0, width: 960, height: 640 }}
          netLabelPlacement={{
            phase: "placing",
            content: semanticTextDocument("SIGNAL", "net-label"),
            sizeScale: 1.2,
            alignment: "end",
            position: { x: 80, y: 40 },
          }}
          onNetLabelTextChange={vi.fn()}
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
    expect(markup).toContain('text-anchor="end"');
    expect(markup).toContain('x="80"');
    expect(markup).toContain('y="40"');
  });
});
