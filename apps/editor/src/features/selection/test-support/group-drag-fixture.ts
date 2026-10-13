import { createRoutePath, type RouteEndpoint } from "@icm/model";
import { resolveEndpointPoint } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createDenseCopyPerformanceProject } from "../../clipboard/test-support/dense-copy-fixture";

export const GROUP_DRAG_COUNTS = {
  instances: 485,
  routes: 1538,
  junctions: 585,
  annotations: 485,
  movingInstances: 85,
} as const;

/** Topology-only load: a closed group with direct contacts, far from a large
 * independent background. No user drawing, model or simulated behavior. */
export function createGroupDragPerformanceProject() {
  const project = createDenseCopyPerformanceProject();
  project.name = "Group drag performance fixture";
  const document = project.documents[0]!;
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const movingIds: string[] = [];
  for (let tile = 0; tile < 17; tile++) {
    const origin = {
      x: 10000 + (tile % 5) * 600,
      y: 10000 + Math.floor(tile / 5) * 300,
    };
    const netId = `moving-net-${tile}`;
    const terminals = [];
    for (let index = 0; index < 5; index++) {
      const id = `RM${tile * 5 + index + 1}`;
      movingIds.push(id);
      const position = { x: origin.x + index * 80, y: origin.y };
      document.instances.push({
        id,
        reference: id,
        symbolId: "resistor",
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
      terminals.push(
        { instanceId: id, pinName: "1" },
        { instanceId: id, pinName: "2" },
      );
    }
    document.nets.push({ id: netId, terminals });
    const contact = resolveEndpointPoint(document, resolver, {
      kind: "terminal",
      ...terminals[1]!,
    })!;
    const junctions = Array.from({ length: 5 }, (_, index) => ({
      id: `moving-J${tile}-${index}`,
      netId,
      position:
        index === 0 ? contact : { x: origin.x + index * 60, y: origin.y + 160 },
    }));
    document.junctions.push(...junctions);
    const endpoints: RouteEndpoint[] = [
      ...terminals.map((t) => ({ kind: "terminal" as const, ...t })),
      ...junctions.map((j) => ({
        kind: "junction" as const,
        junctionId: j.id,
      })),
    ];
    for (let edge = 0; edge < endpoints.length - 1; edge++) {
      const start = endpoints[edge]!,
        end = endpoints[edge + 1]!;
      const from = resolveEndpointPoint(document, resolver, start)!;
      const to = resolveEndpointPoint(document, resolver, end)!;
      const bends =
        from.x === to.x || from.y === to.y ? [] : [{ x: to.x, y: from.y }];
      document.routes.push(
        createRoutePath({
          id: `moving-wire-${tile}-${edge}`,
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
  return { project, movingIds };
}
