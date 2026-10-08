import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { resolveEndpointConnection } from "@icm/derived";

import { gateRoutingOperationPlan } from "./routing-operation-plan.js";
import {
  planRoutingTransform,
  prepareRoutingTransform,
} from "./routing-transform-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("routing transform planner", () => {
  it("reuses one frozen closure across pointer deltas and preserves fresh-planner semantics", () => {
    const document = createEmptyDocument("prepared", "Prepared");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "n",
      terminals: [{ instanceId: "R", pinName: "1" }],
    });
    document.junctions.push({
      id: "j",
      netId: "n",
      position: { x: 300, y: 80 },
    });
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "n",
        start: { kind: "terminal", instanceId: "R", pinName: "1" },
        end: { kind: "junction", junctionId: "j" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const seed = { instanceIds: ["R"], routeIds: [], junctionIds: [] };
    const before = structuredClone(document);
    const prepare = prepareRoutingTransform(document, resolver, seed);
    const first = prepare({ kind: "translate", delta: { x: 20, y: 10 } });
    for (const delta of [
      { x: 30, y: 20 },
      { x: 40, y: 10 },
      { x: 0, y: 0 },
    ]) {
      const plan = prepare({ kind: "translate", delta });
      expect(plan.affected).toBe(first.affected);
      expect(plan).toEqual(
        planRoutingTransform(document, resolver, seed, {
          kind: "translate",
          delta,
        }),
      );
    }
    expect(document).toEqual(before);
    const replacement = structuredClone(document);
    replacement.instances[0]!.placement!.position.x += 10;
    const second = prepareRoutingTransform(
      replacement,
      resolver,
      seed,
    )({ kind: "translate", delta: { x: 20, y: 10 } });
    expect(second.affected).not.toBe(first.affected);
    expect(second).toEqual(
      planRoutingTransform(replacement, resolver, seed, {
        kind: "translate",
        delta: { x: 20, y: 10 },
      }),
    );
  });
  it("slides a T junction along its trunk without canonicalizing it back (#1229)", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.instances.push({
      id: "RB",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const terminal = {
      kind: "terminal" as const,
      instanceId: "RB",
      pinName: "1",
    };
    const pin = resolveEndpointConnection(
      document,
      resolver,
      terminal,
    )!.contactPoint;
    document.instances[0]!.placement!.position = { x: -pin.x, y: 20 - pin.y };
    document.nets[0]!.terminals.push({ instanceId: "RB", pinName: "1" });
    document.junctions.push(
      { id: "J", netId: "net", position: { x: 0, y: 0 } },
      {
        id: "L",
        netId: "net",
        position: { x: -100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "R",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    for (const end of ["L", "R", "B"])
      document.routes.push(
        createRoutePath({
          id: `wire-${end}`,
          netId: "net",
          start: end === "B" ? terminal : { kind: "junction", junctionId: "J" },
          end: { kind: "junction", junctionId: end === "B" ? "J" : end },
          bends: [],
          modes: ["manual"],
        }),
      );
    const plan = planRoutingTransform(
      document,
      resolver,
      { instanceIds: [], routeIds: [], junctionIds: ["J"] },
      { kind: "translate", delta: { x: 40, y: 0 } },
    );
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.evaluated.finalDocument.junctions.find((item) => item.id === "J")
        ?.position,
    ).toEqual({ x: 40, y: 0 });
  });
  it("translates a selected loose conductor through the shared closure", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "net",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const plan = planRoutingTransform(
      document,
      resolver,
      { instanceIds: [], routeIds: ["wire"], junctionIds: [] },
      { kind: "translate", delta: { x: 20, y: 30 } },
    );
    expect(plan.affected.internalRoutes).toEqual(["wire"]);
    const result = gateRoutingOperationPlan(document, plan, {
      symbolResolver: resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluated.finalDocument.junctions).toMatchObject([
      { id: "J1", position: { x: 20, y: 30 } },
      { id: "J2", position: { x: 120, y: 30 } },
    ]);
  });

  it("supports a 180-degree operation and rejects protected conductors", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 50, y: 50 },
        rotation: 0,
        mirror: "none",
      },
    });
    const rotation = planRoutingTransform(
      document,
      resolver,
      { instanceIds: ["R1"], routeIds: [], junctionIds: [] },
      { kind: "rotate", degrees: 180, center: { x: 50, y: 50 } },
    );
    const rotated = gateRoutingOperationPlan(document, rotation, {
      symbolResolver: resolver,
    });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(
        rotated.evaluated.finalDocument.instances[0]?.placement,
      ).toMatchObject({ position: { x: 50, y: 50 }, rotation: 180 });
    }

    const protectedDocument = createEmptyDocument("protected", "Protected");
    protectedDocument.nets.push({ id: "net", terminals: [] });
    protectedDocument.junctions.push(
      { id: "A", netId: "net", position: { x: 0, y: 0 } },
      { id: "B", netId: "net", position: { x: 100, y: 0 } },
    );
    protectedDocument.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "B" },
        bends: [],
        modes: ["trunk"],
      }),
    );
    const rejected = planRoutingTransform(
      protectedDocument,
      resolver,
      { instanceIds: [], routeIds: ["trunk"], junctionIds: [] },
      { kind: "translate", delta: { x: 10, y: 0 } },
    );
    expect(rejected.diagnostics).toMatchObject([
      { code: "ROUTING_TRANSFORM_PROTECTED", objectIds: ["trunk"] },
    ]);
  });
});
