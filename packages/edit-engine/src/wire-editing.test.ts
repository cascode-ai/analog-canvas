import { routeBends, routeEnd, type RouteEndpoint } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeWireCommit,
  proposeWireCommitThroughContacts,
} from "./routing-planner.js";
import type { WireSource } from "./routing-planner.js";

function source(
  endpoint: RouteEndpoint,
  point: { x: number; y: number },
  netId: string | null = null,
  routePresentation?: WireSource["routePresentation"],
): WireSource {
  return {
    endpoint,
    connection: {
      endpoint,
      contactPoint: point,
      gridLanding: point,
      escapePath: [],
      outward: null,
    },
    netId,
    preludeEdits: [],
    ...(routePresentation ? { routePresentation } : {}),
  };
}

describe("wire editing proposals", () => {
  it("persists a grid landing and marks only the artwork lead as escape", () => {
    const endpoint = {
      kind: "terminal" as const,
      instanceId: "M1",
      pinName: "B",
    };
    const from: WireSource = {
      endpoint,
      netId: null,
      preludeEdits: [],
      routePresentation: "bulk-dashed",
      connection: {
        endpoint,
        contactPoint: { x: 96, y: 100 },
        gridLanding: { x: 100, y: 100 },
        escapePath: [
          { x: 96, y: 100 },
          { x: 100, y: 100 },
        ],
        outward: { x: 1, y: 0 },
      },
    };
    const to = createFreeWireAnchor({ x: 180, y: 140 }, "net-bulk", true, 31);
    const proposal = proposeWireCommit(from, to, [], 32);
    const route = proposal.edits.find((edit) => edit.kind === "set_route_path");

    expect(route).toMatchObject({
      kind: "set_route_path",
      route: expect.objectContaining({ presentation: "bulk-dashed" }),
    });
    expect(
      route?.kind === "set_route_path" &&
        routeBends(route.route).every(
          (point) => point.x % 10 === 0 && point.y % 10 === 0,
        ),
    ).toBe(true);
  });

  it("orders anchor preludes before merging existing nets", () => {
    const from = createFreeWireAnchor({ x: 0, y: 0 }, "net-a", false, 3);
    const to = createFreeWireAnchor({ x: 40, y: 0 }, "net-b", false, 4);
    const proposal = proposeWireCommit(from, to, [], 5);

    expect(proposal.netId).toBe("net-a");
    expect(proposal.edits.map((edit) => edit.kind)).toEqual([
      "add_junction",
      "add_junction",
      "merge_nets",
      "connect_endpoints",
      "set_route_path",
    ]);
    expect(proposal.edits[2]).toEqual({
      kind: "merge_nets",
      targetNetId: "net-a",
      sourceNetId: "net-b",
    });
    expect(proposal.edits[3]).not.toHaveProperty("newNetId");
  });

  it("commits coincident endpoints as direct contact without a Route", () => {
    const from = source(
      { kind: "terminal", instanceId: "X1", pinName: "2" },
      { x: 520, y: 200 },
      "net-contact",
    );
    const to = source(
      { kind: "terminal", instanceId: "P1", pinName: "P" },
      { x: 520, y: 200 },
      "net-contact",
    );

    const proposal = proposeWireCommit(from, to, [], 6);

    expect(proposal.edits).toEqual([
      { kind: "connect_endpoints", from: from.endpoint, to: to.endpoint },
    ]);
  });

  it("does not short another pin on a selected endpoint device", () => {
    const from = source(
      { kind: "terminal", instanceId: "R1", pinName: "2" },
      { x: 0, y: 0 },
    );
    const to = source(
      { kind: "terminal", instanceId: "R2", pinName: "1" },
      { x: 80, y: 40 },
    );
    const proposal = proposeWireCommitThroughContacts(
      from,
      to,
      [],
      [
        source(
          { kind: "terminal", instanceId: "R2", pinName: "2" },
          { x: 80, y: 0 },
        ),
        source(
          { kind: "terminal", instanceId: "C1", pinName: "1" },
          { x: 40, y: 0 },
        ),
      ],
      14,
    );

    const routed = proposal.edits.filter(
      (edit) => edit.kind === "set_route_path",
    );
    expect(routed).toHaveLength(2);
    expect(routed).toEqual([
      expect.objectContaining({
        route: expect.objectContaining({ start: from.endpoint }),
      }),
      expect.objectContaining({
        route: expect.objectContaining({
          start: { kind: "terminal", instanceId: "C1", pinName: "1" },
        }),
      }),
    ]);
    expect(routeEnd(routed[0]!.route)).toEqual({
      kind: "terminal",
      instanceId: "C1",
      pinName: "1",
    });
    expect(routeEnd(routed[1]!.route)).toEqual(to.endpoint);
    expect(
      proposal.edits.some(
        (edit) =>
          edit.kind === "connect_endpoints" &&
          [edit.from, edit.to].some(
            (endpoint) =>
              endpoint.kind === "terminal" &&
              endpoint.instanceId === "R2" &&
              endpoint.pinName === "2",
          ),
      ),
    ).toBe(false);
  });
});
