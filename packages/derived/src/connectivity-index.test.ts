import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  InMemorySymbolResolver,
  builtInSymbols,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { computeNetHighlight } from "./net-highlight.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("Project Connectivity Index logical aliases", () => {
  it("aggregates evidence-equivalent Base Nets under every Base-Net lookup", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    document.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
    );
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net-a",
        name: "BIAS",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "bias",
        owner: { kind: "explicit-net-property" },
        scope: "local",
      },
    );

    const index = buildProjectConnectivityIndex(project, resolver);
    for (const netId of ["net-a", "net-b"]) {
      expect(
        index.documents.get(document.id)?.logicalNetByBaseNetId.get(netId),
      ).toMatchObject({
        baseNetIds: ["net-a", "net-b"],
        logicalEndpoints: expect.arrayContaining([
          { kind: "terminal", instanceId: "P1", pinName: "P" },
          { kind: "terminal", instanceId: "P2", pinName: "P" },
        ]),
      });
      expect(
        computeNetHighlight(index, document.id, netId)?.visibleEndpoints,
      ).toHaveLength(2);
    }
    expect(
      computeNetHighlight(index, document.id, "net-a", {
        kind: "terminal",
        instanceId: "P1",
        pinName: "P",
      })?.visibleEndpoints,
    ).toHaveLength(2);
  });

  it("creates hierarchy edges only for uniquely connected projected pins", () => {
    const project = createEmptyProject("project-hierarchy", "Hierarchy");
    const parent = project.documents[0]!;
    const child = createEmptyDocument("child", "Child");
    child.instances.push(
      { id: "P1", symbolId: "port", placement: null },
      { id: "P2", symbolId: "port", placement: null },
      { id: "P3", symbolId: "port", placement: null },
      { id: "P4", symbolId: "port", placement: null },
      { id: "P5", symbolId: "port", placement: null },
    );
    child.nets.push(
      {
        id: "net-vin-a",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      },
      {
        id: "net-vin-b",
        terminals: [{ instanceId: "P2", pinName: "P" }],
      },
      {
        id: "net-out",
        terminals: [{ instanceId: "P3", pinName: "P" }],
      },
      {
        id: "net-vss",
        terminals: [
          { instanceId: "P4", pinName: "P" },
          { instanceId: "P5", pinName: "P" },
        ],
      },
    );
    child.netlist!.terminals.push(
      {
        id: "terminal-vin-a",
        name: "VIN",
        netId: "net-vin-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-vin-b",
        name: "vin",
        netId: "net-vin-b",
        direction: "input",
        interfaceInstanceIds: ["P2"],
      },
      {
        id: "terminal-out",
        name: "OUT",
        netId: "net-out",
        direction: "output",
        interfaceInstanceIds: ["P3"],
      },
      {
        id: "terminal-vss-a",
        name: "VSS",
        netId: "net-vss",
        direction: "passive",
        interfaceInstanceIds: ["P4"],
      },
      {
        id: "terminal-vss-b",
        name: "vss",
        netId: "net-vss",
        direction: "passive",
        interfaceInstanceIds: ["P5"],
      },
    );
    project.documents.push(child);
    parent.instances.push({
      id: "X1",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: null,
      netlist: {
        reference: "X1",
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
    parent.nets.push(
      {
        id: "net-parent-vin",
        terminals: [{ instanceId: "X1", pinName: "VIN" }],
      },
      {
        id: "net-parent-out",
        terminals: [{ instanceId: "X1", pinName: "OUT" }],
      },
      {
        id: "net-parent-vss",
        terminals: [{ instanceId: "X1", pinName: "VSS" }],
      },
    );

    const dynamicResolver = createProjectSymbolResolver(
      project,
      builtInSymbols,
    );
    const index = buildProjectConnectivityIndex(project, dynamicResolver);

    expect(index.hierarchy.edges).toEqual([
      expect.objectContaining({
        parentPinName: "OUT",
        childTerminalName: "OUT",
        childNetId: "net-out",
      }),
      expect.objectContaining({
        parentPinName: "VSS",
        childTerminalName: "VSS",
        childNetId: "net-vss",
      }),
    ]);
    expect(child.nets.map((net) => net.id)).toEqual([
      "net-vin-a",
      "net-vin-b",
      "net-out",
      "net-vss",
    ]);
  });
});
