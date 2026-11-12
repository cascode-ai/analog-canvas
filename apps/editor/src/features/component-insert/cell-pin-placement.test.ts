import { describe, expect, it } from "vitest";

import {
  executeProjectTransaction,
  planSetVddConnectionMode,
} from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { planPlacedCellPin } from "./cell-pin-placement";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** One supply marker as the Insert picker places it, on its own new Net. */
function placeVddMarker(
  project: CircuitProject,
  id: string,
  x: number,
  symbolId: "vdd-port" | "named-ground" = "vdd-port",
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
      anchor: { objectId: "VSS1", localOffset: { x: 0, y: 20 } },
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
