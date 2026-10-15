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
 * An arrow as RNL draws it. A filled head is the shaft's `arrow=`, which
 * RNL draws at the tip in its own shape (9.2.5); an open head, which RNL has
 * no form for, is its outline drawn as Analog Canvas does, the shaft ending
 * at its base; a dot is a filled circle. An outlined arrow is its outline.
 */
function arrowShapes(
  object: Extract<DraftingObject, { kind: "arrow" }>,
  geometry: Geometry<"arrow">,
  profile: SchematicStyleProfile,
): RnlShape[] {
  const artwork = arrowArtwork(
    object,
    geometry.points,
    geometry.curveControls,
    profile,
  );
  const dots = artwork.dots.map((dot) => dotShape(dot.center, dot.radius));
  if (artwork.outline) return [outlineShape(artwork.outline), ...dots];
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
    at.length
      ? {
          ...line,
          params: { arrow: at.length === 2 ? "both" : at[0]! },
          style: { arrowsize: rnlLength(size) },
        }
      : line,
    ...artwork.heads
      .filter((head) => head.style === "open")
      .map((head) => ({
        shape: "line" as const,
        points: [...head.points, head.points[0]!].map(toRnlPoint),
      })),
    ...dots,
  ];
}

/**
 * The shapes a drafting object draws, in the scene, or null for one that
 * draws none of its own: a plain text (written as a TEXT) or a floating
 * symbol (a drawn usage). A callout's text and a polarity text's words are
 * written as TEXTs beside these.
 */
export function draftingShapes(
  object: DraftingObject,
  geometry: ResolvedDraftingGeometry,
  profile: SchematicStyleProfile,
): RnlShape[] | null {
  const shapes = ((): RnlShape[] | null => {
    switch (geometry.kind) {
      case "text":
        return geometry.polarityLines.length
          ? geometry.polarityLines.map((line) =>
              pathShape([line.from, line.to]),
            )
          : null;
      case "arrow":
        return object.kind === "arrow"
          ? arrowShapes(object, geometry, profile)
          : null;
      case "leader":
        return [pathShape([geometry.anchor, geometry.target])];
      case "callout":
        return [pathShape([geometry.textPosition, geometry.target])];
      case "construction-line":
        return [pathShape(geometry.points, geometry.curveControls)];
      case "rectangle": {
        const turn = ((geometry.rotation % 180) + 180) % 180;
        if (turn !== 0 && turn !== 90) return [outlineShape(geometry.corners)];
        const [width, height] =
          turn === 0
            ? [geometry.width, geometry.height]
            : [geometry.height, geometry.width];
        return [
          {
            shape: "rectangle",
            points: [toRnlPoint(geometry.center)],
            params: { width: rnlLength(width), height: rnlLength(height) },
          },
        ];
      }
      case "circle":
        return [
          {
            shape: "circle",
            points: [toRnlPoint(geometry.center)],
            params: { radius: rnlLength(geometry.radius) },
          },
        ];
      case "floating-symbol":
        return null;
    }
  })();
  return shapes && shapes.map((shape) => styled(shape, object, profile));
}

/**
 * Where a drafting object is drawn: a rectangle or circle on the background
 * plane under the circuit, everything else over it, as in Analog Canvas.
 */
export function draftingLayer(object: DraftingObject): "bottom" | "top" {
  return "layer" in object && object.layer === "background" ? "bottom" : "top";
}
