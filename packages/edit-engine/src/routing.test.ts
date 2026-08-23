import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  deriveCrossings,
  deriveFlightlines,
  resolveRouteGeometry,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";
import { isOrthogonal } from "./route-geometry-edit.js";
import { proposeWireSegmentDrag } from "./route-operations.js";
import {
  proposeGroupMoveEdits,
  proposeGroupRotationEdits,
  proposeEndpointRouteAttachment,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeWireIntent,
  proposeVisualRouteDeletion,
  proposeWireSegmentMove,
} from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function documentFixture() {
  return parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
}

const terminal = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "P",
});

function transaction(documentId: string, revision: number, edits: unknown[]) {
  return {
    transactionId: `routing-${revision}-${edits.length}`,
    documentId,
    expectedRevision: revision,
    actor: { kind: "human" as const, id: "routing-test" },
    edits,
  };
}

describe("routing Edit Engine", () => {
  it("accepts one octilinear Route without creating a second topology protocol", () => {
    const document = createEmptyDocument("octilinear", "Octilinear");
    document.nets.push({ id: "n1", scope: "local", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "n1",
        position: { x: 100, y: 100 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "n1",
        position: { x: 200, y: 200 },
        role: "route-anchor",
      },
    );
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "wire-45",
          netId: "n1",
          from: { kind: "junction", junctionId: "J1" },
          to: { kind: "junction", junctionId: "J2" },
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.document.routes[0]?.waypoints).toEqual([]);
  });

  it("gives Agent wire intent the same octilinear compiler", () => {
    const document = createEmptyDocument(
      "agent-octilinear",
      "Agent octilinear",
    );
    document.nets.push({ id: "n1", scope: "local", terminals: [] });
    document.junctions.push(
      { id: "J1", netId: "n1", position: { x: 0, y: 0 }, role: "route-anchor" },
      {
        id: "J2",
        netId: "n1",
        position: { x: 100, y: 60 },
        role: "route-anchor",
      },
    );
    const planned = proposeWireIntent(document, resolver, {
      id: "agent-wire",
      from: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "J1" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: "J2" },
      },
      routingMode: "octilinear",
    });
    expect(typeof planned).not.toBe("string");
    if (typeof planned === "string") return;
    const route = planned.edits.find(
      (edit) => edit.kind === "set_route_points",
    );
    expect(route).toMatchObject({ waypoints: [{ x: 60, y: 60 }] });
  });

  it("rejects a Junction move that would leave an incident Route geometry stale", () => {
    const document = createEmptyDocument("junction-integrity", "Junction");
    document.nets.push({ id: "n1", scope: "local", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "n1",
        position: { x: 100, y: 100 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "n1",
        position: { x: 200, y: 100 },
        role: "route-anchor",
      },
    );
    document.routes.push({
      id: "wire-1",
      netId: "n1",
      from: { kind: "junction", junctionId: "J1" },
      to: { kind: "junction", junctionId: "J2" },
      waypoints: [],
      segmentModes: ["manual"],
    });

    const rejected = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "move_junction",
          junctionId: "J1",
          position: { x: 120, y: 100 },
        },
      ]),
      context,
    );
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: "EDIT_PRECONDITION",
      },
      diagnostics: [{ objectIds: ["J1", "wire-1"] }],
    });

    const proposal = proposeLooseRouteTranslation(document, "wire-1", {
      x: 20,
      y: 0,
    });
    const moved = executeTransaction(
      document,
      transaction(document.id, 0, proposal.edits),
      context,
    );
    expect(moved.ok).toBe(true);
  });

  it("keeps a tapped VDD rail contiguous when it is resized or moved", () => {
    const document = createEmptyDocument("vdd-manipulation", "VDD edit");
    document.nets.push({
      id: "VDD",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.junctions.push(
      {
        id: "vdd-start",
        netId: "VDD",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "vdd-tap",
        netId: "VDD",
        position: { x: 50, y: 0 },
        role: "branch",
      },
      {
        id: "vdd-end",
        netId: "VDD",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "branch-end",
        netId: "VDD",
        position: { x: 50, y: 100 },
        role: "branch",
      },
    );
    document.routes.push(
      {
        id: "rail-left",
        netId: "VDD",
        from: { kind: "junction", junctionId: "vdd-start" },
        to: { kind: "junction", junctionId: "vdd-tap" },
        waypoints: [],
        segmentModes: ["manual"],
        presentation: "power-rail",
      },
      {
        id: "rail-right",
        netId: "VDD",
        from: { kind: "junction", junctionId: "vdd-tap" },
        to: { kind: "junction", junctionId: "vdd-end" },
        waypoints: [],
        segmentModes: ["manual"],
        presentation: "power-rail",
      },
      {
        id: "branch",
        netId: "VDD",
        from: { kind: "junction", junctionId: "vdd-tap" },
        to: { kind: "junction", junctionId: "branch-end" },
        waypoints: [],
        segmentModes: ["manual"],
      },
    );

    const resizedProposal = proposePowerRailEndpointResize(
      document,
      resolver,
      "rail-left",
      "end",
      { x: 160, y: 90 },
    );
    const resized = executeTransaction(
      document,
      transaction(document.id, 0, resizedProposal.edits),
      context,
    );
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(
      resized.document.junctions.find((junction) => junction.id === "vdd-end"),
    ).toMatchObject({ position: { x: 160, y: 0 } });
    expect(
      resolveRouteGeometry(
        resized.document,
        resolver,
        resized.document.routes.find((route) => route.id === "rail-right")!,
      )?.centerline,
    ).toEqual([
      { x: 50, y: 0 },
      { x: 160, y: 0 },
    ]);

    const movedProposal = proposePowerRailTranslation(
      resized.document,
      resolver,
      "rail-right",
      { x: 20, y: 20 },
    );
    const moved = executeTransaction(
      resized.document,
      transaction(resized.document.id, 1, movedProposal.edits),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.document.junctions.find((junction) => junction.id === "vdd-tap"),
    ).toMatchObject({ position: { x: 70, y: 20 } });
    expect(
      moved.document.junctions.find((junction) => junction.id === "branch-end"),
    ).toMatchObject({ position: { x: 50, y: 100 } });
    const railFragments = moved.document.routes.filter(
      (route) => route.presentation === "power-rail",
    );
    expect(railFragments).toHaveLength(2);
    for (const route of railFragments) {
      expect(
        resolveRouteGeometry(moved.document, resolver, route)?.centerline,
      ).toSatisfy((points: Array<{ x: number; y: number }>) =>
        isOrthogonal(points),
      );
    }
    expect(
      resolveRouteGeometry(
        moved.document,
        resolver,
        moved.document.routes.find((route) => route.id === "branch")!,
      )?.centerline,
    ).toEqual([
      { x: 70, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 100 },
    ]);
  });

  it("resizes a vertical Power Rail only along its y axis", () => {
    const document = createEmptyDocument("vertical-rail", "Vertical rail");
    document.nets.push({
      id: "VDD",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.junctions.push(
      {
        id: "rail-top",
        netId: "VDD",
        position: { x: 40, y: 0 },
        role: "route-anchor",
      },
      {
        id: "rail-bottom",
        netId: "VDD",
        position: { x: 40, y: 100 },
        role: "route-anchor",
      },
    );
    document.routes.push({
      id: "vertical-rail-route",
      netId: "VDD",
      from: { kind: "junction", junctionId: "rail-top" },
      to: { kind: "junction", junctionId: "rail-bottom" },
      waypoints: [],
      segmentModes: ["manual"],
      presentation: "power-rail",
    });

    const proposal = proposePowerRailEndpointResize(
      document,
      resolver,
      "vertical-rail-route",
      "start",
      { x: 999, y: -60 },
    );
    const resized = executeTransaction(
      document,
      transaction(document.id, document.revision, proposal.edits),
      context,
    );
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(
      resized.document.junctions.find((junction) => junction.id === "rail-top"),
    ).toMatchObject({ position: { x: 40, y: -60 } });
  });

  it("plans a power rail and its label as one visual deletion", () => {
    const document = createEmptyDocument("vdd-delete", "VDD delete");
    document.nets.push({
      id: "VDD",
      scope: "global",
      terminals: [],
    });
    document.junctions.push(
      {
        id: "vdd-start",
        netId: "VDD",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "vdd-end",
        netId: "VDD",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push({
      id: "vdd-rail",
      netId: "VDD",
      from: { kind: "junction", junctionId: "vdd-start" },
      to: { kind: "junction", junctionId: "vdd-end" },
      waypoints: [],
      segmentModes: ["manual"],
      presentation: "power-rail",
    });
    document.annotations.push({
      id: "label-VDD",
      kind: "power-label",
      netId: "VDD",
      content: { runs: [{ kind: "text", value: "VDD" }] },
      anchor: {
        kind: "object",
        objectId: "vdd-end",
        localOffset: { x: 10, y: 10 },
        fallbackPosition: { x: 110, y: 10 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });

    const proposal = proposeVisualRouteDeletion(document, ["vdd-rail"], []);
    expect(proposal.annotationIds).toEqual(["label-VDD"]);
    expect(
      proposal.edits.filter(
        (edit) => edit.kind === "remove_schematic_annotation",
      ),
    ).toHaveLength(1);
    const deleted = executeTransaction(
      document,
      transaction(document.id, 0, proposal.edits),
      context,
    );
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.document.annotations).toHaveLength(0);
    expect(deleted.document.routes).toHaveLength(0);
  });

  it("attaches a real terminal to a Route interior and lets both halves follow it", () => {
    const document = documentFixture();
    document.instances.find((instance) => instance.id === "E")!.placement = {
      position: { x: 300, y: 290 },
      rotation: 90,
      mirror: "none",
    };
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const proposal = proposeEndpointRouteAttachment(
      routed.document,
      terminal("E"),
      "net-h",
      "route-h",
      { x: 300, y: 300 },
      0,
      "e",
    );
    const attached = executeTransaction(
      routed.document,
      transaction(document.id, 1, proposal.edits),
      context,
    );
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.document.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "route-h-a-e", to: terminal("E") }),
        expect.objectContaining({ id: "route-h-b-e", from: terminal("E") }),
      ]),
    );
    const moved = executeTransaction(
      attached.document,
      transaction(document.id, 2, [
        {
          kind: "move_instance",
          instanceId: "E",
          position: { x: 320, y: 310 },
        },
      ]),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    for (const route of moved.document.routes) {
      expect(
        resolveRouteGeometry(moved.document, resolver, route)?.centerline,
      ).toSatisfy((points: Array<{ x: number; y: number }>) =>
        isOrthogonal(points),
      );
    }
  });

  it("plans a segment drag as transaction edits", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const plan = proposeWireSegmentMove(
      routed.document,
      resolver,
      "route-h",
      0,
      { x: 300, y: 340 },
    );
    expect(plan.edits.some((edit) => edit.kind === "set_route_points")).toBe(
      true,
    );
    expect(plan.preview?.routes).toEqual([
      {
        routeId: "route-h",
        waypoints: [
          { x: 150, y: 340 },
          { x: 450, y: 340 },
        ],
        segmentModes: ["manual", "manual", "manual"],
      },
    ]);
    const moved = executeTransaction(
      routed.document,
      transaction(document.id, 1, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
  });

  it("moves a three-way Junction with its dragged segment", () => {
    const document = createEmptyDocument("junction-follow", "Junction follow");
    document.nets.push({ id: "net-j", scope: "local", terminals: [] });
    document.junctions.push(
      { id: "junction-center", netId: "net-j", position: { x: 100, y: 100 } },
      {
        id: "junction-right",
        netId: "net-j",
        position: { x: 300, y: 100 },
        role: "route-anchor",
      },
      { id: "junction-top", netId: "net-j", position: { x: 100, y: 20 } },
      { id: "junction-left", netId: "net-j", position: { x: 20, y: 100 } },
    );
    document.routes.push(
      {
        id: "route-main",
        netId: "net-j",
        from: { kind: "junction", junctionId: "junction-center" },
        to: { kind: "junction", junctionId: "junction-right" },
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-top",
        netId: "net-j",
        from: { kind: "junction", junctionId: "junction-top" },
        to: { kind: "junction", junctionId: "junction-center" },
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-left",
        netId: "net-j",
        from: { kind: "junction", junctionId: "junction-left" },
        to: { kind: "junction", junctionId: "junction-center" },
        waypoints: [],
        segmentModes: ["manual"],
      },
    );

    const proposal = proposeWireSegmentMove(
      document,
      resolver,
      "route-main",
      0,
      { x: 200, y: 60 },
    );
    expect(
      proposal.edits.filter((edit) => edit.kind === "move_junction"),
    ).toEqual([
      {
        kind: "move_junction",
        junctionId: "junction-center",
        position: { x: 100, y: 60 },
      },
      {
        kind: "move_junction",
        junctionId: "junction-right",
        position: { x: 300, y: 60 },
      },
    ]);
    expect(proposal.preview?.junctions).toEqual([
      { junctionId: "junction-center", position: { x: 100, y: 60 } },
      { junctionId: "junction-right", position: { x: 300, y: 60 } },
    ]);

    const moved = executeTransaction(
      document,
      transaction(document.id, 0, proposal.edits),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.document.junctions.find(
        (junction) => junction.id === "junction-center",
      )?.position,
    ).toEqual({ x: 100, y: 60 });
    expect(
      resolveRouteGeometry(
        moved.document,
        resolver,
        moved.document.routes.find((route) => route.id === "route-main")!,
      )?.centerline,
    ).toEqual([
      { x: 100, y: 60 },
      { x: 300, y: 60 },
    ]);
    expect(
      resolveRouteGeometry(
        moved.document,
        resolver,
        moved.document.routes.find((route) => route.id === "route-left")!,
      )?.centerline,
    ).toEqual([
      { x: 20, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 60 },
    ]);
  });

  it("authors every planned internal Route so group geometry is order-independent", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    const plan = proposeGroupMoveEdits(routed.document, resolver, [
      { instanceId: "A", position: { x: 160, y: 320 } },
      { instanceId: "B", position: { x: 480, y: 320 } },
      { instanceId: "C", position: { x: 320, y: 160 } },
    ]);
    expect(
      plan.edits.filter((edit) => edit.kind === "move_instance"),
    ).toHaveLength(3);
    expect(
      plan.edits
        .filter((edit) => edit.kind === "set_route_points")
        .map((edit) => edit.routeId),
    ).toEqual(["route-h"]);
    const moved = executeTransaction(
      routed.document,
      transaction(document.id, 1, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
  });

  it("never drags a Junction so far that a branch hides inside a wire", () => {
    // A T: two arms on y=300 meeting a tap that rises to y=200.
    const document = createEmptyDocument("tap", "Tap");
    document.nets.push({ id: "n1", scope: "local", terminals: [] });
    document.junctions.push({
      id: "J",
      netId: "n1",
      position: { x: 300, y: 300 },
      role: "route-anchor",
    });
    document.junctions.push(
      {
        id: "L",
        netId: "n1",
        position: { x: 200, y: 300 },
        role: "route-anchor",
      },
      {
        id: "R",
        netId: "n1",
        position: { x: 400, y: 300 },
        role: "route-anchor",
      },
      {
        id: "T",
        netId: "n1",
        position: { x: 300, y: 200 },
        role: "route-anchor",
      },
    );
    const wire = (id: string, from: string, to: string) => ({
      kind: "set_route_points" as const,
      routeId: id,
      netId: "n1",
      from: { kind: "junction" as const, junctionId: from },
      to: { kind: "junction" as const, junctionId: to },
      waypoints: [],
      segmentModes: ["manual"],
    });
    const built = executeTransaction(
      document,
      transaction(document.id, 0, [
        wire("left", "L", "J"),
        wire("right", "J", "R"),
        wire("tap", "J", "T"),
      ]),
      context,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Carrying J up to y=250 only shortens the tap: every branch stays visible.
    const shortened = proposeWireSegmentDrag(
      built.document,
      resolver,
      "left",
      0,
      { x: 250, y: 250 },
    );
    expect(
      shortened.junctions.find((move) => move.junctionId === "J")?.position,
    ).toEqual({ x: 300, y: 250 });

    // Downwards the tap cannot follow at all — carrying J to y=400 would leave
    // "right" rising back out of it along the tap's own line. J holds instead
    // and "left" doglegs down to reach it.
    const doglegged = proposeWireSegmentDrag(
      built.document,
      resolver,
      "left",
      0,
      { x: 250, y: 400 },
    );
    expect(doglegged.junctions).toEqual([]);
    expect(
      doglegged.routes.find((route) => route.routeId === "left")?.waypoints,
    ).toEqual([
      { x: 200, y: 400 },
      { x: 300, y: 400 },
    ]);

    // Past the tap's far end neither plan keeps every branch visible: carrying
    // J turns the tap around, and the dogleg comes down the tap's line. The
    // drag has nowhere left to go, so it stops rather than drawing the
    // ambiguity.
    expect(() =>
      proposeWireSegmentDrag(built.document, resolver, "left", 0, {
        x: 250,
        y: 150,
      }),
    ).toThrow(/overlap/u);
  });

  it("turns a multi-part selection as one body about a shared pivot", () => {
    const document = documentFixture();
    // A and B sit side by side on y=300; a quarter turn about their shared
    // centre has to stand them up, not merely spin each symbol where it is.
    const plan = proposeGroupRotationEdits(document, resolver, ["A", "B"], 90);
    const applied = executeTransaction(
      document,
      transaction(document.id, document.revision, plan.edits),
      context,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const placement = (id: string) =>
      applied.document.instances.find((instance) => instance.id === id)!
        .placement!;
    expect(placement("A").position).toEqual({ x: 300, y: 140 });
    expect(placement("B").position).toEqual({ x: 300, y: 460 });
    expect(placement("A").rotation).toBe(90);
    expect(placement("B").rotation).toBe(90);
  });

  it("leaves a lone part turning in place", () => {
    const document = documentFixture();
    const before = document.instances.find((instance) => instance.id === "A")!
      .placement!.position;
    const plan = proposeGroupRotationEdits(document, resolver, ["A"], 90);
    const applied = executeTransaction(
      document,
      transaction(document.id, document.revision, plan.edits),
      context,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const after = applied.document.instances.find(
      (instance) => instance.id === "A",
    )!.placement!;
    expect(after.position).toEqual(before);
    expect(after.rotation).toBe(90);
  });

  it("turns a quarter each way back to where it started", () => {
    const document = documentFixture();
    const forward = executeTransaction(
      document,
      transaction(
        document.id,
        document.revision,
        proposeGroupRotationEdits(document, resolver, ["A", "B", "C"], 90)
          .edits,
      ),
      context,
    );
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const back = executeTransaction(
      forward.document,
      transaction(
        forward.document.id,
        forward.document.revision,
        proposeGroupRotationEdits(
          forward.document,
          resolver,
          ["A", "B", "C"],
          -90,
        ).edits,
      ),
      context,
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (const id of ["A", "B", "C"]) {
      const original = document.instances.find(
        (instance) => instance.id === id,
      )!.placement!;
      const restored = back.document.instances.find(
        (instance) => instance.id === id,
      )!.placement!;
      expect(restored.position).toEqual(original.position);
      expect(restored.rotation).toBe(original.rotation);
    }
  });

  it("authors group Route geometry when a group move also moves a Junction", () => {
    const document = documentFixture();
    document.junctions.push({
      id: "junction-h",
      netId: "net-h",
      position: { x: 320, y: 300 },
    });
    document.routes.push(
      {
        id: "route-h-left",
        netId: "net-h",
        from: terminal("A"),
        to: { kind: "junction", junctionId: "junction-h" },
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-h-right",
        netId: "net-h",
        from: { kind: "junction", junctionId: "junction-h" },
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    );

    const plan = proposeGroupMoveEdits(document, resolver, [
      { instanceId: "A", position: { x: 160, y: 320 } },
      { instanceId: "B", position: { x: 480, y: 320 } },
    ]);
    expect(plan.edits.filter((edit) => edit.kind === "move_junction")).toEqual([
      {
        kind: "move_junction",
        junctionId: "junction-h",
        position: { x: 340, y: 320 },
      },
    ]);
    expect(
      plan.edits
        .filter((edit) => edit.kind === "set_route_points")
        .map((edit) => edit.routeId),
    ).toEqual(["route-h-left", "route-h-right"]);

    const moved = executeTransaction(
      document,
      transaction(document.id, 0, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
  });

  it("lets an Agent request pin-aware orthogonal routing without waypoints", () => {
    const document = documentFixture();
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "route_orthogonal",
          routeId: "route-agent",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          escapeLength: 20,
        },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.document.routes[0]!;
    expect(route.segmentModes[0]).toBe("escape");
    expect(route.segmentModes.at(-1)).toBe("escape");
    expect(
      resolveRouteGeometry(result.document, resolver, route)?.centerline,
    ).toEqual([
      { x: 150, y: 300 },
      { x: 450, y: 300 },
    ]);
  });

  it("stretches connected Routes when an instance moves (ADR 0009)", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;

    // An axial move keeps the direct Route unchanged.
    const axialMove = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 150, y: 300 },
        },
      ]),
      context,
    );
    expect(axialMove.ok).toBe(true);
    if (axialMove.ok) {
      expect(axialMove.diff.changedObjectIds).toContain("route-h");
      expect(axialMove.document.routes[0]).toEqual(routed.document.routes[0]);
    }

    // A diagonal move that previously failed INVALID_RESULT now stretches the
    // Route to stay orthogonal instead of rejecting the transaction.
    const stretchedMove = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 140, y: 320 },
        },
      ]),
      context,
    );
    expect(stretchedMove.ok).toBe(true);
    if (!stretchedMove.ok) return;
    expect(stretchedMove.diff.changedObjectIds).toContain("route-h");
    // The stretched Route remains orthogonal.
    const stretched = stretchedMove.document.routes.find(
      (r) => r.id === "route-h",
    )!;
    const poly = resolveRouteGeometry(
      stretchedMove.document,
      resolver,
      stretched,
    );
    expect(poly?.centerline.length).toBeGreaterThanOrEqual(2);
    if (poly) {
      expect(isOrthogonal(poly.centerline)).toBe(true);
    }
  });

  it("keeps the fixed side of a direct Route in place during a local move", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;

    const plan = proposeGroupMoveEdits(routed.document, resolver, [
      { instanceId: "A", position: { x: 160, y: 320 } },
    ]);
    expect(plan.preview.routes).toEqual([
      {
        routeId: "route-h",
        waypoints: [{ x: 170, y: 300 }],
        segmentModes: ["manual", "manual"],
      },
    ]);
    const moved = executeTransaction(
      routed.document,
      transaction(routed.document.id, 1, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      resolveRouteGeometry(
        moved.document,
        resolver,
        moved.document.routes.find((route) => route.id === "route-h")!,
      )?.centerline,
    ).toEqual([
      { x: 170, y: 320 },
      { x: 170, y: 300 },
      { x: 450, y: 300 },
    ]);
  });

  it("moves a net label with its reshaped wire segment", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    routed.document.annotations.push({
      id: "net-label-route-h",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "CLK" }] },
      netId: "net-h",
      anchor: {
        kind: "route",
        routeId: "route-h",
        segmentIndex: 0,
        t: 0.5,
        normalOffset: -8,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 300, y: 290 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const reshaped = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [
            { x: 150, y: 340 },
            { x: 450, y: 340 },
          ],
          segmentModes: ["manual", "manual", "manual"],
        },
      ]),
      context,
    );
    expect(reshaped.ok).toBe(true);
    if (!reshaped.ok) return;
    expect(
      reshaped.document.annotations.find(
        (annotation) => annotation.id === "net-label-route-h",
      ),
    ).toMatchObject({
      anchor: { fallbackPosition: { x: 300, y: 330 } },
      rotation: 0,
    });
    expect(reshaped.diff.changedObjectIds).toEqual(
      expect.arrayContaining(["route-h", "net-label-route-h"]),
    );
  });

  it("remaps a current marker by physical location when route segments change", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];
    document.annotations.push({
      id: "current-route-h",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-h",
        segmentIndex: 0,
        t: 0.5,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 300, y: 300 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const complex = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [
            { x: 150, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 300 },
          ],
          segmentModes: ["manual", "manual", "manual", "manual"],
        },
      ]),
      context,
    );
    expect(complex.ok).toBe(true);
    if (!complex.ok) return;
    expect(
      complex.document.annotations.find(
        (annotation) => annotation.id === "current-route-h",
      ),
    ).toMatchObject({
      anchor: {
        kind: "route",
        routeId: "route-h",
        segmentIndex: 3,
        t: 0,
        normalOffset: -14,
        direction: "forward",
        fallbackPosition: { x: 300, y: 300 },
      },
    });
    expect(complex.diff.changedObjectIds).toEqual(
      expect.arrayContaining(["route-h", "current-route-h"]),
    );

    const simple = executeTransaction(
      complex.document,
      transaction(document.id, 1, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(simple.ok).toBe(true);
    if (!simple.ok) return;
    expect(
      simple.document.annotations.find(
        (annotation) => annotation.id === "current-route-h",
      ),
    ).toMatchObject({
      anchor: { segmentIndex: 0, t: 0.5 },
    });
  });

  it("keeps connected Routes and attached labels with move, rotate, and mirror", () => {
    const document = documentFixture();
    document.annotations.push({
      id: "label-a",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "A" }] },
      anchor: {
        kind: "object",
        objectId: "A",
        localOffset: { x: -40, y: -20 },
        fallbackPosition: { x: 100, y: 280 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;

    const moved = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 160, y: 320 },
        },
      ]),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      resolveRouteGeometry(
        moved.document,
        resolver,
        moved.document.routes.find((route) => route.id === "route-h")!,
      )?.centerline,
    ).toEqual([
      { x: 170, y: 320 },
      { x: 450, y: 320 },
      { x: 450, y: 300 },
    ]);
    expect(
      moved.document.annotations.find(
        (annotation) => annotation.id === "label-a",
      ),
    ).toMatchObject({
      anchor: {
        localOffset: { x: -40, y: -20 },
        fallbackPosition: { x: 120, y: 300 },
      },
      alignment: "middle",
      rotation: 0,
    });

    const rotated = executeTransaction(
      moved.document,
      transaction(document.id, 2, [
        { kind: "rotate_instance", instanceId: "A", rotation: 90 },
      ]),
      context,
    );
    if (!rotated.ok) throw new Error(rotated.error.message);
    expect(
      resolveRouteGeometry(
        rotated.document,
        resolver,
        rotated.document.routes.find((route) => route.id === "route-h")!,
      )?.centerline,
    ).toEqual([
      { x: 160, y: 330 },
      { x: 450, y: 330 },
      { x: 450, y: 300 },
    ]);
    expect(
      rotated.document.annotations.find(
        (annotation) => annotation.id === "label-a",
      ),
    ).toMatchObject({
      anchor: {
        localOffset: { x: 20, y: -40 },
        fallbackPosition: { x: 180, y: 280 },
      },
      alignment: "middle",
      rotation: 0,
    });

    const mirrored = executeTransaction(
      rotated.document,
      transaction(document.id, 3, [
        { kind: "mirror_instance", instanceId: "A", mirror: "x" },
      ]),
      context,
    );
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) return;
    expect(
      resolveRouteGeometry(
        mirrored.document,
        resolver,
        mirrored.document.routes.find((route) => route.id === "route-h")!,
      )?.centerline,
    ).toEqual([
      { x: 160, y: 310 },
      { x: 450, y: 310 },
      { x: 450, y: 300 },
    ]);
    expect(
      mirrored.document.annotations.find(
        (annotation) => annotation.id === "label-a",
      ),
    ).toMatchObject({
      anchor: {
        localOffset: { x: 20, y: 40 },
        fallbackPosition: { x: 180, y: 360 },
      },
      alignment: "middle",
      rotation: 0,
    });
    expect(mirrored.diff.changedObjectIds).toEqual(
      expect.arrayContaining(["A", "label-a", "route-h"]),
    );
  });

  it.each(["nmos", "pmos"])(
    "preserves a manually positioned %s label vector through a full rotation",
    (symbolId) => {
      const document = documentFixture();
      document.instances.push({
        id: "M1",
        symbolId,
        ...(symbolId === "nmos" || symbolId === "pmos"
          ? { symbolVariantId: "textbook-3terminal" }
          : {}),
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      // This deliberately differs from the canonical default and represents a
      // label explicitly moved by the user. Its coordinates are still on the
      // Document grid, as all persisted anchors must be.
      document.annotations.push({
        id: "instance-label-M1",
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "M1" }] },
        anchor: {
          kind: "object",
          objectId: "M1",
          localOffset: { x: 40, y: 20 },
          fallbackPosition: { x: 140, y: 120 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });

      const expected = [
        {
          rotation: 90 as const,
          position: { x: 80, y: 140 },
          offset: { x: -20, y: 40 },
          alignment: "start" as const,
        },
        {
          rotation: 180 as const,
          position: { x: 60, y: 80 },
          offset: { x: -40, y: -20 },
          alignment: "start" as const,
        },
        {
          rotation: 270 as const,
          position: { x: 120, y: 60 },
          offset: { x: 20, y: -40 },
          alignment: "start" as const,
        },
        {
          rotation: 0 as const,
          position: { x: 140, y: 120 },
          offset: { x: 40, y: 20 },
          alignment: "start" as const,
        },
      ];

      let current = document;
      for (const [index, state] of expected.entries()) {
        const rotated = executeTransaction(
          current,
          transaction(document.id, index, [
            {
              kind: "rotate_instance",
              instanceId: "M1",
              rotation: state.rotation,
            },
          ]),
          context,
        );
        if (!rotated.ok) throw new Error(rotated.error.message);
        expect(
          rotated.document.annotations.find(
            (annotation) => annotation.id === "instance-label-M1",
          ),
        ).toMatchObject({
          anchor: {
            localOffset: state.offset,
            fallbackPosition: state.position,
          },
          alignment: state.alignment,
          rotation: 0,
        });
        current = rotated.document;
      }
    },
  );

  it("preserves the painted label vector across repeated pure translations", () => {
    const document = documentFixture();
    document.annotations.push(
      {
        id: "label-a",
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "A" }] },
        // Deliberately differs from instance position + semantic offset. This
        // is the valid state produced by upright baseline/clearance correction
        // after a rotate or mirror operation.
        anchor: {
          kind: "object",
          objectId: "A",
          localOffset: { x: 20, y: -40 },
          fallbackPosition: { x: 190, y: 260 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
      {
        id: "marker-a",
        kind: "route-marker",
        markerKind: "voltage",
        content: { runs: [{ kind: "text", value: "V_A" }] },
        anchor: {
          kind: "object",
          objectId: "A",
          localOffset: { x: 10, y: -20 },
          fallbackPosition: { x: 150, y: 280 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );

    const first = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 160, y: 330 },
        },
      ]),
      context,
    );
    if (!first.ok) throw new Error(first.error.message);
    expect(first.document.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "label-a",
          anchor: expect.objectContaining({
            localOffset: { x: 20, y: -40 },
            fallbackPosition: { x: 210, y: 290 },
          }),
          alignment: "middle",
        }),
        expect.objectContaining({
          id: "marker-a",
          anchor: expect.objectContaining({
            fallbackPosition: { x: 170, y: 310 },
          }),
        }),
      ]),
    );

    const second = executeTransaction(
      first.document,
      transaction(document.id, 1, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 210, y: 350 },
        },
      ]),
      context,
    );
    if (!second.ok) throw new Error(second.error.message);
    expect(
      second.document.annotations.find(
        (annotation) => annotation.id === "label-a",
      ),
    ).toMatchObject({
      anchor: {
        localOffset: { x: 20, y: -40 },
        fallbackPosition: { x: 260, y: 310 },
      },
      alignment: "middle",
    });
  });

  it("rotates a terminal escape with the pin instead of rejecting the Route", () => {
    const document = documentFixture();
    const endpointB = document.instances.find(
      (instance) => instance.id === "B",
    );
    if (!endpointB?.placement) throw new Error("Fixture B must be placed");
    endpointB.placement.position.y = 360;
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "route_orthogonal",
          routeId: "route-agent",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          escapeLength: 20,
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;

    const rotated = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        { kind: "rotate_instance", instanceId: "A", rotation: 90 },
      ]),
      context,
    );
    if (!rotated.ok) throw new Error(rotated.error.message);
    const route = rotated.document.routes.find(
      (candidate) => candidate.id === "route-agent",
    )!;
    const points = resolveRouteGeometry(
      rotated.document,
      resolver,
      route,
    )?.centerline;
    expect(points?.[0]).toEqual({ x: 140, y: 310 });
    expect(points && isOrthogonal(points)).toBe(true);
  });

  it("stretches a shared Route across two instance moves in one transaction (ADR 0009)", () => {
    const document = documentFixture();
    // Establish a direct Route between A and B.
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    // Move both A and B along the shared Route's axis in the same transaction.
    // The second move must see the geometry produced by the first move's
    // stretch on route-h (the progressive draft), not the pre-transaction
    // Document. A diagonal move on both endpoints is out of scope here: it
    // would require corner insertion in proposeLocalStretch, tracked
    // separately.
    const bothMoved = executeTransaction(
      routed.document,
      transaction(document.id, 1, [
        {
          kind: "move_instance",
          instanceId: "A",
          position: { x: 180, y: 300 },
        },
        {
          kind: "move_instance",
          instanceId: "B",
          position: { x: 520, y: 300 },
        },
      ]),
      context,
    );
    expect(bothMoved.ok).toBe(true);
    if (!bothMoved.ok) return;
    const stretched = bothMoved.document.routes.find(
      (r) => r.id === "route-h",
    )!;
    const poly = resolveRouteGeometry(bothMoved.document, resolver, stretched);
    expect(poly?.centerline.length).toBeGreaterThanOrEqual(2);
    if (poly) {
      expect(isOrthogonal(poly.centerline)).toBe(true);
    }
  });

  it("gives escape segment mode an enforced outward-pin meaning", () => {
    const document = documentFixture();
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-bad-escape",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [
            { x: 130, y: 300 },
            { x: 130, y: 320 },
            { x: 450, y: 320 },
          ],
          segmentModes: ["escape", "manual", "manual", "manual"],
        },
      ]),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "EDIT_PRECONDITION",
        message: expect.stringContaining("must leave A.P outward"),
      },
    });
  });

  it("creates independent crossing routes without changing logical topology", () => {
    const document = documentFixture();
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "set_route_points",
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        },
        {
          kind: "set_route_points",
          routeId: "route-v",
          netId: "net-v",
          from: terminal("C"),
          to: terminal("D"),
          waypoints: [],
          segmentModes: ["manual"],
        },
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toHaveLength(2);
    expect(deriveCrossings(result.document, resolver)).toHaveLength(1);
    expect(result.document.nets).toEqual(document.nets);
    expect(deriveFlightlines(result.document, resolver)).toHaveLength(1);
  });

  it("does not derive flightlines across separately drawn named global Net markers", () => {
    const document = documentFixture();
    const globalNet = document.nets.find((net) => net.id === "net-h")!;
    globalNet.name = "VDD";
    globalNet.scope = "global";

    expect(deriveFlightlines(document, resolver)).not.toContainEqual(
      expect.objectContaining({ netId: "net-h" }),
    );
  });

  it("atomically splits a route through an explicit Junction", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];
    document.annotations.push({
      id: "current-split",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-h",
        segmentIndex: 0,
        t: 0.75,
        normalOffset: -14,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 375, y: 300 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "add_junction",
          junctionId: "junction-h",
          netId: "net-h",
          position: { x: 300, y: 300 },
          split: {
            routeId: "route-h",
            firstRouteId: "route-h-a",
            secondRouteId: "route-h-b",
            segmentIndex: 0,
          },
        },
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.junctions).toEqual([
      {
        id: "junction-h",
        netId: "net-h",
        position: { x: 300, y: 300 },
        role: "branch",
      },
    ]);
    expect(result.document.routes.map((route) => route.id)).toEqual([
      "route-h-a",
      "route-h-b",
    ]);
    expect(result.document.routes[0]!.to).toEqual({
      kind: "junction",
      junctionId: "junction-h",
    });
    expect(result.document.routes[1]!.from).toEqual({
      kind: "junction",
      junctionId: "junction-h",
    });
    expect(
      result.document.annotations.find(
        (annotation) => annotation.id === "current-split",
      ),
    ).toMatchObject({
      anchor: {
        kind: "route",
        routeId: "route-h-b",
        segmentIndex: 0,
        t: 0.5,
        normalOffset: -14,
      },
    });
  });

  it("materializes a Junction at an existing orthogonal bend without a zero-length segment", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-bend",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [
          { x: 150, y: 200 },
          { x: 450, y: 200 },
        ],
        segmentModes: ["manual", "manual", "manual"],
      },
    ];
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "add_junction",
          junctionId: "junction-bend",
          netId: "net-h",
          position: { x: 150, y: 200 },
          split: {
            routeId: "route-bend",
            firstRouteId: "route-bend-a",
            secondRouteId: "route-bend-b",
            segmentIndex: 0,
          },
        },
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes.map((route) => route.id)).toEqual([
      "route-bend-a",
      "route-bend-b",
    ]);
    expect(
      resolveRouteGeometry(
        result.document,
        resolver,
        result.document.routes[0]!,
      )?.centerline,
    ).toEqual([
      { x: 150, y: 300 },
      { x: 150, y: 200 },
    ]);
    expect(
      resolveRouteGeometry(
        result.document,
        resolver,
        result.document.routes[1]!,
      )?.centerline,
    ).toEqual([
      { x: 150, y: 200 },
      { x: 450, y: 200 },
      { x: 450, y: 300 },
    ]);
  });

  it("splits only the explicitly targeted conductor at a crossing", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-v",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        {
          kind: "add_junction",
          junctionId: "ambiguous-dot",
          netId: "net-h",
          position: { x: 300, y: 300 },
          split: {
            routeId: "route-h",
            firstRouteId: "route-h-a",
            secondRouteId: "route-h-b",
            segmentIndex: 0,
          },
        },
      ]),
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        junctions: [{ id: "ambiguous-dot", netId: "net-h" }],
      },
    });
    if (!result.ok) throw new Error("Targeted crossing split failed");
    expect(result.document.routes.map((route) => route.id)).toEqual([
      "route-h-a",
      "route-h-b",
      "route-v",
    ]);
    expect(
      result.document.routes.find((route) => route.id === "route-v"),
    ).toEqual(document.routes[1]);
  });

  it("accepts an arbitrary-angle route and still needs its context", () => {
    const document = documentFixture();
    const diagonal = transaction(document.id, 0, [
      {
        kind: "set_route_points",
        routeId: "route-diagonal",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("E"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ]);
    // ADR 0039: segment heading is geometry, not a rule about legal Routes.
    expect(executeTransaction(document, diagonal, context)).toMatchObject({
      ok: true,
    });
    expect(executeTransaction(document, diagonal)).toMatchObject({
      ok: false,
      error: { code: "EDIT_CONTEXT_REQUIRED" },
      document,
    });

    const locked = documentFixture();
    locked.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["locked"],
      },
    ];
    expect(
      executeTransaction(
        locked,
        transaction(locked.id, 0, [
          {
            kind: "remove_route_geometry",
            routeId: "route-h",
          },
        ]),
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
      document: locked,
    });
  });

  it("detaches visible geometry while retaining the logical Net", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];
    const beforeNet = structuredClone(document.nets[0]);
    const beforeFlightlines = deriveFlightlines(document, resolver);
    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "remove_route_geometry", routeId: "route-h" },
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(result.document.nets[0]).toEqual(beforeNet);
    expect(deriveFlightlines(result.document, resolver).length).toBeGreaterThan(
      beforeFlightlines.length,
    );
  });

  it("cuts a fully routed electrical branch and partitions its Net", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-v",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-v" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(
      result.document.nets
        .filter((net) =>
          net.terminals.some((terminal) =>
            ["C", "D"].includes(terminal.instanceId),
          ),
        )
        .map((net) => net.terminals.map((terminal) => terminal.instanceId)),
    ).toEqual([["C"], ["D"]]);
    expect(deriveFlightlines(result.document, resolver)).toHaveLength(2);
    expect(
      deriveFlightlines(result.document, resolver).filter((flightline) =>
        ["C", "D"].includes(
          flightline.from.kind === "terminal" ? flightline.from.instanceId : "",
        ),
      ),
    ).toEqual([]);
    expect(result.document.sourceStatus).toBe("connectivity-modified");
  });

  it("removes redundant cycle geometry without splitting the Net", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-v-direct",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-v-loop",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [
          { x: 340, y: 100 },
          { x: 340, y: 500 },
        ],
        segmentModes: ["manual", "manual", "manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-v-direct" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes.map((route) => route.id)).toEqual([
      "route-v-loop",
    ]);
    expect(
      result.document.nets.find((net) => net.id === "net-v")?.terminals,
    ).toEqual(document.nets.find((net) => net.id === "net-v")?.terminals);
    expect(result.document.sourceStatus).toBe("geometry-only-changed");
  });

  it("removes the empty local Net left by an isolated free wire", () => {
    const document = documentFixture();
    document.nets.push({
      id: "net-free",
      scope: "local",
      terminals: [],
    });
    document.junctions.push(
      {
        id: "junction-free-a",
        netId: "net-free",
        position: { x: 600, y: 500 },
        role: "route-anchor",
      },
      {
        id: "junction-free-b",
        netId: "net-free",
        position: { x: 700, y: 500 },
        role: "route-anchor",
      },
    );
    document.routes = [
      {
        id: "route-free",
        netId: "net-free",
        from: { kind: "junction", junctionId: "junction-free-a" },
        to: { kind: "junction", junctionId: "junction-free-b" },
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-free" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(
      result.document.junctions.filter((junction) =>
        junction.id.startsWith("junction-free-"),
      ),
    ).toEqual([]);
    expect(result.document.nets.some((net) => net.id === "net-free")).toBe(
      false,
    );
  });

  it("deletes routed geometry while preserving a partially routed imported Net", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-partial",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-partial" },
      ]),
      context,
    );

    const beforeNet = structuredClone(
      document.nets.find((net) => net.id === "net-h"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(result.document.nets.find((net) => net.id === "net-h")).toEqual(
      beforeNet,
    );
    expect(deriveFlightlines(result.document, resolver)).toHaveLength(3);
    expect(result.document.sourceStatus).toBe("geometry-only-changed");
  });

  it("deletes global-Net route geometry without partitioning the Net", () => {
    const document = documentFixture();
    const net = document.nets.find((candidate) => candidate.id === "net-v")!;
    net.scope = "global";
    const beforeNet = structuredClone(net);
    document.routes = [
      {
        id: "route-global",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-global" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(
      result.document.nets.find((candidate) => candidate.id === "net-v"),
    ).toEqual(beforeNet);
    expect(result.document.sourceStatus).toBe("geometry-only-changed");
  });
});
