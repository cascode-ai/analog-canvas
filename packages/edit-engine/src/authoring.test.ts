import { createRoutePath } from "@icm/model";
import { createEmptyDocument } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function transaction(edits: unknown[], expectedRevision = 0) {
  return {
    transactionId: `phase-8-${expectedRevision}`,
    documentId: "document-main",
    expectedRevision,
    actor: { kind: "human" as const, id: "human-test" },
    edits,
  };
}

function addInstance(id: string, symbolId: string, x: number) {
  return {
    kind: "add_instance" as const,
    instance: {
      id,
      symbolId,
      placement: {
        position: { x, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    },
  };
}

describe("semantic authoring", () => {
  it("rejects an integer typed-edit point that is not aligned to the Document grid", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(
      document,
      transaction([addInstance("R1", "resistor", 105)]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GRID_ALIGNMENT",
        path: ["edits", 0, "instance", "placement", "position", "x"],
      }),
    );
    expect(result.document).toBe(document);
  });

  it("adds devices and connects two previously unconnected pins atomically", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(
      document,
      transaction([
        addInstance("R1", "resistor", 100),
        addInstance("R2", "resistor", 220),
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: "R1", pinName: "2" },
          to: { kind: "terminal", instanceId: "R2", pinName: "1" },
          newNetId: "net-ui-1",
        },
        {
          kind: "route_orthogonal",
          routeId: "route-ui-1",
          netId: "net-ui-1",
          from: { kind: "terminal", instanceId: "R1", pinName: "2" },
          to: { kind: "terminal", instanceId: "R2", pinName: "1" },
          escapeLength: 20,
        },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      document: {
        sourceStatus: "connectivity-modified",
        instances: [{ id: "R1" }, { id: "R2" }],
        nets: [{ id: "net-ui-1", terminals: [{}, {}] }],
        routes: [{ id: "route-ui-1", netId: "net-ui-1" }],
      },
    });
    expect(document.instances).toHaveLength(0);
  });

  it("remaps a reviewed generic symbol and every persisted pin reference atomically", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "XM1",
      symbolId: "generic-block-4",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "XM1",
      netlist: {
        parameters: {},
        binding: {
          kind: "model",
          deviceClass: "mos",
          name: "sky130_fd_pr__nfet_01v8",
        },
      },
      importProvenance: {
        kind: "model",
        sourceMasterName: "sky130_fd_pr__nfet_01v8",
        sourceTarget: "model:sky130_fd_pr__nfet_01v8",
        terminalMapping: [
          { sourcePosition: 0, pinName: "P1" },
          { sourcePosition: 1, pinName: "P2" },
          { sourcePosition: 2, pinName: "P3" },
          { sourcePosition: 3, pinName: "P4" },
        ],
      },
    });
    document.nets.push(
      {
        id: "net-d",

        terminals: [{ instanceId: "XM1", pinName: "P1" }],
      },
      {
        id: "net-g",

        terminals: [{ instanceId: "XM1", pinName: "P2" }],
      },
      {
        id: "net-s",

        terminals: [{ instanceId: "XM1", pinName: "P3" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "XM1", pinName: "P4" }],
      },
    );
    document.junctions.push({
      id: "junction-d",
      netId: "net-d",
      position: { x: 100, y: 20 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-d",
        netId: "net-d",
        start: { kind: "terminal", instanceId: "XM1", pinName: "P1" },
        end: { kind: "junction", junctionId: "junction-d" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(
      document,
      transaction([
        {
          kind: "set_instance_symbol",
          instanceId: "XM1",
          symbolId: "nmos",
          pinMap: { P1: "D", P2: "G", P3: "S", P4: "B" },
        },
        {
          kind: "set_route_path",
          route: createRoutePath({
            id: "route-d",
            netId: "net-d",
            start: { kind: "terminal", instanceId: "XM1", pinName: "D" },
            end: { kind: "junction", junctionId: "junction-d" },
            bends: [{ x: 110, y: 20 }],
            modes: ["manual", "manual"],
          }),
        },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        sourceStatus: "geometry-only-changed",
        instances: [
          {
            id: "XM1",
            symbolId: "nmos",
            reference: "XM1",
            netlist: {
              parameters: {},
              binding: {
                kind: "model",
                deviceClass: "mos",
                name: "sky130_fd_pr__nfet_01v8",
              },
            },
            importProvenance: {
              terminalMapping: [
                { sourcePosition: 0, pinName: "D" },
                { sourcePosition: 1, pinName: "G" },
                { sourcePosition: 2, pinName: "S" },
                { sourcePosition: 3, pinName: "B" },
              ],
            },
          },
        ],
        routes: [
          {
            id: "route-d",
            start: { kind: "terminal", instanceId: "XM1", pinName: "D" },
          },
        ],
      },
      diff: {
        changedObjectIds: [
          "XM1",
          "net-b",
          "net-d",
          "net-g",
          "net-s",
          "route-d",
        ],
      },
    });
    expect(
      result.document.nets.map((net) => net.terminals[0]?.pinName),
    ).toEqual(["D", "G", "S", "B"]);
  });

  it("rejects an incomplete symbol pin map without partial mutation", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "X1",
      symbolId: "generic-block-4",
      placement: null,
    });
    document.nets.push({
      id: "net-a",

      terminals: [{ instanceId: "X1", pinName: "P1" }],
    });
    const result = executeTransaction(
      document,
      transaction([
        {
          kind: "set_instance_symbol",
          instanceId: "X1",
          symbolId: "nmos",
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({ ok: false, applied: false });
    expect(result.document).toBe(document);
    expect(document.instances[0]!.symbolId).toBe("generic-block-4");
  });

  it("merges complete route and junction ownership into one target Net", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      addInstance("R1", "resistor", 100).instance,
      addInstance("R2", "resistor", 220).instance,
    );
    document.nets.push(
      {
        id: "net-a",

        terminals: [{ instanceId: "R1", pinName: "2" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "R2", pinName: "1" }],
      },
    );
    document.junctions.push({
      id: "junction-b",
      netId: "net-b",
      position: { x: 180, y: 100 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-b",
        netId: "net-b",
        start: { kind: "terminal", instanceId: "R2", pinName: "1" },
        end: { kind: "junction", junctionId: "junction-b" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(
      document,
      transaction([
        { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        sourceStatus: "connectivity-modified",
        nets: [{ id: "net-a", terminals: [{}, {}] }],
        routes: [{ id: "route-b", netId: "net-a" }],
        junctions: [{ id: "junction-b", netId: "net-a" }],
      },
    });
  });

  it("retargets formal cell-interface Nets when merging", () => {
    const document = createEmptyDocument("document-main", "Main");
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
    document.netlist!.terminals = [
      {
        id: "cell-terminal-in",
        name: "IN",
        netId: "net-a",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "cell-terminal-out",
        name: "OUT",
        netId: "net-b",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction([
        { kind: "merge_nets", targetNetId: "net-a", sourceNetId: "net-b" },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [{ id: "net-a" }],
        netlist: {
          terminals: [
            { name: "IN", netId: "net-a" },
            { name: "OUT", netId: "net-a" },
          ],
        },
      },
    });
  });

  it("rejects a connected instance removal without partial mutation", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(addInstance("R1", "resistor", 100).instance);
    document.nets.push({
      id: "net-a",

      terminals: [{ instanceId: "R1", pinName: "1" }],
    });
    const before = structuredClone(document);

    const result = executeTransaction(
      document,
      transaction([{ kind: "remove_instance", instanceId: "R1" }]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({ ok: false, applied: false });
    expect(result.document).toBe(document);
    expect(document).toEqual(before);
  });

  it("joins equal name claims logically without a physical merge", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push(
      { id: "net-a", terminals: [] },
      { id: "net-b", terminals: [] },
    );
    document.connectivityEvidence.push({
      id: "claim-net-a",
      kind: "name-claim",
      netId: "net-a",
      name: "SIGNAL",
      scope: "local",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
    });
    document.annotations.push({
      id: "test-net-label-1",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-a" },
      netId: "net-a",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const named = executeTransaction(
      document,
      transaction([
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "test-net-label-2",
            kind: "net-label",
            binding: { kind: "net-name", netId: "net-b" },
            netId: "net-b",
            anchor: { kind: "free", position: { x: 20, y: 0 } },
            alignment: "start",
            rotation: 0,
            locked: false,
          },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "claim-net-b",
            kind: "name-claim",
            netId: "net-b",
            name: "signal",
            scope: "local",
            owner: { kind: "net-label", annotationId: "test-net-label-2" },
          },
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(named).toMatchObject({ ok: true });
    if (!named.ok) return;
    expect(named.document.nets).toHaveLength(2);
    expect(resolveDocumentLogicalNets(named.document).groups).toHaveLength(1);
  });

  it("moves an unlocked Junction as a typed geometry edit", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-a",

      terminals: [],
    });
    document.junctions.push({
      id: "junction-a",
      netId: "net-a",
      position: { x: 100, y: 100 },
    });
    const result = executeTransaction(
      document,
      transaction([
        {
          kind: "move_junction",
          junctionId: "junction-a",
          position: { x: 120, y: 130 },
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: true,
      document: {
        sourceStatus: "geometry-only-changed",
        junctions: [{ position: { x: 120, y: 130 } }],
      },
    });
  });

  it("creates an explicit local Net for a free wire endpoint", () => {
    const document = createEmptyDocument("document-main", "Main");
    const result = executeTransaction(
      document,
      transaction([
        {
          kind: "add_junction",
          junctionId: "junction-free",
          netId: "net-free",
          position: { x: 120, y: 80 },
          createNet: true,
        },
      ]),
      { symbolResolver: resolver },
    );
    expect(result).toMatchObject({
      ok: true,
      document: {
        nets: [{ id: "net-free", terminals: [] }],
        junctions: [{ id: "junction-free", netId: "net-free" }],
      },
    });
  });

  it("rejects an atomic group move when one member is layout-locked", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push(
      addInstance("R1", "resistor", 100).instance,
      addInstance("R2", "resistor", 220).instance,
    );
    document.layoutGroups.push({
      id: "locked-pair",
      kind: "matched-pair",
      objectIds: ["R2"],
      locked: true,
    });

    const result = executeTransaction(
      document,
      transaction([
        {
          kind: "move_instance",
          instanceId: "R1",
          position: { x: 120, y: 100 },
        },
        {
          kind: "move_instance",
          instanceId: "R2",
          position: { x: 240, y: 100 },
        },
      ]),
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("locked-pair") },
    });
    expect(
      document.instances.map((instance) => instance.placement?.position.x),
    ).toEqual([100, 220]);
  });
});
