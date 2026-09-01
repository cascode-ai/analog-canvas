import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "@icm/edit-engine";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planDetachedMove } from "./detached-move";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("detached move planning", () => {
  it("keeps routed geometry on Junction stubs and removes terminal membership", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "signal",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "signal",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.noConnects.push({
      id: "open-r1-1",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
    });
    const before = resolveDocumentRoutingGeometry(
      document,
      resolver,
    ).routes.get("wire")!.centerline;

    const planned = planDetachedMove(document, resolver, new Set(["R1"]), 4);
    expect(planned.edits.map((edit) => edit.kind)).toEqual([
      "add_junction",
      "set_route_path",
      "disconnect_endpoint",
    ]);
    const gate = gateRoutingOperationPlan(
      document,
      createRoutingOperationPlan(document, {
        intent: "transform",
        diagnostics: [],
        edits: planned.edits,
        expectedElectricalEffect: {
          kind: "remove",
          removedEndpointKeys: planned.disconnectedEndpointKeys,
        },
      }),
      { symbolResolver: resolver },
    );

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const result = gate.evaluated.finalDocument;
    expect(result.nets[0]!.terminals).toEqual([
      { instanceId: "R2", pinName: "1" },
    ]);
    expect(result.noConnects).toEqual(document.noConnects);
    expect(result.routes[0]!.start).toEqual({
      kind: "junction",
      junctionId: "junction-lifecycle-4-1",
    });
    expect(
      resolveDocumentRoutingGeometry(result, resolver).routes.get("wire")!
        .centerline,
    ).toEqual(before);
  });
});
