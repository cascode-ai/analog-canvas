import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import {
  builtInSymbols,
  InMemorySymbolResolver,
  type ResolvedSymbol,
} from "@icm/symbols";

import {
  instanceVisibleHitBox,
  visibleSymbolLocalBounds,
} from "./instance-geometry";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const adaptiveDefinition = {
  schemaVersion: 1 as const,
  id: "formula-block",
  name: "Formula block",
  viewBox: { x: -40, y: -20, width: 80, height: 40 },
  pins: [
    {
      name: "A",
      role: "input",
      at: { x: -40, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 40, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
  ],
  primitives: [],
  variants: [],
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true as const,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 40,
      minBodyHeight: 30,
      horizontalPadding: 8,
      verticalPadding: 1.5,
      leadLength: 20,
    },
  },
};

describe("selection geometry", () => {
  it("measures every Analog Block and its letter/polarity variants without source-crop whitespace", () => {
    const blocks = builtInSymbols.filter(
      (symbol) =>
        /^(?:opamp|voltage-amplifier|comparator|differential-transconductance)(?:-|$)/u.test(
          symbol.id,
        ) || ["transconductance", "adc", "dac"].includes(symbol.id),
    );
    expect(blocks).toHaveLength(39);
    for (const symbol of blocks) {
      const bounds = visibleSymbolLocalBounds(resolver.resolve(symbol.id)!);
      // All triangular Analog Blocks now share the accepted x=30 output
      // column; these envelopes must follow that placement, including FD.
      const expected = /^(?:opamp|voltage-amplifier|comparator)/u.test(
        symbol.id,
      )
        ? { x: -44, y: -34, width: 78, height: 68 }
        : symbol.id.startsWith("differential-transconductance")
          ? { x: -34, y: -39, width: 68, height: 78 }
          : symbol.id === "adc"
            ? { x: -51.5, y: -21.5, width: 93, height: 43 }
            : symbol.id === "dac"
              ? { x: -41.5, y: -21.5, width: 93, height: 43 }
              : { x: -30, y: -35, width: 60, height: 70 };
      expect(bounds, symbol.id).toEqual(expected);
    }
  });

  it.each([
    [0, "none", { x: 56, y: 166, width: 78, height: 68 }],
    [0, "horizontal", { x: 66, y: 166, width: 78, height: 68 }],
    [90, "none", { x: 66, y: 156, width: 68, height: 78 }],
    [270, "none", { x: 66, y: 166, width: 68, height: 78 }],
  ] as const)(
    "keeps the asymmetric FD Amp bounds aligned at rotation %s and mirror %s",
    (rotation, mirror, expected) => {
      const bounds = instanceVisibleHitBox(
        {
          id: "U1",
          symbolId: "opamp-differential",
          placement: { position: { x: 100, y: 200 }, rotation, mirror },
        },
        resolver.resolve("opamp-differential")!,
      );
      expect(bounds).toEqual(expected);
    },
  );

  it("honors the resistor's existing path bounds and keeps unknown paths conservative", () => {
    const resistor = resolver.resolve("resistor")!;
    const bounds = visibleSymbolLocalBounds(resistor);
    expect(bounds.width).toBeCloseTo(18.360465);
    expect(bounds.height).toBe(48);
    const unbounded = structuredClone(resolver.resolve("opamp")!);
    for (const primitive of unbounded.definition.primitives)
      if (primitive.kind === "path") {
        delete primitive.bounds;
        delete primitive.fillableBody;
      }
    expect(visibleSymbolLocalBounds(unbounded)).toEqual(
      unbounded.definition.viewBox,
    );
  });

  it("uses the reviewed DFF artwork envelope instead of source-crop whitespace", () => {
    const resolved = resolver.resolve("d-flip-flop");
    expect(resolved).toBeDefined();
    expect(visibleSymbolLocalBounds(resolved!)).toEqual({
      x: -42,
      y: -27,
      width: 84,
      height: 54,
    });
    // Its shown supply stubs stand past that box, and select it too (#1941).
    expect(
      visibleSymbolLocalBounds(resolver.resolve("d-flip-flop", "supply-pins")!),
    ).toEqual({ x: -42, y: -40, width: 84, height: 80 });
  });

  it("selects a part from every stub of its shown supplies, and as placed keeps its box (#1941)", () => {
    const contains = (
      box: { x: number; y: number; width: number; height: number },
      point: { x: number; y: number },
    ) =>
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height;
    const supplied = builtInSymbols.filter((symbol) =>
      symbol.variants.some((variant) => variant.id === "supply-pins"),
    );
    expect(supplied).toHaveLength(65);
    for (const symbol of supplied) {
      const placement = {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      };
      const shown = resolver.resolve(symbol.id, "supply-pins")!;
      const hit = instanceVisibleHitBox(
        {
          id: "X1",
          symbolId: symbol.id,
          symbolVariantId: "supply-pins",
          placement,
        },
        shown,
      )!;
      for (const primitive of shown.definition.primitives)
        if (
          primitive.kind === "line" &&
          (primitive.part === "vdd-lead" || primitive.part === "vss-lead")
        )
          for (const point of [primitive.from, primitive.to])
            expect(
              contains(hit, { x: point.x + 100, y: point.y + 100 }),
              `${symbol.id} ${primitive.part}`,
            ).toBe(true);
      // Hidden, as placed, it keeps the box it had: the signal artwork's.
      const plain = resolver.resolve(symbol.id)!;
      const signalOnly = {
        ...plain,
        definition: {
          ...plain.definition,
          pins: plain.definition.pins.filter(
            (pin) => !["VDD", "VSS"].includes(pin.name),
          ),
          primitives: plain.definition.primitives.filter(
            (primitive) =>
              primitive.part !== "vdd-lead" && primitive.part !== "vss-lead",
          ),
        },
      };
      expect(visibleSymbolLocalBounds(plain), symbol.id).toEqual(
        visibleSymbolLocalBounds(signalOnly),
      );
    }
  });

  it("uses adaptive formula dimensions for local and transformed hit bounds", () => {
    const resolved = new InMemorySymbolResolver([adaptiveDefinition]).resolve(
      "formula-block",
    ) as ResolvedSymbol;
    const parameters = {
      formula: "very_long_custom_transfer_function",
      bodyWidth: 140,
      bodyHeight: 90,
    };
    const local = visibleSymbolLocalBounds(resolved, parameters);
    expect(local.width).toBeGreaterThan(140);
    expect(local.height).toBe(90);

    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "B1",
      symbolId: "formula-block",
      placement: { position: { x: 100, y: 100 }, rotation: 90, mirror: "none" },
      signalFlowParameters: parameters,
    });
    const hit = instanceVisibleHitBox(document.instances[0]!, resolved);
    expect(hit).not.toBeNull();
    expect(hit!.width).toBeCloseTo(local.height);
    expect(hit!.height).toBeCloseTo(local.width);
  });
});
