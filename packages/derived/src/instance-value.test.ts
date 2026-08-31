import { describe, expect, it } from "vitest";

import { displayableInstanceValue } from "./instance-value.js";

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
  it("projects MOS dimensions as a stacked fraction with units", () => {
    const result = displayableInstanceValue(
      instance("nmos", { w: "10u", l: "150n" }),
    );
    expect(result).toEqual({
      kind: "displayable",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [bold("10um")] },
            denominator: { runs: [bold("150nm")] },
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

  it("shows passive values bold with their engineering unit", () => {
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

  it("shows independent source dc values with their unit", () => {
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
      content: { runs: [bold("100uA")] },
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
