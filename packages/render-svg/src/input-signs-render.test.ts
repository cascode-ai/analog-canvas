import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  transformPoint,
  type Orientation,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { buildSvgScene, renderDocumentSvg } from "./render.js";

type Placement = NonNullable<
  SchematicDocument["instances"][number]["placement"]
>;

const resolver = new InMemorySymbolResolver(builtInSymbols);
const position = { x: 100, y: 80 };

function adderDocument(
  parameters?: Record<string, string>,
  orientation: Orientation = { rotation: 0, mirror: "none" },
): SchematicDocument {
  const document = createEmptyDocument("doc", "Signs");
  document.instances.push({
    id: "X1",
    symbolId: "adder",
    reference: "X1",
    placement: { position, ...orientation },
    ...(parameters
      ? {
          netlist: {
            binding: { kind: "unresolved-subcircuit", name: "adder" },
            parameters,
          },
        }
      : {}),
  });
  return document;
}

const LINE =
  /<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*\/>/gu;

/** The lines one drawing has that the other lacks, in page coordinates. */
function extraLines(
  svg: string,
  baseline: string,
  placement: Placement,
): { from: { x: number; y: number }; to: { x: number; y: number } }[] {
  const before = new Set([...baseline.matchAll(LINE)].map((match) => match[0]));
  return [...svg.matchAll(LINE)]
    .filter((match) => !before.has(match[0]))
    .map((match) => ({
      from: transformPoint(
        { x: Number(match[1]), y: Number(match[2]) },
        placement.position,
        placement,
      ),
      to: transformPoint(
        { x: Number(match[3]), y: Number(match[4]) },
        placement.position,
        placement,
      ),
    }));
}

describe("adder input signs", () => {
  it("draws no sign while both inputs add, as every adder drew before signs", () => {
    const unsigned = renderDocumentSvg(adderDocument(), resolver);
    expect(
      renderDocumentSvg(adderDocument({ signA: "+", signB: "+" }), resolver),
    ).toBe(unsigned);
  });

  it.each([0, 45, 90, 180, 270] as const)(
    "marks each input once one subtracts, its bars level and upright on the page at %s°",
    (rotation) => {
      for (const mirror of [
        "none",
        "horizontal",
        "vertical",
        "both",
      ] as const) {
        const placement: Placement = { position, rotation, mirror };
        const unsigned = renderDocumentSvg(
          adderDocument(undefined, { rotation, mirror }),
          resolver,
        );
        const signed = renderDocumentSvg(
          adderDocument({ signA: "+", signB: "-" }, { rotation, mirror }),
          resolver,
        );
        const marks = extraLines(signed, unsigned, placement);
        // A plus over A (two bars) and a minus beside B (one).
        expect(marks).toHaveLength(3);
        const center = (local: { x: number; y: number }) =>
          transformPoint(local, position, placement);
        const describe = (mark: (typeof marks)[number]) => ({
          level: Math.abs(mark.from.y - mark.to.y) < 1e-5,
          upright: Math.abs(mark.from.x - mark.to.x) < 1e-5,
          length: Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y),
          x: (mark.from.x + mark.to.x) / 2,
          y: (mark.from.y + mark.to.y) / 2,
        });
        const bars = marks.map(describe);
        for (const bar of bars) {
          expect(bar.level || bar.upright, `${rotation}° ${mirror}`).toBe(true);
          expect(bar.length).toBeCloseTo(7.6, 5);
        }
        const near = (
          bar: (typeof bars)[number],
          local: { x: number; y: number },
        ) =>
          Math.hypot(bar.x - center(local).x, bar.y - center(local).y) < 1e-5;
        const plus = bars.filter((bar) => near(bar, { x: -21.5, y: -10.5 }));
        const minus = bars.filter((bar) => near(bar, { x: -12.5, y: 18.5 }));
        expect(plus.map((bar) => bar.level).sort()).toEqual([false, true]);
        expect(minus.map((bar) => bar.level)).toEqual([true]);
      }
    },
  );

  it("draws a minus at A and a plus at B when A subtracts", () => {
    const placement: Placement = { position, rotation: 0, mirror: "none" };
    const marks = extraLines(
      renderDocumentSvg(adderDocument({ signA: "-" }), resolver),
      renderDocumentSvg(adderDocument(), resolver),
      placement,
    );
    expect(marks).toEqual(
      expect.arrayContaining([
        // A's minus, level, left of the circle above its input.
        { from: { x: 74.7, y: 69.5 }, to: { x: 82.3, y: 69.5 } },
        // B's plus, both bars, left of its input below the circle.
        { from: { x: 83.7, y: 98.5 }, to: { x: 91.3, y: 98.5 } },
        { from: { x: 87.5, y: 94.7 }, to: { x: 87.5, y: 102.3 } },
      ]),
    );
    expect(marks).toHaveLength(3);
  });

  it("keeps the signs inside the exported bounds", () => {
    const unsigned = buildSvgScene(adderDocument(), resolver);
    const signed = buildSvgScene(adderDocument({ signB: "-" }), resolver);
    // The plus over A reaches 3.8 units past its centre at x = -21.5.
    expect(signed.viewBox.x).toBeLessThanOrEqual(position.x - 25.3 - 40);
    expect(signed.viewBox.x + signed.viewBox.width).toBe(
      unsigned.viewBox.x + unsigned.viewBox.width,
    );
    expect(unsigned.viewBox.x).toBe(position.x - 24 - 40);
  });
});
