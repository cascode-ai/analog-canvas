import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { buildSceneSnapTargetIndex } from "../../snap/candidates";
import type { PlacementOrientationOperation } from "../../interaction/shortcut-orientation";
import { copySelection } from "./clipboard";
import { clipboardPreviewDocument } from "./clipboard-preview";
import {
  copyPlacementAnchors,
  snapPendingCopyPlacement,
} from "./copy-placement-snap";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const resistor = (id: string, x: number, y: number) => ({
  id,
  symbolId: "resistor",
  placement: {
    position: { x, y },
    rotation: 0 as const,
    mirror: "none" as const,
  },
});

describe("copy placement alignment", () => {
  it("reads target replacements, reordering and coordinate changes after a cached placement", () => {
    const sceneSnapTargetIndex = {
      targets: [
        {
          objectId: "first",
          anchor: {
            id: "a",
            kind: "instance-center" as const,
            point: { x: 30, y: 50 },
          },
        },
        {
          objectId: "second",
          anchor: {
            id: "b",
            kind: "instance-center" as const,
            point: { x: 70, y: 50 },
          },
        },
      ],
    };
    const options = {
      sceneSnapTargetIndex,
      movingAnchors: [
        {
          id: "origin",
          kind: "instance-center" as const,
          point: { x: 0, y: 0 },
        },
      ],
      anchor: { x: 0, y: 0 },
      grid: 10,
      tolerance: 3,
    };
    expect(
      snapPendingCopyPlacement({ ...options, position: { x: 32, y: 52 } })
        .point,
    ).toEqual({ x: 30, y: 50 });
    sceneSnapTargetIndex.targets.reverse();
    sceneSnapTargetIndex.targets[0]!.anchor = {
      id: "c",
      kind: "instance-center",
      point: { x: 90, y: 80 },
    };
    expect(
      snapPendingCopyPlacement({ ...options, position: { x: 92, y: 82 } })
        .point,
    ).toEqual({ x: 90, y: 80 });
    sceneSnapTargetIndex.targets[0]!.anchor.point.x = 100;
    expect(
      snapPendingCopyPlacement({ ...options, position: { x: 102, y: 82 } })
        .point,
    ).toEqual({ x: 100, y: 80 });
    sceneSnapTargetIndex.targets.length = 0;
    expect(
      snapPendingCopyPlacement({ ...options, position: { x: 32, y: 52 } }),
    ).toEqual({ point: { x: 30, y: 50 }, guides: [] });
  });
  it("keeps repeated pointer placement off the full canvas sorting path", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances = Array.from({ length: 100 }, (_, index) =>
      resistor(`R${index}`, 10000 + index * 100, 10000),
    );
    const sceneSnapTargetIndex = buildSceneSnapTargetIndex(
      document,
      resolver,
      [],
    );
    const options = {
      movingAnchors: [
        {
          id: "copy-origin",
          kind: "instance-center" as const,
          point: { x: 100, y: 100 },
        },
      ],
      sceneSnapTargetIndex,
      anchor: { x: 100, y: 100 },
      grid: 10,
      tolerance: 3,
    };
    snapPendingCopyPlacement({ ...options, position: { x: 3003, y: 203 } });
    const originalSort = Array.prototype.sort;
    let fullTargetSorts = 0;
    // Count real runtime work, without replacing any Snap/planner answer.
    const sort = vi.spyOn(Array.prototype, "sort").mockImplementation(function (
      this: unknown[],
      compare?: (left: unknown, right: unknown) => number,
    ) {
      if (this.length >= sceneSnapTargetIndex.targets.length) fullTargetSorts++;
      return originalSort.call(this, compare);
    });
    try {
      for (const x of [3033, 3063, 3093]) {
        expect(
          snapPendingCopyPlacement({ ...options, position: { x, y: 203 } }),
        ).toEqual({ point: { x: x - 3, y: 200 }, guides: [] });
      }
      expect(fullTargetSorts).toBe(0);
    } finally {
      sort.mockRestore();
    }
  });

  it("keeps the original as an alignment target without mutating either document", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances = [resistor("R1", 100, 100)];
    const clipboard = copySelection(document, ["R1"])!;
    const preview = clipboardPreviewDocument(
      document,
      clipboard,
      { x: 0, y: 0 },
      [],
      resolver,
      1,
    );
    const before = structuredClone({ document, preview });
    const snapped = snapPendingCopyPlacement({
      movingAnchors: copyPlacementAnchors(preview, resolver),
      sceneSnapTargetIndex: buildSceneSnapTargetIndex(document, resolver, []),
      anchor: { x: 100, y: 100 },
      position: { x: 300, y: 102 },
      grid: 10,
      tolerance: 3,
    });
    expect(snapped.point).toEqual({ x: 300, y: 100 });
    expect(snapped.guides).toEqual([
      expect.objectContaining({ axis: "y", coordinate: 100 }),
    ]);
    expect(snapped.guides[0]!.to - snapped.guides[0]!.from).toBeCloseTo(200);
    expect({ document, preview }).toEqual(before);
  });

  it.each<{ name: string; operations: PlacementOrientationOperation[] }>([
    {
      name: "rotated and mirrored",
      operations: [
        { kind: "rotate", deltaDegrees: 90 },
        { kind: "reflect", direction: "top-bottom" },
      ],
    },
  ])(
    "aligns a $name group using its transformed component anchors",
    ({ operations }) => {
      const document = createEmptyDocument("main", "Main");
      document.instances = [
        resistor("R1", 100, 100),
        resistor("R2", 200, 100),
        resistor("Rtarget", 400, 300),
      ];
      const clipboard = copySelection(document, ["R1", "R2"])!;
      const preview = clipboardPreviewDocument(
        document,
        clipboard,
        { x: 0, y: 0 },
        operations,
        resolver,
        1,
      );
      const second = preview.instances[1]!.placement!.position;
      const expected = { x: 100 + 400 - second.x, y: 100 + 500 - second.y };
      const snapped = snapPendingCopyPlacement({
        movingAnchors: copyPlacementAnchors(preview, resolver),
        sceneSnapTargetIndex: buildSceneSnapTargetIndex(document, resolver, []),
        anchor: { x: 100, y: 100 },
        position: { x: expected.x + 2, y: expected.y },
        grid: 10,
        tolerance: 3,
      });
      expect(snapped.point).toEqual(expected);
      expect(snapped.guides).toContainEqual(
        expect.objectContaining({ axis: "x", coordinate: 400 }),
      );
    },
  );

  it("keeps grid placement when a copied selection contains no components", () => {
    expect(
      snapPendingCopyPlacement({
        movingAnchors: [],
        sceneSnapTargetIndex: { targets: [] },
        anchor: { x: 100, y: 100 },
        position: { x: 203, y: 257 },
        grid: 10,
        tolerance: 3,
      }),
    ).toEqual({ point: { x: 200, y: 260 }, guides: [] });
  });
});
