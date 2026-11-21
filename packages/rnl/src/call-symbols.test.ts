import { describe, expect, it } from "vitest";
import type { DesignNetlistInstance } from "@icm/netlist";

import { callSymbolFromDefinition, symbolForCall } from "./call-symbols.js";
import { builtInSymbols } from "@icm/symbols";

import { inlineRnlDefinition } from "./inline-symbols.js";
import { toRnlPoint } from "./place.js";
import type { RnlSymbolRef } from "./rnl-snapshot.js";
import { rnlDiagonalSymbolFor, rnlSymbolFor } from "./symbol-map.js";

const call = (
  nodes: { pinName: string; canvasPinName?: string }[],
): DesignNetlistInstance =>
  ({
    id: "xi0",
    reference: "XI0",
    invocationKind: "subcircuit",
    target: "div2_inv",
    nodes: nodes.map((node) => ({ ...node, netName: node.pinName })),
  }) as unknown as DesignNetlistInstance;

/** A gate's Cell whose ports start with its supplies. */
const supplyFirst = [
  { pinName: "VDD" },
  { pinName: "VSS" },
  { pinName: "a", canvasPinName: "A" },
  { pinName: "y", canvasPinName: "Y" },
];

describe("library artwork on a call", () => {
  const inverter = rnlSymbolFor("inverter")!;

  it("keeps the library symbol where the call prints each pin at its terminal", () => {
    expect(
      symbolForCall(
        inverter,
        call([
          { pinName: "a", canvasPinName: "A" },
          { pinName: "y", canvasPinName: "Y" },
        ]),
      ),
    ).toBe(inverter);
  });

  it("defines the artwork with each pin on the position a supplies-first Cell prints it at", () => {
    const ordered = symbolForCall(inverter, call(supplyFirst));
    expect(ordered.symbol).toBe("$CANVAS_CALL_INVERTER__0_0_1_2");
    expect(ordered.inline).toBe(true);
    expect(
      Object.fromEntries(ordered.pins.map((pin) => [pin.acPin, pin.terminal])),
    ).toEqual({ A: 3, Y: 4 });
    // The supplies have no pin: RNL draws nothing for them.
    expect(ordered.terminals.filter((terminal) => terminal.drawn)).toEqual([
      { n: 3, name: "a", drawn: true },
      { n: 4, name: "y", drawn: true },
    ]);
    const definition = inlineRnlDefinition(ordered);
    expect(definition.pins.map((pin) => pin.terminals)).toEqual([[3], [4]]);
    expect(definition.prims.length).toBeGreaterThan(0);
  });

  it("binds the diagonal MOS symbol to a call's reordered terminals", () => {
    const nmos = rnlDiagonalSymbolFor(rnlSymbolFor("nmos")!)!;
    const ordered = symbolForCall(
      nmos,
      call([
        { pinName: "bulk", canvasPinName: "B" },
        { pinName: "source", canvasPinName: "S" },
        { pinName: "gate", canvasPinName: "G" },
        { pinName: "drain", canvasPinName: "D" },
      ]),
    );
    expect(ordered.symbol).toBe("$NMOS_4TERM_45");
    expect(ordered.inline).toBeUndefined();
    expect(ordered.terminals.map(({ n, name }) => [n, name])).toEqual([
      [1, "b"],
      [2, "s"],
      [3, "g"],
      [4, "d"],
    ]);
    expect(ordered.pins.map(({ terminal, at }) => [terminal, at])).toEqual([
      [4, [2, 2]],
      [3, [-2, 2]],
      [2, [-2, -2]],
      [1, [0, 0]],
    ]);
  });

  it("places the pins of a gate whose Cell names its Pins otherwise", () => {
    // A Library gate meets its Cell's Pins by name, without case (#1450).
    const ordered = symbolForCall(
      inverter,
      call([
        { pinName: "VDD" },
        { pinName: "VSS" },
        { pinName: "a" },
        { pinName: "y" },
      ]),
      (node) => ({ a: "A", y: "Y" })[node.pinName],
    );
    expect(
      Object.fromEntries(ordered.pins.map((pin) => [pin.acPin, pin.terminal])),
    ).toEqual({ A: 3, Y: 4 });
  });

  it("does the same for the Delay Cell, whose own symbol the file defines", () => {
    const delay = rnlSymbolFor("delay-cell")!;
    expect(delay.inline).toBe(true);
    const ordered = symbolForCall(delay, call(supplyFirst));
    expect(ordered.symbol).toBe("$CANVAS_CALL_DELAY_CELL__0_0_1_2");
    expect(
      Object.fromEntries(ordered.pins.map((pin) => [pin.acPin, pin.terminal])),
    ).toEqual({ A: 3, Y: 4 });
  });

  it("leaves the library symbol when the call does not print one of its pins", () => {
    expect(symbolForCall(inverter, call([{ pinName: "a" }]))).toBe(inverter);
  });

  it("draws a curved gate body exactly", () => {
    const nand = rnlSymbolFor("nand-gate")!;
    const ordered = symbolForCall(
      nand,
      call([
        { pinName: "VDD" },
        { pinName: "VSS" },
        ...nand.pins.map((pin) => ({
          pinName: pin.acPin.toLowerCase(),
          canvasPinName: pin.acPin,
        })),
      ]),
    );
    expect(ordered).not.toBe(nand);
    expect(
      inlineRnlDefinition(ordered).prims.some(
        (primitive) => primitive.shape === "bezier",
      ),
    ).toBe(true);
  });
});

type RnlPrims = ReturnType<typeof inlineRnlDefinition>["prims"];

describe("library artwork of a call read back", () => {
  const ordered = symbolForCall(rnlSymbolFor("inverter")!, call(supplyFirst));
  /** The symbol as the file defines it, as the runtime's snapshot reads it. */
  const defined = (
    of = ordered,
    name = of.symbol,
    edit = (pins: number[][]) => pins,
    prims = (written: RnlPrims) => written,
  ) => {
    const definition = inlineRnlDefinition(of);
    const terminals = edit(definition.pins.map((pin) => pin.terminals));
    return {
      id: name,
      name,
      package: null,
      level: "top",
      default: false,
      definition: {
        box: definition.box,
        pins: definition.pins.map((pin, index) => ({
          terminals: terminals[index]!.map(String),
          at: pin.at,
          dir: of.pins[index]!.dir,
        })),
        prims: prims(definition.prims),
      },
    } as unknown as RnlSymbolRef;
  };

  it("reads the library symbol back from the call symbol the export defines", () => {
    const row = callSymbolFromDefinition(defined());
    expect(row?.ac).toBe("inverter");
    expect(
      Object.fromEntries(row!.pins.map((pin) => [pin.acPin, pin.terminal])),
    ).toEqual({ A: 3, Y: 4 });
  });

  it("reads the Delay Cell back from its call symbol", () => {
    const delay = symbolForCall(rnlSymbolFor("delay-cell")!, call(supplyFirst));
    const row = callSymbolFromDefinition(defined(delay));
    expect(row?.ac).toBe("delay-cell");
    expect(
      Object.fromEntries(row!.pins.map((pin) => [pin.acPin, pin.terminal])),
    ).toEqual({ A: 3, Y: 4 });
  });

  it("reads an op-amp back from its call symbol, and nothing from other artwork", () => {
    const opamp = symbolForCall(
      rnlSymbolFor("opamp")!,
      call([
        { pinName: "VDD" },
        { pinName: "VSS" },
        { pinName: "inp", canvasPinName: "IN+" },
        { pinName: "inn", canvasPinName: "IN-" },
        { pinName: "out", canvasPinName: "OUT" },
      ]),
    );
    expect(opamp.symbol).toBe("$CANVAS_CALL_OPAMP__0_0_1_2_5");
    expect(callSymbolFromDefinition(defined(opamp))?.ac).toBe("opamp");
    // Exact artwork is the evidence: the supply leads the default variant
    // hides are not ours.
    const lead = builtInSymbols
      .find((symbol) => symbol.id === "opamp")!
      .primitives.find(
        (primitive) =>
          primitive.kind === "line" && primitive.part === "vdd-lead",
      )!;
    if (lead.kind !== "line") throw new Error("no lead");
    expect(
      callSymbolFromDefinition(
        defined(opamp, undefined, undefined, (written: RnlPrims) => [
          ...written,
          {
            ...written.find((prim) => prim.shape === "line")!,
            points: [toRnlPoint(lead.from), toRnlPoint(lead.to)],
          },
        ]),
      ),
    ).toBeNull();
  });

  it("reads nothing back from a call symbol whose pins are moved", () => {
    expect(
      callSymbolFromDefinition(
        defined(ordered, undefined, (pins) => [...pins].reverse()),
      ),
    ).toBeNull();
  });

  it("reads nothing back from a name that orders the pins otherwise", () => {
    expect(
      callSymbolFromDefinition(
        defined(ordered, "$CANVAS_CALL_INVERTER__1_2_0_0"),
      ),
    ).toBeNull();
  });
});
