import { diagnoseVisualQuality } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { planRoutingTransform } from "./routing-transform-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("terminal resting on a foreign Net after a real transform", () => {
  it("flags the moved pin that lands on another Net's wire", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "netA", terminals: [] });
    document.nets.push({
      id: "netB",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    });
    document.junctions.push(
      {
        id: "J1",
        netId: "netA",
        position: { x: 0, y: 100 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "netA",
        position: { x: 200, y: 100 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wireA",
        netId: "netA",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 60, y: 40 }, rotation: 0, mirror: "none" },
    });

    const before = diagnoseVisualQuality(document, resolver);
    expect(
      before.filter(
        (diagnostic) => diagnostic.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
      ),
    ).toEqual([]);

    // The real pipeline: plan the translate, run it through the routing
    // gate, and diagnose the document the gate would commit. Pin "2" sits at
    // (60, 60); the move parks it at (60, 100), on netA's wire.
    const plan = planRoutingTransform(
      document,
      resolver,
      { instanceIds: ["R1"], routeIds: [], junctionIds: [] },
      { kind: "translate", delta: { x: 0, y: 40 } },
    );
    const gated = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;

    const after = diagnoseVisualQuality(
      gated.evaluated.finalDocument,
      resolver,
    );
    const hits = after.filter(
      (diagnostic) => diagnostic.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      severity: "error",
      category: "structural",
      confidence: "high",
      gateEligible: true,
      objectIds: ["R1", "wireA"],
      point: { x: 60, y: 100 },
      parameters: {
        instanceId: "R1",
        pinName: "2",
        terminalNetId: "netB",
        routeNetId: "netA",
      },
    });
  });
});
