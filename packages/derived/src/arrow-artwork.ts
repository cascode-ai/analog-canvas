import type { DerivedPoint as Point, DraftingObject } from "@icm/model";
import type { SchematicStyleProfile } from "./style-profile.js";

type Arrow = Extract<DraftingObject, { kind: "arrow" }>;
export interface ArrowArtwork {
  shaft: Point[];
  controls: readonly (Point | null)[];
  heads: Point[][];
  outline: Point[] | null;
  strokeWidth: number;
  headStyle: "none" | "filled" | "open";
}

/** One construction for export, preview, picker icons and hit geometry. */
export function arrowArtwork(
  object: Pick<Arrow, "styleOverride" | "outline">,
  points: readonly Point[],
  controls: readonly (Point | null)[],
  profile: SchematicStyleProfile,
): ArrowArtwork {
  const scale = object.styleOverride?.strokeScale ?? 1;
  const strokeWidth = profile.strokes.annotation * scale;
  const headStyle = object.styleOverride?.arrowHead ?? "filled";
  const at = object.styleOverride?.arrowHeadAt ?? "end";
  const from = points[0]!;
  const to = points[points.length - 1]!;
  if (object.outline) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const ux = length ? (to.x - from.x) / length : 1;
    const uy = length ? (to.y - from.y) / length : 0;
    const width = object.outline.width;
    const half = width / 2;
    const neck = width * 0.2;
    const head = Math.min(width * 0.85, length * (at === "both" ? 0.4 : 0.55));
    const startHead = at !== "end";
    const endHead = at !== "start";
    const left = startHead ? head : 0;
    const right = endHead ? length - head : length;
    const local: Point[] = [
      { x: left, y: -neck },
      { x: right, y: -neck },
      ...(endHead
        ? [
            { x: right, y: -half },
            { x: length, y: 0 },
            { x: right, y: half },
          ]
        : []),
      { x: right, y: neck },
      { x: left, y: neck },
      ...(startHead
        ? [
            { x: left, y: half },
            { x: 0, y: 0 },
            { x: left, y: -half },
          ]
        : []),
    ];
    return {
      shaft: [],
      controls: [],
      heads: [],
      strokeWidth,
      headStyle,
      outline: local.map(({ x, y }) => ({
        x: from.x + ux * x - uy * y,
        y: from.y + uy * x + ux * y,
      })),
    };
  }
  const headScale = scale * (object.styleOverride?.arrowHeadScale ?? 1);
  const headLength = profile.annotations.arrowHeadLength * headScale;
  const halfWidth = (profile.annotations.arrowHeadWidth * headScale) / 2;
  const heads: Point[][] = [];
  const shaft = points.map((point) => ({ ...point }));
  const tangent = (start: boolean): Point => {
    for (let n = 0; n < points.length - 1; n++) {
      const index = start ? n : points.length - 2 - n;
      const tip = start ? points[index]! : points[index + 1]!;
      const other =
        controls[index] ?? (start ? points[index + 1]! : points[index]!);
      const delta = { x: tip.x - other.x, y: tip.y - other.y };
      if (Math.hypot(delta.x, delta.y) > 1e-6) return delta;
    }
    return { x: start ? -1 : 1, y: 0 };
  };
  const append = (start: boolean) => {
    const index = start ? 0 : points.length - 1;
    const tip = points[index]!;
    const t = tangent(start);
    const magnitude = Math.hypot(t.x, t.y);
    const ux = t.x / magnitude,
      uy = t.y / magnitude;
    const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    heads.push([
      tip,
      { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
      { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
    ]);
    shaft[index] = base;
  };
  if (headStyle !== "none") {
    if (at !== "end") append(true);
    if (at !== "start") append(false);
  }
  return { shaft, controls, heads, outline: null, strokeWidth, headStyle };
}

export function arrowPathData(
  points: readonly Point[],
  controls: readonly (Point | null)[],
): string {
  if (!points.length) return "";
  let result = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    const control = controls[index - 1];
    result += control
      ? ` Q ${control.x} ${control.y} ${point.x} ${point.y}`
      : ` L ${point.x} ${point.y}`;
  }
  return result;
}

/** Conservative Bézier hull plus all visible head/outline vertices. */
export function arrowArtworkBounds(artwork: ArrowArtwork) {
  const points = [
    ...(artwork.outline ?? artwork.shaft),
    ...artwork.heads.flat(),
    ...artwork.controls.filter((p): p is Point => p !== null),
  ];
  const padding = artwork.strokeWidth * 2; // miter limit 4 at half stroke
  const x = Math.min(...points.map((p) => p.x)) - padding;
  const y = Math.min(...points.map((p) => p.y)) - padding;
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) + padding - x,
    height: Math.max(...points.map((p) => p.y)) + padding - y,
  };
}
