import { describe, expect, it } from "vitest";
import { expandRouteGraph } from "../src/index.js";
import type { RouteGraph, ResolvedEndpoint } from "../src/index.js";
import { routeEnd, type RouteEndpoint, type Point } from "@icm/model";

function endpoint(
  id: string,
  x: number,
  y: number,
  ep: RouteEndpoint,
): ResolvedEndpoint {
  return {
    id,
    endpoint: ep,
    point: { x, y },
    outward: ep.kind === "terminal" ? { x: 0, y: -1 } : null,
  };
}

function input(endpoints: ResolvedEndpoint[]) {
  return {
    endpoints: new Map(endpoints.map((e) => [e.id, e])),
    existingRoutePaths: [],
    instanceBoxes: [],
  };
}

const term = (
  id: string,
  x: number,
  y: number,
  instanceId: string,
  pinName: string,
): ResolvedEndpoint =>
  endpoint(id, x, y, { kind: "terminal", instanceId, pinName });

const baseGraph = (overrides: Partial<RouteGraph>): RouteGraph => ({
  documentId: "doc",
  revision: 0,
  netId: "net-1",
  nodes: [],
  edges: [],
  ...overrides,
});

describe("expandRouteGraph", () => {
  it("emits set_route_path (not route_orthogonal) for an aligned escape edge", () => {
    // terminal at (100,200) northward; tap at (100,100) — axis-aligned (same x).
    const graph = baseGraph({
      nodes: [
        {
          id: "a",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
        },
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
      ],
      edges: [{ id: "e0", from: "a", to: "tap0", role: "escape" }],
    });
    const result = expandRouteGraph(
      graph,
      input([term("a", 100, 200, "M1", "D")]),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.edits).toHaveLength(2); // add_junction + set_route_path
    expect(result.edits[0]!.kind).toBe("add_junction");
    expect(result.edits[1]!.kind).toBe("set_route_path");
    expect(result.metrics.routeCount).toBe(1);
    expect(result.metrics.junctionCount).toBe(1);
  });

  it("returns MISALIGNED_EDGE when an escape edge is not axis-aligned", () => {
    // terminal at (100,200), tap at (200,100) — diagonal, not aligned.
    const graph = baseGraph({
      nodes: [
        {
          id: "a",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
        },
        { id: "tap0", role: "tap", at: { x: 200, y: 100 } },
      ],
      edges: [{ id: "e0", from: "a", to: "tap0", role: "escape" }],
    });
    const result = expandRouteGraph(
      graph,
      input([term("a", 100, 200, "M1", "D")]),
    );
    expect(result.conflicts.some((c) => c.code === "MISALIGNED_EDGE")).toBe(
      true,
    );
  });

  it("returns ESCAPE_DIRECTION when escape goes against the terminal outward", () => {
    // terminal at (100,200) outward (0,-1)=north; tap at (100,300) — south.
    const graph = baseGraph({
      nodes: [
        {
          id: "a",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
        },
        { id: "tap0", role: "tap", at: { x: 100, y: 300 } },
      ],
      edges: [{ id: "e0", from: "a", to: "tap0", role: "escape" }],
    });
    const result = expandRouteGraph(
      graph,
      input([term("a", 100, 200, "M1", "D")]),
    );
    expect(result.conflicts.some((c) => c.code === "ESCAPE_DIRECTION")).toBe(
      true,
    );
  });

  it("snaps tap positions to the 10-unit grid", () => {
    const graph = baseGraph({
      nodes: [
        {
          id: "a",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
        },
        { id: "tap0", role: "tap", at: { x: 100, y: 93 } },
      ],
      edges: [{ id: "e0", from: "a", to: "tap0", role: "escape" }],
    });
    const result = expandRouteGraph(
      graph,
      input([term("a", 100, 200, "M1", "D")]),
    );
    expect(result.conflicts).toEqual([]);
    const junction = result.edits.find((e) => e.kind === "add_junction")!;
    if (junction.kind !== "add_junction") return;
    expect(junction.position.x % 10).toBe(0);
    expect(junction.position.y % 10).toBe(0);
  });

  it("emits a trunk edge as set_route_path with trunk mode when axis-aligned", () => {
    const graph = baseGraph({
      nodes: [
        { id: "tap0", role: "tap", at: { x: 200, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 200, y: 300 } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(result.conflicts).toEqual([]);
    const route = result.edits.find((e) => e.kind === "set_route_path")!;
    if (route.kind !== "set_route_path") return;
    expect(route.route.legs.map((leg) => leg.mode)).toEqual(["trunk"]);
    expect(route.route.start).toEqual({ kind: "junction", junctionId: "tap0" });
    expect(routeEnd(route.route)).toEqual({
      kind: "junction",
      junctionId: "tap1",
    });
  });

  it("accepts a 45-degree trunk edge through the shared octilinear contract", () => {
    const graph = baseGraph({
      nodes: [
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 200, y: 200 } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(result.conflicts).toEqual([]);
    expect(result.resolvedGeometry[0]?.points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
  });

  it("returns MISALIGNED_EDGE for a non-octilinear trunk edge", () => {
    const graph = baseGraph({
      nodes: [
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 200, y: 300 } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(result.conflicts.some((c) => c.code === "MISALIGNED_EDGE")).toBe(
      true,
    );
    expect(result.edits).toEqual([]);
    expect(result.resolvedGeometry).toEqual([]);
  });

  it("returns no partial edits when a later edge conflicts", () => {
    const graph = baseGraph({
      nodes: [
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 200, y: 100 } },
        { id: "tap2", role: "tap", at: { x: 300, y: 300 } },
      ],
      edges: [
        { id: "valid", from: "tap0", to: "tap1", role: "trunk" },
        { id: "invalid", from: "tap1", to: "tap2", role: "trunk" },
      ],
    });

    const result = expandRouteGraph(graph, input([]));

    expect(result.conflicts.some((c) => c.code === "MISALIGNED_EDGE")).toBe(
      true,
    );
    expect(result.edits).toEqual([]);
    expect(result.generatedObjectIds).toEqual([]);
    expect(result.metrics.routeCount).toBe(0);
  });

  it("emits a label edge as a net-label annotation", () => {
    const graph = baseGraph({
      nodes: [{ id: "tap0", role: "tap", at: { x: 200, y: 200 } }],
      edges: [
        {
          id: "lbl0",
          from: "tap0",
          to: "tap0",
          role: "label",
          label: { text: "VOUT" },
        },
      ],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(result.conflicts).toEqual([]);
    const ann = result.edits.find(
      (e) => e.kind === "upsert_schematic_annotation",
    )!;
    if (ann.kind !== "upsert_schematic_annotation") return;
    expect(ann.annotation.kind).toBe("net-label");
    expect(ann.annotation.content).toEqual({
      runs: [{ kind: "text", value: "VOUT" }],
    });
    expect(ann.annotation.netId).toBe("net-1");
  });

  it("returns MISSING_ENDPOINT when an endpoint node is absent from the input", () => {
    const graph = baseGraph({
      nodes: [
        {
          id: "ghost",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "MX", pinName: "D" },
        },
        { id: "tap0", role: "tap", at: { x: 200, y: 200 } },
      ],
      edges: [{ id: "e0", from: "ghost", to: "tap0", role: "escape" }],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(result.conflicts.some((c) => c.code === "MISSING_ENDPOINT")).toBe(
      true,
    );
  });

  it("returns MISSING_NODE_POSITION when a tap has no at/alignWith (no median guess)", () => {
    const graph = baseGraph({
      nodes: [{ id: "tap0", role: "tap" }],
      edges: [],
    });
    const result = expandRouteGraph(graph, input([]));
    expect(
      result.conflicts.some((c) => c.code === "MISSING_NODE_POSITION"),
    ).toBe(true);
    expect(result.metrics.junctionCount).toBe(0);
  });

  it("reports WIRE_THROUGH_SYMBOL when a segment crosses an instance box", () => {
    const graph = baseGraph({
      nodes: [
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 300, y: 100 } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    });
    const inp = {
      endpoints: new Map(),
      existingRoutePaths: [],
      instanceBoxes: [
        { instanceId: "M1", min: { x: 180, y: 80 }, max: { x: 220, y: 120 } },
      ],
    };
    const result = expandRouteGraph(graph, inp);
    expect(result.conflicts.some((c) => c.code === "WIRE_THROUGH_SYMBOL")).toBe(
      true,
    );
    expect(result.edits).toEqual([]);
  });

  it("is deterministic: same graph + input yields identical output", () => {
    const graph = baseGraph({
      nodes: [
        {
          id: "a",
          role: "endpoint",
          endpoint: { kind: "terminal", instanceId: "M1", pinName: "D" },
        },
        { id: "tap0", role: "tap", alignWith: "a", axis: "y", offset: 100 },
      ],
      edges: [{ id: "e0", from: "a", to: "tap0", role: "escape" }],
    });
    const inp = input([term("a", 100, 200, "M1", "D")]);
    const first = expandRouteGraph(graph, inp);
    const second = expandRouteGraph(graph, inp);
    expect(second).toEqual(first);
  });
});

void (null as unknown as Point);
