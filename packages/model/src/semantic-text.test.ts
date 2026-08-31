import { describe, expect, it } from "vitest";

import { flattenRichText } from "./rich-text.js";
import {
  defaultDraftTextDocument,
  semanticTextDocument,
} from "./semantic-text.js";

describe("semantic formal-Port text", () => {
  it("derives a Razavi voltage base and subscript from the electrical name", () => {
    const content = semanticTextDocument("Vout", "formal-port");

    expect(flattenRichText(content)).toBe("Vout");
    expect(content).toMatchObject({
      runs: [
        { kind: "span", style: "italic", children: [{ kind: "span" }] },
        { kind: "span", style: "subscript", children: [{ kind: "span" }] },
      ],
    });
    expect(content.runs[0]).toMatchObject({
      children: [{ children: [{ value: "V" }] }],
    });
    expect(content.runs[1]).toMatchObject({
      children: [{ children: [{ value: "out" }] }],
    });
  });

  it("preserves punctuation instead of interpreting it as subscript markup", () => {
    const port = semanticTextDocument("V_{in,cm}", "formal-port");
    const net = semanticTextDocument("V_{in,cm}", "net-label");

    expect(port).toEqual(net);
    expect(flattenRichText(port)).toBe("V_{in,cm}");
    expect(port.runs[1]).toMatchObject({
      kind: "span",
      style: "subscript",
      children: [{ children: [{ value: "_{in,cm}" }] }],
    });
  });

  it("splits every Port and Net name into a symbol and its subscript", () => {
    const port = semanticTextDocument("CLK", "formal-port");
    const net = semanticTextDocument("NET1", "net-label");

    expect(port).toEqual({
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "C" }],
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
              children: [{ kind: "text", value: "LK" }],
            },
          ],
        },
      ],
    });
    expect(net).toMatchObject({
      runs: [
        { kind: "span", style: "italic" },
        { kind: "span", style: "subscript" },
      ],
    });
    expect(flattenRichText(net)).toBe("NET1");
  });
});

describe("house text style", () => {
  it("keeps a supply subscript italic while ordinary subscripts stay upright", () => {
    const supply = semanticTextDocument("VDD", "net-label");
    const signal = semanticTextDocument("Vin", "net-label");

    expect(flattenRichText(supply)).toBe("VDD");
    // Scripts render upright by default, so the supply exception is carried
    // as a nested italic span inside the subscript.
    expect(supply.runs[1]).toMatchObject({
      kind: "span",
      style: "subscript",
      children: [{ kind: "span", style: "italic" }],
    });
    expect(signal.runs[1]).toMatchObject({
      kind: "span",
      style: "subscript",
      children: [{ kind: "span", style: "bold" }],
    });
  });

  it("preserves the leading symbol case while subscripting the remainder", () => {
    const content = semanticTextDocument("vout", "net-label");

    expect(flattenRichText(content)).toBe("vout");
    expect(content.runs[0]).toMatchObject({
      style: "italic",
      children: [{ children: [{ value: "v" }] }],
    });
    expect(content.runs[1]).toMatchObject({
      style: "subscript",
      children: [{ children: [{ value: "out" }] }],
    });
  });

  it("keeps a trailing polarity sign outside the subscript", () => {
    const content = semanticTextDocument("Vout+", "formal-port");

    expect(flattenRichText(content)).toBe("Vout+");
    expect(content.runs).toHaveLength(3);
    expect(content.runs[2]).toEqual({ kind: "text", value: "+" });
  });

  it("leaves a single-character name as a bare italic symbol", () => {
    const content = semanticTextDocument("A", "net-label");

    expect(content.runs).toHaveLength(1);
    expect(flattenRichText(content)).toBe("A");
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
