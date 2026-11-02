import { describe, expect, it } from "vitest";

import { builtInSymbols } from "./builtins.js";
import { createSymbolCatalog } from "./resolver.js";

/** The single-ended op-amps: plain or lettered, compact or Wide, either input order. */
const OPAMPS = [
  "opamp",
  "opamp-lettered",
  "opamp-wide",
  "opamp-wide-lettered",
  "opamp-inputs-swapped",
  "opamp-lettered-inputs-swapped",
  "opamp-wide-inputs-swapped",
  "opamp-wide-lettered-inputs-swapped",
];

describe("an op-amp's supply pins", () => {
  const catalog = createSymbolCatalog(builtInSymbols);

  it.each(OPAMPS)(
    "%s draws VDD above and VSS below when its supply pins are shown",
    (symbolId) => {
      const shown = catalog.resolve(symbolId, "supply-pins");
      expect(shown?.variant?.hiddenPinNames).toEqual([]);
      const pin = (name: string) =>
        shown?.definition.pins.find((item) => item.name === name);
      expect(pin("VDD")).toMatchObject({
        at: { x: 0, y: -30 },
        direction: "north",
      });
      expect(pin("VSS")).toMatchObject({
        at: { x: 0, y: 30 },
        direction: "south",
      });
      // Each is drawn: a lead runs from the triangle's edge to the pin.
      const leads = shown!.definition.primitives.filter(
        (primitive) =>
          primitive.kind === "line" &&
          primitive.from.x === 0 &&
          primitive.to.x === 0,
      );
      expect(
        leads.map((lead) => lead.kind === "line" && [lead.from.y, lead.to.y]),
      ).toEqual([
        [-12.679492, -30],
        [12.679492, 30],
      ]);
      expect(shown!.variant?.hiddenPrimitiveParts).toEqual([]);
    },
  );

  it.each(OPAMPS)(
    "%s hides them, pins and leads, unless a drawing shows them",
    (symbolId) => {
      const plain = catalog.resolve(symbolId);
      expect(plain?.variant?.id).toBe("signal-pins");
      expect(plain?.variant?.hiddenPinNames).toEqual(["VDD", "VSS"]);
      const hidden = new Set(plain?.variant?.hiddenPrimitiveParts);
      const drawn = plain!.definition.primitives.filter(
        (primitive) => !primitive.part || !hidden.has(primitive.part),
      );
      expect(
        drawn.some(
          (primitive) =>
            primitive.kind === "line" &&
            primitive.from.x === 0 &&
            primitive.to.x === 0,
        ),
      ).toBe(false);
    },
  );
});
