import { createEmptyDocument, createRoutePath, routeEnd } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import { planRoutingDeletion } from "./routing-deletion-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function segmentedPowerRailDocument() {
  const document = createEmptyDocument("rail-main", "Rail Main");
  document.nets.push({ id: "net-vdd", terminals: [] });
  document.junctions.push(
    { id: "rail-0", netId: "net-vdd", position: { x: 0, y: 0 } },
    { id: "rail-1", netId: "net-vdd", position: { x: 100, y: 0 } },
    { id: "rail-2", netId: "net-vdd", position: { x: 200, y: 0 } },
    { id: "rail-3", netId: "net-vdd", position: { x: 300, y: 0 } },
    { id: "tap-end", netId: "net-vdd", position: { x: 200, y: 100 } },
  );
  for (const [id, start, end, presentation] of [
    ["rail-a", "rail-0", "rail-1", "power-rail"],
    ["rail-b", "rail-1", "rail-2", "power-rail"],
    ["rail-c", "rail-2", "rail-3", "power-rail"],
    ["tap", "rail-2", "tap-end", undefined],
  ] as const) {
    document.routes.push(
      createRoutePath({
        id,
        netId: "net-vdd",
        start: { kind: "junction", junctionId: start },
        end: { kind: "junction", junctionId: end },
        bends: [],
        modes: ["manual"],
        ...(presentation ? { presentation } : {}),
      }),
    );
  }
  document.annotations.push({
    id: "label-vdd",
    kind: "power-label",
    binding: { kind: "net-name", netId: "net-vdd" },
    netId: "net-vdd",
    content: { runs: [{ kind: "text", value: "VDD" }] },
    anchor: {
      kind: "object",
      objectId: "rail-3",
      localOffset: { x: 10, y: 10 },
      fallbackPosition: { x: 310, y: 10 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-vdd",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    owner: { kind: "power-marker", objectId: "label-vdd" },
    scope: "local",
    powerDomain: "vdd",
  });
  return document;
}

/**
 * R1 over R2 on one vertical wire, tapped at J by a stub to R3 on the right,
 * through a bend Junction K when `bent`.
 */
function tappedWireDocument(bent = false) {
  const document = createEmptyDocument("tap-main", "Tap Main");
  const resistor = (id: string, x: number, y: number) => ({
    id,
    symbolId: "resistor",
    reference: id,
    placement: {
      position: { x, y },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: {},
    },
  });
  document.instances.push(
    resistor("R1", 0, 0),
    resistor("R2", 0, 200),
    resistor("R3", 100, 140),
  );
  document.nets.push({
    id: "net",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
      { instanceId: "R3", pinName: "1" },
    ],
  });
  document.junctions.push({
    id: "J",
    netId: "net",
    position: { x: 0, y: 100 },
  });
  if (bent)
    document.junctions.push({
      id: "K",
      netId: "net",
      position: { x: 100, y: 100 },
    });
  const pin = (instanceId: string, pinName: string) => ({
    kind: "terminal" as const,
    instanceId,
    pinName,
  });
  const junction = (junctionId: string) => ({
    kind: "junction" as const,
    junctionId,
  });
  const wire = (
    id: string,
    start: ReturnType<typeof pin> | ReturnType<typeof junction>,
    end: ReturnType<typeof pin> | ReturnType<typeof junction>,
    bends: { x: number; y: number }[] = [],
  ) =>
    createRoutePath({
      id,
      netId: "net",
      start,
      end,
      bends,
      modes: bends.map(() => "manual" as const).concat("manual"),
    });
  document.routes.push(
    wire("top", pin("R1", "2"), junction("J")),
    wire("bottom", junction("J"), pin("R2", "1")),
    ...(bent
      ? [
          wire("stub", junction("J"), junction("K")),
          wire("drop", junction("K"), pin("R3", "1")),
        ]
      : [wire("stub", junction("J"), pin("R3", "1"), [{ x: 100, y: 100 }])]),
  );
  return document;
}

function deleteR3(document: ReturnType<typeof tappedWireDocument>) {
  const result = gateRoutingOperationPlan(
    document,
    planRoutingDeletion(
      document,
      resolver,
      { instanceIds: ["R3"], routeIds: [], junctionIds: [] },
      1,
    ),
    { symbolResolver: resolver },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("deletion refused");
  return result.evaluated.finalDocument;
}

describe("routing deletion planner", () => {
  it.each([
    ["a stub", false],
    ["a stub through a bend", true],
  ] as const)(
    "takes %s that only reached the deleted part with it",
    (_label, bent) => {
      const after = deleteR3(tappedWireDocument(bent));
      // Before, the stub stayed, ending at a Junction nothing else reached.
      expect(
        after.routes.some((route) => ["stub", "drop"].includes(route.id)),
      ).toBe(false);
      const degree = (junctionId: string) =>
        after.routes.filter((route) =>
          [route.start, routeEnd(route)].some(
            (end) => end.kind === "junction" && end.junctionId === junctionId,
          ),
        ).length;
      expect(after.junctions.filter((item) => degree(item.id) === 1)).toEqual(
        [],
      );
      // The vertical wire is still whole and straight.
      const geometry = resolveDocumentRoutingGeometry(after, resolver);
      const points = [...geometry.routes.values()].flatMap(
        (route) => route.centerline,
      );
      expect(points.length).toBeGreaterThan(0);
      expect(points.every((point) => point.x === 0)).toBe(true);
      expect(after.nets.flatMap((net) => net.terminals)).toEqual(
        expect.arrayContaining([
          { instanceId: "R1", pinName: "2" },
          { instanceId: "R2", pinName: "1" },
        ]),
      );
    },
  );

  it("keeps a wire that runs on to another part's pin, open where the part was", () => {
    const document = tappedWireDocument();
    // Take the tap away: R1 and R2 are joined straight, pin to pin.
    document.routes = document.routes.filter((route) => route.id === "top");
    document.routes[0] = createRoutePath({
      id: "top",
      netId: "net",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: "R2", pinName: "1" },
      bends: [],
      modes: ["manual"],
    });
    document.junctions = [];
    document.instances = document.instances.filter((item) => item.id !== "R3");
    document.nets[0]!.terminals = document.nets[0]!.terminals.filter(
      (terminal) => terminal.instanceId !== "R3",
    );
    const result = gateRoutingOperationPlan(
      document,
      planRoutingDeletion(
        document,
        resolver,
        { instanceIds: ["R2"], routeIds: [], junctionIds: [] },
        1,
      ),
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A replacement set down where R2 was lands on the open end.
    expect(
      result.evaluated.finalDocument.routes.map((route) => route.id),
    ).toEqual(["top"]);
  });

  it("keeps a labelled stub: the label gives it a meaning of its own", () => {
    const document = tappedWireDocument();
    document.annotations.push({
      id: "label-out",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      netId: "net",
      anchor: {
        kind: "route",
        routeId: "stub",
        legId: document.routes.find((route) => route.id === "stub")!.legs[0]!
          .id,
        t: 0.5,
        normalOffset: -10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 50, y: 90 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const after = deleteR3(document);
    expect(after.routes.some((route) => route.id === "stub")).toBe(true);
  });

  it("removes an isolated Wire and both orphan anchors in one operation", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "A", netId: "net", position: { x: 0, y: 0 } },
      { id: "B", netId: "net", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "net",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["wire"], junctionIds: [] },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluated.finalDocument).toMatchObject({
      routes: [],
      junctions: [],
      nets: [],
    });
  });

  it("lets a selected Route dominate an incidental branch Junction", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "L", netId: "net", position: { x: 0, y: 0 } },
      { id: "C", netId: "net", position: { x: 100, y: 0 } },
      { id: "R", netId: "net", position: { x: 200, y: 0 } },
      { id: "D", netId: "net", position: { x: 100, y: 100 } },
    );
    for (const [id, start, end] of [
      ["left", "L", "C"],
      ["right", "C", "R"],
      ["branch", "C", "D"],
    ] as const) {
      document.routes.push(
        createRoutePath({
          id,
          netId: "net",
          start: { kind: "junction", junctionId: start },
          end: { kind: "junction", junctionId: end },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const plan = planRoutingDeletion(
      document,
      resolver,
      {
        instanceIds: [],
        routeIds: ["branch"],
        junctionIds: ["C", "D"],
      },
      1,
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.evaluated.finalDocument.routes.map((route) => route.id),
      ).toEqual(["left"]);
      expect(
        result.evaluated.finalDocument.junctions.map((item) => item.id),
      ).toEqual(["L", "R"]);
    }
  });

  it("deletes a segmented Power Rail as one component while preserving its tap", () => {
    const document = segmentedPowerRailDocument();
    const plan = planRoutingDeletion(
      document,
      resolver,
      { instanceIds: [], routeIds: ["rail-b"], junctionIds: [] },
      1,
    );
    expect(
      plan.edits.flatMap((edit) =>
        edit.kind === "cut_connection" ? [edit.routeId] : [],
      ),
    ).toEqual(["rail-a", "rail-b", "rail-c"]);
    expect(plan.edits).toContainEqual({
      kind: "remove_schematic_annotation",
      annotationId: "label-vdd",
    });

    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.evaluated.finalDocument.routes.map((route) => route.id),
    ).toEqual(["tap"]);
    expect(
      result.evaluated.finalDocument.junctions.map((junction) => junction.id),
    ).toEqual(["rail-2", "tap-end"]);
    expect(result.evaluated.finalDocument.annotations).toEqual([]);
    expect(result.evaluated.finalDocument.connectivityEvidence).toEqual([]);
  });

  it("treats deleting the Power Rail label as deleting the same component", () => {
    const document = segmentedPowerRailDocument();
    const plan = planRoutingDeletion(
      document,
      resolver,
      {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: ["label-vdd"],
      },
      1,
    );
    expect(
      plan.edits.flatMap((edit) =>
        edit.kind === "cut_connection" ? [edit.routeId] : [],
      ),
    ).toEqual(["rail-a", "rail-b", "rail-c"]);
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      result.evaluated.finalDocument.routes.map((route) => route.id),
    ).toEqual(["tap"]);
  });
});
