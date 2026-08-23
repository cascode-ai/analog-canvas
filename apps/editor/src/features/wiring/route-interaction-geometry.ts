import {
  defaultInstanceLabelPlacement,
  displayableInstanceValue,
  measureRichTextDocument,
  richTextMetrics,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveRouteAttachment,
} from "@icm/derived";
import type {
  ResolvedRouteGeometry,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  Annotation,
  Point,
  Rect,
  RouteAnnotationAttachment,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { schematicTextFontSize } from "@icm/render-svg";
import type { SymbolResolver } from "@icm/symbols";

import { clamp, closestPointOnSegment } from "../../canvas/canvas-geometry";
import { instanceVisibleHitBox } from "../../canvas/instance-geometry";

/**
 * Where a tap on a conductor lands.
 *
 * The projection onto the segment is quantized to the grid so a tap that is
 * merely aimed at a wire still lands tidily. But the grid is a tidiness
 * preference, while landing on a conductor is an electrical act: when a run
 * is already under way, the coordinate it arrives on wins within one grid
 * step, so a straight connection stays straight instead of being bent into
 * an elbow — or refused. Any point along a conductor may be tapped.
 */
export function routeTapPoint(
  pointer: Point,
  from: Point,
  to: Point,
  grid: number,
  arrival?: Point | null,
): Point {
  const projected = closestPointOnSegment(pointer, from, to);
  const prefers = (wanted: number, along: number, low: number, high: number) =>
    wanted >= Math.min(low, high) &&
    wanted <= Math.max(low, high) &&
    Math.abs(wanted - along) <= grid;
  const onGrid = (value: number) => Math.round(value / grid) * grid;
  if (from.y === to.y) {
    if (arrival && prefers(arrival.x, projected.x, from.x, to.x)) {
      return { x: arrival.x, y: from.y };
    }
    return { x: onGrid(projected.x), y: from.y };
  }
  if (from.x === to.x) {
    if (arrival && prefers(arrival.y, projected.y, from.y, to.y)) {
      return { x: from.x, y: arrival.y };
    }
    return { x: from.x, y: onGrid(projected.y) };
  }
  // Octilinear diagonal: choosing one grid coordinate determines the other.
  // Endpoints already satisfy the grid invariant, so the paired coordinate
  // remains integral and on-grid too.
  const slope = Math.sign(to.y - from.y) * Math.sign(to.x - from.x);
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const x = clamp(onGrid(projected.x), minX, maxX);
  return { x, y: from.y + slope * (x - from.x) };
}

export interface RouteGeometryRecord {
  route: SchematicDocument["routes"][number];
  geometry: ResolvedRouteGeometry;
}

export const ROUTED_MARKER_MIN_NORMAL_OFFSET = 12;
export const ROUTED_MARKER_MAX_NORMAL_OFFSET = 40;
// Net labels keep their electrical binding to the route but may be placed in
// a much wider band around it than the tight current-marker label band.
export const NET_LABEL_MIN_NORMAL_OFFSET = 8;
export const NET_LABEL_MAX_NORMAL_OFFSET = 200;

export function endpointNetId(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): string | null {
  if (endpoint.kind === "junction") {
    return (
      document.junctions.find((junction) => junction.id === endpoint.junctionId)
        ?.netId ?? null
    );
  }
  return (
    document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === endpoint.instanceId &&
          terminal.pinName === endpoint.pinName,
      ),
    )?.id ?? null
  );
}

export function junctionRouteDegree(
  document: SchematicDocument,
  junctionId: string,
): number {
  return document.routes.filter(
    (route) =>
      (route.from.kind === "junction" &&
        route.from.junctionId === junctionId) ||
      (route.to.kind === "junction" && route.to.junctionId === junctionId),
  ).length;
}

export function isLooseRouteEndpoint(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): boolean {
  if (endpoint.kind !== "junction") return false;
  const junction = document.junctions.find(
    (candidate) => candidate.id === endpoint.junctionId,
  );
  if (!junction) return false;
  return (
    junction.role === "route-anchor" ||
    ((junction.role ?? "branch") === "branch" &&
      junctionRouteDegree(document, junction.id) === 1)
  );
}

export function looseRouteAnchorIds(
  document: SchematicDocument,
  route: SchematicDocument["routes"][number],
): [string, string] | null {
  if (
    route.from.kind !== "junction" ||
    route.to.kind !== "junction" ||
    route.from.junctionId === route.to.junctionId ||
    !isLooseRouteEndpoint(document, route.from) ||
    !isLooseRouteEndpoint(document, route.to)
  ) {
    return null;
  }
  return [route.from.junctionId, route.to.junctionId];
}

export function attachmentAtPoint(
  routeGeometryRecords: readonly RouteGeometryRecord[],
  candidate: Point,
  routeId?: string,
  normalOffset = -14,
): { routeAttachment: RouteAnnotationAttachment; position: Point } | null {
  const candidates = routeGeometryRecords
    .filter((record) => !routeId || record.route.id === routeId)
    .flatMap(({ route, geometry }) =>
      geometry.segments.map(({ address, from, to }) => {
        const segmentIndex = address.segmentIndex;
        const position = closestPointOnSegment(candidate, from, to);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : clamp(
                ((position.x - from.x) * dx + (position.y - from.y) * dy) /
                  lengthSquared,
                0,
                1,
              );
        return {
          routeAttachment: {
            routeId: route.id,
            segmentIndex,
            t,
            direction: "forward" as const,
            normalOffset,
          },
          position,
          distanceSquared:
            (position.x - candidate.x) ** 2 + (position.y - candidate.y) ** 2,
        };
      }),
    )
    .sort((left, right) => left.distanceSquared - right.distanceSquared);
  const closest = candidates[0];
  return closest
    ? {
        routeAttachment: closest.routeAttachment,
        position: closest.position,
      }
    : null;
}

/**
 * Reposition an existing route marker from the desired label position. The
 * electrical route remains authoritative: the marker may slide along the
 * attached route and its label may move only within a small normal-offset
 * band around the arrow. Near the shaft, the existing side is retained so a
 * pointer crossing the conductor does not make the label flicker.
 */
export function dragRouteAttachmentAtPoint(
  routeGeometryRecords: readonly RouteGeometryRecord[],
  candidate: Point,
  current: RouteAnnotationAttachment,
): { routeAttachment: RouteAnnotationAttachment; position: Point } | null {
  const record = routeGeometryRecords.find(
    ({ route }) => route.id === current.routeId,
  );
  if (!record) return null;
  const candidates = record.geometry.segments
    .flatMap(({ address, from, to }) => {
      const segmentIndex = address.segmentIndex;
      const position = closestPointOnSegment(candidate, from, to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) return [];
      const length = Math.sqrt(lengthSquared);
      const t = clamp(
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          lengthSquared,
        0,
        1,
      );
      const normal = { x: -dy / length, y: dx / length };
      const rawNormalOffset =
        (candidate.x - position.x) * normal.x +
        (candidate.y - position.y) * normal.y;
      const previousSign = current.normalOffset >= 0 ? 1 : -1;
      const sign =
        Math.abs(rawNormalOffset) < ROUTED_MARKER_MIN_NORMAL_OFFSET
          ? previousSign
          : rawNormalOffset >= 0
            ? 1
            : -1;
      const normalOffset =
        sign *
        clamp(
          Math.abs(rawNormalOffset),
          ROUTED_MARKER_MIN_NORMAL_OFFSET,
          ROUTED_MARKER_MAX_NORMAL_OFFSET,
        );
      const labelPosition = {
        x: position.x + normal.x * normalOffset,
        y: position.y + normal.y * normalOffset,
      };
      return [
        {
          routeAttachment: {
            ...current,
            segmentIndex,
            t,
            normalOffset,
          },
          position: { x: Math.round(position.x), y: Math.round(position.y) },
          distanceSquared:
            (labelPosition.x - candidate.x) ** 2 +
            (labelPosition.y - candidate.y) ** 2,
        },
      ];
    })
    .sort((left, right) => left.distanceSquared - right.distanceSquared);
  const closest = candidates[0];
  return closest
    ? {
        routeAttachment: closest.routeAttachment,
        position: closest.position,
      }
    : null;
}

/**
 * Reposition a route-attached Net label from the desired label position. The
 * label stays bound to its own route: it may slide along any segment and
 * offset across the conductor within the generous Net-label band. Crossing
 * the conductor flips the offset side directly, unlike the sticky
 * current-marker band.
 */
export function dragNetLabelAttachmentAtPoint(
  routeGeometryRecords: readonly RouteGeometryRecord[],
  candidate: Point,
  routeId: string,
): {
  segmentIndex: number;
  t: number;
  normalOffset: number;
  labelPosition: Point;
} | null {
  const record = routeGeometryRecords.find(({ route }) => route.id === routeId);
  if (!record) return null;
  const candidates = record.geometry.segments
    .flatMap(({ address, from, to }) => {
      const segmentIndex = address.segmentIndex;
      const position = closestPointOnSegment(candidate, from, to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) return [];
      const length = Math.sqrt(lengthSquared);
      const t = clamp(
        ((position.x - from.x) * dx + (position.y - from.y) * dy) /
          lengthSquared,
        0,
        1,
      );
      const normal = { x: -dy / length, y: dx / length };
      const rawNormalOffset =
        (candidate.x - position.x) * normal.x +
        (candidate.y - position.y) * normal.y;
      const normalOffset =
        Math.sign(rawNormalOffset || 1) *
        clamp(
          Math.abs(rawNormalOffset),
          NET_LABEL_MIN_NORMAL_OFFSET,
          NET_LABEL_MAX_NORMAL_OFFSET,
        );
      const labelPosition = {
        x: Math.round(position.x + normal.x * normalOffset),
        y: Math.round(position.y + normal.y * normalOffset),
      };
      return [
        {
          segmentIndex,
          t,
          normalOffset,
          labelPosition,
          // Pick the segment whose on-conductor projection is nearest to the
          // pointer, not the nearest final label position: near corners the
          // label-position metric lets a perpendicular segment's clamped
          // endpoint steal the drag.
          distanceSquared:
            (position.x - candidate.x) ** 2 + (position.y - candidate.y) ** 2,
        },
      ];
    })
    .sort((left, right) => left.distanceSquared - right.distanceSquared);
  const closest = candidates[0];
  if (!closest) return null;
  const { segmentIndex, t, normalOffset, labelPosition } = closest;
  return { segmentIndex, t, normalOffset, labelPosition };
}

export function effectiveRouteAttachment(
  annotation: Annotation,
): RouteAnnotationAttachment | null {
  if (
    annotation.kind === "route-marker" &&
    annotation.anchor.kind === "route"
  ) {
    const anchor = annotation.anchor;
    return {
      routeId: anchor.routeId,
      segmentIndex: anchor.segmentIndex,
      t: anchor.t,
      direction: anchor.direction,
      normalOffset: anchor.normalOffset,
    };
  }
  return null;
}

export function isRoutedMarker(annotation: Annotation): boolean {
  return (
    annotation.kind === "route-marker" && annotation.markerKind === "current"
  );
}

export function annotationAnchor(
  document: SchematicDocument,
  resolver: SymbolResolver,
  annotation: Annotation,
  routeGeometryRecords: readonly RouteGeometryRecord[],
  styleProfile: SchematicStyleProfile,
): Point {
  const attachment = effectiveRouteAttachment(annotation);
  if (!isRoutedMarker(annotation) || !attachment) {
    return resolveAnnotationPresentation(
      document,
      resolver,
      annotation,
      styleProfile,
    ).position;
  }
  const record = routeGeometryRecords.find(
    ({ route }) => route.id === attachment.routeId,
  );
  return (
    (record &&
      resolveRouteAttachment(record.geometry, attachment)?.conductorPoint) ??
    resolveAnnotationPresentation(document, resolver, annotation, styleProfile)
      .position
  );
}

export function annotationHitBox(
  document: SchematicDocument,
  annotation: Annotation,
  anchor: Point,
  routeGeometryRecords: readonly RouteGeometryRecord[],
  styleProfile: SchematicStyleProfile,
): Rect {
  const sizeScale = annotation.sizeScale ?? 1;
  const fontSize =
    schematicTextFontSize(annotation.kind, styleProfile) * sizeScale;
  const textLayout = measureRichTextDocument(
    resolveAnnotationText(document, annotation),
    richTextMetrics(styleProfile, "label", sizeScale),
  );
  let labelPosition = anchor;
  let alignment = annotation.alignment;
  let rotation = annotation.rotation;
  let arrowBounds: Rect | null = null;

  if (isRoutedMarker(annotation)) {
    const routeAttachment = effectiveRouteAttachment(annotation);
    const record = routeAttachment
      ? routeGeometryRecords.find(
          ({ route }) => route.id === routeAttachment.routeId,
        )
      : undefined;
    const placement =
      record && routeAttachment
        ? resolveRouteAttachment(record.geometry, routeAttachment)
        : null;
    rotation = placement?.rotation ?? annotation.rotation;
    const vertical = rotation === 90 || rotation === 270;
    labelPosition = placement?.labelPoint ?? {
      x: anchor.x + (vertical ? 15 : 0),
      y: anchor.y + (vertical ? 4 : -7),
    };
    alignment = placement
      ? "middle"
      : vertical
        ? "start"
        : annotation.alignment;
    const arrowLength =
      styleProfile.id === "textbook-monochrome-v1"
        ? 24
        : styleProfile.annotations.currentArrowLength;
    const halfLength = arrowLength / 2;
    arrowBounds = vertical
      ? {
          x: anchor.x - 6,
          y: anchor.y - halfLength,
          width: 12,
          height: arrowLength,
        }
      : {
          x: anchor.x - halfLength,
          y: anchor.y - 6,
          width: arrowLength,
          height: 12,
        };
  }

  const width = Math.max(fontSize * 0.6, textLayout.width);
  const height = Math.max(fontSize * 1.35, textLayout.height);
  const left =
    alignment === "start"
      ? labelPosition.x
      : alignment === "end"
        ? labelPosition.x - width
        : labelPosition.x - width / 2;
  const textBounds =
    rotation === 90 || rotation === 270
      ? {
          x: labelPosition.x - height / 2,
          y: labelPosition.y - width / 2,
          width: height,
          height: width,
        }
      : { x: left, y: labelPosition.y - fontSize * 1.05, width, height };
  const minimumX = Math.min(textBounds.x, arrowBounds?.x ?? textBounds.x);
  const minimumY = Math.min(textBounds.y, arrowBounds?.y ?? textBounds.y);
  const maximumX = Math.max(
    textBounds.x + textBounds.width,
    arrowBounds
      ? arrowBounds.x + arrowBounds.width
      : textBounds.x + textBounds.width,
  );
  const maximumY = Math.max(
    textBounds.y + textBounds.height,
    arrowBounds
      ? arrowBounds.y + arrowBounds.height
      : textBounds.y + textBounds.height,
  );
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

export function instanceHitBox(
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): Rect | null {
  if (!instance.placement) return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  return resolved ? instanceVisibleHitBox(instance, resolved) : null;
}

export function defaultInstanceLabel(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
  slot: "reference" | "value" = "reference",
): Annotation | null {
  if (!instance.placement) return null;
  if (
    document.annotations.some(
      (annotation) =>
        annotation.kind === "instance-label" &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === instance.id,
    )
  ) {
    return null;
  }
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved || resolved.definition.labelVisibility === "hidden") {
    return null;
  }
  const placement = defaultInstanceLabelPlacement(
    instance,
    resolved,
    styleProfile,
    document.presentation.grid,
    slot,
  );
  if (!placement) return null;
  const position = placement.position;
  return {
    id: `instance-label-${instance.id}`,
    kind: "instance-label",
    binding: { kind: "instance-schematic-name", instanceId: instance.id },
    anchor: {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: position.x - instance.placement.position.x,
        y: position.y - instance.placement.position.y,
      },
      fallbackPosition: position,
    },
    alignment: placement.alignment,
    rotation: 0,
    locked: false,
  };
}

export function instanceValueAnnotation(
  document: SchematicDocument,
  instanceId: string,
): Annotation | null {
  return (
    document.annotations.find(
      (annotation) =>
        annotation.kind === "instance-value" &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === instanceId,
    ) ?? null
  );
}

/**
 * Projects the instance's electrical parameters into a fresh Value annotation
 * at the value slot. Returns null when no projection exists or one is already
 * present; callers that need to refresh content should refresh explicitly.
 */
export function defaultInstanceValue(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
): Annotation | null {
  if (!instance.placement) return null;
  if (instanceValueAnnotation(document, instance.id)) return null;
  if (displayableInstanceValue(instance).kind !== "displayable") return null;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return null;
  const placement = defaultInstanceLabelPlacement(
    instance,
    resolved,
    styleProfile,
    document.presentation.grid,
    "value",
  );
  if (!placement) return null;
  const position = placement.position;
  return {
    id: `instance-value-${instance.id}`,
    kind: "instance-value",
    binding: { kind: "instance-value", instanceId: instance.id },
    anchor: {
      kind: "object",
      objectId: instance.id,
      localOffset: {
        x: position.x - instance.placement.position.x,
        y: position.y - instance.placement.position.y,
      },
      fallbackPosition: position,
    },
    alignment: placement.alignment,
    rotation: 0,
    locked: false,
  };
}
