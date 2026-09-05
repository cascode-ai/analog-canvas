import { describe, expect, it } from "vitest";

import {
  builtInDeviceDescriptors,
  deviceDescriptor,
  deviceDescriptorById,
  devicePinSemanticRole,
  referencePolicyForSymbol,
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
      seriesInsertionPinPair: ["D", "S"],
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
    expect(deviceDescriptor("npn")?.seriesInsertionPinPair).toEqual(["C", "E"]);
    expect(deviceDescriptor("pnp")?.seriesInsertionPinPair).toEqual(["C", "E"]);
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

  it("assigns compound magnetic symbols an editable identity without inventing a primitive netlist", () => {
    expect(deviceDescriptor("tcoil")).toMatchObject({
      deviceClass: "inductor",
      referencePrefix: "X",
      pinOrder: ["1", "2", "3"],
      targetPolicy: "none",
    });
    expect(deviceDescriptor("xfmr")).toMatchObject({
      deviceClass: "inductor",
      referencePrefix: "X",
      pinOrder: ["P-", "P+", "S-", "S+"],
      targetPolicy: "none",
    });
    expect(referencePolicyForSymbol("tcoil")).toEqual({
      kind: "required",
      prefix: "X",
    });
    expect(referencePolicyForSymbol("xfmr")).toEqual({
      kind: "required",
      prefix: "X",
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

  it("gives independent sources one DC, AC, PULSE, and SIN authoring contract", () => {
    for (const [id, unit] of [
      ["voltage-source", "V"],
      ["current-source", "A"],
    ] as const) {
      const descriptor = deviceDescriptor(id)!;
      expect(descriptor.sourceWaveformDefault).toBe("dc");
      expect(descriptor.parameters.map((parameter) => parameter.name)).toEqual([
        "dc",
        "waveform",
        "acMagnitude",
        "acPhase",
        "low",
        "high",
        "delay",
        "rise",
        "fall",
        "width",
        "period",
        "offset",
        "amplitude",
        "frequency",
        "damping",
        "phase",
      ]);
      expect(
        descriptor.parameters.find(({ name }) => name === "dc"),
      ).toMatchObject({
        required: true,
        unitHint: unit,
        displayRole: "value",
      });
      expect(
        descriptor.parameters.find(({ name }) => name === "waveform"),
      ).toMatchObject({
        editor: "select",
        defaultValue: "dc",
        options: [{ value: "dc" }, { value: "pulse" }, { value: "sin" }],
      });
      // The AC fields are optional and default to nothing: a placed source is
      // DC-only until an author writes a magnitude, and the printed card never
      // carries a value the schematic does not.
      expect(
        descriptor.parameters
          .filter((parameter) => parameter.name.startsWith("ac"))
          .every((parameter) => parameter.defaultValue === undefined),
      ).toBe(true);
      expect(
        descriptor.parameters.find(({ name }) => name === "amplitude"),
      ).toMatchObject({
        unitHint: unit,
        visibleForSourceWaveforms: ["sin"],
      });
    }
  });

  it("keeps Digital Clock artwork and compatibility controls on formal PULSE intent", () => {
    expect(deviceDescriptor("pulse-voltage-source")).toMatchObject({
      deviceClass: "voltage-source",
      referencePrefix: "V",
      pinOrder: ["+", "-"],
      targetPolicy: "builtin",
      sourceWaveformDefault: "pulse",
      parameters: [
        { name: "period", defaultValue: "10ns" },
        { name: "dutyCycle", defaultValue: "50" },
        { name: "initial", defaultValue: "0" },
        {
          name: "low",
          defaultValue: "0",
          authoringVisibility: "compatibility",
        },
        {
          name: "high",
          defaultValue: "1",
          authoringVisibility: "compatibility",
        },
        {
          name: "delay",
          defaultValue: "5ns",
          authoringVisibility: "compatibility",
        },
        {
          name: "rise",
          defaultValue: "1ps",
          authoringVisibility: "compatibility",
        },
        {
          name: "fall",
          defaultValue: "1ps",
          authoringVisibility: "compatibility",
        },
        {
          name: "width",
          defaultValue: "5ns",
          authoringVisibility: "compatibility",
        },
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

  it("rejects invalid series-insertion pin-pair declarations", () => {
    const nmos = deviceDescriptor("nmos");
    expect(nmos).toBeDefined();
    if (!nmos) return;
    expect(
      validateDeviceDescriptors([
        { ...nmos, seriesInsertionPinPair: ["D", "D"] },
        {
          ...nmos,
          id: "unknown-series-pin",
          symbolId: "unknown-series-pin",
          seriesInsertionPinPair: ["D", "X"],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Series insertion pin pair must contain two distinct pins",
        }),
        expect.objectContaining({
          message: "Series insertion references unknown pin: X",
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
