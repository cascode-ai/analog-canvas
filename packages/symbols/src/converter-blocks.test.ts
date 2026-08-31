import { describe, expect, it } from "vitest";

import { requireRazaviCatalogSymbol } from "./razavi-catalog.js";
import { SYMBOL_CONNECTION_GRID, SymbolDefinitionSchema } from "./schema.js";

const CONVERTERS = ["adc", "dac"] as const;

function bodyPolygon(symbolId: string) {
  const symbol = requireRazaviCatalogSymbol(symbolId);
  const polygon = symbol.primitives.find(
    (primitive) => primitive.kind === "polygon",
  );
  expect(polygon, `${symbolId} body`).toBeDefined();
  return polygon as Extract<typeof polygon, { kind: "polygon" }>;
}

describe("converter blocks", () => {
  it("draws a five-sided arrow that points the way the conversion runs", () => {
    const adc = bodyPolygon("adc");
    const dac = bodyPolygon("dac");
    expect(adc.points).toHaveLength(5);
    expect(dac.points).toHaveLength(5);
    // The tip is the lone vertex on the mid-line; the ADC's sits left, the
    // DAC's right, so a signal chain reads in both directions.
    const tip = (points: readonly { x: number; y: number }[]) =>
      points.find((point) => point.y === 0)!.x;
    expect(tip(adc.points)).toBeLessThan(0);
    expect(tip(dac.points)).toBeGreaterThan(0);
  });

  it("keeps the body empty, like every other symbol on the sheet", () => {
    for (const id of CONVERTERS) {
      expect(bodyPolygon(id).fill).toBe("none");
    }
  });

  it("lands its pins on the grid and keeps the leads short", () => {
    for (const id of CONVERTERS) {
      const symbol = requireRazaviCatalogSymbol(id);
      expect(symbol.pins.map((pin) => pin.name)).toEqual(["IN", "OUT"]);
      for (const pin of symbol.pins) {
        expect(
          Math.abs(pin.at.x) % SYMBOL_CONNECTION_GRID,
          `${id} ${pin.name} anchor`,
        ).toBe(0);
        expect(pin.at.y).toBe(0);
        expect(
          pin.presentation.leadLength,
          `${id} ${pin.name} lead`,
        ).toBeLessThanOrEqual(10);
      }
    }
  });

  it("draws the body as a polygon so bounds come from the artwork", () => {
    // visibleSymbolLocalBounds falls back to the declaration viewBox for a
    // `path` body; a polygon is measured from its own points, so the hit box
    // hugs the arrow the way every other primitive-drawn Symbol's does.
    for (const id of CONVERTERS) {
      const symbol = requireRazaviCatalogSymbol(id);
      expect(
        symbol.primitives.some((primitive) => primitive.kind === "path"),
        `${id} must not use a path body`,
      ).toBe(false);
      const points = bodyPolygon(id).points;
      const extentX = Math.max(...points.map((point) => Math.abs(point.x)));
      expect(extentX).toBeLessThan(symbol.viewBox.width / 2);
    }
  });

  it("carries an editable body label defaulting to its own name", () => {
    for (const [id, text] of [
      ["adc", "ADC"],
      ["dac", "DAC"],
    ] as const) {
      const presentation = requireRazaviCatalogSymbol(id).formulaPresentation;
      expect(presentation, `${id} body text`).toBeDefined();
      expect(presentation!.defaultFormula).toBe(text);
      // Naming a block is not scaling it.
      expect(presentation!.supportsCoefficient).toBe(false);
    }
  });

  it("parses under the Symbol contract", () => {
    for (const id of CONVERTERS) {
      const symbol = requireRazaviCatalogSymbol(id);
      expect(SymbolDefinitionSchema.parse(symbol)).toEqual(symbol);
    }
  });
});
