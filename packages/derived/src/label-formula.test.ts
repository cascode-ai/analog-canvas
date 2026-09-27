import { describe, expect, it } from "vitest";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";
import {
  layoutLabelFormula,
  type LabelFormulaGlyph,
  type LabelFormulaLayout,
  type LabelFormulaOptions,
} from "./label-formula.js";
import { globalSchematicTypography } from "./style-profile.js";

const options: LabelFormulaOptions = {
  fontSize: 15,
  bold: true,
  display: "inline",
  subscriptScale: globalSchematicTypography.subscriptScale,
  subscriptBaselineShiftEm: globalSchematicTypography.subscriptBaselineShiftEm,
  subscriptHorizontalGapEm: globalSchematicTypography.subscriptHorizontalGapEm,
};

function layout(latex: string, overrides: Partial<LabelFormulaOptions> = {}) {
  const result = layoutLabelFormula(latex, { ...options, ...overrides });
  expect(result, latex).not.toBeNull();
  return result!;
}

function glyphs(result: LabelFormulaLayout): LabelFormulaGlyph[] {
  return result.items.filter(
    (item): item is LabelFormulaGlyph => item.kind === "glyph",
  );
}

function glyph(result: LabelFormulaLayout, text: string): LabelFormulaGlyph {
  const found = glyphs(result).find((item) => item.text === text);
  expect(found, text).toBeDefined();
  return found!;
}

describe("formulas set in label type", () => {
  it("sets a letter italic and its subscript upright, as a label reads", () => {
    const result = layout("V_{in}");
    expect(glyph(result, "V")).toMatchObject({ italic: true, bold: true });
    for (const letter of ["i", "n"]) {
      expect(glyph(result, letter)).toMatchObject({
        italic: false,
        size: options.fontSize * options.subscriptScale,
      });
    }
    // The subscript drops by the label's own shift and follows its gap, both
    // in the subscript's size, as the label renderer sets them.
    const scriptSize = options.fontSize * options.subscriptScale;
    expect(glyph(result, "i").y).toBeCloseTo(
      scriptSize * options.subscriptBaselineShiftEm,
    );
    expect(glyph(result, "i").x).toBeCloseTo(
      schematicTextAdvanceEm("V", "bold") * options.fontSize +
        options.subscriptHorizontalGapEm * scriptSize,
    );
  });

  it("flows symbols and their scripts as runs of text between boxes", () => {
    const result = layout(String.raw`-A_0^3+\frac{s}{\omega_0}\left(x\right)`);
    const flowOf = (text: string) => glyph(result, text).flow;
    // The minus, A and both its scripts are one run, as are the + and
    // nothing after it: the fraction and the fence end runs.
    for (const text of ["A", "0", "3", "+"])
      expect(flowOf(text), text).toBe(flowOf("−"));
    expect(flowOf("s")).not.toBe(flowOf("−"));
    expect(flowOf("ω")).not.toBe(flowOf("s"));
    expect(flowOf("x")).not.toBe(flowOf("ω"));
    expect(glyph(result, "(").flow).toBeUndefined();
    // Every glyph carries its table advance, which the next glyph in its
    // run is placed after.
    for (const item of glyphs(result))
      expect(item.advance).toBeCloseTo(
        schematicTextAdvanceEm(item.text, "bold") * item.size,
      );
    // Of stacked scripts, the one reaching further comes last, so the run
    // flows on from the end of both.
    const run = glyphs(result).filter((item) => item.flow === flowOf("−"));
    expect(run.map((item) => item.text)).toEqual([
      "−",
      "A",
      expect.stringMatching(/^[03]$/u),
      expect.stringMatching(/^[03]$/u),
      "+",
    ]);
    const [, , earlier, later] = run;
    expect(later!.x + later!.advance).toBeGreaterThanOrEqual(
      earlier!.x + earlier!.advance,
    );
  });

  it("keeps digits, operators, capital Greek and function names upright", () => {
    const result = layout(String.raw`2\pi f\Omega+\sin x`);
    expect(glyph(result, "2").italic).toBe(false);
    expect(glyph(result, "π").italic).toBe(true);
    expect(glyph(result, "f").italic).toBe(true);
    expect(glyph(result, "Ω").italic).toBe(false);
    expect(glyph(result, "+").italic).toBe(false);
    expect(glyph(result, "sin").italic).toBe(false);
    expect(glyph(result, "x").italic).toBe(true);
  });

  it("spells Greek letters and bars with the characters a label uses", () => {
    const result = layout(String.raw`\phi+\epsilon+\varphi`);
    expect(glyphs(result).map((item) => item.text)).toEqual([
      "φ",
      "+",
      "ε",
      "+",
      "φ",
    ]);
    // The label fonts have ‖ and |, not ∥ and ∣.
    const parallel = layout(String.raw`r_{o1}\parallel r_{o2}\|x∥y\mid z`);
    const bars = glyphs(parallel)
      .map((item) => item.text)
      .filter((text) => /[‖|∥∣]/u.test(text));
    expect(bars).toEqual(["‖", "‖", "‖", "|"]);
  });

  it("honours explicit font commands over the defaults", () => {
    const result = layout(String.raw`\mathrm{d}x+\mathit{A}_{\mathit{k}}`);
    expect(glyph(result, "d").italic).toBe(false);
    expect(glyph(result, "A").italic).toBe(true);
    expect(glyph(result, "k").italic).toBe(true);
    const plain = layout(String.raw`a+\mathbf{b}`, { bold: false });
    expect(glyph(plain, "a").bold).toBe(false);
    expect(glyph(plain, "b").bold).toBe(true);
  });

  it("measures with the label advance tables and TeX operator spacing", () => {
    const result = layout("a=b");
    const advance = (text: string) =>
      schematicTextAdvanceEm(text, "bold") * options.fontSize;
    const thick = (5 / 18) * options.fontSize;
    expect(result.width).toBeCloseTo(
      advance("a") + thick + advance("=") + thick + advance("b"),
    );
    // A leading minus is unary and takes no space of its own.
    const negative = layout("-a");
    expect(negative.width).toBeCloseTo(advance("−") + advance("a"));
  });

  it("stacks a fraction about one bar on the axis", () => {
    const result = layout(String.raw`\frac{1}{g_m}`, { display: "block" });
    const rules = result.items.filter((item) => item.kind === "rule");
    expect(rules).toHaveLength(1);
    const bar = rules[0]!;
    expect(bar.y).toBeLessThan(0);
    // Display parts are one style down: text size.
    expect(glyph(result, "1").size).toBe(options.fontSize);
    expect(glyph(result, "1").y).toBeLessThan(bar.y);
    expect(glyph(result, "g").y).toBeGreaterThan(bar.y);
    expect(glyph(result, "m").size).toBeCloseTo(
      options.fontSize * options.subscriptScale,
    );
    // An inline fraction sets its parts at script size and stays shorter.
    const inline = layout(String.raw`\frac{1}{g_m}`);
    expect(glyph(inline, "1").size).toBeCloseTo(
      options.fontSize * options.subscriptScale,
    );
    expect(inline.ascent + inline.descent).toBeLessThan(
      result.ascent + result.descent,
    );
  });

  it("draws radicals, overlines and fences around their bodies", () => {
    const root = layout(String.raw`\sqrt{L_1C_1}`);
    const rule = root.items.find((item) => item.kind === "rule")!;
    expect(rule.y).toBeLessThan(-glyph(root, "L").size * 0.7);
    expect(glyph(root, "√")).toBeDefined();

    const bar = layout(String.raw`\overline{Q}`);
    expect(bar.items.filter((item) => item.kind === "rule")).toHaveLength(1);

    const fenced = layout(String.raw`\left(\frac{a}{b}\right)`, {
      display: "block",
    });
    const fences = glyphs(fenced).filter((item) => /[()]/u.test(item.text));
    expect(fences).toHaveLength(2);
    expect(fences[0]!.scaleY).toBeGreaterThan(1);
    // Fences and a radical sign keep against what they enclose.
    expect(fences.map((fence) => fence.hug)).toEqual(["right", "left"]);
    expect(glyph(root, "√").hug).toBe("right");
    expect(fenced.width).toBeGreaterThan(
      layout(String.raw`\frac{a}{b}`, { display: "block" }).width,
    );
  });

  it("leaves LaTeX it does not set to the typesetter", () => {
    for (const latex of [
      String.raw`\sum_k x_k`,
      String.raw`\hat{x}`,
      String.raw`\mathbb{R}`,
      String.raw`\begin{cases}a\end{cases}`,
      String.raw`\sqrt[3]{x}`,
      String.raw`\frac{1}{2`,
      String.raw`a}`,
      "",
    ])
      expect(layoutLabelFormula(latex, options), latex).toBeNull();
  });
});
