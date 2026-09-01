import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  createRoutingOperationPlan,
  evaluateRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";
import { proposeWireIntent } from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function twoNetDocument() {
  const document = createEmptyDocument("main", "Main");
  document.nets.push(
    { id: "net-a", terminals: [] },
    { id: "net-b", terminals: [] },
  );
  document.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-b", position: { x: 100, y: 0 } },
  );
  return document;
}

describe("RoutingOperationPlan", () => {
  it("evaluates the real transaction and verifies a declared merge", () => {
    const document = twoNetDocument();
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
        {
          kind: "connect_endpoints",
          from: { kind: "junction", junctionId: "J1" },
          to: { kind: "junction", junctionId: "J2" },
        },
      ],
    });

    const evaluated = evaluateRoutingOperationPlan(document, plan);
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated));
    expect(evaluated).toMatchObject({
      ok: true,
      value: {
        finalDocument: { revision: 1, nets: [{ id: "net-a" }] },
        actualElectricalEffect: {
          changedEndpointBaseNetKeys: ["junction:J2"],
        },
      },
    });
    expect(document.revision).toBe(0);
    expect(gateRoutingOperationPlan(document, plan)).toMatchObject({
      ok: true,
      edits: plan.edits,
    });
  });

  it("accepts a merge after canonicalization retires its temporary Junction endpoints", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "net-left", terminals: [] },
      { id: "net-right", terminals: [] },
    );
    document.junctions.push(
      { id: "left-outer", netId: "net-left", position: { x: 0, y: 0 } },
      { id: "left-open", netId: "net-left", position: { x: 40, y: 0 } },
      { id: "right-open", netId: "net-right", position: { x: 60, y: 0 } },
      { id: "right-outer", netId: "net-right", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "left",
        netId: "net-left",
        start: { kind: "junction", junctionId: "left-outer" },
        end: { kind: "junction", junctionId: "left-open" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "right",
        netId: "net-right",
        start: { kind: "junction", junctionId: "right-open" },
        end: { kind: "junction", junctionId: "right-outer" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const wire = proposeWireIntent(document, resolver, {
      id: "reconnect",
      from: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "left-open" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "right-open" },
      },
    });
    expect(typeof wire).not.toBe("string");
    if (typeof wire === "string") return;
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: wire.edits,
    });

    const gate = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.evaluated.finalDocument.nets).toHaveLength(1);
    expect(gate.evaluated.finalDocument.routes).toHaveLength(1);
    expect(
      gate.evaluated.finalDocument.junctions.map((junction) => junction.id),
    ).toEqual(["left-outer", "right-outer"]);
  });

  it("rejects stale and cross-Cell plans before evaluation", () => {
    const document = twoNetDocument();
    const plan = createRoutingOperationPlan(document, {
      intent: "route-geometry",
      diagnostics: [],
      edits: [
        { kind: "move_junction", junctionId: "J1", position: { x: 10, y: 0 } },
      ],
    });
    expect(
      gateRoutingOperationPlan({ ...document, revision: 1 }, plan),
    ).toEqual({
      ok: false,
      message: "Routing operation is stale",
      diagnostics: [],
    });
    expect(
      gateRoutingOperationPlan({ ...document, id: "child" }, plan),
    ).toEqual({
      ok: false,
      message: "Routing operation targets another Cell",
      diagnostics: [],
    });
  });

  it("rejects a transaction whose actual effect exceeds preserve", () => {
    const document = twoNetDocument();
    const plan = createRoutingOperationPlan(document, {
      intent: "transform",
      expectedElectricalEffect: {
        kind: "preserve",
        endpointKeys: ["junction:J1", "junction:J2"],
      },
      diagnostics: [],
      edits: [
        { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
      ],
    });
    expect(evaluateRoutingOperationPlan(document, plan)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "ELECTRICAL_EFFECT_MISMATCH" }],
    });
  });

  it("hands the refusal's reason to the caller, not just its headline", () => {
    // A schema refusal names the field it rejected. The gate is the last
    // place that knows, so a caller reporting only the headline leaves the
    // person with "Transaction result failed Document validation" and
    // nothing to act on or report.
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-a", terminals: [] });
    const plan = createRoutingOperationPlan(document, {
      intent: "transform",
      edits: [
        {
          kind: "add_junction",
          junctionId: "J-off-grid",
          netId: "net-a",
          // The Document grid is 10: an off-grid Junction is refused.
          position: { x: 3, y: 7 },
        },
      ],
      diagnostics: [],
    });
    const gate = gateRoutingOperationPlan(document, plan);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.diagnostics.length).toBeGreaterThan(0);
    expect(gate.diagnostics[0]?.message).toBeTruthy();
  });

  /**
   * What a merge declaration can and cannot be trusted to catch.
   *
   * Both checks in the merge branch read `endpointToBaseNet`, which is built
   * from Net terminals and Junctions — model membership, not geometry. An
   * endpoint with no membership therefore appears in neither the precise
   * check's resolved Nets nor the witness fallback's source Nets: declaring
   * it is a no-op, invisible to the guard.
   *
   * This is worth pinning because the two halves are easy to conflate.
   * "Declaring extra endpoints is harmless" is false — an extra endpoint that
   * DOES have membership and does not end up joined is caught. Only the
   * unowned ones are silent. A planner that wants a boundary enforced must
   * therefore enforce it by what it emits, not by what it declares.
   */
  describe("what a merge declaration is checked against", () => {
    it("is silent about a declared endpoint that belongs to no Net", () => {
      const document = twoNetDocument();
      // An instance with no Net membership at all: nothing in the model
      // places its pin on a conductor, so the projection has no entry for it.
      document.instances.push({
        id: "R1",
        symbolId: "resistor",
        placement: { position: { x: 40, y: 0 }, rotation: 0, mirror: "none" },
      } as (typeof document.instances)[number]);

      const plan = createRoutingOperationPlan(document, {
        intent: "connect",
        // A real edit that moves geometry and joins nothing, so the merge
        // declaration is the only thing under test.
        edits: [
          {
            kind: "move_junction",
            junctionId: "J1",
            position: { x: 0, y: 10 },
          },
        ],
        diagnostics: [],
        expectedElectricalEffect: {
          kind: "merge",
          endpointGroups: [["terminal:R1:1", "junction:J1"]],
        },
      });
      const gate = gateRoutingOperationPlan(document, plan, {
        symbolResolver: resolver,
      });

      // No edits ran, so nothing merged — and the guard still passes, because
      // the unowned endpoint contributes nothing for it to compare.
      expect(gate.ok).toBe(true);
    });

    it("refuses a declared merge between two endpoints that keep their Nets", () => {
      const document = twoNetDocument();
      const plan = createRoutingOperationPlan(document, {
        intent: "connect",
        // A real edit that moves geometry and joins nothing, so the merge
        // declaration is the only thing under test.
        edits: [
          {
            kind: "move_junction",
            junctionId: "J1",
            position: { x: 0, y: 10 },
          },
        ],
        diagnostics: [],
        expectedElectricalEffect: {
          kind: "merge",
          endpointGroups: [["junction:J1", "junction:J2"]],
        },
      });
      const gate = gateRoutingOperationPlan(document, plan, {
        symbolResolver: resolver,
      });

      // Both ends have membership and stay on their own Nets, so the same
      // guard that shrugged above catches this one.
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      expect(gate.message).toMatch(/did not join/u);
    });
  });
});
