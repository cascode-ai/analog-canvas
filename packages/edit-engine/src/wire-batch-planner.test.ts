import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  deriveNetConnectivityContext,
  endpointKey,
  resolveRouteGeometry,
} from "@icm/derived";
import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./history.js";
import { planWireBatch } from "./wire-batch-planner.js";
import { createRouteClearance } from "./route-clearance.js";
import type { WireIntent } from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const free = (x: number, y: number) => ({
  kind: "free" as const,
  point: { x, y },
});
const at = (x: number, y: number) => ({
  kind: "wire-at" as const,
  point: { x, y },
});
const wire = (
  id: string,
  from: WireIntent["from"],
  to: WireIntent["to"],
  waypoints: { x: number; y: number }[] = [],
): WireIntent => ({ id, from, to, waypoints });
function commit(history: DocumentHistory, intents: WireIntent[]) {
  const before = structuredClone(history.document);
  const plan = planWireBatch(history.document, resolver, intents, 512);
  expect(typeof plan, JSON.stringify(plan)).not.toBe("string");
  if (typeof plan === "string") throw new Error(plan);
  expect(history.document).toEqual(before);
  const result = history.transact({
    transactionId: `test-${before.revision}`,
    documentId: before.id,
    expectedRevision: before.revision,
    actor: { kind: "agent", id: "test" },
    edits: plan.edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return before;
}
function history(
  document: SchematicDocument = createEmptyDocument("doc", "Batch wires"),
) {
  return new DocumentHistory(document, { symbolResolver: resolver });
}
describe("wire batch replay", () => {
  it("merges existing conductors and taps the merged geometry atomically", () => {
    const h = history();
    commit(h, [
      wire("a", free(0, 0), free(100, 0)),
      wire("b", free(200, 0), free(300, 0)),
    ]);
    const before = commit(h, [
      wire("join", at(100, 0), at(200, 0)),
      wire("tap", at(250, 0), free(250, 100)),
    ]);
    expect(h.document.nets).toHaveLength(1);
    expect(h.document.revision).toBe(before.revision + 1);
    h.transact({
      transactionId: "undo",
      documentId: h.document.id,
      expectedRevision: h.document.revision,
      actor: { kind: "agent", id: "test" },
      edits: [{ kind: "undo" }],
    });
    expect(h.document.routes).toEqual(before.routes);
    expect(h.document.nets).toEqual(before.nets);
  });
  it("merges an existing output conductor and then splits its earlier Route", () => {
    const h = history();
    commit(h, [
      wire("output", free(850, 180), free(850, 460)),
      wire("load", free(960, 360), free(1000, 360)),
    ]);
    commit(h, [
      wire("join", at(960, 360), at(850, 360)),
      wire("tap", free(780, 300), at(850, 300)),
    ]);
    expect(h.document.nets).toHaveLength(1);
  });
  it("still refuses taps at foreign crossings, including after prior batch work", () => {
    const h = history();
    commit(h, [
      wire("horizontal", free(0, 0), free(100, 0)),
      wire("vertical", free(50, -50), free(50, 50)),
    ]);
    const before = structuredClone(h.document);
    const plan = planWireBatch(
      h.document,
      resolver,
      [
        wire("elsewhere", free(200, 0), free(300, 0)),
        wire("bad-tap", free(50, 100), at(50, 0)),
      ],
      512,
    );
    expect(plan).toMatch(/Ambiguous wire crossing/);
    expect(h.document).toEqual(before);
  });
  it("resolves successive bias taps without referencing normalized-away endpoints", () => {
    const h = history();
    commit(h, [
      wire("b1", free(140, 480), free(170, 460), [
        { x: 120, y: 480 },
        { x: 120, y: 420 },
        { x: 170, y: 420 },
      ]),
      wire("b2", free(80, 400), at(170, 460), [{ x: 170, y: 400 }]),
      wire("b3", free(410, 480), at(170, 420), [
        { x: 370, y: 480 },
        { x: 370, y: 420 },
      ]),
      wire("b4", free(820, 480), at(370, 420), [
        { x: 780, y: 480 },
        { x: 780, y: 420 },
      ]),
    ]);
    expect(h.document.nets).toHaveLength(1);
  });
  it("taps overlapping bias routes joined through an endpoint in the same batch", () => {
    const d = createEmptyDocument("bias", "Existing bias endpoints");
    for (const [id, x, y] of [
      ["gate", 140, 480],
      ["drain", 170, 460],
      ["input", 80, 400],
    ] as const) {
      d.nets.push({ id: `${id}-net`, terminals: [] });
      d.junctions.push({
        id,
        netId: `${id}-net`,
        position: { x, y },
        role: "route-anchor",
      });
    }
    const endpoint = (junctionId: string) => ({
      kind: "endpoint" as const,
      endpoint: { kind: "junction" as const, junctionId },
    });
    const h = history(d);
    commit(h, [
      wire("b1", endpoint("gate"), endpoint("drain"), [
        { x: 120, y: 480 },
        { x: 120, y: 420 },
        { x: 170, y: 420 },
      ]),
      wire("b2", endpoint("input"), endpoint("drain"), [{ x: 170, y: 400 }]),
      wire("b3", free(410, 480), at(170, 420), [
        { x: 370, y: 480 },
        { x: 370, y: 420 },
      ]),
      wire("b4", free(820, 480), at(370, 420), [
        { x: 780, y: 480 },
        { x: 780, y: 420 },
      ]),
    ]);
    expect(h.document.nets).toHaveLength(1);
  });
  it("leaves the original untouched when a later tap is invalid or over budget", () => {
    const d = createEmptyDocument("doc", "Reject atomically");
    const before = structuredClone(d);
    const intents = [
      wire("a", free(0, 0), free(100, 0)),
      wire("bad", at(300, 0), free(300, 100)),
    ];
    expect(planWireBatch(d, resolver, intents, 512)).toMatch(/Wire 2:/);
    expect(planWireBatch(d, resolver, intents, 1)).toMatch(/exceeding/);
    expect(d).toEqual(before);
  });
});

describe("via points on a pin-to-pin connect (#1265)", () => {
  const X = 2400;
  function twoResistors() {
    const document = createEmptyDocument("doc", "Detours");
    for (const [id, x] of [
      ["instance-ra", X],
      ["instance-rb", X + 100],
    ] as const)
      document.instances.push({
        id,
        symbolId: "resistor",
        reference: id === "instance-ra" ? "R1" : "R2",
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
        netlist: { parameters: { value: "1k" } },
      });
    return history(document);
  }
  const pin = (instanceId: string, pinName: string) => ({
    kind: "endpoint" as const,
    endpoint: { kind: "terminal" as const, instanceId, pinName },
  });
  const centerline = (h: DocumentHistory) =>
    h.document.routes.map((route) =>
      resolveRouteGeometry(h.document, resolver, route)!.centerline.map(
        ({ x, y }) => `${x},${y}`,
      ),
    );
  const below = [
    { x: X, y: 60 },
    { x: X + 100, y: 60 },
  ];

  it("follows the detour from either end, in one call or a batch", () => {
    for (const batch of [false, true]) {
      const forward = twoResistors();
      const intent = wire(
        "w",
        pin("instance-ra", "2"),
        pin("instance-rb", "2"),
        below,
      );
      commit(forward, [intent]);
      expect(centerline(forward)).toEqual([
        ["2400,20", "2400,60", "2500,60", "2500,20"],
      ]);
      // The same points, listed against the direction: the same detour, not
      // a straight line between the pins.
      const backward = twoResistors();
      const plan = planWireBatch(
        backward.document,
        resolver,
        batch
          ? [wire("w", pin("instance-rb", "2"), pin("instance-ra", "2"), below)]
          : wire("w", pin("instance-rb", "2"), pin("instance-ra", "2"), below),
        512,
      );
      if (typeof plan === "string") throw new Error(plan);
      expect(
        backward.transact({
          transactionId: "t",
          documentId: backward.document.id,
          expectedRevision: backward.document.revision,
          actor: { kind: "agent", id: "test" },
          edits: plan.edits,
        }).ok,
      ).toBe(true);
      expect(centerline(backward)).toEqual([
        ["2500,20", "2500,60", "2400,60", "2400,20"],
      ]);
    }
  });

  it("refuses via points no order can follow, instead of committing another path", () => {
    const h = twoResistors();
    const before = structuredClone(h.document);
    const plan = planWireBatch(
      h.document,
      resolver,
      wire("w", pin("instance-ra", "2"), pin("instance-rb", "2"), [
        { x: X + 50, y: 60 },
        { x: X, y: 60 },
        { x: X + 100, y: 60 },
      ]),
      512,
    );
    expect(plan).toMatch(/folds back on itself/);
    expect(h.document).toEqual(before);
  });
});

describe("an Agent connect keeps clear of parts and other Nets (#1257)", () => {
  const resistor = (
    id: string,
    x: number,
    y: number,
    rotation: 0 | 90 = 0,
  ) => ({
    id,
    symbolId: "resistor",
    reference: id,
    placement: { position: { x, y }, rotation, mirror: "none" as const },
    netlist: { parameters: { value: "1k" } },
  });
  const pin = (instanceId: string, pinName: string) => ({
    kind: "endpoint" as const,
    endpoint: { kind: "terminal" as const, instanceId, pinName },
  });
  const ends = [pin("R1", "2").endpoint, pin("R2", "1").endpoint];
  function parts(obstacle?: { x: number; y: number; rotation: 0 | 90 }) {
    const document = createEmptyDocument("doc", "Clearance");
    document.instances.push(resistor("R1", 0, 0), resistor("R2", 200, 100));
    if (obstacle)
      document.instances.push(
        resistor("R3", obstacle.x, obstacle.y, obstacle.rotation),
      );
    return history(document);
  }
  const committedPath = (
    h: DocumentHistory,
    options: { keepClear?: boolean },
    waypoints?: { x: number; y: number }[],
  ) => {
    const plan = planWireBatch(
      h.document,
      resolver,
      wire("w", pin("R1", "2"), pin("R2", "1"), waypoints),
      512,
      options,
    );
    if (typeof plan === "string") return plan;
    const result = h.transact({
      transactionId: "t",
      documentId: h.document.id,
      expectedRevision: h.document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return resolveRouteGeometry(h.document, resolver, h.document.routes[0]!)!
      .centerline;
  };
  /** What the committed wire would read as touching, its own Net aside. */
  const conflict = (
    h: DocumentHistory,
    points: readonly { x: number; y: number }[],
  ) => {
    const context = deriveNetConnectivityContext(h.document, resolver);
    const own = h.document.routes.map(
      (route) =>
        context.logicalNetResolution.byBaseNetId.get(route.netId)?.id ??
        route.netId,
    );
    return createRouteClearance(h.document, resolver, context, {
      logicalIds: new Set(own),
      endpointKeys: new Set(ends.map(endpointKey)),
    }).conflict(points, ends);
  };

  it("detours around a part its own path would cross, and refuses via points through it", () => {
    // Where the planner's own path runs, a part is then put in its way.
    const free = committedPath(parts(), {});
    if (typeof free === "string") throw new Error(free);
    const legs = free.slice(1).map((to, index) => [free[index]!, to] as const);
    const [a, b] = legs.sort(
      ([p, q], [r, s]) =>
        Math.abs(s.x - r.x) +
        Math.abs(s.y - r.y) -
        (Math.abs(q.x - p.x) + Math.abs(q.y - p.y)),
    )[0]!;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Across the leg, so the wire would pass through its body.
    const obstacle = {
      ...middle,
      rotation: a.y === b.y ? (0 as const) : (90 as const),
    };

    const crossing = parts(obstacle);
    const before = committedPath(crossing, {});
    if (typeof before === "string") throw new Error(before);
    expect(conflict(crossing, before)).toMatch(/passes through R3/);

    const h = parts(obstacle);
    const cleared = committedPath(h, { keepClear: true });
    if (typeof cleared === "string") throw new Error(cleared);
    expect(conflict(h, cleared)).toBeNull();
    expect(cleared).not.toEqual(before);

    // A path the caller chose through the part is refused, not committed.
    const chosen = parts(obstacle);
    const refused = committedPath(
      chosen,
      { keepClear: true },
      before.slice(1, -1),
    );
    expect(refused).toMatch(/passes through R3/);
    expect(chosen.document.routes).toEqual([]);
  });

  it("keeps a wire to a Net, a tap on a wire or an open end clear too", () => {
    // R1.1 points right at (20,0). R3 lies across y=0 at x 80..120, and the
    // trunk from R2.2 runs down x=200 through (200,0). Every target below is
    // straight ahead through R3; the wire to a Net was drawn so, through four
    // transistors of an OTA.
    const drawn = (target: WireIntent["to"], single: boolean) => {
      const document = createEmptyDocument("doc", "Clearance to a tap");
      document.instances.push(
        resistor("R1", 0, 0, 90),
        resistor("R3", 100, 0, 90),
        resistor("R2", 200, -80),
      );
      const h = history(document);
      commit(h, [wire("trunk", pin("R2", "2"), free(200, 60))]);
      const trunkNet = h.document.nets[0]!.id;
      const intent = wire(
        "w",
        pin("R1", "1"),
        target.kind === "net" ? { kind: "net", net: trunkNet } : target,
      );
      const plan = planWireBatch(
        h.document,
        resolver,
        single ? intent : [intent],
        512,
        { keepClear: true },
      );
      if (typeof plan === "string") throw new Error(plan);
      const result = h.transact({
        transactionId: "t",
        documentId: h.document.id,
        expectedRevision: h.document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const route = h.document.routes.find(
        (item) =>
          item.start.kind === "terminal" && item.start.instanceId === "R1",
      )!;
      const points = resolveRouteGeometry(
        h.document,
        resolver,
        route,
      )!.centerline;
      const context = deriveNetConnectivityContext(h.document, resolver);
      const problem = createRouteClearance(h.document, resolver, context, {
        logicalIds: new Set(
          h.document.routes.map(
            (item) =>
              context.logicalNetResolution.byBaseNetId.get(item.netId)?.id ??
              item.netId,
          ),
        ),
        endpointKeys: new Set([endpointKey(route.start)]),
      }).conflict(points, [route.start, undefined]);
      return { points, problem };
    };
    for (const [target, single] of [
      [{ kind: "net", net: "" }, true],
      [at(200, 0), false],
      [free(160, 0), false],
    ] as const) {
      const { points, problem } = drawn(target, single);
      expect(problem, `${target.kind}: ${JSON.stringify(points)}`).toBeNull();
      expect(points.length).toBeGreaterThan(2);
    }
  });
});

describe("a batch connect from a pin an earlier connect reached (#1304)", () => {
  const part = (id: string, x: number, y: number, rotation: 0 | 90 = 0) => ({
    id,
    symbolId: "resistor",
    reference: id,
    placement: { position: { x, y }, rotation, mirror: "none" as const },
    netlist: { parameters: { value: "1k" } },
  });
  const pin = (instanceId: string, pinName: string) => ({
    kind: "endpoint" as const,
    endpoint: { kind: "terminal" as const, instanceId, pinName },
  });

  it("taps a wire onto a pin, then wires on from that pin, in one batch", () => {
    // R1.2 (0,20) to R2.1 (0,80) is a vertical trunk; R3.1 is at (100,50)
    // and R4.2 at (180,50).
    const document = createEmptyDocument("doc", "Tap then chain");
    document.instances.push(
      part("R1", 0, 0),
      part("R2", 0, 100),
      part("R3", 100, 70),
      part("R4", 200, 50, 90),
    );
    const h = history(document);
    const send = (intents: WireIntent[]) => {
      const plan = planWireBatch(h.document, resolver, intents, 512, {
        keepClear: true,
      });
      if (typeof plan === "string") throw new Error(plan);
      const result = h.transact({
        transactionId: `t-${h.document.revision}`,
        documentId: h.document.id,
        expectedRevision: h.document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    };
    send([wire("trunk", pin("R1", "2"), pin("R2", "1"))]);
    send([
      wire("tap", at(0, 50), pin("R3", "1")),
      wire("chain", pin("R3", "1"), pin("R4", "2")),
    ]);
    const nets = h.document.nets.filter((net) => net.terminals.length);
    expect(nets).toHaveLength(1);
    expect(
      nets[0]!.terminals.map((t) => `${t.instanceId}.${t.pinName}`).sort(),
    ).toEqual(["R1.2", "R2.1", "R3.1", "R4.2"]);
  });
});

describe("an Agent wire from a MOS body on its Cell's default", () => {
  const body = (keepClear: boolean) => {
    const document = createEmptyDocument("body", "Body wire");
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        mosBulkBinding: { origin: "cell-default", netId: "net-vss" },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-vss",
      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "GND1", pinName: "0" },
      ],
    });
    document.connectivityEvidence.push({
      id: "claim-ground",
      kind: "name-claim",
      netId: "net-vss",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "GND1" },
    });
    document.mosBulkDefaults = { nmosNetId: "net-vss" };
    const h = history(document);
    const terminal = (pinName: string) => ({
      kind: "endpoint" as const,
      endpoint: { kind: "terminal" as const, instanceId: "M1", pinName },
    });
    // The body tied to the source, as a source follower is drawn.
    const plan = planWireBatch(
      h.document,
      resolver,
      [wire("body", terminal("B"), terminal("S"))],
      512,
      { keepClear },
    );
    if (typeof plan === "string") throw new Error(plan);
    const result = h.transact({
      transactionId: "body",
      documentId: h.document.id,
      expectedRevision: h.document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return h.document;
  };

  it.each([true, false])(
    "takes the body off the default rather than joining the default's Net (keepClear %s)",
    (keepClear) => {
      const document = body(keepClear);
      const netOf = (instanceId: string, pinName: string) =>
        document.nets.find((net) =>
          net.terminals.some(
            (t) => t.instanceId === instanceId && t.pinName === pinName,
          ),
        )?.id;
      // Joined through the default, the source was on ground.
      expect(netOf("M1", "B")).toBe(netOf("M1", "S"));
      expect(netOf("M1", "S")).not.toBe(netOf("GND1", "0"));
      expect(
        document.instances.find((i) => i.id === "M1")?.mosBulkBinding,
      ).toBeUndefined();
      // Drawn as the GUI's Draw bulk connection draws it.
      expect(document.routes.map((route) => route.presentation)).toEqual([
        "bulk-dashed",
      ]);
    },
  );
});

describe("an Agent connect to an open point on another part's pin", () => {
  it("names the pin to connect to instead", () => {
    const document = createEmptyDocument("doc", "Point on a pin");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        netlist: { parameters: { value: "1k" } },
      },
      {
        id: "G1",
        symbolId: "ground",
        placement: { position: { x: 0, y: 100 }, rotation: 0, mirror: "none" },
      },
    );
    document.nets.push({
      id: "net-gnd",
      terminals: [{ instanceId: "G1", pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: "claim-ground",
      kind: "name-claim",
      netId: "net-gnd",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "power-marker", objectId: "G1" },
    });
    // (0, 90) is the ground's pin: the wire would end on it unjoined.
    const plan = planWireBatch(
      document,
      resolver,
      [
        wire(
          "w",
          {
            kind: "endpoint",
            endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
          },
          free(0, 90),
        ),
      ],
      512,
      { keepClear: true },
    );
    expect(plan).toBe(
      'Wire 1: (0, 90) is pin 0 of the ground G1, on Net 0: to join it, connect to the pin itself, {kind:"pin",instance:{kind:"instance",id:"G1"},pin:"0"}',
    );
  });
});

describe("a batch of Agent connects keeps clear of the wires before it", () => {
  it("routes each wire clear of the earlier wires of the same batch", () => {
    // Two blocks wired pin to pin in one call: the batch's planning draft
    // changed in place under a cached view, so each wire was kept clear of
    // committed wiring only, and two Nets ran along one line with no dot.
    const document = createEmptyDocument("parallel", "Parallel blocks");
    for (const [id, x] of [
      ["A", 0],
      ["B", 260],
    ] as const)
      document.instances.push({
        id,
        symbolId: "comparator",
        reference: id,
        netlist: { parameters: {} },
        placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
      });
    const h = history(document);
    const terminal = (instanceId: string, pinName: string) => ({
      kind: "endpoint" as const,
      endpoint: { kind: "terminal" as const, instanceId, pinName },
    });
    const plan = planWireBatch(
      h.document,
      resolver,
      ["IN-", "IN+", "OUT"].map((pin) =>
        wire(pin, terminal("A", pin), terminal("B", pin)),
      ),
      512,
      { keepClear: true },
    );
    if (typeof plan === "string") throw new Error(plan);
    const result = h.transact({
      transactionId: "parallel",
      documentId: h.document.id,
      expectedRevision: h.document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const lines = h.document.routes.map((route) => ({
      netId: route.netId,
      points: resolveRouteGeometry(h.document, resolver, route)!.centerline,
    }));
    expect(lines).toHaveLength(3);
    const onLine = (
      point: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) =>
      (a.x === b.x &&
        point.x === a.x &&
        point.y >= Math.min(a.y, b.y) &&
        point.y <= Math.max(a.y, b.y)) ||
      (a.y === b.y &&
        point.y === a.y &&
        point.x >= Math.min(a.x, b.x) &&
        point.x <= Math.max(a.x, b.x));
    for (const line of lines)
      for (const other of lines)
        if (line.netId !== other.netId)
          expect(
            line.points.some((point) =>
              other.points
                .slice(1)
                .some((to, index) => onLine(point, other.points[index]!, to)),
            ),
            `${line.netId} meets ${other.netId}`,
          ).toBe(false);
  });
});
