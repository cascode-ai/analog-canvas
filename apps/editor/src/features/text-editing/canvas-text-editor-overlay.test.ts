import { describe, expect, it } from "vitest";

import { resolveCanvasTextEditorFrame } from "./canvas-text-editor-overlay";

describe("canvas text editor frame", () => {
  it("uses the default editor size near the target", () => {
    expect(
      resolveCanvasTextEditorFrame(
        { x: 100, y: 200, width: 200, height: 30 },
        { x: 0, y: 0, width: 960, height: 640 },
        1,
      ),
    ).toEqual({ x: 94, y: 83.5824, width: 420, height: 108.4176 });
  });

  it("grows with text scale before reaching the viewport boundary", () => {
    const frame = resolveCanvasTextEditorFrame(
      { x: 100, y: 200, width: 200, height: 30 },
      { x: 0, y: 0, width: 960, height: 640 },
      3,
    );

    expect(frame.x).toBe(94);
    expect(frame.y).toBeCloseTo(238);
    expect(frame.width).toBe(420);
    expect(frame.height).toBeCloseTo(217.2528);
  });

  it("clamps the frame to all four viewport edges", () => {
    expect(
      resolveCanvasTextEditorFrame(
        { x: -20, y: -10, width: 40, height: 20 },
        { x: 0, y: 0, width: 960, height: 640 },
        1,
      ),
    ).toEqual({ x: 8, y: 18, width: 420, height: 108.4176 });

    expect(
      resolveCanvasTextEditorFrame(
        { x: 950, y: 630, width: 200, height: 50 },
        { x: 0, y: 0, width: 960, height: 640 },
        1,
      ),
    ).toEqual({ x: 532, y: 513.5824, width: 420, height: 108.4176 });
  });

  it("fits oversized content inside a translated viewport", () => {
    expect(
      resolveCanvasTextEditorFrame(
        { x: -100, y: -100, width: 1200, height: 800 },
        { x: 20, y: 30, width: 960, height: 640 },
        1,
      ),
    ).toEqual({ x: 28, y: 38, width: 944, height: 624 });
  });

  it("budgets several wrapped lines so a long name is not clipped away", () => {
    // The frame is sized from the committed bounds, before any longer name is
    // typed, and the overlay is a foreignObject that clips silently. One
    // line's worth of height left a wrapped name unreadable.
    const oneLine = 15.116 * 1.2;
    const frame = resolveCanvasTextEditorFrame(
      { x: 100, y: 200, width: 200, height: 30 },
      { x: 0, y: 0, width: 960, height: 640 },
      1,
    );

    expect(frame.height).toBeGreaterThan(54 + oneLine * 2);
  });
});
