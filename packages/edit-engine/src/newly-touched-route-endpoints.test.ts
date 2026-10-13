import { describe, expect, it, vi } from "vitest";
import * as derived from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { newlyTouchedRouteEndpoints } from "./transaction-connectivity-normalizer.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function crossing() {
  const before = createEmptyDocument("contact-sweep", "Contact sweep");
  before.nets.push(
    { id: "wire-net", terminals: [] },
    {
      id: "pins",
      terminals: ["P", "Q"].map((instanceId) => ({ instanceId, pinName: "P" })),
    },
  );
  before.instances.push(
    ...["P", "Q"].map((id) => ({
      id,
      symbolId: "port",
      placement: {
        position: { x: 50, y: 50 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    })),
  );
  before.junctions.push(
    { id: "A", netId: "wire-net", position: { x: 0, y: 0 } },
    { id: "B", netId: "wire-net", position: { x: 100, y: 0 } },
    { id: "J", netId: "pins", position: { x: 50, y: 50 } },
  );
  before.routes.push(
    createRoutePath({
      id: "wire",
      netId: "wire-net",
      start: { kind: "junction", junctionId: "A" },
      end: { kind: "junction", junctionId: "B" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const after = structuredClone(before);
  after.junctions[0]!.position.y = 50;
  after.junctions[1]!.position.y = 50;
  return { before, after };
}

describe("newly touched authored conductors", () => {
  it("queries real geometry once per coordinate and snapshot, not once per coincident owner", () => {
    const { before, after } = crossing();
    const query = vi.spyOn(derived, "findRouteSegmentsAtPoint");
    try {
      const touched = newlyTouchedRouteEndpoints(
        before,
        after,
        resolver,
        new Set(["wire"]),
      );
      expect(touched).toHaveLength(3);
      // The spy calls the real query unchanged; no fabricated answers.
      expect(query).toHaveBeenCalledTimes(4);
    } finally {
      query.mockRestore();
    }
  });
  it("keeps every coincident endpoint and stable order when a wire reaches them", () => {
    const { before, after } = crossing();
    expect(
      newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"])),
    ).toEqual([
      {
        endpoint: { kind: "junction", junctionId: "J" },
        routeId: "wire",
        point: { x: 50, y: 50 },
      },
      {
        endpoint: { kind: "terminal", instanceId: "P", pinName: "P" },
        routeId: "wire",
        point: { x: 50, y: 50 },
      },
      {
        endpoint: { kind: "terminal", instanceId: "Q", pinName: "P" },
        routeId: "wire",
        point: { x: 50, y: 50 },
      },
    ]);
  });

  it("does not treat pre-existing incidence as a newly covered endpoint", () => {
    const { after } = crossing();
    expect(
      newlyTouchedRouteEndpoints(
        after,
        structuredClone(after),
        resolver,
        new Set(["wire"]),
      ),
    ).toEqual([]);
  });

  it("excludes transformed owners without dropping stationary endpoints at the same point", () => {
    const { before, after } = crossing();
    expect(
      newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"]), {
        excludeInstanceIds: new Set(["P"]),
        excludeJunctionIds: new Set(["J"]),
      }),
    ).toEqual([
      {
        endpoint: { kind: "terminal", instanceId: "Q", pinName: "P" },
        routeId: "wire",
        point: { x: 50, y: 50 },
      },
    ]);
  });

  it.each(["bulk-dashed", "power-rail"] as const)(
    "keeps %s contact authoring outside the generic detector",
    (presentation) => {
      const { before, after } = crossing();
      after.routes[0]!.presentation = presentation;
      expect(
        newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"])),
      ).toEqual([]);
    },
  );

  it("reads each new geometry even when a mutable draft keeps its revision", () => {
    const { before, after } = crossing();
    expect(
      newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"])),
    ).toHaveLength(3);
    after.junctions[0]!.position.y = 100;
    after.junctions[1]!.position.y = 100;
    expect(
      newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"])),
    ).toEqual([]);
  });
});
