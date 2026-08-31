import { createRoutePath } from "@icm/model";
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
      reference: "R1",
      netlist: {
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

    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ],
  });
  document.routes.push(
    createRoutePath({
      id: "route-1",
      netId: "net-1",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: "R2", pinName: "1" },
      bends: [{ x: 100, y: 80 }],
      modes: ["manual", "manual"],
    }),
  );
  document.noConnects.push({
    id: "open-r1-1",
    endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
  });
  document.annotations.push(
    {
      id: "label-r1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
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
  it("returns an offset MOS bulk terminal through its grid landing", () => {
    const document = createEmptyDocument("document-bulk", "Bulk");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-body",
      terminals: [{ instanceId: "M1", pinName: "B" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "net-body",
      position: { x: 180, y: 100 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-body",
        netId: "net-body",
        start: { kind: "terminal", instanceId: "M1", pinName: "B" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [{ x: 100, y: 100 }],
        modes: ["escape", "manual"],
        presentation: "bulk-dashed",
      }),
    );

    const edits = planInstanceUnplacement(document, resolver, ["M1"], 9);
    expect(edits[0]).toMatchObject({
      kind: "add_junction",
      position: { x: 100, y: 100 },
    });
    expect(edits[1]).toMatchObject({
      kind: "set_route_path",
      route: expect.objectContaining({
        legs: [expect.objectContaining({ mode: "manual" })],
      }),
    });
    expect(
      executeTransaction(document, transaction(document.id, edits), {
        symbolResolver: resolver,
      }),
    ).toMatchObject({ ok: true });
  });

  it("returns a formal Cell Pin without removing its exported interface", () => {
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
      "set_route_path",
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
            reference: "R1",
            netlist: { parameters: { resistance: "10k" } },
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
            start: {
              kind: "junction",
              junctionId: "junction-lifecycle-3-1",
            },
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
            start: {
              kind: "junction",
              junctionId: "junction-lifecycle-5-1",
            },
            legs: [
              expect.any(Object),
              expect.objectContaining({
                to: {
                  kind: "endpoint",
                  endpoint: {
                    kind: "terminal",
                    instanceId: "R2",
                    pinName: "1",
                  },
                },
              }),
            ],
          },
        ],
      },
    });
  });

  it("prunes the final unreferenced local Cell Pin Net with its marker", () => {
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

  it("retires imported Net provenance after deleting its final electrical owner", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.sourceBinding = {
      cellName: "Main",
      sourceRef: {
        fileId: "main.spi",
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 1, line: 1, column: 2 },
      },
    };
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

      terminals: [{ instanceId: "P1", pinName: "P" }],
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
        nets: [],
        connectivityEvidence: [],
        sourceBinding: { cellName: "Main" },
        sourceStatus: "connectivity-modified",
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
            terminals: [{ instanceId: "P1", pinName: "P" }],
          },
        ],
        netlist: { terminals: [{ id: "terminal-vin", netId: "net-vin" }] },
      },
    });
  });
});
