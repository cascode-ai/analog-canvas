import { describe, expect, it } from "vitest";

import {
  renderRichTextDocument,
  renderRichTextWithOverbars,
  richTextOverbars,
} from "./rich-text.js";
import {
  OVERBAR_THICKNESS_EM,
  overbarGlyphTopEm,
  overbarLine,
  razaviTextbookProfile,
  richTextLinePitches,
  richTextMetrics,
  schematicTextAdvanceEm,
  schematicTextInkEm,
} from "@icm/derived";
import type { RichTextDocument } from "@icm/model";

describe("renderRichTextDocument", () => {
  it("renders a plain text run escaped", () => {
    const svg = renderRichTextDocument(
      { runs: [{ kind: "text", value: "a<b>&c" }] },
      razaviTextbookProfile,
    );
    expect(svg).toBe("a&lt;b&gt;&amp;c");
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

  it("keeps a plain overbar on the general renderer without spacer text", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          {
            kind: "span",
            style: "overbar",
            children: [{ kind: "text", value: "Vout" }],
          },
        ],
      },
      razaviTextbookProfile,
    );

    expect(svg).toContain('data-text-run="overbar"');
    expect(svg).toContain("text-decoration:overline");
    expect(svg).toContain(">Vout</tspan>");
    expect(svg).not.toContain("&#160;");
    expect(svg).not.toContain("letter-spacing");
  });

  it.each([
    ["subscript", "superscript"],
    ["superscript", "subscript"],
  ] as const)(
    "stacks a %s and a %s in one column after the base",
    (first, second) => {
      const script = (style: "subscript" | "superscript") => ({
        kind: "span" as const,
        style,
        children: [
          { kind: "text" as const, value: style === "subscript" ? "in" : "+" },
        ],
      });
      const svg = renderRichTextDocument(
        { runs: [{ kind: "text", value: "V" }, script(first), script(second)] },
        razaviTextbookProfile,
        { fontSize: 20 },
      );
      // V with `in` below and `+` above, not `+` and then `in` further on.
      // The narrower `+` is drawn first, one gap after the base, and `in`
      // starts back over it, so the line continues after the wider script.
      const plus = 15.2 * schematicTextAdvanceEm("+", "plain");
      expect(svg).toBe(
        `V<tspan data-text-run="superscript" dx="0.6992" dy="-6.688" font-size="15.2px" style="font-style:normal;font-weight:400">+</tspan>` +
          `<tspan data-text-run="subscript" dx="${Number((-plus).toFixed(6))}" dy="13.376" font-size="15.2px" style="font-style:normal;font-weight:400">in</tspan>`,
      );
    },
  );

  it("stacks scripts by their own styled advances even inside italic text", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          { kind: "text", value: "V" },
          {
            kind: "span",
            style: "subscript",
            children: [
              {
                kind: "span",
                style: "italic",
                children: [{ kind: "text", value: "R" }],
              },
            ],
          },
          {
            kind: "span",
            style: "superscript",
            children: [{ kind: "text", value: "R" }],
          },
        ],
      },
      razaviTextbookProfile,
      { fontSize: 20, defaultBold: true, defaultItalic: true },
    );
    // Metropolis Bold R is 0.682 em; Bold Italic R is 0.700 em. The
    // upright superscript is drawn first, then backed over by exactly its
    // advance (0.682 * 20 * 0.76), leaving the wider italic subscript last.
    expect(svg).toContain(
      'data-text-run="superscript" dx="0.6992" dy="-6.688" font-size="15.2px" style="font-style:normal;font-weight:700">R</tspan>',
    );
    expect(svg).toContain(
      'data-text-run="subscript" dx="-10.3664" dy="13.376"',
    );
    expect(svg).toContain(
      'style="font-style:italic;font-weight:700">R</tspan>',
    );
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
      { fontSize: 20 },
    );
    expect(svg).toMatch(
      /data-text-run="subscript"[^>]*style="font-style:normal;font-weight:700">out<\/tspan>/u,
    );
  });

  it("restores the parent baseline on the next visible run", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          { kind: "text", value: "V" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "in" }],
          },
          { kind: "text", value: " + V" },
        ],
      },
      razaviTextbookProfile,
      { fontSize: 20 },
    );

    expect(svg).toContain(
      '<tspan data-text-run="baseline-reset" dy="-6.688"> + V</tspan>',
    );
    expect(svg).not.toContain("baseline-shift");
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
      { lineOriginX: 240, fontSize: 20 },
    );
    expect(svg).toContain('data-text-run="line-break"');
    expect(svg).toContain('x="240"');
    expect(svg).not.toContain('x="0"');
    expect(svg).toContain('dy="20">line2</tspan>');
  });
});

describe("fraction rendering", () => {
  it("renders an inline fraction as centered stacked tspans", () => {
    const svg = renderRichTextDocument(
      {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [{ kind: "text", value: "10um" }] },
            denominator: { runs: [{ kind: "text", value: "150nm" }] },
          },
        ],
      },
      razaviTextbookProfile,
    );
    expect(svg).toContain('data-text-run="fraction"');
    expect(svg).toContain('data-text-run="numerator"');
    expect(svg).toContain('data-text-run="denominator"');
    expect(svg).toContain(">10um</tspan>");
    expect(svg).toContain(">150nm</tspan>");
  });
});

describe("line breaks under a subscript (2026-10-15)", () => {
  it("move the next line down by the shared line pitch", () => {
    const document = {
      runs: [
        { kind: "text", value: "V" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "OC" }],
        },
        { kind: "text", value: "采样与" },
        { kind: "line-break" },
        { kind: "text", value: "窗口参考" },
      ],
    } as const;
    const markup = renderRichTextDocument(
      document as never,
      razaviTextbookProfile,
    );
    const [pitch] = richTextLinePitches(
      document as never,
      richTextMetrics(razaviTextbookProfile),
    );
    const dy = /data-text-run="line-break" x="0" dy="([^"]+)"/u.exec(
      markup,
    )?.[1];
    // The CJK text before the break is back on the line's baseline.
    expect(Number(dy)).toBeCloseTo(pitch!, 2);
    expect(pitch).toBeGreaterThan(
      razaviTextbookProfile.typography.annotationFontSize,
    );
  });
});

describe("bars the generic renderer draws as lines (#2619)", () => {
  const profile = razaviTextbookProfile;
  // Φ̄₂ as a switch's phase label stores it: the bar inside a bold span inside
  // an italic one, with the subscript beside it, which the positioned path
  // does not take.
  const phase: RichTextDocument = {
    runs: [
      {
        kind: "span",
        style: "italic",
        children: [
          {
            kind: "span",
            style: "bold",
            children: [
              {
                kind: "span",
                style: "overbar",
                children: [{ kind: "text", value: "Φ" }],
              },
            ],
          },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "2" }],
          },
        ],
      },
    ],
  };
  const lines = (svg: string) =>
    [...svg.matchAll(/<line data-text-decoration="overbar"[^>]*>/gu)].map(
      (match) =>
        Object.fromEntries(
          [...match[0].matchAll(/([\w-]+)="(-?[\d.]+)"/gu)].map((pair) => [
            pair[1]!,
            Number(pair[2]),
          ]),
        ) as Record<string, number>,
    );

  it("draws a nested bar as one line over the glyph's ink, not a CSS overline", () => {
    const rendered = renderRichTextWithOverbars(phase, profile, {
      x: 100,
      y: 50,
      fontSize: 15.116,
      alignment: "start",
    });
    expect(rendered.tspans).toContain('data-text-run="overbar"');
    expect(rendered.tspans).not.toContain("text-decoration");
    const [bar, ...rest] = lines(rendered.decorations);
    expect(rest).toEqual([]);
    const ink = schematicTextInkEm("Φ", "bold", true)!;
    expect(bar!.x1).toBeCloseTo(100 + ink.left * 15.116, 6);
    expect(bar!.x2).toBeCloseTo(100 + ink.right * 15.116, 6);
    const line = overbarLine({
      left: 0,
      right: 0,
      top: 50 - overbarGlyphTopEm("Φ") * 15.116,
      fontSize: 15.116,
    });
    expect(bar!.y1).toBeCloseTo(line.y, 6);
    expect(bar!["stroke-width"]).toBeCloseTo(line.thickness, 6);
  });

  it("anchors the bar with the line for middle and end alignment", () => {
    const start = lines(
      richTextOverbars(phase, profile, {
        x: 100,
        y: 50,
        fontSize: 15.116,
        alignment: "start",
      })!,
    )[0]!;
    const width =
      (schematicTextAdvanceEm("Φ", "bold", true) +
        profile.typography.subscriptScale *
          (profile.typography.subscriptHorizontalGapEm +
            schematicTextAdvanceEm("2", "plain"))) *
      15.116;
    for (const [alignment, shift] of [
      ["middle", width / 2],
      ["end", width],
    ] as const) {
      const bar = lines(
        richTextOverbars(phase, profile, {
          x: 100,
          y: 50,
          fontSize: 15.116,
          alignment,
        })!,
      )[0]!;
      expect(bar.x1).toBeCloseTo(start.x1! - shift, 6);
    }
  });

  it("draws a bar over a subscript where the subscript sits", () => {
    const rendered = richTextOverbars(
      {
        runs: [
          { kind: "text", value: "V" },
          {
            kind: "span",
            style: "subscript",
            children: [
              {
                kind: "span",
                style: "overbar",
                children: [{ kind: "text", value: "x" }],
              },
            ],
          },
        ],
      },
      profile,
      { x: 0, y: 0, fontSize: 20, alignment: "start" },
    )!;
    const [bar] = lines(rendered);
    const scale = profile.typography.subscriptScale;
    const scriptSize = 20 * scale;
    expect(bar!.x1).toBeGreaterThan(schematicTextAdvanceEm("V", "plain") * 20);
    expect(bar!["stroke-width"]).toBeCloseTo(OVERBAR_THICKNESS_EM * 20, 6);
    // Over the subscript's x height, below the base's cap line.
    expect(bar!.y1).toBeGreaterThan(-0.69 * 20);
    expect(bar!.y1).toBeLessThan(
      scriptSize * profile.typography.subscriptBaselineShiftEm -
        0.53 * scriptSize,
    );
  });

  it("leaves a bar in a fraction to the CSS overline", () => {
    const document: RichTextDocument = {
      runs: [
        {
          kind: "fraction",
          numerator: {
            runs: [
              {
                kind: "span",
                style: "overbar",
                children: [{ kind: "text", value: "Q" }],
              },
            ],
          },
          denominator: { runs: [{ kind: "text", value: "2" }] },
        },
      ],
    };
    expect(
      richTextOverbars(document, profile, {
        x: 0,
        y: 0,
        fontSize: 20,
        alignment: "start",
      }),
    ).toBeNull();
    const rendered = renderRichTextWithOverbars(document, profile, {
      x: 0,
      y: 0,
      fontSize: 20,
      alignment: "start",
    });
    expect(rendered.decorations).toBe("");
    expect(rendered.tspans).toContain("text-decoration:overline");
  });

  it("draws nothing for text without a bar", () => {
    expect(
      richTextOverbars({ runs: [{ kind: "text", value: "M1" }] }, profile, {
        x: 0,
        y: 0,
        fontSize: 20,
        alignment: "start",
      }),
    ).toBe("");
  });
});
