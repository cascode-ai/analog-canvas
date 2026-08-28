import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NetLabelTetherOverlay } from "./editor-canvas-overlays";

describe("NetLabelTetherOverlay", () => {
  it("draws a tether line and a ring on the conductor point", () => {
    const markup = renderToStaticMarkup(
      <NetLabelTetherOverlay
        tether={{
          label: { x: 120, y: 60 },
          conductor: { x: 100, y: 100 },
          netName: "net-a",
        }}
      />,
    );
    expect(markup).toContain('data-testid="net-label-tether"');
    expect(markup).toContain('x2="100"');
    expect(markup).toContain('cy="100"');
  });

  it("renders nothing without a selected net label", () => {
    expect(renderToStaticMarkup(<NetLabelTetherOverlay tether={null} />)).toBe(
      "",
    );
  });
});
