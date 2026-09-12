import { arrowArtwork, arrowPathData } from "@icm/derived";
import {
  RectSchema,
  SchematicDocumentSchema,
  inverseTransformPoint,
  mirrorScale,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  fractionGeometry,
  fractionPartScale,
  deriveMosBulkRouteFamily,
  resolvePrimitiveStrokeWidth,
  resolveDraftingObjectGeometry,
  resolveEndpointPoint,
  resolveDocumentRoutingGeometry,
  resolveAnnotationPresentation,
  annotationOwningInstanceId,
  resolveAnnotationTextColor,
  isSchematicAnnotationVisible,
  resolveAnnotationText,
  resolveDocumentStyleProfile,
  resolveDocumentLogicalNets,
  draftTextLayoutContent,
  measureRichTextDocument,
  richTextMetrics,
  resolveRouteAttachment,
  razaviTextbookProfile,
  schematicRoundPeriodFontFaceCss,
} from "@icm/derived";
import { flattenRichText } from "@icm/model";
import type {
  EndpointJoin,
  DocumentContactEvidence,
  ResolvedDocumentLogicalNets,
  ResolvedDocumentRoutingGeometry,
  ResolvedDraftingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  DerivedRect,
  DraftingObject,
  GridRect,
  Orientation,
  Point,
  RichTextDocument,
  RichTextRun,
  Rotation,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveSignalFlowPinAt,
} from "@icm/symbols";
import type {
  AdaptiveSignalFlowBlockLayout,
  SignalFlowLayoutParameters,
  SymbolDefinition,
  SymbolPrimitive,
  SymbolResolver,
} from "@icm/symbols";

import {
  schematicTextFontSize,
  schematicTextSizeAttribute,
} from "./schematic-text.js";
import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";
import { renderRichTextDocument } from "./rich-text.js";
import { renderFormulaDocument } from "./formula.js";
import {
  renderUprightSignalFlowFormula,
  signalFlowFormulaLocalBounds,
} from "./signal-flow-formula.js";

export interface SvgRenderOptions {
  /** Read-only paint filter. Geometry and electrical facts still use the full Document. */
  objectIds?: ReadonlySet<string>;
  /** Page background only; explicit object fills are preserved. */
  background?: "document" | "transparent";
  /** Explicit render crop is a caller-owned grid rectangle. */
  bounds?: GridRect;
  margin?: number;
  title?: string;
  /** Revision-scoped routing read model supplied by a shared caller. */
  routingGeometry?: ResolvedDocumentRoutingGeometry;
  /** Contact evidence paired with `routingGeometry`; never persisted. */
  contactEvidence?: DocumentContactEvidence;
}

export interface SvgScene {
  /** Formal visual bounds may include fractional text/curve geometry. */
  viewBox: DerivedRect;
  formalBody: string;
}

function renderAnnotationText(
  document: SchematicDocument,
  annotation: SchematicDocument["annotations"][number],
  profile: SchematicStyleProfile,
  logicalNets: ResolvedDocumentLogicalNets,
): string {
  const fontSize =
    schematicTextFontSize(annotation.kind, profile) *
    (annotation.sizeScale ?? 1);
  return renderRichTextDocument(
    resolveAnnotationText(document, annotation, logicalNets),
    profile,
    { fontSize },
  );
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
  const numeratorY =
    options.position.y -
    fontSize * partScale * fractionGeometry.numeratorBaselineRiseEm;
  const denominatorY =
    options.position.y +
    fontSize * partScale * fractionGeometry.denominatorBaselineDropEm;
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
function renderPositionedFractionAnnotation(
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pointList(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function renderRouteDirectionArrow(
  centerline: ReadonlyArray<{ x: number; y: number }>,
  placement: "middle" | "end" | undefined,
  color: string,
  profile: SchematicStyleProfile,
): string {
  if (!placement || centerline.length < 2) return "";
  const segments = centerline.slice(1).flatMap((to, index) => {
    const from = centerline[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return length > 0 ? [{ from, to, dx, dy, length }] : [];
  });
  const totalLength = segments.reduce(
    (sum, segment) => sum + segment.length,
    0,
  );
  if (totalLength === 0) return "";
  const targetDistance = placement === "end" ? totalLength : totalLength / 2;
  let traversed = 0;
  let selected = segments.at(-1)!;
  for (const segment of segments) {
    // At an exact bend, use the incoming segment so the arrow head remains
    // entirely on the already-drawn conductor instead of projecting backward
    // from the outgoing segment into empty space.
    if (targetDistance <= traversed + segment.length) {
      selected = segment;
      break;
    }
    traversed += segment.length;
  }
  if (placement === "end") traversed = totalLength - selected.length;
  const distanceOnSegment = Math.min(
    selected.length,
    Math.max(0, targetDistance - traversed),
  );
  const ratio = distanceOnSegment / selected.length;
  const tip = {
    x: selected.from.x + selected.dx * ratio,
    y: selected.from.y + selected.dy * ratio,
  };
  const availableShaft = distanceOnSegment;
  const headLength = Math.min(
    profile.annotations.arrowHeadLength,
    availableShaft,
  );
  if (headLength <= 0) return "";
  const scale = headLength / profile.annotations.arrowHeadLength;
  const halfWidth = (profile.annotations.arrowHeadWidth * scale) / 2;
  const unitX = selected.dx / selected.length;
  const unitY = selected.dy / selected.length;
  const base = {
    x: tip.x - unitX * headLength,
    y: tip.y - unitY * headLength,
  };
  const normal = { x: -unitY, y: unitX };
  return `<polygon data-role="route-direction-arrow" data-arrow-position="${placement}" points="${pointList(
    [
      tip,
      {
        x: base.x + normal.x * halfWidth,
        y: base.y + normal.y * halfWidth,
      },
      {
        x: base.x - normal.x * halfWidth,
        y: base.y - normal.y * halfWidth,
      },
    ],
  )}" fill="${escapeXml(color)}" stroke="none" pointer-events="none"/>`;
}

/**
 * A No Connect declaration is electrical intent, not an editor-only hint.
 * Keep its mark in the formal scene so canvas rendering and SVG/PDF export
 * cannot disagree.  It is deliberately centred on the real endpoint rather
 * than offset along a lead: the declaration applies to that exact terminal or
 * port origin.
 */
function renderNoConnectMarkers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  objectIds?: ReadonlySet<string>,
): string {
  const halfExtent = Math.max(profile.strokes.normal * 3, 4);
  const strokeWidth = profile.strokes.normal;
  return [...document.noConnects]
    .filter((item) => !objectIds || objectIds.has(item.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((noConnect) => {
      const point = resolveEndpointPoint(
        document,
        resolver,
        noConnect.endpoint,
      );
      if (!point) return [];
      return [
        `<path data-object-id="${escapeXml(noConnect.id)}" data-role="no-connect" d="M ${point.x - halfExtent} ${point.y - halfExtent} L ${point.x + halfExtent} ${point.y + halfExtent} M ${point.x + halfExtent} ${point.y - halfExtent} L ${point.x - halfExtent} ${point.y + halfExtent}" fill="none" stroke="${profile.foreground}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}"/>`,
      ];
    })
    .join("");
}

/**
 * Route topology always terminates at the exact electrical pin origin. Draw a
 * short path from inside a terminal lead, through the exact pin, into the
 * actual route segment. SVG then owns the sharp miter at the corner, removing
 * the separate-stroke anti-alias seam without adding route geometry.
 */
function renderTerminalMiterBridges(
  joins: readonly EndpointJoin[],
  profile: SchematicStyleProfile,
  strokeColor: string,
): string {
  const overlap = Math.max(profile.strokes.wire, profile.strokes.symbol) * 0.75;
  return joins
    .filter(
      (join): join is Extract<EndpointJoin, { kind: "terminal-miter" }> =>
        join.kind === "terminal-miter",
    )
    .map(
      (join) =>
        `<path data-role="terminal-miter-bridge" data-route-id="${escapeXml(join.routeId)}" d="M ${join.at.x - join.pinOutward.x * overlap} ${join.at.y - join.pinOutward.y * overlap} L ${join.at.x} ${join.at.y} L ${join.at.x + join.routeDirection.x * overlap} ${join.at.y + join.routeDirection.y * overlap}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${profile.strokes.wire}" stroke-linecap="${profile.lineCap}" stroke-linejoin="miter"${profileMiterAttribute(profile)}/>`,
    )
    .join("");
}

/**
 * Any retained degree-two Junction is visually one dotless conductor even
 * when storage keeps two Route strokes (for example because an annotation or
 * constraint owns the Junction). Bridge the strokes through one SVG miter so
 * storage history cannot expose a butt-cap seam. A true branch has more than
 * two incident Route directions and therefore produces no recipe here.
 */
function renderJunctionMiterBridges(
  joins: readonly EndpointJoin[],
  profile: SchematicStyleProfile,
  strokeColors: ReadonlyMap<string, string>,
): string {
  const overlap = Math.max(profile.strokes.wire, profile.strokes.symbol) * 0.75;
  return joins
    .filter(
      (join): join is Extract<EndpointJoin, { kind: "junction-miter" }> =>
        join.kind === "junction-miter",
    )
    .map((join) => {
      const [first, second] = join.directions;
      const strokeColor =
        strokeColors.get(join.junctionId) ?? profile.foreground;
      return `<path data-role="junction-miter-bridge" data-junction-id="${escapeXml(join.junctionId)}" d="M ${join.at.x + first.x * overlap} ${join.at.y + first.y * overlap} L ${join.at.x} ${join.at.y} L ${join.at.x + second.x * overlap} ${join.at.y + second.y * overlap}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${profile.strokes.wire}" stroke-linecap="${profile.lineCap}" stroke-linejoin="miter"${profileMiterAttribute(profile)}/>`;
    })
    .join("");
}

function profileMiterAttribute(profile: SchematicStyleProfile): string {
  return ` stroke-miterlimit="${profile.miterLimit}"`;
}

function primitiveStyle(
  primitive: SymbolPrimitive,
  profile: SchematicStyleProfile,
): string {
  const style = primitive.style;
  if (!style) return "";
  const strokeWidth = resolvePrimitiveStrokeWidth(
    profile,
    style.strokeRole,
    style.strokeWidth,
  );
  return [
    strokeWidth === undefined ? "" : ` stroke-width="${strokeWidth}"`,
    style.lineCap === undefined ? "" : ` stroke-linecap="${style.lineCap}"`,
    style.lineJoin === undefined ? "" : ` stroke-linejoin="${style.lineJoin}"`,
    style.miterLimit === undefined
      ? ""
      : ` stroke-miterlimit="${style.miterLimit}"`,
  ].join("");
}

function renderPrimitive(
  primitive: SymbolPrimitive,
  profile: SchematicStyleProfile,
  foregroundOverride?: string,
  orientation?: Pick<Orientation, "rotation" | "mirror">,
): string {
  const fg = foregroundOverride ?? profile.foreground;
  const style = primitiveStyle(primitive, profile);
  const rendered = screenUprightPrimitive(primitive, orientation);
  const uprightPart = rendered.part?.startsWith("upright-")
    ? ` data-part="${escapeXml(rendered.part)}"`
    : "";
  switch (rendered.kind) {
    case "line":
      return `<line${uprightPart} x1="${rendered.from.x}" y1="${rendered.from.y}" x2="${rendered.to.x}" y2="${rendered.to.y}"${style}/>`;
    case "polyline":
      return `<polyline points="${pointList(rendered.points)}"${style}/>`;
    case "circle":
      return `<circle cx="${rendered.center.x}" cy="${rendered.center.y}" r="${rendered.radius}"${rendered.fill === undefined ? "" : ` fill="${rendered.fill === "foreground" ? fg : "none"}"`}${rendered.stroke === undefined ? "" : ` stroke="${rendered.stroke === "foreground" ? fg : "none"}"`}${style}/>`;
    case "path":
      return `<path d="${escapeXml(rendered.data)}"${style}/>`;
    case "polygon":
      return `<polygon points="${pointList(rendered.points)}" fill="${rendered.fill === "foreground" ? fg : "none"}"${rendered.stroke === undefined ? "" : ` stroke="${rendered.stroke === "foreground" ? fg : "none"}"`}${style}/>`;
  }
}

/**
 * Polarity marks are notation, not device geometry: they move with a source,
 * but a minus sign remains horizontal on the page. Pre-apply the inverse of
 * the instance orientation around each marked line's centre; the parent SVG
 * transform then restores the centre while cancelling rotation and mirror.
 */
function screenUprightLine<T extends { from: Point; to: Point }>(
  line: T,
  orientation: Pick<Orientation, "rotation" | "mirror">,
): T {
  const center = {
    x: (line.from.x + line.to.x) / 2,
    y: (line.from.y + line.to.y) / 2,
  };
  const canonicalCoordinate = (value: number): number => {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const inverseVector = (point: Point): Point => {
    const unrotated = inverseTransformPoint(
      { x: point.x - center.x, y: point.y - center.y },
      { x: 0, y: 0 },
      orientation,
    );
    return {
      x: canonicalCoordinate(center.x + unrotated.x),
      y: canonicalCoordinate(center.y + unrotated.y),
    };
  };
  return {
    ...line,
    from: inverseVector(line.from),
    to: inverseVector(line.to),
  };
}

function screenUprightPrimitive(
  primitive: SymbolPrimitive,
  orientation?: Pick<Orientation, "rotation" | "mirror">,
): SymbolPrimitive {
  if (
    primitive.kind !== "line" ||
    !primitive.part?.startsWith("upright-") ||
    orientation === undefined
  ) {
    return primitive;
  }
  return screenUprightLine(primitive, orientation);
}

function signalFlowFramePoints(body: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const right = body.x + body.width;
  const bottom = body.y + body.height;
  const taper = body.height / 4;
  return `${body.x},${body.y} ${right},${body.y + taper} ${right},${bottom - taper} ${body.x},${bottom}`;
}

function renderAdaptiveSignalFlowFrame(
  adaptive: AdaptiveSignalFlowBlockLayout,
  attributes: string,
): string {
  const { body, shape } = adaptive;
  return shape === "right-tapered-trapezoid"
    ? `<polygon ${attributes} points="${signalFlowFramePoints(body)}"/>`
    : `<rect ${attributes} x="${body.x}" y="${body.y}" width="${body.width}" height="${body.height}"/>`;
}

export function renderSymbolDefinitionBody(
  definition: SymbolDefinition,
  hiddenPrimitiveParts: readonly string[] = [],
  additionalPrimitives: readonly SymbolPrimitive[] = [],
  profile: SchematicStyleProfile = razaviTextbookProfile,
  foregroundOverride?: string,
  signalFlowParameters?: SignalFlowLayoutParameters,
  orientation?: Pick<Orientation, "rotation" | "mirror">,
): string {
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    definition,
    signalFlowParameters,
  );
  if (adaptive) {
    const { body, pinSpan } = adaptive;
    const center = definition.formulaPresentation!.center;
    const left = center.x - pinSpan;
    const right = center.x + pinSpan;
    const bodyLeft = body.x;
    const bodyRight = body.x + body.width;
    const frame = renderAdaptiveSignalFlowFrame(
      adaptive,
      `data-role="signal-flow-frame" data-part="body" fill="none" stroke-width="${profile.strokes.emphasis}" stroke-linecap="butt" stroke-linejoin="miter"`,
    );
    return [
      `<line data-part="input-a-lead" x1="${left}" y1="${center.y}" x2="${bodyLeft}" y2="${center.y}"/>`,
      frame,
      `<line data-part="output-y-lead" x1="${bodyRight}" y1="${center.y}" x2="${right}" y2="${center.y}"/>`,
    ].join("");
  }
  const hidden = new Set(hiddenPrimitiveParts);
  return [...definition.primitives, ...additionalPrimitives]
    .filter((primitive) => !primitive.part || !hidden.has(primitive.part))
    .map((primitive) =>
      renderPrimitive(primitive, profile, foregroundOverride, orientation),
    )
    .join("");
}

function instanceTransform(
  instance: SchematicDocument["instances"][number],
): string {
  const placement = instance.placement;
  if (!placement) {
    throw new Error(`Cannot render unplaced instance: ${instance.id}`);
  }
  const scale = mirrorScale(placement.mirror);
  const mirror =
    scale.x === 1 && scale.y === 1 ? "" : ` scale(${scale.x} ${scale.y})`;
  return `translate(${placement.position.x} ${placement.position.y})${mirror} rotate(${placement.rotation})`;
}

/**
 * The symbol artwork of the named instances as bare geometry: no colour of
 * our choosing, no pin names, no formula text.
 *
 * A caller that wants to mark a component by tracing the component's own
 * lines — rather than by drawing a box around it — paints this layer beneath
 * the scene and styles it entirely in CSS. Leaving the markup unstyled is the
 * point: the copy in the scene above keeps whatever colour the instance
 * overrides to, so marking a component never repaints it.
 */
export function renderInstanceOutlineGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  profile: SchematicStyleProfile = razaviTextbookProfile,
): string {
  const wanted = new Set(instanceIds);
  return document.instances
    .filter(
      (instance) => wanted.has(instance.id) && instance.placement !== null,
    )
    .map((instance) => {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      // Decoration must not take the canvas down: the scene is the layer
      // that decides what an unresolved symbol means.
      if (!resolved) return "";
      const primitives = renderSymbolDefinitionBody(
        resolved.definition,
        resolved.variant?.hiddenPrimitiveParts,
        resolved.variant?.additionalPrimitives,
        profile,
        undefined,
        instance.signalFlowParameters,
        instance.placement ?? undefined,
      );
      return `<g data-object-id="${escapeXml(instance.id)}"><g transform="${instanceTransform(instance)}">${primitives}</g></g>`;
    })
    .join("");
}

function transformedDirection(
  direction: "north" | "east" | "south" | "west",
  placement: NonNullable<SchematicDocument["instances"][number]["placement"]>,
): { x: number; y: number } {
  const vectors = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
  } as const;
  return transformPoint(vectors[direction], { x: 0, y: 0 }, placement);
}

function rotateOffset(
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
    default: {
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

export function renderVisiblePinNames(
  definition: SymbolDefinition,
  hiddenPinNames: readonly string[],
  instance: SchematicDocument["instances"][number],
  profile: SchematicStyleProfile,
  foregroundOverride?: string,
): string {
  const hierarchyVerticalPinNameInset = 10;
  const placement = instance.placement;
  if (!placement) return "";
  const hidden = new Set(hiddenPinNames);
  return definition.pins
    .filter(
      (pin) =>
        pin.presentation.showName === true &&
        pin.presentation.visibility === "visible" &&
        !hidden.has(pin.name),
    )
    .map((pin) => {
      const anchor = transformPoint(
        resolveSignalFlowPinAt(definition, pin, instance.signalFlowParameters),
        placement.position,
        placement,
      );
      const outward = transformedDirection(pin.direction, placement);
      const distance = (pin.presentation.leadLength ?? 0) + 4;
      const x = anchor.x - outward.x * distance;
      // A north/south label's baseline otherwise lands on, or nearly on, the
      // Cell body border. Hierarchy labels are always automatic, so keep this
      // as derived renderer geometry rather than a second persisted setting.
      const hierarchyVerticalInset =
        definition.hierarchicalBlock && outward.y !== 0
          ? hierarchyVerticalPinNameInset
          : 0;
      // SVG text y is a baseline, not an ink edge. Keep the established
      // baseline correction, then move non-hierarchical north/south labels
      // inward by a font-relative cap-height margin. This keeps both rows of
      // a quarter-turned DFF clear of the body without pretending symmetric
      // baselines have symmetric glyph bounds.
      const pinFontSize =
        schematicTextFontSize("pin-name", profile) *
        (pin.presentation.textSizeScale ?? 1);
      const verticalInkInset =
        !definition.hierarchicalBlock && outward.y !== 0
          ? pinFontSize * 0.3
          : 0;
      // An overbar extends above the glyph box reported for the label. When a
      // complemented output is on a north-facing edge, that decoration faces
      // the body border, so reserve its own cap-height clearance instead of
      // treating Q and Q-bar as having identical ink bounds.
      const outwardOverbarInset =
        pin.role === "output-complement" && outward.y < 0
          ? pinFontSize * 0.16
          : 0;
      const y =
        anchor.y -
        outward.y * (distance + verticalInkInset + outwardOverbarInset) +
        4 -
        outward.y * hierarchyVerticalInset;
      const alignment =
        outward.x < 0 ? "start" : outward.x > 0 ? "end" : "middle";
      const sizeAttribute = schematicTextSizeAttribute(
        "pin-name",
        profile,
        pin.presentation.textSizeScale,
      );
      const displayName = pin.presentation.displayName ?? pin.name;
      const mathSymbolRuns: RichTextRun[] = [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: displayName }],
            },
          ],
        },
      ];
      const content: RichTextDocument = definition.hierarchicalBlock
        ? semanticTextDocument(displayName, "formal-port")
        : pin.presentation.textStyle === "math-symbol"
          ? {
              runs:
                pin.role === "output-complement"
                  ? [
                      {
                        kind: "span",
                        style: "overbar",
                        children: mathSymbolRuns,
                      },
                    ]
                  : mathSymbolRuns,
            }
          : { runs: [{ kind: "text" as const, value: displayName }] };
      const colorStyle = foregroundOverride
        ? ` style="fill:${escapeXml(foregroundOverride)}"`
        : "";
      return `<text data-pin-name="${escapeXml(pin.name)}" x="${x}" y="${y}" text-anchor="${alignment}"${sizeAttribute}${colorStyle}>${renderRichTextDocument(content, profile, { fontSize: schematicTextFontSize("pin-name", profile) })}</text>`;
    })
    .join("");
}

function symbolBounds(
  definition: SymbolDefinition,
  instance: SchematicDocument["instances"][number],
): DerivedRect {
  const placement = instance.placement;
  if (!placement) {
    throw new Error(
      `Cannot derive bounds for unplaced instance: ${instance.id}`,
    );
  }
  const viewBox = definition.viewBox;
  const adaptiveBounds = resolveAdaptiveSignalFlowBlockLayout(
    definition,
    instance.signalFlowParameters,
  )?.bounds;
  const localBounds = adaptiveBounds ?? viewBox;
  const left = Math.min(viewBox.x, localBounds.x);
  const top = Math.min(viewBox.y, localBounds.y);
  const right = Math.max(
    viewBox.x + viewBox.width,
    localBounds.x + localBounds.width,
  );
  const bottom = Math.max(
    viewBox.y + viewBox.height,
    localBounds.y + localBounds.height,
  );
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ].map((point) => transformPoint(point, placement.position, placement));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const transformedBounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  const formulaBounds = signalFlowFormulaLocalBounds(
    definition.formulaPresentation,
    instance.signalFlowParameters,
  );
  const presentation = definition.formulaPresentation;
  if (!formulaBounds || !presentation) return transformedBounds;
  const worldCenter = transformPoint(
    presentation.center,
    placement.position,
    placement,
  );
  const formulaWorldBounds = {
    x: formulaBounds.x + worldCenter.x - presentation.center.x,
    y: formulaBounds.y + worldCenter.y - presentation.center.y,
    width: formulaBounds.width,
    height: formulaBounds.height,
  };
  const unionLeft = Math.min(transformedBounds.x, formulaWorldBounds.x);
  const unionTop = Math.min(transformedBounds.y, formulaWorldBounds.y);
  const unionRight = Math.max(
    transformedBounds.x + transformedBounds.width,
    formulaWorldBounds.x + formulaWorldBounds.width,
  );
  const unionBottom = Math.max(
    transformedBounds.y + transformedBounds.height,
    formulaWorldBounds.y + formulaWorldBounds.height,
  );
  return {
    x: unionLeft,
    y: unionTop,
    width: unionRight - unionLeft,
    height: unionBottom - unionTop,
  };
}

function deriveBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  margin: number,
  profile: SchematicStyleProfile,
  logicalNets: ResolvedDocumentLogicalNets,
  objectIds?: ReadonlySet<string>,
): DerivedRect {
  const bounds: DerivedRect[] = [];
  const estimatedTextBounds = (
    text: string,
    x: number,
    y: number,
    alignment: "start" | "middle" | "end",
    sizeScale: number,
  ): DerivedRect => {
    const width = Math.max(7 * sizeScale, text.length * 7 * sizeScale);
    const left =
      alignment === "start"
        ? x
        : alignment === "end"
          ? x - width
          : x - width / 2;
    return {
      x: Math.floor(left),
      y: y - 13 * sizeScale,
      width: Math.ceil(width),
      height: Math.ceil(17 * sizeScale),
    };
  };
  for (const instance of document.instances.filter(
    (candidate) =>
      candidate.placement !== null &&
      (!objectIds || objectIds.has(candidate.id)),
  )) {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) {
      throw new Error(`Unresolved symbol: ${instance.symbolId}`);
    }
    const instanceBox = symbolBounds(resolved.definition, instance);
    bounds.push(instanceBox);
  }
  for (const route of document.routes) {
    if (objectIds && !objectIds.has(route.id)) continue;
    const geometry = routingGeometry.routes.get(route.id);
    if (!geometry) {
      throw new Error(`Cannot derive bounds for unresolved route: ${route.id}`);
    }
    for (const point of geometry.centerline) {
      bounds.push({ x: point.x, y: point.y, width: 0, height: 0 });
    }
  }
  for (const junction of document.junctions) {
    if (objectIds && !objectIds.has(junction.id)) continue;
    bounds.push({
      x: junction.position.x,
      y: junction.position.y,
      width: 0,
      height: 0,
    });
  }
  for (const annotation of document.annotations) {
    if (objectIds && !objectIds.has(annotation.id)) continue;
    if (!isSchematicAnnotationVisible(document, annotation, logicalNets))
      continue;
    const presentation = resolveAnnotationPresentation(
      document,
      resolver,
      annotation,
      profile,
      routingGeometry,
      logicalNets,
    );
    const routePlacement =
      annotation.anchor.kind === "route"
        ? resolveRouteMarkerPlacement(routingGeometry, annotation.anchor)
        : null;
    if (objectIds) bounds.push(presentation.bounds);
    if (!routePlacement) {
      bounds.push(presentation.bounds);
      continue;
    }
    const textPosition = routePlacement.labelPosition;
    bounds.push(
      estimatedTextBounds(
        flattenRichText(
          resolveAnnotationText(document, annotation, logicalNets),
        ),
        textPosition.x,
        textPosition.y,
        "middle",
        annotation.sizeScale ?? 1,
      ),
    );
  }
  // ADR 0010 WP-R2: drafting objects extend the formal export bounds so
  // callouts and floating symbols outside the circuit are not clipped.
  // Resolved geometry is derived.
  for (const object of document.drafting?.objects ?? []) {
    if (objectIds && !objectIds.has(object.id)) continue;
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    bounds.push(geometry.bounds);
  }
  if (bounds.length === 0) {
    if (objectIds) throw new Error("Select visible objects before copying");
    return { x: 0, y: 0, width: 960, height: 640 };
  }
  const minX = Math.min(...bounds.map((bound) => bound.x)) - margin;
  const minY = Math.min(...bounds.map((bound) => bound.y)) - margin;
  const maxX =
    Math.max(...bounds.map((bound) => bound.x + bound.width)) + margin;
  const maxY =
    Math.max(...bounds.map((bound) => bound.y + bound.height)) + margin;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function buildSvgScene(
  input: SchematicDocument,
  resolver: SymbolResolver,
  options: SvgRenderOptions = {},
): SvgScene {
  const document = SchematicDocumentSchema.parse(input);
  const objectIds = options.objectIds;
  const included = (id: string): boolean => !objectIds || objectIds.has(id);
  const profile = resolveDocumentStyleProfile(document.presentation);
  const margin = options.margin ?? 40;
  if (!Number.isInteger(margin) || margin < 0) {
    throw new Error("SVG margin must be a non-negative integer");
  }
  const routingGeometry =
    options.routingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  if (
    routingGeometry.documentId !== document.id ||
    routingGeometry.documentRevision !== document.revision
  ) {
    throw new Error("SVG renderer received stale routing geometry");
  }
  const instancesById = new Map(
    document.instances.map((instance) => [instance.id, instance] as const),
  );
  const logicalNets = resolveDocumentLogicalNets(document);
  const powerRailNetIds = new Set(
    document.routes.flatMap((route) => {
      if (route.presentation !== "power-rail") return [];
      return logicalNets.byBaseNetId.get(route.netId)?.powerDomain === "vdd"
        ? [route.netId]
        : [];
    }),
  );
  const powerRailRouteIds = new Set(
    document.routes
      .filter(
        (route) =>
          route.presentation === "power-rail" &&
          powerRailNetIds.has(route.netId),
      )
      .map((route) => route.id),
  );
  const viewBox = options.bounds
    ? RectSchema.parse(options.bounds)
    : deriveBounds(
        document,
        resolver,
        routingGeometry,
        margin,
        profile,
        logicalNets,
        objectIds,
      );

  const joinedJunctionIds = new Set(
    routingGeometry.endpointJoins.flatMap((join) =>
      join.kind === "junction-miter" ? [join.junctionId] : [],
    ),
  );
  const bulkRouteIds = new Set<string>();
  const bulkRouteColors = new Map<string, string>();
  for (const route of document.routes) {
    if (bulkRouteIds.has(route.id)) continue;
    const family = deriveMosBulkRouteFamily(document, route);
    if (!family) continue;
    const ownerColors = new Set(
      family.instanceIds.map(
        (instanceId) =>
          document.instances.find((instance) => instance.id === instanceId)
            ?.styleOverride?.foreground ?? profile.foreground,
      ),
    );
    const color =
      ownerColors.size === 1 ? [...ownerColors][0]! : profile.foreground;
    for (const routeId of family.routeIds) {
      bulkRouteIds.add(routeId);
      bulkRouteColors.set(routeId, color);
    }
  }
  const routeStrokeColor = (
    route: SchematicDocument["routes"][number],
  ): string =>
    bulkRouteColors.get(route.id) ??
    route.styleOverride?.color ??
    profile.foreground;
  const junctionColorSets = new Map<string, Set<string>>();
  for (const route of document.routes) {
    const color = routeStrokeColor(route);
    const end = route.legs.at(-1)?.to;
    const endpointJunctionIds = [
      ...(route.start.kind === "junction" ? [route.start.junctionId] : []),
      ...(end?.kind === "endpoint" && end.endpoint.kind === "junction"
        ? [end.endpoint.junctionId]
        : []),
    ];
    for (const junctionId of endpointJunctionIds) {
      if (!joinedJunctionIds.has(junctionId)) continue;
      const colors = junctionColorSets.get(junctionId) ?? new Set<string>();
      colors.add(color);
      junctionColorSets.set(junctionId, colors);
    }
  }
  const junctionBridgeColors = new Map<string, string>();
  for (const [junctionId, colors] of junctionColorSets) {
    if (colors.size === 1)
      junctionBridgeColors.set(junctionId, [...colors][0]!);
  }

  const routes = [...document.routes]
    .filter((route) => included(route.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      if (!geometry) {
        throw new Error(`Cannot render unresolved route: ${route.id}`);
      }
      const strokeColor = routeStrokeColor(route);
      const terminalBridges = renderTerminalMiterBridges(
        geometry.endpointJoins,
        profile,
        strokeColor,
      );
      const presentation = bulkRouteIds.has(route.id)
        ? "bulk-dashed"
        : route.presentation === "bulk-dashed"
          ? "wire"
          : (route.presentation ?? "wire");
      const isPowerRail =
        presentation === "power-rail" && powerRailNetIds.has(route.netId);
      const dash =
        presentation === "bulk-dashed" ? ' stroke-dasharray="3 3"' : "";
      const presentationAttribute =
        presentation !== "wire"
          ? ` data-route-presentation="${presentation}"`
          : "";
      const strokeWidth = isPowerRail
        ? profile.strokes.powerRail
        : profile.strokes.wire;
      const directionArrow = renderRouteDirectionArrow(
        geometry.centerline,
        route.styleOverride?.arrow,
        strokeColor,
        profile,
      );
      return `<polyline data-object-id="${escapeXml(route.id)}" data-net-id="${escapeXml(route.netId)}"${presentationAttribute} points="${pointList(geometry.centerline)}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}${profileMiterAttribute(profile)}/>${directionArrow}${terminalBridges}`;
    })
    .join("");
  const junctionBridges = renderJunctionMiterBridges(
    routingGeometry.endpointJoins.filter((join) => {
      if (!objectIds || join.kind !== "junction-miter") return true;
      return document.routes
        .filter((route) => {
          const end = route.legs.at(-1)?.to;
          return (
            (route.start.kind === "junction" &&
              route.start.junctionId === join.junctionId) ||
            (end?.kind === "endpoint" &&
              end.endpoint.kind === "junction" &&
              end.endpoint.junctionId === join.junctionId)
          );
        })
        .every((route) => included(route.id));
    }),
    profile,
    junctionBridgeColors,
  );
  const contactEvidence =
    options.contactEvidence ??
    deriveDocumentContactEvidence(document, resolver, routingGeometry);
  const junctions = contactEvidence.contacts
    .filter(
      (contact) =>
        !objectIds ||
        contact.incidents.some((incident) => included(incident.objectId)) ||
        contact.endpoints.some((endpoint) =>
          endpoint.kind === "junction"
            ? included(endpoint.junctionId)
            : included(endpoint.instanceId),
        ),
    )
    .filter((contact) => {
      if (
        contact.incidents.some(
          (incident) =>
            incident.kind === "route" &&
            powerRailRouteIds.has(incident.objectId),
        )
      ) {
        return false;
      }
      // All terminal kinds consume the shared visible-branch decision.
      return contactRequiresJunctionDot(contact);
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((contact) => {
      const junctionEndpoint = contact.endpoints.find(
        (endpoint): endpoint is Extract<RouteEndpoint, { kind: "junction" }> =>
          endpoint.kind === "junction",
      );
      const objectId = junctionEndpoint?.junctionId ?? contact.id;
      const derivedAttribute = junctionEndpoint
        ? ""
        : ' data-node-kind="contact"';
      return `<circle data-object-id="${escapeXml(objectId)}"${derivedAttribute} cx="${contact.point.x}" cy="${contact.point.y}" r="${profile.nodes.junctionRadius}" fill="${profile.foreground}"/>`;
    })
    .join("");
  const noConnectMarkers = renderNoConnectMarkers(
    document,
    resolver,
    profile,
    objectIds,
  );
  const noConnectLayer = noConnectMarkers
    ? `<g data-layer="no-connects">${noConnectMarkers}</g>`
    : "";
  const symbols = [...document.instances]
    .filter((instance) => included(instance.id))
    .filter((instance) => instance.placement !== null)
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((instance) => {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) {
        throw new Error(`Unresolved symbol: ${instance.symbolId}`);
      }
      const styleOverride = instance.styleOverride;
      const foregroundOverride = styleOverride?.foreground;
      const primitives = renderSymbolDefinitionBody(
        resolved.definition,
        resolved.variant?.hiddenPrimitiveParts,
        resolved.variant?.additionalPrimitives,
        profile,
        foregroundOverride,
        instance.signalFlowParameters,
        instance.placement ?? undefined,
      );
      const pinNames = renderVisiblePinNames(
        resolved.definition,
        resolved.variant?.hiddenPinNames ?? [],
        instance,
        profile,
        foregroundOverride,
      );
      const formula = renderUprightSignalFlowFormula(
        resolved.definition.formulaPresentation,
        instance.signalFlowParameters,
        instance.placement!,
        { foreground: foregroundOverride ?? profile.foreground, profile },
      );
      const strokeColor = foregroundOverride ?? profile.foreground;
      // Background fill: drawn inside the instance transform using the
      // symbol's local viewBox so it moves with the instance and stays
      // aligned with the artwork in all orientations and mirrors. When no
      // override is set, no rect is emitted (identical markup to pre-override
      // rendering).
      const viewBox = resolved.definition.viewBox;
      const adaptiveLayout = resolveAdaptiveSignalFlowBlockLayout(
        resolved.definition,
        instance.signalFlowParameters,
      );
      const background = adaptiveLayout?.body ?? viewBox;
      const backgroundRect =
        styleOverride?.background === undefined
          ? ""
          : adaptiveLayout
            ? renderAdaptiveSignalFlowFrame(
                adaptiveLayout,
                `data-role="instance-background" fill="${styleOverride.background}" stroke="none"`,
              )
            : `<rect data-role="instance-background" x="${background.x}" y="${background.y}" width="${background.width}" height="${background.height}" fill="${styleOverride.background}"/>`;
      const symbolRole =
        styleOverride === undefined ? "" : ' data-role="instance-symbol"';
      return `<g data-object-id="${escapeXml(instance.id)}" data-symbol-id="${escapeXml(resolved.definition.id)}"><g transform="${instanceTransform(instance)}">${backgroundRect}<g${symbolRole} fill="none" stroke="${strokeColor}" stroke-width="${profile.strokes.symbol}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${profileMiterAttribute(profile)}>${primitives}</g></g>${formula}${pinNames}</g>`;
    })
    .join("");
  const annotations = [...document.annotations]
    .filter((annotation) => included(annotation.id))
    .filter((annotation) =>
      isSchematicAnnotationVisible(document, annotation, logicalNets),
    )
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((annotation) => {
      const content = resolveAnnotationText(document, annotation, logicalNets);
      const attachment = ` data-anchor-kind="${annotation.anchor.kind}"`;
      const presentation = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        profile,
        routingGeometry,
        logicalNets,
      );
      const resolvedAnchor = presentation.anchor;
      const routeMarkerPlacement =
        annotation.kind === "route-marker"
          ? annotation.anchor.kind === "free"
            ? {
                position: annotation.anchor.position,
                labelPosition: annotation.anchor.position,
                rotation: 0 as const,
              }
            : annotation.anchor.kind === "object"
              ? {
                  position: resolvedAnchor.position,
                  labelPosition: resolvedAnchor.position,
                  rotation: 0 as const,
                }
              : resolveRouteMarkerPlacement(routingGeometry, annotation.anchor)
          : null;
      const position = routeMarkerPlacement?.position ?? presentation.position;
      const rotation = routeMarkerPlacement?.rotation ?? presentation.rotation;
      const transform = `rotate(${rotation} ${position.x} ${position.y})`;
      const attributes = `data-object-id="${escapeXml(annotation.id)}" data-kind="${annotation.kind}"${attachment}`;
      const annotationFontSize =
        schematicTextFontSize(annotation.kind, profile) *
        (annotation.sizeScale ?? 1);
      const ownerInstanceId = annotationOwningInstanceId(annotation);
      const resolvedColor = resolveAnnotationTextColor(
        annotation,
        ownerInstanceId ? instancesById.get(ownerInstanceId) : undefined,
        profile.foreground,
      );
      const colorOverride =
        resolvedColor === profile.foreground ? undefined : resolvedColor;
      const globalLabel =
        annotation.kind === "net-label" &&
        document.connectivityEvidence.some(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.scope === "global" &&
            evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id,
        );
      const globalBadge = globalLabel
        ? `<g data-role="global-net-badge" transform="${transform}"><rect x="${position.x - 8}" y="${position.y - annotationFontSize - 2}" width="7" height="7" rx="2" fill="${profile.background}" stroke="${profile.foreground}" stroke-width="0.8"/><text x="${position.x - 4.5}" y="${position.y - annotationFontSize + 3.3}" text-anchor="middle" font-size="5px" font-weight="700">G</text></g>`
        : "";
      if (
        annotation.kind === "route-marker" &&
        annotation.markerKind === "current"
      ) {
        const x = position.x;
        const y = position.y;
        const vertical = rotation === 90 || rotation === 270;
        const label = routeMarkerPlacement?.labelPosition;
        const textAnchor = routeMarkerPlacement
          ? "middle"
          : vertical
            ? "start"
            : annotation.alignment;
        const arrow = profile.annotations;
        // A route-marker is mounted on an existing route, so that route is
        // the arrow shaft. Draw only the triangular head; a separate fixed
        // shaft leaves visible stubs on short or vertical wires.
        const tipX = x + arrow.arrowHeadLength / 2;
        const baseX = x - arrow.arrowHeadLength / 2;
        const halfHeadWidth = arrow.arrowHeadWidth / 2;
        const markerTextX = label
          ? label.x
          : vertical
            ? x + arrow.arrowHeadLength / 2 + arrow.currentLabelGap
            : x;
        const markerTextY = label
          ? label.y
          : vertical
            ? y + 4
            : y - arrow.currentLabelGap;
        const formula = renderFormulaDocument(content, profile, {
          x: markerTextX,
          baselineY: markerTextY,
          fontSize: annotationFontSize,
          alignment: textAnchor,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? formula
          : `<text x="${markerTextX}" y="${markerTextY}" text-anchor="${textAnchor}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile, logicalNets)}</text>`;
        return `<g ${attributes}><g transform="${transform}"><polygon data-role="current-arrow-head" points="${tipX},${y} ${baseX},${y - halfHeadWidth} ${baseX},${y + halfHeadWidth}" fill="${profile.foreground}"/></g>${text}</g>`;
      }
      if (annotation.kind === "power-label") {
        // The power-rail Route is the complete supply bar. Drawing a second,
        // thinner annotation-owned bar at its endpoint creates the visible
        // terminal stub and makes hit geometry disagree with presentation.
        const formula = renderFormulaDocument(content, profile, {
          x: position.x,
          baselineY: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? `<g transform="${transform}">${formula}</g>`
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("power-label", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile, logicalNets)}</text>`;
        return `<g ${attributes}>${text}</g>`;
      }
      if (
        annotation.kind === "route-marker" &&
        annotation.markerKind === "voltage"
      ) {
        const polarity = profile.annotations;
        const positiveOffset = rotateOffset(
          { x: -polarity.polarityOffsetX, y: -polarity.polarityHalfGap },
          rotation,
        );
        const negativeOffset = rotateOffset(
          { x: -polarity.polarityOffsetX, y: polarity.polarityHalfGap },
          rotation,
        );
        const polarityStyle = `font-style:normal;font-weight:${profile.typography.plainWeight}`;
        const formula = renderFormulaDocument(content, profile, {
          x: position.x,
          baselineY: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        });
        const text = formula
          ? formula
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile, logicalNets)}</text>`;
        return `<g ${attributes}><text data-role="polarity-positive" x="${position.x + positiveOffset.x}" y="${position.y + positiveOffset.y + 4}" text-anchor="middle" font-size="${profile.typography.polarityFontSize}" style="${polarityStyle}">+</text><text data-role="polarity-negative" x="${position.x + negativeOffset.x}" y="${position.y + negativeOffset.y + 4}" text-anchor="middle" font-size="${profile.typography.polarityFontSize}" style="${polarityStyle}">−</text>${text}</g>`;
      }
      const emphasis = "";
      const positionedFraction =
        annotation.rotation === 0
          ? renderPositionedFractionAnnotation(content, {
              attributes,
              position,
              alignment: annotation.alignment,
              fontSize: annotationFontSize,
              ...(colorOverride ? { color: colorOverride } : {}),
              profile,
            })
          : null;
      if (positionedFraction) {
        return `<g>${positionedFraction}${globalBadge}</g>`;
      }
      const formula = renderFormulaDocument(content, profile, {
        x: position.x,
        baselineY: position.y,
        fontSize: annotationFontSize,
        alignment: annotation.alignment,
        ...(colorOverride ? { color: colorOverride } : {}),
      });
      if (formula) {
        return `<g ${attributes} transform="${transform}">${formula}</g>${globalBadge}`;
      }
      const positioned = renderPositionedOverbarScriptDocument(
        content,
        profile,
        {
          x: position.x,
          y: position.y,
          fontSize: annotationFontSize,
          alignment: annotation.alignment,
          ...(colorOverride ? { color: colorOverride } : {}),
        },
      );
      if (positioned) {
        return `<g transform="${transform}"><text ${attributes} x="${position.x}" y="${position.y}" text-anchor="start"${emphasis}${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, profile, annotation.sizeScale)}>${positioned.tspans}</text>${positioned.decorations}</g>${globalBadge}`;
      }
      return `<text ${attributes} x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${emphasis}${colorOverride ? ` fill="${colorOverride}" color="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile, logicalNets)}</text>${globalBadge}`;
    })
    .join("");

  return {
    viewBox,
    formalBody: `<g data-layer="formal">${renderDraftingLayer(document, resolver, profile, "background", objectIds)}<g data-layer="routes">${routes}${junctionBridges}</g><g data-layer="junctions">${junctions}</g><g data-layer="symbols">${symbols}</g>${noConnectLayer}<g data-layer="annotations">${annotations}</g>${renderDraftingLayer(document, resolver, profile, "foreground", objectIds)}</g>`,
  };
}

// Resolve a route-marker route VisualAnchor to a render position/rotation.
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

// ADR 0010 WP-R2: the drafting layer renders every DraftingObject kind by
// consuming the single derived-geometry entry. An unresolved anchor still
// exports using its fallback position and
// carries a data-anchor-resolved="false" attribute for diagnostics.
function renderDraftingLayer(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
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
      const geometry = resolveDraftingObjectGeometry(
        document,
        resolver,
        object,
      );
      const unresolved =
        geometry.diagnostics.length > 0 ? ' data-anchor-resolved="false"' : "";
      switch (object.kind) {
        case "text":
          return renderDraftText(
            document,
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "text" }>,
            profile,
            unresolved,
          );
        case "construction-line":
          return renderConstructionLine(object, profile);
        case "rectangle":
          return renderDraftRectangle(
            object,
            geometry as Extract<
              ResolvedDraftingGeometry,
              { kind: "rectangle" }
            >,
            profile,
          );
        case "circle":
          return renderDraftCircle(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "circle" }>,
            profile,
          );
        case "arrow":
          return renderDraftArrow(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "arrow" }>,
            profile,
            unresolved,
          );
        case "leader":
          return renderDraftLeader(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "leader" }>,
            profile,
            unresolved,
          );
        case "callout":
          return renderDraftCallout(
            object,
            geometry as Extract<ResolvedDraftingGeometry, { kind: "callout" }>,
            profile,
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
            profile,
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
  const { position, textPosition, rotation } = geometry;
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
    ),
  );
  // Object-anchored drafting text (e.g. a rectangle's centered label) paints
  // its uniform line grid centered on the resolved anchor position. Free and
  // route-anchored text keep the first-line-baseline placement unchanged.
  const baselineY =
    object.anchor.kind === "object" || object.polarity
      ? centeredFirstBaselineY(content, textPosition.y, fontSize, profile)
      : textPosition.y;
  const weight = object.styleOverride?.weight === "bold" ? "bold" : "normal";
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
  const formula = renderFormulaDocument(content, profile, {
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
      .map((line) => {
        const rendered =
          line.role === "negative"
            ? screenUprightLine(line, { rotation, mirror: "none" })
            : line;
        return `<line data-role="polarity-${line.role}" x1="${rendered.from.x}" y1="${rendered.from.y}" x2="${rendered.to.x}" y2="${rendered.to.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}"/>`;
      })
      .join("");
    const text = formula
      ? formula
      : positioned
        ? `<text x="${textPosition.x}" y="${baselineY}" text-anchor="start" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${positioned.tspans}</text>${positioned.decorations}`
        : `<text x="${textPosition.x}" y="${baselineY}" text-anchor="${object.alignment}" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${renderRichTextDocument(content, profile, { lineOriginX: textPosition.x, fontSize })}</text>`;
    return `<g data-object-id="${object.id}" data-kind="draft-text" data-polarity="${object.polarity}"${unresolved} transform="rotate(${rotation} ${position.x} ${position.y})">${markers}${text}</g>`;
  }
  // P1: the renderer consumes geometry.rotation (the single rotation truth),
  // not the raw persisted object rotation. The rotation pivot stays on the
  // resolved anchor so centered labels rotate about their center.
  if (formula) {
    return `<g data-object-id="${object.id}" data-kind="draft-text"${unresolved} transform="rotate(${rotation} ${position.x} ${position.y})">${formula}</g>`;
  }
  if (positioned) {
    return `<g transform="rotate(${rotation} ${position.x} ${position.y})"><text data-object-id="${object.id}" data-kind="draft-text"${unresolved} x="${textPosition.x}" y="${baselineY}" text-anchor="start" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${positioned.tspans}</text>${positioned.decorations}</g>`;
  }
  const markup = renderRichTextDocument(content, profile, {
    lineOriginX: textPosition.x,
    fontSize,
  });
  return `<text data-object-id="${object.id}" data-kind="draft-text"${unresolved} x="${textPosition.x}" y="${baselineY}" text-anchor="${object.alignment}" transform="rotate(${rotation} ${position.x} ${position.y})" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}" fill="${color}">${markup}</text>`;
}

/** Glyph cap height is ~0.7 em; dropping the baseline by 0.35 em sits the
 * capitals optically centered on a line's vertical center. */
const CENTERED_CAP_BASELINE_RATIO = 0.35;

/**
 * First-line baseline that centers the painted line grid on `centerY`. Line
 * breaks step a constant `lineHeight` em (see renderRuns), so the painted
 * grid spans (lineCount - 1) steps regardless of inline fraction extents.
 */
function centeredFirstBaselineY(
  content: RichTextDocument,
  centerY: number,
  fontSize: number,
  profile: SchematicStyleProfile,
): number {
  const lineCount =
    content.runs.filter((run) => run.kind === "line-break").length + 1;
  const lineStep = fontSize * profile.typography.lineHeight;
  return (
    centerY -
    ((lineCount - 1) / 2) * lineStep +
    CENTERED_CAP_BASELINE_RATIO * fontSize
  );
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
  if (artwork.outline) {
    return `<g data-object-id="${object.id}" data-kind="draft-arrow"${unresolved}><polygon data-arrow-family="outline" points="${serialize(artwork.outline)}" fill="none" ${paint}${dash}/></g>`;
  }
  const shaft = geometry.curveControls.some(Boolean)
    ? `<path d="${arrowPathData(artwork.shaft, artwork.controls)}" fill="none"`
    : `<polyline points="${serialize(artwork.shaft)}" fill="none"`;
  const heads = artwork.heads
    .map(
      (head) =>
        `<polygon points="${serialize(head)}" ${artwork.headStyle === "open" ? `fill="none" stroke="${stroke}" stroke-width="${artwork.strokeWidth}"` : `fill="${stroke}"`}/>`,
    )
    .join("");
  return `<g data-object-id="${object.id}" data-kind="draft-arrow"${unresolved}>${shaft} ${paint}${dash}/>${heads}</g>`;
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
  const weight = object.styleOverride?.weight === "bold" ? "bold" : "normal";
  const italic = object.styleOverride?.italic === true ? "italic" : "normal";
  const formula = renderFormulaDocument(object.content, profile, {
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
    : `<text x="${textPosition.x}" y="${textPosition.y}" text-anchor="${object.alignment}" transform="rotate(${rotation} ${textPosition.x} ${textPosition.y})" font-size="${fontSize}" font-weight="${weight}" font-style="${italic}">${renderRichTextDocument(object.content, profile, { lineOriginX: textPosition.x, fontSize })}</text>`;
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

export function renderDocumentSvg(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: SvgRenderOptions = {},
): string {
  const scene = buildSvgScene(document, resolver, options);
  if (
    options.objectIds &&
    !/<(?:path|polyline|polygon|circle|ellipse|rect|line|text)\b/u.test(
      scene.formalBody,
    )
  ) {
    throw new Error("Select visible objects before copying");
  }
  const profile = resolveDocumentStyleProfile(document.presentation);
  const title = escapeXml(options.title ?? document.name);
  const { x, y, width, height } = scene.viewBox;
  const background =
    options.background === "transparent"
      ? ""
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${profile.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" role="img" aria-labelledby="title" data-style-profile="${profile.id}"><title id="title">${title}</title>${background}<style>${schematicRoundPeriodFontFaceCss}svg{font-size:${profile.typography.annotationFontSize}px;fill:${profile.foreground}}text{font-family:${profile.typography.fontFamily}}</style>${scene.formalBody}</svg>\n`;
}
