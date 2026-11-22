import { describe, expect, it } from "vitest";
import {
  requireRazaviCatalogSymbol,
  razaviSymbolCatalogEntries,
} from "./razavi-catalog.js";

describe("Wide amplifier geometry", () => {
  const entries = razaviSymbolCatalogEntries.filter(
    (entry) => entry.generation?.kind === "derived-wide-amplifier",
  );
  it("shows only the plain and crossed Wide amplifiers in the Library", () => {
    // The crossed FD amp is the one the Library shows; the straight one
    // stays for the Agent and for drawings.
    expect(
      entries.filter((entry) => entry.palette).map((entry) => entry.symbolId),
    ).toEqual([
      "opamp-wide",
      "opamp-differential-wide",
      "opamp-differential-wide-crossed",
    ]);
  });
  for (const entry of entries) {
    it(`keeps ${entry.symbolId} on-grid with unchanged pin identities and legible marks`, () => {
      const generation = entry.generation!;
      if (!("sourceSymbolId" in generation)) throw new Error("missing source");
      const compact = requireRazaviCatalogSymbol(generation.sourceSymbolId);
      const wide = requireRazaviCatalogSymbol(entry.symbolId);
      // A fully differential form's VOCM leaves the apex, where its compact
      // form's leaves the bottom edge (#2443).
      const vocm = (pin: (typeof wide.pins)[number]) => pin.name === "VOCM";
      expect(
        wide.pins.map(({ name, role, direction }) => ({
          name,
          role,
          direction: name === "VOCM" ? "south" : direction,
        })),
      ).toEqual(
        compact.pins.map(({ name, role, direction }) => ({
          name,
          role,
          direction,
        })),
      );
      expect(wide.pins.filter(vocm).map((pin) => pin.at)).toEqual(
        compact.pins.filter(vocm).map(() => ({ x: 30, y: 0 })),
      );
      // Wide spreads the signal pins; the supplies stay at the body's extent,
      // where the compact form draws them (#1833), but a differential form's
      // stand at x -20, clear of its outputs (#1941).
      const supply = (pin: (typeof wide.pins)[number]) =>
        pin.role.endsWith("-supply") || vocm(pin);
      const signals = (symbol: typeof wide) =>
        symbol.pins.filter((pin) => !supply(pin));
      expect(signals(compact).map((pin) => pin.at.y)).toEqual(
        signals(wide).map((pin) => pin.at.y / 2),
      );
      expect(
        Math.max(...signals(wide).map((pin) => pin.at.y)) -
          Math.min(...signals(wide).map((pin) => pin.at.y)),
      ).toBe(40);
      const differential = wide.pins.some((pin) => pin.name === "OUT+");
      const supplyOnly = (pin: (typeof wide.pins)[number]) =>
        supply(pin) && !vocm(pin);
      expect(wide.pins.filter(supplyOnly)).toEqual(
        compact.pins
          .filter(supplyOnly)
          .map((pin) =>
            differential ? { ...pin, at: { ...pin.at, x: -20 } } : pin,
          ),
      );
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
      expect(wide.formulaPresentation?.defaultFormula).toBe(
        compact.formulaPresentation?.defaultFormula,
      );
      expect(wide.formulaPresentation?.fontSize).toBe(
        compact.formulaPresentation?.fontSize,
      );
    });
  }
});
