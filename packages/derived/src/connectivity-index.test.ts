import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
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
  it("retains label virtual edges while sharing document connectivity work", () => {
    const project = createEmptyProject("project-labels", "Labels");
    const document = project.documents[0]!;
    document.nets.push({ id: "net-bias", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net-bias", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net-bias", position: { x: 40, y: 0 } },
      { id: "J3", netId: "net-bias", position: { x: 100, y: 0 } },
      { id: "J4", netId: "net-bias", position: { x: 140, y: 0 } },
    );
    const routes = [
      createRoutePath({
        id: "route-a",
        netId: "net-bias",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-b",
        netId: "net-bias",
        start: { kind: "junction", junctionId: "J3" },
        end: { kind: "junction", junctionId: "J4" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    document.routes.push(...routes);
    for (const [id, route] of [
      ["label-z", routes[0]!],
      ["label-a", routes[1]!],
    ] as const) {
      document.annotations.push({
        id,
        kind: "net-label",
        binding: { kind: "net-name", netId: "net-bias" },
        netId: "net-bias",
        anchor: {
          kind: "route",
          routeId: route.id,
          legId: route.legs[0]!.id,
          t: 0.5,
          normalOffset: 10,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: { x: 20, y: -10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: `claim-${id}`,
        kind: "name-claim",
        netId: "net-bias",
        name: "BIAS",
        owner: { kind: "net-label", annotationId: id },
        scope: "local",
      });
    }

    const record = buildProjectConnectivityIndex(project, resolver)
      .documents.get(document.id)
      ?.logicalNetByBaseNetId.get("net-bias");
    expect(record?.routedComponents).toHaveLength(1);
    expect(record?.routes).toEqual(["route-a", "route-b"]);
    expect(record?.junctions).toEqual(["J1", "J2", "J3", "J4"]);
    expect(record?.virtualEdges).toEqual([
      {
        kind: "net-label",
        from: { kind: "junction", junctionId: "J1" },
        to: { kind: "junction", junctionId: "J3" },
        evidence: "BIAS",
      },
    ]);
  });

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
