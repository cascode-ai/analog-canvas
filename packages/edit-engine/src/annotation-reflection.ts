import {
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import { snapGridPoint } from "@icm/model";
import type {
  Annotation,
  Point,
  Rect,
  Rotation,
  RotationDelta,
  SchematicDocument,
  ScreenFlip,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

export type TextAlignment = Annotation["alignment"];

/** A point's mirror image about a pivot, across one screen axis. */
export function reflectPoint(
  point: Point,
  pivot: Point,
  direction: ScreenFlip,
): Point {
  return direction === "left-right"
    ? { x: 2 * pivot.x - point.x, y: point.y }
    : { x: point.x, y: 2 * pivot.y - point.y };
}

/**
 * The alignment a line of text takes once its drawing is mirrored.
 *
 * Glyphs stay readable, so the text keeps its reading direction. When the
 * mirror reverses the axis the text reads along, a line that grew rightward
 * from its anchor has to grow leftward from the mirrored one instead.
 */
export function reflectedTextAlignment(
  alignment: TextAlignment,
  rotation: Rotation | number,
  direction: ScreenFlip,
): TextAlignment {
  if (alignment === "middle") return alignment;
  const turn = ((rotation % 360) + 360) % 360;
  const readsAcross =
    direction === "left-right" ? turn % 180 === 0 : turn % 180 === 90;
  if (!readsAcross) return alignment;
  return alignment === "start" ? "end" : "start";
}

function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function reanchoredTextPoint(
  anchor: Point,
  realignedBounds: Rect,
  targetCenter: Point,
): Point {
  const realignedCenter = rectCenter(realignedBounds);
  return snapGridPoint(
    {
      x: targetCenter.x - (realignedCenter.x - anchor.x),
      y: targetCenter.y - (realignedCenter.y - anchor.y),
    },
    1,
  );
}

/**
 * Where a text's anchor goes when its drawing is mirrored.
 *
 * The text box is what reflects, not the anchor point. An anchor sits on the
 * text's baseline, so reflecting the anchor alone would carry a label that
 * sat just above a wire across that wire in a top-to-bottom flip. The box's
 * centre goes to its mirror image, and the anchor follows from wherever the
 * realigned box puts it relative to that centre.
 *
 * `bounds` is the box as drawn now and `realignedBounds` the same text with
 * its mirrored alignment, both around the current `anchor`.
 */
export function reflectedTextAnchor(
  anchor: Point,
  bounds: Rect,
  realignedBounds: Rect,
  pivot: Point,
  direction: ScreenFlip,
): Point {
  return reanchoredTextPoint(
    anchor,
    realignedBounds,
    reflectPoint(rectCenter(bounds), pivot, direction),
  );
}

/** Screen-space clockwise turn about a pivot. */
export function rotatePointAboutPivot(
  point: Point,
  pivot: Point,
  deltaDegrees: RotationDelta,
): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  if (deltaDegrees === 90) return { x: pivot.x - dy, y: pivot.y + dx };
  if (deltaDegrees === -90) return { x: pivot.x + dy, y: pivot.y - dx };
  if (deltaDegrees === 180) return { x: pivot.x - dx, y: pivot.y - dy };
  const radians = (deltaDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: pivot.x + dx * cosine - dy * sine,
    y: pivot.y + dx * sine + dy * cosine,
  };
}

/**
 * Alignment of an upright text line rotated about a pivot. A 180° turn flips
 * start/end; a 90° turn flips start/end when crossing from a vertical side
 * onto a horizontal side so two 90° turns match one 180° turn and four 90°
 * turns restore the starting alignment.
 */
export function rotatedUprightTextAlignment(
  alignment: TextAlignment,
  oldOffset: Point,
  newOffset: Point,
  deltaDegrees: RotationDelta,
): TextAlignment {
  if (alignment === "middle") return alignment;
  const flip =
    deltaDegrees === 180 ||
    (Math.abs(deltaDegrees) === 90 &&
      Math.abs(newOffset.x) > Math.abs(newOffset.y) &&
      Math.abs(oldOffset.x) <= Math.abs(oldOffset.y));
  if (!flip) return alignment;
  return alignment === "start" ? "end" : "start";
}

/** Where a text's anchor goes when its box centre orbits a pivot. */
export function rotatedTextAnchor(
  anchor: Point,
  bounds: Rect,
  realignedBounds: Rect,
  pivot: Point,
  deltaDegrees: RotationDelta,
): Point {
  return reanchoredTextPoint(
    anchor,
    realignedBounds,
    rotatePointAboutPivot(rectCenter(bounds), pivot, deltaDegrees),
  );
}

/** A schematic annotation's rotated anchor point and alignment about a pivot. */
export function rotatedAnnotationPlacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  pivot: Point,
  deltaDegrees: RotationDelta,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): { position: Point; alignment: TextAlignment } {
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  const current = resolveAnnotationPresentation(
    document,
    resolver,
    annotation,
    styleProfile,
    routingGeometry,
  );
  const oldCenter = rectCenter(current.bounds);
  const newCenter = rotatePointAboutPivot(oldCenter, pivot, deltaDegrees);
  const alignment = rotatedUprightTextAlignment(
    annotation.alignment,
    { x: oldCenter.x - pivot.x, y: oldCenter.y - pivot.y },
    { x: newCenter.x - pivot.x, y: newCenter.y - pivot.y },
    deltaDegrees,
  );
  const realigned =
    alignment === annotation.alignment
      ? current
      : resolveAnnotationPresentation(
          document,
          resolver,
          { ...annotation, alignment },
          styleProfile,
          routingGeometry,
        );
  return {
    position: rotatedTextAnchor(
      current.position,
      current.bounds,
      realigned.bounds,
      pivot,
      deltaDegrees,
    ),
    alignment,
  };
}

/** A schematic annotation's mirrored anchor point and alignment. */
export function reflectedAnnotationPlacement(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  pivot: Point,
  direction: ScreenFlip,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): { position: Point; alignment: TextAlignment } {
  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  const current = resolveAnnotationPresentation(
    document,
    resolver,
    annotation,
    styleProfile,
    routingGeometry,
  );
  const alignment = reflectedTextAlignment(
    annotation.alignment,
    annotation.rotation,
    direction,
  );
  const realigned =
    alignment === annotation.alignment
      ? current
      : resolveAnnotationPresentation(
          document,
          resolver,
          { ...annotation, alignment },
          styleProfile,
          routingGeometry,
        );
  return {
    position: reflectedTextAnchor(
      current.position,
      current.bounds,
      realigned.bounds,
      pivot,
      direction,
    ),
    alignment,
  };
}
