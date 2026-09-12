import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";

import {
  componentParameters,
  effectiveComponentParameterValue,
  reviewedExternalComponentParameters,
  initialComponentParameterValues,
  updateComponentParameterValues,
} from "./component-parameters";
import {
  deviceDescriptor,
  reviewedExternalBindingForMaster,
} from "@icm/devices";

describe("component parameter catalogue", () => {
  it("seeds fixed and adjustable R/L/C values with their physical units", () => {
    expect(componentParameters("resistor")).toMatchObject([
      { key: "value", unit: "Ohm", defaultValue: "1k", help: "Resistance" },
    ]);
    expect(componentParameters("capacitor")).toMatchObject([
      { key: "value", unit: "F", defaultValue: "1p", help: "Capacitance" },
    ]);
    expect(componentParameters("inductor-compact")).toMatchObject([
      { key: "value", unit: "H", defaultValue: "1n", help: "Inductance" },
    ]);
    expect(componentParameters("inductor")).toMatchObject([
      { key: "value", unit: "H", defaultValue: "1n", help: "Inductance" },
    ]);
    expect(componentParameters("variable-resistor")).toMatchObject([
      { key: "value", unit: "Ohm", defaultValue: "1k" },
    ]);
    expect(componentParameters("variable-capacitor")).toMatchObject([
      { key: "value", unit: "F", defaultValue: "1p" },
    ]);
    expect(componentParameters("variable-inductor")).toMatchObject([
      { key: "value", unit: "H", defaultValue: "1n" },
    ]);
    expect(initialComponentParameterValues("resistor")).toEqual({
      value: "1k",
    });
    expect(initialComponentParameterValues("capacitor")).toEqual({
      value: "1p",
    });
    expect(initialComponentParameterValues("inductor-compact")).toEqual({
      value: "1n",
    });
    expect(initialComponentParameterValues("variable-resistor")).toEqual({
      value: "1k",
    });
    expect(initialComponentParameterValues("variable-capacitor")).toEqual({
      value: "1p",
    });
    expect(initialComponentParameterValues("variable-inductor")).toEqual({
      value: "1n",
    });
  });

  it("seeds compound magnetic devices without reducing them to one value", () => {
    expect(componentParameters("tcoil")).toMatchObject([
      { key: "l1", unit: "H", defaultValue: "1n" },
      { key: "l2", unit: "H", defaultValue: "1n" },
      { key: "k", defaultValue: "1" },
      { key: "cb", unit: "F", defaultValue: "1p" },
    ]);
    expect(initialComponentParameterValues("tcoil")).toEqual({
      l1: "1n",
      l2: "1n",
      k: "1",
      cb: "1p",
    });
    expect(componentParameters("xfmr")).toMatchObject([
      { key: "lp", unit: "H", defaultValue: "1n" },
      { key: "ls", unit: "H", defaultValue: "1n" },
      { key: "k", defaultValue: "1" },
    ]);
    expect(initialComponentParameterValues("xfmr")).toEqual({
      lp: "1n",
      ls: "1n",
      k: "1",
    });
  });

  it("uses W, L, NF, and M for manual MOS authoring", () => {
    expect(componentParameters("nmos").map(({ key }) => key)).toEqual([
      "w",
      "l",
      "nf",
      "m",
    ]);
    expect(componentParameters("pmos")).toEqual(componentParameters("nmos"));
    expect(componentParameters("ndmos")).toEqual(componentParameters("nmos"));
    expect(componentParameters("pdmos")).toEqual(componentParameters("pmos"));
    // A MOS placed with no geometry could not display a value at all, so
    // placement seeds each device default instead of leaving them blank.
    expect(initialComponentParameterValues("nmos")).toEqual({
      w: "1u",
      l: "150n",
      nf: "1",
      m: "1",
    });
  });

  it("keeps distinct reviewed external multipliers and passive geometry", () => {
    const nmos = reviewedExternalBindingForMaster("sky130_fd_pr__nfet_01v8")!;
    const resistor = reviewedExternalBindingForMaster(
      "sky130_fd_pr__res_high_po",
    )!;
    const capacitor = reviewedExternalBindingForMaster(
      "sky130_fd_pr__cap_mim_m3_1",
    )!;
    expect(
      reviewedExternalComponentParameters(nmos).map(({ key }) => key),
    ).toEqual(["w", "l", "nf", "m"]);
    expect(
      reviewedExternalComponentParameters(resistor).map(({ key }) => key),
    ).toEqual(["w", "l", "mult"]);
    expect(
      reviewedExternalComponentParameters(capacitor).map(({ key }) => key),
    ).toEqual(["w", "l", "mf"]);
  });

  it("projects the descriptor's ordered field metadata without local defaults", () => {
    const descriptor = deviceDescriptor("voltage-source");
    expect(componentParameters("voltage-source")).toEqual(
      descriptor?.parameters.map((parameter) => ({
        key: parameter.name,
        label: parameter.label,
        ...(parameter.unitHint ? { unit: parameter.unitHint } : {}),
        placeholder: parameter.placeholder,
        ...(parameter.defaultValue
          ? { defaultValue: parameter.defaultValue }
          : {}),
        help: parameter.help,
        ...(parameter.editor === "select"
          ? { options: parameter.options }
          : { inputMode: parameter.editor }),
        ...(parameter.visibleForSourceWaveforms
          ? { visibleForSourceWaveforms: parameter.visibleForSourceWaveforms }
          : {}),
      })),
    );
  });

  it("offers all independent-source modes through the ordinary parameter path", () => {
    for (const [symbolId, unit] of [
      ["voltage-source", "V"],
      ["current-source", "A"],
    ] as const) {
      const parameters = componentParameters(symbolId);
      expect(parameters.find(({ key }) => key === "dc")).toMatchObject({
        unit,
      });
      expect(parameters.find(({ key }) => key === "waveform")).toMatchObject({
        label: "Transient",
        options: [
          { value: "dc", label: "None" },
          { value: "pulse", label: "PULSE" },
          { value: "sin", label: "SIN" },
          { value: "pwl", label: "PWL" },
        ],
      });
      expect(parameters.find(({ key }) => key === "acMagnitude")).toMatchObject(
        {
          label: "AC magnitude",
          unit,
        },
      );
      expect(parameters.find(({ key }) => key === "amplitude")).toMatchObject({
        unit,
        visibleForSourceWaveforms: ["sin"],
      });
      expect(parameters.some((parameter) => parameter.compatibilityOnly)).toBe(
        false,
      );
      expect(initialComponentParameterValues(symbolId)).toMatchObject({
        dc: "",
        waveform: "dc",
        acMagnitude: "",
        acPhase: "",
        low: "0",
        high: unit === "V" ? "1" : "1m",
        period: "10ns",
        offset: "0",
        amplitude: unit === "V" ? "1" : "1m",
        frequency: "1k",
      });
    }
  });

  it("preserves inactive source fields while switching waveform mode", () => {
    let values = initialComponentParameterValues("voltage-source");
    values = updateComponentParameterValues(
      "voltage-source",
      values,
      "waveform",
      "pulse",
    );
    values = updateComponentParameterValues(
      "voltage-source",
      values,
      "high",
      "1.8",
    );
    values = updateComponentParameterValues(
      "voltage-source",
      values,
      "waveform",
      "sin",
    );
    values = updateComponentParameterValues(
      "voltage-source",
      values,
      "amplitude",
      "20m",
    );

    expect(values).toMatchObject({
      waveform: "sin",
      high: "1.8",
      amplitude: "20m",
    });
  });

  it("uses typed netlist parameters as the single component-value authority", () => {
    const parameter = componentParameters("nmos")[0]!;
    const instance: Instance = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
      netlist: { parameters: { w: "1u" } },
    };
    expect(effectiveComponentParameterValue(instance, parameter)).toBe("1u");
    instance.netlist = { parameters: { w: "3u" } };
    expect(effectiveComponentParameterValue(instance, parameter)).toBe("3u");
  });

  it("authors a flat Digital Clock profile while keeping synchronized SPICE fields", () => {
    const parameters = componentParameters("pulse-voltage-source");
    expect(
      parameters
        .filter((parameter) => !parameter.compatibilityOnly)
        .map(({ key }) => key),
    ).toEqual(["period", "dutyCycle", "initial"]);
    expect(initialComponentParameterValues("pulse-voltage-source")).toEqual({
      period: "10ns",
      dutyCycle: "50",
      initial: "0",
      low: "0",
      high: "1",
      delay: "5ns",
      rise: "1ps",
      fall: "1ps",
      width: "5ns",
    });

    expect(
      updateComponentParameterValues(
        "pulse-voltage-source",
        initialComponentParameterValues("pulse-voltage-source"),
        "dutyCycle",
        "25",
      ),
    ).toMatchObject({
      dutyCycle: "25",
      low: "0",
      high: "1",
      delay: "7500ps",
      width: "2500ps",
    });
    expect(
      updateComponentParameterValues(
        "pulse-voltage-source",
        initialComponentParameterValues("pulse-voltage-source"),
        "initial",
        "1",
      ),
    ).toMatchObject({
      initial: "1",
      low: "1",
      high: "0",
      delay: "5000ps",
      width: "5000ps",
    });
  });

  it("derives Digital Clock controls when opening a legacy Pulse Source", () => {
    const instance: Instance = {
      id: "V1",
      symbolId: "pulse-voltage-source",
      placement: null,
      reference: "V1",
      netlist: {
        parameters: { period: "8ns", width: "2ns", low: "0" },
      },
    };
    const byKey = new Map(
      componentParameters(instance.symbolId).map((parameter) => [
        parameter.key,
        effectiveComponentParameterValue(instance, parameter),
      ]),
    );
    expect(byKey.get("dutyCycle")).toBe("25");
    expect(byKey.get("initial")).toBe("0");
  });
});
