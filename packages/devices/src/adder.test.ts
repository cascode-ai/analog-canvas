import { describe, expect, it } from "vitest";

import {
  ADDER_BODIES,
  ADDER_SYMBOL_ID,
  ADDER_TARGET,
  UNICODE_MINUS,
  adderBodyFor,
  adderBodySigns,
  adderInputSigns,
  readInputSign,
} from "./adder.js";
import { subcircuitDescriptor } from "./registry.js";

describe("the adder's table", () => {
  it("is the adder's Symbol and the target its descriptor calls", () => {
    expect(subcircuitDescriptor(ADDER_SYMBOL_ID)?.target).toBe(ADDER_TARGET);
  });

  it("names one body per pattern of signs after the inputs it subtracts", () => {
    expect(ADDER_BODIES).toEqual([
      { name: "adder", signs: ["+", "+"] },
      { name: "adder_minus_a", signs: ["-", "+"] },
      { name: "adder_minus_b", signs: ["+", "-"] },
      { name: "adder_minus_ab", signs: ["-", "-"] },
    ]);
    for (const body of ADDER_BODIES) {
      expect(adderBodyFor(body.signs)).toBe(body.name);
      expect(adderBodySigns(body.name)).toEqual(body.signs);
    }
    // A body is named as a call spells it; anything else is no adder body.
    expect(adderBodySigns("ADDER_MINUS_B")).toBeUndefined();
    expect(adderBodySigns("opamp")).toBeUndefined();
  });

  it("reads a sign as typed: +, - or the Unicode minus, nothing else", () => {
    expect([...UNICODE_MINUS].map((char) => char.codePointAt(0))).toEqual([
      0x2212,
    ]);
    expect(readInputSign("+")).toBe("+");
    expect(readInputSign("-")).toBe("-");
    expect(readInputSign(" − ")).toBe("-");
    for (const value of ["", "minus", "–", "+-", "x"])
      expect(readInputSign(value), value).toBeNull();
  });

  it("reads an adder's signs as export does: missing adds, anything else is no sign", () => {
    expect(adderInputSigns(undefined)).toEqual([
      { pinName: "A", parameter: "signA", sign: "+" },
      { pinName: "B", parameter: "signB", sign: "+" },
    ]);
    expect(
      adderInputSigns({ signb: " - ", signA: "x" }).map((input) => [
        input.parameter,
        input.sign,
      ]),
    ).toEqual([
      ["signA", null],
      ["signb", "-"],
    ]);
    expect(adderInputSigns({ signA: "−" }).map((input) => input.sign)).toEqual([
      "-",
      "+",
    ]);
  });
});
