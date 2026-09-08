import { describe, expect, it } from "vitest";
import { boundFormulaPresentation } from "./bound-formula";

describe("bound formula semantics", () => {
  it("compiles only presentation-equivalent formulas for a bound name", () => {
    expect(boundFormulaPresentation("M_1", "M1")).toEqual({
      runs: [
        { kind: "text", value: "M" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "1" }],
        },
      ],
    });
    expect(
      boundFormulaPresentation(String.raw`\overline{I_n^2}`, "In2"),
    ).not.toBeNull();
    expect(boundFormulaPresentation("M_1=4kT", "M1")).toBeNull();
    expect(boundFormulaPresentation(String.raw`\frac{M}{1}`, "M1")).toBeNull();
  });
});
