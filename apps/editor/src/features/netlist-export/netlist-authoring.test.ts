import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  bindingForEditedModel,
  initialInstanceNetlist,
  netlistReferenceMatchesPlacement,
  nextInstanceDesignator,
  nextInstanceReference,
  placementReferencePrefix,
} from "./netlist-authoring";

describe("netlist authoring", () => {
  it("allocates the lowest unused reference by reviewed device prefix", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "a",
        symbolId: "resistor",
        placement: null,
        properties: {},
        netlist: { reference: "R1", parameters: {} },
      },
      {
        id: "b",
        symbolId: "resistor",
        placement: null,
        properties: {},
        netlist: { reference: "R3", parameters: {} },
      },
    );
    expect(nextInstanceReference(document, "resistor")).toBe("R2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
  });

  it("allocates the lowest unused designator per placement prefix", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        properties: {},
        netlist: { reference: "R1", parameters: {} },
      },
      {
        id: "M1",
        symbolId: "nmos",
        placement: null,
        properties: {},
        netlist: { reference: "M1", parameters: {} },
      },
      {
        id: "R3",
        symbolId: "resistor",
        placement: null,
        properties: {},
        netlist: { reference: "R3", parameters: {} },
      },
    );
    expect(nextInstanceDesignator(document, "resistor")).toBe("R2");
    expect(nextInstanceDesignator(document, "nmos")).toBe("M2");
    // nmos and pmos share the M prefix; neither call mutates the document.
    expect(nextInstanceDesignator(document, "pmos")).toBe("M2");
    expect(nextInstanceDesignator(document, "capacitor")).toBe("C1");
  });

  it("keeps schematic-only marker prefixes and id/reference agreement flags", () => {
    const document = createEmptyDocument("main", "Main");
    expect(nextInstanceDesignator(document, "ground")).toBe("GND1");
    expect(nextInstanceDesignator(document, "port")).toBe("P1");
    expect(placementReferencePrefix("inductor")).toBe("L");
    expect(placementReferencePrefix("unknown-symbol")).toBe("X");
    expect(netlistReferenceMatchesPlacement("resistor")).toBe(true);
    expect(netlistReferenceMatchesPlacement("pmos")).toBe(true);
    expect(netlistReferenceMatchesPlacement("ground")).toBe(false);
    expect(netlistReferenceMatchesPlacement("port")).toBe(false);
  });

  it("accepts an explicit reference so placement id and reference agree", () => {
    const document = createEmptyDocument("main", "Main");
    expect(
      initialInstanceNetlist(document, "resistor", { value: "10k" }, "R7"),
    ).toMatchObject({ reference: "R7" });
  });

  it("creates typed primitive facts while leaving MOS model explicit", () => {
    const document = createEmptyDocument("main", "Main");
    expect(
      initialInstanceNetlist(document, "resistor", { value: "10k" }),
    ).toEqual({
      reference: "R1",
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    });
    expect(
      initialInstanceNetlist(document, "nmos", { w: "2u", l: "60n" }),
    ).toEqual({
      reference: "M1",
      parameters: { w: "2u", l: "60n" },
    });
  });

  it("creates a model binding only from explicit edited text", () => {
    expect(bindingForEditedModel("nmos", " nch_mac ")).toEqual({
      kind: "model",
      deviceClass: "mos",
      name: "nch_mac",
    });
    expect(bindingForEditedModel("nmos", "")).toBeUndefined();
  });
});
