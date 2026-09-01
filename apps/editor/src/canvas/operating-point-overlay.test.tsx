import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OperatingPointOverlay,
  type OperatingPointBadge,
} from "./editor-canvas-overlays";

const badges: OperatingPointBadge[] = [
  {
    netId: "net-out",
    netLabel: "VOUT",
    text: "900 mV",
    at: { x: 200, y: 100 },
    reason: "named",
  },
  {
    netId: "net-tail",
    netLabel: "net-tail",
    text: "12.3 mV",
    at: { x: 200, y: 200 },
    reason: "hovered",
  },
];

describe("OperatingPointOverlay", () => {
  it("draws nothing at all before a simulation has produced anything", () => {
    // An empty frame would read as "measured, and it is zero".
    expect(renderToStaticMarkup(<OperatingPointOverlay badges={[]} />)).toBe(
      "",
    );
  });

  it("paints each voltage over the conductor it belongs to", () => {
    const markup = renderToStaticMarkup(
      <OperatingPointOverlay badges={badges} />,
    );

    expect(markup).toContain("900 mV");
    expect(markup).toContain("12.3 mV");
    // Anchored above the wire midpoint the feature chose, not floating.
    expect(markup).toContain('x="200"');
  });

  it("offers no way to grab a result, because a result is not an object", () => {
    // ADR 0055: simulation reads the model and never writes it. A layer that
    // could be clicked or dragged would be the first step toward a result
    // that behaves like part of the drawing.
    const markup = renderToStaticMarkup(
      <OperatingPointOverlay badges={badges} />,
    );

    expect(markup).toContain('pointer-events="none"');
    expect(markup).not.toContain("data-canvas-hit-kind");
    expect(markup).not.toContain("data-drag-object-id");
  });

  it("says why each badge is on screen, so transient ones can look transient", () => {
    const markup = renderToStaticMarkup(
      <OperatingPointOverlay badges={badges} />,
    );

    expect(markup).toContain('data-reason="named"');
    expect(markup).toContain('data-reason="hovered"');
  });
});
