import type {
  DerivedPoint,
  DerivedRect,
  DraftingObject,
  RichTextDocument,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveVisualAnchor, type ResolvedAnchor } from "./anchor.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import {
  measureRichTextDocument,
  richTextMetrics,
  wrapRichTextDocument,
} from "./rich-text-layout.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";

// ADR 0010 / WP-R1: the single derived-geometry entry for DraftingObjects.
// Renderer, Editor overlay, and Agent Snapshot consume ONLY this result; no
// consumer re-implements anchor math. Resolution reads derived geometry only,
// never mutates the Document, never guesses a new route, never auto re-attaches,
// and never blocks rendering/export when an anchor is invalid (fallback used).

export type DraftingAnchorRole = "anchor" | "from" | "to" | "target";

export interface DraftingDiagnostic {
  code:
    | "DRAFTING_ANCHOR_TARGET_MISSING"
    | "DRAFTING_ROUTE_SEGMENT_INVALID"
    | "DRAFTING_SYMBOL_UNRESOLVED";
  severity: "warning";
  draftingObjectId: string;
  anchorRole: DraftingAnchorRole;
  targetObjectIds: string[];
  message: string;
  bounds?: DerivedRect;
}

export type ResolvedDraftingGeometry =
  | {
      kind: "text";
      /** Rotation pivot and stable placement anchor for the whole object. */
      position: DerivedPoint;
      /** Center of the editable text, which may shift between polarity marks. */
      textPosition: DerivedPoint;
      rotation: 0 | 90 | 180 | 270;
      polarityLines: Array<{
        role: "positive-horizontal" | "positive-vertical" | "negative";
        from: DerivedPoint;
        to: DerivedPoint;
      }>;
      bounds: DerivedRect;
      diagnostics: DraftingDiagnostic[];
    }
  | {
      kind: "arrow";
      from: DerivedPoint;
      to: DerivedPoint;
      // The complete visible shaft path. `waypoints` remain free geometry;
      // from/to retain their independently-resolved VisualAnchor semantics.
      points: DerivedPoint[];
      vertices: DerivedPoint[];
      curveControls: Array<DerivedPoint | null>;
      // Midpoint of from/to. Editor handle placement and 90° rotation pivot.
      center: DerivedPoint;
      bounds: DerivedRect;
      diagnostics: DraftingDiagnostic[];
    }
  | {
      kind: "leader";
      anchor: DerivedPoint;
      target: DerivedPoint;
      bounds: DerivedRect;
      diagnostics: DraftingDiagnostic[];
    }
  | {
      kind: "callout";
      textPosition: DerivedPoint;
      target: DerivedPoint;
      rotation: 0 | 90 | 180 | 270;
      textBounds: DerivedRect;
      bounds: DerivedRect;
      diagnostics: DraftingDiagnostic[];
    }
  | {
      kind: "construction-line";
      points: DerivedPoint[];
      // Same vertices as points, exposed as the editable handle set so the
      // editor does not alias the persisted array by accident. Per-vertex
      // handle placement and vertex insert/delete use this list.
      vertices: DerivedPoint[];
      curveControls: Array<DerivedPoint | null>;
      bounds: DerivedRect;
      diagnostics: [];
    }
  | {
      kind: "rectangle";
      center: DerivedPoint;
      width: number;
      height: number;
      rotation: number;
      corners: DerivedPoint[];
      bounds: DerivedRect;
      diagnostics: [];
    }
  | {
      kind: "circle";
      center: DerivedPoint;
      radius: number;
      bounds: DerivedRect;
      diagnostics: [];
    }
  | {
      kind: "floating-symbol";
      position: DerivedPoint;
      rotation: 0 | 90 | 180 | 270;
      bounds: DerivedRect;
      diagnostics: DraftingDiagnostic[];
    };

const STROKE_PADDING = 6;
/** Breathing room between a boxed label and the rectangle's own stroke. */
const RECT_LABEL_PADDING = 6;

/**
 * The content a drafting text actually lays out.
 *
 * A label anchored to a rectangle is a label *inside a box*, so it wraps to
 * that box instead of running out past its edges. Every other text keeps the
 * author's own lines exactly. The SVG renderer calls this too: one wrapped
 * document for both is what keeps the selection box on the text it frames,
 * rather than two implementations agreeing by luck.
 */
export function draftTextLayoutContent(
  document: SchematicDocument,
  object: Extract<DraftingObject, { kind: "text" }>,
  metrics: Parameters<typeof measureRichTextDocument>[1],
): RichTextDocument {
  if (object.anchor.kind !== "object") return object.content;
  const anchorId = object.anchor.objectId;
  const target = document.drafting?.objects.find(
    (candidate) => candidate.id === anchorId,
  );
  if (target?.kind !== "rectangle") return object.content;
  return wrapRichTextDocument(
    object.content,
    metrics,
    target.width - RECT_LABEL_PADDING * 2,
  );
}
const TEXT_PADDING_X = 6;
const TEXT_PADDING_Y = 8;
const ARROWHEAD_PADDING = 12;

export function resolveDraftingObjectGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: DraftingObject,
): ResolvedDraftingGeometry {
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  switch (object.kind) {
    case "text":
      return resolveText(document, resolver, object, routingGeometry);
    case "arrow":
      return resolveArrow(document, resolver, object, routingGeometry);
    case "leader":
      return resolveLeader(document, resolver, object, routingGeometry);
    case "callout":
      return resolveCallout(document, resolver, object, routingGeometry);
    case "construction-line":
      return resolveConstructionLine(object);
    case "rectangle":
      return resolveRectangle(object);
    case "circle":
      return resolveCircle(object);
    case "floating-symbol":
      return resolveFloatingSymbol(document, resolver, object, routingGeometry);
  }
}

function resolveAnchorWithRole(
  document: SchematicDocument,
  resolver: SymbolResolver,
  anchor: VisualAnchor,
  draftingObjectId: string,
  anchorRole: DraftingAnchorRole,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): { anchor: ResolvedAnchor; diagnostics: DraftingDiagnostic[] } {
  const resolved = resolveVisualAnchor(
    document,
    resolver,
    anchor,
    routingGeometry,
  );
  const diagnostics: DraftingDiagnostic[] = [];
  if (!resolved.resolved && resolved.diagnostic) {
    // P2: propagate the precise code (missing target vs invalid route segment)
    // instead of collapsing every failure into one.
    const code =
      resolved.diagnostic.code === "DRAFTING_ROUTE_SEGMENT_INVALID"
        ? "DRAFTING_ROUTE_SEGMENT_INVALID"
        : "DRAFTING_ANCHOR_TARGET_MISSING";
    diagnostics.push({
      code,
      severity: "warning",
      draftingObjectId,
      anchorRole,
      targetObjectIds: resolved.diagnostic.objectId
        ? [resolved.diagnostic.objectId]
        : [],
      message: resolved.diagnostic.message,
    });
  }
  return { anchor: resolved, diagnostics };
}

// P1: frozen final-rotation semantics. The renderer, export bounds, and
// Snapshot all use the geometry.rotation reported here. For a "follow" route
// anchor the anchor's own rotation composes with the object's persisted
// rotation; for free/object anchors the object rotation stands alone.
function composeRotation(
  anchorRotation: 0 | 90 | 180 | 270,
  objectRotation: 0 | 90 | 180 | 270,
  follow: boolean,
): 0 | 90 | 180 | 270 {
  if (!follow) return objectRotation;
  const composed = (anchorRotation + objectRotation) % 360;
  return (((composed % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

function resolveText(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: Extract<DraftingObject, { kind: "text" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
) {
  // Text anchors may be free/object/route; route anchors reuse the shared route
  // math via resolveVisualAnchor.
  const resolved = resolveVisualAnchor(
    document,
    resolver,
    object.anchor,
    routingGeometry,
  );
  const diagnostics: DraftingDiagnostic[] = [];
  if (!resolved.resolved && resolved.diagnostic) {
    const code =
      resolved.diagnostic.code === "DRAFTING_ROUTE_SEGMENT_INVALID"
        ? "DRAFTING_ROUTE_SEGMENT_INVALID"
        : "DRAFTING_ANCHOR_TARGET_MISSING";
    diagnostics.push({
      code,
      severity: "warning",
      draftingObjectId: object.id,
      anchorRole: "anchor",
      targetObjectIds: resolved.diagnostic.objectId
        ? [resolved.diagnostic.objectId]
        : [],
      message: resolved.diagnostic.message,
    });
  }
  const position = resolved.position;
  const follow =
    object.anchor.kind === "route" && object.anchor.orientation === "follow";
  const rotation = composeRotation(resolved.rotation, object.rotation, follow);
  const profile = resolveDocumentStyleProfile(document.presentation);
  const metrics = richTextMetrics(
    profile,
    object.typographyToken,
    object.styleOverride?.sizeScale,
  );
  const content = draftTextLayoutContent(document, object, metrics);
  const polarity = object.polarity
    ? resolvePolarityTextGeometry(position, object.polarity, content, metrics)
    : null;
  const textPosition = polarity?.textPosition ?? position;
  const unrotatedTextBounds = textBounds(
    textPosition,
    object.alignment,
    0,
    content,
    metrics,
  );
  const unrotatedBounds = polarity
    ? unionRects([
        unrotatedTextBounds,
        paddedBounds(
          unionBounds(polarity.lines.flatMap((line) => [line.from, line.to])),
          STROKE_PADDING / 2,
        ),
      ])
    : unrotatedTextBounds;
  const bounds =
    rotation === 0
      ? unrotatedBounds
      : rotatedRectBounds(unrotatedBounds, position, rotation);
  return {
    kind: "text" as const,
    position,
    textPosition,
    rotation,
    polarityLines: polarity?.lines ?? [],
    bounds,
    diagnostics,
  };
}

function resolvePolarityTextGeometry(
  position: DerivedPoint,
  polarity: "both" | "positive" | "negative",
  content: RichTextDocument,
  metrics: ReturnType<typeof richTextMetrics>,
): {
  textPosition: DerivedPoint;
  lines: Extract<ResolvedDraftingGeometry, { kind: "text" }>["polarityLines"];
} {
  const layout = measureRichTextDocument(content, metrics);
  const textHalfHeight = layout.height / 2;
  const markerHalfArm = metrics.fontSize * 0.23;
  const separation = textHalfHeight + markerHalfArm + metrics.fontSize * 0.18;
  let textOffset = 0;
  let positiveOffset: number | null = null;
  let negativeOffset: number | null = null;
  if (polarity === "both") {
    positiveOffset = -separation;
    negativeOffset = separation;
  } else if (polarity === "positive") {
    positiveOffset = (-separation - textHalfHeight + markerHalfArm) / 2;
    textOffset = positiveOffset + separation;
  } else {
    textOffset = -(separation - textHalfHeight + markerHalfArm) / 2;
    negativeOffset = textOffset + separation;
  }
  const lines: Extract<
    ResolvedDraftingGeometry,
    { kind: "text" }
  >["polarityLines"] = [];
  if (positiveOffset !== null) {
    const y = position.y + positiveOffset;
    lines.push(
      {
        role: "positive-horizontal",
        from: { x: position.x - markerHalfArm, y },
        to: { x: position.x + markerHalfArm, y },
      },
      {
        role: "positive-vertical",
        from: { x: position.x, y: y - markerHalfArm },
        to: { x: position.x, y: y + markerHalfArm },
      },
    );
  }
  if (negativeOffset !== null) {
    const y = position.y + negativeOffset;
    lines.push({
      role: "negative",
      from: { x: position.x - markerHalfArm, y },
      to: { x: position.x + markerHalfArm, y },
    });
  }
  return {
    textPosition: { x: position.x, y: position.y + textOffset },
    lines,
  };
}

function resolveArrow(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: Extract<DraftingObject, { kind: "arrow" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
) {
  const from = resolveAnchorWithRole(
    document,
    resolver,
    object.from,
    object.id,
    "from",
    routingGeometry,
  );
  const to = resolveAnchorWithRole(
    document,
    resolver,
    object.to,
    object.id,
    "to",
    routingGeometry,
  );
  const fromPoint = from.anchor.position;
  const toPoint = to.anchor.position;
  const points = [
    fromPoint,
    ...(object.waypoints ?? []).map((point) => ({ ...point })),
    toPoint,
  ];
  return {
    kind: "arrow" as const,
    from: fromPoint,
    to: toPoint,
    points,
    vertices: points.map((point) => ({ ...point })),
    curveControls: Array.from({ length: points.length - 1 }, (_, index) =>
      object.curveControls?.[index] ? { ...object.curveControls[index] } : null,
    ),
    center: {
      x: (fromPoint.x + toPoint.x) / 2,
      y: (fromPoint.y + toPoint.y) / 2,
    },
    bounds: paddedBounds(unionBounds(points), ARROWHEAD_PADDING),
    diagnostics: [...from.diagnostics, ...to.diagnostics],
  };
}

function resolveLeader(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: Extract<DraftingObject, { kind: "leader" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
) {
  const anchor = resolveAnchorWithRole(
    document,
    resolver,
    object.anchor,
    object.id,
    "anchor",
    routingGeometry,
  );
  const target = resolveAnchorWithRole(
    document,
    resolver,
    object.target,
    object.id,
    "target",
    routingGeometry,
  );
  const anchorPoint = anchor.anchor.position;
  const targetPoint = target.anchor.position;
  return {
    kind: "leader" as const,
    anchor: anchorPoint,
    target: targetPoint,
    bounds: paddedBounds(
      unionBounds([anchorPoint, targetPoint]),
      STROKE_PADDING,
    ),
    diagnostics: [...anchor.diagnostics, ...target.diagnostics],
  };
}

function resolveCallout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: Extract<DraftingObject, { kind: "callout" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
) {
  const anchor = resolveAnchorWithRole(
    document,
    resolver,
    object.anchor,
    object.id,
    "anchor",
    routingGeometry,
  );
  const target = resolveAnchorWithRole(
    document,
    resolver,
    object.target,
    object.id,
    "target",
    routingGeometry,
  );
  const textPos = anchor.anchor.position;
  const targetPoint = target.anchor.position;
  const follow =
    object.anchor.kind === "route" && object.anchor.orientation === "follow";
  const rotation = composeRotation(
    anchor.anchor.rotation,
    object.rotation,
    follow,
  );
  const textBox = textBounds(
    textPos,
    object.alignment,
    rotation,
    object.content,
    richTextMetrics(
      resolveDocumentStyleProfile(document.presentation),
      object.typographyToken,
      object.styleOverride?.sizeScale,
    ),
  );
  const leaderBox = paddedBounds(
    unionBounds([textPos, targetPoint]),
    STROKE_PADDING,
  );
  return {
    kind: "callout" as const,
    textPosition: textPos,
    target: targetPoint,
    rotation,
    textBounds: textBox,
    bounds: unionRects([textBox, leaderBox]),
    diagnostics: [...anchor.diagnostics, ...target.diagnostics],
  };
}

function resolveConstructionLine(
  object: Extract<DraftingObject, { kind: "construction-line" }>,
) {
  return {
    kind: "construction-line" as const,
    points: object.points,
    vertices: object.points.map((point) => ({ ...point })),
    curveControls: Array.from(
      { length: object.points.length - 1 },
      (_, index) =>
        object.curveControls?.[index]
          ? { ...object.curveControls[index] }
          : null,
    ),
    bounds: paddedBounds(unionBounds(object.points), STROKE_PADDING),
    diagnostics: [] as [],
  };
}

function resolveRectangle(
  object: Extract<DraftingObject, { kind: "rectangle" }>,
) {
  const radians = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = object.width / 2;
  const halfHeight = object.height / 2;
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: object.center.x + point.x * cos - point.y * sin,
    y: object.center.y + point.x * sin + point.y * cos,
  }));
  return {
    kind: "rectangle" as const,
    center: { ...object.center },
    width: object.width,
    height: object.height,
    rotation: object.rotation,
    corners,
    bounds: paddedBounds(unionBounds(corners), STROKE_PADDING),
    diagnostics: [] as [],
  };
}

function resolveCircle(object: Extract<DraftingObject, { kind: "circle" }>) {
  return {
    kind: "circle" as const,
    center: { ...object.center },
    radius: object.radius,
    bounds: paddedBounds(
      {
        x: object.center.x - object.radius,
        y: object.center.y - object.radius,
        width: object.radius * 2,
        height: object.radius * 2,
      },
      STROKE_PADDING,
    ),
    diagnostics: [] as [],
  };
}

function resolveFloatingSymbol(
  document: SchematicDocument,
  resolver: SymbolResolver,
  object: Extract<DraftingObject, { kind: "floating-symbol" }>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
) {
  const anchor = resolveAnchorWithRole(
    document,
    resolver,
    object.anchor,
    object.id,
    "anchor",
    routingGeometry,
  );
  const resolvedSymbol = resolver.resolve(object.symbolId);
  const diagnostics = [...anchor.diagnostics];
  if (!resolvedSymbol) {
    diagnostics.push({
      code: "DRAFTING_SYMBOL_UNRESOLVED",
      severity: "warning",
      draftingObjectId: object.id,
      anchorRole: "anchor",
      targetObjectIds: [object.symbolId],
      message: `Floating symbol ${object.symbolId} is unresolved; using anchor fallback bounds.`,
    });
  }
  const position = anchor.anchor.position;
  const rotation = object.transform.rotation;
  const viewBox = resolvedSymbol?.definition.viewBox;
  let bounds: DerivedRect = {
    x: position.x - 12,
    y: position.y - 12,
    width: 24,
    height: 24,
  };
  if (viewBox) {
    // P1: apply the same transform the SVG renderer uses
    // (translate(position) rotate(rotation) scale(-1 1) when mirror=x) to all
    // four viewBox corners and take the AABB, so the bounds match the rendered
    // symbol for any rotation/mirror combination.
    const corners: DerivedPoint[] = [
      { x: viewBox.x, y: viewBox.y },
      { x: viewBox.x + viewBox.width, y: viewBox.y },
      { x: viewBox.x, y: viewBox.y + viewBox.height },
      { x: viewBox.x + viewBox.width, y: viewBox.y + viewBox.height },
    ].map((corner) =>
      transformSymbolCorner(
        corner,
        position,
        rotation,
        object.transform.mirror,
      ),
    );
    bounds = unionBounds(corners);
  }
  return {
    kind: "floating-symbol" as const,
    position,
    rotation,
    bounds,
    diagnostics,
  };
}

// Mirrors the SVG transform order in render.ts: translate(position), then
// rotate(rotation) about the origin, then scale(-1 1) for mirror-x.
function transformSymbolCorner(
  corner: DerivedPoint,
  position: DerivedPoint,
  rotation: 0 | 90 | 180 | 270,
  mirror: "none" | "x",
): DerivedPoint {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = mirror === "x" ? -corner.x : corner.x;
  const ry = corner.y;
  return {
    x: position.x + rx * cos - ry * sin,
    y: position.y + rx * sin + ry * cos,
  };
}

// --- bounds helpers -------------------------------------------------------

function unionBounds(points: DerivedPoint[]): DerivedRect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function paddedBounds(bounds: DerivedRect, padding: number): DerivedRect {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function unionRects(rects: DerivedRect[]): DerivedRect {
  const nonEmpty = rects.filter((rect) => rect.width > 0 || rect.height > 0);
  if (nonEmpty.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...nonEmpty.map((rect) => rect.x));
  const minY = Math.min(...nonEmpty.map((rect) => rect.y));
  const maxX = Math.max(...nonEmpty.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...nonEmpty.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// P1: rich-text layout bounds approximated from the document structure and a
// per-token font size (the caller passes the size; derived cannot depend on the
// renderer's style profile). Line breaks split the text into lines, so
// multi-line content gets its full height, and nested spans are
// flattened recursively rather than as a fixed "XX".
function textBounds(
  position: DerivedPoint,
  alignment: "start" | "middle" | "end",
  rotation: 0 | 90 | 180 | 270,
  content: RichTextDocument,
  metrics: ReturnType<typeof richTextMetrics>,
): DerivedRect {
  const layout = measureRichTextDocument(content, metrics);
  const width = layout.width + TEXT_PADDING_X * 2;
  const height = layout.height + TEXT_PADDING_Y * 2;
  const left =
    alignment === "start"
      ? position.x - TEXT_PADDING_X
      : alignment === "end"
        ? position.x - width + TEXT_PADDING_X
        : position.x - width / 2;
  const top = position.y - height / 2;
  const box: DerivedRect = { x: left, y: top, width, height };
  if (rotation === 0) return box;
  return rotatedRectBounds(box, position, rotation);
}

function rotatedRectBounds(
  rect: DerivedRect,
  origin: DerivedPoint,
  rotation: 90 | 180 | 270,
): DerivedRect {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return unionBounds(
    [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ].map((point) => {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      return {
        x: origin.x + dx * cos - dy * sin,
        y: origin.y + dx * sin + dy * cos,
      };
    }),
  );
}
