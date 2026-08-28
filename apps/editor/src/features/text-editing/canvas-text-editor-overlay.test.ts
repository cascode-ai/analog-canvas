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
  it("lays out in real screen pixels when the canvas has been measured", () => {
    // The panel is chrome, not artwork: its type has to be set against the
    // menus, which means its layout has to be in the same pixels they are.
    const pixelsPerUnit = 0.95;
    const frame = resolveCanvasTextEditorFrame(
      target,
      camera(960, 640),
      1,
      pixelsPerUnit,
    );
    expect(frame.scale * pixelsPerUnit).toBeCloseTo(1, 10);
    // One layout pixel paints as one screen pixel, so a 15px font is 15px.
    expect(frame.layoutWidth).toBeCloseTo(frame.width * pixelsPerUnit, 10);
  });

  it("covers two thirds of the canvas", () => {
    for (const [view, pixelsPerUnit] of [
      [camera(960, 640), 0.95],
      [camera(240, 160), 3.8],
      [camera(3840, 2560), 0.2375],
    ] as const) {
      const frame = resolveCanvasTextEditorFrame(
        target,
        view,
        1,
        pixelsPerUnit,
      );
      expect(frame.width / view.width).toBeCloseTo(2 / 3, 10);
      // Which is two thirds of the canvas, in pixels, at every zoom.
      const canvasPx = view.width * pixelsPerUnit;
      expect((frame.width * pixelsPerUnit) / canvasPx).toBeCloseTo(2 / 3, 10);
    }
  });

  it("holds one apparent size however far the camera is zoomed", () => {
    // Sized in Document units, the panel was part of the drawing: it grew on
    // zoom in and shrank to illegibility on zoom out.
    const shares = [240, 960, 3840].map((width) => {
      const frame = resolveCanvasTextEditorFrame(
        target,
        camera(width, width * (2 / 3)),
        1,
      );
      return frame.width / width;
    });
    for (const share of shares) expect(share).toBeCloseTo(shares[0]!, 10);
  });

  it("stays proportional before the canvas has been measured", () => {
    // The first paint has no measurement; the panel must still be sensible.
    const frame = resolveCanvasTextEditorFrame(target, camera(960, 640), 1);
    expect(frame.width / 960).toBeCloseTo(2 / 3, 10);
    expect(frame.layoutWidth).toBeGreaterThan(0);
  });

  it("gives larger text more room, in layout pixels", () => {
    const small = resolveCanvasTextEditorFrame(target, camera(960, 640), 1, 1);
    const large = resolveCanvasTextEditorFrame(target, camera(960, 640), 3, 1);
    expect(large.layoutHeight).toBeGreaterThan(small.layoutHeight);
    // The width is the panel's own; only the height follows the text.
    expect(large.layoutWidth).toBe(small.layoutWidth);
  });

  it("budgets several wrapped lines so a long name is not clipped away", () => {
    // The frame is sized from the committed bounds, before any longer name is
    // typed, and the overlay is a foreignObject that clips silently.
    const oneLine = 15.116 * 1.2;
    const frame = resolveCanvasTextEditorFrame(target, camera(960, 640), 1, 1);
    expect(frame.layoutHeight).toBeGreaterThan(54 + oneLine * 2);
  });

  it("expands to the editor's measured content height", () => {
    const frame = resolveCanvasTextEditorFrame(
      target,
      camera(960, 640),
      1,
      1,
      312,
    );
    expect(frame.layoutHeight).toBe(312);
    expect(frame.height).toBe(312);
  });

  it("clamps the frame to all four viewport edges", () => {
    const view = camera(960, 640);
    const topLeft = resolveCanvasTextEditorFrame(
      { x: -20, y: -10, width: 40, height: 20 },
      view,
      1,
      1,
    );
    expect(topLeft.x).toBe(8);
    expect(topLeft.y).toBe(18);

    const bottomRight = resolveCanvasTextEditorFrame(
      { x: 950, y: 630, width: 200, height: 50 },
      view,
      1,
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
      1,
    );
    expect(frame.x).toBeGreaterThanOrEqual(28);
    expect(frame.y).toBeGreaterThanOrEqual(38);
    expect(frame.x + frame.width).toBeLessThanOrEqual(20 + 960 - 8);
  });
});
