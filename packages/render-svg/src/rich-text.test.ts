import { describe, expect, it } from "vitest";

import { renderRichTextDocument } from "./rich-text.js";
import { razaviTextbookProfile } from "@icm/derived";

describe("renderRichTextDocument", () => {
  it("renders a plain text run escaped", () => {
    const svg = renderRichTextDocument(
      { runs: [{ kind: "text", value: "a<b>&c" }] },
      razaviTextbookProfile,
    );
    expect(svg).toBe("a&lt;b&gt;&amp;c");
  });

  it("renders italic and bold spans", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [{ kind: "text", value: "I" }],
          },
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "B" }],
          },
        ],
      },
      razaviTextbookProfile,
    );
    expect(svg).toContain('data-text-run="span"');
    expect(svg).toContain("font-style:italic");
    expect(svg).toContain("font-weight:700");
  });

  it("composes nested styles instead of letting an inner style erase its parent", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [{ kind: "text", value: "gm" }],
              },
            ],
          },
        ],
      },
      razaviTextbookProfile,
    );
    expect(svg).toContain(
      'style="font-style:italic;font-weight:700">gm</tspan>',
    );
    expect(svg).not.toContain('font-style:normal;font-weight:700">gm');
  });

  it("renders subscript and superscript with scaled size and baseline shift", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          { kind: "text", value: "V" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "in" }],
          },
          {
            kind: "span",
            style: "superscript",
            children: [{ kind: "text", value: "+" }],
          },
        ],
      },
      razaviTextbookProfile,
    );
    expect(svg).toContain('data-text-run="subscript"');
    expect(svg).toContain('data-text-run="superscript"');
    // Authority-calibrated subscript scale and attachment.
    expect(svg).toContain('font-size="76%"');
    expect(svg).toContain('baseline-shift="-0.28em"');
    expect(svg).toContain('dx="0.046em"');
  });

  it("keeps a script upright when it occurs inside bold italic text", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [
              {
                kind: "span",
                style: "bold",
                children: [
                  { kind: "text", value: "V" },
                  {
                    kind: "span",
                    style: "subscript",
                    children: [{ kind: "text", value: "out" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      razaviTextbookProfile,
    );
    expect(svg).toContain(
      'data-text-run="subscript" dx="0.046em" font-size="76%" baseline-shift="-0.28em" style="font-style:normal;font-weight:700">out</tspan>',
    );
  });

  it("renders a line break", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          { kind: "text", value: "line1" },
          { kind: "line-break" },
          { kind: "text", value: "line2" },
        ],
      },
      razaviTextbookProfile,
      { lineOriginX: 240 },
    );
    expect(svg).toContain('data-text-run="line-break"');
    expect(svg).toContain('x="240"');
    expect(svg).not.toContain('x="0"');
    expect(svg).toContain('dy="1em">line2</tspan>');
  });
});
