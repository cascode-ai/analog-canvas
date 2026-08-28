import { describe, expect, it } from "vitest";

import {
  builtInDeviceDescriptors,
  deviceDescriptor,
  deviceDescriptorById,
  devicePinSemanticRole,
  validateDeviceDescriptors,
} from "./index.js";

describe("built-in device registry", () => {
  it("contains internally valid, uniquely identified descriptors", () => {
    expect(validateDeviceDescriptors(builtInDeviceDescriptors)).toEqual([]);
    expect(deviceDescriptorById("nmos")).toBe(deviceDescriptor("nmos"));
  });

  it("preserves MOS electrical and netlist behavior", () => {
    expect(deviceDescriptor("nmos")).toMatchObject({
      deviceClass: "mos",
      mosBulkClass: "nmos",
      referencePrefix: "M",
      pinOrder: ["D", "G", "S", "B"],
      targetPolicy: "required-model",
      parameters: [
        // W is the total width; NF divides it into fingers, so the panel can
        // derive FW and keep W = FW * NF without storing FW.
        { name: "w", required: true, displayRole: "width", defaultValue: "1u" },
        {
          name: "l",
          required: true,
          displayRole: "length",
          defaultValue: "150n",
        },
        {
          name: "nf",
          required: false,
          displayRole: "finger-count",
          defaultValue: "1",
        },
        {
          name: "m",
          required: false,
          displayRole: "multiplier",
          defaultValue: "1",
        },
      ],
      capabilities: { supportsBulkBinding: true },
    });
    expect(deviceDescriptor("ndmos")).toMatchObject({
      deviceClass: "mos",
      mosBulkClass: "nmos",
      referencePrefix: "M",
      pinOrder: ["D", "G", "S", "B"],
      targetPolicy: "required-model",
    });
    expect(deviceDescriptor("pdmos")).toMatchObject({
      deviceClass: "mos",
      mosBulkClass: "pmos",
      referencePrefix: "M",
      pinOrder: ["D", "G", "S", "B"],
      targetPolicy: "required-model",
    });
  });

  it("models adjustable passives as ordinary primitives of their base class", () => {
    expect(deviceDescriptor("variable-resistor")).toMatchObject({
      deviceClass: "resistor",
      referencePrefix: "R",
      pinOrder: ["P1", "P2"],
      targetPolicy: "builtin",
      parameters: [{ name: "value", required: true, displayRole: "value" }],
    });
    expect(deviceDescriptor("variable-capacitor")).toMatchObject({
      deviceClass: "capacitor",
      referencePrefix: "C",
      pinOrder: ["P1", "P2"],
      targetPolicy: "builtin",
      parameters: [{ name: "value", required: true, displayRole: "value" }],
    });
    expect(deviceDescriptor("variable-inductor")).toMatchObject({
      deviceClass: "inductor",
      referencePrefix: "L",
      pinOrder: ["P1", "P2"],
      targetPolicy: "builtin",
      parameters: [{ name: "value", required: true, displayRole: "value" }],
    });
  });

  it("models the Zener presentation as the ordinary model-bound diode primitive", () => {
    expect(deviceDescriptor("zener-diode")).toMatchObject({
      deviceClass: "diode",
      referencePrefix: "D",
      pinOrder: ["A", "K"],
      targetPolicy: "required-model",
      capabilities: {
        supportsModel: true,
        supportsBulkBinding: false,
      },
    });
  });

  it("keeps fixed and variable capacitor plate meaning on stable electrical pins", () => {
    const capacitor = deviceDescriptor("capacitor");
    const variableCapacitor = deviceDescriptor("variable-capacitor");
    expect(capacitor).toBeDefined();
    expect(variableCapacitor).toBeDefined();
    if (!capacitor || !variableCapacitor) return;
    expect(capacitor.pinOrder).toEqual(["1", "2"]);
    expect(devicePinSemanticRole(capacitor, "1")).toBe("capacitor-top-plate");
    expect(devicePinSemanticRole(capacitor, "2")).toBe(
      "capacitor-bottom-plate",
    );
    expect(devicePinSemanticRole(capacitor, "3")).toBeUndefined();
    expect(variableCapacitor.pinOrder).toEqual(["P1", "P2"]);
    expect(devicePinSemanticRole(variableCapacitor, "P1")).toBe(
      "capacitor-top-plate",
    );
    expect(devicePinSemanticRole(variableCapacitor, "P2")).toBe(
      "capacitor-bottom-plate",
    );
  });

  it("keeps reviewed net markers non-emitting", () => {
    expect(deviceDescriptor("ground")).toMatchObject({
      deviceClass: "net-marker",
      referencePrefix: null,
      pinOrder: ["0"],
      targetPolicy: "none",
    });
    expect(deviceDescriptor("vdd-port")).toMatchObject({
      deviceClass: "net-marker",
      referencePrefix: null,
      pinOrder: ["P"],
      targetPolicy: "none",
    });
  });

  it("defines a complete two-terminal Pulse Source protocol", () => {
    expect(deviceDescriptor("pulse-voltage-source")).toMatchObject({
      deviceClass: "voltage-source",
      referencePrefix: "V",
      pinOrder: ["+", "-"],
      targetPolicy: "builtin",
      parameters: [
        { name: "low", defaultValue: "0" },
        { name: "high", defaultValue: "1" },
        { name: "delay", defaultValue: "1ns" },
        { name: "rise", defaultValue: "1ps" },
        { name: "fall", defaultValue: "1ps" },
        { name: "width", defaultValue: "5ns" },
        { name: "period", defaultValue: "10ns" },
      ],
    });
  });

  it("rejects descriptor capability claims that would change device meaning", () => {
    const nmos = deviceDescriptor("nmos");
    expect(nmos).toBeDefined();
    if (!nmos) return;
    expect(
      validateDeviceDescriptors([
        {
          ...nmos,
          id: "invalid-bulk-device",
          symbolId: "invalid-bulk-device",
          deviceClass: "resistor",
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Only MOS devices may support bulk binding",
        }),
      ]),
    );
  });

  it("rejects incomplete or misplaced capacitor plate semantics", () => {
    const capacitor = deviceDescriptor("capacitor");
    const resistor = deviceDescriptor("resistor");
    expect(capacitor).toBeDefined();
    expect(resistor).toBeDefined();
    if (!capacitor || !resistor) return;
    expect(
      validateDeviceDescriptors([
        {
          ...capacitor,
          pinSemantics: [{ pinName: "1", role: "capacitor-top-plate" }],
        },
        {
          ...resistor,
          pinSemantics: [
            { pinName: "1", role: "capacitor-top-plate" },
            { pinName: "2", role: "capacitor-bottom-plate" },
          ],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "Capacitor devices must declare one top-plate and one bottom-plate pin semantic",
        }),
        expect.objectContaining({
          message: "Only capacitor devices may declare plate semantics",
        }),
      ]),
    );
  });
});
