import {
  drawingOrderKey,
  inverseTransformPoint,
  resolveDrawingOrder,
} from "@icm/model";
import type {
  DerivedPoint,
  DerivedRect,
  DrawingOrderEntry,
  Instance,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveInstanceSymbol,
} from "@icm/symbols";
import type {
  ResolvedSymbol,
  SymbolDefinition,
  SymbolResolver,
} from "@icm/symbols";

import { resolveDraftingObjectGeometry } from "./drafting-geometry.js";
import { pointOnSegment } from "./segment-geometry.js";

export type FilledRegion =
  | { readonly kind: "polygon"; readonly points: readonly DerivedPoint[] }
  | {
      readonly kind: "circle";
      readonly center: DerivedPoint;
      readonly radius: number;
    }
  | { readonly kind: "rectangle"; readonly bounds: DerivedRect };

export interface ResolvedInstanceFill {
  readonly regions: readonly FilledRegion[];
  readonly color: string | "background";
  readonly legacy: boolean;
  readonly adaptive?: boolean;
}

function fillableRegions(symbol: ResolvedSymbol): FilledRegion[] {
  const hidden = new Set(symbol.variant?.hiddenPrimitiveParts);
  return [
    ...symbol.definition.primitives,
    ...(symbol.variant?.additionalPrimitives ?? []),
  ].flatMap((primitive): FilledRegion[] => {
    if (primitive.part && hidden.has(primitive.part)) return [];
    if (primitive.kind === "circle" && primitive.fillableBody)
      return [
        { kind: "circle", center: primitive.center, radius: primitive.radius },
      ];
    if (primitive.kind === "polygon" && primitive.fillableBody)
      return [{ kind: "polygon", points: primitive.points }];
    return [];
  });
}

/** Resolve capability independently of whether the instance is already filled. */
export function instanceSupportsBodyFill(
  instance: Instance,
  resolver: SymbolResolver,
): boolean {
  const symbol = resolveInstanceSymbol(resolver, instance);
  return !!symbol && fillableRegions(symbol).length > 0;
}

/** A declaration can survive a variant that hides all of its regions. */
export function symbolDeclaresBodyFill(symbol: SymbolDefinition): boolean {
  return [
    symbol.primitives,
    ...symbol.variants.map((variant) => variant.additionalPrimitives ?? []),
  ].some((primitives) =>
    primitives.some(
      (primitive) =>
        "fillableBody" in primitive && primitive.fillableBody === true,
    ),
  );
}

export function adaptiveFrameRegion(
  layout: NonNullable<ReturnType<typeof resolveAdaptiveSignalFlowBlockLayout>>,
): FilledRegion {
  const { x, y, width, height } = layout.body;
  const right = x + width;
  const bottom = y + height;
  const taper = height / 4;
  return layout.shape === "right-tapered-trapezoid"
    ? {
        kind: "polygon",
        points: [
          { x, y },
          { x: right, y: y + taper },
          { x: right, y: bottom - taper },
          { x, y: bottom },
        ],
      }
    : { kind: "rectangle", bounds: layout.body };
}

function resolvedInstanceFill(
  instance: Instance,
  resolver: SymbolResolver,
): ResolvedInstanceFill | undefined {
  const { bodyFill, styleOverride } = instance;
  if (!instance.placement || (!bodyFill && !styleOverride?.background))
    return undefined;
  const symbol = resolveInstanceSymbol(resolver, instance);
  if (!symbol) return undefined;
  if (bodyFill)
    return {
      regions: fillableRegions(symbol),
      color: bodyFill.kind === "background" ? "background" : bodyFill.color,
      legacy: false,
    };
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    symbol.definition,
    instance.signalFlowParameters,
  );
  return {
    regions: [
      adaptive
        ? adaptiveFrameRegion(adaptive)
        : { kind: "rectangle", bounds: symbol.definition.viewBox },
    ],
    color: styleOverride!.background!,
    legacy: true,
    ...(adaptive ? { adaptive: true } : {}),
  };
}

function regionContains(region: FilledRegion, point: DerivedPoint): boolean {
  switch (region.kind) {
    case "circle":
      return (
        (point.x - region.center.x) ** 2 + (point.y - region.center.y) ** 2 <=
        region.radius ** 2
      );
    case "rectangle": {
      const { x, y, width, height } = region.bounds;
      return (
        x <= point.x &&
        point.x <= x + width &&
        y <= point.y &&
        point.y <= y + height
      );
    }
    case "polygon": {
      // Match the SVG default nonzero winding rule. Edges are visible ink.
      let winding = 0;
      for (const [index, from] of region.points.entries()) {
        const to = region.points[(index + 1) % region.points.length]!;
        if (pointOnSegment(point, from, to)) return true;
        const side =
          (to.x - from.x) * (point.y - from.y) -
          (point.x - from.x) * (to.y - from.y);
        if (from.y <= point.y && to.y > point.y && side > 0) winding++;
        else if (from.y > point.y && to.y <= point.y && side < 0) winding--;
      }
      return winding !== 0;
    }
  }
}

type Occluder = {
  readonly rank: number;
  readonly regions: readonly FilledRegion[];
  readonly placement?: NonNullable<Instance["placement"]>;
};

export class ResolvedDrawingScene {
  readonly #ranks: ReadonlyMap<string, number>;
  readonly #occluders: readonly Occluder[];

  constructor(
    /** The actual order of paint items, from back to front. */
    readonly order: readonly DrawingOrderEntry[],
    readonly instanceFills: ReadonlyMap<string, ResolvedInstanceFill>,
    ranks: ReadonlyMap<string, number>,
    occluders: readonly Occluder[],
  ) {
    this.#ranks = ranks;
    this.#occluders = occluders;
  }

  rank(entry: DrawingOrderEntry): number {
    return this.#ranks.get(drawingOrderKey(entry)) ?? -1;
  }

  get hasOcclusion(): boolean {
    return this.#occluders.length > 0;
  }

  isEndpointVisibleAt(endpoint: RouteEndpoint, point: DerivedPoint): boolean {
    return this.isVisibleAt(
      endpoint.kind === "terminal"
        ? { kind: "instance", id: endpoint.instanceId }
        : { kind: "electrical" },
      point,
    );
  }

  /** True when no later opaque region covers the document-space point. */
  isVisibleAt(entry: DrawingOrderEntry, point: DerivedPoint): boolean {
    const index = this.rank(entry);
    return !this.#occluders.some(({ rank, regions, placement }) => {
      if (rank <= index) return false;
      const local = placement
        ? inverseTransformPoint(point, placement.position, placement)
        : point;
      return regions.some((region) => regionContains(region, local));
    });
  }
}

export function drawingHasOpaqueFill(document: SchematicDocument): boolean {
  return (
    document.instances.some(
      (instance) =>
        instance.placement &&
        (instance.bodyFill || instance.styleOverride?.background),
    ) ||
    (document.drafting?.objects ?? []).some(
      (object) => object.styleOverride?.fillColor,
    )
  );
}

/** The formal scene and all interaction targets use this same composition. */
export function resolveDrawingScene(
  document: SchematicDocument,
  resolver: SymbolResolver,
  objectIds?: ReadonlySet<string>,
): ResolvedDrawingScene {
  const order = resolveDrawingOrder(document);
  const ranks = new Map(
    order.map((entry, index) => [drawingOrderKey(entry), index]),
  );
  const rank = (entry: DrawingOrderEntry) =>
    ranks.get(drawingOrderKey(entry)) ?? -1;
  const instanceFills = new Map<string, ResolvedInstanceFill>();
  const occluders: Occluder[] = [];
  for (const instance of document.instances) {
    if (objectIds && !objectIds.has(instance.id)) continue;
    const fill = resolvedInstanceFill(instance, resolver);
    const placement = instance.placement;
    if (!fill || !placement) continue;
    instanceFills.set(instance.id, fill);
    if (fill.regions.length)
      occluders.push({
        rank: rank({ kind: "instance", id: instance.id }),
        regions: fill.regions,
        placement,
      });
  }
  for (const object of document.drafting?.objects ?? []) {
    if (objectIds && !objectIds.has(object.id)) continue;
    if (!object.styleOverride?.fillColor) continue;
    // Closed drafting shapes own their geometry directly; no wire lookup is
    // needed to place the face even when its separately drawn label is bound.
    if (object.kind !== "circle" && object.kind !== "rectangle") continue;
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "rectangle" && geometry.kind !== "circle") continue;
    const region: FilledRegion =
      geometry.kind === "rectangle"
        ? { kind: "polygon", points: geometry.corners }
        : { kind: "circle", center: geometry.center, radius: geometry.radius };
    occluders.push({
      rank: rank({ kind: "drafting", id: object.id }),
      regions: [region],
    });
  }

  return new ResolvedDrawingScene(order, instanceFills, ranks, occluders);
}
