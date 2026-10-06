import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  buildDraftingProjectionSnapTargets,
  buildRectangleEdgeSnapAnchors,
  buildSceneSnapTargetIndex,
  buildSceneSnapTargets,
  sceneSnapTargetsExcluding,
} from "./candidates";

describe("snap candidate builder", () => {
  it("projects to arbitrary rectangle edges without adding visible anchors", () => {
    const document = createEmptyDocument("doc", "Snap");
    document.drafting = {
      objects: [
        {
          id: "rectangle-1",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          center: { x: 100, y: 100 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    };

    const targets = buildDraftingProjectionSnapTargets(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      { x: 93, y: 92 },
    );

    expect(targets).toHaveLength(4);
    expect(targets.map((target) => target.point)).toContainEqual({
      x: 93,
      y: 90,
    });
    expect(targets.every((target) => target.kind === "drafting")).toBe(true);
  });

  it("projects to a circle perimeter and excludes the object being edited", () => {
    const document = createEmptyDocument("doc", "Snap");
    document.drafting = {
      objects: [
        {
          id: "circle-1",
          kind: "circle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          radius: 20,
          lineStyle: "solid",
        },
      ],
    };
    const resolver = new InMemorySymbolResolver(builtInSymbols);

    expect(
      buildDraftingProjectionSnapTargets(document, resolver, {
        x: 66,
        y: 62,
      }).at(0)?.point,
    ).toEqual({ x: 66, y: 62 });
    expect(
      buildDraftingProjectionSnapTargets(
        document,
        resolver,
        { x: 66, y: 62 },
        new Set(["circle-1"]),
      ),
    ).toEqual([]);
  });
  it("reuses revision-scoped geometry while preserving exclusion semantics", () => {
    const document = createEmptyDocument("doc", "Snap");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const index = buildSceneSnapTargetIndex(document, resolver, []);

    const indexed = sceneSnapTargetsExcluding(index, new Set(["R1"]));
    const rebuilt = buildSceneSnapTargets(
      document,
      resolver,
      [],
      new Set(["R1"]),
    );

    expect(indexed).toEqual(rebuilt);
    expect(indexed.some((target) => target.id.startsWith("instance:R1:"))).toBe(
      false,
    );
    expect(indexed.some((target) => target.id.startsWith("instance:R2:"))).toBe(
      true,
    );
  });

  function rectangleAnchors(
    rectangle: { width: number; height: number; rotation?: number },
    center = { x: 100, y: 100 },
  ) {
    const document = createEmptyDocument("doc", "Snap");
    document.drafting = {
      objects: [
        {
          id: "block",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: center },
          center,
          width: rectangle.width,
          height: rectangle.height,
          rotation: rectangle.rotation ?? 0,
          lineStyle: "solid",
        },
      ],
    };
    return buildRectangleEdgeSnapAnchors(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );
  }

  it("offers a block's wire entries at the grid points nearest its thirds and middle", () => {
    // 100 wide by 60 tall on the grid of 10: the top edge runs 50..150, so
    // its thirds at 83.3 and 116.7 land on 80 and 120.
    const anchors = rectangleAnchors({ width: 100, height: 60 });
    expect(anchors.map((anchor) => anchor.point)).toEqual([
      { x: 80, y: 70 },
      { x: 100, y: 70 },
      { x: 120, y: 70 },
      { x: 150, y: 90 },
      { x: 150, y: 100 },
      { x: 150, y: 110 },
      { x: 120, y: 130 },
      { x: 100, y: 130 },
      { x: 80, y: 130 },
      { x: 50, y: 110 },
      { x: 50, y: 100 },
      { x: 50, y: 90 },
    ]);
    expect(anchors[0]).toEqual({
      id: "drafting:block:edge-0:third",
      point: { x: 80, y: 70 },
      kind: "drafting",
    });
    // Geometry only: none of them is an electrical target.
    expect(anchors.every((anchor) => anchor.electrical === undefined)).toBe(
      true,
    );
  });

  it("drops entries that round onto each other or a corner, and slanted edges", () => {
    // A 20-tall edge has one entry, its middle; a 10-tall one has none.
    expect(
      rectangleAnchors({ width: 40, height: 20 })
        .filter((anchor) => anchor.point.x === 120)
        .map((anchor) => anchor.point.y),
    ).toEqual([100]);
    expect(
      rectangleAnchors({ width: 40, height: 10 }, { x: 100, y: 105 }).filter(
        (anchor) => anchor.point.x === 120,
      ),
    ).toEqual([]);
    // A quarter turn keeps every edge straight on the grid.
    expect(
      rectangleAnchors({ width: 100, height: 60, rotation: 90 }),
    ).toHaveLength(12);
    // A slanted edge, or one whose line sits off the grid, takes no wire end.
    expect(rectangleAnchors({ width: 100, height: 60, rotation: 30 })).toEqual(
      [],
    );
    expect(
      rectangleAnchors({ width: 100, height: 60 }, { x: 105, y: 100 }).every(
        (anchor) => anchor.point.y === 70 || anchor.point.y === 130,
      ),
    ).toBe(true);
  });
});
