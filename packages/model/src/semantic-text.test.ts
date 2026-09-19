import { describe, expect, it } from "vitest";
import { flattenRichText } from "./rich-text.js";
import {
  defaultDraftTextDocument,
  semanticTextDocument,
} from "./semantic-text.js";

describe("semantic formal-Port text", () => {
  it.each(["Vout", "IN", "OUT", "CLK", "vout", "V_{in,cm}"])(
    "keeps %s whole without guessing scripts or parsing markup",
    (name) => {
      const content = semanticTextDocument(name, "formal-port");
      expect(flattenRichText(content)).toBe(name);
      expect(content).toEqual(semanticTextDocument(name, "net-label"));
      expect(JSON.stringify(content)).not.toContain('"subscript"');
      expect(content.runs).toHaveLength(1);
    },
  );

  it("keeps a polarity sign outside the complete name", () => {
    const content = semanticTextDocument("Vout+", "formal-port");
    expect(flattenRichText(content)).toBe("Vout+");
    expect(content.runs).toHaveLength(2);
    expect(content.runs[1]).toEqual({ kind: "text", value: "+" });
    expect(JSON.stringify(content)).not.toContain('"subscript"');
  });
});

describe("other semantic text remains unchanged", () => {
  it("keeps device designators and supply indices", () => {
    expect(semanticTextDocument("M1", "instance-label").runs[1]).toMatchObject({
      style: "subscript",
    });
    expect(semanticTextDocument("VDD", "power-label").runs[1]).toMatchObject({
      style: "subscript",
      children: [{ style: "italic" }],
    });
  });
});

describe("drafting text", () => {
  it("subscripts an identifier typed into a text box", () => {
    const content = defaultDraftTextDocument("vbias");

    expect(flattenRichText(content)).toBe("vbias");
    expect(content.runs).toHaveLength(2);
    expect(content.runs[1]).toMatchObject({ style: "subscript" });
  });

  it("keeps a multi-word note as prose instead of one long subscript", () => {
    const content = defaultDraftTextDocument("design note");

    expect(flattenRichText(content)).toBe("design note");
    expect(content.runs).toHaveLength(1);
    expect(content.runs[0]).toMatchObject({ style: "italic" });
  });

  it("keeps ordinary text punctuation literal while applying the house style", () => {
    for (const value of ["A1_wi", "x^2", String.raw`V\{in\}`]) {
      expect(flattenRichText(defaultDraftTextDocument(value))).toBe(value);
    }
  });
});
