// End-to-end behavioral verification: expandRouteGraph → executeTransaction
// → actual Route geometry matches resolvedGeometry.
//
// This is the critical consistency test the original implementation failed:
// the helper reported [from, to] but the Engine stored a different polyline
// (because it called route_orthogonal internally). Now every edge is a
// set_route_path with explicit bends, so the geometry must match exactly.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "@icm/project-protocol";
import {
  resolveEndpointPoint,
  resolveEndpointOutwardDirection,
  resolveRouteGeometry,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { executeTransaction } from "@icm/edit-engine";
import { describe, expect, it } from "vitest";

import { expandRouteGraph } from "../src/index.js";
import type { RouteGraph } from "../src/index.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function transaction(documentId: string, revision: number, edits: unknown[]) {
  return {
    transactionId: `graph-${revision}-${edits.length}`,
    documentId,
    expectedRevision: revision,
    actor: { kind: "agent" as const, id: "integration-test" },
    edits,
  };
}

// Reuse the Phase 3 routing fixture — it has placed instances A and B with
// terminals on net-h.
function documentFixture() {
  return parseProject(
    readFileSync(
      resolve(process.cwd(), "fixtures/projects/port-nets/project.icproj.json"),
      "utf8",
    ),
  ).documents[0]!;
}

const terminal = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "P",
});

describe("expandRouteGraph → transact → actual geometry consistency", () => {
  it("resolvedGeometry matches the Engine's stored polyline for a trunk edge", () => {
    // Two taps on the same x, connected by a trunk. The helper should
    // report exactly [from, to] and the Engine should store exactly that.
    const doc = documentFixture();
    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "tap0", role: "tap", at: { x: 100, y: 100 } },
        { id: "tap1", role: "tap", at: { x: 100, y: 300 } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    };
    const expansion = expandRouteGraph(graph, {
      endpoints: new Map(),
      existingRoutePaths: [],
      instanceBoxes: [],
    });

    expect(expansion.conflicts).toEqual([]);
    expect(expansion.edits.some((e) => e.kind === "route_orthogonal")).toBe(
      false,
    );

    const result = executeTransaction(
      doc,
      transaction(doc.id, 0, expansion.edits),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const route = result.document.routes[0]!;
    const actualPolyline = resolveRouteGeometry(
      result.document,
      resolver,
      route,
    )?.centerline;
    const reportedPolyline = expansion.resolvedGeometry[0]!.points;

    expect(actualPolyline).toEqual(reportedPolyline);
  });

  it("resolvedGeometry matches for an escape edge (terminal → tap, axis-aligned)", () => {
    // Instance A at (180,300), pin P1 at (160,300), outward west (-1,0).
    // Tap at (100,300) — same y, so axis-aligned.
    const doc = documentFixture();
    const epA = terminal("A");
    const pointA = resolveEndpointPoint(doc, resolver, epA)!;
    const outwardA = resolveEndpointOutwardDirection(doc, resolver, epA);

    // Place a tap aligned with A on y, in the pin's outward direction.
    const tapX = pointA.x + 80;
    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "epA", role: "endpoint", endpoint: epA },
        { id: "tapA", role: "tap", at: { x: tapX, y: pointA.y } },
      ],
      edges: [{ id: "esc0", from: "epA", to: "tapA", role: "escape" }],
    };

    const expansion = expandRouteGraph(graph, {
      endpoints: new Map([
        ["epA", { id: "epA", endpoint: epA, point: pointA, outward: outwardA }],
      ]),
      existingRoutePaths: [],
      instanceBoxes: [],
    });

    expect(expansion.conflicts).toEqual([]);
    expect(expansion.edits.some((e) => e.kind === "route_orthogonal")).toBe(
      false,
    );

    const result = executeTransaction(
      doc,
      transaction(doc.id, 0, expansion.edits),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const route = result.document.routes[0]!;
    const actualPolyline = resolveRouteGeometry(
      result.document,
      resolver,
      route,
    )?.centerline;
    const reportedPolyline = expansion.resolvedGeometry[0]!.points;

    expect(actualPolyline).toEqual(reportedPolyline);
  });

  it("diagonal escape edge is rejected with MISALIGNED_EDGE, no edits produced for it", () => {
    const doc = documentFixture();
    const epA = terminal("A");
    const pointA = resolveEndpointPoint(doc, resolver, epA)!;
    const outwardA = resolveEndpointOutwardDirection(doc, resolver, epA);

    // Tap NOT on the same x or y — diagonal.
    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "epA", role: "endpoint", endpoint: epA },
        {
          id: "tapA",
          role: "tap",
          at: { x: pointA.x + 200, y: pointA.y - 100 },
        },
      ],
      edges: [{ id: "esc0", from: "epA", to: "tapA", role: "escape" }],
    };

    const expansion = expandRouteGraph(graph, {
      endpoints: new Map([
        ["epA", { id: "epA", endpoint: epA, point: pointA, outward: outwardA }],
      ]),
      existingRoutePaths: [],
      instanceBoxes: [],
    });

    expect(expansion.conflicts.some((c) => c.code === "MISALIGNED_EDGE")).toBe(
      true,
    );
    // The junction is still created (node position is valid), but the route edit is NOT.
    expect(
      expansion.edits.filter((e) => e.kind === "set_route_path"),
    ).toHaveLength(0);
  });

  it("escape against pin outward direction is rejected with ESCAPE_DIRECTION", () => {
    const doc = documentFixture();
    const epA = terminal("A");
    const pointA = resolveEndpointPoint(doc, resolver, epA)!;
    const outwardA = resolveEndpointOutwardDirection(doc, resolver, epA);

    // Tap in the OPPOSITE direction of outward.
    const oppositePoint = {
      x: pointA.x - (outwardA?.x ?? 0) * 80,
      y: pointA.y - (outwardA?.y ?? 0) * 80,
    };
    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "epA", role: "endpoint", endpoint: epA },
        { id: "tapA", role: "tap", at: oppositePoint },
      ],
      edges: [{ id: "esc0", from: "epA", to: "tapA", role: "escape" }],
    };

    const expansion = expandRouteGraph(graph, {
      endpoints: new Map([
        ["epA", { id: "epA", endpoint: epA, point: pointA, outward: outwardA }],
      ]),
      existingRoutePaths: [],
      instanceBoxes: [],
    });

    expect(expansion.conflicts.some((c) => c.code === "ESCAPE_DIRECTION")).toBe(
      true,
    );
    expect(
      expansion.edits.filter((e) => e.kind === "set_route_path"),
    ).toHaveLength(0);
  });

  it("wire-through-symbol is detected when a segment crosses an instance box", () => {
    // Two taps connected by a trunk that passes through a known instance.
    const doc = documentFixture();
    const epA = terminal("A");
    const pointA = resolveEndpointPoint(doc, resolver, epA)!;

    // Tap0 and tap1 span across instance A's body.
    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "tap0", role: "tap", at: { x: pointA.x - 60, y: pointA.y } },
        { id: "tap1", role: "tap", at: { x: pointA.x + 60, y: pointA.y } },
      ],
      edges: [{ id: "trunk0", from: "tap0", to: "tap1", role: "trunk" }],
    };

    // Build instanceBoxes from the document's placed instances.
    const instanceBoxes = doc.instances
      .filter((inst) => inst.placement)
      .map((inst) => {
        const resolved = resolver.resolve(inst.symbolId, inst.symbolVariantId);
        if (!resolved) return null;
        const box = resolved.definition.viewBox;
        return {
          instanceId: inst.id,
          min: {
            x: inst.placement!.position.x + box.x,
            y: inst.placement!.position.y + box.y,
          },
          max: {
            x: inst.placement!.position.x + box.x + box.width,
            y: inst.placement!.position.y + box.y + box.height,
          },
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);

    const expansion = expandRouteGraph(graph, {
      endpoints: new Map(),
      existingRoutePaths: [],
      instanceBoxes,
    });

    expect(
      expansion.conflicts.some((c) => c.code === "WIRE_THROUGH_SYMBOL"),
    ).toBe(true);
  });

  it("no edit in the output is ever route_orthogonal", () => {
    // A complex graph with escape + trunk + link edges.
    const doc = documentFixture();
    const epA = terminal("A");
    const pointA = resolveEndpointPoint(doc, resolver, epA)!;
    const outwardA = resolveEndpointOutwardDirection(doc, resolver, epA);

    const graph: RouteGraph = {
      documentId: doc.id,
      revision: 0,
      netId: "net-h",
      nodes: [
        { id: "epA", role: "endpoint", endpoint: epA },
        {
          id: "tap0",
          role: "tap",
          at: {
            x: pointA.x + (outwardA?.x ?? 0) * 80,
            y: pointA.y + (outwardA?.y ?? 0) * 80,
          },
        },
        {
          id: "tap1",
          role: "tap",
          at: {
            x: pointA.x + (outwardA?.x ?? 0) * 80,
            // Use an absolute vertical offset so the trunk edge has real
            // length even when the terminal's outward direction is purely
            // horizontal (outward.y === 0); otherwise tap0 and tap1 collapse
            // to the same point and the trunk becomes a zero-length segment.
            y: pointA.y + 200,
          },
        },
      ],
      edges: [
        { id: "esc0", from: "epA", to: "tap0", role: "escape" },
        { id: "trunk0", from: "tap0", to: "tap1", role: "trunk" },
      ],
    };

    const expansion = expandRouteGraph(graph, {
      endpoints: new Map([
        ["epA", { id: "epA", endpoint: epA, point: pointA, outward: outwardA }],
      ]),
      existingRoutePaths: [],
      instanceBoxes: [],
    });

    expect(expansion.conflicts).toEqual([]);
    for (const edit of expansion.edits) {
      expect(edit.kind).not.toBe("route_orthogonal");
    }
  });
});
