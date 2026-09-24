import { describe, expect, it } from "vitest";

import {
  electricalConnectionGrid,
  isGridAlignedCoordinate,
  snapGridCoordinate,
  snapGridPoint,
  snapGridRect,
} from "./coordinate-domain.js";

describe("persisted coordinate domain", () => {
  it("uses a common electrical lattice without changing ordinary placement pitch", () => {
    expect(electricalConnectionGrid(10)).toBe(2);
    expect(electricalConnectionGrid(40)).toBe(2);
    expect(electricalConnectionGrid(5)).toBe(1);
  });
  it("normalizes positive and negative derived coordinates to the nearest grid", () => {
    expect(snapGridCoordinate(14, 10)).toBe(10);
    expect(snapGridCoordinate(16, 10)).toBe(20);
    expect(snapGridCoordinate(-14, 10)).toBe(-10);
    expect(snapGridCoordinate(-16, 10)).toBe(-20);
  });

  it("normalizes both point axes through the one canonical grid operation", () => {
    expect(snapGridPoint({ x: 16.5, y: -24.5 }, 10)).toEqual({
      x: 20,
      y: -20,
    });
  });

  it("keeps persisted rectangles grid-aligned and never below one grid cell", () => {
    expect(snapGridRect({ x: 16, y: -16, width: 4, height: 26 }, 10)).toEqual({
      x: 20,
      y: -20,
      width: 10,
      height: 30,
    });
  });

  it("rejects invalid grid domains and distinguishes aligned persisted values", () => {
    expect(() => snapGridCoordinate(Number.NaN, 10)).toThrow(
      "Grid normalization requires finite coordinates",
    );
    expect(() => snapGridCoordinate(10, 2.5)).toThrow("positive integer grid");
    expect(isGridAlignedCoordinate(-20, 10)).toBe(true);
    expect(isGridAlignedCoordinate(-21, 10)).toBe(false);
    expect(isGridAlignedCoordinate(20, 0)).toBe(false);
  });
});
