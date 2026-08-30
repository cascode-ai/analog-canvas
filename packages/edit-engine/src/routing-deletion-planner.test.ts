import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

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
});
