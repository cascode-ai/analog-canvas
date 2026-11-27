import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
  planRoutingTransform,
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

  it("lets go of a marker set directly on a pin, which stays where it stands", () => {
    // A ground marker on an NMOS source with no wire between (Gallery
    // efx8jakksk's M5): a Ctrl/Cmd-drag of the transistor carried it along.
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "M5",
        symbolId: "nmos",
        placement: {
          position: { x: 140, y: 150 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "G5",
        symbolId: "ground",
        placement: {
          position: { x: 150, y: 180 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "ground",
      terminals: [
        { instanceId: "G5", pinName: "0" },
        { instanceId: "M5", pinName: "S" },
      ],
    });

    const planned = planDetachedMove(document, resolver, new Set(["M5"]), 1);
    expect(planned.edits).toEqual([
      {
        kind: "disconnect_endpoint",
        endpoint: { kind: "terminal", instanceId: "M5", pinName: "S" },
      },
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
    expect(gate.evaluated.finalDocument.nets[0]!.terminals).toEqual([
      { instanceId: "G5", pinName: "0" },
    ]);
    // Moved together, the two let go of nothing.
    expect(
      planDetachedMove(document, resolver, new Set(["M5", "G5"]), 2).edits,
    ).toEqual([]);
  });

  it("preserves internal region wires and stubs only boundary wires at a shared T-junction", () => {
    const document = createEmptyDocument("region", "Region detach");
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
        id: "C1",
        symbolId: "capacitor",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R3",
        symbolId: "resistor",
        placement: {
          position: { x: 360, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "n-shared",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "C1", pinName: "2" },
        { instanceId: "R3", pinName: "2" },
      ],
    });
    document.junctions.push({
      id: "J1",
      netId: "n-shared",
      position: { x: 200, y: 160 },
    });
    const wInt = createRoutePath({
      id: "W_int",
      netId: "n-shared",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [{ x: 100, y: 160 }],
      modes: ["manual", "manual"],
    });
    const wCap = createRoutePath({
      id: "W_cap",
      netId: "n-shared",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "terminal", instanceId: "C1", pinName: "2" },
      bends: [],
      modes: ["manual"],
    });
    const wBound = createRoutePath({
      id: "W_bound",
      netId: "n-shared",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "terminal", instanceId: "R3", pinName: "2" },
      bends: [{ x: 360, y: 160 }],
      modes: ["manual", "manual"],
    });
    document.routes.push(wInt, wCap, wBound);
    document.annotations.push({
      id: "label-vout",
      kind: "net-label",
      netId: "n-shared",
      binding: { kind: "net-name", netId: "n-shared" },
      anchor: {
        kind: "route",
        routeId: "W_int",
        legId: wInt.legs[0]!.id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 150, y: 130 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const boundBefore = resolveDocumentRoutingGeometry(
      document,
      resolver,
    ).routes.get("W_bound")!.centerline;

    const detached = planDetachedMove(
      document,
      resolver,
      new Set(["R1", "C1"]),
      1,
      {
        routeIds: new Set(["W_int", "W_cap"]),
        junctionIds: new Set(["J1"]),
      },
    );
    expect(detached.detachedBoundaryRouteIds).toEqual(["W_bound"]);
    expect(detached.partitionedNetIds).toEqual(["n-shared"]);

    const movePlan = planRoutingTransform(
      document,
      resolver,
      {
        instanceIds: ["R1", "C1"],
        routeIds: ["W_int", "W_cap"],
        junctionIds: ["J1"],
      },
      { kind: "translate", delta: { x: 120, y: 60 } },
    );
    const detachedBoundary = new Set(detached.detachedBoundaryRouteIds);
    const filteredMoveEdits = movePlan.edits.filter(
      (edit) =>
        !(
          edit.kind === "set_route_path" && detachedBoundary.has(edit.route.id)
        ),
    );
    const gate = gateRoutingOperationPlan(
      document,
      createRoutingOperationPlan(document, {
        intent: "transform",
        diagnostics: [],
        edits: [...detached.edits, ...filteredMoveEdits],
        expectedElectricalEffect: {
          kind: "partition",
          sourceBaseNetIds: detached.partitionedNetIds,
          cutRouteIds: [],
        },
      }),
      { symbolResolver: resolver },
    );

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const finalDoc = gate.evaluated.finalDocument;
    // Boundary wire stays at exact authored coordinates on a stationary stub.
    expect(
      resolveDocumentRoutingGeometry(finalDoc, resolver).routes.get("W_bound")!
        .centerline,
    ).toEqual(boundBefore);
    // Moving region translates intact and separates into its own Net; once the
    // boundary branch detaches, degree-2 J1 cleanly normalizes into the moving
    // wire's elbow while preserving the internal connection and route label.
    expect(
      finalDoc.instances.find((item) => item.id === "R1")!.placement!.position,
    ).toEqual({ x: 220, y: 160 });
    expect(
      finalDoc.instances.find((item) => item.id === "C1")!.placement!.position,
    ).toEqual({ x: 320, y: 160 });
    const movingRoute = finalDoc.routes.find((r) => r.id !== "W_bound")!;
    const stationaryRoute = finalDoc.routes.find((r) => r.id === "W_bound")!;
    expect(movingRoute.netId).not.toBe(stationaryRoute.netId);
    const movingNet = finalDoc.nets.find((n) => n.id === movingRoute.netId)!;
    expect(movingNet.terminals).toEqual(
      expect.arrayContaining([
        { instanceId: "R1", pinName: "2" },
        { instanceId: "C1", pinName: "2" },
      ]),
    );
    expect(movingNet.terminals).not.toContainEqual(
      expect.objectContaining({ instanceId: "R3" }),
    );
    const movedLabel = finalDoc.annotations.find((a) => a.id === "label-vout")!;
    expect(movedLabel.anchor.kind).toBe("route");
  });

  it("lifts an internally wired subgraph off a stationary direct contact without synthesizing a bridge wire", () => {
    const document = createEmptyDocument("direct-region", "Direct region");
    document.instances.push(
      {
        id: "M5",
        symbolId: "nmos",
        placement: {
          position: { x: 140, y: 150 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "G5",
        symbolId: "ground",
        placement: {
          position: { x: 150, y: 180 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 240, y: 210 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "ground",
      terminals: [
        { instanceId: "G5", pinName: "0" },
        { instanceId: "M5", pinName: "S" },
        { instanceId: "R1", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "W_int",
        netId: "ground",
        start: { kind: "terminal", instanceId: "M5", pinName: "S" },
        end: { kind: "terminal", instanceId: "R1", pinName: "1" },
        bends: [{ x: 240, y: 180 }],
        modes: ["manual", "manual"],
      }),
    );

    const detached = planDetachedMove(
      document,
      resolver,
      new Set(["M5", "R1"]),
      3,
      { routeIds: new Set(["W_int"]), junctionIds: new Set() },
    );
    expect(detached.partitionedNetIds).toEqual(["ground"]);
    const movePlan = planRoutingTransform(
      document,
      resolver,
      { instanceIds: ["M5", "R1"], routeIds: ["W_int"], junctionIds: [] },
      { kind: "translate", delta: { x: 100, y: 0 } },
    );
    const gate = gateRoutingOperationPlan(
      document,
      createRoutingOperationPlan(document, {
        intent: "transform",
        diagnostics: [],
        edits: [...detached.edits, ...movePlan.edits],
        expectedElectricalEffect: {
          kind: "partition",
          sourceBaseNetIds: detached.partitionedNetIds,
          cutRouteIds: [],
        },
      }),
      { symbolResolver: resolver },
    );
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const finalDoc = gate.evaluated.finalDocument;
    // Only the internal wire exists; no bridging wire back to G5 was created.
    expect(finalDoc.routes.map((route) => route.id)).toEqual(["W_int"]);
    expect(finalDoc.nets.find((net) => net.id === "ground")!.terminals).toEqual(
      [{ instanceId: "G5", pinName: "0" }],
    );
    const liftedNetId = finalDoc.routes[0]!.netId;
    expect(liftedNetId).not.toBe("ground");
    expect(
      finalDoc.nets.find((net) => net.id === liftedNetId)!.terminals,
    ).toEqual([
      { instanceId: "M5", pinName: "S" },
      { instanceId: "R1", pinName: "1" },
    ]);
  });

  it("retargets route-label name-claim evidence and separates disconnected moving subgraphs during direct-contact lift", () => {
    const document = createEmptyDocument("direct-multi", "Direct multi");
    document.instances.push(
      {
        id: "M5",
        symbolId: "nmos",
        placement: {
          position: { x: 140, y: 150 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "G5",
        symbolId: "ground",
        placement: {
          position: { x: 150, y: 180 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 240, y: 210 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M6",
        symbolId: "nmos",
        placement: {
          position: { x: 440, y: 150 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "G6",
        symbolId: "ground",
        placement: {
          position: { x: 450, y: 180 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 540, y: 210 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "ground",
      terminals: [
        { instanceId: "G5", pinName: "0" },
        { instanceId: "M5", pinName: "S" },
        { instanceId: "R1", pinName: "1" },
        { instanceId: "G6", pinName: "0" },
        { instanceId: "M6", pinName: "S" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    const w1 = createRoutePath({
      id: "W1",
      netId: "ground",
      start: { kind: "terminal", instanceId: "M5", pinName: "S" },
      end: { kind: "terminal", instanceId: "R1", pinName: "1" },
      bends: [{ x: 240, y: 180 }],
      modes: ["manual", "manual"],
    });
    const w2 = createRoutePath({
      id: "W2",
      netId: "ground",
      start: { kind: "terminal", instanceId: "M6", pinName: "S" },
      end: { kind: "terminal", instanceId: "R2", pinName: "1" },
      bends: [{ x: 540, y: 180 }],
      modes: ["manual", "manual"],
    });
    document.routes.push(w1, w2);
    document.annotations.push({
      id: "lbl-w1",
      kind: "net-label",
      netId: "ground",
      binding: { kind: "net-name", netId: "ground" },
      anchor: {
        kind: "route",
        routeId: "W1",
        legId: w1.legs[0]!.id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 195, y: 170 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: "ev-w1",
      kind: "name-claim",
      netId: "ground",
      name: "VSS_A",
      scope: "local",
      owner: { kind: "net-label", annotationId: "lbl-w1" },
    });

    const detached = planDetachedMove(
      document,
      resolver,
      new Set(["M5", "R1", "M6", "R2"]),
      3,
      { routeIds: new Set(["W1", "W2"]), junctionIds: new Set() },
    );
    const movePlan = planRoutingTransform(
      document,
      resolver,
      {
        instanceIds: ["M5", "R1", "M6", "R2"],
        routeIds: ["W1", "W2"],
        junctionIds: [],
      },
      { kind: "translate", delta: { x: 0, y: -80 } },
    );
    const gate = gateRoutingOperationPlan(
      document,
      createRoutingOperationPlan(document, {
        intent: "transform",
        diagnostics: [],
        edits: [...detached.edits, ...movePlan.edits],
        expectedElectricalEffect: {
          kind: "partition",
          sourceBaseNetIds: detached.partitionedNetIds,
          cutRouteIds: [],
        },
      }),
      { symbolResolver: resolver },
    );

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const finalDoc = gate.evaluated.finalDocument;
    const w1Net = finalDoc.routes.find((r) => r.id === "W1")!.netId;
    const w2Net = finalDoc.routes.find((r) => r.id === "W2")!.netId;
    expect(w1Net).not.toBe("ground");
    expect(w2Net).not.toBe("ground");
    expect(w1Net).not.toBe(w2Net);
    const lbl = finalDoc.annotations.find((a) => a.id === "lbl-w1")!;
    expect(lbl.netId).toBe(w1Net);
    expect(lbl.binding).toEqual({ kind: "net-name", netId: w1Net });
    const ev = finalDoc.connectivityEvidence.find((e) => e.id === "ev-w1")!;
    expect(ev.netId).toBe(w1Net);
  });
});
