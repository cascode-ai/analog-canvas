import type { FormalExportSource } from "./index.js";

/** Measure the exact formal scene in an isolated browser document, not editor hits. */
export async function measureFormalExportSource(
  source: FormalExportSource,
  margin: number,
): Promise<FormalExportSource> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;border:0";
  document.body.append(frame);
  try {
    const owner = frame.contentDocument!;
    const parsed = new DOMParser().parseFromString(source.svg, "image/svg+xml");
    const svg = owner.importNode(
      parsed.documentElement,
      true,
    ) as unknown as SVGSVGElement;
    owner.body.append(svg);
    // A formal background is a direct child, outside the scene. It must not
    // participate in the crop it will eventually fill.
    const background = Array.from(svg.children).find(
      (child) => child.localName === "rect",
    );
    const shapes = Array.from(
      svg.querySelectorAll<SVGGraphicsElement>(
        "path,polyline,polygon,circle,ellipse,rect,line,text,image,use",
      ),
    ).filter((shape) => shape !== background && !shape.closest("defs"));
    // Force font discovery before waiting. This document has exactly the same
    // inline styles as the SVG image; editor CSS cannot change its typography.
    svg.getBBox();
    await owner.fonts.ready;
    const rootMatrix = svg.getCTM();
    if (!rootMatrix) throw new Error("Cannot measure export scene");
    const inverse = rootMatrix.inverse();
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const shape of shapes) {
      const style = frame.contentWindow!.getComputedStyle(shape);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      )
        continue;
      const box = shape.getBBox();
      if (box.width === 0 && box.height === 0) continue;
      const matrix = shape.getCTM();
      if (!matrix) continue;
      // getBBox does not consistently include strokes across browsers. Reserve
      // the stroke envelope explicitly, including possible miter joins.
      const stroke =
        style.stroke !== "none" ? parseFloat(style.strokeWidth) || 0 : 0;
      const join =
        style.strokeLinejoin === "miter" &&
        /^(path|polyline|polygon)$/.test(shape.localName)
          ? Math.max(1, parseFloat(style.strokeMiterlimit) || 4)
          : 1;
      const outset = (stroke * join) / 2;
      const transform = inverse.multiply(matrix);
      for (const x of [box.x - outset, box.x + box.width + outset]) {
        for (const y of [box.y - outset, box.y + box.height + outset]) {
          const point = new DOMPoint(x, y).matrixTransform(transform);
          left = Math.min(left, point.x);
          top = Math.min(top, point.y);
          right = Math.max(right, point.x);
          bottom = Math.max(bottom, point.y);
        }
      }
    }
    if (!Number.isFinite(left)) return source;
    const bounds = {
      x: left - margin,
      y: top - margin,
      width: Math.max(1, right - left + margin * 2),
      height: Math.max(1, bottom - top + margin * 2),
    };
    svg.setAttribute(
      "viewBox",
      `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
    );
    if (background) {
      for (const [name, value] of Object.entries(bounds))
        background.setAttribute(name, String(value));
    }
    return { svg: new XMLSerializer().serializeToString(svg), bounds };
  } finally {
    frame.remove();
  }
}
