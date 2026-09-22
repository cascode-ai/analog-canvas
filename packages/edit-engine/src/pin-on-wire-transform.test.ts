import {
  createEmptyDocument,
  createRoutePath,
  routeEndpoints,
} from "@icm/model";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  deriveNetConnectivity,
  resolveRouteGeometry,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./history.js";
import { planRoutingTransform } from "./routing-transform-planner.js";
import { executeTransaction } from "./transaction.js";
import { transformMaySeparateDirectContact } from "./transaction-direct-contact.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function fixture() {
  const d = createEmptyDocument("pin-on-wire", "Pin on wire");
  d.instances.push({
    id: "VDD",
    symbolId: "vdd-port",
    placement: { position: { x: 100, y: 80 }, rotation: 0, mirror: "none" },
  });
  d.nets.push({
    id: "supply",
    terminals: [{ instanceId: "VDD", pinName: "P" }],
  });
  d.junctions.push(
    { id: "left", netId: "supply", position: { x: 0, y: 100 } },
    { id: "right", netId: "supply", position: { x: 200, y: 100 } },
  );
  d.routes.push(
    createRoutePath({
      id: "wire",
      netId: "supply",
      start: { kind: "junction", junctionId: "left" },
      end: { kind: "junction", junctionId: "right" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return d;
}
function request(d: ReturnType<typeof fixture>, edits: readonly unknown[]) {
  return {
    transactionId: `drag-${d.revision}`,
    documentId: d.id,
    expectedRevision: d.revision,
    actor: { kind: "human", id: "test" },
    edits: [...edits],
  };
}
const move = {
  kind: "move_instance",
  instanceId: "VDD",
  position: { x: 100, y: 20 },
};
function points(d: ReturnType<typeof fixture>) {
  return d.routes.map((r) => resolveRouteGeometry(d, resolver, r)!.centerline);
}

function endpointFixture() {
  const d = createEmptyDocument("pin-at-wire-end", "Pin at wire end");
  d.instances.push({
    id: "PIN",
    symbolId: "port",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  d.nets.push({
    id: "signal",
    terminals: [{ instanceId: "PIN", pinName: "P" }],
  });
  d.netlist!.terminals.push({
    id: "cell-terminal-pin",
    name: "VIN",
    netId: "signal",
    direction: "input",
    interfaceInstanceIds: ["PIN"],
  });
  d.junctions.push(
    {
      id: "near",
      netId: "signal",
      position: { x: 100, y: 100 },
      role: "route-anchor",
    },
    {
      id: "far",
      netId: "signal",
      position: { x: 200, y: 100 },
      role: "route-anchor",
    },
  );
  d.routes.push(
    createRoutePath({
      id: "wire",
      netId: "signal",
      start: { kind: "junction", junctionId: "near" },
      end: { kind: "junction", junctionId: "far" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return d;
}

describe("moving a pin resting on a wire interior", () => {
  it("recognizes the visible T contact even without a split route or a second endpoint", () => {
    const d = fixture();
    expect(
      deriveDocumentContactEvidence(d, resolver).contacts.some(
        contactRequiresJunctionDot,
      ),
    ).toBe(true);
    expect(
      transformMaySeparateDirectContact(
        d,
        resolver,
        new Set(["VDD"]),
        new Set(),
      ),
    ).toBe(true);
  });

  it("keeps the horizontal wire and adds a vertical branch when VDD moves up", () => {
    const d = fixture();
    const result = executeTransaction(d, request(d, [move]), context);
    if (!result.ok) throw new Error(result.error.message);
    expect(points(result.document)).toContainEqual([
      { x: 100, y: 40 },
      { x: 100, y: 100 },
    ]);
    expect(result.document.junctions).toEqual(
      expect.arrayContaining(d.junctions),
    );
    expect(
      deriveNetConnectivity(result.document, resolver, result.document.nets[0]!)
        .components,
    ).toHaveLength(1);
    expect(
      deriveDocumentContactEvidence(result.document, resolver)
        .contacts.filter(contactRequiresJunctionDot)
        .map((c) => c.point),
    ).toEqual([{ x: 100, y: 100 }]);
  });

  it("does not tether an unrelated pin that only crosses a differently owned conductor", () => {
    const d = fixture();
    d.nets[0]!.terminals = [];
    d.nets.push({
      id: "other",
      terminals: [{ instanceId: "VDD", pinName: "P" }],
    });
    const result = executeTransaction(d, request(d, [move]), context);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toEqual(d.routes);
    expect(result.document.nets).toHaveLength(2);
  });

  it("does not invent a branch when the pin slides along the same wire", () => {
    const d = fixture();
    const result = executeTransaction(
      d,
      request(d, [{ ...move, position: { x: 140, y: 80 } }]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes).toEqual(d.routes);
  });

  it("extends each tap when several pins on the same unsplit conductor move together", () => {
    const d = fixture();
    d.instances.push({
      ...structuredClone(d.instances[0]!),
      id: "VDD2",
      placement: { position: { x: 150, y: 80 }, rotation: 0, mirror: "none" },
    });
    d.nets[0]!.terminals.push({ instanceId: "VDD2", pinName: "P" });
    const result = executeTransaction(
      d,
      request(d, [
        move,
        { ...move, instanceId: "VDD2", position: { x: 150, y: 20 } },
      ]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(points(result.document)).toEqual(
      expect.arrayContaining([
        [
          { x: 100, y: 40 },
          { x: 100, y: 100 },
        ],
        [
          { x: 150, y: 40 },
          { x: 150, y: 100 },
        ],
      ]),
    );
    expect(
      deriveNetConnectivity(result.document, resolver, result.document.nets[0]!)
        .components,
    ).toHaveLength(1);
  });

  it("does not join a crossing foreign wire when anchoring the supply branch", () => {
    const d = fixture();
    d.nets.push({ id: "foreign", terminals: [] });
    d.junctions.push(
      { id: "top", netId: "foreign", position: { x: 100, y: 60 } },
      { id: "bottom", netId: "foreign", position: { x: 100, y: 160 } },
    );
    const crossing = createRoutePath({
      id: "crossing",
      netId: "foreign",
      start: { kind: "junction", junctionId: "top" },
      end: { kind: "junction", junctionId: "bottom" },
      bends: [],
      modes: ["manual"],
    });
    d.routes.push(crossing);
    const result = executeTransaction(
      d,
      request(d, [{ ...move, position: { x: 140, y: 20 } }]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.document.routes.find((r) => r.id === "crossing")).toEqual(
      crossing,
    );
    expect(result.document.nets).toHaveLength(2);
    expect(
      result.document.nets.find((n) => n.id === "foreign")!.terminals,
    ).toEqual([]);
  });

  it("keeps an explicit disconnect and undoes/redoes the whole connected drag atomically", () => {
    const d = fixture();
    const disconnected = executeTransaction(
      d,
      request(d, [
        {
          kind: "disconnect_endpoint",
          endpoint: { kind: "terminal", instanceId: "VDD", pinName: "P" },
        },
        move,
      ]),
      context,
    );
    if (!disconnected.ok) throw new Error(disconnected.error.message);
    expect(disconnected.document.routes).toEqual(d.routes);
    const history = new DocumentHistory(d, context);
    const result = history.transact(request(d, [move]));
    if (!result.ok) throw new Error(result.error.message);
    const moved = structuredClone(history.document);
    expect(points(moved)).toContainEqual([
      { x: 100, y: 40 },
      { x: 100, y: 100 },
    ]);
    expect(
      history.transact(request(history.document, [{ kind: "undo" }])).ok,
    ).toBe(true);
    expect(history.document.routes).toEqual(d.routes);
    expect(history.document.instances).toEqual(d.instances);
    expect(
      history.transact(request(history.document, [{ kind: "redo" }])).ok,
    ).toBe(true);
    expect(history.document.routes).toEqual(moved.routes);
  });
});

describe("moving a pin resting on a dangling wire endpoint", () => {
  const retract = {
    kind: "move_instance",
    instanceId: "PIN",
    position: { x: 140, y: 100 },
  };

  it("retracts the route endpoint with the pin and undoes atomically", () => {
    const d = endpointFixture();
    const history = new DocumentHistory(d, context);
    const plan = planRoutingTransform(
      d,
      resolver,
      { instanceIds: ["PIN"], routeIds: [], junctionIds: [] },
      { kind: "translate", delta: { x: 40, y: 0 } },
    );
    const result = history.transact(request(d, plan.edits));
    if (!result.ok) throw new Error(result.error.message);

    expect(
      history.document.junctions.find((junction) => junction.id === "near")
        ?.position,
    ).toEqual({ x: 140, y: 100 });
    expect(points(history.document)).toEqual([
      [
        { x: 140, y: 100 },
        { x: 200, y: 100 },
      ],
    ]);

    expect(
      history.transact(request(history.document, [{ kind: "undo" }])).ok,
    ).toBe(true);
    expect(history.document.instances).toEqual(d.instances);
    expect(history.document.junctions).toEqual(d.junctions);
    expect(history.document.routes).toEqual(d.routes);
    expect(
      history.transact(request(history.document, [{ kind: "redo" }])).ok,
    ).toBe(true);
    expect(points(history.document)).toEqual([
      [
        { x: 140, y: 100 },
        { x: 200, y: 100 },
      ],
    ]);
  });

  it("retracts the endpoint when the pin rests on the stored route end", () => {
    const d = endpointFixture();
    d.routes = [
      createRoutePath({
        id: "wire",
        netId: "signal",
        start: { kind: "junction", junctionId: "far" },
        end: { kind: "junction", junctionId: "near" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    const result = executeTransaction(d, request(d, [retract]), context);
    if (!result.ok) throw new Error(result.error.message);
    expect(
      result.document.junctions.find((junction) => junction.id === "near")
        ?.position,
    ).toEqual({ x: 140, y: 100 });
    expect(points(result.document)).toEqual([
      [
        { x: 200, y: 100 },
        { x: 140, y: 100 },
      ],
    ]);
  });

  it("keeps a shared T junction fixed", () => {
    const d = endpointFixture();
    d.junctions.push(
      {
        id: "top",
        netId: "signal",
        position: { x: 100, y: 20 },
        role: "route-anchor",
      },
      {
        id: "left",
        netId: "signal",
        position: { x: 20, y: 100 },
        role: "route-anchor",
      },
    );
    d.routes.push(
      createRoutePath({
        id: "branch",
        netId: "signal",
        start: { kind: "junction", junctionId: "near" },
        end: { kind: "junction", junctionId: "top" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "left-arm",
        netId: "signal",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "near" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(d, request(d, [retract]), context);
    if (!result.ok) throw new Error(result.error.message);
    expect(
      result.document.junctions.find((junction) => junction.id === "near")
        ?.position,
    ).toEqual({ x: 100, y: 100 });
    expect(
      result.document.routes.filter((route) =>
        routeEndpoints(route).some(
          (endpoint) =>
            endpoint.kind === "junction" && endpoint.junctionId === "near",
        ),
      ),
    ).toHaveLength(3);
  });

  it("leaves the endpoint in place and materializes a branch when the pin moves away", () => {
    const d = endpointFixture();
    const result = executeTransaction(
      d,
      request(d, [{ ...retract, position: { x: 100, y: 60 } }]),
      context,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(points(result.document)).toEqual([
      [
        { x: 100, y: 60 },
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    ]);
  });
});
