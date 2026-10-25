import { describe, expect, it } from "vitest";
import type { DesignNetlistInstance } from "@icm/netlist";

import { callSymbolFromDefinition, symbolForCall } from "./call-symbols.js";
import { inlineRnlDefinition } from "./inline-symbols.js";
import type { RnlSymbolRef } from "./rnl-import.js";
import { rnlSymbolFor } from "./symbol-map.js";

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
    const ordered = symbolForCall(
      inverter,
      call([
        { pinName: "VDD" },
        { pinName: "VSS" },
        { pinName: "a", canvasPinName: "A" },
        { pinName: "y", canvasPinName: "Y" },
      ]),
    );
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

describe("library artwork of a call read back", () => {
  const inverter = rnlSymbolFor("inverter")!;
  const ordered = symbolForCall(
    inverter,
    call([
      { pinName: "VDD" },
      { pinName: "VSS" },
      { pinName: "a", canvasPinName: "A" },
      { pinName: "y", canvasPinName: "Y" },
    ]),
  );
  /** The symbol as the file defines it, as the runtime's snapshot reads it. */
  const defined = (
    name = ordered.symbol,
    edit = (pins: number[][]) => pins,
  ) => {
    const definition = inlineRnlDefinition(ordered);
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
          dir: ordered.pins[index]!.dir,
        })),
        prims: definition.prims,
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

  it("reads nothing back from a call symbol whose pins are moved", () => {
    expect(
      callSymbolFromDefinition(
        defined(undefined, (pins) => [...pins].reverse()),
      ),
    ).toBeNull();
  });

  it("reads nothing back from a name that orders the pins otherwise", () => {
    expect(
      callSymbolFromDefinition(defined("$CANVAS_CALL_INVERTER__1_2_0_0")),
    ).toBeNull();
  });
});
