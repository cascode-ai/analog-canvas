import { describe, expect, it } from "vitest";
import type { Instance } from "@icm/model";
import { componentParameters } from "../component-insert/component-parameters";
import {
  formatGroupPropertyCode,
  groupForeground,
  groupParameterContext,
  groupPropertyCodeValue,
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
  it("patches just the assigned value and keeps backgrounds, names, placement and other parameters", () => {
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
    value.appearance.foreground = "#dc2626";
    expect(planGroupPropertyCodeEdits([a, b], value, ctx)).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { foreground: "#dc2626", background: "#ffffff" },
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
  it("keeps mixed types blank, allows common color, and rejects a partial parameter/type assignment", () => {
    const instances = [
      resistor("R1", "1k"),
      { ...resistor("C1", "1p"), symbolId: "capacitor" },
    ];
    const ctx = contextFor(instances);
    expect(ctx).toMatchObject({ symbol: "", parameters: null });
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    expect(code).toMatchObject({ symbol: "", parameters: "" });
    code.appearance.foreground = [255, 0, 0];
    const parsed = parseGroupPropertyCode(JSON.stringify(code), ctx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(
        planGroupPropertyCodeEdits(instances, parsed.value, ctx),
      ).toHaveLength(2);
    code.parameters = { value: "10k" };
    expect(parseGroupPropertyCode(JSON.stringify(code), ctx).ok).toBe(false);
    code.parameters = "";
    code.symbol = "resistor";
    expect(parseGroupPropertyCode(JSON.stringify(code), ctx).ok).toBe(false);
  });
  it("does not combine different subcircuit interfaces even when their drawings match", () => {
    const instances = ["a", "b"].map((id) => ({
      ...resistor(id, "1"),
      netlist: {
        binding: { kind: "external-subcircuit" as const, definitionId: id },
        parameters: { gain: "1" },
      },
    }));
    expect(contextFor(instances).parameters).toBeNull();
  });
  it("accepts blank as keep-current and rejects missing, unknown, or invalid parameter values", () => {
    const instances = [resistor("R1", "1k"), resistor("R2", "2k")];
    const ctx = contextFor(instances);
    const code = JSON.parse(formatGroupPropertyCode(ctx));
    code.parameters.value = "";
    code.appearance.foreground = "";
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
  it("resets only ink and keeps independently authored background paint", () => {
    const instance = {
      ...resistor("R1", "1k"),
      styleOverride: { foreground: "#dc2626", background: "#ffffff" },
    };
    const ctx = contextFor([instance]);
    const value = groupPropertyCodeValue(ctx);
    value.appearance.foreground = "auto";
    expect(planGroupPropertyCodeEdits([instance], value, ctx)).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { background: "#ffffff" },
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
