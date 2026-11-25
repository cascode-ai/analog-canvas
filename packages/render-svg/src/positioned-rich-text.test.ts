import { describe, expect, it } from "vitest";

import {
  OVERBAR_GAP_EM,
  OVERBAR_THICKNESS_EM,
  razaviTextbookProfile,
  schematicTextAdvanceEm,
  schematicTextInkEm,
} from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";

import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";

type ScriptStyle = "subscript" | "superscript";

const scriptSize = 20 * razaviTextbookProfile.typography.subscriptScale;
/** Where upright regular `text` inks, from where it starts, at `size`. */
function ink(text: string, size = 20): { left: number; right: number } {
  const em = schematicTextInkEm(text, "plain");
  if (!em) throw new Error(`${text} draws nothing`);
  return { left: em.left * size, right: em.right * size };
}
/** The bar's centre line over glyphs reaching `topEm` above the baseline. */
function barY(topEm: number, size = 20): number {
  return (
    -topEm * size - size * OVERBAR_GAP_EM - (size * OVERBAR_THICKNESS_EM) / 2
  );
}

function overbarExpression(options?: {
  base?: string;
  subscript?: string;
  superscript?: string;
  order?: readonly ScriptStyle[];
}): RichTextDocument {
  const subscript = options?.subscript ?? "n2";
  const superscript = options?.superscript ?? "2";
  const scriptText: Record<ScriptStyle, string> = { subscript, superscript };
  const scripts = (options?.order ?? ["subscript", "superscript"]).map(
    (style): RichTextRun => ({
      kind: "span",
      style,
      children: [{ kind: "text", value: scriptText[style] }],
    }),
  );

  return {
    runs: [
      {
        kind: "span",
        style: "overbar",
        children: [{ kind: "text", value: options?.base ?? "I" }, ...scripts],
      },
    ],
  };
}

function render(
  document: RichTextDocument,
  alignment: "start" | "middle" | "end" = "start",
) {
  const rendered = renderPositionedOverbarScriptDocument(
    document,
    razaviTextbookProfile,
    {
      x: 100,
      y: 50,
      fontSize: 20,
      alignment,
    },
  );
  expect(rendered).not.toBeNull();
  if (!rendered) throw new Error("Expected the positioned renderer to match");
  return rendered;
}

function tagAttributes(
  markup: string,
  tagName: "line" | "tspan",
  identifyingAttribute: string,
): Record<string, string> {
  const tag = markup.match(
    new RegExp(`<${tagName}[^>]*${identifyingAttribute}[^>]*>`),
  )?.[0];
  if (!tag) {
    throw new Error(
      `Missing <${tagName}> with ${identifyingAttribute} in ${markup}`,
    );
  }

  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
}

function numericAttribute(
  attributes: Record<string, string>,
  name: string,
): number {
  const value = Number(attributes[name]);
  if (!Number.isFinite(value)) throw new Error(`Missing numeric ${name}`);
  return value;
}

describe("renderPositionedOverbarScriptDocument", () => {
  it("stacks I sub n2 and sup 2 at one attachment column under one exact overbar", () => {
    const rendered = render(overbarExpression());
    const base = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="base"',
    );
    const subscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="subscript"',
    );
    const superscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="superscript"',
    );
    const overbar = tagAttributes(
      rendered.decorations,
      "line",
      'data-text-decoration="overbar"',
    );

    const subscriptX = numericAttribute(subscript, "x");
    const superscriptX = numericAttribute(superscript, "x");
    expect(subscriptX).toBe(superscriptX);
    expect(numericAttribute(superscript, "y")).toBeLessThan(
      numericAttribute(base, "y"),
    );
    expect(numericAttribute(subscript, "y")).toBeGreaterThan(
      numericAttribute(base, "y"),
    );

    // The bar spans the name's ink: from I's stem to the last script glyph.
    const lineX1 = numericAttribute(overbar, "x1");
    const lineX2 = numericAttribute(overbar, "x2");
    const contentRight = Math.max(
      subscriptX + ink("n2", scriptSize).right,
      superscriptX + ink("2", scriptSize).right,
    );
    expect(lineX1).toBeCloseTo(numericAttribute(base, "x") + ink("I").left, 6);
    expect(lineX2).toBeLessThanOrEqual(lineX1 + rendered.width);
    expect(lineX2).toBeCloseTo(contentRight, 5);
    expect(numericAttribute(overbar, "stroke-width")).toBeCloseTo(
      20 * OVERBAR_THICKNESS_EM,
      6,
    );
    expect(numericAttribute(overbar, "y1")).toBe(
      numericAttribute(overbar, "y2"),
    );
    expect(rendered.decorations.match(/<line\b/g)).toHaveLength(1);
  });

  it("preserves a superscript-before-subscript document while sharing its attachment column", () => {
    const rendered = render(
      overbarExpression({ order: ["superscript", "subscript"] }),
    );
    const subscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="subscript"',
    );
    const superscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="superscript"',
    );

    expect(rendered.tspans.indexOf('data-text-run="superscript"')).toBeLessThan(
      rendered.tspans.indexOf('data-text-run="subscript"'),
    );
    expect(numericAttribute(subscript, "x")).toBe(
      numericAttribute(superscript, "x"),
    );
    expect(numericAttribute(superscript, "y")).toBeLessThan(
      numericAttribute(subscript, "y"),
    );
  });

  it("gives proportional WW and ii text different advances and exact line endpoints", () => {
    const wideBase = render(overbarExpression({ base: "WW" }));
    const narrowBase = render(overbarExpression({ base: "ii" }));
    const wideScript = tagAttributes(
      wideBase.tspans,
      "tspan",
      'data-text-run="subscript"',
    );
    const narrowScript = tagAttributes(
      narrowBase.tspans,
      "tspan",
      'data-text-run="subscript"',
    );

    expect(numericAttribute(wideScript, "x")).toBeGreaterThan(
      numericAttribute(narrowScript, "x"),
    );
    expect(wideBase.width).toBeGreaterThan(narrowBase.width);

    const mixedScripts = render(
      overbarExpression({ subscript: "WW", superscript: "ii" }),
    );
    const subscript = tagAttributes(
      mixedScripts.tspans,
      "tspan",
      'data-text-run="subscript"',
    );
    const superscript = tagAttributes(
      mixedScripts.tspans,
      "tspan",
      'data-text-run="superscript"',
    );
    const overbar = tagAttributes(
      mixedScripts.decorations,
      "line",
      'data-text-decoration="overbar"',
    );
    expect(numericAttribute(subscript, "data-text-advance")).toBeGreaterThan(
      numericAttribute(superscript, "data-text-advance"),
    );
    expect(numericAttribute(overbar, "x2")).toBeCloseTo(
      numericAttribute(subscript, "x") + ink("WW", scriptSize).right,
      5,
    );
  });

  it.each([
    ["regular", false, false, "plain"],
    ["italic", false, true, "plain"],
    ["bold", true, false, "bold"],
  ] as const)(
    "keeps a narrow %s glyph at its native width",
    (_style, defaultBold, defaultItalic, metricWeight) => {
      const positioned = renderPositionedOverbarScriptDocument(
        {
          runs: [
            {
              kind: "span",
              style: "overbar",
              children: [{ kind: "text", value: "f" }],
            },
          ],
        },
        razaviTextbookProfile,
        {
          x: 0,
          y: 0,
          fontSize: 20,
          alignment: "start",
          defaultBold,
          defaultItalic,
        },
      );
      expect(positioned).not.toBeNull();
      const base = tagAttributes(
        positioned!.tspans,
        "tspan",
        'data-text-run="base"',
      );

      expect(base).not.toHaveProperty("textLength");
      expect(base).not.toHaveProperty("lengthAdjust");
      expect(numericAttribute(base, "data-text-advance")).toBeCloseTo(
        schematicTextAdvanceEm("f", metricWeight, defaultItalic) * 20,
        6,
      );
      expect(positioned!.tspans).not.toContain("spacingAndGlyphs");
    },
  );

  it("draws a plain overbar as one line over the glyphs", () => {
    // This used to fall through to CSS text-decoration, which puts the line
    // at the font's ascender rather than over the glyphs.
    const positioned = renderPositionedOverbarScriptDocument(
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
      { x: 0, y: 0, fontSize: 20, alignment: "start" },
    );
    expect(positioned).not.toBeNull();
    expect(positioned!.decorations.match(/<line /gu)).toHaveLength(1);
    const line = /y1="(-?[\d.]+)"[^>]*x2="(-?[\d.]+)"/u.exec(
      positioned!.decorations,
    )!;
    // Clear of the ascender of t, spanning the ink of the text it covers.
    expect(Number(line[1])).toBeCloseTo(barY(0.72), 5);
    expect(Number(line[2])).toBeCloseTo(ink("Vout").right, 5);
  });

  it("uses the requested paint for the explicit overbar decoration", () => {
    const positioned = renderPositionedOverbarScriptDocument(
      overbarExpression(),
      razaviTextbookProfile,
      {
        x: 0,
        y: 0,
        fontSize: 20,
        alignment: "start",
        color: "#2563EB",
      },
    );

    expect(positioned).not.toBeNull();
    expect(positioned!.decorations).toContain('stroke="#2563EB"');
    expect(positioned!.decorations).not.toContain(
      `stroke="${razaviTextbookProfile.foreground}"`,
    );
  });

  it("draws one overbar over a base carrying a single script", () => {
    const positioned = renderPositionedOverbarScriptDocument(
      {
        runs: [
          {
            kind: "span",
            style: "overbar",
            children: [
              { kind: "text", value: "Q" },
              {
                kind: "span",
                style: "subscript",
                children: [{ kind: "text", value: "1" }],
              },
            ],
          },
        ],
      },
      razaviTextbookProfile,
      { x: 0, y: 0, fontSize: 20, alignment: "start" },
    );
    expect(positioned).not.toBeNull();
    // One bar, not one per tspan, and a subscript cannot lift it.
    expect(positioned!.decorations.match(/<line /gu)).toHaveLength(1);
    const y = Number(/y1="(-?[\d.]+)"/u.exec(positioned!.decorations)![1]);
    expect(y).toBeCloseTo(barY(0.69), 5);
  });

  it("leaves multiline overbars to the general rich-text renderer", () => {
    const document = overbarExpression();
    const overbar = document.runs[0];
    if (overbar?.kind !== "span") throw new Error("Expected an overbar span");
    overbar.children.splice(1, 0, { kind: "line-break" });

    expect(
      renderPositionedOverbarScriptDocument(document, razaviTextbookProfile, {
        x: 0,
        y: 0,
        fontSize: 20,
        alignment: "start",
      }),
    ).toBeNull();
  });
});

describe("an overbar followed by more of the line", () => {
  /**
   * Issue #495, taken from the reporter's own Project file: a mean-value name
   * with both a subscript and a superscript, then the rest of the equation
   * appended after it.
   */
  function meanValueThenEquation(): RichTextDocument {
    return {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [
            {
              kind: "span",
              style: "italic",
              children: [
                {
                  kind: "span",
                  style: "overbar",
                  children: [
                    { kind: "text", value: "I" },
                    {
                      kind: "span",
                      style: "subscript",
                      children: [{ kind: "text", value: "n" }],
                    },
                    {
                      kind: "span",
                      style: "superscript",
                      children: [{ kind: "text", value: "2" }],
                    },
                  ],
                },
                { kind: "text", value: "=4kT" },
                {
                  kind: "span",
                  style: "subscript",
                  children: [{ kind: "text", value: "m" }],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  // The reported defect: appending to the name dropped the whole line to CSS
  // `text-decoration: overline`, which SVG inherits into every nested tspan,
  // so the subscript and the superscript each grew a bar of their own at their
  // own height. One drawn line, and no inherited decoration anywhere.
  it("keeps one drawn bar over the name when the equation continues", () => {
    const rendered = render(meanValueThenEquation());

    expect(rendered.decorations.match(/<line\b/g)).toHaveLength(1);
    expect(rendered.tspans).not.toContain("text-decoration");
    expect(rendered.decorations).not.toContain("text-decoration:");
  });

  // The bar covers the name it belongs to and stops there; it must not run on
  // over the equation that follows.
  it("stops the bar at the end of the name, not the end of the line", () => {
    const rendered = render(meanValueThenEquation());
    const overbar = tagAttributes(
      rendered.decorations,
      "line",
      'data-text-decoration="overbar"',
    );
    const base = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="base"',
    );
    const subscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="subscript"',
    );

    const boldInk = (text: string, size: number, italic = false) => {
      const em = schematicTextInkEm(text, "bold", italic)!;
      return { left: em.left * size, right: em.right * size };
    };
    expect(numericAttribute(overbar, "x1")).toBeCloseTo(
      numericAttribute(base, "x") + boldInk("I", 20, true).left,
      6,
    );
    const superscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="superscript"',
    );
    const nameRight = Math.max(
      numericAttribute(subscript, "x") + boldInk("n", scriptSize).right,
      numericAttribute(superscript, "x") + boldInk("2", scriptSize).right,
    );
    expect(numericAttribute(overbar, "x2")).toBeCloseTo(nameRight, 6);
    // The reported width covers the whole line, so the bar ends short of it.
    expect(numericAttribute(overbar, "x2")).toBeLessThan(
      numericAttribute(base, "x") + rendered.width,
    );
  });
  it("positions one exact bar when ordinary text precedes the expression", () => {
    const document = meanValueThenEquation();
    const bold = document.runs[0];
    if (bold?.kind !== "span") throw new Error("Expected bold wrapper");
    const italic = bold.children[0];
    if (italic?.kind !== "span") throw new Error("Expected italic wrapper");
    italic.children.unshift({ kind: "text", value: "S=" });

    const rendered = render(document);
    expect(rendered.decorations.match(/<line\b/g)).toHaveLength(1);
    expect(rendered.tspans).toContain("S=");
    expect(rendered.tspans).toContain("=4kT");
    expect(rendered.tspans).not.toContain("text-decoration");
  });

  it.each([["middle", 100] as const, ["end", 100] as const])(
    "aligns the complete continued line for %s alignment",
    (alignment, x) => {
      const rendered = render(meanValueThenEquation(), alignment);
      const base = tagAttributes(
        rendered.tspans,
        "tspan",
        'data-text-run="base"',
      );
      const startX = numericAttribute(base, "x");

      expect(
        alignment === "middle"
          ? startX + rendered.width / 2
          : startX + rendered.width,
      ).toBeCloseTo(x, 6);
    },
  );

  it("measures styled continuation runs with the shared RichText layout", () => {
    const document = meanValueThenEquation();
    const italic = document.runs[0];
    if (italic?.kind !== "span") throw new Error("Expected bold wrapper");
    const inner = italic.children[0];
    if (inner?.kind !== "span") throw new Error("Expected italic wrapper");
    inner.children.splice(1, inner.children.length - 1, {
      kind: "fraction",
      numerator: { runs: [{ kind: "text", value: "gm" }] },
      denominator: { runs: [{ kind: "text", value: "ro" }] },
    });

    const rendered = render(document);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.tspans).toContain('data-text-run="fraction"');
  });
});

describe("several barred names on one line", () => {
  // Reported as I̅_N & E̅V̅: the second bar sent the whole line to CSS
  // `overline`, which the subscript inherits, so N grew a short bar of its
  // own, lower than the bar over I.
  const twoNames: RichTextDocument = {
    runs: [
      {
        kind: "span",
        style: "overbar",
        children: [
          { kind: "text", value: "I" },
          {
            kind: "span",
            style: "subscript",
            children: [{ kind: "text", value: "N" }],
          },
        ],
      },
      { kind: "text", value: " & " },
      {
        kind: "span",
        style: "overbar",
        children: [{ kind: "text", value: "EV" }],
      },
    ],
  };
  const bars = (decorations: string) =>
    [...decorations.matchAll(/<line\b[^>]*>/g)].map(
      (match) =>
        Object.fromEntries(
          [...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [
            attribute[1]!,
            Number(attribute[2]),
          ]),
        ) as Record<string, number>,
    );

  it("draws one bar over each whole name, its subscript included", () => {
    const rendered = render(twoNames);
    const drawn = bars(rendered.decorations);
    expect(drawn).toHaveLength(2);
    expect(rendered.tspans).not.toContain("text-decoration");
    const [first, second] = drawn as [
      Record<string, number>,
      Record<string, number>,
    ];
    const subscript = tagAttributes(
      rendered.tspans,
      "tspan",
      'data-text-run="subscript"',
    );
    // The first bar runs from I to the ink end of its subscript N.
    expect(first.x2).toBeCloseTo(
      numericAttribute(subscript, "x") + ink("N", scriptSize).right,
      5,
    );
    // Both bars sit at one height, and the second starts after " & ".
    expect(second.y1).toBeCloseTo(first.y1!, 6);
    expect(second.x1).toBeGreaterThan(first.x2!);
    expect(rendered.tspans).toContain(" &amp; ");
  });

  it("lays the line out across its whole width", () => {
    const rendered = render(twoNames, "end");
    const drawn = bars(rendered.decorations);
    // Right-aligned at x = 100, the line ends where the last bar's V does:
    // the bar stops at V's ink, its right side bearing short of the end.
    const v = schematicTextInkEm("V", "plain")!;
    expect(drawn.at(-1)!.x2).toBeCloseTo(
      100 - (schematicTextAdvanceEm("V", "plain") - v.right) * 20,
      6,
    );
  });
});
