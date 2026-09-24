import { describe, expect, it } from "vitest";

import {
  GREEK_COMMANDS,
  GREEK_LOWERCASE,
  GREEK_UPPERCASE,
  greekCommandBefore,
} from "./greek-letters";

describe("Greek letters", () => {
  it("offers every lowercase letter and the capitals LaTeX names", () => {
    expect(GREEK_LOWERCASE.map(([, glyph]) => glyph).join("")).toBe(
      "αβγδεζηθικλμνξπρστυφχψω",
    );
    expect(GREEK_UPPERCASE.map(([, glyph]) => glyph).join("")).toBe(
      "ΓΔΘΛΞΠΣΥΦΨΩ",
    );
    expect(GREEK_COMMANDS.phi).toBe("φ");
    expect(GREEK_COMMANDS.Phi).toBe("Φ");
  });

  it("reads the command that ends just before the caret", () => {
    expect(greekCommandBefore("V\\phi")).toEqual({ glyph: "φ", length: 4 });
    expect(greekCommandBefore("\\Omega")).toEqual({ glyph: "Ω", length: 6 });
  });

  it("leaves unknown names, plain words and finished commands alone", () => {
    expect(greekCommandBefore("\\foo")).toBeNull();
    expect(greekCommandBefore("phi")).toBeNull();
    expect(greekCommandBefore("\\phi ")).toBeNull();
    // A capital that looks Latin has no command, as in LaTeX.
    expect(greekCommandBefore("\\Alpha")).toBeNull();
  });
});
