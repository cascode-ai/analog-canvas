import { createRoutePath, routeEnd, type RouteEndpoint } from "@icm/model";
import {
  createRoutingOperationPlan,
  executeTransaction,
  gateRoutingOperationPlan,
  planInstanceDeletion,
} from "@icm/edit-engine";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import { createEmptyDocument, transformPoint } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  proposePlacementContact,
  proposedStandalonePowerConnection,
  proposedSupplyPortRename,
} from "./placement-connectivity";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function addSupplyClaim(
  document: ReturnType<typeof createEmptyDocument>,
  netId: string,
  name: string,
  scope: "local" | "global",
  powerDomain: "vdd" | "ground",
): void {
  const annotationId = `test-net-label-${netId}`;
  document.annotations.push({
    id: annotationId,
    kind: "power-label",
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
    scope,
    powerDomain,
    owner: { kind: "net-label", annotationId },
  });
}

function transaction(expectedRevision: number, edits: unknown[]) {
  return {
    transactionId: "placement-contact-test",
    documentId: "main",
    expectedRevision,
    actor: { kind: "human" as const, id: "test" },
    dryRun: false,
    edits,
  };
}

describe("component placement electrical contacts", () => {
  it.each([
    "simple-switch",
    "ideal-switch",
    "closed-switch",
    "spdt-switch",
    "simple-spdt-switch",
    "voltage-controlled-switch",
  ])("connects %s directly to a Cell Port without a Route", (symbolId) => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-port",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-p1",
      name: "OUT",
      netId: "net-port",
      direction: "passive",
      interfaceInstanceIds: ["P1"],
    });
    const symbol = resolver.resolve(symbolId)!.definition;
    const contactedPin = symbol.pins[0]!;
    const placed = {
      id: "S1",
      symbolId,
      placement: {
        position: {
          x: 10 - contactedPin.at.x,
          y: -contactedPin.at.y,
        },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };

    const portEndpoint = {
      kind: "terminal" as const,
      instanceId: "P1",
      pinName: "P",
    };
    const proposal = proposePlacementContact(document, resolver, placed, [
      {
        endpoint: portEndpoint,
        connection: resolveEndpointConnection(
          document,
          resolver,
          portEndpoint,
        )!,
        netId: "net-port",
        preludeEdits: [],
      },
    ]);

    expect(proposal).toMatchObject({ matched: true, ambiguous: false });
    const result = executeTransaction(
      document,
      transaction(document.revision, [
        { kind: "add_instance", instance: placed },
        ...proposal.edits,
      ]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toEqual([]);
    expect(result.document.nets).toEqual([
      expect.objectContaining({
        id: "net-port",
        terminals: expect.arrayContaining([
          { instanceId: "P1", pinName: "P" },
          { instanceId: "S1", pinName: contactedPin.name },
        ]),
      }),
    ]);
  });

  it("splices a two-pin component into one contacted Route", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-signal", terminals: [] });
    document.junctions.push(
      {
        id: "top",
        netId: "net-signal",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "bottom",
        netId: "net-signal",
        position: { x: 0, y: 100 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net-signal",
        start: { kind: "junction", junctionId: "top" },
        end: { kind: "junction", junctionId: "bottom" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resistor = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 50 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };

    const proposal = proposePlacementContact(document, resolver, resistor, []);

    expect(proposal).toMatchObject({ matched: true, ambiguous: false });
    expect(proposal.expectedElectricalEffect).toMatchObject({
      kind: "partition",
      sourceBaseNetIds: ["net-signal"],
    });
    const operation = createRoutingOperationPlan(document, {
      intent: "connect",
      edits: [{ kind: "add_instance", instance: resistor }, ...proposal.edits],
      diagnostics: [],
      expectedElectricalEffect: proposal.expectedElectricalEffect!,
    });
    expect(gateRoutingOperationPlan(document, operation, context).ok).toBe(
      true,
    );
    const result = executeTransaction(
      document,
      transaction(document.revision, [
        { kind: "add_instance", instance: resistor },
        ...proposal.edits,
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toHaveLength(2);
    expect(result.document.nets).toHaveLength(2);
    const pinNets = ["1", "2"].map(
      (pinName) =>
        result.document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === "R1" && terminal.pinName === pinName,
          ),
        )?.id,
    );
    expect(pinNets[0]).toBeTruthy();
    expect(pinNets[1]).toBeTruthy();
    expect(pinNets[0]).not.toBe(pinNets[1]);
  });

  it("does not let a legacy VDD marker use generic component placement", () => {
    const document = createEmptyDocument("main", "Main");
    const vdd = {
      id: "VDD2",
      symbolId: "vdd",
      placement: {
        position: { x: 100, y: 80 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposePlacementContact(document, resolver, vdd, []);
    expect(proposal).toEqual({ edits: [], matched: false, ambiguous: false });
    expect(proposedStandalonePowerConnection(document, vdd)).toEqual({
      edits: [],
      matched: false,
      ambiguous: false,
    });
  });

  it("creates a standalone global ground Net without inventing a wire", () => {
    const ground = {
      id: "GND1",
      symbolId: "ground",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const document = createEmptyDocument("main", "Main");
    const proposal = proposedStandalonePowerConnection(document, ground);
    expect(proposal).toMatchObject({
      powerNetId: "net-power-gnd1",
      edits: [
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "GND1", pinName: "0" },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({
            kind: "name-claim",
            netId: "net-power-gnd1",
            name: "0",
            scope: "global",
            powerDomain: "ground",
          }),
        },
      ],
    });
    const connected = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: ground },
        ...proposal.edits,
      ]),
      context,
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(
      resolveDocumentLogicalNets(connected.document).groups[0],
    ).toMatchObject({
      baseNetIds: ["net-power-gnd1"],
      name: "0",
      scope: "global",
      powerDomain: "ground",
    });
  });

  it("connects a later Ground marker logically without merging Base Nets", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-global-0",

      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    addSupplyClaim(document, "net-global-0", "0", "global", "ground");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      mosBulkBinding: {
        origin: "supply-default",
        netId: "net-global-0",
      },
      placement: null,
    });
    const ground = {
      id: "GND2",
      symbolId: "ground",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposedStandalonePowerConnection(document, ground);

    expect(proposal.powerNetId).toBe("net-power-gnd2");
    expect(proposal.edits.at(-1)).toMatchObject({
      kind: "upsert_connectivity_evidence",
      evidence: { kind: "name-claim", name: "0", powerDomain: "ground" },
    });
    const connected = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: ground },
        ...proposal.edits,
      ]),
      context,
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.document.nets).toHaveLength(2);
    expect(
      resolveDocumentLogicalNets(connected.document).groups[0],
    ).toMatchObject({
      baseNetIds: ["net-global-0", "net-power-gnd2"],
      name: "0",
      powerDomain: "ground",
    });
  });

  it("grounds an ordinary contacted signal Net instead of blocking placement", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
    });
    document.nets.push({
      id: "net-tail",

      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    const ground = {
      id: "GND1",
      symbolId: "ground",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const groundPin = resolver.resolve("ground")!.definition.pins[0]!;
    const point = transformPoint(
      groundPin.at,
      ground.placement.position,
      ground.placement,
    );

    const proposal = proposePlacementContact(document, resolver, ground, [
      {
        endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
        netId: "net-tail",
        connection: {
          endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
          contactPoint: point,
          gridLanding: point,
          escapePath: [],
          outward: null,
        },
        preludeEdits: [],
      },
    ]);

    expect(proposal).toMatchObject({
      matched: true,
      ambiguous: false,
      powerNetId: "net-tail",
    });
    const result = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: ground },
        ...proposal.edits,
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolveDocumentLogicalNets(result.document).groups[0]).toMatchObject(
      {
        baseNetIds: ["net-tail"],
        name: "0",
        powerDomain: "ground",
      },
    );
  });

  it("creates a standalone global VDD Logical Net from a placed power port", () => {
    const vddPort = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const document = createEmptyDocument("main", "Main");
    const proposal = proposedStandalonePowerConnection(document, vddPort);
    expect(proposal).toMatchObject({
      powerNetId: "net-power-vdd1",
      powerEndpoint: {
        kind: "terminal",
        instanceId: "VDD1",
        pinName: "P",
      },
      edits: [
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({
            kind: "name-claim",
            netId: "net-power-vdd1",
            name: "VDD",
            powerDomain: "vdd",
          }),
        },
      ],
    });
    const connected = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: vddPort },
        ...proposal.edits,
      ]),
      context,
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(
      resolveDocumentLogicalNets(connected.document).groups[0],
    ).toMatchObject({
      baseNetIds: ["net-power-vdd1"],
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
    });
  });

  it("joins a new VDD marker to an existing global VDD Logical Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-power-vdd1",

      terminals: [],
    });
    addSupplyClaim(document, "net-power-vdd1", "VDD", "global", "vdd");
    const vddPort = {
      id: "VDD2",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposedStandalonePowerConnection(document, vddPort);

    expect(proposal.powerNetId).toBe("net-power-vdd2");
    expect(proposal.edits.at(-1)).toMatchObject({
      kind: "upsert_connectivity_evidence",
      evidence: { kind: "name-claim", name: "VDD", powerDomain: "vdd" },
    });
    const connected = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: vddPort },
        ...proposal.edits,
      ]),
      context,
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.document.nets).toHaveLength(2);
    expect(resolveDocumentLogicalNets(connected.document).groups).toEqual([
      expect.objectContaining({
        baseNetIds: ["net-power-vdd1", "net-power-vdd2"],
        name: "VDD",
        scope: "global",
      }),
    ]);
  });

  it("reuses a deleted VDD designator without reusing its surviving Base Net ID", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "VDD2",
        symbolId: "vdd-port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 200 },
          rotation: 90,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-power-vdd2",
      terminals: [
        { instanceId: "VDD2", pinName: "P" },
        { instanceId: "R1", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-vdd2-r1",
        netId: "net-power-vdd2",
        start: { kind: "terminal", instanceId: "VDD2", pinName: "P" },
        end: { kind: "terminal", instanceId: "R1", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.connectivityEvidence.push({
      id: "claim-vdd2",
      kind: "name-claim",
      netId: "net-power-vdd2",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: "VDD2" },
    });

    const removed = executeTransaction(
      document,
      transaction(0, planInstanceDeletion(document, resolver, ["VDD2"], 9)),
      context,
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.instances.map((instance) => instance.id)).toEqual([
      "R1",
    ]);
    expect(removed.document.routes[0]?.start).toEqual({
      kind: "junction",
      junctionId: "junction-lifecycle-9-1",
    });
    expect(removed.document.connectivityEvidence).toEqual([]);

    // Reusing the designator is the behavior under test. Keep the marker away
    // from the surviving route anchor: exact physical contact would correctly
    // rejoin that conductor under the transaction connectivity contract.
    const vddPort = {
      id: "VDD2",
      symbolId: "vdd-port",
      placement: {
        position: { x: 300, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };

    const proposal = proposedStandalonePowerConnection(
      removed.document,
      vddPort,
    );

    expect(proposal.powerNetId).toBe("net-power-vdd2-2");
    expect(proposal.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "connect_endpoints",
          newNetId: "net-power-vdd2-2",
        }),
        expect.objectContaining({
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({
            netId: "net-power-vdd2-2",
            name: "VDD",
          }),
        }),
      ]),
    );

    const connected = executeTransaction(
      removed.document,
      transaction(removed.document.revision, [
        { kind: "add_instance", instance: vddPort },
        ...proposal.edits,
      ]),
      context,
    );
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(
      connected.document.nets.find((net) => net.id === "net-power-vdd2"),
    ).toMatchObject({ terminals: [{ instanceId: "R1", pinName: "1" }] });
    expect(
      connected.document.nets.find((net) => net.id === "net-power-vdd2-2"),
    ).toMatchObject({
      terminals: [{ instanceId: "VDD2", pinName: "P" }],
    });
    const logicalNets = resolveDocumentLogicalNets(connected.document);
    expect(logicalNets.byBaseNetId.get("net-power-vdd2")).toMatchObject({
      baseNetIds: ["net-power-vdd2"],
      powerDomain: "none",
    });
    expect(logicalNets.byBaseNetId.get("net-power-vdd2")?.name).toBeUndefined();
    expect(logicalNets.byBaseNetId.get("net-power-vdd2-2")).toMatchObject({
      baseNetIds: ["net-power-vdd2-2"],
      name: "VDD",
      powerDomain: "vdd",
    });
  });

  it("does not merge a VDD marker into a distinct AVDD supply", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-avdd",

      terminals: [],
    });
    addSupplyClaim(document, "net-avdd", "AVDD", "global", "vdd");
    const vddPort = {
      id: "VDD2",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };

    const proposal = proposedStandalonePowerConnection(document, vddPort);

    expect(proposal).toMatchObject({
      powerNetId: "net-power-vdd2",
      edits: [
        {
          kind: "connect_endpoints",
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({
            kind: "name-claim",
            name: "VDD",
            powerDomain: "vdd",
          }),
        },
      ],
    });
  });

  it("converges four separately placed Ground symbols on one canonical Net", () => {
    let document = createEmptyDocument("main", "Main");
    for (const [index, id] of ["GND1", "GND2", "GND3", "GND4"].entries()) {
      const ground = {
        id,
        symbolId: "ground",
        placement: {
          position: { x: 80 + index * 40, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      };
      const proposal = proposedStandalonePowerConnection(document, ground);
      const result = executeTransaction(
        document,
        transaction(document.revision, [
          { kind: "add_instance", instance: ground },
          ...proposal.edits,
        ]),
        context,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      document = result.document;
    }

    expect(document.nets).toHaveLength(4);
    expect(resolveDocumentLogicalNets(document).groups).toEqual([
      expect.objectContaining({
        baseNetIds: [
          "net-power-gnd1",
          "net-power-gnd2",
          "net-power-gnd3",
          "net-power-gnd4",
        ],
        name: "0",
        scope: "global",
        powerDomain: "ground",
      }),
    ]);
  });

  it("converges three VDD symbols without merging AVDD or DVDD", () => {
    let document = createEmptyDocument("main", "Main");
    document.nets.push(
      {
        id: "net-avdd",

        terminals: [],
      },
      {
        id: "net-dvdd",

        terminals: [],
      },
    );
    addSupplyClaim(document, "net-avdd", "AVDD", "global", "vdd");
    addSupplyClaim(document, "net-dvdd", "DVDD", "global", "vdd");
    for (const [index, id] of ["VDD1", "VDD2", "VDD3"].entries()) {
      const vdd = {
        id,
        symbolId: "vdd-port",
        placement: {
          position: { x: 80 + index * 40, y: 100 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      };
      const proposal = proposedStandalonePowerConnection(document, vdd);
      const result = executeTransaction(
        document,
        transaction(document.revision, [
          { kind: "add_instance", instance: vdd },
          ...proposal.edits,
        ]),
        context,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      document = result.document;
    }

    expect(document.nets).toHaveLength(5);
    expect(resolveDocumentLogicalNets(document).groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseNetIds: ["net-power-vdd1", "net-power-vdd2", "net-power-vdd3"],
          name: "VDD",
          scope: "global",
          powerDomain: "vdd",
        }),
        expect.objectContaining({ baseNetIds: ["net-avdd"], name: "AVDD" }),
        expect.objectContaining({ baseNetIds: ["net-dvdd"], name: "DVDD" }),
      ]),
    );
  });
});

describe("naming a supply marker", () => {
  /** Place one VDD marker and connect it, the way the canvas does. */
  function withSupply(
    document: ReturnType<typeof createEmptyDocument>,
    id: string,
    x: number,
  ) {
    const instance = {
      id,
      symbolId: "vdd-port",
      placement: {
        position: { x, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposedStandalonePowerConnection(
      { ...document, instances: [...document.instances, instance] },
      instance,
    );
    const result = executeTransaction(
      document,
      {
        transactionId: `place-${id}`,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human" as const, id: "test" },
        edits: [{ kind: "add_instance" as const, instance }, ...proposal.edits],
      },
      context,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.document;
  }

  const logicalName = (
    document: ReturnType<typeof createEmptyDocument>,
    instanceId: string,
  ) => {
    const net = document.nets.find((candidate) =>
      candidate.terminals.some(
        (terminal) => terminal.instanceId === instanceId,
      ),
    );
    return net
      ? resolveDocumentLogicalNets(document).byBaseNetId.get(net.id)?.name
      : undefined;
  };

  it("starts every marker on the one shared supply", () => {
    let document = createEmptyDocument("main", "Main");
    document = withSupply(document, "VDD1", 100);
    document = withSupply(document, "VDD2", 300);
    expect(logicalName(document, "VDD1")).toBe("VDD");
    expect(logicalName(document, "VDD2")).toBe("VDD");
  });

  it("gives one marker its own rail without moving the others", () => {
    let document = createEmptyDocument("main", "Main");
    document = withSupply(document, "VDD1", 100);
    document = withSupply(document, "VDD2", 300);

    const instance = document.instances.find(
      (candidate) => candidate.id === "VDD1",
    )!;
    const plan = proposedSupplyPortRename(document, instance, "VDDH");
    expect(plan.rejected).toBeUndefined();
    const result = executeTransaction(
      document,
      {
        transactionId: "name-vddh",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      },
      context,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    // A design carries VDDH and VDDL at once; naming one must not drag the
    // other along, and the supply it left keeps its own name.
    expect(logicalName(result.document, "VDD1")).toBe("VDDH");
    expect(logicalName(result.document, "VDD2")).toBe("VDD");
  });

  it("rejoins the shared supply when named back", () => {
    let document = createEmptyDocument("main", "Main");
    document = withSupply(document, "VDD1", 100);
    document = withSupply(document, "VDD2", 300);

    for (const name of ["VDDH", "VDD"]) {
      const instance = document.instances.find(
        (candidate) => candidate.id === "VDD1",
      )!;
      const plan = proposedSupplyPortRename(document, instance, name);
      expect(plan.rejected).toBeUndefined();
      const result = executeTransaction(
        document,
        {
          transactionId: `name-${name}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: plan.edits,
        },
        context,
      );
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      document = result.document;
    }

    // Carrying the same name is what makes two markers the same supply, so
    // naming it back has to put them on one Net again.
    expect(logicalName(document, "VDD1")).toBe("VDD");
    expect(logicalName(document, "VDD2")).toBe("VDD");
    // Same-name Base Nets stay separate rows and are merged logically, so
    // "one supply again" is a question for the logical index, not for ids.
    const logical = resolveDocumentLogicalNets(document);
    const logicalIdOf = (id: string) => {
      const net = document.nets.find((candidate) =>
        candidate.terminals.some((terminal) => terminal.instanceId === id),
      )!;
      return logical.byBaseNetId.get(net.id)?.id;
    };
    expect(logicalIdOf("VDD1")).toBe(logicalIdOf("VDD2"));
  });
});

describe("multi-pin placement onto one conductor", () => {
  function verticalWireDocument() {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "n1", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "n1",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "n1",
        position: { x: 100, y: 200 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "R1",
        netId: "n1",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    return document;
  }

  function endpointName(endpoint: RouteEndpoint): string {
    return endpoint.kind === "junction"
      ? endpoint.junctionId
      : `${endpoint.instanceId}.${endpoint.pinName}`;
  }

  it.each([
    {
      symbolId: "nmos",
      id: "M1",
      position: { x: 90, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
      pair: ["D", "S"],
      controlPin: "G",
    },
    {
      symbolId: "pmos",
      id: "M2",
      position: { x: 110, y: 100 },
      rotation: 0 as const,
      mirror: "x" as const,
      pair: ["D", "S"],
      controlPin: "G",
    },
    {
      symbolId: "npn",
      id: "Q1",
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
      pair: ["C", "E"],
      controlPin: "B",
    },
    {
      symbolId: "pnp",
      id: "Q2",
      position: { x: 100, y: 100 },
      rotation: 180 as const,
      mirror: "none" as const,
      pair: ["C", "E"],
      controlPin: "B",
    },
  ])(
    "splices $symbolId by its declared current-path pins while leaving the control pin open",
    ({ symbolId, id, position, rotation, mirror, pair, controlPin }) => {
      const document = verticalWireDocument();
      const transistor = {
        id,
        symbolId,
        placement: {
          position,
          rotation,
          mirror,
        },
      };

      const proposal = proposePlacementContact(
        document,
        resolver,
        transistor,
        [],
      );

      expect(proposal).toMatchObject({
        matched: true,
        ambiguous: false,
        expectedElectricalEffect: {
          kind: "partition",
          sourceBaseNetIds: ["n1"],
        },
      });
      const committed = executeTransaction(
        document,
        transaction(0, [
          { kind: "add_instance", instance: transistor },
          ...proposal.edits,
        ]),
        context,
      );
      expect(committed.ok).toBe(true);
      if (!committed.ok) return;
      expect(committed.document.routes).toHaveLength(2);
      const pinNetIds = pair.map(
        (pinName) =>
          committed.document.nets.find((net) =>
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === id && terminal.pinName === pinName,
            ),
          )?.id,
      );
      expect(pinNetIds[0]).toBeTruthy();
      expect(pinNetIds[1]).toBeTruthy();
      expect(pinNetIds[0]).not.toBe(pinNetIds[1]);
      expect(
        committed.document.nets.some((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === id && terminal.pinName === controlPin,
          ),
        ),
      ).toBe(false);
    },
  );

  it("does not splice a transistor whose body overlaps a Route without two exact pin contacts", () => {
    const document = verticalWireDocument();
    const transistor = {
      id: "M1",
      symbolId: "nmos",
      placement: {
        // The Route passes through the Symbol body at x=100, while D/S are at
        // x=110 and G is at x=80. Bounds overlap must not create topology.
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };

    expect(proposePlacementContact(document, resolver, transistor, [])).toEqual(
      { edits: [], matched: false, ambiguous: false },
    );
  });

  it("splices a current source dropped onto one wire into series (feedback image 6/7)", () => {
    const document = verticalWireDocument();
    // current-source pins: "+" at (0,-20), "-" at (0,20). Placed at
    // (100,100), both pins land on R1's interior: (100,80) and (100,120).
    // The eligible two-terminal drop is one atomic series splice: both pins
    // attach, the between-pin span is removed, and the Base Net partitions
    // so the device is never left shorted.
    const source = {
      id: "I1",
      symbolId: "current-source",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposePlacementContact(document, resolver, source, []);
    expect(proposal.ambiguous).toBe(false);
    expect(proposal.matched).toBe(true);
    const committed = executeTransaction(
      document,
      transaction(0, [
        { kind: "add_instance", instance: source },
        ...proposal.edits,
      ]),
      context,
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const spans = committed.document.routes.map(
      (route) =>
        `${endpointName(route.start)}->${endpointName(routeEnd(route))}`,
    );
    expect(new Set(spans)).toEqual(new Set(["J1->I1.+", "I1.-->J2"]));
    const pinNets = ["+", "-"].map(
      (pinName) =>
        committed.document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === "I1" && terminal.pinName === pinName,
          ),
        )?.id,
    );
    expect(pinNets[0]).toBeTruthy();
    expect(pinNets[1]).toBeTruthy();
    expect(pinNets[0]).not.toBe(pinNets[1]);
  });

  it("keeps rejecting one pin that touches two disconnected conductors", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "n1", terminals: [] },
      { id: "n2", terminals: [] },
    );
    document.junctions.push(
      {
        id: "J1",
        netId: "n1",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "n1",
        position: { x: 100, y: 200 },
        role: "route-anchor",
      },
      {
        id: "J3",
        netId: "n2",
        position: { x: 0, y: 80 },
        role: "route-anchor",
      },
      {
        id: "J4",
        netId: "n2",
        position: { x: 200, y: 80 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "R1",
        netId: "n1",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "R2",
        netId: "n2",
        start: { kind: "junction", junctionId: "J3" },
        end: { kind: "junction", junctionId: "J4" },
        bends: [],
        modes: ["manual"],
      }),
    );
    // "+" pin lands at (100,80): the crossing of two disconnected conductors.
    const source = {
      id: "I1",
      symbolId: "current-source",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposePlacementContact(document, resolver, source, []);
    expect(proposal).toMatchObject({ matched: false, ambiguous: true });
    expect(proposal.edits).toHaveLength(0);
  });
});
