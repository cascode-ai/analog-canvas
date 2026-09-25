import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LabelTetherOverlay } from "./editor-canvas-overlays";

describe("LabelTetherOverlay", () => {
  it("draws a glowing line to each label's owner, ringing wires and pins", () => {
    const markup = renderToStaticMarkup(
      <LabelTetherOverlay
        tethers={[
          {
            annotationId: "net-label",
            kind: "wire",
            ownerId: "route",
            label: { x: 120, y: 60 },
            target: { x: 100, y: 100 },
          },
          {
            annotationId: "part-name",
            kind: "part",
            ownerId: "R1",
            label: { x: 40, y: 10 },
            target: { x: 30, y: 20 },
          },
        ]}
      />,
    );
    expect(markup.match(/data-testid="label-tether"/gu)).toHaveLength(2);
    expect(markup).toContain('data-tether-kind="wire"');
    expect(markup).toContain('data-tether-kind="part"');
    // Each end names the object whose drag carries it.
    expect(markup).toContain('data-tether-label-id="part-name"');
    expect(markup).toContain('data-tether-owner-id="R1"');
    expect(markup).toContain('class="label-tether-glow"');
    expect(markup).toContain('x2="100"');
    // A wire tap is ringed; a part is lit by the selection halo instead.
    expect(markup.match(/<circle/gu)).toHaveLength(1);
    expect(markup).toContain('cy="100"');
  });

  it("keeps a zero-length line for a label touching its owner, and draws nothing without tethers", () => {
    const markup = renderToStaticMarkup(
      <LabelTetherOverlay
        tethers={[
          {
            annotationId: "inside",
            kind: "part",
            ownerId: "R1",
            label: { x: 30, y: 20 },
            target: { x: 30, y: 20 },
          },
        ]}
      />,
    );
    // Invisible until a drag stretches it, but there to stretch.
    expect(markup.match(/<line/gu)).toHaveLength(2);
    expect(markup).toContain('x1="30" y1="20" x2="30" y2="20"');
    expect(renderToStaticMarkup(<LabelTetherOverlay tethers={[]} />)).toBe("");
  });
});
