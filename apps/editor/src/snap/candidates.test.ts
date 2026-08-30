import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  buildRectangleEdgeSnapAnchors,
  buildSceneSnapTargetIndex,
  buildSceneSnapTargets,
  sceneSnapTargetsExcluding,
} from "./candidates";

function expectPointsCloseTo(
  actual: Array<{ x: number; y: number }>,
  expected: Array<{ x: number; y: number }>,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]!.x);
    expect(point.y).toBeCloseTo(expected[index]!.y);
  });
}

describe("snap candidate builder", () => {
  it("excludes every moving instance from static snap targets", () => {
    const document = createEmptyDocument("doc", "Snap");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });

    const targets = buildSceneSnapTargets(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      [],
      new Set(["R1"]),
    );

    expect(targets.some((target) => target.id.startsWith("instance:R1:"))).toBe(
      false,
    );
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

  it("builds the requested fractional Wire anchors on every rectangle edge", () => {
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

    const targets = buildRectangleEdgeSnapAnchors(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );

    expect(targets).toHaveLength(20);
    expect(targets.map((target) => target.id)).toEqual(
      [0, 1, 2, 3].flatMap((edge) =>
        ["quarter", "third", "center", "two-thirds", "three-quarters"].map(
          (fraction) => `drafting:rectangle-1:edge-${edge}:${fraction}`,
        ),
      ),
    );
    expectPointsCloseTo(
      targets.slice(0, 5).map((target) => target.point),
      [
        { x: 90, y: 90 },
        { x: 80 + 40 / 3, y: 90 },
        { x: 100, y: 90 },
        { x: 80 + 80 / 3, y: 90 },
        { x: 110, y: 90 },
      ],
    );
    expectPointsCloseTo(
      targets.slice(5, 10).map((target) => target.point),
      [
        { x: 120, y: 95 },
        { x: 120, y: 90 + 20 / 3 },
        { x: 120, y: 100 },
        { x: 120, y: 90 + 40 / 3 },
        { x: 120, y: 105 },
      ],
    );
    expect(targets.every((target) => target.kind === "drafting")).toBe(true);
    expect(targets.every((target) => target.electrical === undefined)).toBe(
      true,
    );
  });

  it("derives fractional anchors from rotated rectangle edges", () => {
    const document = createEmptyDocument("doc", "Snap");
    document.drafting = {
      objects: [
        {
          id: "rectangle-rotated",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          center: { x: 100, y: 100 },
          width: 40,
          height: 20,
          rotation: 90,
          lineStyle: "solid",
        },
      ],
    };

    const targets = buildRectangleEdgeSnapAnchors(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    );

    expectPointsCloseTo(
      targets.slice(0, 5).map((target) => target.point),
      [
        { x: 110, y: 90 },
        { x: 110, y: 80 + 40 / 3 },
        { x: 110, y: 100 },
        { x: 110, y: 80 + 80 / 3 },
        { x: 110, y: 110 },
      ],
    );
  });
});
