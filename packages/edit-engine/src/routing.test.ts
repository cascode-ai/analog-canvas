import {
  createRoutePath,
  routeBends,
  routeEnd,
  routeModes,
  type Point,
  type RouteEndpoint,
  type RoutePresentation,
  type SegmentMode,
} from "@icm/model";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  deriveCrossings,
  deriveFlightlines,
  deriveImportedRoutingGuidance,
  resolveRouteGeometry,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { executeTransaction } from "./transaction.js";
import { isOrthogonal } from "./route-geometry-edit.js";
import { proposeWireSegmentDrag } from "./route-operations.js";
import {
  proposeGroupMoveEdits,
  proposeGroupReflectionEdits,
  proposeGroupRotationEdits,
  proposeEndpointRouteAttachment,
  proposeLooseRouteTranslation,
  proposePowerRailEndpointResize,
  proposePowerRailTranslation,
  proposeRouteEndpointMove,
  proposeWireIntent,
  proposeVisualRouteDeletion,
  proposeWireSegmentMove,
} from "./routing-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const context = { symbolResolver: resolver };

function routeEdit(input: {
  routeId: string;
  netId: string;
  from: RouteEndpoint;
  to: RouteEndpoint;
  waypoints: Point[];
  segmentModes: SegmentMode[];
  presentation?: RoutePresentation;
}) {
  return {
    kind: "set_route_path" as const,
    route: createRoutePath({
      id: input.routeId,
      netId: input.netId,
      start: input.from,
      end: input.to,
      bends: input.waypoints,
      modes: input.segmentModes,
      ...(input.presentation ? { presentation: input.presentation } : {}),
    }),
  };
}

function addNameClaim(
  document: ReturnType<typeof createEmptyDocument>,
  netId: string,
  name: string,
  scope: "local" | "global",
  powerDomain?: "vdd" | "ground",
): void {
  const annotationId = `test-net-label-${netId}`;
  document.annotations.push({
    id: annotationId,
    kind: powerDomain ? "power-label" : "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: `claim-${netId}`,
    kind: "name-claim",
    netId,
    name,
    owner: { kind: "net-label", annotationId },
    scope,
    ...(powerDomain ? { powerDomain } : {}),
  });
}

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
    document.nets.push({ id: "n1", terminals: [] });
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
        routeEdit({
          routeId: "wire-45",
          netId: "n1",
          from: { kind: "junction", junctionId: "J1" },
          to: { kind: "junction", junctionId: "J2" },
          waypoints: [],
          segmentModes: ["manual"],
        }),
      ]),
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && routeBends(result.document.routes[0]!)).toEqual([]);
  });

  it("gives Agent wire intent the same octilinear compiler", () => {
    const document = createEmptyDocument(
      "agent-octilinear",
      "Agent octilinear",
    );
    document.nets.push({ id: "n1", terminals: [] });
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
    const route = planned.edits.find((edit) => edit.kind === "set_route_path");
    expect(route).toMatchObject({
      route: {
        legs: [
          { to: { kind: "bend", position: { x: 60, y: 60 } } },
          { to: { kind: "endpoint" } },
        ],
      },
    });
  });

  it("rejects a Junction move that would leave an incident Route geometry stale", () => {
    const document = createEmptyDocument("junction-integrity", "Junction");
    document.nets.push({ id: "n1", terminals: [] });
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
    document.routes.push(
      createRoutePath({
        id: "wire-1",
        netId: "n1",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );

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

      terminals: [],
    });
    addNameClaim(document, "VDD", "VDD", "global", "vdd");
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
      createRoutePath({
        id: "rail-left",
        netId: "VDD",
        start: { kind: "junction", junctionId: "vdd-start" },
        end: { kind: "junction", junctionId: "vdd-tap" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
      createRoutePath({
        id: "rail-right",
        netId: "VDD",
        start: { kind: "junction", junctionId: "vdd-tap" },
        end: { kind: "junction", junctionId: "vdd-end" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
      createRoutePath({
        id: "branch",
        netId: "VDD",
        start: { kind: "junction", junctionId: "vdd-tap" },
        end: { kind: "junction", junctionId: "branch-end" },
        bends: [],
        modes: ["manual"],
      }),
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

      terminals: [],
    });
    addNameClaim(document, "VDD", "VDD", "global", "vdd");
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
    document.routes.push(
      createRoutePath({
        id: "vertical-rail-route",
        netId: "VDD",
        start: { kind: "junction", junctionId: "rail-top" },
        end: { kind: "junction", junctionId: "rail-bottom" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );
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
    document.routes.push(
      createRoutePath({
        id: "vdd-rail",
        netId: "VDD",
        start: { kind: "junction", junctionId: "vdd-start" },
        end: { kind: "junction", junctionId: "vdd-end" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );
    document.connectivityEvidence.push({
      id: "claim-VDD",
      kind: "name-claim",
      netId: "VDD",
      name: "VDD",
      owner: { kind: "power-marker", objectId: "vdd-end" },
      scope: "global",
      powerDomain: "vdd",
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
    document.annotations.push({
      id: "label-on-vdd-route",
      kind: "net-label",
      netId: "VDD",
      content: { runs: [{ kind: "text", value: "VDD" }] },
      anchor: {
        kind: "route",
        routeId: "vdd-rail",
        legId: document.routes.find((route) => route.id === "vdd-rail")!
          .legs[0]!.id,
        t: 0.5,
        normalOffset: 10,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 50, y: 10 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const rawCut = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "vdd-rail" },
      ]),
      context,
    );
    expect(rawCut).toMatchObject({
      ok: false,
      error: { code: "EDIT_PRECONDITION" },
    });

    const proposal = proposeVisualRouteDeletion(document, ["vdd-rail"], []);
    expect(proposal.annotationIds).toEqual(["label-on-vdd-route", "label-VDD"]);
    expect(
      proposal.edits.filter(
        (edit) => edit.kind === "remove_schematic_annotation",
      ),
    ).toHaveLength(2);
    const deleted = executeTransaction(
      document,
      transaction(document.id, 0, proposal.edits),
      context,
    );
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.document.annotations).toHaveLength(0);
    expect(deleted.document.routes).toHaveLength(0);
    expect(deleted.document.junctions).toHaveLength(0);
    expect(deleted.document.connectivityEvidence).toHaveLength(0);
    expect(deleted.document.nets).toHaveLength(0);
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    routed.document.connectivityEvidence.push({
      id: "claim-route-h",
      kind: "name-claim",
      netId: "net-h",
      name: "HORIZONTAL",
      owner: { kind: "power-marker", objectId: "route-h" },
      scope: "local",
    });
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
        expect.objectContaining({
          id: "route-h-a-e",
          legs: [
            expect.objectContaining({
              to: { kind: "endpoint", endpoint: terminal("E") },
            }),
          ],
        }),
        expect.objectContaining({ id: "route-h-b-e", start: terminal("E") }),
      ]),
    );
    expect(
      attached.document.connectivityEvidence.find(
        (evidence) => evidence.id === "claim-route-h",
      ),
    ).toMatchObject({
      owner: { kind: "power-marker", objectId: "route-h-a-e" },
    });
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
    expect(plan.edits.some((edit) => edit.kind === "set_route_path")).toBe(
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

  it("resizes a Junction-backed Route end through the shared Junction planner", () => {
    const document = createEmptyDocument("route-resize", "Route resize");
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      {
        id: "j1",
        netId: "net-1",
        position: { x: 0, y: 20 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net-1",
        position: { x: 100, y: 20 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const plan = proposeRouteEndpointMove(
      document,
      resolver,
      "route-1",
      "end",
      { x: 140, y: 20 },
    );
    expect(plan.edits).toEqual([
      {
        kind: "move_junction",
        junctionId: "j2",
        position: { x: 140, y: 20 },
      },
      expect.objectContaining({ kind: "set_route_path" }),
    ]);
    const resized = executeTransaction(
      document,
      transaction(document.id, 0, plan.edits),
      context,
    );
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(
      resolveRouteGeometry(
        resized.document,
        resolver,
        resized.document.routes[0]!,
      )?.centerline,
    ).toEqual([
      { x: 0, y: 20 },
      { x: 140, y: 20 },
    ]);
  });

  it("moves a three-way Junction with its dragged segment", () => {
    const document = createEmptyDocument("junction-follow", "Junction follow");
    document.nets.push({ id: "net-j", terminals: [] });
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
      createRoutePath({
        id: "route-main",
        netId: "net-j",
        start: { kind: "junction", junctionId: "junction-center" },
        end: { kind: "junction", junctionId: "junction-right" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-top",
        netId: "net-j",
        start: { kind: "junction", junctionId: "junction-top" },
        end: { kind: "junction", junctionId: "junction-center" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-left",
        netId: "net-j",
        start: { kind: "junction", junctionId: "junction-left" },
        end: { kind: "junction", junctionId: "junction-center" },
        bends: [],
        modes: ["manual"],
      }),
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

  it("drags a junction-tapped slanted leg by its dominant axis and restores orthogonality", () => {
    // The reported shelf circuit: a tap Junction on a horizontal net, and a
    // nearly vertical leg (Δx = 40, Δy ≈ 130) dropping to a pin. Dragging
    // that leg sideways must slide the Junction along its host wire, land
    // the leg vertical at the target x, and dogleg into the unmoved pin —
    // repairing the slant instead of refusing the drag.
    const document = documentFixture();
    document.junctions.push({
      id: "junction-tap",
      netId: "net-h",
      position: { x: 300, y: 300 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-host-a",
        netId: "net-h",
        start: terminal("A"),
        end: { kind: "junction", junctionId: "junction-tap" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-host-b",
        netId: "net-h",
        start: { kind: "junction", junctionId: "junction-tap" },
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-slant",
        netId: "net-h",
        start: { kind: "junction", junctionId: "junction-tap" },
        end: terminal("E"),
        bends: [],
        modes: ["manual"],
      }),
    );
    const plan = proposeWireSegmentMove(document, resolver, "route-slant", 0, {
      x: 260,
      y: 370,
    });
    const moved = executeTransaction(
      document,
      transaction(document.id, 0, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.document.junctions.find(
        (junction) => junction.id === "junction-tap",
      )?.position,
    ).toEqual({ x: 260, y: 300 });
    for (const route of moved.document.routes) {
      expect(
        resolveRouteGeometry(moved.document, resolver, route)?.centerline,
      ).toSatisfy((points: Array<{ x: number; y: number }>) =>
        isOrthogonal(points),
      );
    }
  });

  it("doglegs a slanted leg between two pins at the dragged coordinate", () => {
    // Both endpoints hard (pins), horizontal-dominant slant: the connector
    // must become orthogonal through the dragged y, with jogs at the
    // unmoved pins.
    const document = documentFixture();
    document.routes.push(
      createRoutePath({
        id: "route-slant-2",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("E"),
        bends: [],
        modes: ["manual"],
      }),
    );
    const before = resolveRouteGeometry(
      document,
      resolver,
      document.routes.find((route) => route.id === "route-slant-2")!,
    )!.centerline;
    const slantIndex = before.findIndex(
      (point, index) =>
        index + 1 < before.length &&
        point.x !== before[index + 1]!.x &&
        point.y !== before[index + 1]!.y,
    );
    expect(slantIndex).toBeGreaterThanOrEqual(0);
    const plan = proposeWireSegmentMove(
      document,
      resolver,
      "route-slant-2",
      slantIndex,
      { x: 240, y: 360 },
    );
    const moved = executeTransaction(
      document,
      transaction(document.id, 0, plan.edits),
      context,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const centerline = resolveRouteGeometry(
      moved.document,
      resolver,
      moved.document.routes.find((route) => route.id === "route-slant-2")!,
    )?.centerline;
    expect(centerline).toSatisfy((points: Array<{ x: number; y: number }>) =>
      isOrthogonal(points),
    );
    expect(centerline?.some((point) => point.y === 360)).toBe(true);
  });

  it("authors every planned internal Route so group geometry is order-independent", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
        .filter((edit) => edit.kind === "set_route_path")
        .map((edit) => edit.route.id),
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
    document.nets.push({ id: "n1", terminals: [] });
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
    const wire = (id: string, from: string, to: string) =>
      routeEdit({
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
    for (const instance of document.instances.filter(
      (candidate) => !["A", "B"].includes(candidate.id),
    )) {
      if (instance.placement) instance.placement.position.x += 1_000;
    }
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

  it("flips a multi-part selection as one body about its own axis", () => {
    const document = documentFixture();
    // A and B sit side by side on y=300. Flipping left to right has to
    // exchange them, not leave each where it was wearing a mirror bit.
    const plan = proposeGroupReflectionEdits(
      document,
      resolver,
      ["A", "B"],
      "left-right",
    );
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
    expect(placement("A").position).toEqual({ x: 460, y: 300 });
    expect(placement("B").position).toEqual({ x: 140, y: 300 });
    // Across the other axis they do not move: the flip is about one axis.
    expect(placement("A").position.y).toBe(300);
  });

  it("flips a quarter each way back to where it started", () => {
    const document = documentFixture();
    const ids = ["A", "B", "C"];
    let current = document;
    for (const pass of [0, 1]) {
      const applied = executeTransaction(
        current,
        transaction(
          current.id,
          current.revision,
          proposeGroupReflectionEdits(current, resolver, ids, "top-bottom")
            .edits,
        ),
        context,
      );
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      current = applied.document;
      expect(pass).toBeLessThan(2);
    }
    for (const id of ids) {
      const original = document.instances.find(
        (instance) => instance.id === id,
      )!.placement!;
      const restored = current.instances.find(
        (instance) => instance.id === id,
      )!.placement!;
      expect(restored.position).toEqual(original.position);
      expect(restored.rotation).toBe(original.rotation);
      expect(restored.mirror).toBe(original.mirror);
    }
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
      createRoutePath({
        id: "route-h-left",
        netId: "net-h",
        start: terminal("A"),
        end: { kind: "junction", junctionId: "junction-h" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-h-right",
        netId: "net-h",
        start: { kind: "junction", junctionId: "junction-h" },
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
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
        .filter((edit) => edit.kind === "set_route_path")
        .map((edit) => edit.route.id),
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
    expect(routeModes(route)[0]).toBe("escape");
    expect(routeModes(route).at(-1)).toBe("escape");
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
      ]),
      context,
    );
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;

    const plan = proposeGroupMoveEdits(routed.document, resolver, [
      { instanceId: "A", position: { x: 160, y: 320 } },
    ]);
    // B holds an east/west lead like A, so a single corner would have to turn
    // up out of A's lead or in across B's. The crossbar keeps both ends on
    // their own leads and leaves B's contact point where it was.
    expect(plan.preview.routes).toEqual([
      {
        routeId: "route-h",
        waypoints: [
          { x: 310, y: 320 },
          { x: 310, y: 300 },
        ],
        segmentModes: ["manual", "manual", "manual"],
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
      { x: 310, y: 320 },
      { x: 310, y: 300 },
      { x: 450, y: 300 },
    ]);
  });

  it("moves a net label with its reshaped wire segment", () => {
    const document = documentFixture();
    const routed = executeTransaction(
      document,
      transaction(document.id, 0, [
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
        legId: routed.document.routes.find((route) => route.id === "route-h")!
          .legs[0]!.id,
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [
            { x: 150, y: 340 },
            { x: 450, y: 340 },
          ],
          segmentModes: ["manual", "manual", "manual"],
        }),
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
      // Conductor lands on y=340; the persisted -8 normal offset survives
      // verbatim (the old 330 expectation encoded the coarse-grid snap the
      // follow no longer applies).
      anchor: { fallbackPosition: { x: 300, y: 332 } },
      rotation: 0,
    });
    expect(reshaped.diff.changedObjectIds).toEqual(
      expect.arrayContaining(["route-h", "net-label-route-h"]),
    );
  });

  it("remaps a current marker by physical location when route segments change", () => {
    const document = documentFixture();
    document.routes = [
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
    ];
    document.annotations.push({
      id: "current-route-h",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-h",
        legId: document.routes[0]!.legs[0]!.id,
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
        routeEdit({
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
        }),
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
        legId: complex.document.routes[0]!.legs[3]!.id,
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
      anchor: {
        legId: simple.document.routes[0]!.legs[0]!.id,
        t: 0.5,
      },
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
      // A and B both carry east/west leads, so the stretched segment leaves A
      // along its lead and arrives at B along B's rather than turning up into
      // B's side, which would have laid the wire across the port artwork.
    ).toEqual([
      { x: 170, y: 320 },
      { x: 310, y: 320 },
      { x: 310, y: 300 },
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
      { x: 310, y: 330 },
      { x: 310, y: 300 },
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
      { x: 310, y: 310 },
      { x: 310, y: 300 },
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
        routeEdit({
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
        }),
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
        routeEdit({
          routeId: "route-h",
          netId: "net-h",
          from: terminal("A"),
          to: terminal("B"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
        routeEdit({
          routeId: "route-v",
          netId: "net-v",
          from: terminal("C"),
          to: terminal("D"),
          waypoints: [],
          segmentModes: ["manual"],
        }),
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
    addNameClaim(document, "net-h", "HORIZONTAL", "global");

    expect(deriveFlightlines(document, resolver)).not.toContainEqual(
      expect.objectContaining({ netId: "net-h" }),
    );
  });

  it("atomically splits a route through an explicit Junction", () => {
    const document = documentFixture();
    document.routes = [
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
    ];
    document.annotations.push({
      id: "current-split",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I_x" }] },
      anchor: {
        kind: "route",
        routeId: "route-h",
        legId: document.routes[0]!.legs[0]!.id,
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
            legId: document.routes[0]!.legs[0]!.id,
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
    expect(routeEnd(result.document.routes[0]!)).toEqual({
      kind: "junction",
      junctionId: "junction-h",
    });
    expect(result.document.routes[1]!.start).toEqual({
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
        legId: result.document.routes.find((route) => route.id === "route-h-b")!
          .legs[0]!.id,
        t: 0.5,
        normalOffset: -14,
      },
    });
  });

  it("materializes a Junction at an existing orthogonal bend without a zero-length segment", () => {
    const document = documentFixture();
    document.routes = [
      createRoutePath({
        id: "route-bend",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [
          { x: 150, y: 200 },
          { x: 450, y: 200 },
        ],
        modes: ["manual", "manual", "manual"],
      }),
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
            legId: document.routes[0]!.legs[0]!.id,
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

  it("rejects a Junction dot that would join conflicting crossing Nets", () => {
    const document = documentFixture();
    addNameClaim(document, "net-h", "HORIZONTAL", "local");
    addNameClaim(document, "net-v", "VERTICAL", "local");
    document.routes = [
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-v",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [],
        modes: ["manual"],
      }),
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
            legId: document.routes[0]!.legs[0]!.id,
          },
        },
      ]),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESULT",
        message: "Transaction introduces conflicting Logical Net names",
      },
    });
  });

  it("accepts an arbitrary-angle route and still needs its context", () => {
    const document = documentFixture();
    const diagonal = transaction(document.id, 0, [
      routeEdit({
        routeId: "route-diagonal",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("E"),
        waypoints: [],
        segmentModes: ["manual"],
      }),
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
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["locked"],
      }),
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
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
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
      createRoutePath({
        id: "route-v",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [],
        modes: ["manual"],
      }),
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

  it("retargets each Cell Pin interface when a Wire cut partitions its Base Net", () => {
    const document = createEmptyDocument("cell-pin-cut", "Cell pin cut");
    document.instances.push(
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P2",
        symbolId: "port",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 180,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-interface",
      terminals: [
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push(
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-interface",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-out",
        name: "OUT",
        netId: "net-interface",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-interface",
        netId: "net-interface",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "terminal", instanceId: "P2", pinName: "P" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-interface" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets).toHaveLength(2);
    for (const cellTerminal of result.document.netlist!.terminals) {
      const markerNet = result.document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            cellTerminal.interfaceInstanceIds.includes(terminal.instanceId) &&
            terminal.pinName === "P",
        ),
      );
      expect(cellTerminal.netId).toBe(markerNet?.id);
    }
  });

  it("does not couple same-named Cell Pins when a route is cut", () => {
    const document = createEmptyDocument(
      "independent-cell-pin-cut",
      "Independent Cell pin cut",
    );
    document.instances.push(
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P2",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 300 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-vin",
      terminals: [
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
        { instanceId: "R1", pinName: "1" },
      ],
    });
    document.netlist!.terminals.push(
      {
        id: "terminal-vin-1",
        name: "VIN",
        netId: "net-vin",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-vin-2",
        name: "vin",
        netId: "net-vin",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-vin-r1",
        netId: "net-vin",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "terminal", instanceId: "R1", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-vin-r1" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const netOf = (instanceId: string) =>
      result.document.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === instanceId),
      );
    const first = result.document.netlist!.terminals.find(
      (terminal) => terminal.id === "terminal-vin-1",
    )!;
    const second = result.document.netlist!.terminals.find(
      (terminal) => terminal.id === "terminal-vin-2",
    )!;
    expect(first.netId).toBe(netOf("P1")?.id);
    expect(second.netId).toBe(netOf("P2")?.id);
    expect(first.netId).not.toBe(second.netId);
    expect(netOf("R1")?.id).not.toBe(first.netId);
    expect(netOf("R1")?.id).not.toBe(second.netId);
  });

  it("removes redundant cycle geometry without splitting the Net", () => {
    const document = documentFixture();
    document.routes = [
      createRoutePath({
        id: "route-v-direct",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-v-loop",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [
          { x: 340, y: 100 },
          { x: 340, y: 500 },
        ],
        modes: ["manual", "manual", "manual"],
      }),
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
      createRoutePath({
        id: "route-free",
        netId: "net-free",
        start: { kind: "junction", junctionId: "junction-free-a" },
        end: { kind: "junction", junctionId: "junction-free-b" },
        bends: [],
        modes: ["manual"],
      }),
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

  it("physically splits an imported Net while preserving non-electrical source provenance on every component", () => {
    const document = documentFixture();
    // Keep formal Port names distinct so the assertion isolates source
    // provenance. Equal Port names are independently authoritative and would
    // intentionally keep these Base Nets in one Logical Net after the cut.
    document.netlist!.terminals.find(
      (terminal) => terminal.id === "cell-terminal-b",
    )!.name = "P2";
    document.netlist!.terminals.find(
      (terminal) => terminal.id === "cell-terminal-e",
    )!.name = "P5";
    document.connectivityEvidence.push({
      id: "source-net-h",
      kind: "spice-source",
      netId: "net-h",
      sourceNetId: "source-horizontal",
    });
    document.routes = [
      createRoutePath({
        id: "route-partial",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
    ];

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-partial" },
      ]),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(
      result.document.nets.find((net) => net.id === "net-h")?.terminals,
    ).toEqual([{ instanceId: "A", pinName: "P" }]);
    expect(
      result.document.nets
        .filter((net) =>
          net.terminals.some((terminal) =>
            ["A", "B", "E"].includes(terminal.instanceId),
          ),
        )
        .map((net) => net.terminals.map((terminal) => terminal.instanceId)),
    ).toEqual([["A"], ["B"], ["E"]]);
    const splitNetIds = result.document.nets
      .filter((candidate) =>
        candidate.terminals.some((terminal) =>
          ["A", "B", "E"].includes(terminal.instanceId),
        ),
      )
      .map((candidate) => candidate.id)
      .sort();
    expect(
      result.document.connectivityEvidence
        .flatMap((evidence) =>
          evidence.kind === "spice-source" &&
          evidence.sourceNetId === "source-horizontal"
            ? [evidence.netId]
            : [],
        )
        .sort(),
    ).toEqual(splitNetIds);
    expect(
      resolveDocumentLogicalNets(result.document).groups.filter((group) =>
        group.sourceNetIds.includes("source-horizontal"),
      ),
    ).toHaveLength(3);
    expect(deriveFlightlines(result.document, resolver)).toHaveLength(1);
    expect(
      deriveImportedRoutingGuidance(result.document, resolver),
    ).toHaveLength(2);
    expect(result.document.sourceStatus).toBe("connectivity-modified");
  });

  it("keeps a default-bound hidden bulk with the supply authority after an imported Net split", () => {
    const document = createEmptyDocument("bulk-split", "Bulk Split");
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        mosBulkBinding: { origin: "cell-default", netId: "net-vss" },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 200, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "A",
        symbolId: "resistor",
        placement: {
          position: { x: 400, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "B",
        symbolId: "resistor",
        placement: {
          position: { x: 600, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-vss",
      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "GND1", pinName: "P" },
        { instanceId: "A", pinName: "1" },
        { instanceId: "B", pinName: "1" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-a-b",
        netId: "net-vss",
        start: { kind: "terminal", instanceId: "A", pinName: "1" },
        end: { kind: "terminal", instanceId: "B", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.connectivityEvidence.push(
      {
        id: "claim-ground",
        kind: "name-claim",
        netId: "net-vss",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND1" },
      },
      {
        id: "source-vss",
        kind: "spice-source",
        netId: "net-vss",
        sourceNetId: "source-vss",
      },
    );
    document.mosBulkDefaults = { nmosNetId: "net-vss" };

    const result = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-a-b" },
      ]),
      context,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const defaultNetId = result.document.mosBulkDefaults?.nmosNetId;
    const defaultNet = result.document.nets.find(
      (net) => net.id === defaultNetId,
    );
    expect(defaultNet?.terminals).toEqual(
      expect.arrayContaining([
        { instanceId: "GND1", pinName: "P" },
        { instanceId: "M1", pinName: "B" },
      ]),
    );
    expect(
      result.document.instances.find((instance) => instance.id === "M1")
        ?.mosBulkBinding,
    ).toEqual({ origin: "cell-default", netId: defaultNetId });
    expect(
      result.document.nets.filter((net) =>
        net.terminals.some(
          (item) => item.instanceId === "M1" && item.pinName === "B",
        ),
      ),
    ).toHaveLength(1);
  });

  it("deletes an entire split bulk route family and restores the default without orphaning ordinary wire", () => {
    const document = createEmptyDocument("bulk-delete", "Bulk Delete");
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        mosBulkBinding: { origin: "cell-default", netId: "net-vss" },
      },
      {
        id: "GND1",
        symbolId: "ground",
        placement: {
          position: { x: 300, y: 110 },
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
    document.junctions.push(
      { id: "J1", netId: "net-vss", position: { x: 150, y: 100 } },
      { id: "J2", netId: "net-vss", position: { x: 200, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "bulk-near",
        netId: "net-vss",
        start: { kind: "terminal", instanceId: "M1", pinName: "B" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [{ x: 100, y: 100 }],
        modes: ["escape", "manual"],
        presentation: "bulk-dashed",
      }),
      createRoutePath({
        id: "bulk-distal",
        netId: "net-vss",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
        presentation: "bulk-dashed",
      }),
      createRoutePath({
        id: "route-ui-112",
        netId: "net-vss",
        start: { kind: "junction", junctionId: "J2" },
        end: { kind: "terminal", instanceId: "GND1", pinName: "0" },
        bends: [],
        modes: ["manual"],
      }),
    );
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

    const deletion = proposeVisualRouteDeletion(document, ["bulk-distal"], []);
    expect(deletion.routeIds).toEqual(["bulk-distal", "bulk-near"]);
    const result = executeTransaction(
      document,
      transaction(document.id, 0, deletion.edits),
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toMatchObject([{ id: "route-ui-112" }]);
    const defaultNetId = result.document.mosBulkDefaults?.nmosNetId;
    expect(
      result.document.instances.find((instance) => instance.id === "M1")
        ?.mosBulkBinding,
    ).toEqual({ origin: "cell-default", netId: defaultNetId });
    expect(
      result.document.nets.find((net) => net.id === defaultNetId)?.terminals,
    ).toEqual(
      expect.arrayContaining([
        { instanceId: "M1", pinName: "B" },
        { instanceId: "GND1", pinName: "0" },
      ]),
    );
  });

  it("keeps an imported global declaration only on the primary component after a cut", () => {
    const document = documentFixture();
    const net = document.nets.find((candidate) => candidate.id === "net-v")!;
    document.netlist!.terminals.find(
      (terminal) => terminal.id === "cell-terminal-c",
    )!.name = "LEFT";
    document.netlist!.terminals.find(
      (terminal) => terminal.id === "cell-terminal-d",
    )!.name = "RIGHT";
    document.connectivityEvidence.push(
      {
        id: "imported-global-vdd",
        kind: "name-claim",
        netId: net.id,
        name: "VDD",
        scope: "global",
        owner: {
          kind: "global-declaration",
          sourceNetId: "source-vdd",
        },
      },
      {
        id: "source-vdd",
        kind: "spice-source",
        netId: net.id,
        sourceNetId: "source-vdd",
      },
      {
        id: "source-vdd-name",
        kind: "net-name-hint",
        netId: net.id,
        sourceName: "VDD",
        origin: "spice-import",
      },
    );
    document.routes = [
      createRoutePath({
        id: "route-global",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [],
        modes: ["manual"],
      }),
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
      result.document.nets.find((candidate) => candidate.id === "net-v")
        ?.terminals,
    ).toEqual([{ instanceId: "C", pinName: "P" }]);
    expect(
      result.document.nets.find((candidate) =>
        candidate.terminals.some((terminal) => terminal.instanceId === "D"),
      ),
    ).toMatchObject({ terminals: [{ instanceId: "D" }] });
    const splitNetIds = result.document.nets
      .filter((candidate) =>
        candidate.terminals.some((terminal) =>
          ["C", "D"].includes(terminal.instanceId),
        ),
      )
      .map((candidate) => candidate.id)
      .sort();
    expect(
      result.document.connectivityEvidence.flatMap((evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "global-declaration"
          ? [evidence.netId]
          : [],
      ),
    ).toEqual(["net-v"]);
    for (const kind of ["spice-source", "net-name-hint"] as const) {
      expect(
        result.document.connectivityEvidence
          .filter((evidence) => evidence.kind === kind)
          .map((evidence) => evidence.netId)
          .filter((netId) => splitNetIds.includes(netId))
          .sort(),
      ).toEqual(splitNetIds);
    }
    const logicalNets = resolveDocumentLogicalNets(result.document);
    const left = logicalNets.byBaseNetId.get("net-v");
    const rightNetId = splitNetIds.find((netId) => netId !== "net-v")!;
    const right = logicalNets.byBaseNetId.get(rightNetId);
    expect(left).toMatchObject({ name: "VDD", scope: "global" });
    expect(right).toMatchObject({ scope: "local" });
    expect(right?.name).toBe("RIGHT");
    expect(left?.id).not.toBe(right?.id);
    expect(result.document.sourceStatus).toBe("connectivity-modified");
  });

  it("allows a signal detached from Ground to be reconnected to VDD", () => {
    const document = createEmptyDocument(
      "power-reassignment-after-cut",
      "Power reassignment after cut",
    );
    document.instances.push(
      { id: "GND1", symbolId: "ground", placement: null },
      { id: "SIG", symbolId: "resistor", placement: null },
      { id: "VDD1", symbolId: "vdd-port", placement: null },
    );
    document.nets.push(
      {
        id: "net-ground",
        terminals: [
          { instanceId: "GND1", pinName: "0" },
          { instanceId: "SIG", pinName: "1" },
        ],
      },
      {
        id: "net-vdd",
        terminals: [{ instanceId: "VDD1", pinName: "P" }],
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-ground-signal",
        netId: "net-ground",
        start: { kind: "terminal", instanceId: "GND1", pinName: "0" },
        end: { kind: "terminal", instanceId: "SIG", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.connectivityEvidence.push(
      {
        id: "claim-ground",
        kind: "name-claim",
        netId: "net-ground",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND1" },
      },
      {
        id: "claim-vdd",
        kind: "name-claim",
        netId: "net-vdd",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
      },
    );

    const cut = executeTransaction(
      document,
      transaction(document.id, 0, [
        { kind: "cut_connection", routeId: "route-ground-signal" },
      ]),
    );
    if (!cut.ok) {
      throw new Error(
        JSON.stringify({ error: cut.error, diagnostics: cut.diagnostics }),
      );
    }

    const signalNet = cut.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === "SIG" && terminal.pinName === "1",
      ),
    );
    expect(signalNet).toBeDefined();
    expect(
      resolveDocumentLogicalNets(cut.document).byBaseNetId.get(signalNet!.id)
        ?.powerDomain,
    ).toBe("none");
    expect(
      cut.document.connectivityEvidence.find(
        (evidence) => evidence.id === "claim-ground",
      ),
    ).toMatchObject({ netId: "net-ground" });

    const reconnected = executeTransaction(
      cut.document,
      transaction(cut.document.id, cut.document.revision, [
        {
          kind: "merge_nets",
          targetNetId: "net-vdd",
          sourceNetId: signalNet!.id,
        },
      ]),
    );
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(
      resolveDocumentLogicalNets(reconnected.document).byBaseNetId.get(
        "net-vdd",
      )?.powerDomain,
    ).toBe("vdd");
  });
});
