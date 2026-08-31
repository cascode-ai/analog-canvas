import { createRoutePath } from "@icm/model";
import { createEmptyDocument } from "@icm/model";
import type { Rect, SchematicDocument } from "@icm/model";
import {
  resolveRouteGeometry,
  resolveSchematicStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  annotationAnchor,
  annotationHitBox,
  defaultInstanceLabel,
  instanceHitBox,
  type RouteGeometryRecord,
} from "../wiring/route-interaction-geometry";
import { marqueeMode, marqueeSelection } from "./marquee-selection";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const styleProfile = resolveSchematicStyleProfile("razavi-textbook-v1");

function grow(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function fixture(): {
  document: SchematicDocument;
  records: RouteGeometryRecord[];
  instanceBounds: Rect;
  labelBounds: Rect;
} {
  const document = createEmptyDocument("marquee", "Marquee");
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(
    {
      id: "j1",
      netId: "net-1",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 0 },
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
  // Designated, so its label projects visible text: an empty label paints
  // nothing and is not a marquee target, which is not what this fixture tests.
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    reference: "M1",
    placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
  });
  const label = defaultInstanceLabel(
    document,
    document.instances[0]!,
    resolver,
    styleProfile,
  );
  if (!label) throw new Error("Fixture label must resolve");
  document.annotations.push(label);
  document.drafting = {
    objects: [
      {
        id: "box-1",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 500, y: 100 } },
        center: { x: 500, y: 100 },
        width: 80,
        height: 40,
        rotation: 0,
        lineStyle: "solid",
      },
      {
        id: "circle-1",
        kind: "circle",
        locked: false,
        zIndex: 1,
        anchor: { kind: "free", position: { x: 700, y: 100 } },
        center: { x: 700, y: 100 },
        radius: 40,
        lineStyle: "solid",
      },
    ],
  };
  const geometry = resolveRouteGeometry(
    document,
    resolver,
    document.routes[0]!,
  );
  if (!geometry) throw new Error("Fixture route must resolve");
  const records = [{ route: document.routes[0]!, geometry }];
  const instanceBounds = instanceHitBox(document.instances[0]!, resolver);
  if (!instanceBounds) throw new Error("Fixture instance must resolve");
  const labelBounds = annotationHitBox(
    document,
    label,
    annotationAnchor(document, resolver, label, records, styleProfile),
    records,
    styleProfile,
  );
  return { document, records, instanceBounds, labelBounds };
}

function select(rect: Rect, mode: "window" | "crossing") {
  const { document, records } = fixtureCache;
  return marqueeSelection(
    document,
    resolver,
    records,
    styleProfile,
    rect,
    mode,
  );
}

const fixtureCache = fixture();

describe("marqueeMode", () => {
  it("maps left-to-right to window and right-to-left to crossing", () => {
    expect(marqueeMode({ x: 0, y: 0 }, { x: 50, y: 30 })).toBe("window");
    expect(marqueeMode({ x: 0, y: 0 }, { x: 0, y: 30 })).toBe("window");
    expect(marqueeMode({ x: 50, y: 0 }, { x: 0, y: 30 })).toBe("crossing");
  });
});

describe("marquee window selection (left-to-right)", () => {
  it("selects an instance only when its bounds are fully contained", () => {
    const { instanceBounds } = fixtureCache;
    expect(select(grow(instanceBounds, 4), "window").instanceIds).toEqual([
      "M1",
    ]);
    const partial = {
      ...grow(instanceBounds, 4),
      width: instanceBounds.width / 2,
    };
    expect(select(partial, "window").instanceIds).toEqual([]);
  });

  it("selects a route only when the whole centerline is inside", () => {
    expect(
      select({ x: -10, y: -10, width: 120, height: 20 }, "window").routeIds,
    ).toEqual(["route-1"]);
    expect(
      select({ x: 40, y: -10, width: 120, height: 20 }, "window").routeIds,
    ).toEqual([]);
  });

  it("selects an annotation only when fully contained", () => {
    const { labelBounds } = fixtureCache;
    expect(select(grow(labelBounds, 4), "window").annotationIds).toEqual([
      fixtureCache.document.annotations[0]!.id,
    ]);
    const partial = { ...grow(labelBounds, 4), width: labelBounds.width / 2 };
    expect(select(partial, "window").annotationIds).toEqual([]);
  });

  it("selects an outline rectangle only when all corners are inside", () => {
    expect(
      select({ x: 450, y: 70, width: 100, height: 60 }, "window").draftingIds,
    ).toEqual(["box-1"]);
    // Partially covering or sitting wholly inside the box selects nothing.
    expect(
      select({ x: 450, y: 70, width: 60, height: 60 }, "window").draftingIds,
    ).toEqual([]);
    expect(
      select({ x: 480, y: 90, width: 30, height: 15 }, "window").draftingIds,
    ).toEqual([]);
  });

  it("selects a circle only when its full outline is inside", () => {
    expect(
      select({ x: 650, y: 50, width: 100, height: 100 }, "window").draftingIds,
    ).toEqual(["circle-1"]);
    expect(
      select({ x: 670, y: 70, width: 60, height: 60 }, "window").draftingIds,
    ).toEqual([]);
  });
});

describe("marquee crossing selection (right-to-left)", () => {
  it("selects an instance on any overlap", () => {
    const { instanceBounds } = fixtureCache;
    const partial = {
      ...grow(instanceBounds, 4),
      width: instanceBounds.width / 2,
    };
    expect(select(partial, "crossing").instanceIds).toEqual(["M1"]);
  });

  it("selects a route touched by the rectangle", () => {
    expect(
      select({ x: 40, y: -10, width: 20, height: 20 }, "crossing").routeIds,
    ).toEqual(["route-1"]);
  });

  it("selects an outline rectangle only through its boundary", () => {
    expect(
      select({ x: 450, y: 70, width: 60, height: 60 }, "crossing").draftingIds,
    ).toEqual(["box-1"]);
    // A crossing wholly inside the empty box still selects only contents.
    expect(
      select({ x: 480, y: 90, width: 30, height: 15 }, "crossing").draftingIds,
    ).toEqual([]);
  });

  it("selects a circle when crossing touches or encloses its outline", () => {
    expect(
      select({ x: 650, y: 50, width: 100, height: 100 }, "crossing")
        .draftingIds,
    ).toEqual(["circle-1"]);
    expect(
      select({ x: 695, y: 95, width: 10, height: 10 }, "crossing").draftingIds,
    ).toEqual([]);
  });

  it("keeps junction membership identical in both modes", () => {
    const around = { x: -5, y: -5, width: 10, height: 10 };
    expect(select(around, "crossing").junctionIds).toEqual(["j1"]);
    expect(select(around, "window").junctionIds).toEqual(["j1"]);
  });

  it("never selects distant objects in either mode", () => {
    const empty = { x: 1000, y: 1000, width: 200, height: 200 };
    for (const mode of ["window", "crossing"] as const) {
      const selection = select(empty, mode);
      expect(selection.instanceIds).toEqual([]);
      expect(selection.routeIds).toEqual([]);
      expect(selection.junctionIds).toEqual([]);
      expect(selection.annotationIds).toEqual([]);
      expect(selection.draftingIds).toEqual([]);
    }
  });
});
