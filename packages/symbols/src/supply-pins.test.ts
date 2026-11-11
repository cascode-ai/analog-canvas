import { describe, expect, it } from "vitest";

import { builtInSymbols } from "./builtins.js";
import { createSymbolCatalog } from "./resolver.js";
import type { SymbolPrimitive } from "./schema.js";
import {
  adaptiveSignalFlowSupplyLeads,
  resolveAdaptiveSignalFlowBlockLayout,
  resolveSignalFlowPinAt,
} from "./signal-flow-layout.js";

type Point = { x: number; y: number };

/**
 * Where each block draws VDD and VSS when shown (#1833, #1941): on whole
 * grid points above and below its body, as `[VDD, VSS]`.
 */
const TRIANGLE: [Point, Point] = [
  { x: 0, y: -30 },
  { x: 0, y: 30 },
];
const FAMILIES: [RegExp, [Point, Point]][] = [
  // The single-ended op-amps: plain or lettered, compact or Wide, either
  // input order; the comparators and the voltage amplifiers.
  [/^opamp(?:-wide)?(?:-lettered)?(?:-inputs-swapped)?$/u, TRIANGLE],
  [/^comparator(?:-unmarked)?(?:-inputs-swapped)?$/u, TRIANGLE],
  [/^voltage-amplifier(?:-lettered)?$/u, TRIANGLE],
  // A differential form stands them clear of where its outputs leave.
  [
    /^(?:opamp|comparator)-differential(?!-wide)/u,
    [
      { x: -10, y: -30 },
      { x: -10, y: 30 },
    ],
  ],
  [
    /^opamp-differential-wide/u,
    [
      { x: -20, y: -30 },
      { x: -20, y: 30 },
    ],
  ],
  [
    /^(?:inverter|buffer|(?:and|nand|or|nor)-gate(?:-[34])?)$/u,
    [
      { x: -10, y: -20 },
      { x: -10, y: 20 },
    ],
  ],
  [
    /^x(?:n)?or-gate(?:-[34])?$/u,
    [
      { x: 0, y: -20 },
      { x: 0, y: 20 },
    ],
  ],
  [
    /^(?:differential-)?transconductance(?:-inputs-swapped)?$/u,
    [
      { x: 0, y: -40 },
      { x: 0, y: 40 },
    ],
  ],
  [
    /^d-flip-flop(?:-q)?$/u,
    [
      { x: 0, y: -40 },
      { x: 0, y: 40 },
    ],
  ],
  [
    /^d-flip-flop-reset$/u,
    [
      { x: 0, y: -40 },
      { x: -20, y: 50 },
    ],
  ],
  [
    /^delay-cell$/u,
    [
      { x: 0, y: -20 },
      { x: 0, y: 20 },
    ],
  ],
  [
    /^(?:adder|multiplier)$/u,
    [
      { x: 0, y: -20 },
      { x: 10, y: 20 },
    ],
  ],
  [/^(?:adc|dac)$/u, TRIANGLE],
];

const catalog = createSymbolCatalog(builtInSymbols);
const supplied = builtInSymbols.filter((symbol) =>
  symbol.variants.some((variant) => variant.id === "supply-pins"),
);
const expected = (symbolId: string) =>
  FAMILIES.find(([pattern]) => pattern.test(symbolId))?.[1];

/** Whether two segments cross or touch. */
function meet(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const [d1, d2, d3, d4] = [
    cross(c, d, a),
    cross(c, d, b),
    cross(a, b, c),
    cross(a, b, d),
  ];
  if (d1 === 0 && d2 === 0)
    // On one line: they meet only where their extents overlap.
    return (
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
        Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
        Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    );
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

describe("a block's supply pins", () => {
  it("are offered by every block that takes both supplies, and only one variant hides them", () => {
    expect(supplied.map((symbol) => symbol.id).sort()).toEqual(
      supplied
        .map((symbol) => symbol.id)
        .filter((id) => expected(id))
        .sort(),
    );
    expect(supplied).toHaveLength(65);
  });

  it.each(supplied.map((symbol) => symbol.id))(
    "%s draws VDD above and VSS below on leads from its body when they are shown",
    (symbolId) => {
      const shown = catalog.resolve(symbolId, "supply-pins")!;
      expect(shown.variant?.hiddenPinNames).toEqual([]);
      expect(shown.variant?.hiddenPrimitiveParts).toEqual([]);
      const [vdd, vss] = expected(symbolId)!;
      const pin = (name: string) =>
        shown.definition.pins.find((item) => item.name === name);
      expect(pin("VDD")).toMatchObject({
        role: "positive-supply",
        at: vdd,
        direction: "north",
      });
      expect(pin("VSS")).toMatchObject({
        role: "negative-supply",
        at: vss,
        direction: "south",
      });
      // Each lead runs from the body to its pin and meets no other stroke
      // but the body it leaves.
      const lines = shown.definition.primitives.filter(
        (primitive): primitive is Extract<SymbolPrimitive, { kind: "line" }> =>
          primitive.kind === "line",
      );
      for (const [part, at, sign] of [
        ["vdd-lead", vdd, -1],
        ["vss-lead", vss, 1],
      ] as const) {
        const lead = lines.find((line) => line.part === part)!;
        expect(lead.to).toEqual(at);
        expect(lead.from.x).toBe(at.x);
        expect(Math.sign(at.y - lead.from.y)).toBe(sign);
        for (const other of lines.filter((line) => line !== lead))
          expect(
            meet(lead.from, lead.to, other.from, other.to),
            `${part} meets ${other.part ?? "a stroke"}`,
          ).toBe(false);
      }
    },
  );

  it.each(supplied.map((symbol) => symbol.id))(
    "%s hides them, pins and leads, unless a drawing shows them",
    (symbolId) => {
      const plain = catalog.resolve(symbolId)!;
      expect(plain.variant?.id).toBe("signal-pins");
      expect(plain.variant?.hiddenPinNames).toEqual(["VDD", "VSS"]);
      expect(plain.variant?.hiddenPrimitiveParts).toEqual([
        "vdd-lead",
        "vss-lead",
      ]);
    },
  );

  it("follow a transconductor's body as its text grows it", () => {
    const definition = catalog.resolve("transconductance")!.definition;
    const vdd = definition.pins.find((pin) => pin.name === "VDD")!;
    const vss = definition.pins.find((pin) => pin.name === "VSS")!;
    // As drawn for its default text.
    expect(resolveSignalFlowPinAt(definition, vdd, undefined)).toEqual(vdd.at);
    const layout = resolveAdaptiveSignalFlowBlockLayout(definition, {
      bodyHeight: 100,
    })!;
    expect(
      resolveSignalFlowPinAt(definition, vdd, { bodyHeight: 100 }),
    ).toEqual({ x: 0, y: -50 });
    expect(
      resolveSignalFlowPinAt(definition, vss, { bodyHeight: 100 }),
    ).toEqual({ x: 0, y: 50 });
    expect(
      adaptiveSignalFlowSupplyLeads(definition, layout, []).map(
        ({ part, from, to }) => [part, from.y, to.y],
      ),
    ).toEqual([
      ["vdd-lead", -37.5, -50],
      ["vss-lead", 37.5, 50],
    ]);
    // Hidden, as by default, it draws neither.
    expect(
      adaptiveSignalFlowSupplyLeads(definition, layout, [
        "vdd-lead",
        "vss-lead",
      ]),
    ).toEqual([]);
  });
});
