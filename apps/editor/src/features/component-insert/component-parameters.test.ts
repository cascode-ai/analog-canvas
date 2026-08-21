import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";

import {
  componentParameters,
  effectiveComponentParameterValue,
  externalMosComponentParameters,
  initialComponentParameterValues,
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

  it("uses W, L, and M for manual MOS authoring", () => {
    expect(componentParameters("nmos").map(({ key }) => key)).toEqual([
      "w",
      "l",
      "m",
    ]);
    expect(componentParameters("pmos")).toEqual(componentParameters("nmos"));
    expect(initialComponentParameterValues("nmos")).toEqual({
      w: "",
      l: "",
      m: "",
    });
  });

  it("uses W, L, and NF for a reviewed external MOS call", () => {
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
      netlist: { reference: "M1", parameters: { w: "1u" } },
    };
    expect(effectiveComponentParameterValue(instance, parameter)).toBe("1u");
    instance.netlist = { reference: "M1", parameters: { w: "3u" } };
    expect(effectiveComponentParameterValue(instance, parameter)).toBe("3u");
  });
});
