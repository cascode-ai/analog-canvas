import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  createRoutingOperationPlan,
  evaluateRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";

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
});
