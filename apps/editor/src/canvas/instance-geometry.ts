import { transformPoint } from "@icm/model";
import type {
  DerivedRect,
  SymbolLocalPoint,
  SymbolLocalRect,
  SchematicDocument,
} from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  type ResolvedSymbol,
  type SignalFlowLayoutParameters,
} from "@icm/symbols";

function viewBoxCorners(viewBox: SymbolLocalRect): SymbolLocalPoint[] {
  return [
    { x: viewBox.x, y: viewBox.y },
    { x: viewBox.x + viewBox.width, y: viewBox.y },
    { x: viewBox.x, y: viewBox.y + viewBox.height },
    { x: viewBox.x + viewBox.width, y: viewBox.y + viewBox.height },
  ];
}

/**
 * Returns the visible local envelope of a resolved symbol. Paths use their
 * authored centerline bounds; only an unbounded path needs the declaration
 * viewBox fallback. The envelope also contains visible electrical pins.
 */
export function visibleSymbolLocalBounds(
  resolved: ResolvedSymbol,
  signalFlowParameters?: SignalFlowLayoutParameters,
): SymbolLocalRect {
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
  const points: SymbolLocalPoint[] = [];

  for (const primitive of primitives) {
    switch (primitive.kind) {
      case "line":
        points.push(primitive.from, primitive.to);
        break;
      case "polyline":
      case "polygon":
        points.push(...primitive.points);
        break;
      case "circle":
        points.push(
          {
            x: primitive.center.x - primitive.radius,
            y: primitive.center.y - primitive.radius,
          },
          {
            x: primitive.center.x + primitive.radius,
            y: primitive.center.y + primitive.radius,
          },
        );
        break;
      case "path":
        if (!primitive.bounds) return resolved.definition.viewBox;
        points.push(...viewBoxCorners(primitive.bounds));
        break;
    }
  }

  points.push(
    ...resolved.definition.pins
      .filter((pin) => !hiddenPins.has(pin.name))
      .map((pin) => pin.at),
  );
  if (points.length === 0) return resolved.definition.viewBox;

  // Path bounds describe centerlines. Four units cover the amplifier's
  // 60-degree miter and the sharper resistor zigzag at normal stroke widths,
  // without making the empty part of the source crop selectable.
  const padding = primitives.some((primitive) => primitive.kind === "path")
    ? 4
    : 1.5;
  const minX = Math.min(...points.map((point) => point.x)) - padding;
  const minY = Math.min(...points.map((point) => point.y)) - padding;
  const maxX = Math.max(...points.map((point) => point.x)) + padding;
  const maxY = Math.max(...points.map((point) => point.y)) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function instanceVisibleHitBox(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
): DerivedRect | null {
  if (!instance.placement) return null;
  const localBounds = visibleSymbolLocalBounds(
    resolved,
    instance.signalFlowParameters,
  );
  const corners = viewBoxCorners(localBounds).map((point) =>
    transformPoint(point, instance.placement!.position, instance.placement!),
  );
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
