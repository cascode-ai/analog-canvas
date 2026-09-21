import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  DraftingObjectSchema,
  type DraftingObject,
} from "@icm/model";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  freeArrowPoints,
  isClosedPolyline,
  replaceArrowPoints,
  resizePolyline,
  setPolylineClosed,
} from "./drafting-polyline";
import { applyDraftingHandle } from "./drafting-manipulation";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const path: Extract<DraftingObject, { kind: "arrow" }> = {
  id: "path",
  kind: "arrow",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 10, y: 20 } },
  from: { kind: "free", position: { x: 10, y: 20 } },
  waypoints: [{ x: 10, y: 80 }],
  to: { kind: "free", position: { x: 110, y: 80 } },
  styleOverride: { arrowStart: "dot", arrowEnd: "open-arrow" },
};
const geometry = (object: DraftingObject) =>
  resolveDraftingObjectGeometry(
    createEmptyDocument("main", "Main"),
    resolver,
    object,
  );

describe("polyline geometry", () => {
  it("closes and opens without losing vertices or endpoint styles", () => {
    const closed = setPolylineClosed(path, true);
    expect(isClosedPolyline(closed)).toBe(true);
    expect(freeArrowPoints(closed)).toEqual([
      ...freeArrowPoints(path)!,
      { x: 10, y: 20 },
    ]);
    expect(setPolylineClosed(closed, false)).toEqual(path);
    expect(DraftingObjectSchema.parse(closed)).toEqual(closed);
    expect(() => setPolylineClosed({ ...path, waypoints: [] }, true)).toThrow(
      "three distinct",
    );
  });
  it("moves a closed seam as one vertex, and leaves other vertices free", () => {
    const closed = setPolylineClosed(path, true);
    const moved = applyDraftingHandle(
      closed,
      { kind: "from" },
      { x: -140, y: -200 },
      geometry(closed),
      1,
    );
    expect(moved).toMatchObject({
      from: { position: { x: -140, y: -200 } },
      to: { position: { x: -140, y: -200 } },
      anchor: { position: { x: -140, y: -200 } },
      waypoints: closed.waypoints,
    });
    const bent = applyDraftingHandle(
      closed,
      { kind: "waypoint", index: 0 },
      { x: 400, y: 300 },
      geometry(closed),
      1,
    );
    expect(bent).toMatchObject({
      from: closed.from,
      to: closed.to,
      waypoints: [
        { x: 400, y: 300 },
        { x: 110, y: 80 },
      ],
    });
  });
  it("stretches the whole path and curve controls independently along each axis", () => {
    const curved = { ...path, curveControls: [{ x: 0, y: 50 }, null] };
    const next = resizePolyline(curved, 2, { x: 210, y: 110 }, 1);
    expect(freeArrowPoints(next)).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 110 },
      { x: 210, y: 110 },
    ]);
    expect(next.curveControls).toEqual([{ x: -10, y: 65 }, null]);
    expect(next.styleOverride).toEqual(path.styleOverride);
    expect(DraftingObjectSchema.parse(next)).toEqual(next);
    // The visible handle sits 15 units outside the vertex; its initial click
    // must not enlarge the shape before the user has dragged it.
    expect(
      applyDraftingHandle(
        path,
        { kind: "path-corner", index: 2 },
        { x: 125, y: 95 },
        geometry(path),
        1,
      ),
    ).toEqual(path);
  });
  it("preserves exact off-grid captures on the fixed edge and unchanged axis", () => {
    const captured = replaceArrowPoints(path, [
      { x: 13, y: 22 },
      { x: 13, y: 83 },
      { x: 111, y: 83 },
    ]);
    expect(resizePolyline(captured, 2, { x: 111, y: 83 }, 5)).toBe(captured);
    expect(
      freeArrowPoints(resizePolyline(captured, 2, { x: 213, y: 83 }, 5)),
    ).toEqual([
      { x: 13, y: 22 },
      { x: 13, y: 83 },
      { x: 215, y: 83 },
    ]);
  });
  it("can stretch across the fixed corner without opening a polygon", () => {
    const next = resizePolyline(
      setPolylineClosed(path, true),
      2,
      { x: -90, y: -100 },
      1,
    );
    expect(freeArrowPoints(next)).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: -100 },
      { x: -90, y: -100 },
      { x: 10, y: 20 },
    ]);
    expect(isClosedPolyline(next)).toBe(true);
  });
  it("keeps curve control counts valid when code adds or removes vertices", () => {
    const curved = { ...path, curveControls: [{ x: 0, y: 50 }, null] };
    const closed = setPolylineClosed(curved, true);
    expect(closed.curveControls).toEqual([{ x: 0, y: 50 }, null, null]);
    expect(
      replaceArrowPoints(closed, [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ]).curveControls,
    ).toEqual([{ x: 0, y: 50 }]);
  });
});
