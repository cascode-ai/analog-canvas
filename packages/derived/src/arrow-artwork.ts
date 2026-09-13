import type {
  ArrowEndStyle,
  DerivedPoint as Point,
  DraftingObject,
} from "@icm/model";
import type { SchematicStyleProfile } from "./style-profile.js";

type Arrow = Extract<DraftingObject, { kind: "arrow" }>;
export interface ArrowArtwork {
  shaft: Point[];
  controls: readonly (Point | null)[];
  heads: { points: Point[]; style: "filled" | "open" }[];
  dots: { center: Point; radius: number }[];
  outline: Point[] | null;
  strokeWidth: number;
}

/** Unset ends retain the old paired head placement and exact scale. */
export function arrowEndStyles(
  object: Pick<Arrow, "styleOverride" | "outline">,
) {
  const legacy = object.styleOverride;
  const at = legacy?.arrowHeadAt ?? "end";
  const head = object.outline ? "open" : (legacy?.arrowHead ?? "filled");
  const resolve = (start: boolean): { style: ArrowEndStyle; scale: number } => {
    const explicit = start ? legacy?.arrowStart : legacy?.arrowEnd;
    if (explicit)
      return {
        style: explicit,
        scale:
          explicit === "small-arrow"
            ? 0.75
            : explicit === "large-arrow"
              ? 1.5
              : 1,
      };
    const enabled = head !== "none" && (start ? at !== "end" : at !== "start");
    const scale = object.outline ? 1 : (legacy?.arrowHeadScale ?? 1);
    return {
      style: !enabled
        ? "none"
        : head === "open" && !object.outline
          ? "open-arrow"
          : scale === 0.75
            ? "small-arrow"
            : scale === 1.5
              ? "large-arrow"
              : "medium-arrow",
      scale,
    };
  };
  return { start: resolve(true), end: resolve(false) };
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
  const ends = arrowEndStyles(object);
  const isHead = (style: ArrowEndStyle) => style !== "none" && style !== "dot";
  const dots: ArrowArtwork["dots"] = [];
  const from = points[0]!;
  const to = points[points.length - 1]!;
  if (object.outline) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const ux = length ? (to.x - from.x) / length : 1;
    const uy = length ? (to.y - from.y) / length : 0;
    const width = object.outline.width;
    const neck = width * 0.2;
    const startHead = isHead(ends.start.style);
    const endHead = isHead(ends.end.style);
    const headLength = (scale: number) =>
      Math.min(
        width * 0.85 * scale,
        length * (startHead && endHead ? 0.4 : 0.55),
      );
    const left = startHead ? headLength(ends.start.scale) : 0;
    const right = endHead ? length - headLength(ends.end.scale) : length;
    const startHalf = (width * ends.start.scale) / 2;
    const endHalf = (width * ends.end.scale) / 2;
    if (ends.start.style === "dot")
      dots.push({ center: from, radius: width * 0.3 });
    if (ends.end.style === "dot")
      dots.push({ center: to, radius: width * 0.3 });
    const local: Point[] = [
      { x: left, y: -neck },
      { x: right, y: -neck },
      ...(endHead
        ? [
            { x: right, y: -endHalf },
            { x: length, y: 0 },
            { x: right, y: endHalf },
          ]
        : []),
      { x: right, y: neck },
      { x: left, y: neck },
      ...(startHead
        ? [
            { x: left, y: startHalf },
            { x: 0, y: 0 },
            { x: left, y: -startHalf },
          ]
        : []),
    ];
    return {
      shaft: [],
      controls: [],
      heads: [],
      dots,
      strokeWidth,
      outline: local.map(({ x, y }) => ({
        x: from.x + ux * x - uy * y,
        y: from.y + uy * x + ux * y,
      })),
    };
  }
  const heads: ArrowArtwork["heads"] = [];
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
    const end = start ? ends.start : ends.end;
    if (end.style === "none") return;
    const index = start ? 0 : points.length - 1;
    const tip = points[index]!;
    if (end.style === "dot") {
      dots.push({
        center: tip,
        radius: (profile.annotations.arrowHeadWidth * scale) / 2,
      });
      return;
    }
    const headScale = scale * end.scale;
    const headLength = profile.annotations.arrowHeadLength * headScale;
    const halfWidth = (profile.annotations.arrowHeadWidth * headScale) / 2;
    const t = tangent(start);
    const magnitude = Math.hypot(t.x, t.y);
    const ux = t.x / magnitude,
      uy = t.y / magnitude;
    const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    heads.push({
      style: end.style === "open-arrow" ? "open" : "filled",
      points: [
        tip,
        { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
        { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
      ],
    });
    shaft[index] = base;
  };
  append(true);
  append(false);
  return { shaft, controls, heads, dots, outline: null, strokeWidth };
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
    ...artwork.heads.flatMap((head) => head.points),
    ...artwork.dots.flatMap(({ center, radius }) => [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
    ]),
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
