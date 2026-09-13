import { createRoutePath, routeBends, routeModes } from "@icm/model";
import {
  createEmptyDocument,
  reflectOrientation,
  type ScreenFlip,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import type { SchematicEdit } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function bulkDocument() {
  const document = createEmptyDocument("bulk-follow", "Bulk follow");
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    symbolVariantId: "textbook-3terminal",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  });
  document.nets.push({
    id: "body",
    terminals: [{ instanceId: "M1", pinName: "B" }],
  });
  document.junctions.push({
    id: "J1",
    netId: "body",
    position: { x: 180, y: 100 },
  });
  document.routes.push(
    createRoutePath({
      id: "body-route",
      netId: "body",
      start: { kind: "terminal", instanceId: "M1", pinName: "B" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [{ x: 100, y: 100 }],
      modes: ["escape", "manual"],
      presentation: "bulk-dashed",
    }),
  );
  return document;
}

function execute(edit: SchematicEdit) {
  const document = bulkDocument();
  return executeTransaction(
    document,
    {
      transactionId: `bulk-${edit.kind}`,
      documentId: document.id,
      expectedRevision: 0,
      actor: { kind: "human", id: "test" },
      edits: [edit],
    },
    { symbolResolver: resolver },
  );
}

function reflectInstance(
  document: ReturnType<typeof createEmptyDocument>,
  direction: ScreenFlip,
  suffix: string,
) {
  const before = document.instances.find(
    (instance) => instance.id === "M1",
  )!.placement!;
  const reflected = reflectOrientation(before, direction);
  return executeTransaction(
    document,
    {
      transactionId: `reflect-${suffix}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "mirror_instance",
          instanceId: "M1",
          mirror: reflected.mirror,
        },
        ...(reflected.rotation === before.rotation
          ? []
          : [
              {
                kind: "rotate_instance" as const,
                instanceId: "M1",
                rotation: reflected.rotation,
              },
            ]),
      ],
    },
    { symbolResolver: resolver },
  );
}

function gateRouteDocument(symbolId: "nmos" | "pmos") {
  const document = createEmptyDocument(
    `connected-${symbolId}`,
    "Connected MOS reflection",
  );
  document.instances.push({
    id: "M1",
    symbolId,
    symbolVariantId: "textbook-3terminal",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  });
  document.nets.push({
    id: "signal",
    terminals: [{ instanceId: "M1", pinName: "G" }],
  });
  document.junctions.push({
    id: "J1",
    netId: "signal",
    position: { x: 120, y: 100 },
  });
  document.routes.push(
    createRoutePath({
      id: "gate-route",
      netId: "signal",
      start: { kind: "terminal", instanceId: "M1", pinName: "G" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

describe("EndpointConnection transform lifecycle", () => {
  it.each(["nmos", "pmos"] as const)(
    "keeps a connected %s Route persistable after a direct 45-degree turn",
    (symbolId) => {
      const document = gateRouteDocument(symbolId);
      const result = executeTransaction(
        document,
        {
          transactionId: `turn-${symbolId}-45`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "rotate_instance",
              instanceId: "M1",
              rotation: 45,
            },
          ],
        },
        { symbolResolver: resolver },
      );

      expect(
        result,
        result.ok
          ? ""
          : JSON.stringify({
              error: result.error,
              diagnostics: result.diagnostics,
            }),
      ).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.document.instances[0]!.placement?.rotation).toBe(45);
      expect(
        routeBends(result.document.routes[0]!).every(
          (point) =>
            Number.isInteger(point.x) &&
            Number.isInteger(point.y) &&
            point.x % document.presentation.grid === 0 &&
            point.y % document.presentation.grid === 0,
        ),
      ).toBe(true);
    },
  );

  it.each(["nmos", "pmos"] as const)(
    "follows a connected %s Route once at the final reflected pose",
    (symbolId) => {
      const document = gateRouteDocument(symbolId);
      const result = reflectInstance(document, "top-bottom", "atomic");
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.document.routes).toEqual(document.routes);
    },
  );

  it.each(["nmos", "pmos"] as const)(
    "replaces a collapsed %s Route with direct contact and restores wiring",
    (symbolId) => {
      const document = gateRouteDocument(symbolId);
      const collapsed = reflectInstance(document, "left-right", "collapse");
      expect(collapsed).toMatchObject({ ok: true });
      if (!collapsed.ok) return;
      expect(collapsed.document.routes).toEqual([]);

      const restored = reflectInstance(
        collapsed.document,
        "left-right",
        "restore",
      );
      expect(restored).toMatchObject({ ok: true });
      if (!restored.ok) return;
      expect(restored.document.routes).toHaveLength(1);
      expect(restored.document.routes[0]!.legs).toHaveLength(
        routeBends(restored.document.routes[0]!).length + 1,
      );
    },
  );

  it("refuses to collapse referenced Route geometry without losing its annotation", () => {
    const document = gateRouteDocument("pmos");
    document.annotations.push({
      id: "gate-label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "signal" },
      anchor: {
        kind: "route",
        routeId: "gate-route",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.5,
        normalOffset: 0,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 100, y: 100 },
      },
      netId: "signal",
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

    const result = reflectInstance(
      document,
      "left-right",
      "referenced-collapse",
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "EDIT_PRECONDITION",
        message: expect.stringContaining("gate-label still references it"),
      },
    });
    expect(result.document).toEqual(document);
  });

  it("round-trips the attached PMOS/VDD Route topology", () => {
    const document = createEmptyDocument(
      "pmos-vdd-debug",
      "Attached PMOS/VDD Route",
    );
    document.instances.push(
      {
        id: "M1",
        symbolId: "pmos",
        symbolVariantId: "textbook-3terminal",
        placement: {
          position: { x: 260, y: 190 },
          rotation: 0,
          mirror: "horizontal",
        },
        mosBulkBinding: {
          netId: "net-vdd",
          origin: "cell-default",
        },
      },
      {
        id: "VDD1",
        symbolId: "vdd-port",
        placement: {
          position: { x: 270, y: 150 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "M1", pinName: "S" },
        { instanceId: "M1", pinName: "B" },
        { instanceId: "VDD1", pinName: "P" },
      ],
    });
    document.routes.push(
      createRoutePath({
        id: "route-99c5b7423f110b2d",
        netId: "net-vdd",
        start: { kind: "terminal", instanceId: "M1", pinName: "S" },
        end: { kind: "terminal", instanceId: "VDD1", pinName: "P" },
        bends: [],
        modes: ["manual"],
      }),
    );

    for (const direction of ["left-right", "top-bottom"] as const) {
      const result = reflectInstance(document, direction, direction);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      for (const route of result.document.routes) {
        expect(route.legs).toHaveLength(routeBends(route).length + 1);
      }
      const restored = reflectInstance(
        result.document,
        direction,
        `${direction}-restore`,
      );
      expect(restored).toMatchObject({ ok: true });
      if (!restored.ok) continue;
      for (const route of restored.document.routes) {
        expect(route.legs).toHaveLength(routeBends(route).length + 1);
      }
    }
  });

  it("routes the advanced Agent orthogonal edit through the same grid landing", () => {
    const document = bulkDocument();
    document.routes = [];
    const result = executeTransaction(
      document,
      {
        transactionId: "bulk-route-orthogonal",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "route_orthogonal",
            routeId: "body-route-agent",
            netId: "body",
            from: { kind: "terminal", instanceId: "M1", pinName: "B" },
            to: { kind: "junction", junctionId: "J1" },
            presentation: "bulk-dashed",
          },
        ],
      },
      { symbolResolver: resolver },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const route = result.document.routes[0]!;
    expect(routeModes(route)[0]).toBe("escape");
    expect(
      routeBends(route).every(
        (point) => point.x % 10 === 0 && point.y % 10 === 0,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "move",
      { kind: "move_instance", instanceId: "M1", position: { x: 120, y: 120 } },
      { x: 120, y: 120 },
    ],
    [
      "rotate",
      { kind: "rotate_instance", instanceId: "M1", rotation: 90 },
      { x: 100, y: 100 },
    ],
    [
      "mirror",
      { kind: "mirror_instance", instanceId: "M1", mirror: "horizontal" },
      { x: 100, y: 100 },
    ],
  ] as const)(
    "keeps the bulk landing on-grid after %s",
    (_name, edit, landing) => {
      const result = execute(edit);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      const route = result.document.routes.find(
        (candidate) => candidate.id === "body-route",
      )!;
      expect(routeBends(route)[0]).toEqual(landing);
      expect(routeModes(route)[0]).toBe("escape");
      expect(
        routeBends(route).every(
          (point) => point.x % 10 === 0 && point.y % 10 === 0,
        ),
      ).toBe(true);
    },
  );
});
