import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  instanceOwnedAnnotationIds,
  planInstanceDeletion,
  planInstanceUnplacement,
} from "./instance-lifecycle.js";
import type { SchematicEdit } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function lifecycleDocument() {
  const document = createEmptyDocument("document-main", "Main");
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        reference: "R1",
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { resistance: "10k" },
      },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: 240, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    },
  );
  document.nets.push({
    id: "net-1",
    scope: "local",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ],
  });
  document.routes.push({
    id: "route-1",
    netId: "net-1",
    from: { kind: "terminal", instanceId: "R1", pinName: "2" },
    to: { kind: "terminal", instanceId: "R2", pinName: "1" },
    waypoints: [{ x: 100, y: 80 }],
    segmentModes: ["manual", "manual"],
  });
  document.noConnects.push({
    id: "open-r1-1",
    endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
  });
  document.annotations.push(
    {
      id: "label-r1",
      kind: "instance-label",
      binding: { kind: "instance-schematic-name", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 40 },
        fallbackPosition: { x: 100, y: 140 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
    {
      id: "free-value-r1",
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "R1" },
      anchor: { kind: "free", position: { x: 130, y: 100 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
  );
  document.layoutGroups.push({
    id: "group-r1",
    kind: "custom",
    objectIds: ["R1"],
    locked: false,
  });
  document.constraints.push({
    id: "align-r1-r2",
    kind: "align-y",
    objectIds: ["R1", "R2"],
    locked: false,
  });
  return document;
}

function transaction(documentId: string, edits: readonly SchematicEdit[]) {
  return {
    transactionId: "instance-lifecycle",
    documentId,
    expectedRevision: 0,
    actor: { kind: "human" as const, id: "test" },
    edits,
  };
}

describe("Instance lifecycle planning", () => {
  it("returns a formal Cell Port without removing its exported interface", () => {
    const document = createEmptyDocument("document-child", "Child");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 80, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-vin",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin",
          name: "VIN",
          netId: "net-vin",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };

    const result = executeTransaction(
      document,
      transaction(
        document.id,
        planInstanceUnplacement(document, resolver, ["P1"], 1),
      ),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [{ id: "P1", placement: null }],
        netlist: {
          terminals: [
            {
              name: "VIN",
              interfaceInstanceIds: ["P1"],
              netId: "net-vin",
            },
          ],
        },
        nets: [{ terminals: [{ instanceId: "P1", pinName: "P" }] }],
      },
    });
  });

  it("returns an Instance to the tray without changing its electrical facts", () => {
    const document = lifecycleDocument();
    const edits = planInstanceUnplacement(document, resolver, ["R1"], 3);
    expect(edits.map((edit) => edit.kind)).toEqual([
      "add_junction",
      "set_route_points",
      "unplace_instance",
    ]);

    const result = executeTransaction(
      document,
      transaction(document.id, edits),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [
          {
            id: "R1",
            placement: null,
            netlist: { reference: "R1", parameters: { resistance: "10k" } },
          },
          { id: "R2" },
        ],
        nets: [
          {
            terminals: [
              { instanceId: "R1", pinName: "2" },
              { instanceId: "R2", pinName: "1" },
            ],
          },
        ],
        noConnects: [{ id: "open-r1-1" }],
        annotations: [{ id: "label-r1" }, { id: "free-value-r1" }],
        routes: [
          {
            from: { kind: "junction", junctionId: "junction-lifecycle-3-1" },
          },
        ],
      },
    });
  });

  it("rejects raw unplacement while route geometry still targets the Instance", () => {
    const document = lifecycleDocument();
    const result = executeTransaction(
      document,
      transaction(document.id, [
        { kind: "unplace_instance", instanceId: "R1" },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("detach routes") },
    });
  });

  it("deletes route, NoConnect, annotation, and layout references atomically", () => {
    const document = lifecycleDocument();
    const edits = planInstanceDeletion(document, resolver, ["R1"], 5);
    expect(instanceOwnedAnnotationIds(document, ["R1"])).toEqual(
      new Set(["label-r1", "free-value-r1"]),
    );

    const result = executeTransaction(
      document,
      transaction(document.id, edits),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [{ id: "R2" }],
        nets: [{ terminals: [{ instanceId: "R2", pinName: "1" }] }],
        noConnects: [],
        annotations: [],
        layoutGroups: [],
        constraints: [],
        routes: [
          {
            from: { kind: "junction", junctionId: "junction-lifecycle-5-1" },
            to: { kind: "terminal", instanceId: "R2", pinName: "1" },
          },
        ],
      },
    });
  });

  it("prunes the final unreferenced local Free Port Net with its Port", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-port-p1",
      name: "BUS",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.annotations.push({
      id: "instance-label-P1",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-port-p1" },
      netId: "net-port-p1",
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: { x: 10, y: 0 },
        fallbackPosition: { x: 110, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const result = executeTransaction(
      document,
      transaction(
        document.id,
        planInstanceDeletion(document, resolver, ["P1"], 6),
      ),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: { instances: [], nets: [], annotations: [] },
    });
  });

  it("retains imported Net provenance after deleting its final Port marker", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-port-p1",
      name: "BUS",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
      origin: { kind: "spice-import", sourceNetIds: ["source-bus"] },
    });
    document.connectivityEvidence.push({
      id: "source-bus-evidence",
      kind: "spice-source",
      netId: "net-port-p1",
      sourceNetId: "source-bus",
    });
    document.annotations.push({
      id: "instance-label-P1",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-port-p1" },
      netId: "net-port-p1",
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: { x: 10, y: 0 },
        fallbackPosition: { x: 110, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const result = executeTransaction(
      document,
      transaction(
        document.id,
        planInstanceDeletion(document, resolver, ["P1"], 7),
      ),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        instances: [],
        annotations: [],
        nets: [{ id: "net-port-p1", terminals: [] }],
        connectivityEvidence: [
          expect.objectContaining({
            kind: "spice-source",
            netId: "net-port-p1",
            sourceNetId: "source-bus",
          }),
        ],
      },
    });
  });

  it("rejects disconnecting a formal Cell interface Net", () => {
    const document = createEmptyDocument("document-child", "Child");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-vin",
      name: "VIN",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin",
          name: "VIN",
          netId: "net-vin",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };

    const result = executeTransaction(
      document,
      transaction(document.id, [
        {
          kind: "disconnect_endpoint",
          endpoint: { kind: "terminal", instanceId: "P1", pinName: "P" },
        },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: false,
      document: {
        nets: [
          {
            id: "net-vin",
            name: "VIN",
            terminals: [{ instanceId: "P1", pinName: "P" }],
          },
        ],
        netlist: { terminals: [{ id: "terminal-vin", netId: "net-vin" }] },
      },
    });
  });
});
