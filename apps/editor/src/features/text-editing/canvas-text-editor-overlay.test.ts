import { describe, expect, it } from "vitest";

import { resolveCanvasTextEditorFrame } from "./canvas-text-editor-overlay";

const target = { x: 100, y: 200, width: 200, height: 30 };
const camera = (width: number, height: number) => ({
  x: 0,
  y: 0,
  width,
  height,
});

describe("canvas text editor frame", () => {
  it("holds one apparent size however far the camera is zoomed", () => {
    // Sized in Document units, the panel was part of the drawing: it grew on
    // zoom in and shrank to illegibility on zoom out. What has to stay
    // constant is its share of the camera, which is its share of the canvas.
    const shares = [240, 960, 3840].map((width) => {
      const frame = resolveCanvasTextEditorFrame(
        target,
        camera(width, width * (2 / 3)),
        1,
      );
      return frame.width / width;
    });
    for (const share of shares) expect(share).toBeCloseTo(shares[0]!, 10);
    // And a sensible share: neither a sliver nor the whole canvas.
    expect(shares[0]!).toBeGreaterThan(0.25);
    expect(shares[0]!).toBeLessThan(0.6);
  });

  it("lays its contents out at a fixed pixel size and scales them as one", () => {
    const near = resolveCanvasTextEditorFrame(target, camera(240, 160), 1);
    const far = resolveCanvasTextEditorFrame(target, camera(3840, 2560), 1);
    // The layout never changes, so the panel never reflows on zoom; only the
    // scale that maps it onto the camera does.
    expect(near.layoutWidth).toBe(far.layoutWidth);
    expect(near.layoutHeight).toBe(far.layoutHeight);
    expect(near.width).toBeCloseTo(near.layoutWidth * near.scale, 10);
    expect(far.scale / near.scale).toBeCloseTo(3840 / 240, 10);
  });

  it("gives larger text more room, in layout pixels", () => {
    const small = resolveCanvasTextEditorFrame(target, camera(960, 640), 1);
    const large = resolveCanvasTextEditorFrame(target, camera(960, 640), 3);
    expect(large.layoutHeight).toBeGreaterThan(small.layoutHeight);
    // The width is the panel's own; only the height follows the text.
    expect(large.layoutWidth).toBe(small.layoutWidth);
  });

  it("budgets several wrapped lines so a long name is not clipped away", () => {
    // The frame is sized from the committed bounds, before any longer name is
    // typed, and the overlay is a foreignObject that clips silently.
    const oneLine = 15.116 * 1.2;
    const frame = resolveCanvasTextEditorFrame(target, camera(960, 640), 1);
    expect(frame.layoutHeight).toBeGreaterThan(54 + oneLine * 2);
  });

  it("clamps the frame to all four viewport edges", () => {
    const view = camera(960, 640);
    const topLeft = resolveCanvasTextEditorFrame(
      { x: -20, y: -10, width: 40, height: 20 },
      view,
      1,
    );
    expect(topLeft.x).toBe(8);
    expect(topLeft.y).toBe(18);

    const bottomRight = resolveCanvasTextEditorFrame(
      { x: 950, y: 630, width: 200, height: 50 },
      view,
      1,
    );
    expect(bottomRight.x + bottomRight.width).toBeLessThanOrEqual(960 - 8);
    expect(bottomRight.y + bottomRight.height).toBeLessThanOrEqual(640 - 8);
  });

  it("stays inside a translated viewport", () => {
    const frame = resolveCanvasTextEditorFrame(
      { x: -100, y: -100, width: 1200, height: 800 },
      { x: 20, y: 30, width: 960, height: 640 },
      1,
    );
    expect(frame.x).toBeGreaterThanOrEqual(28);
    expect(frame.y).toBeGreaterThanOrEqual(38);
    expect(frame.x + frame.width).toBeLessThanOrEqual(20 + 960 - 8);
  });
});
