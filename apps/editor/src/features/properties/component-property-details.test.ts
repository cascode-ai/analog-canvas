import { describe, it, expect } from "vitest";
import type { Instance } from "@icm/model";
import { componentParameters } from "../component-insert/component-parameters";
import {
  defaultComponentPropertyCode,
  formatComponentPropertyCode,
  parseComponentPropertyCode,
} from "./component-property-code";
import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import { createEmptyDocument } from "@icm/model";
import {
  componentSymbolOptions,
  componentDetailFields,
} from "./component-property-details";

const instance: Instance = {
  id: "M1",
  reference: "M1",
  symbolId: "nmos",
  placement: {
    position: { x: 200, y: 160 },
    rotation: 90,
    mirror: "horizontal",
  },
  netlist: {
    parameters: { w: "EV", l: "L", nf: "2", m: "1", custom: "{x+1}" },
  },
};
const context = {
  instance,
  referenceVisible: true,
  valueVisible: true,
  details: {
    parameters: componentParameters("nmos"),
    modelTarget: { defaultValue: "model_a", suggestions: ["model_a"] },
  },
};

describe("unified component property details", () => {
  it("uses only declared units for parameters and distinguishes the netlist name", () => {
    const fields = componentDetailFields(instance, context.details);
    for (const key of ["m", "nf"])
      expect(
        fields.find((field) => field.path === `parameters.${key}`)?.description,
      ).toBe("");
    for (const key of ["w", "l"])
      expect(
        fields.find((field) => field.path === `parameters.${key}`)?.description,
      ).toBe("m");
    expect(
      fields.find((field) => field.path === "reference")?.description,
    ).toBe("Netlist name");
  });
  it("retains reviewed model choices outside the short comment", () => {
    const field = componentDetailFields(instance, context.details).find(
      (item) => item.path === "netlistTarget",
    )!;
    expect(field.kind).toBe("choice");
    expect(field.options).toEqual([
      { value: "", label: "None" },
      { value: "model_a", label: "model_a" },
    ]);
    expect(field.description).not.toContain("model_a");
  });
  it("round-trips authored strings, overrides, and model target without unit conversion", () => {
    const source = formatComponentPropertyCode(context);
    expect(JSON.parse(source)).toMatchObject({
      reference: "M1",
      parameters: instance.netlist!.parameters,
      netlistTarget: "model_a",
    });
    expect(parseComponentPropertyCode(source, context)).toMatchObject({
      ok: true,
      value: { parameters: instance.netlist!.parameters },
    });
  });

  it("never color-converts parameter names or reformats tuples inside raw strings", () => {
    const raw = {
      ...instance,
      netlist: {
        parameters: {
          foreground: "EV",
          background: "[1,2]",
          custom: 'say "[3,4]"',
        },
      },
    };
    const rawContext = { ...context, instance: raw };
    expect(
      JSON.parse(formatComponentPropertyCode(rawContext)).parameters,
    ).toMatchObject(raw.netlist.parameters);
  });
  it("plans parameter set/unset, identity and placement as ordinary atomic edits", () => {
    const decoded = JSON.parse(formatComponentPropertyCode(context));
    decoded.reference = "M2";
    decoded.parameters.w = "3u";
    decoded.parameters.custom = "";
    delete decoded.parameters.nf;
    decoded.placement.rotation = 180;
    const parsed = parseComponentPropertyCode(JSON.stringify(decoded), context);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const doc = createEmptyDocument("doc", "doc");
    const edits = planComponentPropertyCodeEdits(doc, instance, parsed.value);
    expect(edits).toContainEqual({
      kind: "set_instance_reference",
      instanceId: "M1",
      reference: "M2",
    });
    expect(edits).toContainEqual({
      kind: "patch_instance_netlist_parameters",
      instanceId: "M1",
      set: { w: "3u" },
      unset: ["nf", "custom"],
    });
    expect(edits).toContainEqual({
      kind: "rotate_instance",
      instanceId: "M1",
      rotation: 180,
    });
  });
  it.each([{ w: 3 }, { w: "1u", W: "2u" }, { w: null }])(
    "rejects invalid or ambiguous raw parameter values %j",
    (parameters) => {
      const decoded = JSON.parse(formatComponentPropertyCode(context));
      decoded.parameters = parameters;
      expect(
        parseComponentPropertyCode(JSON.stringify(decoded), context).ok,
      ).toBe(false);
    },
  );
  it("loads real descriptor defaults but preserves placement coordinates, identity, target and unknown overrides", () => {
    const defaults = JSON.parse(defaultComponentPropertyCode(context));
    expect(defaults).toMatchObject({
      reference: "M1",
      netlistTarget: "model_a",
      placement: { at: [200, 160], rotation: 0, mirror: "none" },
      parameters: { custom: "{x+1}" },
    });
    for (const parameter of componentParameters("nmos"))
      expect(defaults.parameters[parameter.key]).toBe(
        parameter.defaultValue ?? "",
      );
    expect(
      parseComponentPropertyCode(JSON.stringify(defaults), context).ok,
    ).toBe(true);
  });
  it("only offers pin-compatible drawing variants, including combined input/output swaps", () => {
    expect(componentSymbolOptions("opamp-differential")).toEqual(
      expect.arrayContaining([
        "opamp-differential",
        "opamp-differential-inputs-swapped",
        "opamp-differential-crossed",
        "opamp-differential-crossed-inputs-swapped",
      ]),
    );
    expect(componentSymbolOptions("nmos")).toEqual(["nmos"]);
  });

  it("keeps Digital Clock primary controls connected to its compatibility pulse values", () => {
    const clock = {
      ...instance,
      symbolId: "pulse-voltage-source",
      reference: "V1",
      netlist: {
        parameters: {
          period: "10ns",
          dutyCycle: "50",
          initial: "0",
          low: "0",
          high: "1",
          width: "5ns",
          delay: "5ns",
        },
      },
    };
    const clockContext = {
      ...context,
      instance: clock,
      details: { parameters: componentParameters(clock.symbolId) },
    };
    const source = JSON.parse(formatComponentPropertyCode(clockContext));
    source.parameters.dutyCycle = "25";
    const parsed = parseComponentPropertyCode(
      JSON.stringify(source),
      clockContext,
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        parameters: { dutyCycle: "25", width: "2500ps", delay: "7500ps" },
      },
    });
  });
});
