/**
 * Wire-transform audit batch 4, #7: rotate and mirror carry explicitly
 * selected wires and junctions with the body, exactly like translate does.
 */
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planRoutingTransform } from "./routing-transform-planner.js";
import type { SchematicEdit } from "./edit-schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const document = createEmptyDocument("doc", "Seeds");
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 50, y: 50 }, rotation: 0, mirror: "none" },
    reference: "R1",
    netlist: { parameters: {} },
  });
  document.nets.push({ id: "net-loose", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-loose", position: { x: 100, y: 0 } },
    { id: "J2", netId: "net-loose", position: { x: 100, y: 40 } },
  );
  document.routes.push(
    createRoutePath({
      id: "wire-a",
      netId: "net-loose",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

function junctionMoves(edits: readonly SchematicEdit[]): string[] {
  return edits
    .flatMap((edit) => (edit.kind === "move_junction" ? [edit.junctionId] : []))
    .sort();
}

describe("rotate/mirror seed forwarding (#7)", () => {
  const seed = {
    instanceIds: ["R1"],
    routeIds: ["wire-a"],
    junctionIds: ["J1", "J2"],
    annotationIds: [],
  };

  it("translate carries the selected junctions (control)", () => {
    const plan = planRoutingTransform(fixture(), resolver, seed, {
      kind: "translate",
      delta: { x: 20, y: 0 },
    });
    expect(junctionMoves(plan.edits)).toEqual(["J1", "J2"]);
  });

  it("rotate carries the selected junctions and wire", () => {
    const plan = planRoutingTransform(fixture(), resolver, seed, {
      kind: "rotate",
      degrees: 90,
      center: { x: 50, y: 50 },
    });
    expect(junctionMoves(plan.edits)).toEqual(["J1", "J2"]);
  });

  it("mirror carries the selected junctions and wire", () => {
    const plan = planRoutingTransform(fixture(), resolver, seed, {
      kind: "mirror",
      axis: "y",
      center: { x: 50, y: 50 },
    });
    expect(junctionMoves(plan.edits)).toEqual(["J1", "J2"]);
  });
});
