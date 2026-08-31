import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function segmentedPowerRailDocument() {
  const document = createEmptyDocument("rail-main", "Rail Main");
  document.nets.push({ id: "net-vdd", terminals: [] });
  document.junctions.push(
    { id: "rail-0", netId: "net-vdd", position: { x: 0, y: 0 } },
    { id: "rail-1", netId: "net-vdd", position: { x: 100, y: 0 } },
    { id: "rail-2", netId: "net-vdd", position: { x: 200, y: 0 } },
    { id: "rail-3", netId: "net-vdd", position: { x: 300, y: 0 } },
    { id: "tap-end", netId: "net-vdd", position: { x: 200, y: 100 } },
  );
  for (const [id, start, end, presentation] of [
    ["rail-a", "rail-0", "rail-1", "power-rail"],
    ["rail-b", "rail-1", "rail-2", "power-rail"],
    ["rail-c", "rail-2", "rail-3", "power-rail"],
    ["tap", "rail-2", "tap-end", undefined],
  ] as const) {
    document.routes.push(
      createRoutePath({
        id,
        netId: "net-vdd",
        start: { kind: "junction", junctionId: start },
        end: { kind: "junction", junctionId: end },
        bends: [],
        modes: ["manual"],
        ...(presentation ? { presentation } : {}),
      }),
    );
  }
  document.annotations.push({
    id: "label-vdd",
    kind: "power-label",
    binding: { kind: "net-name", netId: "net-vdd" },
    netId: "net-vdd",
    content: { runs: [{ kind: "text", value: "VDD" }] },
    anchor: {
      kind: "object",
      objectId: "rail-3",
      localOffset: { x: 10, y: 10 },
      fallbackPosition: { x: 310, y: 10 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-vdd",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    owner: { kind: "power-marker", objectId: "label-vdd" },
    scope: "local",
    powerDomain: "vdd",
  });
  return document;
}

describe("routing deletion planner", () => {
  it("removes an isolated Wire and both orphan anchors in one operation", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "A", netId: "net", position: { x: 0, y: 0 } },
      { id: "B", netId: "net", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "net",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["wire"], junctionIds: [] },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluated.finalDocument).toMatchObject({
      routes: [],
      junctions: [],
      nets: [],
    });
  });

  it("lets a selected Route dominate an incidental branch Junction", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "L", netId: "net", position: { x: 0, y: 0 } },
      { id: "C", netId: "net", position: { x: 100, y: 0 } },
      { id: "R", netId: "net", position: { x: 200, y: 0 } },
      { id: "D", netId: "net", position: { x: 100, y: 100 } },
    );
    for (const [id, start, end] of [
      ["left", "L", "C"],
      ["right", "C", "R"],
      ["branch", "C", "D"],
    ] as const) {
      document.routes.push(
        createRoutePath({
          id,
          netId: "net",
          start: { kind: "junction", junctionId: start },
          end: { kind: "junction", junctionId: end },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const plan = planRoutingDeletion(
      document,
      resolver,
      {
        instanceIds: [],
        routeIds: ["branch"],
        junctionIds: ["C", "D"],
      },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.evaluated.finalDocument.routes.map((route) => route.id),
      ).toEqual(["left"]);
      expect(
        result.evaluated.finalDocument.junctions.map((item) => item.id),
      ).toEqual(["L", "R"]);
    }
  });

  it("deletes a segmented Power Rail as one component while preserving its tap", () => {
    const document = segmentedPowerRailDocument();
    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["rail-b"], junctionIds: [] },
      1,
    );
    expect(
      plan.edits.flatMap((edit) =>
        edit.kind === "cut_connection" ? [edit.routeId] : [],
      ),
    ).toEqual(["rail-a", "rail-b", "rail-c"]);
    expect(plan.edits).toContainEqual({
      kind: "remove_schematic_annotation",
      annotationId: "label-vdd",
    });

    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.evaluated.finalDocument.routes.map((route) => route.id),
    ).toEqual(["tap"]);
    expect(
      result.evaluated.finalDocument.junctions.map((junction) => junction.id),
    ).toEqual(["rail-2", "tap-end"]);
    expect(result.evaluated.finalDocument.annotations).toEqual([]);
    expect(result.evaluated.finalDocument.connectivityEvidence).toEqual([]);
  });

  it("treats deleting the Power Rail label as deleting the same component", () => {
    const document = segmentedPowerRailDocument();
    const plan = planRoutingDeletion(
      document,
      resolver,
      {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: ["label-vdd"],
      },
      1,
    );
    expect(
      plan.edits.flatMap((edit) =>
        edit.kind === "cut_connection" ? [edit.routeId] : [],
      ),
    ).toEqual(["rail-a", "rail-b", "rail-c"]);
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.evaluated.finalDocument.routes.map((route) => route.id),
    ).toEqual(["tap"]);
  });
});
