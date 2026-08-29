import { flattenRichText, routeEnd, transformPoint } from "@icm/model";
import type { Point, Rect, RouteEndpoint, SchematicDocument } from "@icm/model";
import { resolveAdaptiveSignalFlowBlockLayout } from "@icm/symbols";
import type {
  ResolvedSymbol,
  SignalFlowLayoutParameters,
  SymbolPrimitive,
  SymbolResolver,
} from "@icm/symbols";

import {
  endpointKey,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
} from "./endpoint.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";
import { deriveDocumentContactEvidence } from "./contact.js";
import { resolveAnnotationPresentation } from "./annotation-presentation.js";
import { resolveAnnotationText } from "./annotation-text.js";
import { pointOnSegment } from "./segment-geometry.js";

export interface VisualDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  category: "structural" | "observation";
  confidence: "high" | "medium" | "low";
  gateEligible: boolean;
  message: string;
  objectIds: readonly string[];
  bounds?: Rect;
  point?: Point;
  parameters?: Readonly<Record<string, string | number | boolean>>;
}

export interface VisualDiagnosticOptions {
  minimumSegmentLength?: number;
  pageBounds?: Rect;
}

interface CachedVisualDiagnostics {
  revision: number;
  resolver: SymbolResolver;
  diagnostics: readonly VisualDiagnostic[];
}

/** Derived-only default diagnostic cache, invalidated by revision/resolver. */
const visualDiagnosticCache = new WeakMap<
  SchematicDocument,
  CachedVisualDiagnostics
>();

function rectanglesOverlap(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function enclosingBounds(input: readonly Rect[]): Rect | undefined {
  if (input.length === 0) return undefined;
  const x = Math.min(...input.map((item) => item.x));
  const y = Math.min(...input.map((item) => item.y));
  const right = Math.max(...input.map((item) => item.x + item.width));
  const bottom = Math.max(...input.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

function overlappingClusters<T extends { id: string; bounds: Rect }>(
  items: readonly T[],
  overlaps: (left: T, right: T) => boolean = (left, right) =>
    rectanglesOverlap(left.bounds, right.bounds),
): T[][] {
  const parents = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (overlaps(items[left]!, items[right]!)) {
        join(left, right);
      }
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function powerPinName(symbolId: string): string | undefined {
  return symbolId === "vdd" ? "P" : symbolId === "ground" ? "0" : undefined;
}

function terminalSharesNet(
  document: SchematicDocument,
  left: { instanceId: string; pinName: string },
  right: { instanceId: string; pinName: string },
): boolean {
  return document.nets.some(
    (net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === left.instanceId &&
          terminal.pinName === left.pinName,
      ) &&
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === right.instanceId &&
          terminal.pinName === right.pinName,
      ),
  );
}

/**
 * A power marker touching one visible pin on its own Net is an intentional
 * terminal contact, not a symbol collision. This remains deliberately narrow:
 * ordinary same-Net symbol overlap is still reported.
 */
function isExactPowerPinContact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  leftId: string,
  rightId: string,
): boolean {
  const left = document.instances.find((item) => item.id === leftId);
  const right = document.instances.find((item) => item.id === rightId);
  if (!left?.placement || !right?.placement) return false;
  const powerInstance = powerPinName(left.symbolId) ? left : right;
  const otherInstance = powerInstance === left ? right : left;
  const powerPin = powerPinName(powerInstance.symbolId);
  const powerPlacement = powerInstance.placement;
  const otherPlacement = otherInstance.placement;
  if (
    !powerPin ||
    powerPinName(otherInstance.symbolId) ||
    !powerPlacement ||
    !otherPlacement
  ) {
    return false;
  }
  const otherSymbol = resolver.resolve(
    otherInstance.symbolId,
    otherInstance.symbolVariantId,
  );
  if (!otherSymbol) return false;
  const powerEndpoint = {
    kind: "terminal" as const,
    instanceId: powerInstance.id,
    pinName: powerPin,
  };
  const powerPoint = resolveEndpointPoint(document, resolver, powerEndpoint);
  if (!powerPoint) return false;
  const hiddenPins = new Set(otherSymbol.variant?.hiddenPinNames ?? []);
  return otherSymbol.definition.pins.some((pin) => {
    if (
      hiddenPins.has(pin.name) ||
      pin.presentation.visibility === "implicit"
    ) {
      return false;
    }
    const otherEndpoint = {
      kind: "terminal" as const,
      instanceId: otherInstance.id,
      pinName: pin.name,
    };
    const point = resolveEndpointPoint(document, resolver, otherEndpoint);
    return (
      point !== null &&
      samePoint(powerPoint, point) &&
      terminalSharesNet(document, powerEndpoint, otherEndpoint)
    );
  });
}

function primitivePoints(primitive: SymbolPrimitive): Point[] | null {
  switch (primitive.kind) {
    case "line":
      return [primitive.from, primitive.to];
    case "polyline":
    case "polygon":
      return [...primitive.points];
    case "circle":
      return [
        {
          x: primitive.center.x - primitive.radius,
          y: primitive.center.y - primitive.radius,
        },
        {
          x: primitive.center.x + primitive.radius,
          y: primitive.center.y + primitive.radius,
        },
      ];
    case "path":
      return null;
  }
}

/**
 * Tight bounds of the symbol geometry actually drawn on the canvas.
 *
 * This deliberately excludes interaction tolerance. Use it for visual
 * relationships such as label clearance; callers that need a forgiving hit or
 * diagnostic envelope must use `visibleSymbolLocalBounds` below.
 */
export function visibleSymbolInkBounds(
  resolved: ResolvedSymbol,
  signalFlowParameters?: SignalFlowLayoutParameters,
): Rect {
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    resolved.definition,
    signalFlowParameters,
  );
  if (adaptive) return adaptive.bounds;
  const hiddenParts = new Set(resolved.variant?.hiddenPrimitiveParts ?? []);
  const hiddenPins = new Set(resolved.variant?.hiddenPinNames ?? []);
  const primitives = [
    ...resolved.definition.primitives,
    ...(resolved.variant?.additionalPrimitives ?? []),
  ].filter((primitive) => !primitive.part || !hiddenParts.has(primitive.part));
  const primitivePointSets = primitives.map(primitivePoints);
  if (primitivePointSets.some((points) => points === null)) {
    return resolved.definition.viewBox;
  }
  const points = [
    ...primitivePointSets.flatMap((entry) => entry ?? []),
    ...resolved.definition.pins
      .filter((pin) => !hiddenPins.has(pin.name))
      .map((pin) => pin.at),
  ];
  if (points.length === 0) return resolved.definition.viewBox;
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Forgiving envelope used for pointer interaction and visual diagnostics.
 * It must not be used to position visible text: doing so turns its padding
 * into an unintended extra label gap when the result is snapped to the grid.
 */
export function visibleSymbolLocalBounds(
  resolved: ResolvedSymbol,
  signalFlowParameters?: SignalFlowLayoutParameters,
): Rect {
  const ink = visibleSymbolInkBounds(resolved, signalFlowParameters);
  const padding = 1;
  return {
    x: ink.x - padding,
    y: ink.y - padding,
    width: ink.width + padding * 2,
    height: ink.height + padding * 2,
  };
}

function instanceBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Array<{ id: string; bounds: Rect }> {
  return document.instances.flatMap((instance) => {
    if (!instance.placement) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return [];
    const box = visibleSymbolLocalBounds(
      resolved,
      instance.signalFlowParameters,
    );
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ].map((point) =>
      transformPoint(point, instance.placement!.position, instance.placement!),
    );
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [
      {
        id: instance.id,
        bounds: {
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
        },
      },
    ];
  });
}

function objectAnchor(
  document: SchematicDocument,
  objectId: string,
): Point | null {
  const instance = document.instances.find((item) => item.id === objectId);
  if (instance?.placement) return instance.placement.position;
  const annotation = document.annotations.find((item) => item.id === objectId);
  if (annotation) {
    return annotation.anchor.kind === "free"
      ? annotation.anchor.position
      : annotation.anchor.fallbackPosition;
  }
  const junction = document.junctions.find((item) => item.id === objectId);
  return junction?.position ?? null;
}

function constraintViolation(
  document: SchematicDocument,
  constraint: SchematicDocument["constraints"][number],
  boundsById: ReadonlyMap<string, Rect>,
): boolean {
  const anchors = constraint.objectIds.map((id) => objectAnchor(document, id));
  if (anchors.some((point) => point === null)) return true;
  const points = anchors as Point[];
  switch (constraint.kind) {
    case "align-x":
      return points.some((point) => point.x !== points[0]!.x);
    case "align-y":
      return points.some((point) => point.y !== points[0]!.y);
    case "equal-spacing": {
      const xRange =
        Math.max(...points.map((point) => point.x)) -
        Math.min(...points.map((point) => point.x));
      const yRange =
        Math.max(...points.map((point) => point.y)) -
        Math.min(...points.map((point) => point.y));
      const coordinates = points
        .map((point) => (xRange >= yRange ? point.x : point.y))
        .sort((left, right) => left - right);
      if (coordinates.length < 3) return false;
      const spacing = coordinates[1]! - coordinates[0]!;
      return coordinates
        .slice(2)
        .some((value, index) => value - coordinates[index + 1]! !== spacing);
    }
    case "symmetric": {
      if (points.length % 2 !== 0) return true;
      const axisSum = points[0]!.x + points[1]!.x;
      for (let index = 0; index < points.length; index += 2) {
        if (
          points[index]!.y !== points[index + 1]!.y ||
          points[index]!.x + points[index + 1]!.x !== axisSum
        ) {
          return true;
        }
      }
      return false;
    }
    case "keep-clear":
      return constraint.objectIds.some((leftId, leftIndex) =>
        constraint.objectIds.slice(leftIndex + 1).some((rightId) => {
          const left = boundsById.get(leftId);
          const right = boundsById.get(rightId);
          return left && right ? rectanglesOverlap(left, right) : false;
        }),
      );
  }
}

/**
 * Read-only routing-quality metrics. These report wire-through-symbol,
 * same-Net route overlap, and terminal departure direction. Severity is
 * `info` for departure (evidence) and `warning` for overlap and
 * wire-through-symbol (likely readability defects). They never move objects
 * and never claim good/bad — detour ratio is reported as evidence only.
 */
function pushRoutingQualityMetrics(
  diagnostics: VisualDiagnostic[],
  document: SchematicDocument,
  resolver: SymbolResolver,
  boundsById: Map<string, Rect>,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): void {
  const routeCenterlines = document.routes
    .map((route) => ({
      route,
      centerline: routingGeometry.routes.get(route.id)?.centerline,
    }))
    .filter(
      (
        entry,
      ): entry is {
        route: typeof entry.route;
        centerline: readonly Point[];
      } => entry.centerline !== undefined,
    );
  const contactEvidence = deriveDocumentContactEvidence(
    document,
    resolver,
    routingGeometry,
  );

  // 1. Wire-through-symbol: a Route segment passes through an instance
  //    silhouette that is not one of its terminal endpoints.
  for (const { route, centerline } of routeCenterlines) {
    const contactTerminalInstances = (endpoint: RouteEndpoint) =>
      new Set(
        (
          contactEvidence.byEndpointKey.get(endpointKey(endpoint))
            ?.endpoints ?? [endpoint]
        )
          .filter(
            (
              candidate,
            ): candidate is Extract<typeof candidate, { kind: "terminal" }> =>
              candidate.kind === "terminal",
          )
          .map((candidate) => candidate.instanceId),
      );
    const fromTerminalInstances = contactTerminalInstances(route.start);
    const toTerminalInstances = contactTerminalInstances(routeEnd(route));
    for (let index = 1; index < centerline.length; index += 1) {
      const from = centerline[index - 1]!;
      const to = centerline[index]!;
      for (const [instanceId, box] of boundsById) {
        if (
          (index === 1 && fromTerminalInstances.has(instanceId)) ||
          (index === centerline.length - 1 &&
            toTerminalInstances.has(instanceId))
        ) {
          continue;
        }
        if (segmentIntersectsRect(from, to, box)) {
          diagnostics.push({
            code: "VISUAL_WIRE_THROUGH_SYMBOL",
            severity: "warning",
            category: "observation",
            confidence: "low",
            gateEligible: false,
            message: `Route ${route.id} passes through instance ${instanceId}`,
            objectIds: [route.id, instanceId],
            bounds: box,
            parameters: { segmentIndex: index - 1 },
          });
        }
      }
    }
  }

  // 2. Same-Net route overlap: two Routes on the same Net share a collinear
  //    overlapping segment (not just a shared endpoint).
  const overlappingRouteIdsByNet = new Map<string, Set<string>>();
  for (let leftIndex = 0; leftIndex < routeCenterlines.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < routeCenterlines.length;
      rightIndex += 1
    ) {
      const left = routeCenterlines[leftIndex]!;
      const right = routeCenterlines[rightIndex]!;
      if (left.route.netId !== right.route.netId) continue;
      const overlap = firstCollinearOverlap(left.centerline, right.centerline);
      if (overlap) {
        const ids = overlappingRouteIdsByNet.get(left.route.netId) ?? new Set();
        ids.add(left.route.id);
        ids.add(right.route.id);
        overlappingRouteIdsByNet.set(left.route.netId, ids);
      }
    }
  }
  for (const [netId, routeIds] of overlappingRouteIdsByNet) {
    const objectIds = [...routeIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    diagnostics.push({
      code: "VISUAL_ROUTE_OVERLAP",
      severity: "warning",
      category: "observation",
      confidence: "medium",
      gateEligible: false,
      message: `${objectIds.length} Routes share collinear geometry on Net ${netId}`,
      objectIds,
      parameters: { netId, routeCount: objectIds.length },
    });
  }

  // 3. Terminal departure: the first segment of a terminal-anchored Route
  //    should leave along the pin's outward direction. Reported as evidence.
  for (const { route, centerline } of routeCenterlines) {
    if (route.start.kind !== "terminal") continue;
    if (centerline.length < 2) continue;
    const outward = resolveEndpointOutwardDirection(
      document,
      resolver,
      route.start,
    );
    if (!outward) continue;
    const first = centerline[0]!;
    const second = centerline[1]!;
    const departure = {
      x: Math.sign(second.x - first.x),
      y: Math.sign(second.y - first.y),
    };
    const aligned =
      (outward.x !== 0 && departure.x === outward.x) ||
      (outward.y !== 0 && departure.y === outward.y);
    if (!aligned) {
      diagnostics.push({
        code: "VISUAL_TERMINAL_DEPARTURE",
        severity: "info",
        category: "observation",
        confidence: "low",
        gateEligible: false,
        message: `Route ${route.id} does not leave terminal along its pin outward direction`,
        objectIds: [route.id],
        point: first,
        parameters: {
          outwardX: outward.x,
          outwardY: outward.y,
          departureX: departure.x,
          departureY: departure.y,
        },
      });
    }
  }
}

function segmentIntersectsRect(from: Point, to: Point, box: Rect): boolean {
  // Axial-aligned segment vs axis-aligned rect intersection. A segment whose
  // endpoint lies strictly inside the box counts as passing through.
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  return (
    maxX > box.x &&
    minX < box.x + box.width &&
    maxY > box.y &&
    minY < box.y + box.height
  );
}

function firstCollinearOverlap(
  left: readonly Point[],
  right: readonly Point[],
): { bounds?: Rect } | undefined {
  for (let i = 1; i < left.length; i += 1) {
    const la = left[i - 1]!;
    const lb = left[i]!;
    for (let j = 1; j < right.length; j += 1) {
      const ra = right[j - 1]!;
      const rb = right[j]!;
      // Both segments must be collinear on the same axis-aligned line.
      const sameHorizontal = la.y === lb.y && ra.y === rb.y && la.y === ra.y;
      const sameVertical = la.x === lb.x && ra.x === rb.x && la.x === ra.x;
      if (!sameHorizontal && !sameVertical) continue;
      if (sameHorizontal) {
        const start = Math.max(Math.min(la.x, lb.x), Math.min(ra.x, rb.x));
        const end = Math.min(Math.max(la.x, lb.x), Math.max(ra.x, rb.x));
        if (end > start) {
          // Collinear overlap is a zero-thickness region; the diagnostic reports
          // the overlap extent in parameters rather than a zero-area Rect.
          return {};
        }
      } else {
        const start = Math.max(Math.min(la.y, lb.y), Math.min(ra.y, rb.y));
        const end = Math.min(Math.max(la.y, lb.y), Math.max(ra.y, rb.y));
        if (end > start) {
          return {};
        }
      }
    }
  }
  return undefined;
}

export function diagnoseVisualQuality(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: VisualDiagnosticOptions = {},
): readonly VisualDiagnostic[] {
  const cacheEligible =
    options.minimumSegmentLength === undefined &&
    options.pageBounds === undefined;
  const cached = cacheEligible
    ? visualDiagnosticCache.get(document)
    : undefined;
  if (cached?.revision === document.revision && cached.resolver === resolver) {
    return cached.diagnostics;
  }
  const diagnostics: VisualDiagnostic[] = [];
  const minimumSegmentLength =
    options.minimumSegmentLength ?? document.presentation.grid;
  const bounds = instanceBounds(document, resolver);
  const boundsById = new Map(bounds.map((item) => [item.id, item.bounds]));
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);

  for (const instance of document.instances) {
    if (!instance.placement) {
      diagnostics.push({
        code: "VISUAL_UNPLACED_INSTANCE",
        severity: "warning",
        category: "structural",
        confidence: "high",
        gateEligible: true,
        message: `Instance ${instance.id} is not placed`,
        objectIds: [instance.id],
        parameters: { placed: false },
      });
    } else if (!resolver.resolve(instance.symbolId, instance.symbolVariantId)) {
      diagnostics.push({
        code: "VISUAL_UNRESOLVED_SYMBOL",
        severity: "error",
        category: "structural",
        confidence: "high",
        gateEligible: true,
        message: `Instance ${instance.id} has an unresolved symbol`,
        objectIds: [instance.id],
        point: instance.placement.position,
        parameters: { symbolId: instance.symbolId },
      });
    }
  }
  for (const cluster of overlappingClusters(
    bounds,
    (left, right) =>
      rectanglesOverlap(left.bounds, right.bounds) &&
      !isExactPowerPinContact(document, resolver, left.id, right.id),
  )) {
    const objectIds = cluster
      .map((item) => item.id)
      .sort((left, right) => left.localeCompare(right, "en"));
    diagnostics.push({
      code: "VISUAL_SYMBOL_OVERLAP",
      severity: "warning",
      category: "observation",
      confidence: "low",
      gateEligible: false,
      message: `${objectIds.length} visible symbol bounds overlap`,
      objectIds,
      bounds: enclosingBounds(cluster.map((item) => item.bounds))!,
      parameters: { clusteredObjectCount: objectIds.length },
    });
  }

  const styleProfile = resolveDocumentStyleProfile(document.presentation);
  const annotationBounds = document.annotations
    .filter(
      (annotation) =>
        flattenRichText(resolveAnnotationText(document, annotation)).trim()
          .length > 0,
    )
    .map((annotation) => {
      return {
        id: annotation.id,
        bounds: resolveAnnotationPresentation(
          document,
          resolver,
          annotation,
          styleProfile,
          routingGeometry,
        ).bounds,
      };
    });
  for (const cluster of overlappingClusters(annotationBounds)) {
    const objectIds = cluster
      .map((item) => item.id)
      .sort((left, right) => left.localeCompare(right, "en"));
    diagnostics.push({
      code: "VISUAL_LABEL_OVERLAP",
      severity: "warning",
      category: "observation",
      confidence: "low",
      gateEligible: false,
      message: `${objectIds.length} measured annotation bounds overlap`,
      objectIds,
      bounds: enclosingBounds(cluster.map((item) => item.bounds))!,
      parameters: { clusteredObjectCount: objectIds.length },
    });
  }

  for (const route of document.routes) {
    const centerline = routingGeometry.routes.get(route.id)?.centerline;
    if (!centerline) continue;
    for (let index = 1; index < centerline.length; index += 1) {
      const from = centerline[index - 1]!;
      const to = centerline[index]!;
      const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (length < minimumSegmentLength) {
        diagnostics.push({
          code: "VISUAL_SHORT_SEGMENT",
          severity: "warning",
          category: "observation",
          confidence: "medium",
          gateEligible: false,
          message: `Route ${route.id} contains a short segment`,
          objectIds: [route.id],
          bounds: {
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            width: Math.max(1, Math.abs(to.x - from.x)),
            height: Math.max(1, Math.abs(to.y - from.y)),
          },
          parameters: { segmentIndex: index - 1, length },
        });
        break;
      }
    }
  }
  for (const junction of document.junctions) {
    for (const route of document.routes) {
      if (route.netId === junction.netId) continue;
      const centerline = routingGeometry.routes.get(route.id)?.centerline;
      if (
        centerline
          ?.slice(1)
          .some((to, index) =>
            pointOnSegment(junction.position, centerline[index]!, to),
          )
      ) {
        diagnostics.push({
          code: "VISUAL_AMBIGUOUS_JUNCTION",
          severity: "error",
          category: "structural",
          confidence: "high",
          gateEligible: true,
          message: `Junction ${junction.id} lies on unrelated route ${route.id}`,
          objectIds: [junction.id, route.id],
          point: junction.position,
          parameters: {
            junctionNetId: junction.netId,
            routeNetId: route.netId,
          },
        });
      }
    }
  }

  for (const constraint of document.constraints) {
    if (constraintViolation(document, constraint, boundsById)) {
      const violationBounds = enclosingBounds(
        constraint.objectIds.flatMap((id) => {
          const item = boundsById.get(id);
          return item ? [item] : [];
        }),
      );
      diagnostics.push({
        code: "VISUAL_CONSTRAINT_VIOLATION",
        severity: "warning",
        category: "structural",
        confidence: "high",
        gateEligible: true,
        message: `Layout constraint ${constraint.id} is not satisfied`,
        objectIds: [constraint.id, ...constraint.objectIds],
        ...(violationBounds ? { bounds: violationBounds } : {}),
        parameters: { constraintKind: constraint.kind },
      });
    }
  }
  if (options.pageBounds) {
    for (const item of [...bounds, ...annotationBounds]) {
      const page = options.pageBounds;
      if (
        item.bounds.x < page.x ||
        item.bounds.y < page.y ||
        item.bounds.x + item.bounds.width > page.x + page.width ||
        item.bounds.y + item.bounds.height > page.y + page.height
      ) {
        diagnostics.push({
          code: "VISUAL_OUTSIDE_PAGE",
          severity: "warning",
          category: "observation",
          confidence: "high",
          gateEligible: false,
          message: `Object ${item.id} extends outside the export page`,
          objectIds: [item.id],
          bounds: item.bounds,
          parameters: { pageBounds: JSON.stringify(page) },
        });
      }
    }
  }
  // Read-only routing-quality metrics. These are evidence, not pass/fail
  // judges: they report wire-through-symbol, same-Net route overlap, and
  // terminal departure direction. They never move objects.
  pushRoutingQualityMetrics(
    diagnostics,
    document,
    resolver,
    boundsById,
    routingGeometry,
  );
  const ordered = diagnostics.sort((left, right) =>
    `${left.code}\0${left.objectIds.join("\0")}`.localeCompare(
      `${right.code}\0${right.objectIds.join("\0")}`,
      "en",
    ),
  );
  if (cacheEligible) {
    visualDiagnosticCache.set(document, {
      revision: document.revision,
      resolver,
      diagnostics: ordered,
    });
  }
  return ordered;
}

export function hasBlockingVisualDiagnostics(
  diagnostics: readonly VisualDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) =>
    isVisualDiagnosticGateFailure(diagnostic),
  );
}

export function isVisualDiagnosticGateFailure(
  diagnostic: VisualDiagnostic,
  configuredCodes: ReadonlySet<string> = new Set(),
): boolean {
  if (diagnostic.category !== "structural" || !diagnostic.gateEligible) {
    return false;
  }
  return (
    diagnostic.severity === "error" || configuredCodes.has(diagnostic.code)
  );
}
