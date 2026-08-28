import { describe, expect, it } from "vitest";

import type { RichTextDocument } from "@icm/model";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  CANONICAL_FORMULA_FONT_SIZE,
  prepareFormula,
} from "@icm/math-typesetting/cache";

import {
  containsFractionRun,
  fractionGeometry,
  fractionPartScale,
  measureRichTextDocument,
  richTextAdvanceEm,
  richTextMetrics,
} from "./rich-text-layout.js";
import { razaviTextbookProfile } from "./style-profile.js";

describe("shared rich-text layout", () => {
  it("uses the longest line instead of accumulating line widths", () => {
    const content = {
      runs: [
        { kind: "text", value: "longest line" },
        { kind: "line-break" },
        { kind: "text", value: "short" },
      ],
    } as RichTextDocument;
    const layout = measureRichTextDocument(
      content,
      richTextMetrics(razaviTextbookProfile),
    );
    expect(layout.lineWidths).toHaveLength(2);
    expect(layout.width).toBe(layout.lineWidths[0]);
    expect(layout.width).toBeLessThan(
      layout.lineWidths[0]! + layout.lineWidths[1]!,
    );
  });

  it("takes exact profile and size override metrics", () => {
    const content = {
      runs: [{ kind: "text", value: "caption" }],
    } as RichTextDocument;
    const base = measureRichTextDocument(
      content,
      richTextMetrics(razaviTextbookProfile, "caption"),
    );
    const razaviScaled = measureRichTextDocument(
      content,
      richTextMetrics(razaviTextbookProfile, "caption", 2),
    );
    expect(razaviScaled.width).toBe(base.width * 2);
  });

  it("keeps automatic bounds at least as wide as positioned glyph advances", () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const expression = (base: string): RichTextDocument => ({
      runs: [
        {
          kind: "span",
          style: "overbar",
          children: [
            { kind: "text", value: base },
            {
              kind: "span",
              style: "subscript",
              children: [{ kind: "text", value: "n2" }],
            },
            {
              kind: "span",
              style: "superscript",
              children: [{ kind: "text", value: "2" }],
            },
          ],
        },
      ],
    });
    const wideText = "WWWWWWWWWWW";
    const narrowText = "iiiiiiiiiii";
    const wide = measureRichTextDocument(expression(wideText), metrics);
    const narrow = measureRichTextDocument(expression(narrowText), metrics);
    const scriptWidth =
      metrics.subscriptScale *
      Math.max(richTextAdvanceEm("n2"), richTextAdvanceEm("2"));

    expect(wide.width).toBeGreaterThanOrEqual(
      (richTextAdvanceEm(wideText) +
        metrics.subscriptHorizontalGapEm +
        scriptWidth) *
        metrics.fontSize,
    );
    expect(narrow.width).toBeGreaterThanOrEqual(
      (richTextAdvanceEm(narrowText) +
        metrics.subscriptHorizontalGapEm +
        scriptWidth) *
        metrics.fontSize,
    );
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it("uses the profile baseline shift when reserving subscript bounds", () => {
    const metrics = {
      ...richTextMetrics(razaviTextbookProfile),
      subscriptScale: 0.63,
      subscriptBaselineShiftEm: 0.51,
    };
    const content = {
      runs: [
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "DD" }],
        },
      ],
    } as RichTextDocument;
    const layout = measureRichTextDocument(content, metrics);
    expect(layout.height).toBeCloseTo(
      metrics.fontSize *
        Math.max(
          metrics.lineHeight,
          metrics.subscriptScale + metrics.subscriptBaselineShiftEm,
        ),
    );
  });

  it("places adjacent subscript and superscript in one attachment column", () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const content = {
      runs: [
        { kind: "text", value: "I" },
        {
          kind: "span",
          style: "superscript",
          children: [{ kind: "text", value: "2" }],
        },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "n2" }],
        },
      ],
    } as RichTextDocument;
    const layout = measureRichTextDocument(content, metrics);
    const baseWidth = metrics.fontSize * 0.6;
    const scriptWidth = metrics.fontSize * metrics.subscriptScale * 0.6 * 2;
    const attachmentGap = metrics.fontSize * metrics.subscriptHorizontalGapEm;

    expect(layout.width).toBeCloseTo(baseWidth + attachmentGap + scriptWidth);
    expect(layout.width).toBeLessThan(
      baseWidth +
        attachmentGap +
        metrics.fontSize * metrics.subscriptScale * 0.6 * 3,
    );
    expect(layout.height).toBeCloseTo(
      metrics.fontSize *
        (metrics.subscriptScale * metrics.lineHeight +
          2 * metrics.subscriptBaselineShiftEm),
    );
  });

  it("measures a fraction as one taller inline line with bar overhang", () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const content = {
      runs: [
        {
          kind: "fraction",
          numerator: { runs: [{ kind: "text", value: "10um" }] },
          denominator: { runs: [{ kind: "text", value: "150nm" }] },
        },
      ],
    } as RichTextDocument;
    const layout = measureRichTextDocument(content, metrics);
    const partScale = fractionPartScale(metrics.subscriptScale);
    const partFont = metrics.fontSize * partScale;
    const widestPart = [..."150nm"].length * partFont * 0.6;
    expect(layout.width).toBeCloseTo(
      widestPart +
        metrics.fontSize * partScale * fractionGeometry.barOverhangEm * 2,
      5,
    );
    expect(layout.height).toBeCloseTo(
      partFont * metrics.lineHeight * 2 +
        metrics.fontSize * partScale * fractionGeometry.barGapEm,
      5,
    );
    expect(containsFractionRun(content)).toBe(true);
    expect(
      containsFractionRun({ runs: [{ kind: "text", value: "plain" }] }),
    ).toBe(false);
  });

  it("renders fraction parts three A+ levels above the subscript scale", () => {
    expect(fractionPartScale(0.76)).toBeCloseTo(0.988, 6);
    // The boost is a multiplier, so any profile's subscript scale keeps the
    // 30% proportion rather than a fixed pixel offset.
    expect(fractionPartScale(0.5)).toBeCloseTo(0.65, 6);
  });

  it("uses path-renderer metrics for an atomic formula", async () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const request = {
      latex: String.raw`\frac{g_m}{1+s/\omega_p}`,
      display: "inline" as const,
      profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
    };
    const prepared = await prepareFormula(request);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const layout = measureRichTextDocument(
      {
        runs: [
          {
            kind: "math",
            latex: request.latex,
            display: request.display,
          },
        ],
      },
      metrics,
    );

    const scale = metrics.fontSize / CANONICAL_FORMULA_FONT_SIZE;
    expect(layout.width).toBeCloseTo(prepared.artifact.width * scale);
    expect(layout.height).toBeCloseTo(prepared.artifact.height * scale);
    expect(layout.lineWidths).toEqual([layout.width]);
  });
});
