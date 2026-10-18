import { afterAll, describe, expect, it } from "vitest";

import { RNL_SYMBOLS } from "@icm/rnl";
import { startCore } from "@rich-netlist/runtime";

const core = startCore();
afterAll(() => core.terminate());

/** An exit direction in degrees, as the mapping table has it, as the catalog says it. */
const DIRECTION: Record<number, string> = {
  0: "right",
  90: "up",
  180: "left",
  270: "down",
};

// The mapping table (`symbol-list.json`) is the editor's copy of what the rnl
// runtime's packages say about each symbol; the runtime's catalog is the
// authority (docs/specs/rnl-interchange.md, Acceptance criteria), so a symbol
// that moves a pin or changes package in an rnl upgrade fails here, not in a
// drawing.
describe("the mapping table against the rnl runtime's catalog", () => {
  it("names every symbol in the package the runtime defines it in, with the pins where it puts them", async () => {
    const catalog = await core.catalog({ catalog: {} });
    const found = new Map(
      catalog.symbols.map((symbol) => [
        `${symbol.package}/${symbol.symbol}`,
        symbol,
      ]),
    );
    const problems: string[] = [];
    let compared = 0;
    for (const row of RNL_SYMBOLS) {
      const symbol = found.get(`${row.package}/${row.symbol}`);
      if (!symbol) {
        problems.push(`${row.package}/${row.symbol}: not in the catalog`);
        continue;
      }
      // A symbol the packages draw for a definition: null stands for none
      // found, which says nothing against the table.
      if (symbol.definition !== null && symbol.definition !== row.definition)
        problems.push(
          `${row.symbol}: draws ${symbol.definition}, the table says ${row.definition}`,
        );
      const named = new Map(
        row.terminals.map((terminal) => [terminal.name, terminal.n]),
      );
      const drawn = new Map(
        symbol.pins.map((pin) => [
          typeof pin.terminal === "number"
            ? pin.terminal
            : (named.get(pin.terminal) ?? pin.terminal),
          pin,
        ]),
      );
      for (const pin of row.pins) {
        const there = drawn.get(pin.terminal);
        compared += 1;
        if (!there) {
          problems.push(
            `${row.symbol}: terminal ${pin.terminal} has no pin in the catalog`,
          );
          continue;
        }
        if (
          Math.abs(there.at[0] - pin.at[0]) > 1e-6 ||
          Math.abs(there.at[1] - pin.at[1]) > 1e-6
        )
          problems.push(
            `${row.symbol}: terminal ${pin.terminal} at ${there.at} in the catalog, ${pin.at} in the table`,
          );
        if (there.direction !== null && pin.dir !== null)
          if (there.direction !== DIRECTION[pin.dir])
            problems.push(
              `${row.symbol}: terminal ${pin.terminal} leaves ${there.direction} in the catalog, ${pin.dir}° in the table`,
            );
      }
    }
    expect(problems).toEqual([]);
    // A table read as empty would agree with anything.
    expect(RNL_SYMBOLS.length).toBeGreaterThan(100);
    expect(compared).toBeGreaterThan(200);
  });

  it("keeps controlled-source circles and legacy diamonds pin-compatible with the standard symbols", async () => {
    const catalog = await core.catalog({ catalog: {} });
    for (const kind of ["VCVS", "VCCS", "CCVS", "CCCS"]) {
      const standard = catalog.symbols.find(
        (symbol) =>
          symbol.package === "rnl-std-basic" && symbol.symbol === `$${kind}`,
      );
      const legacy = catalog.symbols.find(
        (symbol) =>
          symbol.package === "analog-canvas-extensions" &&
          symbol.symbol === `$CANVAS_${kind}_DIAMOND`,
      );
      const circle = catalog.symbols.find(
        (symbol) =>
          symbol.package === "analog-canvas-extensions" &&
          symbol.symbol === `$CANVAS_${kind}_CIRCLE`,
      );
      expect(circle, kind).toBeDefined();
      expect(circle!.pins, kind).toEqual(standard?.pins);
      expect(standard, kind).toBeDefined();
      expect(legacy, kind).toBeDefined();
      expect(standard!.pins, kind).toEqual(legacy!.pins);
      expect(standard!.box, kind).toEqual(legacy!.box);
    }
  });
});
