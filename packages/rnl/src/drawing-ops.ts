import {
  arrowArtwork,
  arrowEndStyles,
  type ResolvedDraftingGeometry,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { DraftingObject } from "@icm/model";

import { toRnlPoint } from "./place.js";
import {
  dotShape,
  outlineShape,
  pathShape,
  rnlLength,
  type RnlShape,
} from "./shapes.js";

type Geometry<K extends ResolvedDraftingGeometry["kind"]> = Extract<
  ResolvedDraftingGeometry,
  { kind: K }
>;

/**
 * The look an object keeps in RNL: its line style, colour and stroke, and a
 * rectangle's or circle's fill. A stroke is written only where the object
 * scales it; otherwise the viewer's annotation stroke applies.
 */
function styled(
  shape: RnlShape,
  object: DraftingObject,
  profile: SchematicStyleProfile,
): RnlShape {
  const override = object.styleOverride;
  const lineStyle =
    "lineStyle" in object ? object.lineStyle : override?.lineStyle;
  const style: Record<string, string | number> = { ...shape.style };
  if (lineStyle && lineStyle !== "solid" && style.linestyle !== "none")
    style.linestyle = lineStyle;
  if (override?.color) style.linecolor = override.color;
  if (override?.strokeScale && override.strokeScale !== 1)
    style.linewidth = rnlLength(
      profile.strokes.annotation * override.strokeScale,
    );
  const params = { ...shape.params };
  if (override?.fillColor) {
    params.fill = "fillcolor";
    style.fillcolor = override.fillColor;
  }
  return {
    ...shape,
    ...(Object.keys(params).length ? { params } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  };
}

/**
 * A shape a drawing object draws, and its part in the object: null for its
 * own line, else what it is (`start`, `end` of an arrow; `outline`; `plus1`,
 * `plus2`, `minus` of polarity marks). The export names an object's shapes
 * by their parts, so that the import can tell the object again.
 */
export interface RnlDrawnShape {
  role: string | null;
  shape: RnlShape;
}

const own = (shape: RnlShape): RnlDrawnShape => ({ role: null, shape });

/**
 * An arrow as RNL draws it. A filled head is the shaft's `arrow=`, which
 * RNL draws at the tip in its own shape (9.2.5); an open head, which RNL has
 * no form for, is its outline drawn as Analog Canvas does, the shaft ending
 * at its base; a dot is a filled circle. An outlined arrow is its outline.
 * A head or dot is the part of its end.
 */
function arrowShapes(
  object: Extract<DraftingObject, { kind: "arrow" }>,
  geometry: Geometry<"arrow">,
  profile: SchematicStyleProfile,
): RnlDrawnShape[] {
  const artwork = arrowArtwork(
    object,
    geometry.points,
    geometry.curveControls,
    profile,
  );
  const [first] = geometry.points;
  const end = (tip: { x: number; y: number }) =>
    first &&
    Math.hypot(tip.x - first.x, tip.y - first.y) <= 1e-6 &&
    geometry.points.length > 1
      ? "start"
      : "end";
  const dots = artwork.dots.map((dot) => ({
    role: end(dot.center),
    shape: dotShape(dot.center, dot.radius),
  }));
  if (artwork.outline)
    return [{ role: "outline", shape: outlineShape(artwork.outline) }, ...dots];
  const ends = arrowEndStyles(object);
  const filled = (style: string) =>
    style !== "none" && style !== "dot" && style !== "open-arrow";
  const shaft = [...artwork.shaft];
  if (filled(ends.start.style)) shaft[0] = geometry.points[0]!;
  if (filled(ends.end.style)) shaft[shaft.length - 1] = geometry.points.at(-1)!;
  const at = (["start", "end"] as const).filter((end) =>
    filled(ends[end].style),
  );
  const scale = object.styleOverride?.strokeScale ?? 1;
  const size = Math.max(
    ...at.map(
      (end) => profile.annotations.arrowHeadLength * scale * ends[end].scale,
    ),
  );
  const line = pathShape(shaft, artwork.controls);
  return [
    own(
      at.length
        ? {
            ...line,
            params: { arrow: at.length === 2 ? "both" : at[0]! },
            style: { arrowsize: rnlLength(size) },
          }
        : line,
    ),
    ...artwork.heads.flatMap((head) => {
      const [tip] = head.points;
      return head.style === "open" && tip
        ? [
            {
              role: end(tip),
              shape: {
                shape: "line" as const,
                points: [...head.points, tip].map(toRnlPoint),
              },
            },
          ]
        : [];
    }),
    ...dots,
  ];
}

/** Each polarity mark's stroke, as its part. */
const POLARITY_ROLE: Readonly<Record<string, string>> = {
  "positive-horizontal": "plus1",
  "positive-vertical": "plus2",
  negative: "minus",
};

/**
 * The shapes a drafting object draws, in the scene, each with its part in
 * the object, or null for one that draws none of its own: a plain text
 * (written as a TEXT) or a floating symbol (a drawn usage). A callout's text
 * and a polarity text's words are written as TEXTs beside these.
 */
export function draftingShapes(
  object: DraftingObject,
  geometry: ResolvedDraftingGeometry,
  profile: SchematicStyleProfile,
): RnlDrawnShape[] | null {
  const shapes = ((): RnlDrawnShape[] | null => {
    switch (geometry.kind) {
      case "text":
        return geometry.polarityLines.length
          ? geometry.polarityLines.map((line) => ({
              role: POLARITY_ROLE[line.role] ?? null,
              shape: pathShape([line.from, line.to]),
            }))
          : null;
      case "arrow":
        return object.kind === "arrow"
          ? arrowShapes(object, geometry, profile)
          : null;
      case "leader":
        return [own(pathShape([geometry.anchor, geometry.target]))];
      case "callout":
        return [own(pathShape([geometry.textPosition, geometry.target]))];
      case "construction-line":
        return [own(pathShape(geometry.points, geometry.curveControls))];
      case "rectangle": {
        const turn = ((geometry.rotation % 180) + 180) % 180;
        if (turn !== 0 && turn !== 90)
          return [own(outlineShape(geometry.corners))];
        const [width, height] =
          turn === 0
            ? [geometry.width, geometry.height]
            : [geometry.height, geometry.width];
        return [
          own({
            shape: "rectangle",
            points: [toRnlPoint(geometry.center)],
            params: { width: rnlLength(width), height: rnlLength(height) },
          }),
        ];
      }
      case "circle":
        return [
          own({
            shape: "circle",
            points: [toRnlPoint(geometry.center)],
            params: { radius: rnlLength(geometry.radius) },
          }),
        ];
      case "floating-symbol":
        return null;
    }
  })();
  return (
    shapes &&
    shapes.map(({ role, shape }) => ({
      role,
      shape: styled(shape, object, profile),
    }))
  );
}

/**
 * The name an object's group of shapes and texts is written under, so
 * that the import can tell it again, for an object of a kind RNL has no
 * form of its own for; none for the others.
 */
export function drawingGroup(object: DraftingObject): string | null {
  if (
    object.kind === "arrow" ||
    object.kind === "leader" ||
    object.kind === "callout"
  )
    return object.kind;
  return object.kind === "text" && object.polarity ? "polarity" : null;
}

/**
 * Where a drafting object is drawn: a rectangle or circle on the background
 * plane under the circuit, everything else over it, as in Analog Canvas.
 */
export function draftingLayer(object: DraftingObject): "bottom" | "top" {
  return "layer" in object && object.layer === "background" ? "bottom" : "top";
}
