import { describe, expect, it } from "vitest";
import {
  requireRazaviCatalogSymbol,
  razaviSymbolCatalogEntries,
} from "./razavi-catalog.js";

describe("Wide amplifier geometry", () => {
  const entries = razaviSymbolCatalogEntries.filter(
    (entry) => entry.generation?.kind === "derived-wide-amplifier",
  );
  it("offers exactly two Wide tiles and retains every configurable state", () => {
    expect(entries).toHaveLength(12);
    expect(
      entries.filter((entry) => entry.palette).map((entry) => entry.symbolId),
    ).toEqual(["opamp-wide", "opamp-differential-wide"]);
  });
  for (const entry of entries) {
    it(`keeps ${entry.symbolId} on-grid with unchanged pin identities and legible marks`, () => {
      const generation = entry.generation!;
      if (!("sourceSymbolId" in generation)) throw new Error("missing source");
      const compact = requireRazaviCatalogSymbol(generation.sourceSymbolId);
      const wide = requireRazaviCatalogSymbol(entry.symbolId);
      expect(
        wide.pins.map(({ name, role, direction }) => ({
          name,
          role,
          direction,
        })),
      ).toEqual(
        compact.pins.map(({ name, role, direction }) => ({
          name,
          role,
          direction,
        })),
      );
      expect(compact.pins.map((pin) => pin.at.y)).toEqual(
        wide.pins.map((pin) => pin.at.y / 2),
      );
      expect(
        Math.max(...wide.pins.map((pin) => pin.at.y)) -
          Math.min(...wide.pins.map((pin) => pin.at.y)),
      ).toBe(40);
      for (const pin of wide.pins) {
        expect(Math.abs(pin.at.x % 10)).toBe(0);
        expect(Math.abs(pin.at.y % 10)).toBe(0);
        expect(
          wide.primitives.some(
            (primitive) =>
              primitive.kind === "line" &&
              [primitive.from, primitive.to].some(
                (point) => point.x === pin.at.x && point.y === pin.at.y,
              ),
          ),
        ).toBe(true);
      }
      const marks = (symbol: typeof wide) =>
        symbol.primitives.filter((primitive) =>
          primitive.part?.includes("polarity"),
        );
      expect(marks(wide).map((mark) => mark.style)).toEqual(
        marks(compact).map((mark) => mark.style),
      );
      const outline = wide.primitives.find(
        (primitive) => primitive.kind === "path",
      );
      expect(outline).toEqual(
        compact.primitives.find((primitive) => primitive.kind === "path"),
      );
      if (outline?.kind !== "path") throw new Error("triangle missing");
      expect(outline.bounds?.height).toBe(60);
      expect(outline.bounds?.width).toBeCloseTo(30 * Math.sqrt(3), 5);
      for (const mark of marks(wide)) {
        if (mark.kind !== "line") throw new Error("polarity must be a line");
        expect(
          Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y),
        ).toBe(6);
      }
      expect(wide.formulaPresentation?.defaultFormula).toBe(
        compact.formulaPresentation?.defaultFormula,
      );
      expect(wide.formulaPresentation?.fontSize).toBe(
        compact.formulaPresentation?.fontSize,
      );
    });
  }
});
