import { describe, expect, it } from "vitest";

import {
  displayableInstanceParameter,
  displayableInstanceValue,
  drawnValueText,
  instanceCarriesReference,
  instanceSupportsValueAnnotation,
  spiceValueFromDrawnText,
} from "./instance-value.js";

function instance(
  symbolId: string,
  netlistParameters: Record<string, string> = {},
) {
  return {
    id: "X1",
    symbolId,
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(Object.keys(netlistParameters).length > 0
      ? {
          reference: "X1",
          netlist: {
            binding: {
              kind: "primitive" as const,
              deviceClass: "resistor" as const,
            },
            parameters: netlistParameters,
          },
        }
      : {}),
  };
}

const bold = (value: string) => ({
  kind: "span" as const,
  style: "bold" as const,
  children: [{ kind: "text" as const, value }],
});

describe("displayableInstanceValue", () => {
  it("can project a named magnetic parameter without exposing its value", () => {
    const source = instance("tcoil", { l1: "L1", k: "0.9" });
    // A winding's name is its textbook letter with the rest subscripted: L₁.
    const named = (...rest: { kind: "text"; value: string }[]) => ({
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [
            { kind: "text", value: "L" },
            {
              kind: "span",
              style: "subscript",
              children: [{ kind: "text", value: "1" }],
            },
            ...rest,
          ],
        },
      ],
    });
    expect(displayableInstanceParameter(source, "l1")).toEqual({
      kind: "displayable",
      content: named({ kind: "text", value: " = L1" }),
    });
    expect(
      displayableInstanceParameter(source, "l1", { showValue: false }),
    ).toEqual({
      kind: "displayable",
      content: named(),
    });
    // A one-letter name stays as it is.
    expect(displayableInstanceParameter(source, "k")).toEqual({
      kind: "displayable",
      content: { runs: [bold("K = 0.9")] },
    });
  });

  it("projects authored MOS dimensions without adding unit suffixes", () => {
    const result = displayableInstanceValue(
      instance("nmos", { w: "10u", l: "150n" }),
    );
    expect(result).toEqual({
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [bold("10u")] },
            denominator: { runs: [bold("150n")] },
          },
        ],
      },
    });
  });

  it("appends a non-default parallel multiplier without flattening W/L", () => {
    const result = displayableInstanceValue(
      instance("nmos", { w: "2u", l: "600n", m: "4" }),
    );
    expect(result).toEqual({
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [bold("2u")] },
            denominator: { runs: [bold("600n")] },
          },
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: " ×4" }],
          },
        ],
      },
    });
  });

  it("rejects a MOS device with either dimension missing", () => {
    expect(displayableInstanceValue(instance("nmos", { w: "10u" })).kind).toBe(
      "undisplayable",
    );
    expect(displayableInstanceValue(instance("pmos", { l: "0.5u" })).kind).toBe(
      "undisplayable",
    );
  });

  it("draws a bare passive value with its unit, in bold", () => {
    expect(
      displayableInstanceValue(instance("resistor", { value: "10k" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("10kΩ")] },
    });
    expect(
      displayableInstanceValue(instance("capacitor", { value: "2p" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("2pF")] },
    });
    expect(
      displayableInstanceValue(instance("inductor", { value: "3n" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("3nH")] },
    });
  });

  it("shows a built-in block's value-role parameter as a resistor's value", () => {
    const block = (symbolId: string, parameters: Record<string, string>) => ({
      symbolId,
      netlist: { parameters },
    });
    expect(
      displayableInstanceValue(
        block("potentiometer", { r: "10k", pos: "0.3" }),
      ),
    ).toEqual({ kind: "displayable", content: { runs: [bold("10kΩ")] } });
    expect(instanceSupportsValueAnnotation({ symbolId: "potentiometer" })).toBe(
      true,
    );
    // A value the bare number would not name prints its textbook name first,
    // as a winding's does: V_BO = 10V, R_BB = 7kΩ.
    const named = (letter: string, subscript: string, rest: string) => ({
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              { kind: "text", value: letter },
              {
                kind: "span",
                style: "subscript",
                children: [{ kind: "text", value: subscript }],
              },
              { kind: "text", value: rest },
            ],
          },
        ],
      },
    });
    expect(
      displayableInstanceValue(block("shockley-diode", { vbo: "10" })),
    ).toEqual(named("V", "BO", " = 10V"));
    expect(
      displayableInstanceValue(block("ujt", { rbb: "7k", eta: "0.65" })),
    ).toEqual(named("R", "BB", " = 7kΩ"));
    // A block with no value-role parameter still has none to show: a PUT's
    // peak point is its gate's.
    expect(displayableInstanceValue(block("put", {})).kind).toBe(
      "undisplayable",
    );
    expect(
      displayableInstanceValue(block("crystal", { rm: "25", lm: "12.7m" }))
        .kind,
    ).toBe("undisplayable");
  });

  it("draws a bare independent source value with its unit", () => {
    expect(
      displayableInstanceValue(instance("voltage-source", { dc: "1.8" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("1.8V")] },
    });
    expect(
      displayableInstanceValue(instance("current-source", { dc: "100u" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("100µA")] },
    });
  });

  it("does not double a unit the author already typed", () => {
    expect(
      displayableInstanceValue(instance("resistor", { value: "10kΩ" })),
    ).toEqual({
      kind: "displayable",
      content: { runs: [bold("10kΩ")] },
    });
    expect(
      displayableInstanceValue(instance("nmos", { w: "2um", l: "150nm" })),
    ).toEqual({
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [bold("2um")] },
            denominator: { runs: [bold("150nm")] },
          },
        ],
      },
    });
  });

  it.each(["EV", "W", "3", "{W_VAR}"])(
    "does not modify a user-authored dimension %s",
    (raw) => {
      const result = displayableInstanceValue(
        instance("pmos", { w: raw, l: "L" }),
      );
      expect(result).toMatchObject({
        kind: "displayable",
        content: {
          runs: [
            {
              kind: "fraction",
              numerator: { runs: [bold(raw)] },
              denominator: { runs: [bold("L")] },
            },
          ],
        },
      });
    },
  );

  it("does not display a value when netlist parameters are absent", () => {
    expect(displayableInstanceValue(instance("inductor"))).toEqual({
      kind: "undisplayable",
      reason: "inductor value parameter is empty",
    });
  });

  it("reports whitespace-only or missing values as undisplayable", () => {
    expect(
      displayableInstanceValue(instance("resistor", { value: "  " })).kind,
    ).toBe("undisplayable");
    expect(displayableInstanceValue(instance("resistor")).kind).toBe(
      "undisplayable",
    );
    expect(
      displayableInstanceValue(instance("voltage-source", { value: "" })).kind,
    ).toBe("undisplayable");
  });

  it("reports unsupported device classes instead of guessing text", () => {
    expect(displayableInstanceValue(instance("npn")).kind).toBe(
      "undisplayable",
    );
    expect(displayableInstanceValue(instance("diode")).kind).toBe(
      "undisplayable",
    );
    expect(displayableInstanceValue(instance("ground")).kind).toBe(
      "undisplayable",
    );
    expect(displayableInstanceValue(instance("unknown-symbol")).kind).toBe(
      "undisplayable",
    );
  });
});

describe("drawnValueText", () => {
  it.each([
    ["10u", "A", "10µA"],
    ["10U", "A", "10µA"],
    ["1k", "Ohm", "1kΩ"],
    ["4.7K", "Ohm", "4.7kΩ"],
    ["1Meg", "Ohm", "1MΩ"],
    ["2.2MEG", "Ohm", "2.2MΩ"],
    ["5m", "A", "5mA"],
    ["1.5f", "F", "1.5fF"],
    ["160p", "F", "160pF"],
    ["4.4n", "H", "4.4nH"],
    ["3G", "Ohm", "3GΩ"],
    ["1T", "Ohm", "1TΩ"],
    ["1.8", "V", "1.8V"],
    ["-0.9", "V", "-0.9V"],
    ["1e-6", "A", "1e-6A"],
    [".5", "V", ".5V"],
  ])("draws %s (%s) as %s", (value, unit, drawn) => {
    expect(drawnValueText(value, unit)).toBe(drawn);
  });

  it.each([
    ["10kΩ", "Ohm"],
    ["1nF", "F"],
    ["100uA", "A"],
    ["{W}", "Ohm"],
    ["R_LOAD", "Ohm"],
    ["pulse(0 1.8 0 1n 1n 5n 10n)", "V"],
    ["10k*2", "Ohm"],
    // SPICE reads a lone M as milli; the author may have meant mega.
    ["1M", "Ohm"],
  ])("leaves %s (%s) as authored", (value, unit) => {
    expect(drawnValueText(value, unit)).toBe(value);
  });

  it("adds no unit a parameter does not declare or the drawing does not use", () => {
    expect(drawnValueText("10u", undefined)).toBe("10u");
    expect(drawnValueText("150n", "m")).toBe("150n");
    expect(drawnValueText("10n", "s")).toBe("10n");
  });
});

describe("spiceValueFromDrawnText", () => {
  it.each([
    ["10µA", "A", "10u"],
    ["10μA", "A", "10u"],
    ["20µ", "A", "20u"],
    ["1MΩ", "Ohm", "1Meg"],
    ["1mΩ", "Ohm", "1m"],
    ["4.7kΩ", "Ohm", "4.7k"],
    ["1.8V", "V", "1.8"],
    ["160pF", "F", "160p"],
  ])("writes drawn %s (%s) as %s", (text, unit, spice) => {
    expect(spiceValueFromDrawnText(text, unit)).toBe(spice);
  });

  it.each([
    ["10k", "Ohm"],
    ["1M", "Ohm"],
    ["{W}", "Ohm"],
    ["1kΩ", "F"],
    ["10µA", undefined],
  ])("leaves %s (%s) as typed", (text, unit) => {
    expect(spiceValueFromDrawnText(text, unit)).toBe(text);
  });
});

describe("which parts carry a Reference to show", () => {
  it("counts a placed Cell's X name, which its derived block's Symbol cannot tell (#1317)", () => {
    const cell = {
      id: "X1",
      reference: "X1",
      symbolId: "hierarchical-symbol-sram6t",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit" as const, childDocumentId: "sram6t" },
        parameters: {},
      },
    };
    expect(instanceCarriesReference(cell)).toBe(true);
    expect(instanceCarriesReference(instance("resistor"))).toBe(true);
    // A signal-flow block has no designator either way.
    expect(instanceCarriesReference(instance("integrator"))).toBe(false);
  });
});
