import { describe, expect, it } from "vitest";
import { flattenRichText } from "./rich-text.js";
import {
  canonicalPortTextDocument,
  defaultDraftTextDocument,
  semanticTextDocument,
  voltageNodeTextDocument,
} from "./semantic-text.js";

describe("canonical Port text", () => {
  it.each(["IN", "out", "VDD", "VND"])(
    "formats %s without changing its visible or electrical spelling",
    (name) => {
      const content = canonicalPortTextDocument(name);

      expect(flattenRichText(content)).toBe(name);
      expect(content.runs[0]).toEqual({
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: name.slice(0, 1) }],
          },
        ],
      });
      expect(content.runs[1]).toEqual({
        kind: "span",
        style: "subscript",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: name.slice(1) }],
          },
        ],
      });
      expect(JSON.stringify(content)).not.toMatch(/uppercase|lowercase/u);
    },
  );

  it("formats a one-character Port without an empty subscript", () => {
    const content = canonicalPortTextDocument("a");

    expect(flattenRichText(content)).toBe("a");
    expect(content.runs).toHaveLength(1);
    expect(content.runs[0]).toEqual({
      kind: "span",
      style: "italic",
      children: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "a" }],
        },
      ],
    });
  });
});

describe("semantic formal-Port text", () => {
  it.each(["IN", "OUT", "CLK"])(
    "keeps non-voltage name %s whole without guessing scripts",
    (name) => {
      const content = semanticTextDocument(name, "formal-port");
      expect(flattenRichText(content)).toBe(name);
      expect(content).toEqual(semanticTextDocument(name, "net-label"));
      expect(JSON.stringify(content)).not.toContain('"subscript"');
      expect(content.runs).toHaveLength(1);
    },
  );

  it.each(["Vout", "vOUT", "V_{in,cm}"])(
    "uses the voltage-node default for %s without changing its identity",
    (name) => {
      const content = semanticTextDocument(name, "formal-port");
      expect(flattenRichText(content)).toBe(name);
      expect(content).toEqual(voltageNodeTextDocument(name));
      expect(JSON.stringify(content)).toContain('"subscript"');
    },
  );

  it("keeps a polarity sign outside the complete name", () => {
    const content = semanticTextDocument("Vout+", "formal-port");
    expect(flattenRichText(content)).toBe("Vout+");
    expect(content.runs).toHaveLength(3);
    expect(content.runs[2]).toEqual({ kind: "text", value: "+" });
    expect(JSON.stringify(content)).toContain('"subscript"');
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

describe("generated voltage-node text", () => {
  it.each(["Vin", "Vout", "VB1", "VB2", "VND"])(
    "renders %s as an italic V with a case-preserving upright subscript",
    (name) => {
      const content = voltageNodeTextDocument(name);

      expect(flattenRichText(content)).toBe(name);
      expect(content).toEqual({
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: "V" }],
              },
            ],
          },
          {
            kind: "span",
            style: "subscript",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: name.slice(1) }],
              },
            ],
          },
        ],
      });
      expect(JSON.stringify(content)).not.toMatch(/uppercase|lowercase/u);
      expect(JSON.stringify(content).match(/"bold"/gu)).toHaveLength(2);
    },
  );

  it("keeps a lowercase leading v visible when the user authored it", () => {
    const content = voltageNodeTextDocument("vBIAS");

    expect(flattenRichText(content)).toBe("vBIAS");
    expect(content.runs[0]).toEqual({
      kind: "span",
      style: "italic",
      children: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "v" }],
        },
      ],
    });
    expect(content.runs[1]).toEqual({
      kind: "span",
      style: "subscript",
      children: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "BIAS" }],
        },
      ],
    });
  });

  it("keeps a lone V italic without inventing an empty subscript", () => {
    const content = voltageNodeTextDocument("V");

    expect(flattenRichText(content)).toBe("V");
    expect(content.runs).toHaveLength(1);
    expect(content.runs[0]).toMatchObject({ style: "italic" });
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
