/**
 * The drafting layer: text, construction lines, shapes, arrows, leaders,
 * callouts and floating symbols drawn under or over the circuit.
 */
import {
  arrowArtwork,
  arrowPathData,
  centeredFirstBaselineY,
  draftTextLayoutContent,
  objectStyleProfile,
  resolveDraftingObjectGeometry,
  richTextMetrics,
} from "@icm/derived";
import type {
  ResolvedDocumentRoutingGeometry,
  ResolvedDraftingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import { mirrorScale } from "@icm/model";
import type { DraftingObject, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { renderFormulaDocument } from "./formula.js";
import { renderFractionText } from "./fraction-text.js";
import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";
import { renderRichTextDocument } from "./rich-text.js";
import { escapeXml } from "./svg-markup.js";
import { renderSymbolDefinitionBody } from "./symbol-render.js";

// ADR 0010 WP-R2: the drafting layer renders every DraftingObject kind by
// consuming the single derived-geometry entry. An unresolved anchor still
// exports using its fallback position and
// carries a data-anchor-resolved="false" attribute for diagnostics.
export function renderDraftingLayer(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  layer: "background" | "foreground",
  objectIds?: ReadonlySet<string>,
): string {
  const objects = document.drafting?.objects ?? [];
  if (objects.length === 0) return "";
  const sorted = [...objects].sort((left, right) => left.zIndex - right.zIndex);
  const body = sorted
    .filter(
      (object) =>
        (!objectIds || objectIds.has(object.id)) &&
        ((object.kind === "rectangle" || object.kind === "circle") &&
        object.layer === "background"
          ? layer === "background"
          : layer === "foreground"),
    )
    .map((object) => {
      const objectProfile = objectStyleProfile(profile, object);
      const geometry = resolveDraftingObjectGeometry(
        document,
        resolver,
        object,
        routingGeometry,
      );
      const unresolved =
        geometry.diagnostics.length > 0 ? ' data-anchor-resolved="false"' : "";
      switch (object.kind) {
        case "text":
          return renderDraftText(
            document,
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "text" }>,
            objectProfile,
            unresolved,
          );
        case "construction-line":
          return renderConstructionLine(object, objectProfile);
        case "rectangle":
          return renderDraftRectangle(
            object,
            geometry as Extract<
              ResolvedDraftingGeometry,
              { kind: "rectangle" }
            >,
            objectProfile,
          );
        case "circle":
          return renderDraftCircle(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "circle" }>,
            objectProfile,
          );
        case "arrow":
          return renderDraftArrow(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "arrow" }>,
            objectProfile,
            unresolved,
          );
        case "leader":
          return renderDraftLeader(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "leader" }>,
            objectProfile,
            unresolved,
          );
        case "callout":
          return renderDraftCallout(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "callout" }>,
            objectProfile,
            unresolved,
          );
        case "floating-symbol":
          return renderFloatingSymbol(
            object,
            geometry as Extract<
              ResolvedDraftingGeometry,
              { kind: "floating-symbol" }
            >,
            resolver,
            objectProfile,
            unresolved,
          );
      }
    })
    .join("");
  return body
    ? `<g data-layer="drafting" data-drafting-layer="${layer}">${body}</g>`
    : "";
}

function renderDraftText(
  document: SchematicDocument,
  object: Extract<DraftingObject, { kind: "text" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "text" }>,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const { textPosition } = geometry;
  const color = object.styleOverride?.color ?? profile.foreground;
  const fontSize =
    typographyFontSize(object.typographyToken ?? "body", profile) *
    (object.styleOverride?.sizeScale ?? 1);
  // The same function the geometry measured with, on the same inputs: a label
  // inside a box arrives wrapped to that box, and the drawn lines cannot
  // disagree with the bounds that framed them.
  const content = draftTextLayoutContent(
    document,
    object,
    richTextMetrics(
      profile,
      object.typographyToken,
      object.styleOverride?.sizeScale,
      {
        bold: object.styleOverride?.weight !== "normal",
        italic: object.styleOverride?.italic === true,
      },
    ),
  );
  // Object-anchored drafting text (e.g. a rectangle's centered label) paints
  // its uniform line grid centered on the resolved anchor position. Free and
  // route-anchored text keep the first-line-baseline placement unchanged.
  const baselineY =
    object.anchor.kind === "object" || object.polarity
      ? centeredFirstBaselineY(content, textPosition.y, fontSize, profile)
      : textPosition.y;
  const weight = object.styleOverride?.weight ?? "bold";
  const italic = object.styleOverride?.italic === true ? "italic" : "normal";
  const positioned = renderPositionedOverbarScriptDocument(content, profile, {
    x: textPosition.x,
    y: baselineY,
    fontSize,
    alignment: object.alignment,
    ...(object.styleOverride?.color
      ? { color: object.styleOverride.color }
      : {}),
    defaultBold: weight === "bold",
    defaultItalic: italic === "italic",
  });
  const fractions = renderFractionText(content, profile, {
    x: textPosition.x,
    y: baselineY,
    fontSize,
    alignment: object.alignment,
    color,
    bold: weight === "bold",
    italic: italic === "italic",
  });
  const formula = renderFormulaDocument(content, profile, {
    bold: weight === "bold",
    italic: italic === "italic",
    x: textPosition.x,
    baselineY,
    fontSize,
    alignment: object.alignment,
    ...(object.styleOverride?.color
      ? { color: object.styleOverride.color }
      : {}),
  });
  if (object.polarity) {
    const strokeWidth =
      profile.strokes.annotation * (object.styleOverride?.strokeScale ?? 1);
    const markers = geometry.polarityLines
      .map(
        (line) =>
          `<line data-role="polarity-${line.role}" x1="${line.from.x}" y1="${line.from.y}" x2="${line.to.x}" y2="${line.to.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}"/>`,
      )
      .join("");
    const text =
      fractions ??
      (formula
        ? formula
        : positioned
          ? `<text x="${textPosition.x}" y="${baselineY}" text-anchor="start" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${positioned.tspans}</text>${positioned.decorations}`
          : `<text x="${textPosition.x}" y="${baselineY}" text-anchor="${object.alignment}" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${renderRichTextDocument(content, profile, { lineOriginX: textPosition.x, fontSize, defaultBold: weight === "bold", defaultItalic: italic === "italic" })}</text>`);
    return `<g data-object-id="${object.id}" data-kind="draft-text" data-polarity="${object.polarity}"${unresolved}>${markers}${text}</g>`;
  }
  // Drafting text is notation: its glyphs stay upright at every persisted or
  // route-follow rotation. Multipart polarity layout is already resolved into
  // screen coordinates by the shared derived geometry.
  if (fractions) {
    return `<g data-object-id="${object.id}" data-kind="draft-text"${unresolved}>${fractions}</g>`;
  }
  if (formula) {
    return `<g data-object-id="${object.id}" data-kind="draft-text"${unresolved}>${formula}</g>`;
  }
  if (positioned) {
    return `<g><text data-object-id="${object.id}" data-kind="draft-text"${unresolved} x="${textPosition.x}" y="${baselineY}" text-anchor="start" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${positioned.tspans}</text>${positioned.decorations}</g>`;
  }
  const markup = renderRichTextDocument(content, profile, {
    lineOriginX: textPosition.x,
    fontSize,
    defaultBold: weight === "bold",
    defaultItalic: italic === "italic",
  });
  return `<text data-object-id="${object.id}" data-kind="draft-text"${unresolved} x="${textPosition.x}" y="${baselineY}" text-anchor="${object.alignment}" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${markup}</text>`;
}

function renderConstructionLine(
  object: Extract<DraftingObject, { kind: "construction-line" }>,
  profile: SchematicStyleProfile,
): string {
  const points = object.points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const lineStyle = object.styleOverride?.lineStyle ?? object.lineStyle;
  const dash =
    lineStyle === "dashed"
      ? ' stroke-dasharray="6 4"'
      : lineStyle === "dotted"
        ? ' stroke-dasharray="2 3"'
        : "";
  const strokeScale = object.styleOverride?.strokeScale ?? 1;
  const strokeWidth = profile.strokes.annotation * strokeScale;
  const stroke = object.styleOverride?.color ?? profile.foreground;
  const hasCurve = (object.curveControls ?? []).some(Boolean);
  const shape = hasCurve
    ? `<path d="${draftingPathData(object.points, object.curveControls ?? [])}" fill="none"`
    : `<polyline points="${points}" fill="none"`;
  return `${shape} data-object-id="${object.id}" data-kind="construction-line" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>`;
}

function renderDraftRectangle(
  object: Extract<DraftingObject, { kind: "rectangle" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "rectangle" }>,
  profile: SchematicStyleProfile,
): string {
  const lineStyle = object.styleOverride?.lineStyle ?? object.lineStyle;
  const dash =
    lineStyle === "dashed"
      ? ' stroke-dasharray="6 4"'
      : lineStyle === "dotted"
        ? ' stroke-dasharray="2 3"'
        : "";
  const strokeWidth =
    profile.strokes.annotation * (object.styleOverride?.strokeScale ?? 1);
  const stroke = object.styleOverride?.color ?? profile.foreground;
  const fill = object.styleOverride?.fillColor ?? "none";
  const points = geometry.corners
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  return `<polygon data-object-id="${object.id}" data-kind="draft-rectangle" points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>`;
}

function renderDraftCircle(
  object: Extract<DraftingObject, { kind: "circle" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "circle" }>,
  profile: SchematicStyleProfile,
): string {
  const lineStyle = object.styleOverride?.lineStyle ?? object.lineStyle;
  const dash =
    lineStyle === "dashed"
      ? ' stroke-dasharray="6 4"'
      : lineStyle === "dotted"
        ? ' stroke-dasharray="2 3"'
        : "";
  const strokeWidth =
    profile.strokes.annotation * (object.styleOverride?.strokeScale ?? 1);
  const stroke = object.styleOverride?.color ?? profile.foreground;
  const fill = object.styleOverride?.fillColor ?? "none";
  return `<circle data-object-id="${object.id}" data-kind="draft-circle" cx="${geometry.center.x}" cy="${geometry.center.y}" r="${geometry.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>`;
}

function draftingPathData(
  points: Point[],
  curveControls: Array<Point | null>,
  finalPoint?: Point,
  /** Where the shaft begins when a head occupies the first point. */
  firstPoint?: Point,
): string {
  const start = firstPoint ?? points[0]!;
  let data = `M ${start.x} ${start.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const end =
      index === points.length - 2 && finalPoint
        ? finalPoint
        : points[index + 1]!;
    const control = curveControls[index];
    data += control
      ? ` Q ${control.x} ${control.y} ${end.x} ${end.y}`
      : ` L ${end.x} ${end.y}`;
  }
  return data;
}

function renderDraftArrow(
  object: Extract<DraftingObject, { kind: "arrow" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "arrow" }>,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const artwork = arrowArtwork(
    object,
    geometry.points,
    geometry.curveControls,
    profile,
  );
  const stroke = object.styleOverride?.color ?? profile.foreground;
  const lineStyle = object.styleOverride?.lineStyle ?? "solid";
  const dash =
    lineStyle === "dashed"
      ? ' stroke-dasharray="6 4"'
      : lineStyle === "dotted"
        ? ' stroke-dasharray="2 3"'
        : "";
  const serialize = (points: readonly Point[]) =>
    points.map((point) => `${point.x},${point.y}`).join(" ");
  const paint = `stroke="${stroke}" stroke-width="${artwork.strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}" stroke-miterlimit="${profile.miterLimit}"`;
  const dots = artwork.dots
    .map(
      ({ center, radius }) =>
        `<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="${stroke}"/>`,
    )
    .join("");
  if (artwork.outline) {
    return `<g data-object-id="${object.id}" data-kind="draft-arrow"${unresolved}><polygon data-arrow-family="outline" points="${serialize(artwork.outline)}" fill="none" ${paint}${dash}/>${dots}</g>`;
  }
  const shaft = geometry.curveControls.some(Boolean)
    ? `<path d="${arrowPathData(artwork.shaft, artwork.controls)}" fill="none"`
    : `<polyline points="${serialize(artwork.shaft)}" fill="none"`;
  const heads = artwork.heads
    .map(
      (head) =>
        `<polygon points="${serialize(head.points)}" ${head.style === "open" ? `fill="none" stroke="${stroke}" stroke-width="${artwork.strokeWidth}"` : `fill="${stroke}"`}/>`,
    )
    .join("");
  return `<g data-object-id="${object.id}" data-kind="draft-arrow"${unresolved}>${shaft} ${paint}${dash}/>${heads}${dots}</g>`;
}

function renderDraftLeader(
  object: Extract<DraftingObject, { kind: "leader" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "leader" }>,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const { anchor, target } = geometry;
  return `<line data-object-id="${object.id}" data-kind="draft-leader"${unresolved} x1="${anchor.x}" y1="${anchor.y}" x2="${target.x}" y2="${target.y}" stroke="${profile.foreground}" stroke-width="${profile.strokes.annotation}" stroke-linecap="${profile.lineCap}"/>`;
}

function renderDraftCallout(
  object: Extract<DraftingObject, { kind: "callout" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "callout" }>,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const { textPosition, target, rotation } = geometry;
  const leader = `<line x1="${textPosition.x}" y1="${textPosition.y}" x2="${target.x}" y2="${target.y}" stroke="${profile.foreground}" stroke-width="${profile.strokes.annotation}" stroke-linecap="${profile.lineCap}"/>`;
  const fontSize =
    typographyFontSize(object.typographyToken ?? "body", profile) *
    (object.styleOverride?.sizeScale ?? 1);
  const weight = object.styleOverride?.weight ?? "bold";
  const italic = object.styleOverride?.italic === true ? "italic" : "normal";
  const formula = renderFormulaDocument(object.content, profile, {
    bold: weight === "bold",
    italic: italic === "italic",
    x: textPosition.x,
    baselineY: textPosition.y,
    fontSize,
    alignment: object.alignment,
    ...(object.styleOverride?.color
      ? { color: object.styleOverride.color }
      : {}),
  });
  // P1: renderer consumes geometry.rotation (the single rotation truth).
  const text = formula
    ? `<g transform="rotate(${rotation} ${textPosition.x} ${textPosition.y})">${formula}</g>`
    : `<text x="${textPosition.x}" y="${textPosition.y}" text-anchor="${object.alignment}" transform="rotate(${rotation} ${textPosition.x} ${textPosition.y})" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}">${renderRichTextDocument(object.content, profile, { lineOriginX: textPosition.x, fontSize, defaultBold: weight === "bold", defaultItalic: italic === "italic" })}</text>`;
  return `<g data-object-id="${object.id}" data-kind="draft-callout"${unresolved}>${leader}${text}</g>`;
}

function renderFloatingSymbol(
  object: Extract<DraftingObject, { kind: "floating-symbol" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "floating-symbol" }>,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const resolved = resolver.resolve(object.symbolId);
  if (!resolved) return "";
  const position = geometry.position;
  const rotation = object.transform.rotation;
  const scale = mirrorScale(object.transform.mirror);
  const mirror =
    scale.x === 1 && scale.y === 1 ? "" : ` scale(${scale.x} ${scale.y})`;
  const hidden = resolved.variant?.hiddenPinNames ?? [];
  const additional = resolved.variant?.additionalPrimitives ?? [];
  const body = renderSymbolDefinitionBody(
    resolved.definition,
    hidden,
    additional,
    profile,
    undefined,
    undefined,
    object.transform,
  );
  return `<g data-object-id="${object.id}" data-kind="draft-floating-symbol"${unresolved} data-symbol-id="${escapeXml(object.symbolId)}"><g transform="translate(${position.x} ${position.y})${mirror} rotate(${rotation})">${body}</g></g>`;
}

function typographyFontSize(
  token: "caption" | "body" | "label",
  profile: SchematicStyleProfile,
): number {
  if (token === "caption") return profile.typography.captionFontSize;
  return profile.typography.annotationFontSize;
}
