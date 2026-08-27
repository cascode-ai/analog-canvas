import { describe, expect, it } from "vitest";

import { resolveDraftingObjectGeometry } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import type { DraftingObject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

import {
  applyDraftingGeometryPatch,
  applyDraftingHandle,
  applyDraftingStylePatch,
  deleteConstructionVertex,
  draftingDragOrigin,
  insertArrowWaypoint,
  insertConstructionVertex,
  rotateDraftingObject,
  setDraftingBearing,
  setDraftingTangentAngle,
  translateDraftingObject,
} from "./drafting-manipulation";

const document = createEmptyDocument("drafting", "Drafting");
const resolver = new InMemorySymbolResolver(builtInSymbols);

const arrow = (): Extract<DraftingObject, { kind: "arrow" }> => ({
  id: "arrow-1",
  kind: "arrow",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 50, y: 0 } },
  from: { kind: "free", position: { x: 0, y: 0 } },
  to: { kind: "free", position: { x: 100, y: 0 } },
  waypoints: [{ x: 50, y: 0 }],
  curveControls: [null, null],
});

const construction = (): Extract<
  DraftingObject,
  { kind: "construction-line" }
> => ({
  id: "construction-1",
  kind: "construction-line",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 0, y: 0 } },
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ],
  curveControls: [null, null],
  lineStyle: "solid",
});

const rectangle = (): Extract<DraftingObject, { kind: "rectangle" }> => ({
  id: "rectangle-1",
  kind: "rectangle",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 50, y: 50 } },
  center: { x: 50, y: 50 },
  width: 40,
  height: 20,
  rotation: 0,
  lineStyle: "solid",
});

const circle = (): Extract<DraftingObject, { kind: "circle" }> => ({
  id: "circle-1",
  kind: "circle",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 50, y: 50 } },
  center: { x: 50, y: 50 },
  radius: 20,
  lineStyle: "solid",
});

describe("drafting manipulation", () => {
  it("translates every free geometry point without detaching anchors", () => {
    const moved = translateDraftingObject(arrow(), { x: 10, y: 20 }, 10);
    expect(moved).toMatchObject({
      anchor: { kind: "free", position: { x: 60, y: 20 } },
      from: { kind: "free", position: { x: 10, y: 20 } },
      to: { kind: "free", position: { x: 110, y: 20 } },
      waypoints: [{ x: 60, y: 20 }],
    });

    const attached = {
      ...arrow(),
      to: {
        kind: "object" as const,
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 0 },
      },
    };
    expect(draftingDragOrigin(attached)).toBeNull();
    expect(
      translateDraftingObject(attached, { x: 10, y: 20 }, 10),
    ).toMatchObject({
      to: { kind: "object", objectId: "R1" },
    });
  });

  it("moves only the requested endpoint, vertex, curve, or rectangle corner", () => {
    const arrowObject = arrow();
    const arrowGeometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      arrowObject,
    );
    expect(
      applyDraftingHandle(
        arrowObject,
        { kind: "to" },
        { x: 120, y: 10 },
        arrowGeometry,
        10,
      ),
    ).toMatchObject({
      from: { position: { x: 0, y: 0 } },
      to: { position: { x: 120, y: 10 } },
    });

    const line = construction();
    const lineGeometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      line,
    );
    expect(
      applyDraftingHandle(
        line,
        { kind: "curve", index: 0 },
        { x: 30, y: 20 },
        lineGeometry,
        10,
      ),
    ).toMatchObject({ curveControls: [{ x: 40, y: 40 }, null] });

    const box = rectangle();
    const boxGeometry = resolveDraftingObjectGeometry(document, resolver, box);
    const resized = applyDraftingHandle(
      box,
      { kind: "rectangle-corner", index: 0 },
      { x: 20, y: 30 },
      boxGeometry,
      10,
    );
    expect(resized).toMatchObject({
      center: { x: 50, y: 50 },
      width: 50,
      height: 30,
      anchor: { position: { x: 50, y: 50 } },
    });
  });

  it("moves and resizes a circle while keeping it orientation-free", () => {
    const object = circle();
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    const resized = applyDraftingHandle(
      object,
      { kind: "circle-radius", index: 0 },
      { x: 90, y: 50 },
      geometry,
      10,
    );
    expect(resized).toMatchObject({ radius: 40 });
    expect(
      translateDraftingObject(object, { x: 20, y: -10 }, 10),
    ).toMatchObject({
      center: { x: 70, y: 40 },
      anchor: { kind: "free", position: { x: 70, y: 40 } },
    });
    expect(rotateDraftingObject(object, geometry, 90, 10)).toBeNull();
    expect(
      applyDraftingStylePatch(object, { lineStyle: "dotted" }),
    ).toMatchObject({
      styleOverride: { lineStyle: "dotted" },
    });
  });

  it("inserts and deletes vertices while preserving explicit invariants", () => {
    const inserted = insertConstructionVertex(construction(), { x: 80, y: 0 });
    expect(inserted?.index).toBe(2);
    expect(inserted?.object.points[2]).toEqual({ x: 80, y: 0 });
    expect(inserted?.object.curveControls).toEqual([null, null, null]);

    const deleted = deleteConstructionVertex(inserted!.object, 2);
    expect(deleted.kind).toBe("updated");
    if (deleted.kind === "updated") {
      expect(deleted.object.points).toHaveLength(3);
      expect(deleted.object.curveControls).toBeUndefined();
    }
    expect(
      deleteConstructionVertex(
        { ...construction(), points: construction().points.slice(0, 2) },
        0,
      ),
    ).toEqual({ kind: "minimum" });
  });

  it("inserts an arrow waypoint on the nearest resolved segment", () => {
    const object = arrow();
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "arrow") throw new Error("Expected arrow geometry");
    const inserted = insertArrowWaypoint(object, geometry, { x: 80, y: 10 });
    expect(inserted?.index).toBe(1);
    expect(inserted?.object.waypoints).toEqual([
      { x: 50, y: 0 },
      { x: 80, y: 10 },
    ]);
  });

  it("applies bounded style patches only to editable supported objects", () => {
    expect(
      applyDraftingStylePatch(arrow(), {
        lineStyle: "dashed",
        strokeScale: 1.5,
      }),
    ).toMatchObject({
      styleOverride: { lineStyle: "dashed", strokeScale: 1.5 },
    });
    expect(
      applyDraftingStylePatch(
        { ...arrow(), locked: true },
        { lineStyle: "dotted" },
      ),
    ).toBeNull();
  });

  it("rotates and sets bearing without detaching an attached arrow", () => {
    const object = arrow();
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    expect(rotateDraftingObject(object, geometry, 90, 10)).toMatchObject({
      from: { position: { x: 50, y: -50 } },
      to: { position: { x: 50, y: 50 } },
    });
    expect(setDraftingBearing(object, geometry, 90, 10)).toMatchObject({
      kind: "updated",
      object: {
        from: { position: { x: 50, y: -50 } },
        to: { position: { x: 50, y: 50 } },
      },
    });

    const attached = {
      ...object,
      to: {
        kind: "object" as const,
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 0 },
      },
    };
    const attachedGeometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      attached,
    );
    expect(setDraftingBearing(attached, attachedGeometry, 90, 10)).toEqual({
      kind: "attached-arrow",
    });
  });

  it("updates one tangent control and normalizes rectangle bearing", () => {
    const line = construction();
    const geometry = resolveDraftingObjectGeometry(document, resolver, line);
    if (geometry.kind !== "construction-line") {
      throw new Error("Expected construction-line geometry");
    }
    expect(setDraftingTangentAngle(line, geometry, 0, 45, 10)).toMatchObject({
      curveControls: [{ x: 30, y: 10 }, null],
    });

    const box = rectangle();
    const boxGeometry = resolveDraftingObjectGeometry(document, resolver, box);
    expect(setDraftingBearing(box, boxGeometry, -90, 10)).toMatchObject({
      kind: "updated",
      object: { rotation: 270 },
    });
  });
});

describe("drafting precise properties", () => {
  const circle = (): DraftingObject => ({
    id: "circle-1",
    kind: "circle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 40, y: 40 } },
    center: { x: 40, y: 40 },
    radius: 25,
    lineStyle: "solid",
  });
  const rectangle = (): DraftingObject => ({
    id: "rect-1",
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 100, y: 40 } },
    center: { x: 100, y: 40 },
    width: 60,
    height: 30,
    rotation: 0,
    lineStyle: "solid",
  });

  it("sets a circle radius and rectangle size as integers with a floor", () => {
    expect(
      applyDraftingGeometryPatch(circle(), { radius: 42.4 }),
    ).toMatchObject({ radius: 42 });
    expect(applyDraftingGeometryPatch(circle(), { radius: 0.2 })).toMatchObject(
      { radius: 1 },
    );
    expect(
      applyDraftingGeometryPatch(rectangle(), { width: 120.6, height: 44 }),
    ).toMatchObject({ width: 121, height: 44 });
    expect(
      applyDraftingGeometryPatch(rectangle(), { height: 12 }),
    ).toMatchObject({ width: 60, height: 12 });
  });

  it("refuses geometry edits on locked or mismatched objects", () => {
    expect(
      applyDraftingGeometryPatch({ ...circle(), locked: true }, { radius: 9 }),
    ).toBeNull();
    expect(applyDraftingGeometryPatch(circle(), { width: 9 })).toBeNull();
    expect(applyDraftingGeometryPatch(rectangle(), { radius: 9 })).toBeNull();
    expect(
      applyDraftingGeometryPatch(circle(), { radius: Number.NaN }),
    ).toBeNull();
  });

  it("applies precise stroke multipliers and explicit colors independently", () => {
    const red = applyDraftingStylePatch(circle(), {
      strokeScale: 1.35,
      color: "#cc2200",
    });
    expect(red?.styleOverride).toEqual({
      strokeScale: 1.35,
      color: "#cc2200",
    });
    // An explicit undefined clears back to the profile foreground.
    const cleared = applyDraftingStylePatch(red!, { color: undefined });
    expect(cleared?.styleOverride).toEqual({ strokeScale: 1.35 });
  });
});
