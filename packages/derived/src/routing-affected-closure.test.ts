import { createEmptyDocument, createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { deriveRoutingAffectedClosure } from "./routing-affected-closure.js";

function terminal(instanceId: string, pinName: string) {
  return { kind: "terminal" as const, instanceId, pinName };
}

describe("routing affected closure", () => {
  it("separates internal, boundary, external and isolated selected Routes", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      ...["A", "B", "C", "D", "E"].map((id, index) => ({
        id,
        symbolId: "resistor",
        placement: {
          position: { x: index * 100, y: 0 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      })),
    );
    document.nets.push(
      { id: "internal", terminals: [terminal("A", "1"), terminal("B", "1")] },
      { id: "boundary", terminals: [terminal("A", "2"), terminal("C", "1")] },
      { id: "external", terminals: [terminal("D", "1"), terminal("E", "1")] },
      { id: "loose", terminals: [] },
    );
    document.junctions.push(
      { id: "J1", netId: "internal", position: { x: 50, y: 0 } },
      { id: "JL", netId: "loose", position: { x: 0, y: 100 } },
      { id: "JR", netId: "loose", position: { x: 100, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "r-int-a",
        netId: "internal",
        start: terminal("A", "1"),
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "r-int-b",
        netId: "internal",
        start: { kind: "junction", junctionId: "J1" },
        end: terminal("B", "1"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "r-boundary",
        netId: "boundary",
        start: terminal("A", "2"),
        end: terminal("C", "1"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "r-external",
        netId: "external",
        start: terminal("D", "1"),
        end: terminal("E", "1"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "r-loose",
        netId: "loose",
        start: { kind: "junction", junctionId: "JL" },
        end: { kind: "junction", junctionId: "JR" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const closure = deriveRoutingAffectedClosure(document, {
      instanceIds: ["A", "B"],
      routeIds: ["r-loose"],
      junctionIds: [],
    });

    expect(closure.internalRoutes).toEqual(["r-int-a", "r-int-b", "r-loose"]);
    expect(closure.boundaryRoutes).toEqual(["r-boundary"]);
    expect(closure.externalRoutes).toEqual(["r-external"]);
    expect(closure.internalJunctions).toEqual(["J1", "JL", "JR"]);
  });

  it("follows electrical route annotations and reports protected owners", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "net", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net", position: { x: 100, y: 0 } },
    );
    const route = createRoutePath({
      id: "route",
      netId: "net",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["trunk"],
    });
    document.routes.push(route);
    document.annotations.push({
      id: "label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      anchor: {
        kind: "route",
        routeId: "route",
        legId: route.legs[0]!.id,
        t: 0.5,
        normalOffset: 10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 50, y: -10 },
      },
      netId: "net",
      alignment: "middle",
      rotation: 0,
      locked: true,
    });

    const closure = deriveRoutingAffectedClosure(document, {
      instanceIds: [],
      routeIds: ["route"],
      junctionIds: [],
    });
    expect(closure.electricalAnnotationIds).toEqual(["label"]);
    expect(closure.protectedObjectIds).toEqual(["label", "route"]);
  });

  it("keeps an unselected dangling Route outside an explicit Instance selection", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
    });
    document.nets.push({
      id: "signal",
      terminals: [{ instanceId: "M1", pinName: "G" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "signal",
      position: { x: 0, y: 0 },
    });
    document.routes.push(
      createRoutePath({
        id: "dangling",
        netId: "signal",
        start: { kind: "terminal", instanceId: "M1", pinName: "G" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    expect(
      deriveRoutingAffectedClosure(
        document,
        { instanceIds: ["M1"], routeIds: [], junctionIds: [] },
        { includeImplicitInstanceRoutes: false },
      ),
    ).toMatchObject({
      instances: ["M1"],
      internalRoutes: [],
      internalJunctions: [],
      boundaryRoutes: ["dangling"],
    });
  });
});
