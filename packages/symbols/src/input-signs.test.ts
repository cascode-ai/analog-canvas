import { describe, expect, it } from "vitest";
import type { Orientation } from "@icm/model";

import { builtInSymbols } from "./builtins.js";
import { resolveInstanceSymbol, withInputSigns } from "./input-signs.js";
import { InMemorySymbolResolver } from "./resolver.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const bare = resolver.resolve("adder")!;

function adder(
  parameters?: Record<string, string>,
  orientation: Orientation = { rotation: 0, mirror: "none" },
) {
  return {
    symbolId: "adder",
    placement: { position: { x: 100, y: 80 }, ...orientation },
    ...(parameters ? { netlist: { parameters } } : {}),
  };
}

/** The lines the Instance draws beyond its Symbol's own artwork. */
function marks(parameters: Record<string, string>, orientation?: Orientation) {
  return withInputSigns(bare, adder(parameters, orientation))
    .definition.primitives.slice(bare.definition.primitives.length)
    .map((mark) => {
      if (mark.kind !== "line") throw new Error(`${mark.kind} mark`);
      return mark;
    });
}

describe("adder input signs", () => {
  it("are the Instance's presentation: the Symbol's artwork has none", () => {
    expect(
      bare.definition.primitives.filter((primitive) =>
        /sign/u.test(primitive.part ?? ""),
      ),
    ).toEqual([]);
    // Adding both inputs draws nothing: the resolved Symbol itself.
    expect(withInputSigns(bare, adder())).toBe(bare);
    expect(withInputSigns(bare, adder({ signA: "+", signB: "+" }))).toBe(bare);
    // Only the adder reads them.
    const resistor = resolver.resolve("resistor")!;
    expect(
      withInputSigns(resistor, {
        netlist: { parameters: { signA: "-", signB: "-" } },
      }),
    ).toBe(resistor);
  });

  it("sit where Razavi's Figure 21.38 draws them, 7.6 units wide", () => {
    // Measured on the witness at 1.3 px per unit about the circle's centre:
    // the plus over A at (-21.4, -10.6), the minus beside B at (-12.4, 18.4).
    expect(
      marks({ signA: "+", signB: "-" }).map(({ part, from, to }) => ({
        part,
        from,
        to,
      })),
    ).toEqual([
      {
        part: "input-a-sign-plus",
        from: { x: -25.3, y: -10.5 },
        to: { x: -17.7, y: -10.5 },
      },
      {
        part: "input-a-sign-plus",
        from: { x: -21.5, y: -14.3 },
        to: { x: -21.5, y: -6.7 },
      },
      {
        part: "input-b-sign-minus",
        from: { x: -16.3, y: 18.5 },
        to: { x: -8.7, y: 18.5 },
      },
    ]);
    // The same centres at every turn and mirror; only the bars' direction
    // within the Symbol changes, to stay level on the page.
    for (const rotation of [90, 180, 270, 45] as const)
      for (const mirror of ["none", "horizontal"] as const)
        expect(
          marks({ signA: "-" }, { rotation, mirror }).map(({ from, to }) => ({
            x: Number(((from.x + to.x) / 2).toFixed(6)),
            y: Number(((from.y + to.y) / 2).toFixed(6)),
          })),
          `${rotation}° ${mirror}`,
        ).toEqual([
          { x: -21.5, y: -10.5 },
          { x: -12.5, y: 18.5 },
          { x: -12.5, y: 18.5 },
        ]);
  });

  it("grow the box the artwork occupies, and are drawn once", () => {
    const signed = withInputSigns(bare, adder({ signB: "-" }));
    const { viewBox } = signed.definition;
    expect(viewBox.x).toBeCloseTo(-27.3, 9);
    expect(viewBox.y).toBeCloseTo(-16.3, 9);
    expect(viewBox.x + viewBox.width).toBeCloseTo(24, 9);
    expect(viewBox.y + viewBox.height).toBeCloseTo(24.3, 9);
    // A Symbol already carrying the marks is not marked again, so a
    // consumer handed the Instance's Symbol may resolve it once more.
    expect(withInputSigns(signed, adder({ signB: "-" }))).toBe(signed);
    expect(resolveInstanceSymbol(resolver, adder({ signB: "-" }))).toEqual(
      signed,
    );
    // A minus typed as U+2212 is a minus.
    expect(marks({ signB: "−" })).toEqual(marks({ signB: "-" }));
  });
});
