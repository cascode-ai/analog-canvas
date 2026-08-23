import { executeTransaction } from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
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
  document.connectivityEvidence.push({
    id: `claim-${netId}`,
    kind: "name-claim",
    netId,
    name,
    scope,
    powerDomain,
    owner: { kind: "explicit-net-property" },
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
      name: "0",
      scope: "global",
      powerDomain: "ground",
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
      name: "TAIL",
      scope: "global",
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
        point,
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
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
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

  it("does not merge a VDD marker into a distinct AVDD supply", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({
      id: "net-avdd",
      name: "AVDD",
      scope: "global",
      powerDomain: "vdd",
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
        name: "AVDD",
        scope: "global",
        powerDomain: "vdd",
        terminals: [],
      },
      {
        id: "net-dvdd",
        name: "DVDD",
        scope: "global",
        powerDomain: "vdd",
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
