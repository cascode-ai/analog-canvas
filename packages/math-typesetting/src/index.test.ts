import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  createFormulaTypesetter,
  loadFormulaFontFile,
  type FormulaFontFile,
  type FormulaRequest,
} from "./index.js";
import { clearFormulaArtifactCacheForTests, prepareFormula } from "./cache.js";

const baseRequest: FormulaRequest = {
  latex: String.raw`V_{OUT}`,
  display: "inline",
  profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
};

const corpus = [
  String.raw`V_{OUT}`,
  String.raw`I_{D1}+I_{D2}=I_{SS}`,
  String.raw`\overline{CLK}`,
  String.raw`\frac{g_m r_o}{1+s/\omega_p}`,
  String.raw`A_v=-g_m(r_o\parallel R_D)`,
  String.raw`\Delta V=\frac{I}{C}\Delta t`,
  String.raw`\frac{\mathrm{d}y}{\mathrm{d}x}`,
  String.raw`\int_0^1\frac{1}{\sqrt{1+\cos^2x}}\differentialD x`,
  String.raw`\prod_{k=0}^{N-1}a_k`,
  String.raw`\iint_{\Omega}f(x,y)\,\mathrm{d}x\,\mathrm{d}y`,
  String.raw`\lim_{s\to0}H(s)`,
  String.raw`\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}`,
  String.raw`\begin{cases}V_{OH},&x>0\\V_{OL},&x\leq0\end{cases}`,
  String.raw`\mathrm{ABC}+\mathit{ABC}+\mathbf{ABC}+\mathbb{R}+\mathcal{L}+\mathscr{L}+\mathfrak{g}+\mathtt{A}`,
];

function countSvgTags(svg: string, closing = false): number {
  return [...svg.matchAll(closing ? /<\/svg>/g : /<svg\b/g)].length;
}

describe("Analog Canvas formula typesetter", () => {
  it("renders the formula corpus as standalone path-based SVG", async () => {
    const typesetter = createFormulaTypesetter();
    for (const latex of corpus) {
      const result = await typesetter.typeset({ ...baseRequest, latex });
      expect(result, latex).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(result.artifact.width).toBeGreaterThan(0);
      expect(result.artifact.height).toBeGreaterThan(0);
      expect(result.artifact.baseline).toBeGreaterThanOrEqual(0);
      expect(result.artifact.baseline).toBeLessThanOrEqual(
        result.artifact.height,
      );
      expect(result.artifact.svg).toContain("<svg");
      expect(result.artifact.svg).toContain("<path");
      expect(countSvgTags(result.artifact.svg)).toBe(
        countSvgTags(result.artifact.svg, true),
      );
      expect(result.artifact.svg).not.toContain("<foreignObject");
      expect(result.artifact.svg).not.toContain("<image");
      expect(result.artifact.svg).not.toMatch(/(?:href|xlink:href)=/);
    }
  });

  it("keeps the complete expression when MathJax emits nested SVG glyphs", async () => {
    const typesetter = createFormulaTypesetter();
    const prefix = await typesetter.typeset({
      ...baseRequest,
      latex: String.raw`\overline{I_1^{n}}`,
    });
    const expression = await typesetter.typeset({
      ...baseRequest,
      latex: String.raw`\overline{I_1^{n}}=4kt`,
    });

    expect(prefix).toMatchObject({ ok: true });
    expect(expression).toMatchObject({ ok: true });
    if (!prefix.ok || !expression.ok) return;

    expect(expression.artifact.width).toBeGreaterThan(prefix.artifact.width);
    expect(expression.artifact.svg).toContain('data-latex="="');
    expect(expression.artifact.svg).toContain('data-latex="4"');
    // Sans typography groups adjacent letters in one math identifier; both
    // vector glyphs must survive after the nested overbar SVG.
    expect(expression.artifact.svg).toContain('data-latex="kt"');
    expect(expression.artifact.svg).toContain('data-c="1D5F8"');
    expect(expression.artifact.svg).toContain('data-c="1D601"');
    expect(countSvgTags(expression.artifact.svg)).toBe(
      countSvgTags(expression.artifact.svg, true),
    );
  });

  it("does not truncate ordinary operators after the first glyph", async () => {
    const result = await createFormulaTypesetter().typeset({
      ...baseRequest,
      latex: "x+y",
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.artifact.svg).toContain('data-latex="+"');
    expect(result.artifact.svg).toContain('data-latex="y"');
  });

  it("matches drawing sans weight/slant without rewriting explicit formula styling", async () => {
    const typesetter = createFormulaTypesetter();
    const glyphs = [
      [{}, "1D5DF"],
      [{ bold: false }, "1D5AB"],
      [{ italic: true }, "1D647"],
      [{ bold: false, italic: true }, "1D613"],
    ] as const;
    const keys = new Set<string>();
    for (const [style, glyph] of glyphs) {
      const result = await typesetter.typeset({
        ...baseRequest,
        latex: "L",
        ...style,
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(result.artifact.svg).toContain(`data-c="${glyph}"`);
      keys.add(result.artifact.sourceHash);
    }
    expect(keys.size).toBe(4);
    const explicit = await typesetter.typeset({
      ...baseRequest,
      latex: String.raw`\mathrm{L}`,
    });
    expect(explicit.ok && explicit.artifact.svg).toContain('data-c="4C"');
  });

  it("produces deterministic markup, metrics, and source hashes", async () => {
    const first = await createFormulaTypesetter().typeset(baseRequest);
    const second = await createFormulaTypesetter().typeset(baseRequest);
    expect(first).toEqual(second);
  });

  it.each(["href", "includegraphics", "newcommand", "require"])(
    "rejects the disallowed \\%s command",
    async (command) => {
      const result = await createFormulaTypesetter().typeset({
        ...baseRequest,
        latex: `\\${command}{value}`,
      });
      expect(result).toEqual({
        ok: false,
        diagnostic: expect.objectContaining({
          code: "FORMULA_DISALLOWED_COMMAND",
          command,
        }),
      });
    },
  );

  it("rejects malformed source instead of persisting an error glyph", async () => {
    const result = await createFormulaTypesetter().typeset({
      ...baseRequest,
      latex: String.raw`\frac{V_{OUT}`,
    });
    expect(result).toEqual({
      ok: false,
      diagnostic: expect.objectContaining({
        code: "FORMULA_INVALID_REQUEST",
      }),
    });
  });
});

function recordingTypesetter() {
  const loaded: FormulaFontFile[] = [];
  const typesetter = createFormulaTypesetter({
    loadFontFile(file) {
      loaded.push(file);
      return loadFormulaFontFile(file);
    },
  });
  return { typesetter, loaded };
}

function resultDigest(result: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex")
    .slice(0, 16);
}

// Digests of the complete typeset result from an eager build: the typesetter
// of origin/main at e73858c8 with every file of MathJaxNewcmFont.dynamicFiles
// imported and set up in the font's constructor. Lazy glyph files must not
// change a single glyph, metric or attribute. To add a case, typeset it with
// that eager build and take the first 16 hex digits of the sha256 of
// JSON.stringify(result), as resultDigest does.
const alphabetCases: readonly {
  latex: string;
  alphabets: readonly FormulaFontFile[];
  inline: string;
  block: string;
}[] = [
  {
    latex: String.raw`\mathtt{ABCxyz012}`,
    alphabets: ["monospace"],
    inline: "1eac42e62d0e6e24",
    block: "39a1885a0c67bd0a",
  },
  {
    latex: String.raw`\texttt{code}+\textsf{x}`,
    alphabets: ["monospace"],
    inline: "eda70f5646392106",
    block: "2e8d020f15ef2b39",
  },
  {
    latex: String.raw`\mathfrak{ABCxyz}`,
    alphabets: ["fraktur"],
    inline: "780578ce8ed942d8",
    block: "f45c8ee3e8fd3121",
  },
  {
    latex: String.raw`\mathscr{ABCXYZ}`,
    alphabets: ["script"],
    inline: "737f2fd52cd011ee",
    block: "7b486b3c470a84bf",
  },
  {
    latex: String.raw`\mathbb{ABCRNZ}+\mathbb{1}`,
    alphabets: ["double-struck"],
    inline: "eb40aadf88dc4e7c",
    block: "bbaa46b415ea788c",
  },
  {
    latex: String.raw`\Bbb{R}`,
    alphabets: ["double-struck"],
    inline: "bf8922905cc46880",
    block: "536f7fe17d3a2166",
  },
  {
    latex: String.raw`\mathcal{ABCLOXYZ}`,
    alphabets: ["calligraphic"],
    inline: "29f292f2ec014a8e",
    block: "36293f1924b3d94a",
  },
  {
    latex: String.raw`\mathbfscr{L}+\mathbfcal{L}+\mathbffrak{g}`,
    alphabets: ["calligraphic", "fraktur", "script"],
    inline: "0f153325691fdf43",
    block: "e0533cb621751554",
  },
  {
    latex: "ℝ+ℂ+ℕ+𝔤+𝒜+𝚊+𝖠+ℒ+ℱ+𝕜",
    alphabets: ["double-struck", "fraktur", "monospace", "script"],
    inline: "2e5d6116032ed287",
    block: "557db23129c06bcd",
  },
  {
    latex: String.raw`\mathrm{ABC}+\mathit{ABC}+\mathbf{ABC}+\mathbb{R}+\mathcal{L}+\mathscr{L}+\mathfrak{g}+\mathtt{A}`,
    alphabets: [
      "calligraphic",
      "double-struck",
      "fraktur",
      "monospace",
      "script",
    ],
    inline: "1fa6d6dd39845d54",
    block: "9b9ef8bd96df7110",
  },
];

describe("lazy formula glyph files", () => {
  it("typesets a formula without extra alphabets without loading any", async () => {
    const { typesetter, loaded } = recordingTypesetter();
    for (const [latex, style, digest] of [
      [String.raw`I_{D1}+I_{D2}=I_{SS}`, {}, "692fc57302afe3da"],
      [
        String.raw`\mathsf{ABC}+\mathsf{xyz}+\mathsf{012}`,
        {},
        "88d04d6be84dc11a",
      ],
      [String.raw`\text{gain}+\textbf{x}+\textit{y}`, {}, "85b17ff7034d7ce6"],
    ] as const) {
      const result = await typesetter.typeset({
        ...baseRequest,
        ...style,
        latex,
      });
      expect(resultDigest(result), latex).toBe(digest);
    }
    expect(loaded).toEqual([]);
  });

  it.each(alphabetCases)(
    "loads only the alphabets $latex uses and renders it unchanged",
    async ({ latex, alphabets, inline, block }) => {
      const { typesetter, loaded } = recordingTypesetter();
      const inlineResult = await typesetter.typeset({ ...baseRequest, latex });
      const blockResult = await typesetter.typeset({
        ...baseRequest,
        latex,
        display: "block",
        bold: false,
        italic: true,
      });
      expect(resultDigest(inlineResult)).toBe(inline);
      expect(resultDigest(blockResult)).toBe(block);
      expect([...loaded].sort()).toEqual(alphabets);
    },
  );

  it("never renders a missing glyph while another formula's alphabet is loading", async () => {
    // Started together, the first conversion begins the calligraphic load and
    // MathJax drops the placeholder of calligraphic L; the others must wait
    // for that load rather than draw L from another alphabet.
    const typesetter = createFormulaTypesetter();
    const results = await Promise.all(
      [
        String.raw`\mathcal{L}+\mathbb{R}`,
        String.raw`\mathcal{L}`,
        String.raw`\mathcal{L}_x`,
      ].map((latex) => typesetter.typeset({ ...baseRequest, latex })),
    );
    expect(results.map(resultDigest)).toEqual([
      "d3bc12b8192d52c6",
      "c0ac47fcf70a8d68",
      "8f7424dd02cd451e",
    ]);
  });

  it("prepares a batch of formulas sharing an alphabet with the eager glyphs", async () => {
    clearFormulaArtifactCacheForTests();
    const results = await Promise.all(
      [
        String.raw`\mathcal{L}+\mathbb{R}`,
        String.raw`\mathcal{L}`,
        String.raw`\mathcal{L}_x`,
      ].map((latex) => prepareFormula({ ...baseRequest, latex })),
    );
    expect(results.map(resultDigest)).toEqual([
      "d3bc12b8192d52c6",
      "c0ac47fcf70a8d68",
      "8f7424dd02cd451e",
    ]);
  });

  it("reports a glyph file that fails to load, without failing other formulas, and loads it on the next request", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let attempts = 0;
      const typesetter = createFormulaTypesetter({
        loadFontFile(file) {
          attempts += 1;
          return attempts === 1
            ? Promise.reject(new Error("Network unavailable."))
            : loadFormulaFontFile(file);
        },
      });
      const request = { ...baseRequest, latex: String.raw`\Bbb{R}` };
      const [failed, unrelated] = await Promise.all([
        typesetter.typeset(request),
        typesetter.typeset({ ...baseRequest, latex: "x+y" }),
      ]);
      expect(failed).toMatchObject({
        ok: false,
        diagnostic: { code: "FORMULA_FONT_UNAVAILABLE" },
      });
      expect(unrelated).toMatchObject({ ok: true });
      expect(resultDigest(await typesetter.typeset(request))).toBe(
        "bf8922905cc46880",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it.each([
    [String.raw`a\lll b\ggg c`, ["math"], "45f8a58b16935c93"],
    [String.raw`\bigstar`, ["shapes"], "fbace4097f3225fc"],
    [
      String.raw`\longmapsto\circlearrowleft\leftrightarrows\rightsquigarrow`,
      ["arrows"],
      "89e54fe116f53366",
    ],
    [String.raw`x\perp y\triangleq z`, ["math"], "e3fbd92644a2ec53"],
    [String.raw`\flat\sharp\natural`, ["shapes"], "55595ad8e98fcfcb"],
  ] as const)(
    "loads the glyph files %s needs on first use",
    async (latex, files, digest) => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const { typesetter, loaded } = recordingTypesetter();
        const result = await typesetter.typeset({ ...baseRequest, latex });
        expect(resultDigest(result)).toBe(digest);
        expect([...loaded].sort()).toEqual(files);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it.each([String.raw`\digamma`, String.raw`\yen`, "é+‰"])(
    "refuses %s, whose glyph file formulas leave out, the same way every time",
    async (latex) => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const typesetter = createFormulaTypesetter();
        const refusal = await typesetter.typeset({ ...baseRequest, latex });
        expect(refusal).toMatchObject({
          ok: false,
          diagnostic: { code: "FORMULA_RENDER_ERROR" },
        });
        expect(await typesetter.typeset({ ...baseRequest, latex })).toEqual(
          refusal,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );
});
