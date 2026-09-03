import { describe, expect, it } from "vitest";
import { DraftArrowSchema, createEmptyDocument } from "@icm/model";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  ARROW_PRESETS,
  applyArrowPreset,
  arrowPresetFor,
  outlinePlacement,
} from "./arrow-presets";
import {
  applyDraftingGeometryPatch,
  applyDraftingHandle,
  insertArrowWaypoint,
  setDraftingTangentAngle,
} from "./drafting-manipulation";
import { scaleDraftingObject } from "./drafting-group-scale";

const base = DraftArrowSchema.parse({
  id: "a",
  kind: "arrow",
  locked: false,
  zIndex: 0,
  anchor: { kind: "free", position: { x: 0, y: 0 } },
  from: { kind: "free", position: { x: 0, y: 0 } },
  to: { kind: "free", position: { x: 100, y: 0 } },
  styleOverride: { color: "#ff0000", strokeScale: 1.5, arrowHeadScale: 1.25 },
});
const outlinePreset = ARROW_PRESETS.find((p) => p.id === "outline-end")!;
describe("arrow family compatibility", () => {
  it("round-trips every preset without persisting UI IDs or losing legacy scale/color", () => {
    for (const preset of ARROW_PRESETS) {
      const arrow = applyArrowPreset(base, preset)!;
      expect(DraftArrowSchema.parse(JSON.parse(JSON.stringify(arrow)))).toEqual(
        arrow,
      );
      expect(arrowPresetFor(arrow)).toEqual(preset);
      expect(arrow.styleOverride).toMatchObject(base.styleOverride!);
      expect(arrow).not.toHaveProperty("presetId");
    }
  });
  it("refuses to flatten curves/waypoints in both GUI conversion and external schema", () => {
    for (const extra of [
      { waypoints: [{ x: 40, y: 20 }] },
      { curveControls: [{ x: 40, y: 20 }] },
    ]) {
      const curved = { ...base, ...extra };
      expect(applyArrowPreset(curved, outlinePreset)).toBeNull();
      expect(
        DraftArrowSchema.safeParse({ ...curved, outline: { width: 30 } })
          .success,
      ).toBe(false);
      expect(applyArrowPreset(curved, ARROW_PRESETS[2]!)?.waypoints).toEqual(
        curved.waypoints,
      );
    }
  });
  it("uses a compact click default, while drag dimensions come from a bounding box", () => {
    expect(outlinePlacement(null, { x: 50, y: 50 })).toEqual({
      from: { x: 50, y: 28 },
      to: { x: 50, y: 72 },
      width: 30,
    });
    expect(outlinePlacement({ x: 100, y: 100 }, { x: 40, y: 20 })).toEqual({
      from: { x: 70, y: 20 },
      to: { x: 70, y: 100 },
      width: 60,
    });
  });
  it("has independent width, rotation and endpoints, but no curve or waypoint handles", () => {
    const arrow = applyArrowPreset(base, outlinePreset)!;
    const document = createEmptyDocument("doc", "Doc");
    const geometry = resolveDraftingObjectGeometry(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      arrow,
    );
    if (geometry.kind !== "arrow") throw Error("arrow required");
    expect(
      applyDraftingHandle(
        arrow,
        { kind: "outline-width" },
        { x: 50, y: 30 },
        geometry,
        1,
      ),
    ).toMatchObject({ outline: { width: 60 }, from: arrow.from, to: arrow.to });
    expect(
      applyDraftingHandle(
        arrow,
        { kind: "rotate" },
        { x: 80, y: 0 },
        geometry,
        1,
      ),
    ).toMatchObject({
      from: { position: { x: 50, y: -50 } },
      to: { position: { x: 50, y: 50 } },
      outline: arrow.outline,
    });
    expect(applyDraftingGeometryPatch(arrow, { width: 40 })).toMatchObject({
      outline: { width: 40 },
      styleOverride: arrow.styleOverride,
    });
    expect(insertArrowWaypoint(arrow, geometry, { x: 50, y: 20 })).toBeNull();
    expect(setDraftingTangentAngle(arrow, geometry, 0, 60, 1)).toBeNull();
    expect(scaleDraftingObject(arrow, { x: 0, y: 0 }, 2)).toMatchObject({
      outline: { width: 60 },
    });
  });
});
