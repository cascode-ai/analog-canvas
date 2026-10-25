import type { SymbolPrimitive } from "@icm/symbols";

import { AC_UNITS_PER_RNL_UNIT, toRnlPoint, type RnlPoint } from "./place.js";

type Point = { readonly x: number; readonly y: number };

/**
 * An SVG path of absolute M, L, C and Z commands as RNL shapes, one for each
 * subpath: straight legs only make a line; with a cubic leg, a Bézier whose
 * straight legs are cubics with their controls on the leg, so the curve is
 * the one drawn, not an approximation. Any other command (relative, H, V, S,
 * Q, A) gives null.
 */
function pathShapes(data: string): RnlShape[] | null {
  const tokens = data.match(
    /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu,
  );
  if (!tokens) return null;
  const shapes: RnlShape[] = [];
  let points: Point[] = [];
  let controls: (readonly [Point, Point] | null)[] = [];
  const flush = () => {
    if (points.length < 2) return;
    if (!controls.some(Boolean)) {
      shapes.push(pathShape(points));
      return;
    }
    const cubic: RnlPoint[] = [toRnlPoint(points[0]!)];
    points.slice(1).forEach((to, index) => {
      const from = points[index]!;
      const [a, b] = controls[index] ?? [
        between(from, to, 1 / 3),
        between(from, to, 2 / 3),
      ];
      cubic.push(toRnlPoint(a), toRnlPoint(b), toRnlPoint(to));
    });
    shapes.push({ shape: "bezier", points: cubic });
  };
  let index = 0;
  let command = "";
  const point = (): Point | null => {
    const x = Number(tokens[index]);
    const y = Number(tokens[index + 1]);
    index += 2;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  while (index < tokens.length) {
    if (/^[A-Za-z]$/u.test(tokens[index]!)) command = tokens[index++]!;
    if (command === "Z") {
      const [first] = points;
      const last = points.at(-1);
      if (points.length > 1 && (first!.x !== last!.x || first!.y !== last!.y)) {
        points.push(points[0]!);
        controls.push(null);
      }
      flush();
      points = [];
      controls = [];
      command = "";
      continue;
    }
    if (command === "M") {
      flush();
      const start = point();
      if (!start) return null;
      points = [start];
      controls = [];
      // Further pairs after M are line legs.
      command = "L";
    } else if (command === "L") {
      const to = point();
      if (!to || !points.length) return null;
      points.push(to);
      controls.push(null);
    } else if (command === "C") {
      const a = point();
      const b = point();
      const to = point();
      if (!a || !b || !to || !points.length) return null;
      points.push(to);
      controls.push([a, b]);
    } else return null;
  }
  flush();
  return shapes.length ? shapes : null;
}

/**
 * A drawing primitive (language standard 9.2.5) as an edit transaction gives
 * it, in a symbol's frame or in the scene (rnl-dev
 * `notes/rnl-editor-interface/ops-draft-blocks-and-drawings.md`, 2.1):
 *
 * - `line`: two points or more; a last point on the first closes it;
 * - `rectangle`, `circle`: the centre, with width and height or radius;
 * - `bezier`: 3n+1 points, a start then each cubic leg's two controls and end.
 */
export interface RnlShape {
  shape: "line" | "rectangle" | "circle" | "bezier";
  points: RnlPoint[];
  params?: Record<string, string | number>;
  style?: Record<string, string | number>;
}

/** A length in RNL units, kept to a millionth. */
export const rnlLength = (length: number): number =>
  Math.round((length / AC_UNITS_PER_RNL_UNIT) * 1e6) / 1e6 + 0;

const between = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/**
 * A path through `points` whose legs are straight or bent by Analog Canvas's
 * quadratic control: a line, or a cubic Bézier that draws the same curve. A
 * quadratic leg is a cubic with its controls two thirds of the way to the
 * quadratic control; a straight one, with them at a third and two thirds.
 */
export function pathShape(
  points: readonly Point[],
  controls: readonly (Point | null)[] = [],
): RnlShape {
  if (!controls.some(Boolean))
    return { shape: "line", points: points.map(toRnlPoint) };
  const cubic: RnlPoint[] = [toRnlPoint(points[0]!)];
  points.slice(1).forEach((to, index) => {
    const from = points[index]!;
    const control = controls[index] ?? null;
    cubic.push(
      toRnlPoint(
        control ? between(from, control, 2 / 3) : between(from, to, 1 / 3),
      ),
      toRnlPoint(
        control ? between(to, control, 2 / 3) : between(from, to, 2 / 3),
      ),
      toRnlPoint(to),
    );
  });
  return { shape: "bezier", points: cubic };
}

/** A filled shape is filled with its line colour; an unstroked one draws no line. */
function paint(shape: RnlShape, filled: boolean, stroked: boolean): RnlShape {
  return {
    ...shape,
    ...(filled ? { params: { ...shape.params, fill: "linecolor" } } : {}),
    ...(stroked ? {} : { style: { ...shape.style, linestyle: "none" } }),
  };
}

/**
 * A closed outline: an axis-aligned rectangle as RECTANGLE, its centre and
 * size, anything else as a LINE back to its first point.
 */
export function outlineShape(points: readonly Point[]): RnlShape {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const corners = new Set(points.map((point) => `${point.x},${point.y}`));
  const rectangle =
    points.length === 4 &&
    corners.size === 4 &&
    left < right &&
    top < bottom &&
    points.every(
      (point) =>
        (point.x === left || point.x === right) &&
        (point.y === top || point.y === bottom),
    );
  return rectangle
    ? {
        shape: "rectangle",
        points: [toRnlPoint({ x: (left + right) / 2, y: (top + bottom) / 2 })],
        params: {
          width: rnlLength(right - left),
          height: rnlLength(bottom - top),
        },
      }
    : { shape: "line", points: [...points, points[0]!].map(toRnlPoint) };
}

/** A filled dot, as Analog Canvas draws junctions and arrow ends. */
export const dotShape = (center: Point, radius: number): RnlShape => ({
  shape: "circle",
  points: [toRnlPoint(center)],
  params: { radius: rnlLength(radius), fill: "linecolor" },
  style: { linestyle: "none" },
});

/**
 * An Analog Canvas symbol's artwork as RNL shapes in the symbol's own frame,
 * or null when it contains an unsupported curved/compound SVG path.
 * Strokes keep the viewer's width: a block's outline is drawn as parts are.
 */
export function symbolShapes(
  primitives: readonly SymbolPrimitive[],
): RnlShape[] | null {
  const shapes: RnlShape[] = [];
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case "line":
        shapes.push(pathShape([primitive.from, primitive.to]));
        break;
      case "polyline":
        shapes.push(pathShape(primitive.points));
        break;
      case "polygon":
        shapes.push(
          paint(
            outlineShape(primitive.points),
            primitive.fill === "foreground",
            primitive.stroke !== "none",
          ),
        );
        break;
      case "circle":
        shapes.push(
          paint(
            {
              shape: "circle",
              points: [toRnlPoint(primitive.center)],
              params: { radius: rnlLength(primitive.radius) },
            },
            primitive.fill === "foreground",
            primitive.stroke !== "none",
          ),
        );
        break;
      case "path": {
        const path = pathShapes(primitive.data);
        if (!path) return null;
        shapes.push(...path);
        break;
      }
    }
  }
  return shapes;
}
