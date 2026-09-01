import { describe, expect, it } from "vitest";

import { razaviTextbookProfile } from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";

import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";

type ScriptStyle = "subscript" | "superscript";

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

    const lineX1 = numericAttribute(overbar, "x1");
    const lineX2 = numericAttribute(overbar, "x2");
    const contentRight = Math.max(
      subscriptX + numericAttribute(subscript, "textLength"),
      superscriptX + numericAttribute(superscript, "textLength"),
    );
    expect(lineX1).toBe(numericAttribute(base, "x"));
    expect(lineX2).toBeCloseTo(lineX1 + rendered.width, 6);
    expect(lineX2).toBeCloseTo(contentRight, 6);
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
    expect(numericAttribute(subscript, "textLength")).toBeGreaterThan(
      numericAttribute(superscript, "textLength"),
    );
    expect(numericAttribute(overbar, "x2")).toBeCloseTo(
      numericAttribute(subscript, "x") +
        numericAttribute(subscript, "textLength"),
      6,
    );
  });

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
    // Just clear of the cap line, and spanning exactly the text it covers.
    expect(Number(line[1])).toBeCloseTo(-(20 * 0.78) - 20 * 0.08, 5);
    expect(Number(line[2])).toBeCloseTo(positioned!.width, 5);
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
    expect(y).toBeCloseTo(-(20 * 0.78) - 20 * 0.08, 5);
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

    expect(numericAttribute(overbar, "x1")).toBe(numericAttribute(base, "x"));
    const nameRight =
      numericAttribute(subscript, "x") +
      numericAttribute(subscript, "textLength");
    expect(numericAttribute(overbar, "x2")).toBeCloseTo(nameRight, 6);
    // The reported width covers the whole line, so the bar ends short of it.
    expect(numericAttribute(overbar, "x2")).toBeLessThan(
      numericAttribute(base, "x") + rendered.width,
    );
  });

  it("still renders the appended equation", () => {
    const rendered = render(meanValueThenEquation());
    expect(rendered.tspans).toContain("=4kT");
    expect(rendered.tspans).toContain("m");
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
