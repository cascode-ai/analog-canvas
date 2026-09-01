import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRoutingOperationPlan,
  evaluateRoutingOperationPlan,
  gateRoutingOperationPlan,
  executeTransaction,
  proposeVisualRouteDeletion,
} from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  constrainedPowerRailEndpoint,
  constructVddRailEdits,
  planVddRailEdits,
} from "./vdd-rail";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("drawn VDD rail construction", () => {
  it("uses the dominant snapped delta for horizontal and vertical gestures", () => {
    expect(
      constrainedPowerRailEndpoint({ x: 100, y: 100 }, { x: 180, y: 130 }),
    ).toEqual({ x: 180, y: 100 });
    expect(
      constrainedPowerRailEndpoint({ x: 100, y: 100 }, { x: 120, y: 190 }),
    ).toEqual({ x: 100, y: 190 });
  });

  it("uses one explicit VDD Net and one horizontal editable power rail", () => {
    const edits = constructVddRailEdits({
      instanceId: "VDD3",
      start: { x: 80, y: 40 },
      end: { x: 260, y: 40 },
    });

    expect(edits).toEqual([
      {
        kind: "add_power_rail",
        netId: "net-power-vdd3",
        routeId: "route-vdd3-rail",
        startJunctionId: "junction-vdd3-start",
        endJunctionId: "junction-vdd3-end",
        labelId: "label-VDD3",
        netName: "VDD",
        scope: "global",
        powerDomain: "vdd",
        start: { x: 80, y: 40 },
        end: { x: 260, y: 40 },
      },
    ]);
  });

  it("keeps the VDD label at the visual right end for a right-to-left draw", () => {
    const rail = constructVddRailEdits({
      instanceId: "VDD4",
      start: { x: 260, y: 40 },
      end: { x: 80, y: 40 },
    }).at(-1);

    expect(rail).toMatchObject({
      kind: "add_power_rail",
      startJunctionId: "junction-vdd4-start",
      endJunctionId: "junction-vdd4-end",
    });
  });

  it("does not reuse AVDD when constructing a VDD rail", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-avdd",

      terminals: [],
    });

    const plan = planVddRailEdits(document, {
      instanceId: "VDD1",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });

    expect(plan).toMatchObject({
      ok: true,
      netId: "net-power-vdd1",
      edits: [
        {
          kind: "add_power_rail",
          netId: "net-power-vdd1",
        },
        { kind: "set_mos_bulk_defaults", pmosNetId: "net-power-vdd1" },
        { kind: "reconcile_mos_bulk" },
      ],
    });
  });

  it("records the first explicitly drawn AVDD rail as the PMOS bulk default", () => {
    const document = createEmptyDocument("main", "Main");
    const plan = planVddRailEdits(document, {
      instanceId: "VDD1",
      netName: "AVDD",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const operation = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: plan.edits,
    });
    const evaluated = evaluateRoutingOperationPlan(document, operation, {
      symbolResolver: resolver,
    });
    if (!evaluated.ok) throw new Error(JSON.stringify(evaluated));
    expect(evaluated).toMatchObject({ ok: true });
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-avdd-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...plan.edits],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.mosBulkDefaults).toEqual({
      pmosNetId: plan.netId,
    });
  });

  it("commits the explicit VDD Net and visual rail in one transaction", () => {
    const document = createEmptyDocument("main", "Main");
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-vdd-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances).toEqual([]);
    expect(result.document.nets).toMatchObject([
      {
        id: "net-power-vdd1",
      },
    ]);
    expect(
      resolveDocumentLogicalNets(result.document).byBaseNetId.get(
        "net-power-vdd1",
      ),
    ).toMatchObject({ name: "VDD", powerDomain: "vdd", scope: "global" });
    expect(result.document.routes).toMatchObject([
      { presentation: "power-rail", netId: "net-power-vdd1" },
    ]);
    expect(result.document.junctions).toHaveLength(2);
    expect(result.document.annotations).toMatchObject([
      {
        kind: "power-label",
        binding: { kind: "net-name", netId: "net-power-vdd1" },
      },
    ]);
  });

  it("commits a vertical Power Rail with its label at the visual top end", () => {
    const document = createEmptyDocument("main", "Main");
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-vertical-power-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 80, y: 220 },
          end: { x: 80, y: 40 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toMatchObject([
      { presentation: "power-rail", netId: "net-power-vdd1" },
    ]);
    expect(result.document.annotations[0]).toMatchObject({
      anchor: {
        kind: "object",
        objectId: "junction-vdd1-end",
        fallbackPosition: { x: 90, y: 50 },
      },
      rotation: 0,
    });
  });

  it("adds rail geometry to an existing explicitly global VDD Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "pmos",
      mosBulkBinding: {
        origin: "supply-default",
        netId: "net-global-vdd",
      },
      placement: null,
    });
    document.nets.push({
      id: "net-global-vdd",

      terminals: [{ instanceId: "M1", pinName: "B" }],
    });

    const result = executeTransaction(
      document,
      {
        transactionId: "reuse-vdd-supply",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD2",
          netId: "net-global-vdd",
          scope: "global",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets).toHaveLength(1);
    expect(result.document.nets[0]).toMatchObject({
      id: "net-global-vdd",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    expect(result.document.routes).toContainEqual(
      expect.objectContaining({
        netId: "net-global-vdd",
        presentation: "power-rail",
      }),
    );
  });

  it("deletes a power rail with its label and rail-only junctions", () => {
    const document = createEmptyDocument("main", "Main");
    const created = executeTransaction(
      document,
      {
        transactionId: "create-vdd-rail-for-delete",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: constructVddRailEdits({
          instanceId: "VDD1",
          start: { x: 40, y: 20 },
          end: { x: 180, y: 20 },
        }),
      },
      { symbolResolver: resolver },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const proposal = proposeVisualRouteDeletion(
      created.document,
      ["route-vdd1-rail"],
      [],
    );
    expect(proposal.edits[0]).toEqual({
      kind: "remove_schematic_annotation",
      annotationId: "label-VDD1",
    });
    const deleted = executeTransaction(
      created.document,
      {
        transactionId: "delete-vdd-rail",
        documentId: document.id,
        expectedRevision: created.document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );

    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.document.routes).toEqual([]);
    expect(deleted.document.junctions).toEqual([]);
    expect(deleted.document.annotations).toEqual([]);
    expect(deleted.document.nets).toEqual([]);
  });

  it("keeps a rail Base Net separate while joining the Port's AVDD Logical Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-port-avdd",

      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-port-avdd",
      kind: "name-claim",
      netId: "net-port-avdd",
      name: "AVDD",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
      scope: "global",
      powerDomain: "vdd",
    });
    const first = planVddRailEdits(document, {
      instanceId: "VDD1",
      netName: "AVDD",
      start: { x: 40, y: 20 },
      end: { x: 180, y: 20 },
    });
    expect(first).toMatchObject({
      ok: true,
      netId: "net-power-vdd1",
      edits: [
        {
          kind: "add_power_rail",
          netId: "net-power-vdd1",
          netName: "AVDD",
          scope: "global",
        },
        { kind: "set_mos_bulk_defaults", pmosNetId: "net-power-vdd1" },
        { kind: "reconcile_mos_bulk" },
      ],
    });
  });
});

describe("a drawn rail meeting an existing wire", () => {
  /**
   * The routing fixture's ports, repositioned so route-h spans exactly
   * (0,300) → (110,300): an ordinary conductor with real pin endpoints.
   */
  function documentWithWire(): SchematicDocument {
    const document = parseProject(
      readFileSync(
        resolve(
          process.cwd(),
          "fixtures/projects/phase-3-routing/project.icproj.json",
        ),
        "utf8",
      ),
    ).documents[0]!;
    document.instances.find((instance) => instance.id === "A")!.placement = {
      position: { x: -10, y: 300 },
      rotation: 0,
      mirror: "none",
    };
    document.instances.find((instance) => instance.id === "B")!.placement = {
      position: { x: 120, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    const wired = executeTransaction(
      document,
      {
        transactionId: "seed-route",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "set_route_path",
            route: createRoutePath({
              id: "route-h",
              netId: "net-h",
              start: { kind: "terminal", instanceId: "A", pinName: "P" },
              end: { kind: "terminal", instanceId: "B", pinName: "P" },
              bends: [],
              modes: ["manual"],
            }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!wired.ok) throw new Error(wired.error.message);
    return wired.document;
  }

  /** Drive the rail exactly as the editor does: plan, gate, then commit. */
  function drawRail(
    document: SchematicDocument,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const plan = planVddRailEdits(
      document,
      { instanceId: "VDD1", start, end },
      resolver,
    );
    if (!plan.ok) throw new Error(plan.message);
    const operation = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: plan.edits,
      ...(plan.expectedElectricalEffect
        ? { expectedElectricalEffect: plan.expectedElectricalEffect }
        : {}),
    });
    const evaluated = gateRoutingOperationPlan(document, operation, {
      symbolResolver: resolver,
    });
    if (!evaluated.ok) return { gate: evaluated, document: null };
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...evaluated.edits],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    return { gate: evaluated, document: result.document };
  }

  const wireNetId = (document: SchematicDocument) =>
    document.nets.find((net) =>
      net.terminals.some((terminal) => terminal.instanceId === "A"),
    )?.id;

  it("connects when the rail ENDPOINT lands on the wire", () => {
    // The rail runs down from above and stops exactly on the wire.
    const { gate, document } = drawRail(
      documentWithWire(),
      { x: 50, y: 200 },
      { x: 50, y: 300 },
    );
    expect(gate.ok).toBe(true);
    if (!document) return;
    const railEnd = document.junctions.find(
      (junction) => junction.id === "junction-vdd1-end",
    );
    expect(railEnd).toBeDefined();
    // One conductor family: the wire's pins and the rail's endpoint share a
    // Base Net, exactly as a pin dropped onto a wire does.
    expect(railEnd!.netId).toBe(wireNetId(document));
  });

  it("keeps a rail that CROSSES the wire electrically separate", () => {
    // Same gesture, but the rail passes through and continues below: a
    // crossing is not a connection and must never become one.
    const { gate, document } = drawRail(
      documentWithWire(),
      { x: 50, y: 200 },
      { x: 50, y: 400 },
    );
    expect(gate.ok).toBe(true);
    if (!document) return;
    const railEnd = document.junctions.find(
      (junction) => junction.id === "junction-vdd1-end",
    );
    expect(railEnd!.netId).toBe("net-power-vdd1");
    expect(railEnd!.netId).not.toBe(wireNetId(document));
  });
});

describe("a rail drawn across the ends of existing wires", () => {
  /**
   * Two vertical wires standing side by side, each on its own Net, with loose
   * upper ends level at y = 100 — the drawing a bus is normally added to.
   */
  function twoStandingWires(): SchematicDocument {
    const document = createEmptyDocument("rail-over-ends", "Rail over ends");
    document.presentation.grid = 10;
    for (const [index, x] of [100, 200].entries()) {
      const netId = `net-w${index}`;
      document.nets.push({ id: netId, terminals: [] });
      document.junctions.push(
        {
          id: `W${index}-top`,
          netId,
          position: { x, y: 100 },
          role: "route-anchor",
        },
        {
          id: `W${index}-bottom`,
          netId,
          position: { x, y: 200 },
          role: "route-anchor",
        },
      );
      document.routes.push(
        createRoutePath({
          id: `wire-${index}`,
          netId,
          start: { kind: "junction", junctionId: `W${index}-top` },
          end: { kind: "junction", junctionId: `W${index}-bottom` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    return document;
  }

  function drawRail(
    document: SchematicDocument,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const plan = planVddRailEdits(
      document,
      { instanceId: "VDD1", start, end },
      resolver,
    );
    if (!plan.ok) throw new Error(plan.message);
    const operation = createRoutingOperationPlan(document, {
      intent: "connect",
      diagnostics: [],
      edits: plan.edits,
      ...(plan.expectedElectricalEffect
        ? { expectedElectricalEffect: plan.expectedElectricalEffect }
        : {}),
    });
    const gate = gateRoutingOperationPlan(document, operation, {
      symbolResolver: resolver,
    });
    if (!gate.ok) return { gate, document: null };
    const result = executeTransaction(
      document,
      {
        transactionId: "draw-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...gate.edits],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    return { gate, document: result.document };
  }

  it("joins every wire whose END rests on the rail", () => {
    // The mirror of the endpoint rule #469 established: there the rail's end
    // landed on a wire, here the wires' ends land on the rail. The gesture is
    // the same deliberate act, so the refusal — "That edit would have changed
    // which Nets these objects belong to" — was wrong in both directions.
    const { gate, document } = drawRail(
      twoStandingWires(),
      { x: 60, y: 100 },
      { x: 240, y: 100 },
    );
    expect(
      gate.ok,
      gate.ok ? "" : `${gate.message} :: ${gate.diagnostics[0]?.message ?? ""}`,
    ).toBe(true);
    if (!document) return;
    const netIds = new Set(document.routes.map((route) => route.netId));
    expect(netIds.size).toBe(1);
  });

  it("leaves a wire the rail merely crosses on its own Net", () => {
    // Same rail, drawn across the wires' MIDDLES instead of their ends. Two
    // conductors meeting at an interior point of both say nothing about
    // intent, so nothing connects — a Crossing is not a Junction.
    const { gate, document } = drawRail(
      twoStandingWires(),
      { x: 60, y: 150 },
      { x: 240, y: 150 },
    );
    expect(gate.ok).toBe(true);
    if (!document) return;
    const wireNetIds = new Set(
      document.routes
        .filter((route) => route.id.startsWith("wire-"))
        .map((route) => route.netId),
    );
    expect(wireNetIds).toEqual(new Set(["net-w0", "net-w1"]));
  });

  it("does not adopt a PIN that happens to rest on the rail", () => {
    // The line this rule deliberately does not cross. A drawn wire's end is
    // unambiguously an end, so the rail adopts it. A *pin* resting under a
    // rail is the abbreviated idiom the Gallery contract welcomes and
    // diagnoseVisualQuality grades a warning rather than an error — a corpus
    // sweep found it in published schematics. Adopting it here would rewire
    // drawings that already exist, so only junctions are collected.
    //
    // Asserted on its own rather than left implicit in the collection code:
    // the whole risk is that a later reader "completes" the symmetry.
    const document = twoStandingWires();
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      // Pin 1 sits 20 above the body, so the body at y = 120 rests its pin
      // exactly on the rail's line at y = 100, between the two wires.
      placement: { position: { x: 150, y: 120 }, rotation: 0, mirror: "none" },
    } as SchematicDocument["instances"][number]);
    document.nets.push({
      id: "net-resistor",
      terminals: [{ instanceId: "R1", pinName: "1" }],
    });

    // Non-vacuous: the pin really is on the rail's line, so a rule that
    // adopted resting pins would have taken this one.
    const pin = resolver
      .resolve("resistor")!
      .definition.pins.find((candidate) => candidate.name === "1")!;
    expect({ x: 150 + pin.at.x, y: 120 + pin.at.y }).toEqual({
      x: 150,
      y: 100,
    });

    const { gate, document: after } = drawRail(
      document,
      { x: 60, y: 100 },
      { x: 240, y: 100 },
    );
    expect(gate.ok).toBe(true);
    if (!after) return;
    const restingNet = after.nets.find((net) =>
      net.terminals.some((terminal) => terminal.instanceId === "R1"),
    );
    const railNet = after.routes.find((route) =>
      route.id.startsWith("route-vdd1"),
    )?.netId;
    expect(restingNet?.id).toBe("net-resistor");
    expect(restingNet?.id).not.toBe(railNet);
  });
});
