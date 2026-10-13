import { resolveDocumentRoutingGeometry } from "@icm/derived";
import {
  createEmptyDocument,
  createRoutePath,
  freezeSnapshot,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { buildSceneSnapTargetIndex } from "../../snap/candidates";
import { defaultRazaviSymbolVariantId } from "../../presentation/razavi-presentation";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import {
  placementWireSources,
  proposePlacementContact,
} from "./placement-connectivity";
import { snapPendingComponentPlacement } from "./placement-snap";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function routeRecords(
  document: ReturnType<typeof createEmptyDocument>,
): RouteGeometryRecord[] {
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  return document.routes.flatMap((route) => {
    const resolved = geometry.routes.get(route.id);
    return resolved ? [{ route, geometry: resolved }] : [];
  });
}

describe("pending component placement snap", () => {
  it("reads an immutable canvas without cloning it for each pending position", () => {
    const document = freezeSnapshot(createEmptyDocument("main", "Main"));
    const sceneSnapTargetIndex = buildSceneSnapTargetIndex(
      document,
      resolver,
      [],
    );
    const originalClone = globalThis.structuredClone;
    let sourceClones = 0;
    const clone = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation((value, options) => {
        if (value === document) sourceClones++;
        return originalClone(value, options);
      });
    try {
      for (const x of [103, 133, 163]) {
        const result = snapPendingComponentPlacement({
          document,
          resolver,
          routeGeometryRecords: [],
          sceneSnapTargetIndex,
          symbolId: "resistor",
          position: { x, y: 203 },
          rotation: 0,
          mirror: "none",
          tolerance: 3,
        });
        expect(result.position).toEqual({ x: x - 3, y: 200 });
      }
      expect(sourceClones).toBe(0);
      expect(document.instances).toEqual([]);
    } finally {
      clone.mockRestore();
    }
  });

  it("does not compare a pending pin to every distant conductor", () => {
    const source = createEmptyDocument("main", "Main");
    for (let index = 0; index < 100; index++) {
      const netId = `net-${index}`;
      source.nets.push({ id: netId, terminals: [] });
      source.junctions.push(
        {
          id: `${netId}-a`,
          netId,
          position: { x: 10000, y: 10000 + index * 100 },
        },
        {
          id: `${netId}-b`,
          netId,
          position: { x: 10100, y: 10000 + index * 100 },
        },
      );
      source.routes.push(
        createRoutePath({
          id: `wire-${index}`,
          netId,
          start: { kind: "junction", junctionId: `${netId}-a` },
          end: { kind: "junction", junctionId: `${netId}-b` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const document = freezeSnapshot(source);
    const routeGeometryRecords = routeRecords(document);
    const sceneSnapTargetIndex = buildSceneSnapTargetIndex(
      document,
      resolver,
      [],
    );
    const originalHypot = Math.hypot;
    let distances = 0;
    const hypot = vi.spyOn(Math, "hypot").mockImplementation((...values) => {
      distances++;
      return originalHypot(...values);
    });
    try {
      const result = snapPendingComponentPlacement({
        document,
        resolver,
        routeGeometryRecords,
        sceneSnapTargetIndex,
        symbolId: "ground",
        position: { x: 103, y: 203 },
        rotation: 0,
        mirror: "none",
        tolerance: 3,
      });
      expect(result.position).toEqual({ x: 100, y: 200 });
      expect(distances).toBeLessThan(20);
    } finally {
      hypot.mockRestore();
    }
  });

  it.each([
    "ground",
    "vdd-port",
    "resistor",
    "capacitor",
    "voltage-source",
    "current-source",
    "nmos",
    "pmos",
  ])("snaps a new %s pin to an existing component pin", (symbolId) => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    const targetSources = placementWireSources(
      document,
      resolver,
      document.instances[0]!,
    );
    const target = targetSources.find(
      (source) =>
        source.endpoint.kind === "terminal" && source.endpoint.pinName === "2",
    )!;
    const originSources = placementWireSources(document, resolver, {
      id: "pending-origin",
      symbolId,
      symbolVariantId: defaultRazaviSymbolVariantId(symbolId),
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    const pin = originSources[0]!.connection.contactPoint;
    const exactOrigin = {
      x: target.connection.contactPoint.x - pin.x,
      y: target.connection.contactPoint.y - pin.y,
    };
    const symbolVariantId = defaultRazaviSymbolVariantId(symbolId);
    const snapped = snapPendingComponentPlacement({
      document,
      resolver,
      routeGeometryRecords: [],
      sceneSnapTargetIndex: buildSceneSnapTargetIndex(
        document,
        resolver,
        targetSources,
      ),
      symbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      position: { x: exactOrigin.x + 3, y: exactOrigin.y + 3 },
      rotation: 0,
      mirror: "none",
      tolerance: 4,
    });

    expect(snapped.position).toEqual(exactOrigin);
    expect(snapped.snap.xMatch?.targetKind).toBe("pin");
    expect(snapped.snap.yMatch?.targetKind).toBe("pin");
    expect(
      proposePlacementContact(
        document,
        resolver,
        {
          id: "placed",
          symbolId,
          symbolVariantId: defaultRazaviSymbolVariantId(symbolId),
          placement: {
            position: snapped.position,
            rotation: 0,
            mirror: "none",
          },
        },
        targetSources,
      ).matched,
    ).toBe(true);
  });

  it("snaps a new Ground pin to a nearby Route interior", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push({ id: "net-signal", terminals: [] });
    document.junctions.push(
      {
        id: "left",
        netId: "net-signal",
        position: { x: 60, y: 120 },
        role: "route-anchor",
      },
      {
        id: "right",
        netId: "net-signal",
        position: { x: 140, y: 120 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-signal",
        netId: "net-signal",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "right" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const targets = placementWireSources(document, resolver, {
      id: "GND1",
      symbolId: "ground",
      placement: {
        position: { x: 100, y: 133 },
        rotation: 0,
        mirror: "none",
      },
    });
    const snapped = snapPendingComponentPlacement({
      document,
      resolver,
      routeGeometryRecords: routeRecords(document),
      sceneSnapTargetIndex: buildSceneSnapTargetIndex(document, resolver, []),
      symbolId: "ground",
      position: { x: 100, y: 133 },
      rotation: 0,
      mirror: "none",
      tolerance: 4,
    });

    expect(targets[0]?.connection.contactPoint).toEqual({ x: 100, y: 123 });
    expect(snapped.position).toEqual({ x: 100, y: 130 });
    expect(snapped.snap.electricalMatch?.target.kind).toBe("route");
  });
});
