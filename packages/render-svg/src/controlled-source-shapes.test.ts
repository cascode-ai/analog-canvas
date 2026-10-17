import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { renderSymbolDefinitionBody } from "./symbol-render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("controlled voltage source artwork", () => {
  it.each(["vcvs", "ccvs"])(
    "%s defaults to a circle and optionally renders a diamond with unchanged voltage polarity and terminals",
    (symbolId) => {
      const symbol = resolver.resolve(symbolId)!.definition;
      const voltage = resolver.resolve("voltage-source")!.definition;
      const circleSvg = renderSymbolDefinitionBody(symbol);
      expect(circleSvg).toContain("<circle");
      expect(circleSvg).not.toContain("<polygon");
      expect(
        symbol.primitives.find((primitive) => primitive.kind === "circle"),
      ).toMatchObject(
        voltage.primitives.find((primitive) => primitive.kind === "circle")!,
      );
      const variant = resolver.resolve(symbolId, "diamond")!.variant!;
      const svg = renderSymbolDefinitionBody(
        symbol,
        variant.hiddenPrimitiveParts,
        variant.additionalPrimitives,
      );
      expect(svg).toContain("<polygon");
      expect(svg).not.toContain("<circle");
      expect(
        variant.additionalPrimitives!.filter(
          (primitive) => primitive.kind === "polygon",
        ),
      ).toEqual([
        expect.objectContaining({
          points: [
            { x: 0, y: -12.5 },
            { x: 12.5, y: 0 },
            { x: 0, y: 12.5 },
            { x: -12.5, y: 0 },
          ],
          fill: "none",
          stroke: "foreground",
          style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
        }),
      ]);
      const polarity = (definition: typeof symbol) =>
        definition.primitives.filter((primitive) =>
          primitive.part?.startsWith("upright-polarity-"),
        );
      expect(polarity(symbol)).toEqual(polarity(voltage));
      expect(polarity(symbol)).toHaveLength(3);
      expect(symbol.pins).toEqual(voltage.pins);
      expect(symbol.viewBox).toEqual(voltage.viewBox);
      for (const mark of polarity(symbol))
        expect(svg).toContain(`data-part="${mark.part}"`);
    },
  );
});
