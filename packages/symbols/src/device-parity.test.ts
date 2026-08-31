import { describe, expect, it } from "vitest";

import {
  builtInDeviceDescriptors,
  deviceDescriptor,
  deviceRegistry,
  validateDeviceRegistry,
} from "@icm/devices";

import { builtInSymbols } from "./builtins.js";

describe("built-in device/Symbol parity", () => {
  it("matches every registered definition to canonical Symbol pin order", () => {
    expect(validateDeviceRegistry(deviceRegistry, builtInSymbols)).toEqual([]);
  });

  it("preserves hidden MOS bulk as the fourth electrical pin", () => {
    expect(deviceDescriptor("nmos")).toMatchObject({
      deviceClass: "mos",
      referencePrefix: "M",
      pinOrder: ["D", "G", "S", "B"],
      targetPolicy: "required-model",
      parameters: [
        { name: "w", required: true },
        { name: "l", required: true },
        { name: "nf", required: false },
        { name: "m", required: false },
      ],
    });
    for (const symbolId of ["ndmos", "pdmos"]) {
      expect(deviceDescriptor(symbolId)).toMatchObject({
        deviceClass: "mos",
        referencePrefix: "M",
        pinOrder: ["D", "G", "S", "B"],
        targetPolicy: "required-model",
      });
    }
  });

  it("defines Ground artwork as a non-emitting Net marker", () => {
    expect(deviceDescriptor("ground")).toMatchObject({
      deviceClass: "net-marker",
      referencePrefix: null,
      pinOrder: ["0"],
      targetPolicy: "none",
    });
    expect(deviceDescriptor("vdd")).toBeUndefined();
  });

  it("defines the VDD power port as a non-emitting Net marker", () => {
    expect(deviceDescriptor("vdd-port")).toMatchObject({
      deviceClass: "net-marker",
      referencePrefix: null,
      pinOrder: ["P"],
      targetPolicy: "none",
    });
  });

  it("leaves unsupported catalog blocks explicit instead of guessing", () => {
    for (const symbolId of [
      "opamp",
      "voltage-amplifier",
      "ideal-switch",
      "closed-switch",
      "port",
      "port-filled",
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
    ]) {
      expect(deviceDescriptor(symbolId)).toBeUndefined();
    }
    expect(builtInDeviceDescriptors.length).toBeGreaterThan(0);
  });
});
