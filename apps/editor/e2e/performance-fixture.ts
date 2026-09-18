import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
  type RouteEndpoint,
} from "@icm/model";
import { resolveEndpointPoint } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

/**
 * Same order of magnitude as
 * `packages/derived/src/test-support/large-performance-fixture.ts`, which is the
 * scale the 2026-09-02 latency audit sampled (260 instances / 176 Nets /
 * 580 routes / 232 junctions / 264 annotations). Kept here as an independent
 * generator so the browser benchmark does not reach into another package's
 * test-support build output; only public `@icm/*` APIs are used. If that
 * fixture's scale changes, change this one with it.
 */
export const BROWSER_PERFORMANCE_COUNTS = {
  instances: 260,
  nets: 176,
  routes: 580,
  junctions: 232,
  annotations: 264,
} as const;

export function createBrowserPerformanceProject(): CircuitProject {
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const project = createEmptyProject(
    "browser-performance",
    "Browser performance fixture",
  );
  const document = project.documents[0]!;
  const counts = BROWSER_PERFORMANCE_COUNTS;

  for (let index = 0; index < counts.instances; index += 1) {
    document.instances.push({
      id: `R${String(index + 1).padStart(3, "0")}`,
      reference: `R${index + 1}`,
      symbolId: "resistor",
      placement: {
        position: {
          x: 100 + (index % 20) * 80,
          y: 100 + Math.floor(index / 20) * 80,
        },
        rotation: index % 2 === 0 ? 0 : 90,
        mirror: "none",
      },
    });
  }

  for (let index = 0; index < counts.nets; index += 1) {
    const net = {
      id: `net-${String(index).padStart(3, "0")}`,
      terminals: [] as {
        instanceId: string;
        pinName: string;
      }[],
    };
    document.nets.push(net);
    document.connectivityEvidence.push({
      id: `source-${net.id}`,
      kind: "spice-source",
      netId: net.id,
      sourceNetId: `source-${String(index).padStart(3, "0")}`,
    });
  }
  for (let index = 0; index < counts.instances * 2; index += 1) {
    document.nets[index % counts.nets]!.terminals.push({
      instanceId: document.instances[Math.floor(index / 2)]!.id,
      pinName: index % 2 === 0 ? "1" : "2",
    });
  }

  for (let index = 0; index < counts.junctions; index += 1) {
    document.junctions.push({
      id: `J${String(index + 1).padStart(3, "0")}`,
      netId: document.nets[index % counts.nets]!.id,
      position: {
        x: 70 + (index % 29) * 60,
        y: 60 + Math.floor(index / 29) * 130,
      },
      role: index % 5 === 0 ? "route-anchor" : "branch",
    });
  }

  const endpointsByNetId = new Map<string, RouteEndpoint[]>();
  for (const net of document.nets) {
    endpointsByNetId.set(net.id, [
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
    ]);
  }
  for (let index = 0; index < counts.routes; index += 1) {
    const net = document.nets[index % counts.nets]!;
    const endpoints = endpointsByNetId.get(net.id)!;
    const start = endpoints[index % endpoints.length]!;
    const proposed = endpoints[(index * 3 + 1) % endpoints.length]!;
    const end =
      proposed === start
        ? endpoints[(index + 1) % endpoints.length]!
        : proposed;
    const from = resolveEndpointPoint(document, resolver, start)!;
    const to = resolveEndpointPoint(document, resolver, end)!;
    const bends =
      from.x === to.x || from.y === to.y
        ? []
        : index % 2 === 0
          ? [{ x: to.x, y: from.y }]
          : [{ x: from.x, y: to.y }];
    document.routes.push(
      createRoutePath({
        id: `route-${String(index).padStart(3, "0")}`,
        netId: net.id,
        start,
        end,
        bends,
        modes: bends.map(() => "manual" as const).concat("manual"),
      }),
    );
  }

  for (let index = 0; index < counts.annotations; index += 1) {
    document.annotations.push({
      id: `annotation-${String(index).padStart(3, "0")}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: `M${index + 1}` }] },
      anchor: {
        kind: "free",
        position: {
          x: 80 + (index % 22) * 75,
          y: 70 + Math.floor(index / 22) * 75,
        },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
  }

  return project;
}
