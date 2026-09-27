import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";
import { componentParameters } from "../component-insert/component-parameters";
import {
  formatGroupPropertyCode,
  groupForeground,
  groupParameterContext,
  groupPropertyCodeValue,
  groupPropertyItems,
  parseGroupPropertyCode,
  type GroupPropertyCodeContext,
} from "./group-property-code";
import { planGroupPropertyCodeEdits } from "./group-property-code-edits";

const resistor = (id: string, value: string): Instance => ({
  id,
  symbolId: "resistor",
  reference: id,
  placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  netlist: {
    binding: { kind: "primitive", deviceClass: "resistor" },
    parameters: { value },
  },
});
function contextFor(instances: Instance[]): GroupPropertyCodeContext {
  return {
    ...groupParameterContext(instances, (instance) =>
      componentParameters(instance.symbolId),
    ),
    reference: true,
    value: false,
    foreground: groupForeground(instances, "#000000"),
  };
}
/** The context with each selected part listed, as the batch shows it. */
function listed(instances: Instance[]): GroupPropertyCodeContext {
  const context = contextFor(instances);
  return {
    ...context,
    items: groupPropertyItems(instances, {
      parametersFor: (instance) => componentParameters(instance.symbolId),
      parameterKeys: Object.keys(context.parameters ?? {}),
      nameOf: (instance) => instance.reference ?? instance.id,
      referenceVisible: () => true,
      valueVisible: () => null,
      defaultForeground: "#000000",
    }),
  };
}

describe("batch property planning", () => {
  it("shows rendered common color even when inheritance or hex spelling differs", () => {
    const instances = [
      resistor("R1", "1k"),
      { ...resistor("R2", "1k"), styleOverride: { foreground: "#000" } },
    ];
    expect(groupForeground(instances, "#000000")).toBe("#000000");
    expect(contextFor(instances).parameters).toEqual({ value: "1k" });
    expect(groupForeground(instances, "#112233")).toBe("");
    expect(
      groupForeground(
        [
          { ...instances[0]!, styleOverride: { foreground: "#AABBCC" } },
          { ...instances[1]!, styleOverride: { foreground: "#abc" } },
        ],
        "#000",
      ),
    ).toBe("#aabbcc");
  });
  it("patches the assigned value and color while retiring component background paint", () => {
    const a = resistor("R1", "1k"),
      b = resistor("R2", "2k");
    a.styleOverride = { foreground: "#000", background: "#ffffff" };
    a.netlist!.parameters.tc = "0.1";
    b.netlist!.parameters.tc = "0.2";
    const ctx = contextFor([a, b]);
    expect(ctx).toMatchObject({
      symbol: "resistor",
      foreground: "#000000",
      parameters: { value: "", tc: "" },
    });
    const value = groupPropertyCodeValue(ctx);
    expect(planGroupPropertyCodeEdits([a, b], value, ctx)).toEqual([]);
    value.parameters = { value: "10k", tc: "" };
    value.appearance.color = "#dc2626";
    expect(planGroupPropertyCodeEdits([a, b], value, ctx)).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { foreground: "#dc2626" },
      },
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "R1",
        set: { value: "10k" },
      },
      {
        kind: "set_instance_style_override",
        instanceId: "R2",
        styleOverride: { foreground: "#dc2626" },
      },
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "R2",
        set: { value: "10k" },
      },
    ]);
    expect(a.netlist!.parameters).toEqual({ value: "1k", tc: "0.1" });
  });
  it("unifies MOS width while keeping each differing length and model binding", () => {
    const instances: Instance[] = ["180n", "360n"].map((l, i) => ({
      ...resistor(`M${i}`, ""),
      symbolId: "nmos",
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: `NM${i}` },
        parameters: { w: "2u", l },
      },
    }));
    const ctx = contextFor(instances);
    expect(ctx.parameters).toMatchObject({ w: "2u", l: "" });
    const value = groupPropertyCodeValue(ctx);
    if (value.parameters === "") throw Error("parameters required");
    value.parameters = { ...value.parameters, w: "4u" };
    expect(planGroupPropertyCodeEdits(instances, value, ctx)).toEqual(
      instances.map((instance) => ({
        kind: "patch_instance_netlist_parameters",
        instanceId: instance.id,
        set: { w: "4u" },
      })),
    );
  });
  it("lists what parts of different types share, each by its own value", () => {
    const nmos = {
      ...resistor("M1", ""),
      symbolId: "nmos",
      netlist: {
        binding: { kind: "primitive", deviceClass: "mos" },
        parameters: { w: "1u", l: "180n" },
      },
    } as Instance;
    const pmos = {
      ...nmos,
      id: "M2",
      reference: "M2",
      symbolId: "pmos",
      netlist: { ...nmos.netlist!, parameters: { w: "2u", l: "180n" } },
    } as Instance;
    const ctx = listed([nmos, pmos]);
    expect(ctx.symbol).toBe("");
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    // Width and length mean the same on both: each part is listed, and one
    // value still sets them all.
    expect(code.parameters).toMatchObject({
      w: { M1: "1u", M2: "2u" },
      l: { M1: "180n", M2: "180n" },
    });
    code.parameters.w = { M1: "1u", M2: "4u" };
    code.parameters.l = "360n";
    const parsed = parseGroupPropertyCode(JSON.stringify(code), ctx);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(planGroupPropertyCodeEdits([nmos, pmos], parsed.value, ctx)).toEqual(
      [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { l: "360n" },
        },
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M2",
          set: { w: "4u", l: "360n" },
        },
      ],
    );
  });
  it("keeps a parameter that means different things per type to each part's own value", () => {
    const instances = [
      resistor("R1", "1k"),
      { ...resistor("C1", "1p"), symbolId: "capacitor" },
    ];
    const ctx = listed(instances);
    // Both have a value: in ohms and in farads.
    expect(ctx).toMatchObject({
      symbol: "",
      parameters: { value: "" },
      perComponentParameters: ["value"],
    });
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    expect(code.parameters).toEqual({ value: { R1: "1k", C1: "1p" } });
    code.parameters.value = { R1: "2k", C1: "1p" };
    code.appearance.color = [255, 0, 0];
    const parsed = parseGroupPropertyCode(JSON.stringify(code), ctx);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(planGroupPropertyCodeEdits(instances, parsed.value, ctx)).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { foreground: "#ff0000" },
      },
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "R1",
        set: { value: "2k" },
      },
      {
        kind: "set_instance_style_override",
        instanceId: "C1",
        styleOverride: { foreground: "#ff0000" },
      },
    ]);
    // One value for both would be ohms on one and farads on the other.
    code.parameters.value = "10k";
    expect(parseGroupPropertyCode(JSON.stringify(code), ctx)).toMatchObject({
      ok: false,
      message:
        "parameters.value means something different on each component type; give each component its own value",
    });
    // The type stays read-only.
    code.parameters.value = { R1: "1k", C1: "1p" };
    code.symbol = "resistor";
    expect(parseGroupPropertyCode(JSON.stringify(code), ctx).ok).toBe(false);
  });
  it("lists a parameter two different subcircuits share, one entry each", () => {
    const instances = ["a", "b"].map((id, index) => ({
      ...resistor(id, "1"),
      netlist: {
        binding: { kind: "external-subcircuit" as const, definitionId: id },
        parameters: { gain: String(index + 1) },
      },
    }));
    expect(
      JSON.parse(formatGroupPropertyCode(listed(instances))).parameters.gain,
    ).toEqual({ a: "1", b: "2" });
  });
  it("offers no parameters when one selected part has none", () => {
    const pin = { ...resistor("P1", ""), symbolId: "port" };
    delete (pin as { netlist?: unknown }).netlist;
    const ctx = listed([resistor("R1", "1k"), pin]);
    expect(ctx.parameters).toBeNull();
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    code.parameters = { value: "2k" };
    expect(parseGroupPropertyCode(JSON.stringify(code), ctx)).toMatchObject({
      ok: false,
      message: "The selected components share no parameters",
    });
  });
  it("accepts blank as keep-current and rejects missing, unknown, or invalid parameter values", () => {
    const instances = [resistor("R1", "1k"), resistor("R2", "2k")];
    const ctx = contextFor(instances);
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    code.parameters.value = "";
    code.appearance.color = "";
    const parsed = parseGroupPropertyCode(JSON.stringify(code), ctx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(planGroupPropertyCodeEdits(instances, parsed.value, ctx)).toEqual(
        [],
      );
    for (const parameters of [
      {},
      { value: 10 },
      { value: "1k", extra: "3" },
      { value: "x".repeat(1025) },
    ])
      expect(
        parseGroupPropertyCode(JSON.stringify({ ...code, parameters }), ctx).ok,
      ).toBe(false);
  });
  it("resets component color and retires obsolete background paint", () => {
    const instance = {
      ...resistor("R1", "1k"),
      styleOverride: { foreground: "#dc2626", background: "#ffffff" },
    };
    const ctx = contextFor([instance]);
    const value = groupPropertyCodeValue(ctx);
    value.appearance.color = "auto";
    expect(planGroupPropertyCodeEdits([instance], value, ctx)).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: null,
      },
    ]);
  });
  it("updates each digital clock's pulse projection from its own retained duty cycle", () => {
    const instances: Instance[] = ["25", "75"].map((dutyCycle, i) => ({
      ...resistor(`V${i}`, ""),
      symbolId: "pulse-voltage-source",
      netlist: {
        parameters: {
          period: "100ps",
          dutyCycle,
          initial: "0",
          width: `${dutyCycle}ps`,
        },
      },
    }));
    const ctx = contextFor(instances);
    const value = groupPropertyCodeValue(ctx);
    if (value.parameters === "") throw Error("parameters required");
    value.parameters = { ...value.parameters, period: "200ps" };
    const edits = planGroupPropertyCodeEdits(instances, value, ctx);
    expect(edits).toMatchObject([
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "V0",
        set: { period: "200ps", width: "50ps", delay: "150ps" },
      },
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "V1",
        set: { period: "200ps", width: "150ps", delay: "50ps" },
      },
    ]);
  });
});
