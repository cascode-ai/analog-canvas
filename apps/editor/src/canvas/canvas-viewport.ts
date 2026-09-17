import type { DerivedPoint, GridRect } from "@icm/model";

import { logicalToleranceForScale, snapCoordinate } from "../snap/engine";
import type { SnapGuideLine } from "../snap/engine";

/** Convert one browser client point into the current SVG canvas coordinate space. */
export function canvasPointFromClient(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  viewBox: GridRect,
  grid: number,
  snapToGrid: boolean,
): DerivedPoint {
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const clientPoint = svg.createSVGPoint();
    clientPoint.x = clientX;
    clientPoint.y = clientY;
    const localPoint = clientPoint.matrixTransform(matrix.inverse());
    return {
      x: snapToGrid ? snapCoordinate(localPoint.x, grid) : localPoint.x,
      y: snapToGrid ? snapCoordinate(localPoint.y, grid) : localPoint.y,
    };
  }
  const bounds = svg.getBoundingClientRect();
  const x =
    viewBox.x + ((clientX - bounds.left) / bounds.width) * viewBox.width;
  const y =
    viewBox.y + ((clientY - bounds.top) / bounds.height) * viewBox.height;
  return {
    x: snapToGrid ? snapCoordinate(x, grid) : x,
    y: snapToGrid ? snapCoordinate(y, grid) : y,
  };
}

/** Convert a screen-pixel capture radius to logical canvas units. */
export function logicalRadiusForCanvasPixels(
  svg: SVGSVGElement,
  pixels: number,
): number {
  const matrix = svg.getScreenCTM();
  if (!matrix) return pixels;
  const xScale = Math.hypot(matrix.a, matrix.b);
  const yScale = Math.hypot(matrix.c, matrix.d);
  return logicalToleranceForScale(pixels, (xScale + yScale) / 2);
}

/** Electrical capture grows with the drawing, bounded for very far zooms. */
export function wireCaptureRadius(svg: SVGSVGElement): number {
  const unitsPerPixel = logicalRadiusForCanvasPixels(svg, 1);
  return Math.min(24 * unitsPerPixel, Math.max(6 * unitsPerPixel, 7));
}

/** Replace the imperative Smart Snap overlay without involving the scene render. */
export function replaceCanvasSnapGuides(
  layer: SVGGElement | null,
  guides: readonly SnapGuideLine[],
): void {
  if (!layer) return;
  layer.replaceChildren(
    ...guides.map((guide) => {
      const line = layer.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("class", "smart-snap-guide");
      line.setAttribute("data-testid", `snap-guide-${guide.axis}`);
      line.setAttribute(
        "x1",
        String(guide.axis === "x" ? guide.coordinate : guide.from - 24),
      );
      line.setAttribute(
        "y1",
        String(guide.axis === "y" ? guide.coordinate : guide.from - 24),
      );
      line.setAttribute(
        "x2",
        String(guide.axis === "x" ? guide.coordinate : guide.to + 24),
      );
      line.setAttribute(
        "y2",
        String(guide.axis === "y" ? guide.coordinate : guide.to + 24),
      );
      return line;
    }),
  );
}
