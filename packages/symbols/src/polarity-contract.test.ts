import { describe, expect, it } from "vitest";
import { builtInSymbols } from "./builtins.js";

describe("signed component artwork agrees with electrical pin identity", () => {
  for (const symbol of builtInSymbols.filter((symbol) =>
    symbol.primitives.some((primitive) => primitive.part === "input-polarity"),
  )) {
    it(`${symbol.id} puts each sign beside the input or output it names`, () => {
      for (const side of ["input", "output"] as const) {
        const positive = symbol.primitives.filter(
          (primitive) => primitive.part === `${side}-polarity`,
        );
        const negative = symbol.primitives.filter(
          (primitive) => primitive.part === `upright-${side}-polarity-negative`,
        );
        if (positive.length === 0 && negative.length === 0) continue;
        expect(positive).toHaveLength(2);
        expect(negative).toHaveLength(1);
        const positivePin = symbol.pins.find(
          (pin) => pin.name === (side === "input" ? "IN+" : "OUT+"),
        )!;
        const negativePin = symbol.pins.find(
          (pin) => pin.name === (side === "input" ? "IN-" : "OUT-"),
        )!;
        const middle = (positivePin.at.y + negativePin.at.y) / 2;
        for (const [strokes, pin] of [
          [positive, positivePin],
          [negative, negativePin],
        ] as const) {
          for (const stroke of strokes) {
            if (stroke.kind !== "line") throw new Error("Sign must be a line");
            const markY = (stroke.from.y + stroke.to.y) / 2;
            expect(Math.sign(markY - middle)).toBe(
              Math.sign(pin.at.y - middle),
            );
          }
        }
      }
    });
  }
});
