import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DocumentHistory,
  proposePowerRailTranslation,
  proposePowerRailEndpointResize,
  type ExpectedElectricalEffect,
  type SchematicEdit,
  createRoutingOperationPlan,
  evaluateRoutingOperationPlan,
  gateRoutingOperationPlan,
  executeTransaction,
  proposeVisualRouteDeletion,
} from "@icm/edit-engine";
import {
  derivePowerRailComponent,
  resolveRouteGeometry,
  resolveEndpointConnection,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import {
  createEmptyDocument,
  createEmptyProject,
  routeEnd,
  createRoutePath,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  constrainedPowerRailEndpoint,
  constructVddRailEdits,
  planVddRailEdits,
} from "./vdd-rail";

import {
  analyzeDesignNetlist,
  printSpiceNetlist,
  printSpectreNetlist,
} from "@icm/netlist";

const resolver = new InMemorySymbolResolver(
  builtInSymbols.map((symbol) =>
    symbol.id === "resistor"
      ? {
          ...symbol,
          variants: [
            ...(symbol.variants ?? []),
            {
              id: "offgrid-top",
              hiddenPinNames: [],
              auxiliaryPins: [
                {
                  name: "1",
                  at: { x: 0, y: -16 },
                  direction: "north" as const,
                  routing: {
                    escape: "outward" as const,
                    preferredLanding: { x: 0, y: -20 },
                  },
                },
              ],
            },
          ],
        }
      : symbol,
  ),
);

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
        scope: "local",
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
    ).toMatchObject({ name: "VDD", powerDomain: "vdd", scope: "local" });
    expect(result.document.routes).toMatchObject([
      { presentation: "power-rail", netId: "net-power-vdd1" },
    ]);
    expect(result.document.junctions).toHaveLength(2);
    expect(result.document.annotations).toMatchObject([
      {
        kind: "power-label",
        binding: {
          kind: "cell-terminal-name",
          terminalId: expect.any(String),
        },
      },
    ]);
    expect(result.document.netlist?.terminals).toEqual([
      expect.objectContaining({
        name: "VDD",
        netId: "net-power-vdd1",
        direction: "inout",
        interfaceInstanceIds: [],
        interfaceAnnotationId: "label-VDD1",
      }),
    ]);
  });

  it("renames the local Rail terminal and its owned name claim atomically", () => {
    const document = createEmptyDocument("main", "Main");
    const created = executeTransaction(document, {
      transactionId: "draw-vdd-rail",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: constructVddRailEdits({
        instanceId: "VDD1",
        start: { x: 40, y: 20 },
        end: { x: 180, y: 20 },
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const terminal = created.document.netlist!.terminals[0]!;

    const renamed = executeTransaction(created.document, {
      transactionId: "rename-vdd-rail",
      documentId: created.document.id,
      expectedRevision: created.document.revision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "update_cell_terminal",
          terminalId: terminal.id,
          name: "AVDD",
        },
      ],
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.document.netlist?.terminals[0]?.name).toBe("AVDD");
    expect(renamed.document.connectivityEvidence).toContainEqual(
      expect.objectContaining({
        kind: "name-claim",
        name: "AVDD",
        owner: { kind: "power-marker", objectId: "label-VDD1" },
      }),
    );
    expect(
      resolveDocumentLogicalNets(renamed.document).byBaseNetId.get(
        "net-power-vdd1",
      ),
    ).toMatchObject({ name: "AVDD", powerDomain: "vdd", scope: "local" });
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
    expect(proposal.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "remove_cell_terminal" }),
        {
          kind: "remove_schematic_annotation",
          annotationId: "label-VDD1",
        },
      ]),
    );
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

    expect(deleted.ok, JSON.stringify(deleted)).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.document.routes).toEqual([]);
    expect(deleted.document.junctions).toEqual([]);
    expect(deleted.document.annotations).toEqual([]);
    expect(deleted.document.nets).toEqual([]);
  });

  it("keeps a new local rail separate from an existing Global AVDD Net", () => {
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
          scope: "local",
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
          "fixtures/projects/port-nets/project.icproj.json",
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
      mirror: "horizontal",
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
    expect(gate.ok, JSON.stringify(gate)).toBe(true);
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

  it("joins a pin and existing wire ends crossed by the same rail gesture", () => {
    // Drawing a new rail is explicit connection intent at pin tips too.
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
    expect(restingNet?.id).toBe(railNet);
    expect(after.routes.every((route) => route.netId === railNet)).toBe(true);
  });
});

describe("Power Rail pin contacts", () => {
  function pmosPair() {
    const document = createEmptyDocument("rail-pins", "Rail pins");
    document.instances = [
      {
        id: "M1",
        symbolId: "pmos",
        reference: "M1",
        placement: {
          position: { x: 100, y: 120 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "pch" },
          parameters: { w: "1u", l: "100n" },
        },
      },
      {
        id: "M2",
        symbolId: "pmos",
        reference: "M2",
        placement: {
          position: { x: 220, y: 120 },
          rotation: 0,
          mirror: "horizontal",
        },
        netlist: {
          binding: { kind: "model", deviceClass: "mos", name: "pch" },
          parameters: { w: "1u", l: "100n" },
        },
      },
    ];
    // One source already has a Base Net; the other is still unconnected.
    document.nets.push({
      id: "old-source",
      terminals: [{ instanceId: "M1", pinName: "S" }],
    });
    return document;
  }

  function railPlan(
    document: SchematicDocument,
    start = { x: 60, y: 100 },
    end = { x: 260, y: 100 },
  ) {
    const plan = planVddRailEdits(
      document,
      { instanceId: "VDD1", start, end },
      resolver,
    );
    if (!plan.ok) throw new Error(plan.message);
    return plan;
  }

  function applyPlan(
    document: SchematicDocument,
    plan: {
      edits: readonly SchematicEdit[];
      expectedElectricalEffect?: ExpectedElectricalEffect;
    },
  ) {
    const gate = gateRoutingOperationPlan(
      document,
      createRoutingOperationPlan(document, {
        intent: "route-geometry",
        diagnostics: [],
        ...plan,
      }),
      { symbolResolver: resolver },
    );
    if (!gate.ok)
      throw new Error(`${gate.message}: ${JSON.stringify(gate.diagnostics)}`);
    const result = executeTransaction(
      document,
      {
        transactionId: `rail-contact-${document.revision}`,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...gate.edits],
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.document;
  }

  function netOf(
    document: SchematicDocument,
    instanceId: string,
    pinName: string,
  ) {
    return document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    )?.id;
  }

  function expectSourcesOnRail(document: SchematicDocument) {
    const rail = document.routes.find(
      (route) => route.presentation === "power-rail",
    )!;
    expect(rail).toBeDefined();
    for (const id of ["M1", "M2"])
      expect(netOf(document, id, "S")).toBe(rail.netId);
    expect(
      resolveDocumentLogicalNets(document).byBaseNetId.get(rail.netId)?.name,
    ).toBe("VDD");
    const component = derivePowerRailComponent(document, rail.id)!;
    expect(component.routeIds).toHaveLength(
      document.routes.filter((route) => route.presentation === "power-rail")
        .length,
    );
    expect(component.endpointJunctionIds).toHaveLength(2);
  }

  it.each([
    [
      { x: 60, y: 100 },
      { x: 260, y: 100 },
    ],
    [
      { x: 260, y: 100 },
      { x: 60, y: 100 },
    ],
    [
      { x: 110, y: 100 },
      { x: 210, y: 100 },
    ],
  ])(
    "connects both mirrored PMOS sources along the span and at its ends (%j → %j)",
    (start, end) => {
      const before = pmosPair();
      expect(
        resolveEndpointConnection(before, resolver, {
          kind: "terminal",
          instanceId: "M1",
          pinName: "S",
        })?.contactPoint,
      ).toEqual({ x: 110, y: 100 });
      expect(
        resolveEndpointConnection(before, resolver, {
          kind: "terminal",
          instanceId: "M2",
          pinName: "S",
        })?.contactPoint,
      ).toEqual({ x: 210, y: 100 });
      const after = applyPlan(before, railPlan(before, start, end));
      expectSourcesOnRail(after);
      expect(netOf(after, "M1", "G")).toBeUndefined();
      expect(netOf(after, "M2", "D")).toBeUndefined();
    },
  );

  it("connects rotated passive pins on a vertical rail, but not a nearby pin", () => {
    const before = createEmptyDocument("vertical-pins", "Vertical pins");
    before.instances = [100, 200, 300].map((y, index) => ({
      id: `R${index + 1}`,
      symbolId: "resistor",
      placement: {
        position: { x: index === 2 ? 110 : 100, y },
        rotation: 90,
        mirror: "none",
      },
    }));
    const after = applyPlan(
      before,
      railPlan(before, { x: 120, y: 60 }, { x: 120, y: 340 }),
    );
    const rail = after.routes.find(
      (route) => route.presentation === "power-rail",
    )!;
    expect(netOf(after, "R1", "1")).toBe(rail.netId);
    expect(netOf(after, "R2", "1")).toBe(rail.netId);
    expect(netOf(after, "R1", "2")).toBeUndefined();
    expect(netOf(after, "R3", "1")).toBeUndefined();
  });

  it("bonds exact off-grid artwork tips through grid-aligned rail taps", () => {
    const before = createEmptyDocument("offgrid-rail", "Offgrid rail");
    before.instances = [120, 200].map((y, index) => ({
      id: `R${index + 1}`,
      symbolId: "resistor",
      symbolVariantId: "offgrid-top",
      placement: { position: { x: 100, y }, rotation: 0, mirror: "none" },
    }));
    const after = applyPlan(
      before,
      railPlan(before, { x: 100, y: 80 }, { x: 100, y: 210 }),
    );
    const rail = after.routes.find(
      (route) => route.presentation === "power-rail",
    )!;
    expect(netOf(after, "R1", "1")).toBe(rail.netId);
    expect(netOf(after, "R2", "1")).toBe(rail.netId);
    expect(
      after.junctions.every(
        (junction) =>
          junction.position.x % 10 === 0 && junction.position.y % 10 === 0,
      ),
    ).toBe(true);
    for (const id of ["R1", "R2"])
      expect(
        after.routes.some(
          (route) =>
            route.presentation !== "power-rail" &&
            [route.start, routeEnd(route)].some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                endpoint.instanceId === id &&
                endpoint.pinName === "1",
            ),
        ),
      ).toBe(true);
    const component = derivePowerRailComponent(after, rail.id)!;
    expect(component.endpointJunctionIds).toHaveLength(2);
    const extended = applyPlan(
      after,
      proposePowerRailEndpointResize(after, resolver, rail.id, "end", {
        x: 100,
        y: 220,
      }),
    );
    expect(
      extended.routes.filter((route) => route.presentation !== "power-rail"),
    ).toHaveLength(2);
  });

  it("connects pins reached by extending a rail and preserves taps when moving it away", () => {
    const before = pmosPair();
    const short = applyPlan(
      before,
      railPlan(before, { x: 60, y: 100 }, { x: 90, y: 100 }),
    );
    expect(netOf(short, "M2", "S")).toBeUndefined();
    const extended = applyPlan(
      short,
      proposePowerRailEndpointResize(
        short,
        resolver,
        "route-vdd1-rail",
        "end",
        { x: 260, y: 100 },
      ),
    );
    expectSourcesOnRail(extended);
    const moved = applyPlan(
      extended,
      proposePowerRailTranslation(extended, resolver, "route-vdd1-rail", {
        x: 0,
        y: -40,
      }),
    );
    expectSourcesOnRail(moved);
    const rails = moved.routes.filter(
      (route) => route.presentation === "power-rail",
    );
    for (const route of rails)
      expect(
        resolveRouteGeometry(moved, resolver, route)?.centerline.every(
          (point) => point.y === 60,
        ),
      ).toBe(true);
    // Moving the bonded rail leaves ordinary leads back to the pin tips.
    for (const instanceId of ["M1", "M2"])
      expect(
        moved.routes.some(
          (route) =>
            route.presentation !== "power-rail" &&
            [route.start, routeEnd(route)].some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                endpoint.instanceId === instanceId &&
                endpoint.pinName === "S",
            ),
        ),
      ).toBe(true);
  });

  it("connects when a whole rail is dropped onto pins", () => {
    const before = pmosPair();
    const above = applyPlan(
      before,
      railPlan(before, { x: 60, y: 60 }, { x: 260, y: 60 }),
    );
    const after = applyPlan(
      above,
      proposePowerRailTranslation(above, resolver, "route-vdd1-rail", {
        x: 0,
        y: 40,
      }),
    );
    expectSourcesOnRail(after);
  });

  it("persists source connectivity and exports VDD for both SPICE and Spectre", () => {
    const before = pmosPair();
    for (const id of ["M1", "M2"])
      for (const pinName of ["D", "G"])
        before.nets.push({
          id: `${id}-${pinName}`,
          terminals: [{ instanceId: id, pinName }],
        });
    const after = applyPlan(before, railPlan(before));
    const project = createEmptyProject(
      "rail-project",
      "Rail project",
      after.id,
    );
    project.documents = [after];
    const reopened = parseProject(serializeProject(project));
    expectSourcesOnRail(reopened.documents[0]!);
    const result = analyzeDesignNetlist(reopened);
    expect(result.ir, JSON.stringify(result)).not.toBeNull();
    if (!result.ir) return;
    for (const instance of result.ir.cells[0]!.instances)
      expect(instance.nodes.find((node) => node.pinName === "S")?.netName).toBe(
        "VDD",
      );
    expect(printSpiceNetlist(result.ir)).toMatch(/^M1 \S+ \S+ VDD VDD pch/mu);
    expect(printSpiceNetlist(result.ir)).toMatch(/^M2 \S+ \S+ VDD VDD pch/mu);
    expect(printSpectreNetlist(result.ir)).toMatch(
      /^M1 \(\S+ \S+ VDD VDD\) pch/mu,
    );
    expect(printSpectreNetlist(result.ir)).toMatch(
      /^M2 \(\S+ \S+ VDD VDD\) pch/mu,
    );
  });

  it("leaves hidden bulk artwork and symbol bodies out of rail contact planning", () => {
    const before = pmosPair();
    // B is hidden by the default MOS display. This span passes over its
    // artwork anchor, while none of the visible pin tips touch it.
    const plan = railPlan(before, { x: 110, y: 120 }, { x: 130, y: 120 });
    expect(plan.expectedElectricalEffect).toBeUndefined();
    expect(
      plan.edits.filter((edit) => edit.kind === "add_junction"),
    ).toHaveLength(0);
  });

  it("rejects a conflicting supply contact atomically", () => {
    const before = pmosPair();
    before.annotations.push({
      id: "label-vss",
      kind: "power-label",
      netId: "old-source",
      binding: { kind: "net-name", netId: "old-source" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    before.connectivityEvidence.push({
      id: "claim-vss",
      kind: "name-claim",
      netId: "old-source",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "label-vss" },
    });
    const snapshot = structuredClone(before);
    const gate = gateRoutingOperationPlan(
      before,
      createRoutingOperationPlan(before, {
        intent: "connect",
        diagnostics: [],
        ...railPlan(before),
      }),
      { symbolResolver: resolver },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/power.*domain|incompatible/iu);
    expect(before).toEqual(snapshot);
  });

  it("does not reinterpret untouched legacy rail overlaps on load or unrelated edits", () => {
    const before = pmosPair();
    before.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 400, y: 400 }, rotation: 0, mirror: "none" },
    });
    // Reproduce a stored drawing from before rail gestures acquired taps.
    const legacy = applyPlan(before, {
      edits: constructVddRailEdits({
        instanceId: "VDD1",
        start: { x: 60, y: 100 },
        end: { x: 260, y: 100 },
      }),
    });
    const project = createEmptyProject("legacy-rail", "Legacy rail", legacy.id);
    project.documents = [legacy];
    const reopened = parseProject(serializeProject(project)).documents[0]!;
    const after = applyPlan(reopened, {
      edits: [
        {
          kind: "move_instance",
          instanceId: "R1",
          position: { x: 500, y: 400 },
        },
      ],
    });
    expect(netOf(after, "M1", "S")).toBe("old-source");
    expect(netOf(after, "M2", "S")).toBeUndefined();
  });

  it("undoes and redoes the rail and both source connections together", () => {
    const before = pmosPair();
    const history = new DocumentHistory(before, { symbolResolver: resolver });
    const plan = railPlan(before);
    const transact = (edits: readonly SchematicEdit[]) =>
      history.transact({
        transactionId: `history-${history.document.revision}`,
        documentId: before.id,
        expectedRevision: history.document.revision,
        actor: { kind: "human", id: "test" },
        edits,
      });
    expect(transact(plan.edits).ok).toBe(true);
    expectSourcesOnRail(history.document);
    expect(transact([{ kind: "undo" }]).ok).toBe(true);
    expect(history.document.routes).toHaveLength(0);
    expect(netOf(history.document, "M1", "S")).toBe("old-source");
    expect(netOf(history.document, "M2", "S")).toBeUndefined();
    expect(transact([{ kind: "redo" }]).ok).toBe(true);
    expectSourcesOnRail(history.document);
  });
});
