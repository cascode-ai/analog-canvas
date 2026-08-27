import { createRoutePath, routeEnd } from "@icm/model";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  endpointKey,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import type { RouteEndpoint, SchematicDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";
import { DocumentHistory } from "./history.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };
const terminal = (instanceId: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName: "P",
});

function fixture(): SchematicDocument {
  const document = parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
  document.instances = document.instances.filter((instance) =>
    ["A", "B"].includes(instance.id),
  );
  document.nets = [
    {
      id: "net-contact",

      terminals: [
        { instanceId: "A", pinName: "P" },
        { instanceId: "B", pinName: "P" },
      ],
    },
  ];
  document.netlist!.terminals = ["A", "B"].map((instanceId) => ({
    id: `cell-terminal-${instanceId.toLowerCase()}`,
    name: instanceId,
    netId: "net-contact",
    direction: "passive" as const,
    interfaceInstanceIds: [instanceId],
  }));
  document.connectivityEvidence = [];
  document.instances.find((instance) => instance.id === "B")!.placement = {
    position: { x: 160, y: 300 },
    rotation: 0,
    mirror: "x",
  };
  return document;
}

function transaction(
  document: SchematicDocument,
  edits: unknown[],
  suffix = "edit",
) {
  return {
    transactionId: `direct-contact-${suffix}-${document.revision}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human" as const, id: "direct-contact-test" },
    edits,
  };
}

describe("direct-contact transform lifecycle", () => {
  it("materializes an ordinary Route when one endpoint moves away", () => {
    const document = fixture();
    const result = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 100, y: 300 },
        },
      ]),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toHaveLength(1);
    const route = result.document.routes[0]!;
    expect(
      new Set([endpointKey(route.start), endpointKey(routeEnd(route))]),
    ).toEqual(
      new Set([endpointKey(terminal("A")), endpointKey(terminal("B"))]),
    );
    expect(route.netId).toBe("net-contact");
    expect(
      resolveRouteGeometry(result.document, resolver, route)?.centerline,
    ).toEqual(
      expect.arrayContaining([
        { x: 110, y: 300 },
        { x: 150, y: 300 },
      ]),
    );
  });

  it("keeps a jointly moved direct contact route-free", () => {
    const document = fixture();
    const result = executeTransaction(
      document,
      transaction(document, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 180, y: 320 },
        },
        {
          kind: "move_instance",
          instanceId: "B",
          position: { x: 200, y: 320 },
        },
      ]),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toEqual([]);
  });

  it.each([
    {
      label: "rotation",
      edit: { kind: "rotate_instance", instanceId: "A", rotation: 90 },
    },
    {
      label: "mirror",
      edit: { kind: "mirror_instance", instanceId: "A", mirror: "x" },
    },
  ])("materializes a Route after $label separates the pins", ({ edit }) => {
    const document = fixture();
    const result = executeTransaction(
      document,
      transaction(document, [edit], edit.kind),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toHaveLength(1);
    expect(result.document.routes[0]).toMatchObject({ netId: "net-contact" });
  });

  it("does not add a duplicate Route when another physical path remains", () => {
    const document = fixture();
    document.junctions.push({
      id: "J1",
      netId: "net-contact",
      position: { x: 300, y: 300 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "route-a-j1",
        netId: "net-contact",
        start: terminal("A"),
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-b-j1",
        netId: "net-contact",
        start: terminal("B"),
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "move_instance",
            instanceId: "A",
            position: { x: 100, y: 300 },
          },
        ],
        "alternate-path",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes.map((route) => route.id).sort()).toEqual([
      "route-a-j1",
      "route-b-j1",
    ]);
  });

  it("splits the Base Net when the materialized Route is deleted", () => {
    const document = fixture();
    const moved = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "move_instance",
            instanceId: "A",
            position: { x: 100, y: 300 },
          },
        ],
        "move-before-cut",
      ),
      context,
    );
    if (!moved.ok) throw new Error(moved.error.message);
    const routeId = moved.document.routes[0]!.id;

    const cut = executeTransaction(
      moved.document,
      transaction(moved.document, [{ kind: "cut_connection", routeId }], "cut"),
      context,
    );
    if (!cut.ok) throw new Error(cut.error.message);
    const owner = (instanceId: string) =>
      cut.document.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === instanceId),
      )?.id;
    expect(cut.document.routes).toEqual([]);
    expect(owner("A")).toBeTruthy();
    expect(owner("B")).toBeTruthy();
    expect(owner("A")).not.toBe(owner("B"));
  });

  it("preserves a direct-contact component when another Route is cut", () => {
    const document = fixture();
    document.junctions.push({
      id: "J1",
      netId: "net-contact",
      position: { x: 300, y: 300 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "route-a-j1",
        netId: "net-contact",
        start: terminal("A"),
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const cut = executeTransaction(
      document,
      transaction(
        document,
        [{ kind: "cut_connection", routeId: "route-a-j1" }],
        "direct-contact-cut",
      ),
      context,
    );
    if (!cut.ok) throw new Error(cut.error.message);
    const aOwner = cut.document.nets.find((net) =>
      net.terminals.some((candidate) => candidate.instanceId === "A"),
    )?.id;
    const bOwner = cut.document.nets.find((net) =>
      net.terminals.some((candidate) => candidate.instanceId === "B"),
    )?.id;
    expect(aOwner).toBe(bOwner);
  });

  it("keeps moved endpoints electrically separate at exact contact", () => {
    const document = fixture();
    document.instances.find((instance) => instance.id === "B")!.placement = {
      position: { x: 460, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    document.nets = [
      {
        id: "net-a",

        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-b",

        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    ];
    document.netlist!.terminals[0]!.netId = "net-a";
    document.netlist!.terminals[1]!.netId = "net-b";
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "move_instance",
            instanceId: "B",
            position: { x: 160, y: 300 },
          },
        ],
        "conflict",
      ),
      context,
    );

    // Rearranging existing geometry never bonds: both Base Nets survive
    // with their original memberships even though the pins now coincide.
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "net-a",
          terminals: [{ instanceId: "A", pinName: "P" }],
        }),
        expect.objectContaining({
          id: "net-b",
          terminals: [{ instanceId: "B", pinName: "P" }],
        }),
      ]),
    );
    expect(result.document.nets).toHaveLength(2);
  });

  it("never rejects a transform for domains it must not merge", () => {
    const document = fixture();
    document.instances.find((instance) => instance.id === "B")!.placement = {
      position: { x: 460, y: 300 },
      rotation: 0,
      mirror: "x",
    };
    document.nets = [
      {
        id: "net-vdd",
        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    ];
    document.netlist!.terminals[0]!.netId = "net-vdd";
    document.netlist!.terminals[1]!.netId = "net-ground";
    document.connectivityEvidence = [
      {
        id: "claim-vdd",
        kind: "name-claim",
        netId: "net-vdd",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "explicit-net-property" },
      },
      {
        id: "claim-ground",
        kind: "name-claim",
        netId: "net-ground",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "explicit-net-property" },
      },
    ];

    // The move parks a ground pin exactly on a VDD pin. Since transforms
    // never bond, there is no merge to reject: the move succeeds and the
    // domains stay on their own Nets (this is the group-mirror regression:
    // a rearrange must never fail with a merge precondition).
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "move_instance",
            instanceId: "B",
            position: { x: 160, y: 300 },
          },
        ],
        "power-conflict",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets.map((net) => net.id).sort()).toEqual([
      "net-ground",
      "net-vdd",
    ]);
  });

  it("rejects a new Junction bonding incompatible power domains", () => {
    const document = fixture();
    document.nets = [
      {
        id: "net-vdd",
        terminals: [{ instanceId: "A", pinName: "P" }],
      },
      {
        id: "net-ground",
        terminals: [{ instanceId: "B", pinName: "P" }],
      },
    ];
    document.netlist!.terminals[0]!.netId = "net-vdd";
    document.netlist!.terminals[1]!.netId = "net-ground";
    document.connectivityEvidence = [
      {
        id: "claim-vdd",
        kind: "name-claim",
        netId: "net-vdd",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "explicit-net-property" },
      },
      {
        id: "claim-ground",
        kind: "name-claim",
        netId: "net-ground",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "explicit-net-property" },
      },
    ];

    // An explicit Junction is authored geometry, so it does bond — and a
    // bond across power domains is rejected atomically.
    const contact = resolveEndpointConnection(
      document,
      resolver,
      terminal("A"),
    )!.contactPoint;
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "add_junction",
            junctionId: "junction-conflict",
            netId: "net-ground",
            position: contact,
          },
        ],
        "junction-power-conflict",
      ),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "EDIT_PRECONDITION",
        message: "Cannot merge Nets with incompatible power domains",
      },
    });
  });

  it("assigns an ownerless terminal to the contacted Net and clears NoConnect", () => {
    const document = fixture();
    document.instances = [
      {
        id: "A",
        symbolId: "ground",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.netlist!.terminals = [];
    document.nets = [
      {
        id: "net-a",
        terminals: [{ instanceId: "A", pinName: "0" }],
      },
    ];
    document.noConnects = [
      {
        id: "no-connect-a",
        endpoint: { kind: "terminal", instanceId: "A", pinName: "0" },
      },
    ];

    // Newly placed geometry bonds from its final exact placement, and the
    // bond retires the NoConnect declarations on both endpoints.
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "add_instance",
            instance: {
              id: "B",
              symbolId: "ground",
              placement: {
                position: { x: 100, y: 100 },
                rotation: 0,
                mirror: "none",
              },
            },
          },
        ],
        "ownerless-contact",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets).toHaveLength(1);
    expect(result.document.nets[0]?.terminals).toEqual(
      expect.arrayContaining([
        { instanceId: "A", pinName: "0" },
        { instanceId: "B", pinName: "0" },
      ]),
    );
    expect(result.document.noConnects).toEqual([]);
  });

  it("connects a newly added instance from its final exact placement", () => {
    const document = fixture();
    document.instances = [
      {
        id: "A",
        symbolId: "ground",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.netlist!.terminals = [];
    document.nets = [
      {
        id: "net-ground",
        terminals: [{ instanceId: "A", pinName: "0" }],
      },
    ];
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "add_instance",
            instance: {
              id: "B",
              symbolId: "ground",
              placement: {
                position: { x: 100, y: 100 },
                rotation: 0,
                mirror: "none",
              },
            },
          },
        ],
        "add-instance-contact",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets).toEqual([
      expect.objectContaining({
        id: "net-ground",
        terminals: expect.arrayContaining([
          { instanceId: "A", pinName: "0" },
          { instanceId: "B", pinName: "0" },
        ]),
      }),
    ]);
  });

  it("honors an explicit disconnect even while endpoints remain coincident", () => {
    const document = fixture();
    document.instances = ["A", "B"].map((id) => ({
      id,
      symbolId: "ground",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    }));
    document.netlist!.terminals = [];
    document.nets = [
      {
        id: "net-contact",
        terminals: ["A", "B"].map((instanceId) => ({
          instanceId,
          pinName: "0",
        })),
      },
    ];
    const groundEndpoint = (instanceId: string): RouteEndpoint => ({
      kind: "terminal",
      instanceId,
      pinName: "0",
    });
    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "disconnect_endpoint",
            endpoint: groundEndpoint("B"),
          },
        ],
        "explicit-disconnect",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets[0]?.terminals).toEqual([
      { instanceId: "A", pinName: "0" },
    ]);
  });

  it("attaches every explicit Junction crossed by a newly added power rail", () => {
    const document = fixture();
    document.instances = [];
    document.netlist!.terminals = [];
    document.nets = [
      { id: "net-left", terminals: [] },
      { id: "net-right", terminals: [] },
    ];
    document.junctions = [
      {
        id: "junction-left",
        netId: "net-left",
        position: { x: 120, y: 300 },
        role: "route-anchor",
      },
      {
        id: "junction-right",
        netId: "net-right",
        position: { x: 180, y: 300 },
        role: "route-anchor",
      },
    ];

    const result = executeTransaction(
      document,
      transaction(
        document,
        [
          {
            kind: "add_power_rail",
            netId: "net-rail",
            routeId: "route-rail",
            startJunctionId: "rail-start",
            endJunctionId: "rail-end",
            labelId: "rail-label",
            netName: "VDD",
            scope: "global",
            powerDomain: "vdd",
            start: { x: 100, y: 300 },
            end: { x: 200, y: 300 },
          },
        ],
        "rail-crosses-junctions",
      ),
      context,
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.nets).toHaveLength(1);
    expect(
      new Set(result.document.junctions.map((junction) => junction.netId)),
    ).toEqual(new Set([result.document.nets[0]!.id]));
    expect(result.document.routes).toHaveLength(3);
    expect(
      result.document.routes.flatMap((route) => [
        endpointKey(route.start),
        endpointKey(routeEnd(route)),
      ]),
    ).toEqual(
      expect.arrayContaining([
        "junction:junction-left",
        "junction:junction-right",
      ]),
    );
  });

  it("restores both zero-length contact and materialized Route with history", () => {
    const document = fixture();
    const history = new DocumentHistory(document, context);
    const moved = history.transact(
      transaction(
        document,
        [
          {
            kind: "move_instance",
            instanceId: "A",
            position: { x: 100, y: 300 },
          },
        ],
        "history-move",
      ),
    );
    if (!moved.ok) throw new Error(moved.error.message);
    expect(history.document.routes).toHaveLength(1);

    const undo = history.transact(
      transaction(history.document, [{ kind: "undo" }], "undo"),
    );
    if (!undo.ok) throw new Error(undo.error.message);
    expect(history.document.routes).toEqual([]);
    expect(
      history.document.instances.find((instance) => instance.id === "A")
        ?.placement?.position,
    ).toEqual({ x: 140, y: 300 });

    const redo = history.transact(
      transaction(history.document, [{ kind: "redo" }], "redo"),
    );
    if (!redo.ok) throw new Error(redo.error.message);
    expect(history.document.routes).toHaveLength(1);
    expect(
      history.document.instances.find((instance) => instance.id === "A")
        ?.placement?.position,
    ).toEqual({ x: 100, y: 300 });
  });
});
