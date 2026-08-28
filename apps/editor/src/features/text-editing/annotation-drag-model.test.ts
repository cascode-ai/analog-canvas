import { createRoutePath } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import type { Annotation } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { draggedAnnotationAtPosition } from "./annotation-drag-model";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function context(document: ReturnType<typeof createEmptyDocument>) {
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  return {
    document,
    annotationGrid: 10,
    resolver,
    routeGeometryRecords: document.routes.flatMap((route) => {
      const geometry = routing.routes.get(route.id);
      return geometry ? [{ route, geometry }] : [];
    }),
  };
}

describe("annotation drag model", () => {
  it("snaps free text to the Document grid", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    const annotation: Annotation = {
      id: "note",
      kind: "instance-label",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };

    expect(
      draggedAnnotationAtPosition(context(document), annotation, {
        x: 24,
        y: 36,
      }).anchor,
    ).toEqual({ kind: "free", position: { x: 20, y: 40 } });
  });

  it("keeps an instance label near its host and updates local offset", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    const annotation: Annotation = {
      id: "reference-r1",
      kind: "instance-label",
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };

    const dragged = draggedAnnotationAtPosition(context(document), annotation, {
      x: 1000,
      y: 1000,
    });

    expect(dragged.anchor.kind).toBe("object");
    if (dragged.anchor.kind !== "object") return;
    expect(dragged.anchor.fallbackPosition.x).toBeLessThan(200);
    expect(dragged.anchor.fallbackPosition.y).toBeLessThan(200);
    expect(dragged.anchor.localOffset).toEqual({
      x: dragged.anchor.fallbackPosition.x - 100,
      y: dragged.anchor.fallbackPosition.y - 100,
    });
  });

  it("reanchors an imported Net Label along its routed Net", () => {
    const document = createEmptyDocument("document", "Document");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "j1",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const annotation: Annotation = {
      id: "imported-label",
      kind: "net-label",
      netId: "net",
      anchor: {
        kind: "route",
        routeId: "route",
        legId: document.routes[0]!.legs[0]!.id,
        t: 0.1,
        normalOffset: 0,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 10, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };

    const dragged = draggedAnnotationAtPosition(context(document), annotation, {
      x: 75,
      y: 20,
    });

    expect(dragged.anchor).toMatchObject({
      kind: "route",
      routeId: "route",
      legId: document.routes[0]!.legs[0]!.id,
      t: 0.75,
      normalOffset: 20,
      fallbackPosition: { x: 75, y: 20 },
    });
  });
});
