import { describe, expect, it } from "vitest";

import {
  executeProjectTransaction,
  planSetVddConnectionMode,
} from "@icm/edit-engine";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { planBrowserAgentCommand } from "../../agent/browser-agent-command";
import { planPlacedCellPin } from "./cell-pin-placement";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** One supply marker as the Insert picker places it, on its own new Net. */
function placeVddMarker(
  project: CircuitProject,
  id: string,
  x: number,
  symbolId: "vdd-port" | "named-ground" = "vdd-port",
  name?: string,
) {
  const document = project.documents[0]!;
  const netId = `net-cell-pin-${id.toLowerCase()}`;
  const endpoint = { kind: "terminal" as const, instanceId: id, pinName: "P" };
  const result = executeProjectTransaction(project, {
    transactionId: `place-${id}`,
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: planPlacedCellPin(project, document.id, resolver, {
      instance: {
        id,
        symbolId,
        placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
      },
      terminalId: `terminal-${id.toLowerCase()}`,
      ...(name ? { name } : {}),
      netId,
      direction: "inout",
      connectionEdits: [
        {
          kind: "connect_endpoints",
          from: endpoint,
          to: endpoint,
          newNetId: netId,
        },
      ],
    }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.project;
}

describe("placing a VDD marker", () => {
  it("makes each marker its own VDD Cell Pin with a bound supply label, not a global claim", () => {
    let project = createEmptyProject("vdd-markers", "VDD markers");
    project = placeVddMarker(project, "VDD1", 100);
    project = placeVddMarker(project, "VDD2", 300);
    const document = project.documents[0]!;

    expect(document.netlist!.terminals).toEqual([
      expect.objectContaining({ name: "VDD", interfaceInstanceIds: ["VDD1"] }),
      expect.objectContaining({ name: "VDD", interfaceInstanceIds: ["VDD2"] }),
    ]);
    expect(
      document.netlist!.terminals.map(
        (terminal) =>
          document.nets.find((net) => net.id === terminal.netId)?.terminals,
      ),
    ).toEqual([
      [{ instanceId: "VDD1", pinName: "P" }],
      [{ instanceId: "VDD2", pinName: "P" }],
    ]);
    expect(
      document.connectivityEvidence.filter(
        (evidence) =>
          evidence.kind === "name-claim" && evidence.powerDomain === "vdd",
      ),
    ).toEqual([]);
    expect(
      document.annotations
        .filter((annotation) => annotation.kind === "power-label")
        .map((annotation) => [annotation.id, annotation.binding]),
    ).toEqual([
      [
        "power-label-vdd1",
        { kind: "cell-terminal-name", terminalId: "terminal-vdd1" },
      ],
      [
        "power-label-vdd2",
        { kind: "cell-terminal-name", terminalId: "terminal-vdd2" },
      ],
    ]);
  });
  it("binds a vdd-port named VSS to the NMOS bulk default instead of PMOS", () => {
    let project = createEmptyProject("vss-bar", "VSS bar");
    project = placeVddMarker(project, "VSS1", 100, "vdd-port", "VSS");
    const afterVss = project.documents[0]!;
    expect(afterVss.mosBulkDefaults).toEqual({
      nmosNetId: "net-cell-pin-vss1",
    });

    project = placeVddMarker(project, "VDD1", 300, "vdd-port", "VDD");
    const afterVdd = project.documents[0]!;
    expect(afterVdd.mosBulkDefaults).toEqual({
      nmosNetId: "net-cell-pin-vss1",
      pmosNetId: "net-cell-pin-vdd1",
    });
  });
});

describe("placing a Named Ground", () => {
  it("makes a VSS Cell Pin on the block's bottom, named under its bars, that NMOS bodies follow", () => {
    const project = placeVddMarker(
      createEmptyProject("vss-marker", "VSS marker"),
      "VSS1",
      100,
      "named-ground",
    );
    const document = project.documents[0]!;
    const [terminal] = document.netlist!.terminals;
    expect(terminal).toMatchObject({
      name: "VSS",
      interfaceInstanceIds: ["VSS1"],
    });
    // No ground claim: VSS is its own net, never node 0.
    expect(
      document.connectivityEvidence.filter(
        (evidence) => evidence.kind === "name-claim",
      ),
    ).toEqual([]);
    const label = document.annotations.find(
      (annotation) => annotation.kind === "power-label",
    )!;
    expect(label).toMatchObject({
      id: "power-label-vss1",
      binding: { kind: "cell-terminal-name", terminalId: "terminal-vss1" },
      alignment: "middle",
      anchor: { objectId: "VSS1", localOffset: { x: 0, y: 30 } },
    });
    expect(document.presentation.cellSymbol?.pinPlacements).toEqual([
      { terminalId: "terminal-vss1", side: "south", offset: 0 },
    ]);
    expect(document.mosBulkDefaults).toMatchObject({
      nmosNetId: terminal!.netId,
    });
    expect(document.mosBulkDefaults?.pmosNetId).toBeUndefined();
  });

  it("switches between a VSS Cell Pin and a Global VSS, as VDD Power does", () => {
    let project = placeVddMarker(
      createEmptyProject("vss-mode", "VSS mode"),
      "VSS1",
      100,
      "named-ground",
    );
    const switchTo = (mode: "global" | "cell-pin") => {
      const result = executeProjectTransaction(project, {
        transactionId: `vss-${mode}`,
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSetVddConnectionMode(
          project,
          project.topDocumentId,
          "VSS1",
          mode,
        ),
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      project = result.project;
      return project.documents[0]!;
    };
    const global = switchTo("global");
    expect(global.netlist!.terminals).toEqual([]);
    expect(global.connectivityEvidence).toEqual([
      expect.objectContaining({
        kind: "name-claim",
        name: "VSS",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VSS1" },
      }),
    ]);
    expect(global.annotations[0]!.binding).toMatchObject({ kind: "net-name" });
    const pin = switchTo("cell-pin");
    expect(pin.netlist!.terminals).toEqual([
      expect.objectContaining({ name: "VSS", interfaceInstanceIds: ["VSS1"] }),
    ]);
    expect(pin.connectivityEvidence).toEqual([]);
  });
});

it("authors a vector Cell Pin through the GUI placement transaction with independent members", () => {
  const project = createEmptyProject("bus-pins", "Bus pins");
  const document = project.documents[0]!;
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "data",
    pinName: "P",
  };
  const result = executeProjectTransaction(project, {
    transactionId: "place-data",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: planPlacedCellPin(project, document.id, resolver, {
      instance: {
        id: "data",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      terminalId: "data-port",
      name: "DATA<3:0>",
      netId: "data-net",
      direction: "input",
      connectionEdits: [
        {
          kind: "connect_endpoints",
          from: endpoint,
          to: endpoint,
          newNetId: "data-net",
        },
      ],
    }),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const authored = result.project.documents[0]!;
  const pin = authored.netlist!.terminals[0]!;
  expect(pin.signal?.members.map((member) => member.name)).toEqual([
    "DATA<3>",
    "DATA<2>",
    "DATA<1>",
    "DATA<0>",
  ]);
  expect(new Set(pin.signal?.members.map((member) => member.netId)).size).toBe(
    4,
  );
  expect(authored.annotations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        binding: { kind: "cell-terminal-name", terminalId: "data-port" },
      }),
    ]),
  );
});

describe("placing a Port onto a labelled Net", () => {
  function labelledResistorProject(withRemoteNet = false) {
    const project = createEmptyProject("port-dedup", "Port dedup");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net-out",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    });
    document.junctions.push({
      id: "j-label",
      position: { x: 200, y: 100 },
      netId: "net-out",
      role: "route-anchor",
    });
    document.connectivityEvidence.push({
      id: "claim-out",
      kind: "name-claim",
      netId: "net-out",
      name: "V_out1",
      scope: "local",
      owner: { kind: "net-label", annotationId: "label-out" },
    });
    document.annotations.push({
      id: "label-out",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-out" },
      anchor: {
        kind: "object",
        objectId: "j-label",
        localOffset: { x: 10, y: 0 },
        fallbackPosition: { x: 210, y: 100 },
      },
      netId: "net-out",
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    if (withRemoteNet) {
      document.instances.push({
        id: "R2",
        symbolId: "resistor",
        reference: "R2",
        placement: {
          position: { x: 400, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({
        id: "net-remote",
        terminals: [{ instanceId: "R2", pinName: "1" }],
      });
      document.connectivityEvidence.push({
        id: "claim-remote",
        kind: "name-claim",
        netId: "net-remote",
        name: "V_out1",
        scope: "local",
        owner: { kind: "net-label", annotationId: "label-remote" },
      });
      document.annotations.push({
        id: "label-remote",
        kind: "net-label",
        binding: { kind: "net-name", netId: "net-remote" },
        anchor: { kind: "free", position: { x: 380, y: 90 } },
        netId: "net-remote",
        alignment: "start",
        rotation: 0,
        locked: false,
      });
    }
    return project;
  }

  it("places the Port's formal label without dodging a Net Label that will be retired", () => {
    const labelled = labelledResistorProject();
    const baseline = labelledResistorProject();
    baseline.documents[0]!.annotations = [];
    baseline.documents[0]!.connectivityEvidence = [];
    baseline.documents[0]!.junctions = [];

    const placeOn = (project: CircuitProject) => {
      const document = project.documents[0]!;
      return executeProjectTransaction(project, {
        transactionId: "place-port",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planPlacedCellPin(project, document.id, resolver, {
          instance: {
            id: "P1",
            symbolId: "port",
            placement: {
              position: { x: 200, y: 100 },
              rotation: 180,
              mirror: "none",
            },
          },
          terminalId: "terminal-p1",
          name: "V_out1",
          netId: "net-out",
          direction: "output",
          connectionEdits: [
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: "P1", pinName: "P" },
              to: { kind: "terminal", instanceId: "R1", pinName: "2" },
            },
          ],
        }),
      });
    };

    const labelledRes = placeOn(labelled);
    const baselineRes = placeOn(baseline);
    expect(labelledRes.ok, JSON.stringify(labelledRes)).toBe(true);
    expect(baselineRes.ok, JSON.stringify(baselineRes)).toBe(true);
    if (!labelledRes.ok || !baselineRes.ok) return;

    const labelledDoc = labelledRes.project.documents[0]!;
    expect(labelledDoc.annotations.map((a) => a.id)).not.toContain("label-out");
    const labelledPort = labelledDoc.annotations.find(
      (a) => a.binding?.kind === "cell-terminal-name",
    );
    const baselinePort = baselineRes.project.documents[0]!.annotations.find(
      (a) => a.binding?.kind === "cell-terminal-name",
    );
    expect(labelledPort?.anchor).toEqual(baselinePort?.anchor);
  });

  it("retires the redundant Net Label through Agent place-components physical contact", () => {
    const project = labelledResistorProject(true);
    const document = project.documents[0]!;
    const pin2 = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId: "R1",
      pinName: "2",
    })!.gridLanding;
    // Place the pre-existing Net Label near the contacted pin so default
    // placement would dodge it unless retiringNetLabelIds hides it.
    document.junctions[0]!.position = { x: pin2.x + 20, y: pin2.y };
    document.annotations[0]!.anchor = {
      kind: "object",
      objectId: "j-label",
      localOffset: { x: 0, y: 0 },
      fallbackPosition: { x: pin2.x + 20, y: pin2.y },
    };

    const plan = planBrowserAgentCommand(project, document.id, resolver, {
      kind: "place-components",
      instances: [
        {
          id: "P1",
          symbolId: "port",
          reference: "V_out1",
          placement: { position: pin2, rotation: 180, mirror: "none" },
        },
      ],
      pinAnchors: {
        P1: { pinName: "P", position: pin2 },
      },
      terminalDirections: { P1: "output" },
    });
    expect("structureEdits" in plan).toBe(true);
    if (!("structureEdits" in plan)) return;
    const result = executeProjectTransaction(project, {
      transactionId: "agent-place-port-on-labelled-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "agent", id: "test-agent" },
      edits: plan.structureEdits,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((a) => a.id)).not.toContain("label-out");
    expect(authored.annotations.map((a) => a.id)).toContain("label-remote");
    expect(authored.connectivityEvidence.map((e) => e.id)).not.toContain(
      "claim-out",
    );
    expect(authored.junctions.map((j) => j.id)).not.toContain("j-label");
    expect(authored.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: expect.objectContaining({ kind: "cell-terminal-name" }),
        }),
      ]),
    );
    const logical = resolveDocumentLogicalNets(authored);
    const portNet = authored.nets.find((net) =>
      net.terminals.some((t) => t.instanceId === "P1"),
    );
    expect(portNet?.terminals).toEqual(
      expect.arrayContaining([
        { instanceId: "R1", pinName: "2" },
        { instanceId: "P1", pinName: "P" },
      ]),
    );
    expect(logical.byBaseNetId.get(portNet!.id)?.baseNetIds).toEqual(
      expect.arrayContaining([portNet!.id, "net-remote"]),
    );
  });

  it("carries a retired Net Label's formatOverride into the planned Port label (#2607)", () => {
    const project = labelledResistorProject();
    const document = project.documents[0]!;
    const formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "bold" as const,
          children: [{ kind: "text" as const, value: "V" }],
        },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out1" }],
        },
      ],
    };
    document.annotations[0]!.formatOverride = formatOverride;

    const result = executeProjectTransaction(project, {
      transactionId: "place-port-inherit-format",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planPlacedCellPin(project, document.id, resolver, {
        instance: {
          id: "P1",
          symbolId: "port",
          placement: {
            position: { x: 200, y: 100 },
            rotation: 180,
            mirror: "none",
          },
        },
        terminalId: "terminal-p1",
        name: "V_out1",
        netId: "net-out",
        direction: "output",
        connectionEdits: [
          {
            kind: "connect_endpoints",
            from: { kind: "terminal", instanceId: "P1", pinName: "P" },
            to: { kind: "terminal", instanceId: "R1", pinName: "2" },
          },
        ],
      }),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const authored = result.project.documents[0]!;
    expect(authored.annotations.map((a) => a.id)).not.toContain("label-out");
    const portLabel = authored.annotations.find(
      (a) => a.binding?.kind === "cell-terminal-name",
    );
    expect(portLabel?.formatOverride).toEqual(formatOverride);
  });
});
