import { describe, expect, it } from "vitest";

import {
  canvasInsetsOnScreen,
  resolveCanvasTextEditorFrame,
  shownCanvasView,
} from "./canvas-text-editor-overlay";

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

  it("uses one screen width at full- and half-window sizes", () => {
    for (const [view, pixelsPerUnit] of [
      [camera(960, 640), 0.95],
      [camera(960, 640), 0.7],
      [camera(240, 160), 3.8],
      [camera(3840, 2560), 0.2375],
    ] as const) {
      const frame = resolveCanvasTextEditorFrame(
        target,
        view,
        1,
        pixelsPerUnit,
      );
      expect(view.width * pixelsPerUnit).toBeGreaterThan(344);
      expect(frame.width * pixelsPerUnit).toBeCloseTo(344, 10);
      expect(frame.layoutWidth).toBeCloseTo(344, 10);
    }
  });

  it("stays clear of the part of the canvas a dock covers", () => {
    // Text beside a right-hand dock: clamped to the whole camera, the panel
    // opened under the dock, so its right-aligned text was hidden.
    const beside = { x: 620, y: 200, width: 40, height: 20 };
    const obscured = { left: 0, right: 40, top: 0, bottom: 0 };
    const frame = resolveCanvasTextEditorFrame(
      beside,
      camera(720, 640),
      1,
      1,
      null,
      obscured,
    );
    expect(frame.width).toBeCloseTo(344, 10);
    expect(frame.x + frame.width).toBeLessThanOrEqual(720 - 40 - 8);
    const unobscured = resolveCanvasTextEditorFrame(
      beside,
      camera(720, 640),
      1,
      1,
    );
    expect(unobscured.x + unobscured.width).toBeGreaterThan(720 - 40);
    // A dock wider than the canvas leaves nothing to dodge into.
    const covered = resolveCanvasTextEditorFrame(
      beside,
      camera(720, 640),
      1,
      1,
      null,
      { left: 0, right: 800, top: 0, bottom: 0 },
    );
    expect(covered.x).toBeGreaterThanOrEqual(8);
  });

  it("shrinks only when the canvas cannot fit the standard editor", () => {
    const frame = resolveCanvasTextEditorFrame(target, camera(300, 640), 1, 1);
    expect(frame.layoutWidth).toBe(284);
    expect(frame.x).toBeGreaterThanOrEqual(8);
    expect(frame.x + frame.width).toBeLessThanOrEqual(292);
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
    expect(frame.width / 960).toBeCloseTo(1 / 2, 10);
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

  it("never grows past the visible canvas, so a phone reaches Insert (#2172)", () => {
    // 320×568 at the default 100% zoom: one Document unit is one pixel, the
    // canvas 524 px tall under the header, the label mid-screen. The formula
    // editor open measures 520 px, more than fits above or below the label.
    const label = { x: 140, y: 270, width: 40, height: 18 };
    const phone = resolveCanvasTextEditorFrame(
      label,
      camera(320, 524),
      1,
      1,
      520,
    );
    expect(phone.maxLayoutHeight).toBe(524 - 16);
    expect(phone.layoutHeight).toBe(phone.maxLayoutHeight);
    expect(phone.y).toBeGreaterThanOrEqual(8);
    expect(phone.y + phone.height).toBeLessThanOrEqual(524 - 8);
    expect(phone.layoutWidth).toBe(304);
    // 390×844 has the room: the whole editor opens below the label.
    const tall = resolveCanvasTextEditorFrame(
      label,
      camera(390, 800),
      1,
      1,
      480,
    );
    expect(tall.layoutHeight).toBe(480);
    expect(tall.y).toBeGreaterThan(label.y + label.height);
    expect(tall.y + tall.height).toBeLessThanOrEqual(800 - 8);
  });

  it("keeps to the part of the canvas on screen (#2172)", () => {
    // A canvas element taller than the screen it is shown on: what lies
    // below the screen counts as covered, joined with any dock.
    const canvas = { x: 0, y: 44, width: 320, height: 800 };
    const screen = { x: 0, y: 0, width: 320, height: 568 };
    const docks = { left: 0, right: 30, top: 0, bottom: 0 };
    const obscured = canvasInsetsOnScreen(canvas, screen, docks);
    expect(obscured).toEqual({ left: 0, right: 30, top: 0, bottom: 276 });
    const frame = resolveCanvasTextEditorFrame(
      { x: 140, y: 270, width: 40, height: 18 },
      camera(320, 800),
      1,
      1,
      520,
      obscured,
    );
    // On screen: canvas top 44 plus frame, within the 568 px screen.
    expect(44 + frame.y + frame.height).toBeLessThanOrEqual(568 - 8);
    expect(frame.layoutHeight).toBe(800 - 276 - 16);
    // A canvas wholly on screen loses nothing.
    expect(
      canvasInsetsOnScreen(
        { x: 0, y: 44, width: 320, height: 500 },
        screen,
        docks,
      ),
    ).toEqual(docks);
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

describe("the area the canvas shows (#2207)", () => {
  it("lays the panel out across a short landscape window, not the camera's strip", () => {
    // Fit view in a tall window, then the window turns 640x264 (canvas).
    const fitted = camera(900, 744);
    const canvas = { width: 640, height: 264 };
    const pixelsPerUnit = Math.min(640 / 900, 264 / 744);
    const shown = shownCanvasView(fitted, canvas);
    expect(shown.width * pixelsPerUnit).toBeCloseTo(640, 6);
    expect(shown.height * pixelsPerUnit).toBeCloseTo(264, 6);
    expect(shown.x + shown.width / 2).toBeCloseTo(450, 6);
    const docks = { left: 0, right: 0, top: 0, bottom: 0 };
    const squeezed = resolveCanvasTextEditorFrame(
      target,
      fitted,
      1,
      pixelsPerUnit,
      null,
      docks,
    );
    const laidOut = resolveCanvasTextEditorFrame(
      target,
      shown,
      1,
      pixelsPerUnit,
      null,
      docks,
    );
    // The camera's strip is about 320 px wide on screen; the window is 640.
    expect(laidOut.layoutWidth).toBeGreaterThan(squeezed.layoutWidth);
    expect(laidOut.x + laidOut.width).toBeLessThanOrEqual(
      shown.x + shown.width,
    );
    expect(laidOut.x).toBeGreaterThanOrEqual(shown.x);
  });

  it("is the camera itself before the canvas is measured", () => {
    expect(shownCanvasView(camera(900, 744), null)).toEqual(camera(900, 744));
  });
});
