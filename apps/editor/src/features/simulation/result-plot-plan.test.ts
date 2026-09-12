import { describe, expect, it } from "vitest";
import { planResultOutput } from "./result-plot-plan";

describe("result plot planning", () => {
  const base = {
    id: "x",
    label: "x",
    unit: "",
    values: [-3, -56],
    imaginary: [0, 0],
  };
  it("never turns a signed real dB expression into magnitude", () => {
    const output = {
      ...base,
      unit: "dB",
      semantics: {
        valueKind: "real" as const,
        quantity: "decibel",
        origin: "expression" as const,
      },
    };
    expect(planResultOutput(output)).toMatchObject({
      complexView: false,
      unit: "dB",
      groupLabel: "Decibels",
    });
    expect(output.values).toEqual([-3, -56]);
    expect(planResultOutput({ ...base, unit: "deg" }).complexView).toBe(false);
  });
  it("does not group unknown units or mistake them for dimensionless", () => {
    const a = planResultOutput(base),
      b = planResultOutput({ ...base, id: "b" });
    expect(a.group).not.toBe(b.group);
    expect(a.groupLabel).toContain("Unknown unit");
    expect(a.kind).toBe("unknown");
    expect(a.complexView).toBe(false);
    expect(planResultOutput({ ...base, unit: "1" }).complexView).toBe(true);
  });
  it("groups compatible units but permits splitting very different scales", () => {
    const a = { ...base, unit: "V" },
      b = { ...a, id: "b", values: [1e-9, 2e-9] };
    expect(planResultOutput(a).group).toBe(planResultOutput(b).group);
    expect(planResultOutput(a, "separate").group).not.toBe(
      planResultOutput(b, "separate").group,
    );
    expect(planResultOutput({ ...a, unit: "A" }).group).not.toBe(
      planResultOutput(a).group,
    );
  });
  it("keeps imaginary evidence for unknown and contradictory metadata", () => {
    expect(planResultOutput({ ...base, imaginary: [1, 2] })).toMatchObject({
      kind: "unknown",
      complexView: true,
    });
    expect(
      planResultOutput({
        ...base,
        unit: "deg",
        imaginary: [1, 2],
        semantics: { valueKind: "real", quantity: "phase", origin: "raw" },
      }).complexView,
    ).toBe(true);
  });
  it("display-unit declarations never change source values or metadata", () => {
    expect(planResultOutput(base, "units", "deg").unit).toBe("deg");
    expect(base.unit).toBe("");
    expect(base.values).toEqual([-3, -56]);
  });
});
