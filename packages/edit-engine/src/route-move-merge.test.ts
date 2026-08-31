/**
 * Moving a wire so its end lands on another wire joins the two into one Net.
 *
 * "Drawing geometry never silently creates a connection" is about the
 * ambiguous case: two conductors that merely cross. Dragging an END onto a
 * conductor is not ambiguous — it is the same deliberate gesture as dropping
 * a pin on a wire, which has always connected. Before this rule the move left
 * two Nets touching at a point and the drawing was flagged
 * VISUAL_AMBIGUOUS_JUNCTION, an error the author could not clear by any
 * gesture except moving the wire away again.
 *
 * The three cases below are one rule seen from three sides, and the third is
 * the guard: connecting on purpose must not become connecting by accident.
 */
import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { diagnoseVisualQuality } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { proposeLooseRouteTranslation } from "./routing-planner.js";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

/**
 * A horizontal wire on its own Net at y = 200 spanning x = 100..300, and a
 * separate vertical wire on its own Net at x = 200 spanning y = 100..160 —
 * clear of the horizontal one by 40 units, so nothing touches yet.
 */
function twoLooseWires(): SchematicDocument {
  const document = createEmptyDocument("route-move", "Route move");
  document.presentation.grid = 10;
  document.nets.push(
    { id: "net-horizontal", terminals: [] },
    { id: "net-vertical", terminals: [] },
  );
  document.junctions.push(
    {
      id: "H1",
      netId: "net-horizontal",
      position: { x: 100, y: 200 },
      role: "route-anchor",
    },
    {
      id: "H2",
      netId: "net-horizontal",
      position: { x: 300, y: 200 },
      role: "route-anchor",
    },
    {
      id: "V1",
      netId: "net-vertical",
      position: { x: 200, y: 100 },
      role: "route-anchor",
    },
    {
      id: "V2",
      netId: "net-vertical",
      position: { x: 200, y: 160 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "wire-horizontal",
      netId: "net-horizontal",
      start: { kind: "junction", junctionId: "H1" },
      end: { kind: "junction", junctionId: "H2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "wire-vertical",
      netId: "net-vertical",
      start: { kind: "junction", junctionId: "V1" },
      end: { kind: "junction", junctionId: "V2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

/** Plan, gate, and commit a move exactly as the editor's wire tool does. */
function moveLooseRoute(
  document: SchematicDocument,
  routeId: string,
  delta: { x: number; y: number },
) {
  const proposal = proposeLooseRouteTranslation(document, routeId, delta, {
    resolver,
    suffix: "t1",
  });
  const plan = createRoutingOperationPlan(document, {
    intent: "route-geometry",
    edits: proposal.edits,
    diagnostics: [],
    ...(proposal.expectedElectricalEffect
      ? { expectedElectricalEffect: proposal.expectedElectricalEffect }
      : {}),
  });
  const gate = gateRoutingOperationPlan(document, plan, context);
  if (!gate.ok) {
    throw new Error(
      `gate refused the move: ${gate.message} :: ${gate.diagnostics[0]?.message ?? ""}`,
    );
  }
  const result = executeTransaction(
    document,
    {
      transactionId: `move-${routeId}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: [...gate.edits],
    },
    context,
  );
  if (!result.ok) {
    throw new Error(
      `commit refused the move: ${result.error.message} :: ${result.diagnostics[0]?.message ?? ""}`,
    );
  }
  return result.document;
}

/** Base Nets that still carry conductor geometry, ignoring emptied records. */
function conductingNetIds(document: SchematicDocument): string[] {
  return [...new Set(document.routes.map((route) => route.netId))].sort();
}

/**
 * The electrical statement, insensitive to legitimate structural churn: which
 * Net each terminal belongs to, and how many Nets carry conductors. Route ids
 * and conductor counts are deliberately excluded — canonicalization may
 * materialize a branch vertex where a same-Net end rests on a conductor, which
 * splits a Route without changing what is connected to what.
 */
function netMembership(document: SchematicDocument): {
  conductingNets: number;
  terminals: Record<string, string>;
} {
  const terminals: Record<string, string> = {};
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      terminals[`${terminal.instanceId}.${terminal.pinName}`] = net.id;
    }
  }
  return { conductingNets: conductingNetIds(document).length, terminals };
}

function ambiguousJunctionErrors(document: SchematicDocument) {
  return diagnoseVisualQuality(document, resolver).filter(
    (diagnostic) => diagnostic.code === "VISUAL_AMBIGUOUS_JUNCTION",
  );
}

describe("moving a wire onto another wire", () => {
  it("joins the two Nets when an end lands on the other conductor", () => {
    const document = twoLooseWires();
    // The vertical wire's lower end sits at y = 160; drop it the 40 units
    // onto the horizontal wire at y = 200.
    const moved = moveLooseRoute(document, "wire-vertical", { x: 0, y: 40 });

    expect(conductingNetIds(moved)).toHaveLength(1);
    // Nothing is ambiguous any more, because the drawing and the model agree.
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });

  it("keeps crossing wires separate and says nothing about them", () => {
    const document = twoLooseWires();
    // Straddle the horizontal wire: the vertical one now spans y = 170..230,
    // so the two meet at (200, 200) — an interior point of both, with neither
    // end resting on anything. A crossing is not a junction, and that
    // invariant does not move.
    const moved = moveLooseRoute(document, "wire-vertical", { x: 0, y: 70 });
    const vertical = moved.routes.find((route) => route.id === "wire-vertical");
    const horizontal = moved.routes.find(
      (route) => route.id === "wire-horizontal",
    );

    expect(conductingNetIds(moved)).toHaveLength(2);
    expect(vertical?.netId).not.toBe(horizontal?.netId);
    // A legal crossing is not a finding either: nothing to warn about.
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });

  it("does not connect anything when a moved end lands on empty page", () => {
    // The guard against overshooting. "Deliberately put it there" must not
    // widen into "moved it at all": a wire dragged clear of everything keeps
    // exactly the connectivity it had.
    const document = twoLooseWires();
    const before = netMembership(document);
    const moved = moveLooseRoute(document, "wire-vertical", { x: 400, y: 0 });

    expect(netMembership(moved)).toEqual(before);
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });

  it("lets a connected component move instead of refusing the edit", () => {
    // Reported: a VDD port whose pin rests on a wire could not be nudged one
    // grid down — not "it moved and disconnected", but the whole edit refused
    // with "That edit would have changed which Nets these objects belong to".
    // Moving a part is allowed to change what it touches; that is the
    // author's intent, not an accident, and the guard exists to catch
    // accidents.
    const document = twoLooseWires();
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 240, y: 190 }, rotation: 0, mirror: "none" },
    } as SchematicDocument["instances"][number]);
    document.nets
      .find((net) => net.id === "net-horizontal")!
      .terminals.push({ instanceId: "VDD1", pinName: "P" });

    const plan = createRoutingOperationPlan(document, {
      intent: "transform",
      edits: [
        {
          kind: "move_instance",
          instanceId: "VDD1",
          position: { x: 240, y: 180 },
        },
      ],
      diagnostics: [],
    });
    const gate = gateRoutingOperationPlan(document, plan, context);

    expect(
      gate.ok,
      gate.ok ? "" : `${gate.message} :: ${gate.diagnostics[0]?.message ?? ""}`,
    ).toBe(true);
  });

  it("stays a no-op when a moved end lands on a conductor of its own Net", () => {
    // Second half of the same guard: landing on a wire already on this Net has
    // nothing to merge, so the move must not manufacture an edit or an error.
    const document = twoLooseWires();
    // Put both wires on one Net first, the way the model records an
    // already-joined pair, then move one end onto the other conductor.
    for (const route of document.routes) route.netId = "net-horizontal";
    for (const junction of document.junctions)
      junction.netId = "net-horizontal";
    document.nets = document.nets.filter((net) => net.id === "net-horizontal");
    const before = netMembership(document);
    const moved = moveLooseRoute(document, "wire-vertical", { x: 0, y: 40 });

    expect(netMembership(moved)).toEqual(before);
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });
});
