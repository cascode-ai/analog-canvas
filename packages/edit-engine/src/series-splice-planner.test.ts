import { createEmptyDocument, createRoutePath, routeEnd } from "@icm/model";
import { endpointKey } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planSeriesInstanceSplice } from "./series-splice-planner.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("series component splice", () => {
  it("removes the between-pin conductor and partitions the Base Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 50 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      {
        id: "top",
        netId: "net-1",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "bottom",
        netId: "net-1",
        position: { x: 0, y: 100 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net-1",
        start: { kind: "junction", junctionId: "top" },
        end: { kind: "junction", junctionId: "bottom" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const first = {
      endpoint: { kind: "terminal" as const, instanceId: "R1", pinName: "1" },
      point: { x: 0, y: 30 },
      segmentIndex: 0,
    };
    const second = {
      endpoint: { kind: "terminal" as const, instanceId: "R1", pinName: "2" },
      point: { x: 0, y: 70 },
      segmentIndex: 0,
    };

    const plan = planSeriesInstanceSplice(
      document,
      resolver,
      "trunk",
      [first, second],
      "r1",
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = executeTransaction(
      document,
      {
        transactionId: "insert-r1",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        dryRun: false,
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toHaveLength(2);
    expect(result.document.nets).toHaveLength(2);
    const firstNet = result.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === "R1" && terminal.pinName === "1",
      ),
    );
    const secondNet = result.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === "R1" && terminal.pinName === "2",
      ),
    );
    expect(firstNet?.id).toBeTruthy();
    expect(secondNet?.id).toBeTruthy();
    expect(firstNet?.id).not.toBe(secondNet?.id);
    expect(
      result.document.routes.some((route) => {
        const endpoints = new Set([
          endpointKey(route.start),
          endpointKey(routeEnd(route)),
        ]);
        return (
          endpoints.has(endpointKey(first.endpoint)) &&
          endpoints.has(endpointKey(second.endpoint))
        );
      }),
    ).toBe(false);
  });
});
