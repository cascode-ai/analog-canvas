import { describe, expect, it } from "vitest";

import { GREEK_LETTERS, spellGreekLetters } from "./greek-letters.js";

describe("Greek letter names", () => {
  it("writes each letter as its standard name, keeping its case", () => {
    expect(spellGreekLetters("φ1")).toBe("phi1");
    expect(spellGreekLetters("Φ1")).toBe("Phi1");
    expect(spellGreekLetters("VΩ_out")).toBe("VOmega_out");
    expect(spellGreekLetters("αβγ")).toBe("alphabetagamma");
  });

  it("names every Greek letter, small and capital", () => {
    const glyphs = new Set(GREEK_LETTERS.map((letter) => letter.glyph));
    for (const [first, last] of [
      [0x391, 0x3a9],
      [0x3b1, 0x3c9],
    ]) {
      for (let code = first!; code <= last!; code++) {
        // U+03A2 is unassigned; U+03C2 final sigma is a variant form.
        if (code === 0x3a2 || code === 0x3c2) continue;
        expect(glyphs).toContain(String.fromCodePoint(code));
      }
    }
    for (const { glyph, name } of GREEK_LETTERS) {
      expect(name).toMatch(/^[A-Za-z]+$/u);
      const capital = glyph !== glyph.toLowerCase();
      expect(name[0] === name[0]!.toUpperCase()).toBe(capital);
      expect(spellGreekLetters(glyph.toLowerCase())).toBe(name.toLowerCase());
    }
  });

  it("reads variant forms and the micro and ohm signs as their letters", () => {
    expect(spellGreekLetters("ςϵϑϰϖϱϕϴ")).toBe(
      "sigmaepsilonthetakappapirhophiTheta",
    );
    expect(spellGreekLetters("µA")).toBe("muA");
    expect(spellGreekLetters("RΩ")).toBe("ROmega");
  });

  it("leaves every other character as it is", () => {
    expect(spellGreekLetters("VDD")).toBe("VDD");
    expect(spellGreekLetters("节点 1")).toBe("节点 1");
    expect(spellGreekLetters("")).toBe("");
  });
});
