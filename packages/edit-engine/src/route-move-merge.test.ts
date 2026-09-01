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
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { diagnoseVisualQuality } from "@icm/derived";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  proposeEndpointRouteAttachment,
  proposeLooseRouteTranslation,
} from "./routing-planner.js";
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
  // No declaration is threaded through: the gate derives the join from the
  // attach primitive in the edits, which is the whole point of the move.
  const plan = createRoutingOperationPlan(document, {
    intent: "route-geometry",
    edits: proposal.edits,
    diagnostics: [],
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

  it("declares the join an attach performs, so a pin can be dragged onto a wire", () => {
    // The move controller already emits attach_endpoint_to_route when a
    // dragged pin lands on a conductor, but the effect derivation read merge
    // only from connect_endpoints. Every attach therefore declared "preserve"
    // while performing a join, and the gate refused the gesture with "That
    // edit would have changed which Nets these objects belong to" — the pin
    // would not land, and the part could not be placed where the author put
    // it.
    const document = twoLooseWires();
    document.instances.push({
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 150, y: 180 }, rotation: 0, mirror: "none" },
    } as SchematicDocument["instances"][number]);
    document.nets.push({
      id: "net-vdd",
      terminals: [{ instanceId: "VDD1", pinName: "P" }],
    });

    const attachment = proposeEndpointRouteAttachment(
      document,
      { kind: "terminal", instanceId: "VDD1", pinName: "P" },
      "net-vdd",
      "wire-horizontal",
      { x: 150, y: 200 },
      0,
      "t2",
    );
    const plan = createRoutingOperationPlan(document, {
      intent: "attach-to-route",
      edits: attachment.edits,
      diagnostics: [],
    });
    const gate = gateRoutingOperationPlan(document, plan, context);

    expect(
      gate.ok,
      gate.ok ? "" : `${gate.message} :: ${gate.diagnostics[0]?.message ?? ""}`,
    ).toBe(true);
    // The declaration is derived, not hand-written: it names the attached
    // endpoint together with the conductor it joins.
    expect(plan.expectedElectricalEffect).toMatchObject({ kind: "merge" });
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

describe("a pin resting on a conductor, in published drawings", () => {
  /**
   * Dragging a pin onto a wire connects it — that is a gesture. A pin that
   * merely RESTS on a conductor in a drawing someone already published is not
   * a gesture and must stay unconnected: the Gallery contract welcomes
   * abbreviated schematics, and `diagnoseVisualQuality` grades the idiom a
   * warning rather than an error for exactly that reason.
   *
   * Asserted against real published circuits rather than a synthetic case,
   * because the risk being guarded is "we silently rewired drawings that
   * already exist".
   */
  const corpus = resolve(process.cwd(), "fixtures/gallery-redline");
  const files = readdirSync(corpus).filter((name) =>
    name.endsWith(".icproj.json"),
  );

  it("finds the idiom in the corpus at all", () => {
    // A guard on the guard: if the corpus ever stops containing a resting
    // pin, the assertion below would pass vacuously and prove nothing.
    const resting = files.flatMap((file) =>
      parseProject(
        readFileSync(resolve(corpus, file), "utf8"),
      ).documents.flatMap((document) =>
        diagnoseVisualQuality(document, resolver).filter(
          (finding) => finding.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
        ),
      ),
    );
    expect(resting.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: a resting pin is still not a member", (file) => {
    const project = parseProject(readFileSync(resolve(corpus, file), "utf8"));
    for (const document of project.documents) {
      const findings = diagnoseVisualQuality(document, resolver).filter(
        (finding) => finding.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
      );
      for (const finding of findings) {
        const [instanceId, routeId] = finding.objectIds ?? [];
        const route = document.routes.find(
          (candidate) => candidate.id === routeId,
        );
        const restingNet = document.nets.find((net) =>
          net.terminals.some((terminal) => terminal.instanceId === instanceId),
        );
        // The finding exists precisely because the pin is NOT on the
        // conductor's Net. If these ever coincided, the drawing would have
        // been rewired underneath its author.
        expect(restingNet?.id).not.toBe(route?.netId);
      }
    }
  });
});

/**
 * Two wire ENDS brought head to head in mid-air.
 *
 * The same rule as landing on a conductor, seen from the case where neither
 * point lies in the other's span. Butting two ends together is the commonest
 * way to join wires while drawing, and it is *more* deliberate than dropping
 * an end on a wire's middle, not less. Before this rule the move merged
 * nothing and flagged the meeting point ambiguous from both sides at once.
 */
function twoHeadToHeadWires(): SchematicDocument {
  const document = createEmptyDocument("head-to-head", "Head to head");
  document.presentation.grid = 10;
  document.nets.push(
    { id: "net-left", terminals: [] },
    { id: "net-right", terminals: [] },
  );
  document.junctions.push(
    {
      id: "L1",
      netId: "net-left",
      position: { x: 100, y: 200 },
      role: "route-anchor",
    },
    {
      id: "L2",
      netId: "net-left",
      position: { x: 200, y: 200 },
      role: "route-anchor",
    },
    {
      id: "R1",
      netId: "net-right",
      position: { x: 260, y: 200 },
      role: "route-anchor",
    },
    {
      id: "R2",
      netId: "net-right",
      position: { x: 360, y: 200 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "wire-left",
      netId: "net-left",
      start: { kind: "junction", junctionId: "L1" },
      end: { kind: "junction", junctionId: "L2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "wire-right",
      netId: "net-right",
      start: { kind: "junction", junctionId: "R1" },
      end: { kind: "junction", junctionId: "R2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

describe("bringing two wire ends head to head", () => {
  it("joins the two Nets when the ends meet in mid-air", () => {
    // The right wire starts at x = 260; slide it 60 left so its start lands
    // exactly on the left wire's end at (200, 200). Neither point is in the
    // other's span: this is end against end.
    const moved = moveLooseRoute(twoHeadToHeadWires(), "wire-right", {
      x: -60,
      y: 0,
    });

    expect(conductingNetIds(moved)).toHaveLength(1);
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });

  it("still refuses to merge two wires that merely cross", () => {
    // The brake, restated for this path: the vertical wire now spans
    // y = 170..230 across the horizontal one, touching at an interior point
    // of both with neither end resting on anything.
    const moved = moveLooseRoute(twoLooseWires(), "wire-vertical", {
      x: 0,
      y: 70,
    });

    expect(conductingNetIds(moved)).toHaveLength(2);
    expect(ambiguousJunctionErrors(moved)).toEqual([]);
  });

  it("refuses to retire a name when two named Nets are butted together", () => {
    const document = twoHeadToHeadWires();
    // The author labelled both sides, which is how they say the two are NOT
    // the same node. Touching the ends cannot quietly discard one of the
    // names, so this stays two Nets and keeps its ambiguity finding.
    for (const [netId, name] of [
      ["net-left", "VBST"],
      ["net-right", "VGN"],
    ] as const) {
      document.annotations.push({
        id: `label-${netId}`,
        kind: "net-label",
        binding: { kind: "net-name", netId },
        netId,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: `claim-${netId}`,
        kind: "name-claim",
        netId,
        name,
        owner: { kind: "net-label", annotationId: `label-${netId}` },
        scope: "local",
      });
    }

    const moved = moveLooseRoute(document, "wire-right", { x: -60, y: 0 });

    expect(conductingNetIds(moved)).toHaveLength(2);
  });

  it("leaves the joined conductor's connectivity alone when it moves again", () => {
    const joined = moveLooseRoute(twoHeadToHeadWires(), "wire-right", {
      x: -60,
      y: 0,
    });
    expect(conductingNetIds(joined)).toHaveLength(1);
    // The two collinear wires are one conductor now, so the id to move next
    // is whatever canonicalization left behind rather than either original.
    const joinedRouteId = joined.routes[0]!.id;

    // Moving it must neither split the Net nor invent a second join.
    const movedAgain = moveLooseRoute(joined, joinedRouteId, { x: 0, y: -40 });
    expect(conductingNetIds(movedAgain)).toHaveLength(1);
    expect(ambiguousJunctionErrors(movedAgain)).toEqual([]);
  });
});
