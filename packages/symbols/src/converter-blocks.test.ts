import { describe, expect, it } from "vitest";

import { requireRazaviCatalogSymbol } from "./razavi-catalog.js";
import { SYMBOL_STANDARD_GRID } from "@icm/model";

const CONVERTERS = ["adc", "dac"] as const;
const DIFFERENTIAL = [
  { id: "adc-differential", base: "adc", pins: ["IN+", "IN-", "OUT"] },
  { id: "dac-differential", base: "dac", pins: ["IN", "OUT+", "OUT-"] },
] as const;

type Point = { readonly x: number; readonly y: number };

/** On one of the outline's edges, not merely inside its box. */
function onOutline(point: Point, outline: readonly Point[]): boolean {
  return outline.some((from, index) => {
    const to = outline[(index + 1) % outline.length]!;
    const cross =
      (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    return (
      Math.abs(cross) < 1e-9 &&
      point.x >= Math.min(from.x, to.x) &&
      point.x <= Math.max(from.x, to.x) &&
      point.y >= Math.min(from.y, to.y) &&
      point.y <= Math.max(from.y, to.y)
    );
  });
}

/** Strictly inside a convex outline. */
function inside(point: Point, outline: readonly Point[]): boolean {
  const sides = outline.map((from, index) => {
    const to = outline[(index + 1) % outline.length]!;
    return Math.sign(
      (to.x - from.x) * (point.y - from.y) -
        (to.y - from.y) * (point.x - from.x),
    );
  });
  return sides.every((side) => side === sides[0] && side !== 0);
}

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
    // The point advances two grid cells from the shoulder, giving the
    // converter direction a visibly sharper tip without off-grid geometry.
    const shoulder = (points: readonly { x: number; y: number }[]) =>
      points.find((point) => point.y < 0 && Math.abs(point.x) === 20)!.x;
    expect(Math.abs(tip(adc.points) - shoulder(adc.points))).toBe(
      SYMBOL_STANDARD_GRID * 2,
    );
    expect(Math.abs(tip(dac.points) - shoulder(dac.points))).toBe(
      SYMBOL_STANDARD_GRID * 2,
    );
  });

  it("keeps the body empty, like every other symbol on the sheet", () => {
    for (const id of CONVERTERS) {
      expect(bodyPolygon(id).fill).toBe("none");
    }
  });

  it("lands every body vertex and external terminal on the grid", () => {
    for (const id of CONVERTERS) {
      const symbol = requireRazaviCatalogSymbol(id);
      // Its signal pins; supply-pins.test.ts places VDD and VSS (#1941).
      const signals = symbol.pins.filter(
        (pin) => !pin.role.endsWith("-supply"),
      );
      expect(signals.map((pin) => pin.name)).toEqual(["IN", "OUT"]);
      for (const point of bodyPolygon(id).points) {
        expect(Math.abs(point.x) % SYMBOL_STANDARD_GRID, `${id} body x`).toBe(
          0,
        );
        expect(Math.abs(point.y) % SYMBOL_STANDARD_GRID, `${id} body y`).toBe(
          0,
        );
      }
      for (const pin of signals) {
        expect(
          Math.abs(pin.at.x) % SYMBOL_STANDARD_GRID,
          `${id} ${pin.name} anchor`,
        ).toBe(0);
        expect(pin.at.y).toBe(0);
        expect(pin.presentation.leadLength, `${id} ${pin.name} lead`).toBe(
          SYMBOL_STANDARD_GRID,
        );

        const lead = symbol.primitives.find(
          (primitive) =>
            primitive.kind === "line" &&
            ((primitive.from.x === pin.at.x && primitive.from.y === pin.at.y) ||
              (primitive.to.x === pin.at.x && primitive.to.y === pin.at.y)),
        );
        expect(lead, `${id} ${pin.name} artwork`).toBeDefined();
        if (!lead || lead.kind !== "line") continue;
        expect(
          Math.hypot(lead.to.x - lead.from.x, lead.to.y - lead.from.y),
          `${id} ${pin.name} drawn lead`,
        ).toBe(SYMBOL_STANDARD_GRID);
      }
    }
  });

  it("draws the body as a polygon so bounds come from the artwork", () => {
    // visibleSymbolLocalBounds falls back to the declaration viewBox for an
    // unbounded `path` body; a polygon is measured from its own points, so the hit box
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

  it("draws each differential sibling as its converter's arrow and label", () => {
    for (const { id, base } of DIFFERENTIAL) {
      expect(bodyPolygon(id).points).toEqual(bodyPolygon(base).points);
      expect(requireRazaviCatalogSymbol(id).formulaPresentation).toEqual(
        requireRazaviCatalogSymbol(base).formulaPresentation,
      );
    }
  });

  it("brings a differential pair to the slanted faces, 20 apart, its pins in the single pin's column", () => {
    for (const { id, base, pins } of DIFFERENTIAL) {
      const symbol = requireRazaviCatalogSymbol(id);
      expect(symbol.pins.map((pin) => pin.name)).toEqual(pins);
      const pair = symbol.pins.filter((pin) => /[+-]$/u.test(pin.name));
      expect(pair.map((pin) => pin.at.y)).toEqual([10, -10]);
      // One cell beyond the point, where the single-ended converter's pin
      // on that side is: wires arrive clear of the point.
      const single = requireRazaviCatalogSymbol(base).pins.find(
        (pin) => pin.direction === pair[0]!.direction,
      )!;
      for (const pin of pair) expect(pin.at.x).toBe(single.at.x);
      const outline = bodyPolygon(id).points;
      for (const pin of symbol.pins) {
        const lead = symbol.primitives.find(
          (primitive) =>
            primitive.kind === "line" &&
            [primitive.from, primitive.to].some(
              (end) => end.x === pin.at.x && end.y === pin.at.y,
            ),
        );
        if (!lead || lead.kind !== "line")
          throw new Error(`${id} ${pin.name} has no lead`);
        const contact =
          lead.from.x === pin.at.x && lead.from.y === pin.at.y
            ? lead.to
            : lead.from;
        expect(contact.y, `${id} ${pin.name} lead`).toBe(pin.at.y);
        expect(pin.presentation.leadLength).toBe(
          Math.abs(contact.x - pin.at.x),
        );
        expect(onOutline(contact, outline), `${id} ${pin.name} contact`).toBe(
          true,
        );
      }
    }
  });

  it("marks + and − inside the body, on the rows of the pins they name", () => {
    for (const { id } of DIFFERENTIAL) {
      const symbol = requireRazaviCatalogSymbol(id);
      const outline = bodyPolygon(id).points;
      const marks = symbol.primitives.filter((primitive) =>
        primitive.part?.includes("polarity"),
      );
      expect(marks).toHaveLength(3);
      const row = (name: string) =>
        symbol.pins.find((pin) => pin.name.endsWith(name))!.at.y;
      for (const mark of marks) {
        if (mark.kind !== "line") throw new Error(`${id} mark is not a line`);
        const y = (mark.from.y + mark.to.y) / 2;
        expect(y).toBe(row(mark.part!.endsWith("negative") ? "-" : "+"));
        expect(inside(mark.from, outline) && inside(mark.to, outline)).toBe(
          true,
        );
      }
    }
  });
});
