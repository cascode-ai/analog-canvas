import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
  type RouteEndpoint,
} from "@icm/model";
import { resolveEndpointPoint } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

export const DENSE_COPY_COUNTS = {
  instances: 400,
  routes: 1300,
  junctions: 500,
  annotations: 400,
} as const;

/**
 * Deterministic topology-only load, not a simulated circuit. Isolated tiles
 * carry MOS hidden bodies, owner-bound labels and internal routed geometry.
 * No private drawing or existing release benchmark is used or replaced.
 */
export function createDenseCopyPerformanceProject(): CircuitProject {
  const project = createEmptyProject(
    "dense-copy",
    "Dense copy performance fixture",
  );
  const document = project.documents[0]!;
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  for (let tile = 0; tile < 100; tile++) {
    const origin = {
      x: 100 + (tile % 10) * 500,
      y: 150 + Math.floor(tile / 10) * 500,
    };
    const netId = `net-${tile}`;
    const terminals: { instanceId: string; pinName: string }[] = [];
    for (const [index, symbolId] of [
      "resistor",
      "resistor",
      "nmos",
      "pmos",
    ].entries()) {
      const id = `${symbolId === "resistor" ? "R" : "M"}${tile * 4 + index + 1}`;
      const position = { x: origin.x + index * 80, y: origin.y };
      document.instances.push({
        id,
        reference: id,
        symbolId,
        placement: { position, rotation: 0, mirror: "none" },
      });
      document.annotations.push({
        id: `label-${id}`,
        kind: "instance-label",
        binding: { kind: "instance-reference", instanceId: id },
        anchor: {
          kind: "object",
          objectId: id,
          localOffset: { x: 20, y: 0 },
          fallbackPosition: { x: position.x + 20, y: position.y },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      for (const pin of resolver.resolve(symbolId)!.definition.pins) {
        if (pin.name === "B") {
          document.noConnects.push({
            id: `nc-${id}`,
            endpoint: { kind: "terminal", instanceId: id, pinName: "B" },
          });
        } else terminals.push({ instanceId: id, pinName: pin.name });
      }
    }
    document.nets.push({ id: netId, terminals });
    const junctions = Array.from({ length: 5 }, (_, index) => ({
      id: `J${tile}-${index}`,
      netId,
      position: { x: origin.x + index * 60, y: origin.y + 150 },
      role: "branch" as const,
    }));
    document.junctions.push(...junctions);
    const endpoints: RouteEndpoint[] = [
      ...terminals
        .slice(0, 9)
        .map((terminal) => ({ kind: "terminal" as const, ...terminal })),
      ...junctions.map((junction) => ({
        kind: "junction" as const,
        junctionId: junction.id,
      })),
    ];
    for (let edge = 0; edge < 13; edge++) {
      const start = endpoints[edge]!;
      const end = endpoints[edge + 1]!;
      const from = resolveEndpointPoint(document, resolver, start)!;
      const to = resolveEndpointPoint(document, resolver, end)!;
      const bends =
        from.x === to.x || from.y === to.y ? [] : [{ x: to.x, y: from.y }];
      document.routes.push(
        createRoutePath({
          id: `route-${tile}-${edge}`,
          netId,
          start,
          end,
          bends,
          modes: Array.from(
            { length: bends.length + 1 },
            () => "manual" as const,
          ),
        }),
      );
    }
  }
  return project;
}
