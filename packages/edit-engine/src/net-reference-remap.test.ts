import { describe, expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";

import {
  clearMosBulkDefaultNetReference,
  isBaseNetReferenced,
  partitionNetSubgraphComponents,
  planSubgraphNetLift,
  remapDocumentNetReferences,
} from "./net-reference-remap.js";

describe("net-reference-remap", () => {
  it("remaps all linked document tables and deduplicates connectivity evidence", () => {
    const doc = createEmptyDocument("doc-1", "Doc");
    doc.nets.push(
      { id: "net-src", terminals: [] },
      { id: "net-dst", terminals: [] },
    );
    doc.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        mosBulkBinding: { origin: "cell-default", netId: "net-src" },
      },
      {
        id: "E1",
        symbolId: "vcvs",
        placement: { position: { x: 80, y: 0 }, rotation: 0, mirror: "none" },
        netlist: {
          parameters: {},
          control: {
            kind: "voltage",
            positiveNetId: "net-src",
            negativeNetId: "net-src",
          },
        },
      },
    );
    doc.mosBulkDefaults = { nmosNetId: "net-src", pmosNetId: "net-src" };
    doc.netlist = {
      name: "top",
      formalParameters: [],
      terminals: [
        {
          id: "term-1",
          name: "D<1:0>",
          direction: "inout",
          netId: "net-src",
          interfaceInstanceIds: [],
          signal: {
            expression: "D<1:0>",
            members: [
              { id: "m0", name: "D<0>", netId: "net-src" },
              { id: "m1", name: "D<1>", netId: "net-other" },
            ],
          },
        },
      ],
    };
    doc.junctions.push({
      id: "j1",
      netId: "net-src",
      position: { x: 10, y: 10 },
      members: [{ id: "jm0", netId: "net-src" }],
    });
    doc.routes.push(
      createRoutePath({
        id: "r1",
        netId: "net-src",
        start: { kind: "terminal", instanceId: "M1", pinName: "D" },
        end: { kind: "junction", junctionId: "j1" },
        bends: [],
        modes: ["manual"],
        members: [
          {
            id: "rm0",
            netId: "net-src",
            startMemberId: "m0",
            endMemberId: "jm0",
          },
        ],
      }),
    );
    doc.annotations.push({
      id: "a1",
      kind: "net-label",
      netId: "net-src",
      binding: { kind: "net-name", netId: "net-src" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    doc.layoutGroups.push({
      id: "lg1",
      kind: "custom",
      objectIds: ["net-src", "M1"],
      locked: false,
    });
    doc.constraints.push({
      id: "c1",
      kind: "align-x",
      objectIds: ["net-src", "net-dst"],
      locked: false,
    });
    doc.connectivityEvidence.push(
      {
        id: "ev-src-1",
        kind: "spice-source",
        netId: "net-src",
        sourceNetId: "n1",
      },
      {
        id: "ev-dst-1",
        kind: "spice-source",
        netId: "net-dst",
        sourceNetId: "n1",
      },
      {
        id: "ev-claim",
        kind: "name-claim",
        netId: "net-src",
        name: "D<1:0>",
        scope: "local",
        owner: { kind: "net-label", annotationId: "a1" },
        signal: {
          expression: "D<1:0>",
          members: [{ id: "cm0", name: "D<0>", netId: "net-src" }],
        },
      },
    );

    const changed = new Set<string>();
    remapDocumentNetReferences(doc, "net-src", "net-dst", changed);

    expect(doc.instances[0]!.mosBulkBinding?.netId).toBe("net-dst");
    expect(doc.instances[1]!.netlist?.control).toEqual({
      kind: "voltage",
      positiveNetId: "net-dst",
      negativeNetId: "net-dst",
    });
    expect(doc.mosBulkDefaults).toEqual({
      nmosNetId: "net-dst",
      pmosNetId: "net-dst",
    });
    expect(doc.netlist.terminals[0]!.netId).toBe("net-dst");
    expect(doc.netlist.terminals[0]!.signal?.members[0]!.netId).toBe("net-dst");
    expect(doc.routes[0]!.netId).toBe("net-dst");
    expect(doc.routes[0]!.members?.[0]!.netId).toBe("net-dst");
    expect(doc.junctions[0]!.netId).toBe("net-dst");
    expect(doc.junctions[0]!.members?.[0]!.netId).toBe("net-dst");
    expect(doc.annotations[0]!.netId).toBe("net-dst");
    expect(doc.annotations[0]!.binding).toEqual({
      kind: "net-name",
      netId: "net-dst",
    });
    expect(doc.layoutGroups[0]!.objectIds).toEqual(["net-dst", "M1"]);
    expect(doc.constraints[0]!.objectIds).toEqual(["net-dst"]);
    expect(doc.connectivityEvidence.map((e) => e.id)).toEqual([
      "ev-src-1",
      "ev-claim",
    ]);
    expect(doc.connectivityEvidence[0]!.netId).toBe("net-dst");
    const claim = doc.connectivityEvidence[1]!;
    expect(claim.kind === "name-claim" && claim.signal?.members[0]!.netId).toBe(
      "net-dst",
    );
    expect(isBaseNetReferenced(doc, "net-src")).toBe(false);
    expect(isBaseNetReferenced(doc, "net-dst")).toBe(true);
  });

  it("clears mosBulkDefaults cleanly and drops container when empty", () => {
    const doc = createEmptyDocument("doc-1", "Doc");
    doc.mosBulkDefaults = { nmosNetId: "gnd", pmosNetId: "vdd" };
    const changed = new Set<string>();
    expect(clearMosBulkDefaultNetReference(doc, "gnd", changed)).toBe(true);
    expect(doc.mosBulkDefaults).toEqual({ pmosNetId: "vdd" });
    expect(clearMosBulkDefaultNetReference(doc, "vdd", changed)).toBe(true);
    expect(doc.mosBulkDefaults).toBeUndefined();
    expect(changed.has("doc-1")).toBe(true);
  });

  it("partitions disconnected moving subgraphs and lifts annotations and evidence", () => {
    const doc = createEmptyDocument("doc-1", "Doc");
    doc.junctions.push(
      { id: "j1", netId: "n1", position: { x: 0, y: 0 } },
      { id: "j2", netId: "n1", position: { x: 40, y: 0 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "r1",
        netId: "n1",
        start: { kind: "terminal", instanceId: "R1", pinName: "P1" },
        end: { kind: "junction", junctionId: "j1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    doc.annotations.push({
      id: "a1",
      kind: "net-label",
      netId: "n1",
      binding: { kind: "net-name", netId: "n1" },
      anchor: {
        kind: "route",
        routeId: "r1",
        legId: doc.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 10, y: -10 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    doc.connectivityEvidence.push({
      id: "ev1",
      kind: "name-claim",
      netId: "n1",
      name: "SIG",
      scope: "local",
      owner: { kind: "net-label", annotationId: "a1" },
    });

    const components = partitionNetSubgraphComponents(
      doc,
      "n1",
      new Set(["r1"]),
      new Set(["j1", "j2"]),
      [{ instanceId: "R1", pinName: "P1" }],
      [],
    );
    expect(components).toHaveLength(2);
    const routed = components.find((c) => c.routeIds.has("r1"))!;
    const edits = planSubgraphNetLift(doc, "n1", routed, "n-lift");
    expect(edits.map((e) => e.kind)).toEqual([
      "upsert_schematic_annotation",
      "remove_route_geometry",
      "remove_junction",
      "disconnect_endpoint",
      "create_base_net",
      "add_junction",
      "set_route_path",
      "upsert_schematic_annotation",
      "upsert_connectivity_evidence",
    ]);
    const restoredEvidence = edits.at(-1)!;
    expect(
      restoredEvidence.kind === "upsert_connectivity_evidence" &&
        restoredEvidence.evidence.netId,
    ).toBe("n-lift");
  });
});
