import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { Point, RouteEndpoint } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { proposeGroupMoveEdits } from "./routing-planner.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

const terminal = (instanceId: string, pinName: string): RouteEndpoint => ({
  kind: "terminal",
  instanceId,
  pinName,
});

function transaction(documentId: string, revision: number, edits: unknown[]) {
  return {
    transactionId: `follow-${revision}`,
    documentId,
    expectedRevision: revision,
    actor: { kind: "human" as const, id: "follow-test" },
    edits,
  };
}

/**
 * One resistor over one transistor over two grounds, the shape a bias branch
 * takes: every wire here runs straight down a pin's own lead.
 */
function branchFixture() {
  const document = createEmptyDocument("follow", "Follow");
  const place = (id: string, symbolId: string, x: number, y: number) => ({
    kind: "add_instance" as const,
    instance: {
      id,
      symbolId,
      placement: { position: { x, y }, rotation: 0, mirror: "none" as const },
    },
  });
  const built = executeTransaction(
    document,
    transaction(document.id, 0, [
      place("R2", "resistor", 400, 300),
      place("Q3", "npn", 400, 420),
      place("GB", "ground", 280, 470),
      place("GE", "ground", 400, 520),
    ]),
    context,
  );
  if (!built.ok) throw new Error("fixture instances rejected");
  const wired = executeTransaction(
    built.document,
    transaction(document.id, 1, [
      {
        kind: "connect_endpoints",
        from: terminal("R2", "2"),
        to: terminal("Q3", "C"),
        newNetId: "n-collector",
      },
      {
        kind: "connect_endpoints",
        from: terminal("Q3", "B"),
        to: terminal("GB", "0"),
        newNetId: "n-base",
      },
      {
        kind: "connect_endpoints",
        from: terminal("Q3", "E"),
        to: terminal("GE", "0"),
        newNetId: "n-emitter",
      },
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "w-collector",
          netId: "n-collector",
          start: terminal("R2", "2"),
          end: terminal("Q3", "C"),
          bends: [],
          modes: ["manual"],
        }),
      },
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "w-base",
          netId: "n-base",
          start: terminal("Q3", "B"),
          end: terminal("GB", "0"),
          bends: [{ x: 280, y: 420 }],
          modes: ["manual", "manual"],
        }),
      },
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: "w-emitter",
          netId: "n-emitter",
          start: terminal("Q3", "E"),
          end: terminal("GE", "0"),
          bends: [],
          modes: ["manual"],
        }),
      },
    ]),
    context,
  );
  if (!wired.ok) throw new Error("fixture wiring rejected");
  return wired.document;
}

function centerline(
  document: ReturnType<typeof branchFixture>,
  routeId: string,
): readonly Point[] {
  const route = document.routes.find((candidate) => candidate.id === routeId)!;
  return resolveRouteGeometry(document, resolver, route)!.centerline;
}

describe("Route follow after an instance moves", () => {
  it("meets both pins along their leads when one segment is stretched", () => {
    const document = branchFixture();
    expect(centerline(document, "w-collector")).toEqual([
      { x: 400, y: 320 },
      { x: 400, y: 390 },
    ]);

    const moved = executeTransaction(
      document,
      transaction(document.id, 2, [
        {
          kind: "move_instance",
          instanceId: "Q3",
          position: { x: 520, y: 420 },
        },
      ]),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    // Both pins face along the vertical axis, so a single corner would have to
    // sacrifice one of them and run the wire into the side of that symbol.
    // Two corners leave the resistor downward and arrive at the collector from
    // above, which is where its lead points.
    expect(centerline(moved.document, "w-collector")).toEqual([
      { x: 400, y: 320 },
      { x: 400, y: 360 },
      { x: 520, y: 360 },
      { x: 520, y: 390 },
    ]);
    expect(centerline(moved.document, "w-emitter")).toEqual([
      { x: 520, y: 450 },
      { x: 520, y: 480 },
      { x: 400, y: 480 },
      { x: 400, y: 510 },
    ]);
  });

  it("leaves a route that already turns before its far pin alone", () => {
    const document = branchFixture();
    const moved = executeTransaction(
      document,
      transaction(document.id, 2, [
        {
          kind: "move_instance",
          instanceId: "Q3",
          position: { x: 520, y: 420 },
        },
      ]),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // The base wire already turns down into the ground, so following the base
    // pin only stretches its own leg and the ground keeps its approach.
    expect(centerline(moved.document, "w-base")).toEqual([
      { x: 480, y: 420 },
      { x: 280, y: 420 },
      { x: 280, y: 460 },
    ]);
  });

  it("keeps the original heading when a lead points away from the far end", () => {
    const document = branchFixture();
    // Moving the emitter ground above its own pin puts the transistor's
    // south-facing lead on the wrong side of the target. A stretch may not
    // invent an escape stub, so the segment keeps the heading it had.
    const moved = executeTransaction(
      document,
      transaction(document.id, 2, [
        {
          kind: "move_instance",
          instanceId: "GE",
          position: { x: 300, y: 400 },
        },
      ]),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const points = centerline(moved.document, "w-emitter");
    expect(points[0]).toEqual({ x: 400, y: 450 });
    expect(points.at(-1)).toEqual({ x: 300, y: 390 });
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      expect(previous.x === current.x || previous.y === current.y).toBe(true);
    }
  });
});

describe("Route follow after a canvas drag", () => {
  it("meets both pins along their leads through the group-move planner", () => {
    const document = branchFixture();
    // The canvas drag plans its own Route geometry rather than letting the
    // transaction stretch it, so the rule has to hold on this path too.
    const plan = proposeGroupMoveEdits(document, resolver, [
      { instanceId: "Q3", position: { x: 520, y: 420 } },
    ]);
    const dragged = executeTransaction(
      document,
      {
        transactionId: "drag-q3",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human" as const, id: "follow-test" },
        edits: plan.edits,
      },
      context,
    );
    expect(dragged.ok).toBe(true);
    if (!dragged.ok) return;
    expect(centerline(dragged.document, "w-collector")).toEqual([
      { x: 400, y: 320 },
      { x: 400, y: 360 },
      { x: 520, y: 360 },
      { x: 520, y: 390 },
    ]);
    expect(centerline(dragged.document, "w-emitter")).toEqual([
      { x: 520, y: 450 },
      { x: 520, y: 480 },
      { x: 400, y: 480 },
      { x: 400, y: 510 },
    ]);
    expect(centerline(dragged.document, "w-base")).toEqual([
      { x: 480, y: 420 },
      { x: 280, y: 420 },
      { x: 280, y: 460 },
    ]);
  });
});
