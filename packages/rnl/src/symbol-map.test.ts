import { describe, expect, it } from "vitest";

import { deviceDescriptor, subcircuitDescriptor } from "@icm/devices";
import {
  createEmptyProject,
  transformPoint,
  type CircuitProject,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import {
  builtInSymbols,
  variantHiddenPinNames,
  variantPinAt,
} from "@icm/symbols";

import { inlineRnlDefinition } from "./inline-symbols.js";
import { inverseOrient, orientPoint } from "./orientation.js";
import { AC_UNITS_PER_RNL_UNIT, toRnlPoint } from "./place.js";
import {
  RNL_SYMBOLS,
  rnlBodyPortOrder,
  rnlSymbolFor,
  symbolModelType,
  terminalOfPin,
  type RnlSymbol,
} from "./symbol-map.js";

const symbols = new Map(builtInSymbols.map((symbol) => [symbol.id, symbol]));
const drawnFromCanvas = RNL_SYMBOLS.filter((entry) => entry.ac !== null);
/** A pin the part may leave unwired, as a fully differential op-amp's VOCM. */
const optionalPin = (symbolId: string, pinName: string) =>
  subcircuitDescriptor(symbolId)?.ports.some(
    (port) => port.optional && port.pinName === pinName,
  ) ?? false;

/**
 * How far series 0.4 moved the origin of a standard symbol, in RNL units along
 * x, to put it on the column of its supply pins (the UJT: of its b1 and b2),
 * with the art moved by as much the other way (rich-netlist/rnl#683).
 */
const MOVED_ORIGIN = new Map<string, number>([
  ["$UJT", -1],
  ...[
    "$DIFFERENTIAL_OPAMP_SUPPLY",
    "$DIFFERENTIAL_OPAMP_INVERTED_SUPPLY",
    "$DIFFERENTIAL_OPAMP_TWISTED_SUPPLY",
    "$DIFFERENTIAL_OPAMP_TWISTED_INVERTED_SUPPLY",
    "$BUFFER_SUPPLY",
    "$INVERTER_SUPPLY",
  ].map((symbol): [string, number] => [symbol, 1]),
]);

/**
 * Where RNL registers a symbol, by the rules settled for the standard
 * library: a transistor on its main current path level with its control
 * pin, a switch in the middle of its switched path, a one-pin glyph on its
 * pin, a two-terminal part midway between its pins, anything else at Analog
 * Canvas's own origin; but a standard symbol whose origin series 0.4 moved
 * is registered back by as much, so its pins stay where Analog Canvas has
 * them. In RNL units, Analog Canvas's frame, y up.
 */
function registration(entry: RnlSymbol): readonly [number, number] {
  const moved = entry.package.startsWith("rnl-std")
    ? MOVED_ORIGIN.get(entry.symbol)
    : undefined;
  if (moved !== undefined) return [-moved + 0, 0];
  const symbolId = entry.ac!;
  const symbol = symbols.get(symbolId)!;
  const at = new Map(symbol.pins.map((pin) => [pin.name, pin.at]));
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const device = deviceDescriptor(symbolId);
  let point = { x: 0, y: 0 };
  if (device?.deviceClass === "mos" || device?.deviceClass === "jfet")
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
  it("reads the model type each symbol's card declares", () => {
    expect(
      [
        "nmos",
        "pdmos",
        "diode",
        "zener-diode",
        "npn",
        "pnp",
        "njfet",
        "pjfet",
        "resistor",
      ].map((symbolId) => symbolModelType(symbolId)),
    ).toEqual([
      "nmos",
      "pmos",
      "d",
      "d",
      "npn",
      "pnp",
      "njf",
      "pjf",
      undefined,
    ]);
  });
  it("draws every Analog Canvas symbol", () => {
    expect(
      builtInSymbols
        .map((symbol) => symbol.id)
        .filter((id) => !rnlSymbolFor(id)),
    ).toEqual([]);
  });

  it("takes the standard series' symbols, and appearance variants from Analog Canvas's package", () => {
    expect(rnlSymbolFor("chopper")).toMatchObject({
      symbol: "$CHOPPER_SYMBOL",
      package: "rnl-std-functional",
    });
    expect(rnlSymbolFor("opamp")).toMatchObject({
      symbol: "$OPAMP",
      package: "rnl-std-functional",
    });
    expect(rnlSymbolFor("opamp-lettered")).toMatchObject({
      symbol: "$CANVAS_OPAMP_LETTERED",
      package: "analog-canvas-extensions",
    });
    expect(rnlSymbolFor("ground")?.package).toBe("rnl-std-basic");
  });

  it("draws with the standard series 0.4 each part it has a symbol for", () => {
    for (const [symbolId, symbol, pkg] of [
      ["crystal", "$CRYSTAL", "rnl-std-basic"],
      ["transmission-line", "$TRANSMISSION_LINE", "rnl-std-basic"],
      ["polarized-capacitor", "$POLARIZED_CAPACITOR", "rnl-std-basic"],
      ["led", "$LED", "rnl-std-semiconductors"],
      ["schottky-diode", "$SCHOTTKY_DIODE", "rnl-std-semiconductors"],
      ["shockley-diode", "$SHOCKLEY_DIODE", "rnl-std-semiconductors"],
      ["put", "$PUT", "rnl-std-semiconductors"],
      ["ujt", "$UJT", "rnl-std-semiconductors"],
      ["potentiometer", "$POTENTIOMETER", "rnl-std-basic"],
      ["photoresistor", "$PHOTORESISTOR", "rnl-std-basic"],
      ["speaker", "$SPEAKER", "rnl-std-basic"],
      ["microphone", "$MICROPHONE", "rnl-std-basic"],
      ["sine-voltage-source", "$SINE_VOLTAGE_SOURCE", "rnl-std-basic"],
      ["ammeter", "$AMMETER", "rnl-std-basic"],
      ["pulse-voltage-source", "$PULSE_VOLTAGE_SOURCE", "rnl-std-basic"],
      [
        "opamp-differential-crossed",
        "$DIFFERENTIAL_OPAMP_TWISTED",
        "rnl-std-functional",
      ],
    ] as const)
      expect(rnlSymbolFor(symbolId), symbolId).toMatchObject({
        symbol,
        package: pkg,
      });
    // The transformer's terminals are the standard's p1 n1 p2 n2.
    expect(
      rnlSymbolFor("xfmr")!.terminals.map((terminal) => terminal.name),
    ).toEqual(["p1", "n1", "p2", "n2"]);
    // 4-terminal MOSFETs keep the body pin at (1, 0), where the standard
    // series 0.4 has moved it; its own read back.
    expect(rnlSymbolFor("nmos")).toMatchObject({
      symbol: "$CANVAS_NMOS_4TERM",
      package: "analog-canvas-extensions",
    });
    expect(
      RNL_SYMBOLS.find((entry) => entry.symbol === "$NMOS_4TERM"),
    ).toMatchObject({ ac: "nmos", importOnly: true });
  });

  it("draws the wide chopper with its own symbol, defined in the file (#2170)", () => {
    const narrow = rnlSymbolFor("chopper")!;
    const wide = rnlSymbolFor("chopper", "wide")!;
    expect(wide).toMatchObject({
      symbol: "$CANVAS_CHOPPER_WIDE",
      inline: true,
      package: "",
      ac: "chopper",
      variant: "wide",
      terminals: narrow.terminals,
      undrawnPins: narrow.undrawnPins,
    });
    // The pins keep their terminals and move to the box's corners.
    expect(wide.pins.map((pin) => [pin.acPin, pin.terminal, pin.at])).toEqual([
      ["INP", 1, [-2, 4]],
      ["INN", 2, [-2, -4]],
      ["OUTP", 3, [2, 4]],
      ["OUTN", 4, [2, -4]],
    ]);
    const definition = inlineRnlDefinition(wide);
    expect(definition.box).toEqual([-2.4, -4.4, 2.4, 4.4]);
    expect(definition.prims).toHaveLength(7);
    // The narrow chopper still comes from the standard series.
    expect(narrow).toMatchObject({
      symbol: "$CHOPPER_SYMBOL",
      package: "rnl-std-functional",
    });
    expect(narrow.inline).toBeUndefined();
  });

  it("draws controlled-source diamonds with the standard symbols and circles with Analog Canvas's", () => {
    for (const source of ["vcvs", "vccs", "ccvs", "cccs"]) {
      expect(rnlSymbolFor(source, "diamond")).toMatchObject({
        symbol: source.endsWith("vs")
          ? "$CONTROLLED_VOLTAGE_SOURCE"
          : "$CONTROLLED_CURRENT_SOURCE",
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
    }
    expect(
      RNL_SYMBOLS.some(
        (entry) =>
          /^\$CANVAS_\w+_DIAMOND$/u.test(entry.symbol) &&
          entry.ac !== "current-source",
      ),
    ).toBe(false);
  });

  it("draws the op-amp kinds with + on top, Analog Canvas's − on top ones flipped", () => {
    expect(rnlSymbolFor("opamp-inputs-swapped")).toMatchObject({
      symbol: "$OPAMP",
      orient: "R0",
    });
    expect(rnlSymbolFor("opamp")).toMatchObject({
      symbol: "$OPAMP",
      orient: "MX",
    });
    expect(rnlSymbolFor("opamp-differential")).toMatchObject({
      symbol: "$DIFFERENTIAL_OPAMP",
      orient: "MX",
    });
    for (const entry of RNL_SYMBOLS)
      expect(["R0", "MX", "R90", "R270"], entry.symbol).toContain(entry.orient);
  });

  it("lays the diodes and the transformer across, as Analog Canvas draws them, where RNL stands them upright", () => {
    for (const symbolId of [
      "diode",
      "zener-diode",
      "led",
      "schottky-diode",
      "shockley-diode",
      "put",
    ])
      expect(rnlSymbolFor(symbolId)?.orient, symbolId).toBe("R90");
    expect(
      rnlSymbolFor("diode")?.pins.map((pin) => [pin.acPin, pin.at]),
    ).toEqual([
      ["A", [0, 2]],
      ["K", [0, -2]],
    ]);
    expect(rnlSymbolFor("xfmr")?.orient).toBe("R270");
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
    // The 4-input gates, the two-terminal Delay Cell and the 4-terminal
    // MOSFETs of the standard series.
    expect(RNL_SYMBOLS.filter((entry) => entry.importOnly)).toHaveLength(13);
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
    for (const entry of drawnFromCanvas) {
      const [x, y] = registration(entry);
      if (!entry.baseRotation) {
        expect(entry.offset, entry.symbol).toEqual([x, y]);
        continue;
      }
      const turned = toRnlPoint(
        transformPoint(
          { x: x * AC_UNITS_PER_RNL_UNIT, y: -y * AC_UNITS_PER_RNL_UNIT },
          { x: 0, y: 0 },
          { rotation: 45, mirror: "none" },
        ),
      );
      expect(entry.offset[0], entry.symbol).toBeCloseTo(turned[0]!, 6);
      expect(entry.offset[1], entry.symbol).toBeCloseTo(turned[1]!, 6);
    }
  });

  it("draws a pin wherever Analog Canvas shows one, and only there", () => {
    for (const entry of drawnFromCanvas) {
      const symbol = symbols.get(entry.ac!)!;
      // A row of no variant draws a default variant no row of its own draws,
      // as an op-amp's that hides its supplies (#1833); a MOS default has one.
      const variantId =
        entry.variant ??
        (drawnFromCanvas.some(
          (row) =>
            row.ac === entry.ac && row.variant === symbol.defaultVariantId,
        )
          ? null
          : symbol.defaultVariantId);
      const variant = symbol.variants?.find(
        (candidate) => candidate.id === variantId,
      );
      // A pin the variant moves is shown where it moves it (#2170).
      const hidden = variantHiddenPinNames(variant);
      const shown = symbol.pins
        .filter((pin) => !hidden.has(pin.name))
        .map((pin) => ({ ...pin, at: variantPinAt(variant, pin) }));
      expect(entry.pins.map((pin) => pin.acPin).sort(), entry.symbol).toEqual(
        shown.map((pin) => pin.name).sort(),
      );
      for (const pin of entry.pins) {
        expect(entry.terminals[pin.terminal - 1]!.drawn).toBe(true);
        // A read-only row or a diagonal symbol uses the package's pin geometry.
        if (entry.importOnly || entry.baseRotation) continue;
        const [x, y] = toRnlPoint(
          shown.find((item) => item.name === pin.acPin)!.at,
        );
        // Analog Canvas draws the symbol turned by entry.orient about the
        // registration point.
        const [sx, sy] = orientPoint(inverseOrient(entry.orient), [
          x - entry.offset[0],
          y - entry.offset[1],
        ]);
        expect(pin.at, `${entry.symbol} ${pin.acPin}`).toEqual([
          Math.round(sx * 1e6) / 1e6 + 0,
          Math.round(sy * 1e6) / 1e6 + 0,
        ]);
      }
      // A drawing stencil with no undrawn terminal, as RNL's two-terminal
      // Delay Cell, has none for a hidden supply to take (#1941).
      expect(
        entry.undrawnPins.map((pin) => pin.acPin).sort(),
        entry.symbol,
      ).toEqual(
        entry.terminals.some((terminal) => !terminal.drawn)
          ? // RNL has no terminal for an optional pin, as VOCM (#2443).
            [...hidden].filter((name) => !optionalPin(entry.ac!, name)).sort()
          : [],
      );
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
      if (!body || entry.importOnly) continue;
      expect(
        body.ports
          .filter((port) => !port.optional)
          .map((port) =>
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

  it("read each call's part in its own Document, where another shares its id", () => {
    const project = block("nand-gate-3");
    // An op-amp in another Document with the gate's id: ids are unique
    // within a Document only.
    const other = block("opamp").documents[0]!;
    project.documents.push({ ...other, id: "other", name: "other" });
    expect(text(project)).toBe(text(block("nand-gate-3")));
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
