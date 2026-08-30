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
});
