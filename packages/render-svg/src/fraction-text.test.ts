import { describe, expect, it } from "vitest";
import {
  fractionGeometry,
  fractionPartScale,
  measureRichTextDocument,
  razaviTextbookProfile,
  richTextMetrics,
} from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";
import { renderFractionText } from "./fraction-text.js";

const fraction = (top: string, bottom: string): RichTextRun => ({
  kind: "fraction",
  numerator: { runs: [{ kind: "text", value: top }] },
  denominator: { runs: [{ kind: "text", value: bottom }] },
});
const options = {
  x: 100,
  y: 50,
  fontSize: 15,
  alignment: "middle" as const,
  color: "#246bfd",
};

const script = (
  style: "subscript" | "superscript",
  value: string,
): RichTextRun => ({
  kind: "span",
  style,
  children: [{ kind: "text", value }],
});

/** Numerator baseline, bar and denominator baseline of a rendered fraction. */
function fractionRows(svg: string) {
  const y = (pattern: RegExp) => Number(svg.match(pattern)![1]);
  return {
    numerator: y(/data-role="fraction-numerator"><text[^>]* y="([-\d.]+)"/),
    bar: y(/data-role="fraction-bar"[^>]* y1="([-\d.]+)"/),
    denominator: y(/data-role="fraction-denominator"><text[^>]* y="([-\d.]+)"/),
  };
}

describe("mixed fraction text", () => {
  it("keeps a numerator subscript and a denominator superscript clear of the bar", () => {
    const { typography } = razaviTextbookProfile;
    const partFont =
      options.fontSize * fractionPartScale(typography.subscriptScale);
    const scriptShift =
      partFont *
      typography.subscriptScale *
      typography.subscriptBaselineShiftEm;
    const capHeight = partFont * fractionGeometry.capHeightEm;

    const plain = fractionRows(
      renderFractionText(
        { runs: [fraction("I", "2")] },
        razaviTextbookProfile,
        options,
      )!,
    );
    // A plain fraction keeps its geometry.
    expect(plain.numerator).toBeCloseTo(
      options.y - partFont * fractionGeometry.numeratorBaselineRiseEm,
      6,
    );
    const clearance = plain.denominator - capHeight - plain.bar;

    const subscripted = fractionRows(
      renderFractionText(
        {
          runs: [
            {
              kind: "fraction",
              numerator: {
                runs: [{ kind: "text", value: "I" }, script("subscript", "ss")],
              },
              denominator: { runs: [{ kind: "text", value: "2" }] },
            },
          ],
        },
        razaviTextbookProfile,
        options,
      )!,
    );
    // I_ss/2: the subscript's baseline clears the bar as far as the
    // denominator's digits do below it; the bar and denominator stay put.
    expect(subscripted.bar - (subscripted.numerator + scriptShift)).toBeCloseTo(
      clearance,
      6,
    );
    expect(subscripted.bar).toBeCloseTo(plain.bar, 6);
    expect(subscripted.denominator).toBeCloseTo(plain.denominator, 6);

    const superscripted = fractionRows(
      renderFractionText(
        {
          runs: [
            {
              kind: "fraction",
              numerator: { runs: [{ kind: "text", value: "1" }] },
              denominator: {
                runs: [
                  { kind: "text", value: "s" },
                  script("superscript", "2"),
                ],
              },
            },
          ],
        },
        razaviTextbookProfile,
        options,
      )!,
    );
    // 1/s²: the superscript's digit top keeps the same clearance.
    const superscriptTop =
      superscripted.denominator -
      scriptShift -
      capHeight * typography.subscriptScale;
    expect(superscriptTop - superscripted.bar).toBeCloseTo(clearance, 6);
    expect(superscripted.numerator).toBeCloseTo(plain.numerator, 6);
  });

  it("leaves ordinary text on its existing rendering path", () => {
    expect(
      renderFractionText(
        { runs: [{ kind: "text", value: "x + y" }] },
        razaviTextbookProfile,
        options,
      ),
    ).toBeNull();
  });
  it("keeps multiple bars, inherited styles, and companions on one measured line", () => {
    const content: RichTextDocument = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [
            fraction("1u", "150n"),
            { kind: "text", value: " + " },
            fraction("1", "gm"),
            { kind: "text", value: " + R" },
            {
              kind: "span",
              style: "subscript",
              children: [{ kind: "text", value: "1" }],
            },
          ],
        },
      ],
    };
    const svg = renderFractionText(content, razaviTextbookProfile, options)!;
    expect(svg.match(/data-role="fraction-bar"/g)).toHaveLength(2);
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('data-text-run="subscript"');
    expect(svg).toContain('fill="#246bfd"');
    expect(svg).toContain('stroke="#246bfd"');
    expect(svg).toContain(" + R");
    expect(svg).not.toContain("textLength");
    expect(svg).not.toContain("lengthAdjust");
    const bars = [
      ...svg.matchAll(
        /data-role="fraction-bar" x1="([^"]+)" x2="([^"]+)" y1="([^"]+)"/g,
      ),
    ].map((match) => match.slice(1).map(Number));
    expect(bars[0]![1]).toBeLessThan(bars[1]![0]!);
    expect(bars[0]![2]).toBe(bars[1]![2]);
    const width = measureRichTextDocument(content, {
      ...richTextMetrics(razaviTextbookProfile),
      fontSize: 15,
    }).width;
    expect(bars[0]![0]).toBeCloseTo(options.x - width / 2, 5);
  });
  it("centers standalone plain fraction parts with native glyph advances", () => {
    const svg = renderFractionText(
      { runs: [fraction("WWW + MMM", "R")] },
      razaviTextbookProfile,
      options,
    )!;

    expect(svg).toMatch(
      /data-role="fraction-numerator"><text x="100"[^>]+text-anchor="middle"/u,
    );
    expect(svg).toMatch(
      /data-role="fraction-denominator"><text x="100"[^>]+text-anchor="middle"/u,
    );
    expect(svg).not.toContain("textLength");
  });
  it("escapes user text and gives separate fraction lines enough vertical space", () => {
    const svg = renderFractionText(
      {
        runs: [
          fraction("<1>", "g&x"),
          { kind: "line-break" },
          fraction("2", "3"),
        ],
      },
      razaviTextbookProfile,
      options,
    )!;
    expect(svg).toContain("&lt;1&gt;");
    expect(svg).toContain("g&amp;x");
    const baselines = [
      ...svg.matchAll(/data-role="fraction-bar"[^>]+y1="([^"]+)"/g),
    ].map((match) => Number(match[1]));
    const lineHeight = measureRichTextDocument(
      { runs: [fraction("<1>", "g&x")] },
      {
        ...richTextMetrics(razaviTextbookProfile),
        fontSize: options.fontSize,
        fractionText: true,
      },
    ).height;
    expect(baselines[1]! - baselines[0]!).toBeCloseTo(lineHeight, 5);
  });
});
