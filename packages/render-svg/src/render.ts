import {
  RectSchema,
  SchematicDocumentSchema,
  semanticTextDocument,
  transformPoint,
} from "@icm/model";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  fractionGeometry,
  fractionPartScale,
  isMosBulkRoute,
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
  richTextMetrics,
  resolveRouteAttachment,
  razaviTextbookProfile,
  schematicRoundPeriodFontFaceCss,
} from "@icm/derived";
import { flattenRichText } from "@icm/model";
import type {
  EndpointJoin,
  DocumentContactEvidence,
  ResolvedDocumentRoutingGeometry,
  ResolvedDraftingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  DerivedRect,
  DraftingObject,
  GridRect,
  Point,
  RichTextDocument,
  RichTextRun,
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
  renderSignalFlowFormula,
  signalFlowFormulaLocalBounds,
} from "./signal-flow-formula.js";

export interface SvgRenderOptions {
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
): string {
  const fontSize =
    schematicTextFontSize(annotation.kind, profile) *
    (annotation.sizeScale ?? 1);
  return renderRichTextDocument(
    resolveAnnotationText(document, annotation),
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
    attributes: string;
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
  return `<g ${options.attributes}><text data-role="fraction-numerator" x="${centerX}" y="${numeratorY}" text-anchor="middle" font-size="${partFont}"${textColor} style="${partStyle}">${renderRichTextDocument(fraction.numerator, profile, { defaultBold: true, fontSize: partFont })}</text><line data-role="fraction-bar" x1="${centerX - halfWidth}" y1="${barY}" x2="${centerX + halfWidth}" y2="${barY}" stroke="${options.color ?? profile.foreground}" stroke-width="${profile.strokes.annotation}"/><text data-role="fraction-denominator" x="${centerX}" y="${denominatorY}" text-anchor="middle" font-size="${partFont}"${textColor} style="${partStyle}">${renderRichTextDocument(fraction.denominator, profile, { defaultBold: true, fontSize: partFont })}</text></g>`;
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
): string {
  const halfExtent = Math.max(profile.strokes.normal * 3, 4);
  const strokeWidth = profile.strokes.normal;
  return [...document.noConnects]
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
): string {
  const fg = foregroundOverride ?? profile.foreground;
  const style = primitiveStyle(primitive, profile);
  switch (primitive.kind) {
    case "line":
      return `<line x1="${primitive.from.x}" y1="${primitive.from.y}" x2="${primitive.to.x}" y2="${primitive.to.y}"${style}/>`;
    case "polyline":
      return `<polyline points="${pointList(primitive.points)}"${style}/>`;
    case "circle":
      return `<circle cx="${primitive.center.x}" cy="${primitive.center.y}" r="${primitive.radius}"${primitive.fill === undefined ? "" : ` fill="${primitive.fill === "foreground" ? fg : "none"}"`}${primitive.stroke === undefined ? "" : ` stroke="${primitive.stroke === "foreground" ? fg : "none"}"`}${style}/>`;
    case "path":
      return `<path d="${escapeXml(primitive.data)}"${style}/>`;
    case "polygon":
      return `<polygon points="${pointList(primitive.points)}" fill="${primitive.fill === "foreground" ? fg : "none"}"${primitive.stroke === undefined ? "" : ` stroke="${primitive.stroke === "foreground" ? fg : "none"}"`}${style}/>`;
  }
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
    .map((primitive) => renderPrimitive(primitive, profile, foregroundOverride))
    .join("");
}

function instanceTransform(
  instance: SchematicDocument["instances"][number],
): string {
  const placement = instance.placement;
  if (!placement) {
    throw new Error(`Cannot render unplaced instance: ${instance.id}`);
  }
  const mirror = placement.mirror === "x" ? " scale(-1 1)" : "";
  return `translate(${placement.position.x} ${placement.position.y}) rotate(${placement.rotation})${mirror}`;
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
  const source = vectors[direction];
  const mirrored = {
    x: placement.mirror === "x" ? -source.x : source.x,
    y: source.y,
  };
  switch (placement.rotation) {
    case 0:
      return mirrored;
    case 90:
      return { x: -mirrored.y, y: mirrored.x };
    case 180:
      return { x: -mirrored.x, y: -mirrored.y };
    case 270:
      return { x: mirrored.y, y: -mirrored.x };
  }
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
  const formulaBounds = signalFlowFormulaLocalBounds(
    definition.formulaPresentation,
    instance.signalFlowParameters,
  );
  const localBounds = adaptiveBounds ?? formulaBounds ?? viewBox;
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
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function deriveBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  margin: number,
  profile: SchematicStyleProfile,
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
    (candidate) => candidate.placement !== null,
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
    const geometry = routingGeometry.routes.get(route.id);
    if (!geometry) {
      throw new Error(`Cannot derive bounds for unresolved route: ${route.id}`);
    }
    for (const point of geometry.centerline) {
      bounds.push({ x: point.x, y: point.y, width: 0, height: 0 });
    }
  }
  for (const junction of document.junctions) {
    bounds.push({
      x: junction.position.x,
      y: junction.position.y,
      width: 0,
      height: 0,
    });
  }
  for (const annotation of document.annotations) {
    if (!isSchematicAnnotationVisible(document, annotation)) continue;
    const presentation = resolveAnnotationPresentation(
      document,
      resolver,
      annotation,
      profile,
      routingGeometry,
    );
    const routePlacement =
      annotation.anchor.kind === "route"
        ? resolveRouteMarkerPlacement(routingGeometry, annotation.anchor)
        : null;
    if (!routePlacement) {
      bounds.push(presentation.bounds);
      continue;
    }
    const textPosition = routePlacement.labelPosition;
    bounds.push(
      estimatedTextBounds(
        flattenRichText(resolveAnnotationText(document, annotation)),
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
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    bounds.push(geometry.bounds);
  }
  if (bounds.length === 0) {
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
    : deriveBounds(document, resolver, routingGeometry, margin, profile);

  const joinedJunctionIds = new Set(
    routingGeometry.endpointJoins.flatMap((join) =>
      join.kind === "junction-miter" ? [join.junctionId] : [],
    ),
  );
  const junctionColorSets = new Map<string, Set<string>>();
  for (const route of document.routes) {
    const color = route.styleOverride?.color ?? profile.foreground;
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
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((route) => {
      const geometry = routingGeometry.routes.get(route.id);
      if (!geometry) {
        throw new Error(`Cannot render unresolved route: ${route.id}`);
      }
      const strokeColor = route.styleOverride?.color ?? profile.foreground;
      const terminalBridges = renderTerminalMiterBridges(
        geometry.endpointJoins,
        profile,
        strokeColor,
      );
      const presentation = isMosBulkRoute(document, route)
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
      return `<polyline data-object-id="${escapeXml(route.id)}" data-net-id="${escapeXml(route.netId)}"${presentationAttribute} points="${pointList(geometry.centerline)}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}${profileMiterAttribute(profile)}/>${terminalBridges}`;
    })
    .join("");
  const junctionBridges = renderJunctionMiterBridges(
    routingGeometry.endpointJoins,
    profile,
    junctionBridgeColors,
  );
  const contactEvidence =
    options.contactEvidence ??
    deriveDocumentContactEvidence(document, resolver, routingGeometry);
  const junctions = contactEvidence.contacts
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
      // A Port marks its own node, so a pin that merely terminates a wire
      // (or stacks on another pin) stays dotless. But a Port parked on an
      // explicit Junction is riding a real branch: its ring reads as one of
      // the arms, so with two or more route arms the branch keeps its dot
      // (the recorded stem direction of a Port dedupes into the through
      // wire, which is why the three-direction rule alone misses this).
      const portInvolved = contact.endpoints.some(
        (endpoint) =>
          endpoint.kind === "terminal" &&
          ["port", "port-filled"].includes(
            document.instances.find(
              (instance) => instance.id === endpoint.instanceId,
            )?.symbolId ?? "",
          ),
      );
      if (portInvolved) {
        // Two opposite arms are a straight through-wire: the Port ring rides
        // a plain conductor and a dot there reads as an orphan. Any bend or
        // third arm keeps the branch dot.
        const arms = contact.branchDirections;
        const straightThrough =
          arms.length === 2 &&
          arms[0]!.x * arms[1]!.y - arms[0]!.y * arms[1]!.x === 0 &&
          arms[0]!.x * arms[1]!.x + arms[0]!.y * arms[1]!.y < 0;
        return (
          contact.endpoints.some((endpoint) => endpoint.kind === "junction") &&
          arms.length >= 2 &&
          !straightThrough
        );
      }
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
  const noConnectMarkers = renderNoConnectMarkers(document, resolver, profile);
  const noConnectLayer = noConnectMarkers
    ? `<g data-layer="no-connects">${noConnectMarkers}</g>`
    : "";
  const symbols = [...document.instances]
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
      );
      const pinNames = renderVisiblePinNames(
        resolved.definition,
        resolved.variant?.hiddenPinNames ?? [],
        instance,
        profile,
        foregroundOverride,
      );
      const formula = renderSignalFlowFormula(
        resolved.definition.formulaPresentation,
        instance.signalFlowParameters,
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
      return `<g data-object-id="${escapeXml(instance.id)}" data-symbol-id="${escapeXml(resolved.definition.id)}"><g transform="${instanceTransform(instance)}">${backgroundRect}<g${symbolRole} fill="none" stroke="${strokeColor}" stroke-width="${profile.strokes.symbol}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${profileMiterAttribute(profile)}>${primitives}${formula}</g></g>${pinNames}</g>`;
    })
    .join("");
  const annotations = [...document.annotations]
    .filter((annotation) => isSchematicAnnotationVisible(document, annotation))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((annotation) => {
      const content = resolveAnnotationText(document, annotation);
      const attachment = ` data-anchor-kind="${annotation.anchor.kind}"`;
      const presentation = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        profile,
        routingGeometry,
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
      if (
        annotation.kind === "route-marker" &&
        annotation.markerKind === "current"
      ) {
        const x = position.x;
        const y = position.y;
        const vertical = rotation === 90 || rotation === 270;
        const label = routeMarkerPlacement?.labelPosition;
        const textX = vertical ? x + 15 : x;
        const textY = vertical ? y + 4 : y - 7;
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
          : `<text x="${markerTextX}" y="${markerTextY}" text-anchor="${textAnchor}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile)}</text>`;
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
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("power-label", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile)}</text>`;
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
          : `<text x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}"${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute("route-marker", profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile)}</text>`;
        return `<g ${attributes}><text data-role="polarity-positive" x="${position.x + positiveOffset.x}" y="${position.y + positiveOffset.y + 4}" text-anchor="middle" font-size="${profile.typography.polarityFontSize}" style="${polarityStyle}">+</text><text data-role="polarity-negative" x="${position.x + negativeOffset.x}" y="${position.y + negativeOffset.y + 4}" text-anchor="middle" font-size="${profile.typography.polarityFontSize}" style="${polarityStyle}">−</text>${text}</g>`;
      }
      const emphasis = "";
      const fractionRun =
        annotation.rotation === 0 &&
        content.runs.length === 1 &&
        content.runs[0]!.kind === "fraction"
          ? (content.runs[0] as Extract<RichTextRun, { kind: "fraction" }>)
          : null;
      if (fractionRun) {
        return renderStackedFractionAnnotation(fractionRun, {
          attributes,
          position,
          alignment: annotation.alignment,
          width: presentation.bounds.width,
          fontSize:
            schematicTextFontSize(annotation.kind, profile) *
            (annotation.sizeScale ?? 1),
          ...(colorOverride ? { color: colorOverride } : {}),
          profile,
        });
      }
      const formula = renderFormulaDocument(content, profile, {
        x: position.x,
        baselineY: position.y,
        fontSize: annotationFontSize,
        alignment: annotation.alignment,
        ...(colorOverride ? { color: colorOverride } : {}),
      });
      if (formula) {
        return `<g ${attributes} transform="${transform}">${formula}</g>`;
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
        return `<g transform="${transform}"><text ${attributes} x="${position.x}" y="${position.y}" text-anchor="start"${emphasis}${colorOverride ? ` fill="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, profile, annotation.sizeScale)}>${positioned.tspans}</text>${positioned.decorations}</g>`;
      }
      return `<text ${attributes} x="${position.x}" y="${position.y}" text-anchor="${annotation.alignment}" transform="${transform}"${emphasis}${colorOverride ? ` fill="${colorOverride}" color="${colorOverride}"` : ""}${schematicTextSizeAttribute(annotation.kind, profile, annotation.sizeScale)}>${renderAnnotationText(document, annotation, profile)}</text>`;
    })
    .join("");

  return {
    viewBox,
    formalBody: `<g data-layer="formal"><g data-layer="routes">${routes}${junctionBridges}</g><g data-layer="junctions">${junctions}</g><g data-layer="symbols">${symbols}</g>${noConnectLayer}<g data-layer="annotations">${annotations}</g>${renderDraftingLayer(document, resolver, profile)}</g>`,
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
  rotation: 0 | 90 | 180 | 270;
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
): string {
  const objects = document.drafting?.objects ?? [];
  if (objects.length === 0) return "";
  const sorted = [...objects].sort((left, right) => left.zIndex - right.zIndex);
  const body = sorted
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
  return `<g data-layer="drafting">${body}</g>`;
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
      .map(
        (line) =>
          `<line data-role="polarity-${line.role}" x1="${line.from.x}" y1="${line.from.y}" x2="${line.to.x}" y2="${line.to.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}"/>`,
      )
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
  const points = geometry.corners
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  return `<polygon data-object-id="${object.id}" data-kind="draft-rectangle" points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>`;
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
  return `<circle data-object-id="${object.id}" data-kind="draft-circle" cx="${geometry.center.x}" cy="${geometry.center.y}" r="${geometry.radius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>`;
}

function draftingPathData(
  points: Point[],
  curveControls: Array<Point | null>,
  finalPoint?: Point,
): string {
  const start = points[0]!;
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

// A free arrow may end with either a straight or a quadratic segment.  Its
// head must be based on the *visible final segment's* end tangent, never on
// the overall from→to chord.  Keeping this calculation here makes the shaft
// truncation and the triangle share one direction even when an arrow has
// waypoints or an earlier zero-length segment.
function finalDraftArrowTangent(
  points: readonly Point[],
  curveControls: readonly (Point | null)[],
): Point {
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const end = points[index + 1]!;
    const predecessor = curveControls[index] ?? points[index]!;
    const tangent = {
      x: end.x - predecessor.x,
      y: end.y - predecessor.y,
    };
    if (Math.hypot(tangent.x, tangent.y) > 1e-6) return tangent;
  }
  return { x: 1, y: 0 };
}

function renderDraftArrow(
  object: Extract<DraftingObject, { kind: "arrow" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "arrow" }>,
  profile: SchematicStyleProfile,
  unresolved: string,
): string {
  const to = geometry.to;
  const points = geometry.points;
  const tipX = to.x;
  const tipY = to.y;
  // The head follows the final non-zero segment, not the overall chord. This
  // keeps a bent arrow's shaft cleanly terminated at its head base plane.
  const tangent = finalDraftArrowTangent(points, geometry.curveControls);
  const dx = tangent.x;
  const dy = tangent.y;
  const length = Math.hypot(dx, dy);
  // strokeScale widens/narrows the shaft; arrowHeadScale grows/shrinks the head
  // independently. Both multiply the Razavi profile baseline so formal export
  // and the editor canvas share one visual parameter (no raw px in objects).
  const strokeScale = object.styleOverride?.strokeScale ?? 1;
  const headScale = object.styleOverride?.arrowHeadScale ?? 1;
  const strokeWidth = profile.strokes.annotation * strokeScale;
  // Free arrows and route-mounted current arrows intentionally share the
  // profile-owned head proportions. They differ only in shaft ownership: a
  // route marker reuses its conductor, while a free arrow draws its own.
  //
  // The head follows the shaft's weight. A head held at profile size while the
  // shaft thickened stopped being a head: at the widest stroke its base
  // corners barely cleared the shaft, so the point read as a stub and the
  // shaft showed through on either side of it. arrowHeadScale still tunes the
  // head on top of that, which is what it is for.
  const headWeight = headScale * strokeScale;
  const head = profile.annotations.arrowHeadLength * headWeight;
  const halfHeadWidth = (profile.annotations.arrowHeadWidth * headWeight) / 2;
  const nx = (-dy / length) * halfHeadWidth;
  const ny = (dx / length) * halfHeadWidth;
  const baseX = tipX - (dx / length) * head;
  const baseY = tipY - (dy / length) * head;
  const arrowHead = object.styleOverride?.arrowHead ?? "filled";
  const stroke = object.styleOverride?.color ?? profile.foreground;
  const lineStyle = object.styleOverride?.lineStyle ?? "solid";
  const dash =
    lineStyle === "dashed"
      ? ' stroke-dasharray="6 4"'
      : lineStyle === "dotted"
        ? ' stroke-dasharray="2 3"'
        : "";
  const headBody =
    arrowHead === "none"
      ? ""
      : `<polygon points="${tipX},${tipY} ${baseX + nx},${baseY + ny} ${baseX - nx},${baseY - ny}" ${arrowHead === "open" ? `fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"` : `fill="${stroke}"`}/>`;
  // The shaft terminates on the arrow head's base plane, not underneath its
  // tip. This preserves the clean triangular point of Razavi-style arrows at
  // every angle and head scale. A headless arrow remains a complete line.
  const shaftEndX = arrowHead === "none" ? tipX : baseX;
  const shaftEndY = arrowHead === "none" ? tipY : baseY;
  const shaftPoints = [...points.slice(0, -1), { x: shaftEndX, y: shaftEndY }]
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const hasCurve = geometry.curveControls.some(Boolean);
  const shaft = hasCurve
    ? `<path d="${draftingPathData(points, geometry.curveControls, { x: shaftEndX, y: shaftEndY })}" fill="none"`
    : `<polyline points="${shaftPoints}" fill="none"`;
  return `<g data-object-id="${object.id}" data-kind="draft-arrow"${unresolved}>${shaft} stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${dash}/>${headBody}</g>`;
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
  const mirror = object.transform.mirror === "x" ? " scale(-1 1)" : "";
  const hidden = resolved.variant?.hiddenPinNames ?? [];
  const additional = resolved.variant?.additionalPrimitives ?? [];
  const body = renderSymbolDefinitionBody(
    resolved.definition,
    hidden,
    additional,
    profile,
  );
  return `<g data-object-id="${object.id}" data-kind="draft-floating-symbol"${unresolved} data-symbol-id="${escapeXml(object.symbolId)}"><g transform="translate(${position.x} ${position.y}) rotate(${rotation})${mirror}">${body}</g></g>`;
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
  const profile = resolveDocumentStyleProfile(document.presentation);
  const title = escapeXml(options.title ?? document.name);
  const { x, y, width, height } = scene.viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" role="img" aria-labelledby="title" data-style-profile="${profile.id}"><title id="title">${title}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${profile.background}"/><style>${schematicRoundPeriodFontFaceCss}svg{font-size:${profile.typography.annotationFontSize}px}text{fill:${profile.foreground};font-family:${profile.typography.fontFamily}}</style>${scene.formalBody}</svg>\n`;
}
