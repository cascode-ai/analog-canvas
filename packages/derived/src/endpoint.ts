import { isGridAlignedCoordinate, transformPoint } from "@icm/model";
import type {
  DerivedPoint,
  GridPoint,
  Net,
  RouteEndpoint,
  SchematicDocument,
  SymbolLocalPoint,
} from "@icm/model";
import { resolveSignalFlowPinAt, type SymbolResolver } from "@icm/symbols";
import { mosBulkShouldBeVisible } from "./mos-bulk.js";

export interface EndpointRoutingGeometry {
  /** Exact transformed artwork contact used by render and pointer hit. */
  contactPoint: DerivedPoint;
  /** Persistable page-grid point used by every routing mutator. */
  gridLanding: GridPoint;
  /** Read-only contact-to-grid lead; empty when contact and landing coincide. */
  escapePath: readonly DerivedPoint[];
  /** Transformed terminal direction; Junctions have no outward direction. */
  outward: DerivedPoint | null;
}

export interface EndpointConnection extends EndpointRoutingGeometry {
  endpoint: RouteEndpoint;
}

interface ResolvedPinGeometry {
  at: SymbolLocalPoint;
  direction: "north" | "east" | "south" | "west";
  routing?: {
    escape: "outward";
    preferredLanding?: SymbolLocalPoint | undefined;
  };
}

export interface EndpointObjectLookup {
  readonly instancesById: ReadonlyMap<
    string,
    SchematicDocument["instances"][number]
  >;
  readonly junctionsById: ReadonlyMap<
    string,
    SchematicDocument["junctions"][number]
  >;
}

function samePoint(left: DerivedPoint, right: DerivedPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function resolvedTerminalPin(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: Extract<RouteEndpoint, { kind: "terminal" }>,
  lookup?: EndpointObjectLookup,
): {
  instance: SchematicDocument["instances"][number] & {
    placement: NonNullable<SchematicDocument["instances"][number]["placement"]>;
  };
  pin: ResolvedPinGeometry;
} | null {
  const instance =
    lookup?.instancesById.get(endpoint.instanceId) ??
    document.instances.find(
      (candidate) => candidate.id === endpoint.instanceId,
    );
  if (!instance?.placement) return null;
  const symbol = resolver.resolve(instance.symbolId, instance.symbolVariantId);
  const basePin = symbol?.definition.pins.find(
    (candidate) => candidate.name === endpoint.pinName,
  );
  if (!basePin) return null;
  const auxiliary = symbol?.variant?.auxiliaryPins?.find(
    (candidate) => candidate.name === endpoint.pinName,
  );
  const selected = auxiliary ?? basePin;
  return {
    instance: { ...instance, placement: instance.placement },
    pin: {
      at: auxiliary
        ? selected.at
        : resolveSignalFlowPinAt(
            symbol!.definition,
            basePin,
            instance.signalFlowParameters,
          ),
      direction: selected.direction,
      ...(selected.routing ? { routing: selected.routing } : {}),
    },
  };
}

/**
 * Resolve one endpoint across the symbol/derived/grid boundary. This is the
 * only entry point mutation planners may use for terminal geometry: artwork
 * contact remains exact, while every persisted Junction or waypoint uses the
 * grid landing.
 */
export function resolveEndpointConnection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
  lookup?: EndpointObjectLookup,
): EndpointConnection | null {
  if (endpoint.kind === "junction") {
    const position = (
      lookup?.junctionsById.get(endpoint.junctionId) ??
      document.junctions.find((junction) => junction.id === endpoint.junctionId)
    )?.position;
    return position
      ? {
          endpoint,
          contactPoint: position,
          gridLanding: position,
          escapePath: [],
          outward: null,
        }
      : null;
  }

  const resolved = resolvedTerminalPin(document, resolver, endpoint, lookup);
  if (!resolved) return null;
  const { instance, pin } = resolved;
  const contactPoint = transformPoint(
    pin.at,
    instance.placement.position,
    instance.placement,
  );
  const localLanding = pin.routing?.preferredLanding ?? pin.at;
  const landing = transformPoint(
    localLanding,
    instance.placement.position,
    instance.placement,
  );
  const localDirection = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
  }[pin.direction];
  const outward = transformPoint(
    localDirection,
    { x: 0, y: 0 },
    instance.placement,
  );
  const grid = document.presentation.grid;
  const gridLanding: GridPoint | null = (() => {
    if (
      isGridAlignedCoordinate(landing.x, grid) &&
      isGridAlignedCoordinate(landing.y, grid)
    ) {
      return { x: landing.x, y: landing.y };
    }
    if (outward.x !== 0 && isGridAlignedCoordinate(landing.y, grid)) {
      return {
        x:
          (outward.x > 0
            ? Math.ceil(landing.x / grid)
            : Math.floor(landing.x / grid)) * grid,
        y: landing.y,
      };
    }
    if (outward.y !== 0 && isGridAlignedCoordinate(landing.x, grid)) {
      return {
        x: landing.x,
        y:
          (outward.y > 0
            ? Math.ceil(landing.y / grid)
            : Math.floor(landing.y / grid)) * grid,
      };
    }
    return null;
  })();
  if (!gridLanding) return null;
  return {
    endpoint,
    contactPoint,
    gridLanding,
    escapePath: samePoint(contactPoint, gridLanding)
      ? []
      : [contactPoint, gridLanding],
    outward,
  };
}

export function endpointKey(endpoint: RouteEndpoint): string {
  switch (endpoint.kind) {
    case "terminal":
      return `terminal:${endpoint.instanceId}:${endpoint.pinName}`;
    case "junction":
      return `junction:${endpoint.junctionId}`;
  }
}

export function endpointsEqual(
  left: RouteEndpoint,
  right: RouteEndpoint,
): boolean {
  return endpointKey(left) === endpointKey(right);
}

/**
 * Returns whether an endpoint participates in the visible wiring graph.
 * Electrical Net membership is intentionally not consulted or mutated here.
 * A variant-hidden pin is an implicit presentation terminal. A base
 * `conditional` pin stays visible until a context-aware policy explicitly
 * proves that hiding it is safe.
 */
export function isVisibleEndpoint(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
  lookup?: EndpointObjectLookup,
): boolean {
  if (endpoint.kind !== "terminal") return true;
  const instance =
    lookup?.instancesById.get(endpoint.instanceId) ??
    document.instances.find(
      (candidate) => candidate.id === endpoint.instanceId,
    );
  if (!instance) return false;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return false;
  if (resolved.variant?.hiddenPinNames.includes(endpoint.pinName)) {
    return Boolean(
      endpoint.pinName === "B" &&
      resolved.variant.auxiliaryPins?.some((pin) => pin.name === "B") &&
      mosBulkShouldBeVisible(document, instance),
    );
  }
  const pin = resolved.definition.pins.find(
    (candidate) => candidate.name === endpoint.pinName,
  );
  return pin !== undefined && pin.presentation.visibility !== "implicit";
}

export function resolveEndpointPoint(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
  lookup?: EndpointObjectLookup,
): DerivedPoint | null {
  return (
    resolveEndpointConnection(document, resolver, endpoint, lookup)
      ?.contactPoint ?? null
  );
}

export function resolveEndpointOutwardDirection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
  lookup?: EndpointObjectLookup,
): DerivedPoint | null {
  return (
    resolveEndpointConnection(document, resolver, endpoint, lookup)?.outward ??
    null
  );
}

export function endpointBelongsToNet(
  document: SchematicDocument,
  net: Net,
  endpoint: RouteEndpoint,
): boolean {
  switch (endpoint.kind) {
    case "terminal":
      return net.terminals.some(
        (terminal) =>
          terminal.instanceId === endpoint.instanceId &&
          terminal.pinName === endpoint.pinName,
      );
    case "junction":
      return document.junctions.some(
        (junction) =>
          junction.id === endpoint.junctionId && junction.netId === net.id,
      );
  }
}

export function netEndpoints(
  document: SchematicDocument,
  net: Net,
): RouteEndpoint[] {
  return [
    ...net.terminals.map((terminal): RouteEndpoint => ({
      kind: "terminal",
      ...terminal,
    })),
    ...document.junctions
      .filter((junction) => junction.netId === net.id)
      .map((junction): RouteEndpoint => ({
        kind: "junction",
        junctionId: junction.id,
      })),
  ].sort((left, right) =>
    endpointKey(left).localeCompare(endpointKey(right), "en"),
  );
}
