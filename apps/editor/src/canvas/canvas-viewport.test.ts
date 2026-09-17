import type { GridRect } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  canvasPointFromClient,
  logicalRadiusForCanvasPixels,
  wireCaptureRadius,
} from "./canvas-viewport";

const viewBox: GridRect = { x: 100, y: 200, width: 800, height: 400 };

function svgWithoutMatrix(): SVGSVGElement {
  return {
    getScreenCTM: () => null,
    getBoundingClientRect: () =>
      ({ left: 10, top: 20, width: 400, height: 200 }) as DOMRect,
  } as unknown as SVGSVGElement;
}

describe("canvas viewport coordinates", () => {
  it.each([0.25, 0.5, 1, 2, 3, 4, 8])(
    "keeps electrical capture usable and bounded at scale %s",
    (scale) => {
      const svg = {
        getScreenCTM: () => ({ a: scale, b: 0, c: 0, d: scale }),
      } as unknown as SVGSVGElement;
      const radius = wireCaptureRadius(svg);
      expect(radius * scale).toBeGreaterThanOrEqual(6);
      expect(radius * scale).toBeLessThanOrEqual(24);
      if (scale >= 1 && scale <= 3) expect(radius).toBe(7);
    },
  );
  it("maps fallback client coordinates through the active view box", () => {
    expect(
      canvasPointFromClient(110, 70, svgWithoutMatrix(), viewBox, 10, false),
    ).toEqual({ x: 300, y: 300 });
  });

  it("applies grid snapping after fallback projection", () => {
    expect(
      canvasPointFromClient(113, 72, svgWithoutMatrix(), viewBox, 20, true),
    ).toEqual({ x: 300, y: 300 });
  });

  it("keeps a pixel radius when the SVG matrix is unavailable", () => {
    expect(logicalRadiusForCanvasPixels(svgWithoutMatrix(), 7)).toBe(7);
  });

  it("converts the capture radius through the average SVG scale", () => {
    const svg = {
      getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 4 }),
    } as unknown as SVGSVGElement;

    expect(logicalRadiusForCanvasPixels(svg, 9)).toBe(3);
  });
});
