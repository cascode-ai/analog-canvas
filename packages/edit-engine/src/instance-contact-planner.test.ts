import {
  createEmptyDocument,
  createRoutePath,
  routeEndpoints,
  type Instance,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { endpointKey, resolveEndpointConnection } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  placementWireSources,
  proposePlacementContact,
} from "./instance-contact-planner.js";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";
import type { WireSource } from "./routing-planner.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function resistor(
  id: string,
  position: { x: number; y: number },
  rotation: 0 | 90 = 0,
): Instance {
  return {
    id,
    symbolId: "resistor",
    placement: { position, rotation, mirror: "none" },
  };
}

/** What the editor offers a dropped part: other parts' pins and Junctions. */
function dropTargets(
  document: SchematicDocument,
  placed: Instance,
): WireSource[] {
  return [
    ...document.instances
      .filter((candidate) => candidate.id !== placed.id)
      .flatMap((candidate) =>
        placementWireSources(document, resolver, candidate),
      ),
    ...document.junctions.flatMap((junction) => {
      const endpoint = { kind: "junction" as const, junctionId: junction.id };
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
      );
      return connection
        ? [{ endpoint, connection, netId: junction.netId, preludeEdits: [] }]
        : [];
    }),
  ];
}

/**
 * RL hangs from its pin 2 at (0,0) on a wire down to a T-Junction on a
 * ground rail at y=100, as in the Cell of issue #1267.
 */
function wireEndingInATee(): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  document.instances.push(resistor("RL", { x: 0, y: -20 }));
  document.nets.push({
    id: "net-gnd",
    terminals: [{ instanceId: "RL", pinName: "2" }],
  });
  document.junctions.push(
    { id: "tee", netId: "net-gnd", position: { x: 0, y: 100 } },
    {
      id: "left",
      netId: "net-gnd",
      position: { x: -100, y: 100 },
      role: "route-anchor",
    },
    {
      id: "right",
      netId: "net-gnd",
      position: { x: 100, y: 100 },
      role: "route-anchor",
    },
  );
  const junction = (junctionId: string) => ({
    kind: "junction" as const,
    junctionId,
  });
  document.routes.push(
    createRoutePath({
      id: "stem",
      netId: "net-gnd",
      start: { kind: "terminal", instanceId: "RL", pinName: "2" },
      end: junction("tee"),
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "rail-left",
      netId: "net-gnd",
      start: junction("left"),
      end: junction("tee"),
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "rail-right",
      netId: "net-gnd",
      start: junction("tee"),
      end: junction("right"),
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

function drop(document: SchematicDocument, placed: Instance) {
  const proposal = proposePlacementContact(
    document,
    resolver,
    placed,
    dropTargets(document, placed),
  );
  if (!proposal.matched) return { proposal, result: undefined };
  const edits = [{ kind: "add_instance" as const, instance: placed }];
  const operation = createRoutingOperationPlan(document, {
    intent: "connect",
    edits: [...edits, ...proposal.edits],
    diagnostics: [],
    expectedElectricalEffect: proposal.expectedElectricalEffect!,
  });
  expect(
    gateRoutingOperationPlan(document, operation, {
      symbolResolver: resolver,
    }).ok,
  ).toBe(true);
  const result = executeTransaction(
    document,
    {
      transactionId: "drop",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      dryRun: false,
      edits: [...edits, ...proposal.edits],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(result.error.message);
  return { proposal, result: result.document };
}

function netOf(document: SchematicDocument, endpoint: RouteEndpoint) {
  if (endpoint.kind === "junction")
    return document.junctions.find((j) => j.id === endpoint.junctionId)?.netId;
  if (endpoint.kind !== "terminal") return undefined;
  return document.nets.find((net) =>
    net.terminals.some(
      (terminal) =>
        terminal.instanceId === endpoint.instanceId &&
        terminal.pinName === endpoint.pinName,
    ),
  )?.id;
}

const pin = (instanceId: string, pinName: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName,
});

function routeBetween(
  document: SchematicDocument,
  first: RouteEndpoint,
  second: RouteEndpoint,
) {
  return document.routes.find((route) => {
    const keys = routeEndpoints(route).map(endpointKey);
    return (
      keys.includes(endpointKey(first)) && keys.includes(endpointKey(second))
    );
  });
}

describe("dropping a two-pin part over the end of a Wire", () => {
  it("puts it in series when one pin lands inside the Wire and the other on the T-Junction that ends it", () => {
    const document = wireEndingInATee();
    // Pin 1 at (0,60) inside the stem, pin 2 at (0,100) on the Junction.
    const { proposal, result } = drop(
      document,
      resistor("R1", { x: 0, y: 80 }),
    );

    expect(proposal).toMatchObject({ matched: true, ambiguous: false });
    expect(proposal.expectedElectricalEffect).toMatchObject({
      kind: "partition",
      sourceBaseNetIds: ["net-gnd"],
    });
    const top = netOf(result!, pin("R1", "1"));
    const bottom = netOf(result!, pin("R1", "2"));

    expect(top).toBeTruthy();
    expect(bottom).toBeTruthy();
    expect(top).not.toBe(bottom);
    expect(netOf(result!, pin("RL", "2"))).toBe(top);
    expect(netOf(result!, { kind: "junction", junctionId: "left" })).toBe(
      bottom,
    );
    expect(routeBetween(result!, pin("RL", "2"), pin("R1", "1"))).toBeTruthy();
    // Left with two Wires, the T-Junction would fold into one straight Wire
    // passing under the pin. The pin takes its place: both Wires end on it.
    expect(result!.junctions.map((junction) => junction.id)).not.toContain(
      "tee",
    );
    const leftJunction = { kind: "junction" as const, junctionId: "left" };
    const rightJunction = { kind: "junction" as const, junctionId: "right" };
    expect(routeBetween(result!, leftJunction, pin("R1", "2"))).toBeTruthy();
    expect(routeBetween(result!, pin("R1", "2"), rightJunction)).toBeTruthy();
  });

  it("keeps a Junction where three Wires still meet, with the pin joined to it", () => {
    const document = wireEndingInATee();
    document.junctions.push({
      id: "below",
      netId: "net-gnd",
      position: { x: 0, y: 200 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "tail",
        netId: "net-gnd",
        start: { kind: "junction", junctionId: "tee" },
        end: { kind: "junction", junctionId: "below" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const { proposal, result } = drop(
      document,
      resistor("R1", { x: 0, y: 80 }),
    );

    expect(proposal).toMatchObject({ matched: true, ambiguous: false });
    const tee = { kind: "junction" as const, junctionId: "tee" };
    expect(netOf(result!, pin("R1", "2"))).toBe(netOf(result!, tee));
    expect(netOf(result!, pin("R1", "1"))).not.toBe(netOf(result!, tee));
    expect(routeBetween(result!, pin("R1", "1"), tee)).toBeUndefined();
  });

  it("puts it in series when the outer pin lands on the part pin that ends the Wire", () => {
    const document = wireEndingInATee();
    // Pin 1 at (0,0) on RL's pin 2, pin 2 at (0,40) inside the stem.
    const { proposal, result } = drop(
      document,
      resistor("R1", { x: 0, y: 20 }),
    );

    expect(proposal).toMatchObject({ matched: true, ambiguous: false });
    const top = netOf(result!, pin("R1", "1"));
    const bottom = netOf(result!, pin("R1", "2"));
    expect(top).not.toBe(bottom);
    expect(netOf(result!, pin("RL", "2"))).toBe(top);
    expect(netOf(result!, { kind: "junction", junctionId: "tee" })).toBe(
      bottom,
    );
    expect(routeBetween(result!, pin("RL", "2"), pin("R1", "2"))).toBe(
      undefined,
    );
  });

  it("refuses a drop that would put both pins on one Net", () => {
    // Two wires of one Net, joined at the bottom: a part laid across them
    // would have both pins on that Net.
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-gnd", terminals: [] });
    const corners = [
      ["ul", -20, 0],
      ["ur", 20, 0],
      ["bl", -20, 100],
      ["br", 20, 100],
    ] as const;
    for (const [id, x, y] of corners)
      document.junctions.push({
        id,
        netId: "net-gnd",
        position: { x, y },
        role: "route-anchor",
      });
    const wire = (id: string, from: string, to: string) =>
      createRoutePath({
        id,
        netId: "net-gnd",
        start: { kind: "junction", junctionId: from },
        end: { kind: "junction", junctionId: to },
        bends: [],
        modes: ["manual"],
      });
    document.routes.push(
      wire("left", "ul", "bl"),
      wire("right", "ur", "br"),
      wire("bottom", "bl", "br"),
    );

    const proposal = proposePlacementContact(
      document,
      resolver,
      resistor("R1", { x: 0, y: 50 }, 90),
      [],
    );

    expect(proposal).toEqual({
      edits: [],
      matched: false,
      ambiguous: false,
      rejected: "Both pins of R1 would join one Net, which shorts it",
    });
  });
});
