import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";

import {
  componentParameters,
  effectiveComponentParameterValue,
  externalMosComponentParameters,
  initialComponentParameterValues,
  updateComponentParameterValues,
} from "./component-parameters";
import { deviceDescriptor } from "@icm/devices";

describe("component parameter catalogue", () => {
  it("keeps R/L/C values as raw strings with their physical unit hints", () => {
    expect(componentParameters("resistor")).toMatchObject([
      { key: "value", unit: "Ohm", help: "Resistance" },
    ]);
    expect(componentParameters("capacitor")).toMatchObject([
      { key: "value", unit: "F", help: "Capacitance" },
    ]);
    expect(componentParameters("inductor")).toMatchObject([
      { key: "value", unit: "H", help: "Inductance" },
    ]);
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

  it("drops only the multiplier for a reviewed external MOS call", () => {
    expect(
      externalMosComponentParameters("nmos").map(({ key }) => key),
    ).toEqual(["w", "l", "nf"]);
    expect(externalMosComponentParameters("pmos")).toEqual(
      externalMosComponentParameters("nmos"),
    );
  });

  it("projects the descriptor's ordered field metadata without local defaults", () => {
    const descriptor = deviceDescriptor("voltage-source");
    expect(componentParameters("voltage-source")).toEqual(
      descriptor?.parameters.map((parameter) => ({
        key: parameter.name,
        label: parameter.label,
        ...(parameter.unitHint ? { unit: parameter.unitHint } : {}),
        placeholder: parameter.placeholder,
        help: parameter.help,
        inputMode: parameter.editor,
      })),
    );
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
