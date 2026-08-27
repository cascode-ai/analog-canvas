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

function render(document: RichTextDocument) {
  const rendered = renderPositionedOverbarScriptDocument(
    document,
    razaviTextbookProfile,
    {
      x: 100,
      y: 50,
      fontSize: 20,
      alignment: "start",
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

  it("leaves a plain overbar to the general rich-text renderer", () => {
    expect(
      renderPositionedOverbarScriptDocument(
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
      ),
    ).toBeNull();
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
