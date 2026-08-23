import { builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  differentialInputSibling,
  planDifferentialInputSwap,
} from "./differential-input-swap";

describe("differential input swap", () => {
  it("pairs every marked amplifier with its swapped sibling, both ways", () => {
    expect(differentialInputSibling("comparator")).toBe(
      "comparator-inputs-swapped",
    );
    expect(differentialInputSibling("comparator-inputs-swapped")).toBe(
      "comparator",
    );
    expect(differentialInputSibling("opamp-differential-crossed")).toBe(
      "opamp-differential-crossed-inputs-swapped",
    );
    expect(differentialInputSibling("resistor")).toBeUndefined();
  });

  it("names one Symbol exchange, leaving placement alone", () => {
    expect(planDifferentialInputSwap("X1", "opamp")).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "X1",
        symbolId: "opamp-inputs-swapped",
      },
    ]);
    expect(planDifferentialInputSwap("X1", "resistor")).toEqual([]);
  });

  it("covers every Symbol the swap action is offered on", () => {
    // The button appears for any Symbol with a marked differential pair. One
    // without a sibling would show a control that does nothing.
    const marked = builtInSymbols.filter((symbol) => {
      const roles = new Set(symbol.pins.map((pin) => pin.role));
      return roles.has("non-inverting-input") && roles.has("inverting-input");
    });
    expect(marked.length).toBeGreaterThan(0);
    for (const symbol of marked) {
      expect(differentialInputSibling(symbol.id)).toBeDefined();
    }
  });

  it("swaps the marks and the input pins, and nothing else", () => {
    const byId = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
    for (const id of ["comparator", "opamp-differential"]) {
      const source = byId.get(id)!;
      const swapped = byId.get(differentialInputSibling(id)!)!;

      const inputs = (symbol: typeof source) =>
        symbol.pins
          .filter((pin) => pin.role.endsWith("inverting-input"))
          .map((pin) => `${pin.name}@${pin.at.y}`)
          .sort();
      // Same names, opposite sides.
      expect(inputs(swapped)).toEqual(
        source.pins
          .filter((pin) => pin.role.endsWith("inverting-input"))
          .map((pin) => `${pin.name}@${-pin.at.y}`)
          .sort(),
      );
      // Outputs hold still: swapping inputs is not a reflection.
      const outputs = (symbol: typeof source) =>
        symbol.pins
          .filter((pin) => pin.role === "output")
          .map((pin) => `${pin.name}@${pin.at.x},${pin.at.y}`);
      expect(outputs(swapped)).toEqual(outputs(source));
      // Exactly the three polarity strokes move; the body and, for the
      // comparator, its transfer-characteristic glyph are untouched.
      const changed = source.primitives.filter(
        (primitive, index) =>
          JSON.stringify(primitive) !==
          JSON.stringify(swapped.primitives[index]),
      );
      expect(changed).toHaveLength(3);
    }
  });
});
