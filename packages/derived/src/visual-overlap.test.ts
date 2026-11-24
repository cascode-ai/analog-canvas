import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { Point, SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";

import { diagnoseVisualQuality } from "./visual.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function addWire(
  document: SchematicDocument,
  id: string,
  netId: string,
  from: Point,
  to: Point,
  bends: Point[] = [],
) {
  if (!document.nets.some((net) => net.id === netId))
    document.nets.push({ id: netId, terminals: [] });
  document.junctions.push(
    { id: id + "-start", netId, position: from },
    { id: id + "-end", netId, position: to },
  );
  document.routes.push(
    createRoutePath({
      id,
      netId,
      start: { kind: "junction", junctionId: id + "-start" },
      end: { kind: "junction", junctionId: id + "-end" },
      bends,
      modes: [...bends, to].map(() => "manual" as const),
    }),
  );
}

it("keeps overlap checks local when independent one-Route Nets are added", () => {
  function check(count: number) {
    const document = createEmptyDocument("sheet", "Wires");
    addWire(document, "trunk", "bus", { x: 0, y: 0 }, { x: 80, y: 0 });
    addWire(document, "tap", "bus", { x: 40, y: 0 }, { x: 120, y: 0 });
    for (let i = 1; i <= count; i++) {
      const y = i * 20;
      addWire(document, "r" + i, "n" + i, { x: 0, y }, { x: 80, y });
    }
    let reads = 0;
    for (const route of document.routes) {
      const netId = route.netId;
      Object.defineProperty(route, "netId", {
        get() {
          reads++;
          return netId;
        },
      });
    }
    const overlaps = diagnoseVisualQuality(document, resolver).filter(
      (item) => item.code === "VISUAL_ROUTE_OVERLAP",
    );
    expect(overlaps.map((item) => item.objectIds)).toEqual([["tap", "trunk"]]);
    return reads;
  }
  expect(check(128)).toBeLessThan(check(32) * 5);
});

it("preserves ordered overlap groups across repeated leg hits and dense fanout", () => {
  const document = createEmptyDocument("sheet", "Shared spans");
  addWire(document, "long", "trunk", { x: 0, y: 0 }, { x: 0, y: 80 }, [
    { x: 500_000, y: 0 },
    { x: 500_000, y: 80 },
  ]);
  addWire(document, "return", "trunk", { x: 300, y: 80 }, { x: 60, y: 0 }, [
    { x: 500_000, y: 80 },
    { x: 500_000, y: 0 },
  ]);
  addWire(document, "touch", "trunk", { x: -40, y: 0 }, { x: 0, y: 0 });
  addWire(document, "foreign", "other", { x: 0, y: 0 }, { x: 900, y: 0 });
  const fan = Array.from(
    { length: 16 },
    (_, i) => "arm-" + String(i).padStart(2, "0"),
  );
  // Different endpoints on one Net, all with a genuine shared span.
  for (const [i, id] of [...fan].reverse().entries())
    addWire(document, id, "fan", { x: i, y: 200 }, { x: 200 - i, y: 200 });
  const read = (candidateSearch: "indexed" | "legacy") =>
    diagnoseVisualQuality(document, resolver, { candidateSearch });
  const indexed = read("indexed");
  expect(indexed).toStrictEqual(read("legacy"));
  expect(
    indexed
      .filter((item) => item.code === "VISUAL_ROUTE_OVERLAP")
      .map((item) => [item.parameters?.netId, item.objectIds]),
  ).toEqual([
    ["fan", fan],
    ["trunk", ["long", "return"]],
  ]);
});
