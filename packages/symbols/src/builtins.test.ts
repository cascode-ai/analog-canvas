import { transformPoint } from "@icm/model";
import { describe, expect, it } from "vitest";

import { builtInSymbols } from "./builtins.js";
import { razaviProductSymbols } from "./razavi-catalog.js";
import { InMemorySymbolResolver } from "./resolver.js";
import { SYMBOL_CONNECTION_GRID, SymbolDefinitionSchema } from "./schema.js";

const PRODUCT_IDS = [
  "and-gate",
  "capacitor",
  "closed-switch",
  "comparator",
  "current-source",
  "diode",
  "ground",
  "ideal-switch",
  "inductor",
  "inductor-compact",
  "inverter",
  "nand-gate",
  "nmos",
  "nor-gate",
  "npn",
  "opamp",
  "opamp-differential",
  "opamp-differential-crossed",
  "or-gate",
  "pmos",
  "pnp",
  "port",
  "port-filled",
  "resistor",
  "variable-capacitor",
  "variable-inductor",
  "variable-resistor",
  "vdd-port",
  "voltage-amplifier",
  "voltage-source",
  "xnor-gate",
  "xor-gate",
] as const;

describe("Razavi-only product Symbol Library", () => {
  it("contains exactly the reviewed Razavi product symbols", () => {
    expect(razaviProductSymbols.map((symbol) => symbol.id)).toEqual(
      PRODUCT_IDS,
    );
    for (const symbol of builtInSymbols) {
      expect(SymbolDefinitionSchema.parse(symbol)).toEqual(symbol);
    }
  });

  it("resolves the reviewed Symbols an action reaches but nobody browses", () => {
    // Swapping an amplifier's inputs or outputs exchanges the Instance's
    // Symbol for a sibling. Those siblings stay out of the Library, so the
    // runtime library has to be wider than the Library's own list.
    const resolvable = new Set(builtInSymbols.map((symbol) => symbol.id));
    const browsable = new Set(razaviProductSymbols.map((symbol) => symbol.id));
    for (const id of [
      "comparator-inputs-swapped",
      "opamp-inputs-swapped",
      "opamp-differential-inputs-swapped",
      "opamp-differential-crossed-inputs-swapped",
    ]) {
      expect(resolvable.has(id)).toBe(true);
      expect(browsable.has(id)).toBe(false);
    }
    for (const id of browsable) expect(resolvable.has(id)).toBe(true);
  });

  it("does not resolve removed compatibility or generic symbols", () => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    for (const symbolId of [
      "poly-resistor",
      "generic-block-4",
      "legacy-switch-open",
    ]) {
      expect(resolver.resolve(symbolId), symbolId).toBeUndefined();
    }
  });

  it("keeps every electrical pin on the canonical connection grid", () => {
    for (const symbol of builtInSymbols) {
      for (const pin of symbol.pins) {
        expect(
          {
            symbolId: symbol.id,
            pinName: pin.name,
            xRemainder: Math.abs(pin.at.x % SYMBOL_CONNECTION_GRID),
            yRemainder: Math.abs(pin.at.y % SYMBOL_CONNECTION_GRID),
          },
          `${symbol.id}.${pin.name} must land on the connection grid`,
        ).toMatchObject({ xRemainder: 0, yRemainder: 0 });
      }
    }
  });

  it("keeps multi-port pins on-grid after rotation and mirror", () => {
    const placements = [
      { rotation: 0 as const, mirror: "none" as const },
      { rotation: 90 as const, mirror: "none" as const },
      { rotation: 180 as const, mirror: "x" as const },
      { rotation: 270 as const, mirror: "x" as const },
    ];
    for (const symbol of builtInSymbols.filter(
      (candidate) => candidate.pins.length > 2,
    )) {
      for (const placement of placements) {
        for (const pin of symbol.pins) {
          const point = transformPoint(pin.at, { x: 120, y: 230 }, placement);
          expect(Math.abs(point.x % SYMBOL_CONNECTION_GRID)).toBe(0);
          expect(Math.abs(point.y % SYMBOL_CONNECTION_GRID)).toBe(0);
        }
      }
    }
  });

  it("preserves MOS electrical bulk pins in textbook variants", () => {
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    for (const symbolId of ["nmos", "pmos"]) {
      const resolved = resolver.resolve(symbolId, "textbook-3terminal");
      expect(resolved?.definition.pins.map((pin) => pin.name)).toEqual([
        "D",
        "G",
        "S",
        "B",
      ]);
      expect(resolved?.variant?.hiddenPinNames).toEqual(["B"]);
    }
  });
});
