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
  it("keeps exact contact checks local as distant Junctions are added", () => {
    const { before, after } = crossing();
    const exact = vi.spyOn(derived, "pointOnSegment");
    try {
      const move = () =>
        newlyTouchedRouteEndpoints(before, after, resolver, new Set(["wire"]));
      const contacts = move();
      const checks = exact.mock.calls.length;
      expect(checks).toBeGreaterThan(0);
      for (let i = 0; i < 128; i++) {
        const far = {
          id: "far-" + i,
          netId: "pins",
          position: { x: 1000, y: 100 * i },
        };
        before.junctions.push(far);
        after.junctions.push(far);
      }
      exact.mockClear();
      expect(move()).toEqual(contacts);
      expect(exact.mock.calls).toHaveLength(checks);
    } finally {
      exact.mockRestore();
    }
  });
  it("retains separate contact points for pin and instance names containing colons", () => {
    const { before, after } = crossing();
    const port = resolver.resolve("port")!.definition;
    const namedPort = {
      ...port,
      id: "qualified-port",
      pins: port.pins.map((pin) => ({ ...pin, name: "B:P" })),
    };
    const qualified = new InMemorySymbolResolver([namedPort], resolver);
    for (const document of [before, after]) {
      document.routes.push(
        createRoutePath({
          id: "other-wire",
          netId: "wire-net",
          start: { kind: "junction", junctionId: "A" },
          end: { kind: "junction", junctionId: "B" },
          bends: [],
          modes: ["manual"],
        }),
      );
      document.instances[0]!.id = "device:B";
      document.instances[1]!.id = "device";
      document.instances[1]!.symbolId = namedPort.id;
      document.instances[1]!.placement!.position.x = 70;
      document.nets[1]!.terminals = [
        { instanceId: "device:B", pinName: "P" },
        { instanceId: "device", pinName: "B:P" },
      ];
    }
    const contacts = newlyTouchedRouteEndpoints(
      before,
      after,
      qualified,
      new Set(["wire", "other-wire"]),
    );
    expect(
      contacts
        .filter(({ endpoint }) => endpoint.kind === "terminal")
        .map((c) => [c.point.x, c.routeId]),
    ).toEqual([
      [50, "other-wire"],
      [50, "wire"],
      [70, "other-wire"],
      [70, "wire"],
    ]);
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
