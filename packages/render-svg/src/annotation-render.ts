/**
 * Annotation text: whole-annotation fractions, polarity offsets and where a
 * route marker is drawn, shared by the scene and its formal bounds.
 */
import {
  fractionGeometry,
  fractionPartBaselines,
  fractionPartScale,
  measureRichTextDocument,
  resolveRouteAttachment,
  richTextMetrics,
} from "@icm/derived";
import type {
  AnnotationPresentation,
  ResolvedDocumentRoutingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  Annotation,
  Point,
  RichTextDocument,
  RichTextRun,
  Rotation,
  SchematicDocument,
} from "@icm/model";

import { renderRichTextDocument } from "./rich-text.js";
import { schematicTextFontSize } from "./schematic-text.js";

/** One render-call projection shared by formal bounds and SVG painting. */
export interface ResolvedSvgAnnotation {
  annotation: Annotation;
  content: RichTextDocument;
  presentation: AnnotationPresentation;
}

export function renderAnnotationText(
  content: RichTextDocument,
  annotation: Annotation,
  profile: SchematicStyleProfile,
): string {
  const fontSize =
    schematicTextFontSize(annotation.kind, profile) *
    (annotation.sizeScale ?? 1);
  return renderRichTextDocument(content, profile, { fontSize });
}

/**
 * Structured rendering for a whole-annotation fraction: numerator above,
 * denominator below, and a real fraction bar between them. A <text> element
 * cannot host the bar, so the annotation wraps both part texts and the bar
 * line in one group positioned from the shared deterministic metrics.
 */
function renderStackedFractionAnnotation(
  fraction: Extract<RichTextRun, { kind: "fraction" }>,
  options: {
    attributes?: string;
    position: Point;
    alignment: "start" | "middle" | "end";
    width: number;
    fontSize: number;
    color?: string;
    profile: SchematicStyleProfile;
  },
): string {
  const { profile } = options;
  const fontSize = options.fontSize;
  const partScale = fractionPartScale(profile.typography.subscriptScale);
  const partFont = Math.round(fontSize * partScale * 100) / 100;
  const halfWidth = options.width / 2;
  const centerX =
    options.alignment === "start"
      ? options.position.x + halfWidth
      : options.alignment === "end"
        ? options.position.x - halfWidth
        : options.position.x;
  // Geometry offsets are in em of the part font; scale to the base font.
  const barY =
    options.position.y - fontSize * partScale * fractionGeometry.barRiseEm;
  const parts = fractionPartBaselines(fraction, profile.typography);
  const numeratorY =
    options.position.y - fontSize * partScale * parts.numeratorRiseEm;
  const denominatorY =
    options.position.y + fontSize * partScale * parts.denominatorDropEm;
  const partStyle = `font-style:normal;font-weight:${profile.typography.mathWeight}`;
  // `fill` paints glyphs; `color` supplies currentColor for nested RichText
  // decorations such as CSS overbars inside a fraction part.
  const textColor = options.color
    ? ` fill="${options.color}" color="${options.color}"`
    : "";
  const attributes = options.attributes ? ` ${options.attributes}` : "";
  return `<g${attributes}><text data-role="fraction-numerator" x="${centerX}" y="${numeratorY}" text-anchor="middle" font-size="${partFont}"${textColor} style="${partStyle}">${renderRichTextDocument(fraction.numerator, profile, { defaultBold: true, fontSize: partFont })}</text><line data-role="fraction-bar" x1="${centerX - halfWidth}" y1="${barY}" x2="${centerX + halfWidth}" y2="${barY}" stroke="${options.color ?? profile.foreground}" stroke-width="${profile.strokes.annotation}"/><text data-role="fraction-denominator" x="${centerX}" y="${denominatorY}" text-anchor="middle" font-size="${partFont}"${textColor} style="${partStyle}">${renderRichTextDocument(fraction.denominator, profile, { defaultBold: true, fontSize: partFont })}</text></g>`;
}

function isPositionableFractionCompanion(run: RichTextRun): boolean {
  return (
    run.kind === "text" ||
    (run.kind === "span" && run.children.every(isPositionableFractionCompanion))
  );
}

/**
 * Paint one top-level fraction and its ordinary styled companions as siblings.
 * SVG forbids the fraction's line inside a <text>, so the generic inline path
 * cannot preserve its bar. Explicit x positions keep the bar and continuation
 * on the same measured line without changing the canonical RichText AST.
 */
export function renderPositionedFractionAnnotation(
  content: RichTextDocument,
  options: {
    attributes: string;
    position: Point;
    alignment: "start" | "middle" | "end";
    fontSize: number;
    color?: string;
    profile: SchematicStyleProfile;
  },
): string | null {
  const fractionIndexes = content.runs.flatMap((run, index) =>
    run.kind === "fraction" ? [index] : [],
  );
  if (fractionIndexes.length !== 1) return null;
  const fractionIndex = fractionIndexes[0]!;
  const companions = content.runs.filter((_, index) => index !== fractionIndex);
  if (!companions.every(isPositionableFractionCompanion)) return null;

  const fraction = content.runs[fractionIndex] as Extract<
    RichTextRun,
    { kind: "fraction" }
  >;
  const prefix: RichTextDocument = {
    runs: content.runs.slice(0, fractionIndex),
  };
  const suffix: RichTextDocument = {
    runs: content.runs.slice(fractionIndex + 1),
  };
  const metrics = {
    ...richTextMetrics(options.profile),
    fontSize: options.fontSize,
    fractionText: true,
  };
  const widthOf = (document: RichTextDocument): number =>
    document.runs.length === 0
      ? 0
      : measureRichTextDocument(document, metrics).width;
  const prefixWidth = widthOf(prefix);
  const fractionWidth = widthOf({ runs: [fraction] });
  const suffixWidth = widthOf(suffix);
  const totalWidth = prefixWidth + fractionWidth + suffixWidth;
  const startX =
    options.alignment === "start"
      ? options.position.x
      : options.alignment === "end"
        ? options.position.x - totalWidth
        : options.position.x - totalWidth / 2;
  const textColor = options.color
    ? ` fill="${options.color}" color="${options.color}"`
    : "";
  const renderCompanion = (document: RichTextDocument, x: number): string =>
    document.runs.length === 0
      ? ""
      : `<text x="${x}" y="${options.position.y}" text-anchor="start" font-size="${options.fontSize}" xml:space="preserve"${textColor}>${renderRichTextDocument(document, options.profile, { lineOriginX: x, fontSize: options.fontSize })}</text>`;
  const fractionX = startX + prefixWidth;
  const fractionMarkup = renderStackedFractionAnnotation(fraction, {
    position: { x: fractionX, y: options.position.y },
    alignment: "start",
    width: fractionWidth,
    fontSize: options.fontSize,
    ...(options.color ? { color: options.color } : {}),
    profile: options.profile,
  });
  return `<g ${options.attributes}>${renderCompanion(prefix, startX)}${fractionMarkup}${renderCompanion(suffix, fractionX + fractionWidth)}</g>`;
}

export function rotateOffset(
  offset: { x: number; y: number },
  rotation: SchematicDocument["annotations"][number]["rotation"],
): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return offset;
    case 90:
      return { x: -offset.y, y: offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: offset.y, y: -offset.x };
    case 45:
    case 135:
    case 225:
    case 315: {
      const radians = (rotation * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      return {
        x: offset.x * cosine - offset.y * sine,
        y: offset.x * sine + offset.y * cosine,
      };
    }
  }
}

// Resolve a route-marker route VisualAnchor to a render position/rotation.
/** Where a route marker is drawn: its arrow or sign, and its text. */
export function drawnRouteMarkerPlacement(
  annotation: Annotation,
  presentation: AnnotationPresentation,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): { position: Point; labelPosition: Point; rotation: Rotation } | null {
  if (annotation.kind !== "route-marker") return null;
  if (annotation.anchor.kind === "route")
    return resolveRouteMarkerPlacement(routingGeometry, annotation.anchor);
  const position =
    annotation.anchor.kind === "free"
      ? annotation.anchor.position
      : presentation.anchor.position;
  return { position, labelPosition: position, rotation: 0 };
}

function resolveRouteMarkerPlacement(
  routingGeometry: ResolvedDocumentRoutingGeometry,
  anchor: Extract<
    SchematicDocument["annotations"][number]["anchor"],
    { kind: "route" }
  >,
): {
  position: Point;
  labelPosition: Point;
  rotation: Rotation;
} | null {
  const route = routingGeometry.routes.get(anchor.routeId);
  if (!route)
    return {
      position: anchor.fallbackPosition,
      labelPosition: anchor.fallbackPosition,
      rotation: 0,
    };
  const placement = resolveRouteAttachment(route, {
    routeId: anchor.routeId,
    legId: anchor.legId,
    t: anchor.t,
    normalOffset: anchor.normalOffset,
    direction: anchor.direction,
  });
  if (!placement)
    return {
      position: anchor.fallbackPosition,
      labelPosition: anchor.fallbackPosition,
      rotation: 0,
    };
  // The arrow (and its rotation center) sits on the conductor at the route
  // attachment point; the label rides on the normal offset. This mirrors the
  // legacy current-arrow rendering exactly.
  return {
    position: placement.conductorPoint,
    labelPosition:
      anchor.orientation === "horizontal"
        ? placement.conductorPoint
        : placement.labelPoint,
    rotation: anchor.orientation === "horizontal" ? 0 : placement.rotation,
  };
}
