import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
  type RouteEndpoint,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { resolveEndpointPoint } from "../endpoint.js";

export const LARGE_PERFORMANCE_FIXTURE_COUNTS = {
  instances: 260,
  nets: 176,
  routes: 580,
  junctions: 232,
  annotations: 264,
} as const;

/**
 * Deterministic synthetic load matching the current large user-project order
 * of magnitude. It is intentionally generated instead of storing a megabyte
 * of opaque fixture JSON and contains no user circuit data.
 */
export function createLargePerformanceFixture(
  resolver: SymbolResolver,
): CircuitProject {
  const project = createEmptyProject(
    "performance-large",
    "Deterministic performance fixture",
  );
  const document = project.documents[0]!;
  const counts = LARGE_PERFORMANCE_FIXTURE_COUNTS;

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
    document.nets.push({
      id: `net-${String(index).padStart(3, "0")}`,
      terminals: [],
    });
  }
  const terminalNumber = counts.instances * 2;
  for (let index = 0; index < terminalNumber; index += 1) {
    const instanceIndex = Math.floor(index / 2);
    document.nets[index % counts.nets]!.terminals.push({
      instanceId: document.instances[instanceIndex]!.id,
      pinName: index % 2 === 0 ? "1" : "2",
    });
  }
  for (let index = 0; index < counts.nets; index += 1) {
    const net = document.nets[index]!;
    document.connectivityEvidence.push({
      id: `source-${net.id}`,
      kind: "spice-source",
      netId: net.id,
      sourceNetId: `source-${String(index).padStart(3, "0")}`,
    });
  }

  for (let index = 0; index < counts.junctions; index += 1) {
    const net = document.nets[index % counts.nets]!;
    document.junctions.push({
      id: `J${String(index + 1).padStart(3, "0")}`,
      netId: net.id,
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
    const end = endpoints[(index * 3 + 1) % endpoints.length]!;
    const safeEnd =
      end === start ? endpoints[(index + 1) % endpoints.length]! : end;
    const from = resolveEndpointPoint(document, resolver, start)!;
    const to = resolveEndpointPoint(document, resolver, safeEnd)!;
    const bend =
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
        end: safeEnd,
        bends: bend,
        modes: Array.from({ length: bend.length + 1 }, () => "manual"),
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
