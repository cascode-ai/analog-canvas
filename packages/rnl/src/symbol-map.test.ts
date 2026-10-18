import { describe, expect, it } from "vitest";

import { deviceDescriptor, subcircuitDescriptor } from "@icm/devices";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { builtInSymbols } from "@icm/symbols";

import { orientPoint } from "./orientation.js";
import { toRnlPoint } from "./place.js";
import {
  RNL_SYMBOLS,
  rnlBodyPortOrder,
  rnlSymbolFor,
  terminalOfPin,
} from "./symbol-map.js";

const symbols = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
const drawnFromCanvas = RNL_SYMBOLS.filter((entry) => entry.ac !== null);

/**
 * Where RNL registers a symbol, by the rules settled for the standard
 * library: a transistor on its main current path level with its control
 * pin, a switch in the middle of its switched path, a one-pin glyph on its
 * pin, a two-terminal part midway between its pins, anything else at Analog
 * Canvas's own origin. In RNL units, Analog Canvas's frame, y up.
 */
function registration(symbolId: string): readonly [number, number] {
  const symbol = symbols.get(symbolId)!;
  const at = new Map(symbol.pins.map((pin) => [pin.name, pin.at]));
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const device = deviceDescriptor(symbolId);
  let point = { x: 0, y: 0 };
  if (device?.deviceClass === "mos")
    point = { x: at.get("D")!.x, y: at.get("G")!.y };
  else if (device?.deviceClass === "bjt")
    point = { x: at.get("C")!.x, y: at.get("B")!.y };
  else if (device?.deviceClass === "switch") {
    if (at.has("P") && at.has("N")) point = mid(at.get("P")!, at.get("N")!);
    else if (at.has("COM"))
      point = mid(at.get("COM")!, mid(at.get("A")!, at.get("B")!));
    else if (at.has("INP"))
      point = mid(
        mid(at.get("INP")!, at.get("INN")!),
        mid(at.get("OUTP")!, at.get("OUTN")!),
      );
    else point = mid(symbol.pins[0]!.at, symbol.pins[1]!.at);
  } else if (symbol.pins.length === 1) point = symbol.pins[0]!.at;
  else if (symbol.pins.length === 2 && device)
    point = mid(symbol.pins[0]!.at, symbol.pins[1]!.at);
  return toRnlPoint(point);
}

describe("the RNL symbol list", () => {
  it("draws every Analog Canvas symbol", () => {
    expect(
      builtInSymbols
        .map((symbol) => symbol.id)
        .filter((id) => !rnlSymbolFor(id)),
    ).toEqual([]);
  });

  it("takes the chopper and appearance variants from Analog Canvas's package", () => {
    expect(rnlSymbolFor("chopper")).toMatchObject({
      symbol: "$CANVAS_CHOPPER",
      package: "analog-canvas-extensions",
    });
    expect(rnlSymbolFor("opamp")).toMatchObject({
      symbol: "$OPAMP_5TERM",
      package: "rnl-std-functional",
    });
    expect(rnlSymbolFor("ground")?.package).toBe("rnl-std-basic");
  });

  it("preserves controlled-source circles and diamonds and reads legacy aliases", () => {
    for (const source of ["vcvs", "vccs", "ccvs", "cccs"]) {
      expect(rnlSymbolFor(source, "diamond")).toMatchObject({
        symbol: `$${source.toUpperCase()}`,
        package: "rnl-std-basic",
        variant: "diamond",
        importOnly: false,
      });
      expect(rnlSymbolFor(source)).toMatchObject({
        symbol: `$CANVAS_${source.toUpperCase()}_CIRCLE`,
        package: "analog-canvas-extensions",
        variant: null,
        importOnly: false,
      });
      expect(
        RNL_SYMBOLS.find(
          (entry) => entry.symbol === `$CANVAS_${source.toUpperCase()}_DIAMOND`,
        ),
      ).toMatchObject({
        ac: source,
        variant: "diamond",
        importOnly: true,
      });
    }
  });

  it("draws the op-amp kinds with + on top, Analog Canvas's − on top ones flipped", () => {
    expect(rnlSymbolFor("opamp-inputs-swapped")).toMatchObject({
      symbol: "$OPAMP_5TERM",
      orient: "R0",
    });
    expect(rnlSymbolFor("opamp")).toMatchObject({
      symbol: "$OPAMP_5TERM",
      orient: "MX",
    });
    expect(rnlSymbolFor("opamp-differential")).toMatchObject({
      symbol: "$DIFFERENTIAL_OPAMP",
      orient: "MX",
    });
    for (const entry of RNL_SYMBOLS)
      expect(["R0", "MX"], entry.symbol).toContain(entry.orient);
  });

  it("draws the 4-input gates as Analog Canvas does, and reads RNL's standard ones back", () => {
    for (const gate of ["and", "nand", "or", "nor", "xor", "xnor"]) {
      const name = gate.toUpperCase();
      expect(rnlSymbolFor(`${gate}-gate-4`)).toMatchObject({
        symbol: `$CANVAS_${name}_4INPUT`,
        package: "analog-canvas-extensions",
        importOnly: false,
      });
      // RNL puts the standard gate's inputs on whole grid points.
      const standard = RNL_SYMBOLS.find(
        (entry) => entry.symbol === `$${name}_4INPUT`,
      );
      expect(standard).toMatchObject({
        ac: `${gate}-gate-4`,
        importOnly: true,
      });
      expect(
        standard!.pins.filter((pin) => pin.acPin !== "Y").map((pin) => pin.at),
      ).toEqual([
        [-3, 2],
        [-3, 1],
        [-3, -1],
        [-3, -2],
      ]);
    }
    expect(RNL_SYMBOLS.filter((entry) => entry.importOnly)).toHaveLength(10);
  });

  it("names the definition a glyph or a drawing-only part draws", () => {
    expect(rnlSymbolFor("ground")).toMatchObject({
      symbol: "$GROUND_SYMBOL",
      definition: "$GROUND",
    });
    expect(rnlSymbolFor("port-filled")?.definition).toBe("$IO_PORT");
    expect(rnlSymbolFor("spdt-switch")).toMatchObject({
      symbol: "$SPDT_SWITCH_SYMBOL",
      definition: "$SPDT_SWITCH",
    });
    expect(rnlSymbolFor("resistor")?.definition).toBeNull();
  });

  it("registers each symbol by the agreed rules", () => {
    for (const entry of drawnFromCanvas)
      expect(entry.offset, entry.symbol).toEqual(registration(entry.ac!));
  });

  it("draws a pin wherever Analog Canvas shows one, and only there", () => {
    for (const entry of drawnFromCanvas) {
      const symbol = symbols.get(entry.ac!)!;
      const hidden = new Set(
        symbol.variants?.find((variant) => variant.id === entry.variant)
          ?.hiddenPinNames ?? [],
      );
      const shown = symbol.pins.filter((pin) => !hidden.has(pin.name));
      expect(entry.pins.map((pin) => pin.acPin).sort(), entry.symbol).toEqual(
        shown.map((pin) => pin.name).sort(),
      );
      for (const pin of entry.pins) {
        expect(entry.terminals[pin.terminal - 1]!.drawn).toBe(true);
        // A row that only reads files back has its pins where RNL's symbol does.
        if (entry.importOnly) continue;
        const [x, y] = toRnlPoint(
          shown.find((item) => item.name === pin.acPin)!.at,
        );
        // Analog Canvas draws the symbol turned by entry.orient (R0 or MX,
        // each its own inverse) about the registration point.
        const [sx, sy] = orientPoint(entry.orient, [
          x - entry.offset[0],
          y - entry.offset[1],
        ]);
        expect(pin.at, `${entry.symbol} ${pin.acPin}`).toEqual([
          Math.round(sx * 1e6) / 1e6 + 0,
          Math.round(sy * 1e6) / 1e6 + 0,
        ]);
      }
      expect(
        entry.undrawnPins.map((pin) => pin.acPin).sort(),
        entry.symbol,
      ).toEqual([...hidden].sort());
    }
  });

  it("numbers terminals in the order Analog Canvas prints a primitive's nodes", () => {
    for (const entry of drawnFromCanvas) {
      const device = deviceDescriptor(entry.ac!);
      if (!device || entry.acNetlistOrder) continue;
      device.pinOrder.forEach((pin, index) =>
        expect(terminalOfPin(entry, pin), `${entry.symbol} ${pin}`).toBe(
          index + 1,
        ),
      );
    }
  });

  it("knows the order Analog Canvas prints each of its own bodies in", () => {
    for (const entry of drawnFromCanvas) {
      const body = subcircuitDescriptor(entry.ac!);
      if (!body) continue;
      expect(
        body.ports.map((port) =>
          port.supply
            ? port.supply === "VDD"
              ? "vp"
              : "vn"
            : entry.terminals[terminalOfPin(entry, port.pinName)! - 1]!.name,
        ),
        entry.symbol,
      ).toEqual(entry.acNetlistOrder);
    }
  });
});

/** One block inside Cell `dut` with its signal pins on Cell Pins `n_<port>`. */
function block(symbolId: string): CircuitProject {
  const project = createEmptyProject(`block-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: descriptor.target },
      parameters: {},
    },
  });
  for (const port of descriptor.ports.filter((item) => !item.supply)) {
    const id = `pin-${port.name}`;
    const node = `n_${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: node,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName: port.pinName ?? port.name },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: node,
      netId: node,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

describe("netlists the RNL modes print", () => {
  const text = (project: CircuitProject) => {
    const result = createDesignNetlistExport(project, {
      bodyPortOrder: rnlBodyPortOrder(project),
    });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    return result.status === "ready" ? result.file.text : "";
  };

  it("print an op-amp in its macromodel order", () => {
    const file = text(block("opamp"));
    expect(file).toContain("X1 n_VIP n_VIN 0 0 n_VOUT opamp");
    expect(file).toContain(".subckt opamp VIP VIN VDD VSS VOUT params:");
  });

  it("print a gate with its signals before its supplies", () => {
    const file = text(block("nand-gate-3"));
    expect(file).toContain("X1 n_A n_B n_C n_Y VDD VSS ");
    expect(file).toMatch(/\.subckt \S+ A B C Y VDD VSS params:/);
  });

  it("keep a primitive's nodes in SPICE's order", () => {
    const project = block("opamp");
    const plain = createDesignNetlistExport(project);
    const ordered = createDesignNetlistExport(project, {
      bodyPortOrder: () => null,
    });
    expect(ordered).toEqual(plain);
  });
});
