import { expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { diagnoseLabelClearance } from "./label-clearance.js";
const resolver = new InMemorySymbolResolver(builtInSymbols);
it("reports wire intersection and owner distance as observations, ignores hidden labels, and does not repeat text overlap", () => {
  const doc = createEmptyDocument("d", "Checks");
  doc.instances.push({
    id: "r",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 300, y: 190 } },
    { id: "b", netId: "n", position: { x: 500, y: 190 } },
  );
  doc.routes.push(
    createRoutePath({
      id: "w",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  doc.annotations.push({
    id: "far",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "R1" }] },
    anchor: {
      kind: "object",
      objectId: "r",
      localOffset: { x: 300, y: 100 },
      fallbackPosition: { x: 400, y: 200 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const checks = diagnoseLabelClearance(doc, resolver);
  expect(checks.map((d) => d.code)).toEqual([
    "VISUAL_LABEL_CLEARANCE",
    "VISUAL_LABEL_OWNER_DISTANCE",
  ]);
  expect(checks[0]!.objectIds).toEqual(["far", "w"]);
  expect(
    checks.every((d) => d.gateEligible === false && d.severity === "info"),
  ).toBe(true);
  doc.annotations[0]!.visible = false;
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
});
it("does not mistake a diagonal's bounding box for an actual crossing", () => {
  const doc = createEmptyDocument("d", "Diagonal");
  doc.nets.push({ id: "n", terminals: [] });
  doc.junctions.push(
    { id: "a", netId: "n", position: { x: 0, y: 0 } },
    { id: "b", netId: "n", position: { x: 100, y: 100 } },
  );
  doc.routes.push(
    createRoutePath({
      id: "w",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  doc.annotations.push({
    id: "label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "X" }] },
    anchor: { kind: "free", position: { x: 10, y: 90 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  expect(diagnoseLabelClearance(doc, resolver)).toEqual([]);
  doc.annotations[0]!.anchor = { kind: "free", position: { x: 50, y: 60 } };
  expect(diagnoseLabelClearance(doc, resolver)).toHaveLength(1);
});
