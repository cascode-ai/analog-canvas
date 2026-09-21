import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  bindingForEditedModel,
  initialInstanceNetlist,
  instanceIdPrefix,
  nextCellPinName,
  nextInstanceId,
  nextInstanceReference,
} from "./netlist-authoring";

describe("netlist authoring", () => {
  it("allocates References only from the case-folded Reference domain", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "opaque-a",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: { parameters: {} },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R3",
        netlist: { parameters: {} },
      },
    );
    expect(nextInstanceReference(document, "resistor")).toBe("R2");
    expect(nextInstanceReference(document, "variable-resistor")).toBe("R2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
  });

  it("allocates object IDs without treating Reference as identity", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M8",
      netlist: { parameters: {} },
    });
    expect(nextInstanceId(document, "nmos")).toBe("M2");
    expect(nextInstanceReference(document, "nmos")).toBe("M1");
    expect(nextInstanceId(document, "ground")).toBe("GND1");
    expect(instanceIdPrefix("inductor")).toBe("L");
  });

  it("allocates Cell Pin and Bias Voltage Port names from separate sequences", () => {
    const document = createEmptyDocument("main", "Main");
    document.netlist = {
      name: "Main",
      formalParameters: [],
      terminals: [],
    };

    expect(nextCellPinName(document)).toBe("Vinp");
    document.netlist.terminals.push({
      id: "terminal-in",
      name: "Vinp",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    expect(nextCellPinName(document)).toBe("Vinn");
    document.netlist.terminals.push({
      id: "terminal-in-n",
      name: "Vinn",
      netId: "net-in-n",
      direction: "input",
      interfaceInstanceIds: ["P2"],
    });
    expect(nextCellPinName(document)).toBe("Vout");
    document.netlist.terminals.push({
      id: "terminal-out",
      name: "Vout",
      netId: "net-out",
      direction: "output",
      interfaceInstanceIds: ["P3"],
    });
    expect(nextCellPinName(document)).toBe("Vin2p");
    expect(nextCellPinName(document, new Set(), "filled")).toBe("VB1");
    expect(nextCellPinName(document, new Set(["vb1"]), "filled")).toBe("VB2");
  });

  it("creates typed netlist facts without duplicating Reference", () => {
    expect(initialInstanceNetlist("resistor", { value: "10k" })).toEqual({
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    });
    expect(initialInstanceNetlist("nmos", { w: "2u", l: "60n" })).toEqual({
      parameters: { w: "2u", l: "60n" },
    });
    expect(initialInstanceNetlist("voltage-source", { dc: "1.8" })).toEqual({
      binding: { kind: "primitive", deviceClass: "voltage-source" },
      parameters: { dc: "1.8" },
    });
    // A typed AC magnitude is written like any other authored value; the blank
    // phase field writes nothing, so the printed card defaults it to 0.
    expect(
      initialInstanceNetlist("current-source", {
        dc: "0",
        acMagnitude: "1u",
        acPhase: "",
      }),
    ).toEqual({
      binding: { kind: "primitive", deviceClass: "current-source" },
      parameters: { dc: "0", acMagnitude: "1u" },
    });
    expect(initialInstanceNetlist("ground", {})).toBeUndefined();
    expect(initialInstanceNetlist("opamp-differential", {})).toEqual({
      binding: {
        kind: "unresolved-subcircuit",
        name: "opamp_differential",
      },
      parameters: {},
    });
    expect(
      nextInstanceReference(createEmptyDocument("main", "Main"), "opamp"),
    ).toBe("X1");
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
