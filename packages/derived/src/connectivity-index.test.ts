import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  type Annotation,
} from "@icm/model";
import {
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  InMemorySymbolResolver,
  builtInSymbols,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectConnectivityIndex } from "./connectivity-index.js";
import { deriveNetConnectivity } from "./connectivity.js";
import { computeNetHighlight } from "./net-highlight.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("Project Connectivity Index logical aliases", () => {
  it("enumerates Junction ownership in proportion to the number of independent Nets", () => {
    function countOwnershipReads(count: number) {
      const project = createEmptyProject("separate", "Separate conductors");
      const document = project.documents[0]!;
      let reads = 0;
      for (let i = 0; i < count; i++) {
        const id = "net-" + i;
        document.nets.push({ id, terminals: [] });
        document.junctions.push({
          id: "j-" + i,
          get netId() {
            reads++;
            return id;
          },
          position: { x: i * 20, y: 0 },
        });
      }
      const index = buildProjectConnectivityIndex(
        project,
        resolver,
      ).documents.get(document.id)!;
      expect(index.endpointToBaseNetId.size).toBe(count);
      return reads;
    }

    expect(countOwnershipReads(64)).toBeLessThanOrEqual(
      5 * countOwnershipReads(16),
    );
  });

  it("binds free labels and builds virtual edges in proportion to independent Nets", () => {
    function countReads(count: number) {
      const project = createEmptyProject("labels", "Labels");
      const doc = project.documents[0]!;
      const work = { routeNet: 0, labelId: 0, labelKind: 0 };
      for (let i = 0; i < count; i++) {
        const netId = `net-${i}`;
        const first = `a-${i}`;
        const last = `b-${i}`;
        const y = 20 * i;
        doc.nets.push({ id: netId, terminals: [] });
        doc.junctions.push(
          { id: first, netId, position: { x: 0, y } },
          { id: last, netId, position: { x: 40, y } },
        );
        doc.routes.push({
          ...createRoutePath({
            id: `route-${i}`,
            netId,
            start: { kind: "junction", junctionId: first },
            end: { kind: "junction", junctionId: last },
            bends: [],
            modes: ["manual"],
          }),
          get netId() {
            work.routeNet++;
            return netId;
          },
        });
        doc.annotations.push({
          get id() {
            work.labelId++;
            return `label-${i}`;
          },
          get kind(): "net-label" {
            work.labelKind++;
            return "net-label";
          },
          netId,
          anchor: { kind: "free", position: { x: 20, y } },
          content: { runs: [{ kind: "text", value: `sig${i}` }] },
          alignment: "start",
          rotation: 0,
          locked: false,
        });
      }
      const context = buildProjectConnectivityIndex(
        project,
        resolver,
      ).documents.get(doc.id)!;
      expect(context.netLabelBindingsByNetId.size).toBe(count);
      expect(context.netLabelBindingsByNetId.get("net-0")?.[0]?.routeId).toBe(
        "route-0",
      );
      return work;
    }
    const small = countReads(16),
      large = countReads(64);
    for (const key of ["routeNet", "labelId", "labelKind"] as const)
      expect(large[key], key).toBeLessThanOrEqual(5 * small[key]);
  });

  it("resolves route-less free labels from the endpoints of their own Net", () => {
    function reads(count: number) {
      const project = createEmptyProject("route-less", "Route-less labels");
      const doc = project.documents[0]!;
      const work = { netIds: 0, junctionIds: 0, junctionNets: 0 };
      for (let i = 0; i < count; i++) {
        const netId = `n${i}`,
          junctionId = `j${i}`;
        doc.nets.push({
          get id() {
            work.netIds++;
            return netId;
          },
          terminals: [],
        });
        doc.junctions.push({
          get id() {
            work.junctionIds++;
            return junctionId;
          },
          get netId() {
            work.junctionNets++;
            return netId;
          },
          position: { x: i * 50, y: 0 },
        });
        doc.annotations.push({
          id: `label${i}`,
          kind: "net-label",
          netId,
          anchor: { kind: "free", position: { x: i * 50, y: 5 } },
          alignment: "start",
          rotation: 0,
          locked: false,
        });
      }
      const bindings = buildProjectConnectivityIndex(
        project,
        resolver,
      ).documents.get(doc.id)!.netLabelBindingsByNetId;
      expect(bindings.get(`n${count - 1}`)?.[0]?.endpoint).toEqual({
        kind: "junction",
        junctionId: `j${count - 1}`,
      });
      return work;
    }
    const small = reads(16),
      large = reads(64);
    for (const key of ["junctionNets", "junctionIds", "netIds"] as const)
      expect(large[key], key).toBeLessThanOrEqual(5 * small[key]);
  });

  it("keeps a colon-bearing Junction distinct from a bus member when binding labels and tracing their Net", () => {
    const project = createEmptyProject("endpoint-identity", "Trace");
    const doc = project.documents[0]!;
    for (const id of ["wire", "lane", "other-lane"])
      doc.nets.push({ id, terminals: [] });
    doc.junctions.push(
      { id: "j:member:m", netId: "wire", position: { x: 0, y: 0 } },
      { id: "middle", netId: "wire", position: { x: 10, y: 0 } },
      {
        id: "j",
        netId: "lane",
        position: { x: 100, y: 0 },
        members: [
          { id: "m", netId: "lane" },
          { id: "other", netId: "other-lane" },
        ],
      },
    );
    for (const x of [0, 10])
      doc.annotations.push({
        id: `label-${x}`,
        kind: "net-label",
        netId: "wire",
        content: { runs: [{ kind: "text", value: "SIG" }] },
        anchor: { kind: "free", position: { x, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
    const index = buildProjectConnectivityIndex(project, resolver);
    const bindings = index.documents
      .get(doc.id)!
      .netLabelBindingsByNetId.get("wire")!;
    const first = { kind: "junction" as const, junctionId: "j:member:m" };
    const second = { kind: "junction" as const, junctionId: "middle" };
    expect(bindings.map((binding) => binding.endpoint)).toEqual([
      first,
      second,
    ]);
    expect(computeNetHighlight(index, doc.id, "wire", first)).toMatchObject({
      netId: "wire",
      visibleEndpoints: [first, second],
      junctions: ["j:member:m", "middle"],
      routes: [],
      virtualEdges: [
        { kind: "net-label", from: first, to: second, evidence: "SIG" },
      ],
    });
  });

  it("measures route-less endpoints against the first matching Junction in a draft with duplicate IDs", () => {
    const project = createEmptyProject(
      "duplicate-endpoints",
      "Draft junctions",
    );
    const doc = project.documents[0]!;
    doc.nets.push({ id: "n", terminals: [] }, { id: "other", terminals: [] });
    doc.junctions.push(
      { id: "duplicate", netId: "n", position: { x: 0, y: 0 } },
      { id: "middle", netId: "n", position: { x: 10, y: 0 } },
      { id: "duplicate", netId: "other", position: { x: 40, y: 0 } },
    );
    doc.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "n",
      anchor: { kind: "free", position: { x: 1, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const bindings = buildProjectConnectivityIndex(
      project,
      resolver,
    ).documents.get(doc.id)!.netLabelBindingsByNetId;
    expect(bindings.get("n")?.[0]?.endpoint).toEqual({
      kind: "junction",
      junctionId: "duplicate",
    });
  });

  it("attaches free labels by primary Route Net, breaking distance ties by ID and falling back to endpoints", () => {
    const project = createEmptyProject("bus", "Bus");
    const doc = project.documents[0]!;
    for (const id of ["primary", "lane", "isolated", "empty"])
      doc.nets.push({ id, terminals: [] });
    const members = [
      { id: "p", netId: "primary", startMemberId: "p", endMemberId: "p" },
      { id: "l", netId: "lane", startMemberId: "l", endMemberId: "l" },
    ];
    const junctionMembers = members.map(({ id, netId }) => ({ id, netId }));
    for (const [id, y] of [
      ["z-bus", -10],
      ["a-bus", 10],
    ] as const) {
      const start = id + "-start",
        end = id + "-end";
      doc.junctions.push(
        {
          id: start,
          netId: "primary",
          members: junctionMembers,
          position: { x: 0, y },
        },
        {
          id: end,
          netId: "primary",
          members: junctionMembers,
          position: { x: 40, y },
        },
      );
      doc.routes.push(
        createRoutePath({
          id,
          netId: "primary",
          members,
          start: { kind: "junction", junctionId: start },
          end: { kind: "junction", junctionId: end },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    doc.junctions.push({
      id: "solo",
      netId: "isolated",
      position: { x: 20, y: 0 },
    });
    for (const net of doc.nets)
      doc.annotations.push({
        id: net.id + "-label",
        kind: "net-label",
        netId: net.id,
        anchor: { kind: "free", position: { x: 20, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
    const context = buildProjectConnectivityIndex(
      project,
      resolver,
    ).documents.get(doc.id)!;
    const bindings = context.netLabelBindingsByNetId;
    expect(bindings.get("primary")?.[0]?.routeId).toBe("a-bus");
    expect(bindings.get("lane")?.[0]).toMatchObject({
      endpoint: { kind: "junction", junctionId: "a-bus-end", memberId: "l" },
    });
    expect(bindings.get("lane")?.[0]).not.toHaveProperty("routeId");
    expect(bindings.get("isolated")?.[0]?.endpoint).toEqual({
      kind: "junction",
      junctionId: "solo",
    });
    expect(bindings.has("empty")).toBe(false);
  });

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

    // In a draft, duplicate IDs resolve to the first annotation for both bindings.
    const labels = document.annotations.map((item, index): Annotation => ({
      ...item,
      id: "duplicate",
      binding: undefined,
      content: {
        runs: [{ kind: "text", value: index === 0 ? "FIRST" : "LAST" }],
      },
    }));
    const draft = {
      ...document,
      annotations: labels,
      connectivityEvidence: [],
    };
    const duplicate = buildProjectConnectivityIndex(
      { ...project, documents: [draft] },
      resolver,
    )
      .documents.get(draft.id)
      ?.logicalNetByBaseNetId.get("net-bias");
    expect(duplicate?.virtualEdges).toEqual([
      {
        kind: "net-label",
        from: { kind: "junction", junctionId: "J1" },
        to: { kind: "junction", junctionId: "J3" },
        evidence: "FIRST",
      },
    ]);
  });

  it("aggregates matching-name Base Nets under every Base-Net lookup", () => {
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
        owner: { kind: "net-label", annotationId: "test-net-label-1" },
        scope: "local",
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net-b",
        name: "bias",
        owner: { kind: "net-label", annotationId: "test-net-label-2" },
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

  it("creates one hierarchy edge for same-name Pins resolved to one Logical Net", () => {
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
      reference: "X1",
      netlist: {
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
        parentPinName: "VIN",
        childTerminalName: "VIN",
        childNetId: "net-vin-a",
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

  it("serves as the connectivity context of a drawing whose MOS body is hidden", () => {
    // The index's Logical Net records share a name with the endpoint
    // lookup's Logical Net resolution; the body policy must read the latter.
    const project = createEmptyProject("project-body", "Body");
    const document = project.documents[0]!;
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: null,
      },
      { id: "GND1", symbolId: "ground", placement: null },
    );
    document.nets.push(
      {
        id: "net-gnd",
        terminals: [
          { instanceId: "GND1", pinName: "0" },
          { instanceId: "M1", pinName: "S" },
        ],
      },
      { id: "net-body", terminals: [{ instanceId: "M1", pinName: "B" }] },
    );
    const index = buildProjectConnectivityIndex(project, resolver);
    for (const net of document.nets)
      expect(
        deriveNetConnectivity(
          document,
          resolver,
          net,
          index.documents.get(document.id),
        ),
      ).toEqual(deriveNetConnectivity(document, resolver, net));
  });
});
