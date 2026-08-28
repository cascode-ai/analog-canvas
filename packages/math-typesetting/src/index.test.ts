import { describe, expect, it } from "vitest";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  createFormulaTypesetter,
  formulaSourceHash,
  type FormulaRequest,
} from "./index.js";

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
  String.raw`\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}`,
  String.raw`\begin{cases}V_{OH},&x>0\\V_{OL},&x\leq0\end{cases}`,
];

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
      expect(result.artifact.svg).not.toContain("<foreignObject");
      expect(result.artifact.svg).not.toContain("<image");
      expect(result.artifact.svg).not.toMatch(/(?:href|xlink:href)=/);
    }
  });

  it("produces deterministic markup, metrics, and source hashes", async () => {
    const first = await createFormulaTypesetter().typeset(baseRequest);
    const second = await createFormulaTypesetter().typeset(baseRequest);
    expect(first).toEqual(second);
    expect(formulaSourceHash(baseRequest)).toHaveLength(16);
  });

  it("serializes concurrent requests through one renderer", async () => {
    const typesetter = createFormulaTypesetter();
    const results = await Promise.all(
      corpus.map((latex) => typesetter.typeset({ ...baseRequest, latex })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("supports the synchronous formal-renderer boundary", () => {
    const typesetter = createFormulaTypesetter();
    for (const latex of corpus) {
      expect(typesetter.typesetSync({ ...baseRequest, latex })).toMatchObject({
        ok: true,
      });
    }
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
        message: "Formula source has unbalanced braces.",
      }),
    });
  });
});
