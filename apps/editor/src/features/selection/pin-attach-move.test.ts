/**
 * Regression: pin-onto-wire move snap must commit even when the snap
 * projection carries float dust. The attach edit takes the endpoint's own
 * grid-exact contact point, never the raw projection (audit finding #3).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createRoutePath,
  routeEnd,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  createRoutingOperationPlan,
  executeTransaction,
  gateRoutingOperationPlan,
  type ExpectedElectricalEffect,
  type RoutingOperationIntent,
  type SchematicEdit,
} from "@icm/edit-engine";
import { resolveEndpointConnection } from "@icm/derived";
import { describe, expect, it } from "vitest";

import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const terminal = (instanceId: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName: "P",
});

function fixtureDocument(): SchematicDocument {
  const document = parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
  // Reposition ports so route-h spans exactly (0,300) -> (110,300):
  // port pin "P" is at local (10,0); A mirror none -> contact (pos.x+10, y),
  // B mirror x -> contact (pos.x-10, y).
  document.instances.find((i) => i.id === "A")!.placement = {
    position: { x: -10, y: 300 },
    rotation: 0,
    mirror: "none",
  };
  document.instances.find((i) => i.id === "B")!.placement = {
    position: { x: 120, y: 300 },
    rotation: 0,
    mirror: "x",
  };
  // E: rotation 270 puts its pin contact at (pos.x, pos.y-10), outward north.
  document.instances.find((i) => i.id === "E")!.placement = {
    position: { x: 30, y: 400 },
    rotation: 270,
    mirror: "none",
  };
  return document;
}

function routedDocument(): SchematicDocument {
  const document = fixtureDocument();
  const result = executeTransaction(
    document,
    {
      transactionId: "seed-route-h",
      documentId: document.id,
      expectedRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "route-h",
            netId: "net-h",
            start: terminal("A"),
            end: terminal("B"),
            bends: [],
            modes: ["manual"],
          }),
        },
      ],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(`seed failed: ${result.error.message}`);
  return result.document;
}

function runMove(targetX: number) {
  const document = routedDocument();
  const statuses: string[] = [];
  const transactions: {
    intent: RoutingOperationIntent;
    edits: readonly SchematicEdit[];
    gateMessage?: string;
    result?: ReturnType<typeof executeTransaction>;
  }[] = [];
  const transactConnectivity = (
    intent: RoutingOperationIntent,
    edits: readonly SchematicEdit[],
    options: { expectedElectricalEffect?: ExpectedElectricalEffect } = {},
  ) => {
    const record: (typeof transactions)[number] = { intent, edits };
    transactions.push(record);
    const proposal = createRoutingOperationPlan(document, {
      intent,
      edits,
      diagnostics: [],
      ...(options.expectedElectricalEffect
        ? { expectedElectricalEffect: options.expectedElectricalEffect }
        : {}),
    });
    const gate = gateRoutingOperationPlan(document, proposal, {
      symbolResolver: resolver,
    });
    if (!gate.ok) {
      record.gateMessage = gate.message;
      statuses.push(gate.message);
      return null;
    }
    const result = executeTransaction(
      document,
      {
        transactionId: "move-commit",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...gate.edits],
      },
      { symbolResolver: resolver },
    );
    record.result = result;
    if (!result.ok)
      statuses.push(`${result.error.code}: ${result.error.message}`);
    return { ok: result.ok };
  };
  const controller = createSelectionMoveController({
    document,
    resolver,
    visibleEndpoints: [],
    routeGeometryRecords: [],
    contactComponents: [],
    transactConnectivity,
    setStatus: (status) => statuses.push(status),
    nextRoutingSuffix: () => 1,
  });
  const movePlan = planSelectionMove(document, {
    instanceIds: ["E"],
    routeIds: [],
    junctionIds: [],
    annotationIds: [],
    draftingIds: [],
  });
  const preview = {
    instanceIds: movePlan.instanceIds,
    primaryInstanceId: "E",
    originalPositions: { E: { x: 30, y: 400 } },
    pointerStart: { x: 500, y: 500 },
    movePlan,
  };
  // Raw pointer lands so the moved pin contact is exactly (targetX, 294.3):
  // pin contact starts at (30, 390); rawDelta = (targetX-30, -95.7).
  const position = { x: 500 + (targetX - 30), y: 500 - 95.7 };
  const tolerance = 7;
  const resolved = controller.resolveInstanceMove(
    preview,
    position,
    tolerance,
    false,
    undefined,
    document,
  );
  controller.completeInstanceMove(
    preview,
    position,
    tolerance,
    false,
    resolved.snap,
    {
      document,
      prefixEdits: [],
      resolvedMove: resolved,
    },
  );
  return { document, resolved, statuses, transactions };
}

describe("pin-onto-wire move snap float dust", () => {
  it("dusty lattice point: the attach uses the pin's exact contact and commits", () => {
    const { resolved, statuses, transactions } = runMove(30);
    // The electrical route match engages on a float-dusted projection...
    expect(resolved.snap.electricalMatch?.target.electrical?.kind).toBe(
      "route",
    );
    const targetPoint = resolved.snap.electricalMatch!.target.point;
    expect(targetPoint.y).toBe(300);
    expect(Math.abs(targetPoint.x - 30)).toBeLessThan(1e-9);
    // ...but the committed attach point is the endpoint's grid-exact contact,
    // and the whole move applies instead of dying on the integer schema.
    const attach = transactions
      .flatMap((t) => t.edits)
      .find((edit) => edit.kind === "attach_endpoint_to_route");
    expect(attach).toBeDefined();
    expect((attach as { point: { x: number; y: number } }).point).toEqual({
      x: 30,
      y: 300,
    });
    expect(transactions.some((t) => t.result?.ok)).toBe(true);
    expect(statuses.some((s) => s.includes("Snapped pin endpoints"))).toBe(
      true,
    );
  });

  it("clean lattice point: identical gesture commits and splits the route", () => {
    const { resolved, statuses, transactions } = runMove(40);
    expect(resolved.snap.electricalMatch?.target.electrical?.kind).toBe(
      "route",
    );
    expect(resolved.snap.electricalMatch!.target.point.x).toBe(40);
    const applied = transactions.some((t) => t.result?.ok);
    expect(applied).toBe(true);
    expect(statuses.some((s) => s.includes("Snapped pin endpoints"))).toBe(
      true,
    );
  });
});

describe("two-pin device moved onto one wire", () => {
  function runTwoPinMove({ prewirePlus = false } = {}) {
    const seeded = routedDocument();
    // A current source rotated 90° has horizontal pins: "+" (0,-20) maps to
    // (+20,0), "-" (0,20) maps to (-20,0).
    const added = executeTransaction(
      seeded,
      {
        transactionId: "seed-current-source",
        documentId: seeded.id,
        expectedRevision: seeded.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "add_instance",
            instance: {
              id: "I1",
              symbolId: "current-source",
              placement: {
                position: { x: 50, y: 180 },
                rotation: 90,
                mirror: "none",
              },
            },
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!added.ok) throw new Error(`seed failed: ${added.error.message}`);
    let document = added.document;
    if (prewirePlus) {
      // The control case wires "+" away to E before the drop: a pin that
      // already terminates a Route is not a new contact, so the gesture
      // must stay an ordinary attachment. E already belongs to net-h in the
      // fixture, so the bond joins that Net and the stub route rides on it.
      const connected = executeTransaction(
        document,
        {
          transactionId: "seed-stub-wire",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: "I1", pinName: "+" },
              to: terminal("E"),
            },
          ],
        },
        { symbolResolver: resolver },
      );
      if (!connected.ok) {
        throw new Error(`stub bond failed: ${connected.error.message}`);
      }
      const wired = executeTransaction(
        connected.document,
        {
          transactionId: "seed-stub-route",
          documentId: connected.document.id,
          expectedRevision: connected.document.revision,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "set_route_path",
              route: createRoutePath({
                id: "route-stub",
                netId: "net-h",
                start: { kind: "terminal", instanceId: "I1", pinName: "+" },
                end: terminal("E"),
                bends: [
                  { x: 200, y: 180 },
                  { x: 200, y: 390 },
                ],
                modes: ["manual", "manual", "manual"],
              }),
            },
          ],
        },
        { symbolResolver: resolver },
      );
      if (!wired.ok) {
        throw new Error(`stub route failed: ${wired.error.message}`);
      }
      document = wired.document;
    }
    const statuses: string[] = [];
    const results: ReturnType<typeof executeTransaction>[] = [];
    const transactions: {
      intent: RoutingOperationIntent;
      edits: readonly SchematicEdit[];
    }[] = [];
    const transactConnectivity = (
      intent: RoutingOperationIntent,
      edits: readonly SchematicEdit[],
      options: { expectedElectricalEffect?: ExpectedElectricalEffect } = {},
    ) => {
      const proposal = createRoutingOperationPlan(document, {
        intent,
        edits,
        diagnostics: [],
        ...(options.expectedElectricalEffect
          ? { expectedElectricalEffect: options.expectedElectricalEffect }
          : {}),
      });
      const gate = gateRoutingOperationPlan(document, proposal, {
        symbolResolver: resolver,
      });
      if (!gate.ok) {
        statuses.push(gate.message);
        return null;
      }
      const result = executeTransaction(
        document,
        {
          transactionId: "two-pin-move-commit",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [...gate.edits],
        },
        { symbolResolver: resolver },
      );
      results.push(result);
      if (result.ok) {
        document = result.document;
        transactions.push({ intent, edits: [...gate.edits] });
      } else statuses.push(`${result.error.code}: ${result.error.message}`);
      return { ok: result.ok };
    };
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity,
      setStatus: (status) => statuses.push(status),
      nextRoutingSuffix: () => 7,
    });
    const movePlan = planSelectionMove(document, {
      instanceIds: ["I1"],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    });
    const preview = {
      instanceIds: movePlan.instanceIds,
      primaryInstanceId: "I1",
      originalPositions: { I1: { x: 50, y: 180 } },
      pointerStart: { x: 500, y: 500 },
      movePlan,
    };
    // Drop the device body onto route-h: pins land at (30,300) and (70,300),
    // both strictly inside the wire span (0,300)-(110,300).
    const position = { x: 500, y: 500 + 120 };
    const tolerance = 7;
    const resolved = controller.resolveInstanceMove(
      preview,
      position,
      tolerance,
      false,
      undefined,
      document,
    );
    controller.completeInstanceMove(
      preview,
      position,
      tolerance,
      false,
      resolved.snap,
      {
        document,
        prefixEdits: [],
        resolvedMove: resolved,
      },
    );
    return { document, resolved, statuses, results, transactions };
  }

  it("splices the device into the wire instead of shorting it", () => {
    const { document, resolved, results } = runTwoPinMove();
    expect(resolved.snap.electricalMatch?.target.electrical?.kind).toBe(
      "route",
    );
    expect(results.some((result) => result.ok)).toBe(true);
    // Series insertion: the span between the pins is gone, leaving one
    // conductor on each side of the device instead of a wire through it.
    expect(document.routes).toHaveLength(2);
    const netOf = (pinName: string) =>
      document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === "I1" && terminal.pinName === pinName,
        ),
      );
    const plusNet = netOf("+");
    const minusNet = netOf("-");
    expect(plusNet).toBeDefined();
    expect(minusNet).toBeDefined();
    // Two Base Nets: the pins are not shorted by the wire they landed on.
    expect(plusNet!.id).not.toBe(minusNet!.id);
    const throughDevice = document.routes.find((route) => {
      const end = routeEnd(route);
      return (
        route.start.kind === "terminal" &&
        route.start.instanceId === "I1" &&
        end.kind === "terminal" &&
        end.instanceId === "I1"
      );
    });
    expect(throughDevice).toBeUndefined();
  });

  it("keeps the ordinary attachment when one pin is already wired", () => {
    const { document, results, transactions } = runTwoPinMove({
      prewirePlus: true,
    });
    expect(results.some((result) => result.ok)).toBe(true);
    // Not a series drop: only "-" is a new contact, so nothing is cut.
    expect(
      transactions
        .flatMap(({ edits }) => edits)
        .some((edit) => edit.kind === "cut_connection"),
    ).toBe(false);
    // Route counts belong to commit-time canonicalization; the contract here
    // is electrical: everything stays one conductor family on one Net.
    const netH = document.nets.find((candidate) => candidate.id === "net-h")!;
    expect(netH.terminals).toEqual(
      expect.arrayContaining([
        { instanceId: "A", pinName: "P" },
        { instanceId: "B", pinName: "P" },
        { instanceId: "I1", pinName: "+" },
        { instanceId: "I1", pinName: "-" },
      ]),
    );
    // No partition happened: everything still shares one Base Net.
    expect(document.routes.every((route) => route.netId === "net-h")).toBe(
      true,
    );
  });
});
