import { describe, expect, it } from "vitest";

import {
  flattenRichText,
  normalizeRichText,
  rewriteRichTextPlainText,
} from "./rich-text.js";
import { RichTextDocumentSchema } from "./schema.js";
import type { RichTextDocument } from "./schema.js";

describe("canonical RichText helpers", () => {
  it("normalizes nested spans and flattens retained formatting", () => {
    const content: RichTextDocument = {
      runs: [
        { kind: "text", value: "V" },
        { kind: "text", value: "" },
        {
          kind: "span",
          style: "subscript",
          children: [
            { kind: "text", value: "D" },
            { kind: "text", value: "D" },
          ],
        },
        { kind: "line-break" },
        {
          kind: "span",
          style: "superscript",
          children: [{ kind: "text", value: "+" }],
        },
      ],
    };

    const normalized = normalizeRichText(content);
    expect(normalized.runs[1]).toEqual({
      kind: "span",
      style: "subscript",
      children: [{ kind: "text", value: "DD" }],
    });
    expect(flattenRichText(normalized)).toBe("VDD\n+");
    expect(RichTextDocumentSchema.safeParse(normalized).success).toBe(true);
  });

  it("accepts the restored fraction node and flattens it with a slash", () => {
    const content: RichTextDocument = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [
            {
              kind: "fraction",
              numerator: { runs: [{ kind: "text", value: "10um" }] },
              denominator: { runs: [{ kind: "text", value: "150nm" }] },
            },
          ],
        },
      ],
    };
    expect(RichTextDocumentSchema.safeParse(content).success).toBe(true);
    expect(flattenRichText(content)).toBe("10um/150nm");
    expect(flattenRichText(normalizeRichText(content))).toBe("10um/150nm");
  });

  it("rejects an empty fraction side", () => {
    expect(
      RichTextDocumentSchema.safeParse({
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [{ kind: "text", value: "1" }] },
            denominator: { runs: [] },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps former markup commands as literal text", () => {
    const content: RichTextDocument = {
      runs: [{ kind: "text", value: "V_{IN} = \\frac{1}{2}" }],
    };
    expect(flattenRichText(content)).toBe("V_{IN} = \\frac{1}{2}");
  });

  it("accepts an atomic formula without interpreting it as styled text", () => {
    const content: RichTextDocument = {
      runs: [
        {
          kind: "math",
          latex: String.raw`A_v=-g_m(r_o\parallel R_D)`,
          display: "inline",
        },
      ],
    };

    expect(RichTextDocumentSchema.safeParse(content).success).toBe(true);
    expect(flattenRichText(content)).toBe(
      String.raw`A_v=-g_m(r_o\parallel R_D)`,
    );
    expect(normalizeRichText(content)).toEqual(content);
  });

  it("rejects ambiguous mixed formula and styled-text documents", () => {
    expect(
      RichTextDocumentSchema.safeParse({
        runs: [
          { kind: "text", value: "Gain: " },
          { kind: "math", latex: "A_v", display: "inline" },
        ],
      }).success,
    ).toBe(false);
  });

  it("bounds formula source and requires an explicit display mode", () => {
    expect(
      RichTextDocumentSchema.safeParse({
        runs: [{ kind: "math", latex: "", display: "inline" }],
      }).success,
    ).toBe(false);
    expect(
      RichTextDocumentSchema.safeParse({
        runs: [{ kind: "math", latex: "V_{OUT}" }],
      }).success,
    ).toBe(false);
    expect(
      RichTextDocumentSchema.safeParse({
        runs: [
          {
            kind: "math",
            latex: String.raw`\href{https://example.com}{V}`,
            display: "inline",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rewrites a semantic name while preserving its independent RichText styles", () => {
    const content: RichTextDocument = {
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "M" }],
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
              children: [{ kind: "text", value: "15" }],
            },
          ],
        },
      ],
    };

    const rewritten = rewriteRichTextPlainText(content, "M21");

    expect(flattenRichText(rewritten)).toBe("M21");
    expect(rewritten).toEqual({
      runs: [
        {
          kind: "span",
          style: "italic",
          children: [
            {
              kind: "span",
              style: "bold",
              children: [{ kind: "text", value: "M" }],
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
              children: [{ kind: "text", value: "21" }],
            },
          ],
        },
      ],
    });
    expect(RichTextDocumentSchema.safeParse(rewritten).success).toBe(true);
  });
});
