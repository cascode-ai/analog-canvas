import { expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { proposeVisualRouteDeletion } from "./visual-route-deletion.js";

it("removes the selected junction's arms and preserves a neighbour with a surviving wire", () => {
  const cell = createEmptyDocument("delete", "Delete");
  cell.nets.push({ id: "n", terminals: [] });
  cell.junctions = ["left", "selected", "right", "far", "isolated"].map(
    (id, index) => ({ id, netId: "n", position: { x: index * 20, y: 0 } }),
  );
  cell.routes = (
    [
      ["first", "left", "selected"],
      ["second", "selected", "right"],
      ["keep", "right", "far"],
    ] as const
  ).map(([id, start, end]) =>
    createRoutePath({
      id,
      netId: "n",
      start: { kind: "junction", junctionId: start },
      end: { kind: "junction", junctionId: end },
      bends: [],
      modes: ["manual"],
    }),
  );

  const plan = proposeVisualRouteDeletion(cell, [], ["selected", "isolated"]);
  expect(plan.routeIds).toEqual(["first", "second"]);
  expect(plan.junctionIds).toEqual(["isolated", "left", "selected"]);
  expect(plan.edits).toEqual([
    { kind: "cut_connection", routeId: "first" },
    { kind: "cut_connection", routeId: "second" },
    { kind: "remove_junction", junctionId: "isolated" },
  ]);
});
