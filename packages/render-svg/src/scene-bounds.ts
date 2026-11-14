/**
 * A scene's formal bounds: placed symbols with their formulas, routes,
 * Junctions, annotation room and ink, and drafting objects.
 */
import {
  closedSymbolPathBounds,
  objectStyleProfile,
  resolveDraftingObjectGeometry,
  visibleSymbolInkBounds,
} from "@icm/derived";
import type {
  FilledRegion,
  ResolvedDrawingScene,
  ResolvedDocumentRoutingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import { flattenRichText, transformPoint } from "@icm/model";
import type {
  DerivedPoint,
  DerivedRect,
  Instance,
  Point,
  SchematicDocument,
} from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveInstanceSymbol,
  withShownSupplies,
} from "@icm/symbols";
import type { ResolvedSymbol, SymbolResolver } from "@icm/symbols";

import {
  drawnRouteMarkerPlacement,
  rotateOffset,
} from "./annotation-render.js";
import type { ResolvedSvgAnnotation } from "./annotation-render.js";
import { signalFlowFormulaLocalBounds } from "./signal-flow-formula.js";
import { inductorCouplingBounds } from "./inductor-coupling-render.js";
import {
  busStrokeProfile,
  busTapMarks,
  noConnectMarkerLayouts,
} from "./route-render.js";

function transformedPointBounds(
  points: readonly DerivedPoint[],
  placement: NonNullable<Instance["placement"]>,
): DerivedRect {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    const world = transformPoint(point, placement.position, placement);
    left = Math.min(left, world.x);
    top = Math.min(top, world.y);
    right = Math.max(right, world.x);
    bottom = Math.max(bottom, world.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectCorners({ x, y, width, height }: DerivedRect): DerivedPoint[] {
  return [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ];
}

function filledRegionBounds(
  region: FilledRegion,
  placement: NonNullable<Instance["placement"]>,
): DerivedRect {
  if (region.kind === "circle") {
    const center = transformPoint(region.center, placement.position, placement);
    const { radius } = region;
    return {
      x: center.x - radius,
      y: center.y - radius,
      width: 2 * radius,
      height: 2 * radius,
    };
  }
  return transformedPointBounds(
    region.kind === "polygon" ? region.points : rectCorners(region.bounds),
    placement,
  );
}

function symbolBounds(
  resolved: ResolvedSymbol,
  instance: SchematicDocument["instances"][number],
): DerivedRect {
  const definition = resolved.definition;
  const placement = instance.placement;
  if (!placement) {
    throw new Error(
      `Cannot derive bounds for unplaced instance: ${instance.id}`,
    );
  }
  // A shown supply's stub may stand past the viewBox (#1941).
  const viewBox = withShownSupplies(definition.viewBox, resolved);
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    definition,
    instance.signalFlowParameters,
  );
  const localPoints = rectCorners(viewBox);
  if (adaptive) {
    localPoints.push(
      ...rectCorners(
        visibleSymbolInkBounds(resolved, instance.signalFlowParameters),
      ),
    );
  } else {
    const hidden = new Set(resolved.variant?.hiddenPrimitiveParts);
    for (const primitive of [
      ...definition.primitives,
      ...(resolved.variant?.additionalPrimitives ?? []),
    ]) {
      if (primitive.part && hidden.has(primitive.part)) continue;
      const bounds =
        primitive.kind === "rectangle"
          ? primitive.bounds
          : primitive.kind === "path"
            ? closedSymbolPathBounds(primitive)
            : undefined;
      if (bounds) localPoints.push(...rectCorners(bounds));
    }
  }
  const transformedBounds = transformedPointBounds(localPoints, placement);
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

export function deriveBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  drawingScene: ResolvedDrawingScene,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  dottedJunctionIds: ReadonlySet<string>,
  margin: number,
  annotations: readonly ResolvedSvgAnnotation[],
  profile: SchematicStyleProfile,
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
  for (const instance of document.instances) {
    const placement = instance.placement;
    if (!placement || (objectIds && !objectIds.has(instance.id))) continue;
    // An adder's sign marks reach past its circle; its box includes them.
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) {
      throw new Error(`Unresolved symbol: ${instance.symbolId}`);
    }
    const instanceBox = symbolBounds(resolved, instance);
    bounds.push(instanceBox);
    // The declared body can extend past the Symbol's original viewBox.
    for (const region of drawingScene.instanceFills.get(instance.id)?.regions ??
      [])
      bounds.push(filledRegionBounds(region, placement));
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
    const strokeRadius =
      busStrokeProfile(
        objectStyleProfile(profile, route),
        route.members?.length ?? 0,
      ).strokes.wire / 2;
    for (const mark of busTapMarks(
      document,
      resolver,
      route,
      geometry.centerline,
    )) {
      bounds.push({
        x: Math.min(mark.from.x, mark.to.x) - strokeRadius,
        y: Math.min(mark.from.y, mark.to.y) - strokeRadius,
        width: Math.abs(mark.to.x - mark.from.x) + 2 * strokeRadius,
        height: Math.abs(mark.to.y - mark.from.y) + 2 * strokeRadius,
      });
    }
  }
  // A Route's own points cover the Junctions it meets; a Junction adds ink
  // only by its dot, and one that draws nothing never widens a drawing (#1637).
  for (const junction of document.junctions) {
    if (objectIds && !objectIds.has(junction.id)) continue;
    if (!dottedJunctionIds.has(junction.id)) continue;
    bounds.push({
      x: junction.position.x,
      y: junction.position.y,
      width: 0,
      height: 0,
    });
  }
  for (const { annotation, content, presentation } of annotations) {
    if (objectIds) bounds.push(presentation.bounds);
    // Only a route marker is drawn at the marker's own place; every other
    // label, one on a wire too, is drawn where its presentation is.
    const marker = drawnRouteMarkerPlacement(
      annotation,
      presentation,
      routingGeometry,
    );
    if (!marker) {
      // The room a label reserves, 0.6 em a character, and the ink it draws:
      // a bold name's wide glyphs reach past that room, and an "outb" at the
      // drawing's edge lost its "b" (#1436).
      bounds.push(presentation.bounds, presentation.inkBounds);
      continue;
    }
    // A marker's upright text: a 7-unit character estimate, and the ink its
    // glyphs measure, bold ones included, along its line (#1436).
    const inkWidth =
      presentation.rotation % 180 === 0
        ? presentation.inkBounds.width
        : presentation.inkBounds.height;
    const upright = (at: Point, alignment: "start" | "middle" | "end") => {
      const estimate = estimatedTextBounds(
        flattenRichText(content),
        at.x,
        at.y,
        alignment,
        annotation.sizeScale ?? 1,
      );
      const left =
        alignment === "start"
          ? at.x
          : alignment === "end"
            ? at.x - inkWidth
            : at.x - inkWidth / 2;
      return [estimate, { ...estimate, x: left, width: inkWidth }];
    };
    if (
      annotation.kind === "route-marker" &&
      annotation.markerKind === "current"
    ) {
      // Centred at its label point.
      bounds.push(...upright(marker.labelPosition, "middle"));
    } else if (
      annotation.kind === "route-marker" &&
      annotation.markerKind === "voltage"
    ) {
      // At the marker's point, with its "+" and "−" beside it.
      bounds.push(...upright(marker.position, annotation.alignment));
      const markerProfile = objectStyleProfile(profile, annotation);
      const { polarityOffsetX, polarityHalfGap } = markerProfile.annotations;
      const size = markerProfile.typography.polarityFontSize;
      for (const side of [-1, 1]) {
        const offset = rotateOffset(
          { x: -polarityOffsetX, y: side * polarityHalfGap },
          marker.rotation,
        );
        bounds.push({
          x: marker.position.x + offset.x - size / 2,
          y: marker.position.y + offset.y + 4 - size,
          width: size,
          height: size * 1.25,
        });
      }
    } else if (marker.rotation === presentation.rotation) {
      // Drawn as presented, at the marker's point.
      const dx = marker.position.x - presentation.position.x;
      const dy = marker.position.y - presentation.position.y;
      for (const rect of [presentation.bounds, presentation.inkBounds])
        bounds.push({ ...rect, x: rect.x + dx, y: rect.y + dy });
    } else bounds.push(...upright(marker.position, annotation.alignment));
  }
  // ADR 0010 WP-R2: drafting objects extend the formal export bounds so
  // callouts and floating symbols outside the circuit are not clipped.
  // Resolved geometry is derived.
  for (const object of document.drafting?.objects ?? []) {
    if (objectIds && !objectIds.has(object.id)) continue;
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
      routingGeometry,
    );
    bounds.push(geometry.bounds);
  }
  bounds.push(
    ...inductorCouplingBounds(document, resolver, profile, objectIds),
  );
  // Member declarations extend beyond their shared pin. Measure the same
  // upright names that the formal renderer paints, including cropped exports.
  for (const mark of noConnectMarkerLayouts(
    document,
    resolver,
    profile,
    objectIds,
  )) {
    if (!mark.label) continue;
    const radius = mark.halfExtent + mark.profile.strokes.normal / 2;
    bounds.push(mark.label.bounds, {
      x: mark.point.x - radius,
      y: mark.point.y - radius,
      width: 2 * radius,
      height: 2 * radius,
    });
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
