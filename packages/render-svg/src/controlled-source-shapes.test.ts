import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { renderSymbolDefinitionBody } from "./symbol-render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("controlled voltage source artwork", () => {
  it.each(["vcvs", "ccvs"])(
    "%s renders a normal-stroke diamond with voltage polarity and unchanged terminals",
    (symbolId) => {
      const symbol = resolver.resolve(symbolId)!.definition;
      const voltage = resolver.resolve("voltage-source")!.definition;
      const svg = renderSymbolDefinitionBody(symbol);
      expect(svg).toContain("<polygon");
      expect(svg).not.toContain("<circle");
      expect(
        symbol.primitives.filter((primitive) => primitive.kind === "polygon"),
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
