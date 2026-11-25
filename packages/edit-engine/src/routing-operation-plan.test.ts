import {
  createEmptyDocument,
  createEmptyProject,
  type SchematicDocument,
  createRoutePath,
  freezeSnapshot,
  shareEqualDocumentStructure,
} from "@icm/model";
import { buildProjectConnectivityIndex } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  createRoutingOperationPlan,
  evaluateRoutingOperationPlan,
  gateRoutingOperationPlan,
  gateCanvasRoutingOperation,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import { proposeWireIntent } from "./wire-intent-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function canvasGate(document: SchematicDocument, plan: RoutingOperationPlan) {
  const project = createEmptyProject("drawing", "Drawing", document.id);
  project.documents = [document];
  buildProjectConnectivityIndex(freezeSnapshot(project), resolver);
  return gateCanvasRoutingOperation(document, plan, {
    symbolResolver: resolver,
  });
}

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

  it.each([
    null,
    { kind: "add_instance" },
    { kind: "set_route_path" },
    { kind: "attach_endpoint_to_route" },
  ])(
    "reports invalid Wire edits and prioritizes source and planner refusals (%j)",
    (edit) => {
      const document = freezeSnapshot(twoNetDocument());
      const plan = createRoutingOperationPlan(document, {
        intent: "connect",
        diagnostics: [],
        edits: [],
        expectedElectricalEffect: { kind: "preserve", endpointKeys: [] },
      });
      // The transaction schema owns invalid input. Exercise the runtime boundary.
      const invalid = {
        ...plan,
        edits: [edit] as unknown as typeof plan.edits,
      };
      const blocking = [
        {
          code: "PLANNER_ERROR",
          severity: "error" as const,
          message: "Wire is blocked",
        },
      ];
      for (const [proposal, message] of [
        [invalid, "Transaction schema validation failed"],
        [{ ...invalid, diagnostics: blocking }, "Wire is blocked"],
        [
          {
            ...invalid,
            diagnostics: blocking,
            source: { ...invalid.source, revision: 1 },
          },
          "Routing operation is stale",
        ],
        [
          { ...invalid, source: { ...invalid.source, documentId: "another" } },
          "Routing operation targets another Cell",
        ],
      ] as const) {
        const outcome = canvasGate(document, proposal);
        expect(outcome).toMatchObject({ ok: false, message });
        expect(outcome).toEqual(gateRoutingOperationPlan(document, proposal));
      }
    },
  );

  it("reports the full merge mismatch for a malformed declaration on valid edits", () => {
    const document = twoNetDocument();
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        { kind: "merge_nets", sourceNetId: "net-b", targetNetId: "net-a" },
      ],
      expectedElectricalEffect: {
        kind: "merge",
        endpointGroups: [[1 as unknown as string]],
      },
    });
    const outcome = canvasGate(document, plan);
    expect(outcome).toMatchObject({
      ok: false,
      message: "Routing merge did not join endpoint group 1",
    });
    expect(outcome).toEqual(
      gateRoutingOperationPlan(structuredClone(document), plan, {
        symbolResolver: resolver,
      }),
    );
  });

  it("matches full preservation for an explicit declaration containing a non-string key", () => {
    const document = twoNetDocument();
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "M1",
            symbolId: "nmos",
            reference: "M1",
            placement: null,
          },
        },
      ],
      expectedElectricalEffect: {
        kind: "preserve",
        endpointKeys: [1 as unknown as string],
      },
    });
    const result = canvasGate(document, plan);
    const full = gateRoutingOperationPlan(structuredClone(document), plan, {
      symbolResolver: resolver,
    });
    expect(result.ok && full.ok).toBe(true);
    if (result.ok && full.ok)
      expect(result.evaluated.finalDocument).toEqual(
        full.evaluated.finalDocument,
      );
  });

  it("commits a scalar Wire with the same final conductors as the complete evaluation", () => {
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
    const fast = canvasGate(document, plan);
    const oracle = evaluateRoutingOperationPlan(
      structuredClone(document),
      plan,
    );
    expect(fast.ok && oracle.ok).toBe(true);
    if (!fast.ok || !oracle.ok) return;
    expect(fast.evaluated.finalDocument).toEqual(oracle.value.finalDocument);
    expect(fast.evaluated.finalDocument.nets.map((net) => net.id)).toEqual([
      "net-a",
    ]);
  });

  it("refuses a third conductor named by a scalar Wire at the same boundary as the full evaluator", () => {
    const document = twoNetDocument();
    document.nets.push({ id: "offscreen", terminals: [] });
    document.junctions.push({
      id: "far",
      netId: "offscreen",
      position: { x: 4000, y: 0 },
    });
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        { kind: "merge_nets", sourceNetId: "net-b", targetNetId: "net-a" },
      ],
      expectedElectricalEffect: {
        kind: "merge",
        endpointGroups: [["junction:J1", "junction:J2", "junction:far"]],
      },
    });
    const gate = canvasGate(document, plan);
    expect(gate).toMatchObject({
      ok: false,
      diagnostics: [{ code: "ELECTRICAL_EFFECT_MISMATCH" }],
    });
    expect(gate).toEqual(
      evaluateRoutingOperationPlan(structuredClone(document), plan),
    );
  });

  it("keeps an independent crossing separate when the Wire planner joins two local Nets", () => {
    const document = twoNetDocument();
    document.junctions[0]!.position = { x: 0, y: -70 };
    document.junctions[1]!.position = { x: 0, y: 70 };
    document.nets.push({ id: "crossing", terminals: [] });
    document.junctions.push(
      { id: "west", netId: "crossing", position: { x: -40, y: 0 } },
      { id: "east", netId: "crossing", position: { x: 40, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "crossbar",
        netId: "crossing",
        start: { kind: "junction", junctionId: "west" },
        end: { kind: "junction", junctionId: "east" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const wire = proposeWireIntent(document, resolver, {
      id: "vertical",
      from: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "J1" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "J2" },
      },
    });
    if (typeof wire === "string") throw new Error(wire);
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      edits: wire.edits,
      diagnostics: [],
    });
    const result = canvasGate(document, plan);
    const full = gateRoutingOperationPlan(structuredClone(document), plan, {
      symbolResolver: resolver,
    });
    expect(result.ok && full.ok).toBe(true);
    if (!result.ok || !full.ok) return;
    expect(result.evaluated.finalDocument).toEqual(
      full.evaluated.finalDocument,
    );
    expect(
      result.evaluated.finalDocument.routes.find(
        (route) => route.id === "crossbar",
      ),
    ).toEqual(document.routes[0]);
    expect(result.evaluated.finalDocument.nets.map((net) => net.id)).toContain(
      "crossing",
    );
    const joined = result.evaluated.finalDocument.junctions
      .filter((j) => j.id === "J1" || j.id === "J2")
      .map((j) => j.netId);
    expect(joined).toHaveLength(2);
    expect(joined[1]).toBe(joined[0]);
    expect(joined[0]).not.toBe("crossing");
  });

  it.each(["global", "bus", "hierarchy"] as const)(
    "matches the complete evaluator for a %s connection",
    (kind) => {
      const document = twoNetDocument();
      let edits: RoutingOperationPlan["edits"];
      if (kind === "global") {
        document.connectivityEvidence.push({
          id: "vdd",
          kind: "name-claim",
          netId: "net-a",
          name: "VDD",
          scope: "global",
          owner: { kind: "power-marker", objectId: "J1" },
        });
        edits = [
          { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
          {
            kind: "connect_endpoints",
            from: { kind: "junction", junctionId: "J1" },
            to: { kind: "junction", junctionId: "J2" },
          },
        ];
      } else if (kind === "bus") {
        edits = [
          {
            kind: "add_junction",
            netId: "net-a",
            junctionId: "bus",
            position: { x: 40, y: 20 },
            members: [
              { id: "a", netId: "net-a" },
              { id: "b", netId: "net-b" },
            ],
          },
        ];
      } else {
        edits = [
          {
            kind: "add_instance",
            instance: {
              id: "X1",
              reference: "X1",
              symbolId: "nmos",
              placement: {
                position: { x: 300, y: 300 },
                rotation: 0,
                mirror: "none",
              },
              netlist: {
                binding: { kind: "subcircuit", childDocumentId: "child" },
                parameters: {},
              },
            },
          },
        ];
      }
      const plan = createRoutingOperationPlan(document, {
        intent: "connect",
        edits,
        diagnostics: [],
      });
      const outcome = canvasGate(document, plan);
      const full = gateRoutingOperationPlan(structuredClone(document), plan, {
        symbolResolver: resolver,
      });
      expect(outcome.ok && full.ok).toBe(true);
      if (!full.ok || !outcome.ok) return;
      expect(outcome.evaluated.finalDocument).toEqual(
        full.evaluated.finalDocument,
      );
    },
  );

  it("includes an off-path child terminal's old Net when a reroute gains physical contact", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "a", terminals: [] },
      { id: "z", terminals: [{ instanceId: "X1", pinName: "G" }] },
    );
    document.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: "nmos",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    document.junctions.push(
      { id: "L", netId: "a", position: { x: 0, y: 0 } },
      { id: "R", netId: "a", position: { x: 100, y: 0 } },
      { id: "hit", netId: "z", position: { x: 50, y: 0 } },
    );
    const route = (bends: { x: number; y: number }[]) =>
      createRoutePath({
        id: "wire",
        netId: "a",
        start: { kind: "junction", junctionId: "L" },
        end: { kind: "junction", junctionId: "R" },
        bends,
        modes: bends.map(() => "manual" as const).concat("manual"),
      });
    document.routes.push(
      route([
        { x: 0, y: 30 },
        { x: 100, y: 30 },
      ]),
    );
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [{ kind: "set_route_path", route: route([]) }],
    });
    const result = canvasGate(document, plan);
    const oracle = gateRoutingOperationPlan(structuredClone(document), plan, {
      symbolResolver: resolver,
    });
    expect(result.ok && oracle.ok).toBe(true);
    if (!result.ok || !oracle.ok) return;
    const after = result.evaluated.finalDocument;
    expect(after).toEqual(oracle.evaluated.finalDocument);
    expect(after.nets).toEqual([
      { id: "a", terminals: [{ instanceId: "X1", pinName: "G" }] },
    ]);
    const affected = new Set<string>();
    shareEqualDocumentStructure(document, after, affected);
    expect(affected).toEqual(new Set(["a", "z"]));
  });

  it("includes the implicit global body connection when the placed MOS gate joins a local Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "a", terminals: [] }, { id: "z", terminals: [] });
    document.junctions.push({ id: "L", netId: "a", position: { x: 0, y: 0 } });
    document.mosBulkDefaults = { nmosNetId: "z" };
    document.connectivityEvidence.push(
      { id: "src", kind: "spice-source", netId: "z", sourceNetId: "GND" },
      {
        id: "gnd",
        kind: "name-claim",
        netId: "z",
        name: "GND",
        scope: "global",
        owner: { kind: "global-declaration", sourceNetId: "GND" },
      },
    );
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "M1",
            symbolId: "nmos",
            reference: "M1",
            placement: null,
            mosBulkBinding: { origin: "cell-default", netId: "z" },
          },
        },
        {
          kind: "connect_endpoints",
          from: { kind: "junction", junctionId: "L" },
          to: { kind: "terminal", instanceId: "M1", pinName: "G" },
        },
      ],
    });
    const result = canvasGate(document, plan);
    const oracle = gateRoutingOperationPlan(structuredClone(document), plan, {
      symbolResolver: resolver,
    });
    expect(result.ok && oracle.ok).toBe(true);
    if (!result.ok || !oracle.ok) return;
    const after = result.evaluated.finalDocument;
    expect(after).toEqual(oracle.evaluated.finalDocument);
    expect(after.nets).toEqual([
      { id: "a", terminals: [{ instanceId: "M1", pinName: "G" }] },
      { id: "z", terminals: [{ instanceId: "M1", pinName: "B" }] },
    ]);
    const affected = new Set<string>();
    shareEqualDocumentStructure(document, after, affected);
    expect(affected).toEqual(new Set(["a", "z"]));
  });

  it("checks old memberships when the candidate moves an endpoint despite a preserve declaration", () => {
    const document = freezeSnapshot(twoNetDocument());
    const plan = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: [
        { kind: "merge_nets", sourceNetId: "net-b", targetNetId: "net-a" },
      ],
    });
    const gate = canvasGate(document, plan);
    expect(gate).toMatchObject({
      ok: false,
      diagnostics: [{ code: "ELECTRICAL_EFFECT_MISMATCH" }],
    });
    expect(gate).toEqual(
      evaluateRoutingOperationPlan(structuredClone(document), plan),
    );
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
    const canvas = canvasGate(document, plan);
    expect(canvas.ok && canvas.evaluated.finalDocument).toEqual(
      gate.evaluated.finalDocument,
    );
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
  /**
   * A preserve declaration is derived, and `disconnect_endpoint` changes what
   * it can honestly say.
   *
   * The guard exists to catch membership that moved by accident. An endpoint
   * the edits explicitly release did not move by accident — the primitive
   * says so, and the transaction already reads it that way when it suppresses
   * the normalization that would reconnect it. Naming such an endpoint in the
   * preserve set makes the guard refuse the one operation that was explicit,
   * which is what stopped a wire end from being re-pointed off its pin.
   */
  describe("what a derived preserve declaration names", () => {
    function pinnedDocument() {
      const document = createEmptyDocument("main", "Main");
      document.instances.push({
        id: "VDD1",
        symbolId: "vdd-port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      } as (typeof document)["instances"][number]);
      document.nets.push({
        id: "net-a",
        terminals: [{ instanceId: "VDD1", pinName: "P" }],
      });
      document.junctions.push({
        id: "J1",
        netId: "net-a",
        position: { x: 100, y: 20 },
      });
      return document;
    }

    it("leaves out an endpoint the edits explicitly release", () => {
      const document = pinnedDocument();
      const plan = createRoutingOperationPlan(document, {
        intent: "route-geometry",
        diagnostics: [],
        edits: [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
          },
        ],
      });

      expect(plan.expectedElectricalEffect).toEqual({
        kind: "preserve",
        endpointKeys: ["junction:J1"],
      });
      const gate = gateRoutingOperationPlan(document, plan, {
        symbolResolver: resolver,
      });
      expect(
        gate.ok,
        gate.ok ? "" : `${gate.message} :: ${gate.diagnostics[0]?.message}`,
      ).toBe(true);
    });

    it("still names every endpoint the edits did not release", () => {
      // The guard is not weakened, only made honest: a second pin that was
      // never disconnected is still declared preserved, so membership that
      // moves without saying so is still caught.
      const document = pinnedDocument();
      document.nets[0]!.terminals.push({ instanceId: "VDD1", pinName: "Q" });
      const plan = createRoutingOperationPlan(document, {
        intent: "route-geometry",
        diagnostics: [],
        edits: [
          {
            kind: "disconnect_endpoint",
            endpoint: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
          },
        ],
      });

      const effect = plan.expectedElectricalEffect;
      expect(effect.kind).toBe("preserve");
      if (effect.kind !== "preserve") return;
      expect([...effect.endpointKeys].sort()).toEqual([
        "junction:J1",
        "terminal:VDD1:Q",
      ]);
    });
  });
});
