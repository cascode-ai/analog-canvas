import { describe, expect, it } from "vitest";

import { acRichText, rnlTextLines } from "./text.js";

const plain = { level: 0, bold: false, italic: false, overline: false };

describe("rich text as RNL runs", () => {
  it("keeps an italic first letter and an upright subscript apart", () => {
    expect(
      rnlTextLines({
        runs: [
          {
            kind: "span",
            style: "italic",
            children: [{ kind: "text", value: "M" }],
          },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "1" }],
          },
        ],
      }),
    ).toEqual({
      lines: [
        [
          { kind: "text", text: "M", style: { ...plain, italic: true } },
          { kind: "text", text: "1", style: { ...plain, level: -1 } },
        ],
      ],
      formulas: 0,
    });
  });

  it("nests scripts, bold and overbars, and folds case", () => {
    const { lines } = rnlTextLines({
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [
            {
              kind: "span",
              style: "superscript",
              children: [
                {
                  kind: "span",
                  style: "superscript",
                  children: [{ kind: "text", value: "z" }],
                },
              ],
            },
          ],
        },
        {
          kind: "span",
          style: "overbar",
          children: [
            {
              kind: "span",
              style: "uppercase",
              children: [{ kind: "text", value: "rst" }],
            },
          ],
        },
      ],
    });
    expect(lines).toEqual([
      [
        { kind: "text", text: "z", style: { ...plain, bold: true, level: 2 } },
        { kind: "text", text: "RST", style: { ...plain, overline: true } },
      ],
    ]);
  });

  it("joins neighbouring runs of one style and breaks lines", () => {
    expect(
      rnlTextLines({
        runs: [
          { kind: "text", value: "VDD" },
          { kind: "text", value: " = 1.8 V" },
          { kind: "line-break" },
          { kind: "text", value: "second" },
          { kind: "line-break" },
        ],
      }).lines,
    ).toEqual([
      [{ kind: "text", text: "VDD = 1.8 V", style: plain }],
      [{ kind: "text", text: "second", style: plain }],
    ]);
  });

  it("writes a fraction's parts as runs", () => {
    expect(
      rnlTextLines({
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [{ kind: "text", value: "W" }] },
            denominator: { runs: [{ kind: "text", value: "L" }] },
          },
        ],
      }).lines,
    ).toEqual([
      [
        {
          kind: "frac",
          num: [{ kind: "text", text: "W", style: plain }],
          den: [{ kind: "text", text: "L", style: plain }],
          style: plain,
        },
      ],
    ]);
  });

  it("counts a formula, written as its LaTeX source", () => {
    expect(
      rnlTextLines({
        runs: [{ kind: "math", latex: "\\omega_0", display: "inline" }],
      }),
    ).toEqual({
      lines: [[{ kind: "text", text: "\\omega_0", style: plain }]],
      formulas: 1,
    });
  });
});

describe("RNL runs as rich text", () => {
  it("reads back what it writes: styles, scripts, fractions and lines", () => {
    const lines = [
      [
        {
          kind: "text" as const,
          text: "V",
          style: { ...plain, bold: true, italic: true },
        },
        {
          kind: "text" as const,
          text: "DD",
          style: { ...plain, level: -1, overline: true },
        },
      ],
      [
        {
          kind: "frac" as const,
          num: [{ kind: "text" as const, text: "1", style: plain }],
          den: [{ kind: "text" as const, text: "sC", style: plain }],
          style: plain,
        },
      ],
    ];
    const text = acRichText(lines)!;
    expect(text.runs[0]).toEqual({
      kind: "span",
      style: "bold",
      children: [
        {
          kind: "span",
          style: "italic",
          children: [{ kind: "text", value: "V" }],
        },
      ],
    });
    expect(text.runs[2]).toEqual({ kind: "line-break" });
    expect(rnlTextLines(text).lines).toEqual(lines);
  });

  it("is nothing for text with nothing to show", () => {
    expect(acRichText([[{ kind: "text", text: "", style: plain }]])).toBeNull();
  });
});
