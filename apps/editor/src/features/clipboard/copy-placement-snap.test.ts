import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSceneSnapTargetIndex } from "../../snap/candidates";
import type { PlacementOrientationOperation } from "../../interaction/shortcut-orientation";
import { clipboardPreviewDocument, copySelection } from "./clipboard";
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
    { name: "unchanged", operations: [] },
    { name: "rotated", operations: [{ kind: "rotate", deltaDegrees: 90 }] },
    {
      name: "mirrored",
      operations: [{ kind: "reflect", direction: "left-right" }],
    },
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
