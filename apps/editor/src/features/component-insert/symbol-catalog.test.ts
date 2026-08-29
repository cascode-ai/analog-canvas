import { describe, expect, it } from "vitest";

import {
  componentCatalog,
  findPaletteSymbol,
  flattenComponentCatalog,
  libraryDescription,
  libraryDisplayName,
  symbolCategory,
} from "./symbol-catalog";

describe("component insertion catalog", () => {
  it("orders categories by how often they are reached for", () => {
    const groups = componentCatalog("razavi-textbook-v1", "");

    expect(groups.map((group) => group.category)).toEqual([
      "Transistors",
      "Passives",
      "Power and Ports",
      "Sources",
      "Switches",
      "Analog Blocks",
      "Logic Gates",
      "Signal Flow",
      "Annotations",
      "Extended Devices",
    ]);
  });

  it("keeps categories stable while promoting recent symbols within them", () => {
    const groups = componentCatalog("razavi-textbook-v1", "", [
      "capacitor",
      "resistor",
    ]);
    const passives = groups.find((group) => group.category === "Passives");

    expect(passives?.symbols.slice(0, 2).map((symbol) => symbol.id)).toEqual([
      "capacitor",
      "resistor",
    ]);
    expect(symbolCategory("capacitor")).toBe("Passives");
    expect(symbolCategory("variable-resistor")).toBe("Extended Devices");
    expect(symbolCategory("variable-capacitor")).toBe("Extended Devices");
    expect(symbolCategory("variable-inductor")).toBe("Extended Devices");
    expect(symbolCategory("opamp")).toBe("Analog Blocks");
    expect(symbolCategory("comparator")).toBe("Analog Blocks");
    expect(symbolCategory("comparator-unmarked")).toBe("Analog Blocks");
    expect(symbolCategory("inverter")).toBe("Logic Gates");
    expect(symbolCategory("and-gate")).toBe("Logic Gates");
    expect(symbolCategory("or-gate")).toBe("Logic Gates");
    expect(symbolCategory("nand-gate")).toBe("Logic Gates");
    expect(symbolCategory("nor-gate")).toBe("Logic Gates");
    expect(symbolCategory("xor-gate")).toBe("Logic Gates");
    expect(symbolCategory("xnor-gate")).toBe("Logic Gates");
    expect(symbolCategory("npn")).toBe("Transistors");
    expect(symbolCategory("diode")).toBe("Extended Devices");
    expect(symbolCategory("zener-diode")).toBe("Extended Devices");
    expect(symbolCategory("ideal-switch")).toBe("Switches");
    expect(symbolCategory("closed-switch")).toBe("Switches");
    expect(symbolCategory("ndmos")).toBe("Extended Devices");
    expect(symbolCategory("pdmos")).toBe("Extended Devices");
    expect(symbolCategory("annotation-arrow")).toBe("Annotations");
    expect(symbolCategory("annotation-polarity-both")).toBe("Annotations");
  });

  it("orders annotations as drawing tools, the polarity label, then signs", () => {
    const groups = componentCatalog("razavi-textbook-v1", "");
    const annotations = groups.find(
      (group) => group.category === "Annotations",
    );

    expect(annotations?.symbols.map((symbol) => symbol.id)).toEqual([
      "annotation-arrow",
      "annotation-line",
      "annotation-rectangle",
      "annotation-circle",
      "annotation-polarity-both",
      "annotation-text-plus",
      "annotation-text-minus",
    ]);
    expect(groups.at(-1)?.category).toBe("Extended Devices");
  });

  it("offers marked and unmarked comparators as separate analog blocks", () => {
    const symbols = flattenComponentCatalog(
      componentCatalog("razavi-textbook-v1", "comparator"),
    );

    expect(symbols.map((symbol) => symbol.id)).toEqual([
      "comparator",
      "comparator-unmarked",
    ]);
  });

  it("offers the two-terminal variable resistor as a searchable extended device", () => {
    const groups = componentCatalog("razavi-textbook-v1", "variable resistor");
    const symbols = flattenComponentCatalog(groups);

    expect(groups.map((group) => group.category)).toEqual(["Extended Devices"]);
    expect(symbols.map((symbol) => symbol.id)).toEqual(["variable-resistor"]);
    expect(symbols[0]?.pins.map((pin) => pin.name)).toEqual(["P1", "P2"]);
  });

  it("offers Digital Clock locally but can remove it with the production flag", () => {
    expect(
      findPaletteSymbol("razavi-textbook-v1", "pulse-voltage-source"),
    )?.toMatchObject({
      id: "pulse-voltage-source",
      pins: [{ name: "+" }, { name: "-" }],
    });
    expect(
      flattenComponentCatalog(
        componentCatalog("razavi-textbook-v1", "digital clock"),
      ),
    ).toHaveLength(1);
    expect(
      findPaletteSymbol("razavi-textbook-v1", "pulse-voltage-source", false),
    ).toBeUndefined();
    expect(
      flattenComponentCatalog(
        componentCatalog("razavi-textbook-v1", "digital clock", [], false),
      ),
    ).toEqual([]);
  });

  it("keeps adjustable passives, diodes, and DMOS in one extended library", () => {
    const extended = componentCatalog("razavi-textbook-v1", "").find(
      (group) => group.category === "Extended Devices",
    );

    expect(extended?.symbols.map((symbol) => symbol.id)).toEqual([
      "variable-resistor",
      "variable-capacitor",
      "variable-inductor",
      "diode",
      "zener-diode",
      "ndmos",
      "pdmos",
    ]);
    expect(extended).not.toHaveProperty("subcategory");
  });

  it("describes the filled Cell Pin as an independent authoring object", () => {
    expect(libraryDisplayName("zener-diode", "Zener Diode")).toBe("Zener");
    expect(libraryDescription("port-filled")).toBe(
      "An independent Cell Pin with a solid appearance",
    );
  });

  it("searches canonical names and ids without exposing retired MOS entries", () => {
    const symbols = flattenComponentCatalog(
      componentCatalog("razavi-textbook-v1", "nmos"),
    );

    expect(symbols.map((symbol) => symbol.id)).toContain("nmos");
    expect(symbols.map((symbol) => symbol.id)).not.toContain("nmos3");
    expect(findPaletteSymbol("razavi-textbook-v1", "pmos3")).toBeUndefined();
  });

  it("never exposes removed compatibility symbols under another style profile", () => {
    const symbols = flattenComponentCatalog(componentCatalog("unknown", ""));
    expect(symbols.map((symbol) => symbol.id)).toEqual(
      expect.arrayContaining(["nmos", "pmos", "resistor", "capacitor"]),
    );
    expect(symbols.map((symbol) => symbol.id)).toContain("inductor");
    expect(symbols.map((symbol) => symbol.id)).toContain("opamp");
    expect(symbols.map((symbol) => symbol.id)).toEqual(
      expect.arrayContaining(["diode", "npn", "pnp"]),
    );
    expect(symbols.map((symbol) => symbol.id)).not.toContain("transformer");
    expect(symbols.map((symbol) => symbol.id)).not.toContain("vccs");
  });

  it("returns no selectable entries for an unmatched query", () => {
    expect(
      flattenComponentCatalog(
        componentCatalog("razavi-textbook-v1", "does-not-exist"),
      ),
    ).toEqual([]);
  });
});

describe("reach order inside a category", () => {
  it("keeps the devices used together adjacent", () => {
    const groups = componentCatalog("razavi-textbook-v1", "");
    const ids = (category: string) =>
      groups
        .find((group) => group.category === category)!
        .symbols.map((symbol) => symbol.id);

    // Alphabetical order separated NMOS from PMOS with a bipolar between them,
    // and the supply Port from its Rail.
    expect(ids("Transistors")).toEqual(["nmos", "pmos", "npn", "pnp"]);
    expect(ids("Extended Devices")).toEqual([
      "variable-resistor",
      "variable-capacitor",
      "variable-inductor",
      "diode",
      "zener-diode",
      "ndmos",
      "pdmos",
    ]);
    const power = ids("Power and Ports");
    expect(power.indexOf("vdd-port")).toBeLessThan(power.indexOf("vdd"));
  });

  it("orders passives the way they are taught, not alphabetically", () => {
    const groups = componentCatalog("razavi-textbook-v1", "");
    const passives = groups
      .find((group) => group.category === "Passives")!
      .symbols.map((symbol) => symbol.id);
    // Resistor, capacitor, inductor — alphabetical put the capacitor first
    // and stranded the resistor behind both inductors.
    expect(passives).toEqual([
      "resistor",
      "capacitor",
      "inductor-compact",
      "inductor",
    ]);
  });

  it("orders logic gates by family rather than by name", () => {
    const groups = componentCatalog("razavi-textbook-v1", "");
    const gates = groups
      .find((group) => group.category === "Logic Gates")!
      .symbols.map((symbol) => symbol.id);
    // The two single-input gates lead, the combinational family follows in
    // its own order, and the sequential blocks sit last.
    expect(gates).toEqual([
      "inverter",
      "buffer",
      "and-gate",
      "or-gate",
      "nand-gate",
      "nor-gate",
      "xor-gate",
      "xnor-gate",
      "d-flip-flop",
      "delay-cell",
    ]);
  });
});
