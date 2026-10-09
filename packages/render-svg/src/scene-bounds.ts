/**
 * A scene's formal bounds: placed symbols with their formulas, routes,
 * Junctions, annotation room and ink, and drafting objects.
 */
import {
  objectStyleProfile,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type {
  ResolvedDocumentRoutingGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import { flattenRichText, transformPoint } from "@icm/model";
import type { DerivedRect, Point, SchematicDocument } from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveInstanceSymbol,
} from "@icm/symbols";
import type { SymbolDefinition, SymbolResolver } from "@icm/symbols";

import {
  drawnRouteMarkerPlacement,
  rotateOffset,
} from "./annotation-render.js";
import type { ResolvedSvgAnnotation } from "./annotation-render.js";
import { signalFlowFormulaLocalBounds } from "./signal-flow-formula.js";

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

export function deriveBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
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
  for (const instance of document.instances.filter(
    (candidate) =>
      candidate.placement !== null &&
      (!objectIds || objectIds.has(candidate.id)),
  )) {
    // An adder's sign marks reach past its circle; its box includes them.
    const resolved = resolveInstanceSymbol(resolver, instance);
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
