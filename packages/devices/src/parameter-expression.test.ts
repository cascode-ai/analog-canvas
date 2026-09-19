import { describe, expect, it } from "vitest";
import {
  parameterReferences,
  renameParameterReference,
  supportsScalarParameterExpression,
} from "./parameter-expression.js";

describe("parameter reference identity", () => {
  it("does not expose scalar binding for waveform lists or derived clock controls", () => {
    expect(supportsScalarParameterExpression("resistor", "value")).toBe(true);
    expect(
      supportsScalarParameterExpression("voltage-source", "pwlPoints"),
    ).toBe(false);
    expect(
      supportsScalarParameterExpression("pulse-voltage-source", "period"),
    ).toBe(false);
  });
  it("does not rename numeric suffixes, functions, longer names or qualified references", () => {
    const raw = " { r + R + Rload + 1e-3 + 2r + r(R) + x.r } ";
    expect(renameParameterReference(raw, "R", "Rbase")).toBe(
      " { Rbase + Rbase + Rload + 1e-3 + 2r + r(Rbase) + x.r } ",
    );
  });
  it("supports bare symbols and quoted expressions without accepting incomplete syntax", () => {
    expect(renameParameterReference(" R ", "r", "Rbase")).toBe(" Rbase ");
    expect(renameParameterReference("'2*R'", "r", "Rbase")).toBe("'2*Rbase'");
    expect(
      parameterReferences("{R +}").map((reference) => reference.name),
    ).toEqual(["R"]);
    expect(() => renameParameterReference("{R +}", "R", "Rbase")).toThrow(
      "unsupported",
    );
    expect(renameParameterReference("0 0 1n {R}", "R", "Rbase")).toBe(
      "0 0 1n {Rbase}",
    );
    expect(parameterReferences("1k")).toEqual([]);
  });
});
