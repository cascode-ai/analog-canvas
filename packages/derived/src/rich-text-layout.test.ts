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
  labelFormulaLayout,
  measureLabelText,
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

  it("advances every relation sign like the equals sign", () => {
    for (const sign of ["≠", "≈", "≤", "≥", "<", ">"])
      expect(richTextAdvanceEm(sign)).toBe(richTextAdvanceEm("="));
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
    const widestPart = measureRichTextDocument(
      { runs: [{ kind: "text", value: "150nm" }] },
      { ...metrics, fontSize: partFont, fractionText: true },
    ).width;
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

  it("sizes fraction text proportionally while leaving ordinary text metrics unchanged", () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const measure = (value: string, fractionText = false) =>
      measureRichTextDocument(
        { runs: [{ kind: "text", value }] },
        { ...metrics, fractionText },
      ).width;
    expect(measure("WWW", true)).toBeGreaterThan(measure("iii", true) * 3);
    expect(measure("WWW")).toBe(measure("iii"));
    expect(measure("中文", true)).toBeCloseTo(metrics.fontSize * 2);
  });

  it("renders fraction parts one A+ level above the subscript scale", () => {
    expect(fractionPartScale(0.76)).toBeCloseTo(0.836, 6);
    // The boost is a multiplier, so any profile's subscript scale keeps the
    // 10% proportion rather than a fixed pixel offset.
    expect(fractionPartScale(0.5)).toBeCloseTo(0.55, 6);
  });

  it("measures a formula in label type by its label layout", () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const latex = String.raw`\frac{g_m}{1+s/\omega_p}`;
    const label = labelFormulaLayout(latex, "inline", metrics)!;
    expect(label).not.toBeNull();
    const layout = measureRichTextDocument(
      { runs: [{ kind: "math", latex, display: "inline" }] },
      metrics,
    );
    expect(layout.width).toBeCloseTo(label.width);
    expect(layout.height).toBeCloseTo(label.ascent + label.descent);
  });

  it("measures a whole-formula slant override in the face it draws", () => {
    const metrics = {
      ...richTextMetrics(razaviTextbookProfile),
      fontSize: 20,
      bold: true,
      italic: true,
    };
    const latex = String.raw`\overline{\mathrm{R}_{R}}`;
    const result = labelFormulaLayout(latex, "inline", metrics)!;
    const letters = result.items.filter((item) => item.kind === "glyph");
    expect(letters).toHaveLength(2);
    // Upstream Metropolis Bold Italic R advances by 0.700 em; upright is 0.682.
    for (const letter of letters) {
      expect(letter.italic).toBe(true);
      expect(letter.advance).toBeCloseTo(0.7 * letter.size);
    }
    const measured = measureRichTextDocument(
      { runs: [{ kind: "math", latex, display: "inline" }] },
      metrics,
    );
    expect(measured.width).toBeCloseTo(
      0.7 * 20 +
        (0.7 + metrics.subscriptHorizontalGapEm) * 20 * metrics.subscriptScale,
    );
  });

  it("uses path-renderer metrics for a formula label type cannot set", async () => {
    const metrics = richTextMetrics(razaviTextbookProfile);
    const request = {
      latex: String.raw`\boxed{\frac{g_m}{1+s/\omega_p}}`,
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

describe("label text as drawn", () => {
  // Metropolis, the primary face, is 1000 units to the em.
  const fontSize = razaviTextbookProfile.typography.instanceFontSize;
  const metrics = {
    ...richTextMetrics(razaviTextbookProfile, "label"),
    fontSize,
  };
  const units = (value: number) => (fontSize * value) / 1000;

  it("uses the italic face's own advance and overhang", () => {
    const label = measureLabelText(
      { runs: [{ kind: "text", value: "R" }] },
      {
        ...metrics,
        bold: true,
        italic: true,
      },
    );
    // Metropolis Bold Italic R: 700-unit advance, outline x=17..682.
    // The upright face is narrower (682); substituting it shifts a script.
    expect(label.width).toBeCloseTo(units(700), 6);
    expect(label.lines[0]!.ink).toEqual({
      left: expect.closeTo(units(17), 6),
      right: expect.closeTo(units(682), 6),
    });
  });

  it("sets a bold value by the face's advances, inked from the first outline to the last (#1413)", () => {
    const value: RichTextDocument = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "1.33pF" }],
        },
      ],
    };
    // Pinned Metropolis Bold tables: 1=438, 3=625, p=648, F=639.
    // The round period advances 0.36 em; 1 starts at 33, F ends at 600.
    const width = units(438 + 2 * 625 + 648 + 639) + fontSize * 0.36;
    const { width: measured, lines } = measureLabelText(value, metrics);
    expect(measured).toBeCloseTo(width, 6);
    expect(lines).toEqual([
      {
        width: expect.closeTo(width, 6),
        ink: {
          left: expect.closeTo(units(33), 6),
          right: expect.closeTo(width - units(39), 6),
        },
      },
    ]);
  });

  it("sets a reference's slanted initial and its upright subscript as the renderer draws them", () => {
    const { subscriptScale, subscriptHorizontalGapEm } =
      razaviTextbookProfile.typography;
    const reference: RichTextDocument = {
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
    };
    // Metropolis Regular Italic M advances 822 units and starts at 24.
    // Upright Regular 1 advances 357 and ends at 279.
    const width =
      units(822) +
      fontSize * subscriptScale * subscriptHorizontalGapEm +
      subscriptScale * units(357);
    expect(measureLabelText(reference, metrics).lines).toEqual([
      {
        width: expect.closeTo(width, 6),
        ink: {
          left: expect.closeTo(units(24), 6),
          right: expect.closeTo(width - subscriptScale * units(78), 6),
        },
      },
    ]);
  });
});
