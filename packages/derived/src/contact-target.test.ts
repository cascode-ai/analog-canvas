import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveElectricalContactTargets } from "./contact-target.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture(vertical = false) {
  const document = createEmptyDocument("main", "Main");
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(
    {
      id: "a",
      netId: "net-1",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "b",
      netId: "net-1",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
    {
      id: "c",
      netId: "net-1",
      position: vertical ? { x: 50, y: -50 } : { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "d",
      netId: "net-1",
      position: vertical ? { x: 50, y: 50 } : { x: 100, y: 0 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "first",
      netId: "net-1",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "second",
      netId: "net-1",
      start: { kind: "junction", junctionId: "c" },
      end: { kind: "junction", junctionId: "d" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

function candidates() {
  return [
    {
      kind: "route" as const,
      id: "route:first:0",
      point: { x: 50, y: 0 },
      netId: "net-1",
      routeId: "first",
      segmentIndex: 0,
    },
    {
      kind: "route" as const,
      id: "route:second:0",
      point: { x: 50, y: 0 },
      netId: "net-1",
      routeId: "second",
      segmentIndex: 0,
    },
  ];
}

describe("electrical contact target collapse", () => {
  it("treats stale collinear same-Net overlap as one selectable conductor", () => {
    expect(
      resolveElectricalContactTargets(fixture(), resolver, candidates()),
    ).toHaveLength(1);
  });

  it("keeps a perpendicular same-Net crossing ambiguous", () => {
    expect(
      resolveElectricalContactTargets(fixture(true), resolver, candidates()),
    ).toHaveLength(2);
  });

  it("treats a T-Junction and its collinear arms as one conductor", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      { id: "tee", netId: "net-1", position: { x: 50, y: 0 }, role: "branch" },
      ...(
        [
          ["left", { x: 0, y: 0 }],
          ["right", { x: 100, y: 0 }],
          ["down", { x: 50, y: 50 }],
        ] as const
      ).map(([id, position]) => ({
        id,
        netId: "net-1",
        position,
        role: "route-anchor" as const,
      })),
    );
    for (const [id, far] of [
      ["west", "left"],
      ["east", "right"],
      ["stem", "down"],
    ] as const) {
      document.routes.push(
        createRoutePath({
          id,
          netId: "net-1",
          start: { kind: "junction", junctionId: "tee" },
          end: { kind: "junction", junctionId: far },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const point = { x: 50, y: 0 };
    const targets = resolveElectricalContactTargets(document, resolver, [
      {
        kind: "endpoint",
        id: "junction:tee",
        point,
        netId: "net-1",
        endpoint: { kind: "junction", junctionId: "tee" },
      },
      ...["west", "east", "stem"].map((routeId) => ({
        kind: "route" as const,
        id: `route:${routeId}:0`,
        point,
        netId: "net-1",
        routeId,
        segmentIndex: 0,
      })),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.endpoint?.endpoint).toEqual({
      kind: "junction",
      junctionId: "tee",
    });
    expect(targets[0]!.candidates).toHaveLength(4);
  });
});
