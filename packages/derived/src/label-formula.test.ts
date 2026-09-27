import { describe, expect, it } from "vitest";

import { schematicTextAdvanceEm } from "./fraction-text-metrics.js";
import {
  labelFormulaProblem,
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

  it("keeps each run against the box beside it", () => {
    const result = layout(
      String.raw`a+\frac{b}{c}+d+\frac{e}{f}(g+h)+\left(1+\frac{s}{t}\right)`,
    );
    const anchorOf = (text: string) => glyph(result, text).anchor;
    // The first run of a row keeps against what follows, the last against
    // what precedes; one between two boxes, or alone in its row, centres.
    expect(anchorOf("a")).toBe("end");
    expect(anchorOf("d")).toBe("middle");
    expect(anchorOf("b")).toBe("middle");
    // Inside fences a run keeps against the opening fence.
    expect(anchorOf("1")).toBe("start");
    const last = layout(String.raw`\frac{e}{f}(g+h)`);
    expect(glyph(last, "g").anchor).toBe("start");
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

  it("sets every construct the formula palette offers", () => {
    // Each keycap and More-symbols entry, with its slots filled.
    for (const latex of [
      "x_{n}",
      "x^{n}",
      String.raw`\frac{a}{b}`,
      String.raw`\sqrt{x}`,
      String.raw`\sqrt[3]{x}`,
      String.raw`\overline{x}`,
      String.raw`\hat{x}`,
      String.raw`\vec{v}`,
      String.raw`\left|x\right|`,
      String.raw`\left\{x\right\}`,
      String.raw`\frac{\mathrm{d}y}{\mathrm{d}x}`,
      String.raw`\frac{\partial y}{\partial x}`,
      String.raw`\sum_{k=1}^{n} x_k`,
      String.raw`\prod_{k=1}^{n} x_k`,
      String.raw`\int_{0}^{T} v\,dt`,
      String.raw`\iint_{S} f`,
      String.raw`\lim_{x \to 0} f(x)`,
      String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
      String.raw`\begin{cases}1&x>0\\0&x\le 0\end{cases}`,
      String.raw`\infty`,
      String.raw`\pm\mp\times\div\cdot\neq\approx\leq\geq\propto\angle\parallel\perp\rightarrow\leftrightarrow\Rightarrow`,
      String.raw`\sin(x)\cos(x)\tan(x)\ln(x)\log_{2}(x)\exp(x)`,
      String.raw`\operatorname{Re}(z)\operatorname{Im}(z)`,
      String.raw`\dot{x}\ddot{x}\tilde{x}`,
      String.raw`\left\langle x\right\rangle`,
      String.raw`\int_0^1\frac{1}{\sqrt{1+\cos^2x}}\differentialD x`,
    ])
      expect(labelFormulaProblem(latex), latex).toBeNull();
  });

  it("stacks a sum's limits in display style and sets them aside inline", () => {
    const display = layout(String.raw`\sum_{k=1}^{n} x_k`, {
      display: "block",
    });
    const sigma = glyph(display, "∑");
    // Bigger than the text, centred over its limits.
    expect(sigma.size).toBeGreaterThan(options.fontSize);
    const n = glyph(display, "n");
    const k = glyph(display, "k");
    expect(n.y).toBeLessThan(sigma.y - sigma.size * 0.5);
    expect(k.y).toBeGreaterThan(sigma.y);
    expect(
      Math.abs(n.x + n.advance / 2 - (sigma.x + sigma.advance / 2)),
    ).toBeLessThan(1);
    // Inline, the limits are scripts beside it, and it stays smaller.
    const inline = layout(String.raw`\sum_{k=1}^{n} x_k`);
    const small = glyph(inline, "∑");
    expect(small.size).toBeLessThan(sigma.size);
    expect(glyph(inline, "n").x).toBeGreaterThan(small.x + small.advance / 2);
    // An integral keeps its limits aside even in display style.
    const integral = layout(String.raw`\int_0^T v`, { display: "block" });
    const sign = glyph(integral, "∫");
    expect(glyph(integral, "T").x).toBeGreaterThan(sign.x + sign.advance / 2);
    // \lim stacks too; \limits and \nolimits override.
    const limit = layout(String.raw`\lim_{x\to 0} f`, { display: "block" });
    expect(glyph(limit, "x").y).toBeGreaterThan(glyph(limit, "lim").y);
    const aside = layout(String.raw`\sum\nolimits_k a`, { display: "block" });
    expect(glyph(aside, "k").x).toBeGreaterThan(glyph(aside, "∑").x);
  });

  it("sets accents over their bodies and a root's index in its crook", () => {
    const hat = layout(String.raw`\hat{x}`);
    const mark = glyph(hat, "ˆ");
    const x = glyph(hat, "x");
    expect(
      Math.abs(mark.x + mark.advance / 2 - (x.x + x.advance / 2)),
    ).toBeLessThan(options.fontSize * 0.2);
    // Over a capital the mark rises with it.
    expect(glyph(layout(String.raw`\hat{L}`), "ˆ").y).toBeLessThan(mark.y);
    const vector = layout(String.raw`\vec{v}`);
    expect(glyph(vector, "→").size).toBeLessThan(options.fontSize);
    expect(glyph(vector, "→").y).toBeLessThan(0);
    // A wide accent stretches across its body.
    expect(
      glyph(layout(String.raw`\overrightarrow{AB}`), "→").scaleX,
    ).toBeGreaterThan(1);
    const root = layout(String.raw`\sqrt[3]{x}`);
    const three = glyph(root, "3");
    expect(three.size).toBeLessThan(options.fontSize * options.subscriptScale);
    expect(three.x).toBeLessThan(glyph(root, "√").x + glyph(root, "√").advance);
    expect(three.y).toBeLessThan(0);
  });

  it("lays matrices and cases out in rows and columns within their fences", () => {
    const matrix = layout(String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`);
    const [a, b, c, d] = ["a", "b", "c", "d"].map((text) =>
      glyph(matrix, text),
    );
    expect(a!.y).toBeCloseTo(b!.y);
    expect(c!.y).toBeCloseTo(d!.y);
    expect(c!.y).toBeGreaterThan(a!.y);
    // A matrix column centres its entries.
    expect(a!.x + a!.advance / 2).toBeCloseTo(c!.x + c!.advance / 2);
    expect(b!.x).toBeGreaterThan(a!.x + a!.advance);
    const brackets = glyphs(matrix).filter((item) => /[[\]]/u.test(item.text));
    expect(brackets).toHaveLength(2);
    expect(brackets[0]!.scaleY).toBeGreaterThan(1);
    // Cases: one brace on the left, left-aligned columns.
    const cases = layout(
      String.raw`f(x)=\begin{cases}1&x>0\\-1&\text{otherwise}\end{cases}`,
    );
    const braces = glyphs(cases).filter((item) => item.text === "{");
    expect(braces).toHaveLength(1);
    expect(glyphs(cases).some((item) => item.text === "}")).toBe(false);
    expect(glyph(cases, "1").x).toBeLessThan(glyph(cases, "−").x + 1);
    // Aligned rows join at their relation.
    const aligned = layout(String.raw`\begin{aligned}a&=b+c\\&=d\end{aligned}`);
    const equals = glyphs(aligned).filter((item) => item.text === "=");
    expect(equals).toHaveLength(2);
    expect(equals[0]!.x).toBeCloseTo(equals[1]!.x, 0);
  });

  it("sets binomials, stacks, arrows, alphabets and negations", () => {
    const binom = layout(String.raw`\binom{n}{k}`);
    expect(binom.items.some((item) => item.kind === "rule")).toBe(false);
    expect(
      glyphs(binom).filter((item) => /[()]/u.test(item.text)),
    ).toHaveLength(2);
    const stacked = layout(String.raw`\overset{!}{=}`);
    expect(glyph(stacked, "!").y).toBeLessThan(glyph(stacked, "=").y);
    const arrow = layout(String.raw`a\xrightarrow{k}b`);
    expect(glyph(arrow, "k").y).toBeLessThan(0);
    expect(glyph(layout(String.raw`\mathbb{R}`), "ℝ").italic).toBe(false);
    expect(glyph(layout(String.raw`\mathcal{L}`), "ℒ")).toBeDefined();
    expect(glyph(layout(String.raw`a\not= b`), "≠")).toBeDefined();
    const big = layout(String.raw`\Big(x\Big)`);
    expect(
      glyphs(big).find((item) => item.text === "(")!.scaleY,
    ).toBeGreaterThan(1);
    const middle = layout(String.raw`\left\{x\middle|\frac{x}{2}>0\right\}`, {
      display: "block",
    });
    expect(glyph(middle, "|").scaleY).toBeGreaterThan(1);
  });

  it("names what label type cannot set", () => {
    expect(labelFormulaProblem(String.raw`\boxed{x}`)).toBe(
      String.raw`\boxed is not supported in formulas`,
    );
    expect(labelFormulaProblem("a & b")).toMatch(/^& separates columns/u);
    expect(labelFormulaProblem(String.raw`\frac{1}{2`)).toMatch(
      /^The formula is incomplete/u,
    );
    for (const latex of [
      String.raw`\boxed{x}`,
      String.raw`\color{red}{x}`,
      String.raw`\overbrace{x}^{n}`,
      String.raw`\begin{tabular}{c}x\end{tabular}`,
      "a & b",
      String.raw`x \\ y`,
      String.raw`\frac{1}{2`,
      String.raw`a}`,
      "",
    ])
      expect(layoutLabelFormula(latex, options), latex).toBeNull();
  });
});
