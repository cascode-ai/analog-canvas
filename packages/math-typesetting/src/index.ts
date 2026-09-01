import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import {
  CANONICAL_FORMULA_FONT_SIZE,
  formulaSourceHash,
  validateFormulaRequest,
} from "./cache.js";
import type {
  FormulaArtifact,
  FormulaRequest,
  FormulaTypesetResult,
} from "./cache.js";

export {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  FORMULA_MAX_LATEX_LENGTH,
  validateFormulaSource,
} from "./profile.js";
export {
  CANONICAL_FORMULA_FONT_SIZE,
  formulaSourceHash,
  validateFormulaRequest,
} from "./cache.js";
export type {
  FormulaArtifact,
  FormulaDiagnostic,
  FormulaDiagnosticCode,
  FormulaRequest,
  FormulaTypesetResult,
} from "./cache.js";
export type { FormulaProfileDiagnostic } from "./profile.js";

const SVG_START = /<svg\b/;
const DIMENSION_EX = /^(-?(?:\d+(?:\.\d+)?|\.\d+))ex$/;
const VERTICAL_ALIGN_EX = /vertical-align:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))ex/;

function findOuterSvgRange(
  markup: string,
): { start: number; end: number } | null {
  const tags = /<\/?svg\b[^>]*>/g;
  let depth = 0;
  let start = -1;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      if (start < 0 || depth === 0) return null;
      depth -= 1;
      if (depth === 0) return { start, end: tags.lastIndex };
      continue;
    }
    if (start < 0) start = match.index;
    if (!tag.endsWith("/>")) depth += 1;
  }
  return null;
}

function parseEx(value: string | null, fontSize: number): number | undefined {
  const match = value?.match(DIMENSION_EX);
  if (!match) return undefined;
  const ex = Number(match[1]);
  return Number.isFinite(ex) ? (ex * fontSize) / 2 : undefined;
}

function extractSvg(
  markup: string,
  request: FormulaRequest,
): Omit<FormulaArtifact, "sourceHash"> {
  const range = findOuterSvgRange(markup);
  if (!range || SVG_START.test(markup.slice(range.end))) {
    throw new Error(
      "Math renderer did not return one balanced standalone SVG element.",
    );
  }

  let svg = markup.slice(range.start, range.end);
  const openTag = svg.slice(0, svg.indexOf(">") + 1);
  const width = parseEx(
    openTag.match(/\bwidth="([^"]+)"/)?.[1] ?? null,
    CANONICAL_FORMULA_FONT_SIZE,
  );
  const height = parseEx(
    openTag.match(/\bheight="([^"]+)"/)?.[1] ?? null,
    CANONICAL_FORMULA_FONT_SIZE,
  );
  const verticalAlign = Number(openTag.match(VERTICAL_ALIGN_EX)?.[1] ?? "0");
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(verticalAlign) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Math renderer returned invalid formula metrics.");
  }

  svg = svg.replace(
    SVG_START,
    `<svg data-icm-formula="${formulaSourceHash(request)}"`,
  );
  const depth = Math.max(0, (-verticalAlign * CANONICAL_FORMULA_FONT_SIZE) / 2);
  return {
    svg,
    width,
    height,
    baseline: Math.max(0, Math.min(height, height - depth)),
  };
}

export interface FormulaTypesetter {
  typesetSync(request: FormulaRequest): FormulaTypesetResult;
  typeset(request: FormulaRequest): Promise<FormulaTypesetResult>;
}

export function createFormulaTypesetter(): FormulaTypesetter {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({
    packages: ["base", "ams", "cases", "configmacros"],
    macros: {
      differentialD: String.raw`\mathrm{d}`,
    },
  });
  // A Formula artifact is one self-contained SVG. MathJax 4 enables inline
  // line breaking by default and otherwise emits sibling SVG fragments around
  // operators (for example, `x` and `+y`). That shape cannot be embedded as a
  // single drafting object, so keep the expression on one MathJax line and let
  // the editor's formula source panel handle horizontal overflow.
  const output = new SVG({
    fontCache: "none",
    linebreaks: { inline: false },
  });
  const document = mathjax.document("", {
    InputJax: input,
    OutputJax: output,
  });
  return {
    typesetSync(request) {
      const diagnostic = validateFormulaRequest(request);
      if (diagnostic) return { ok: false, diagnostic };

      try {
        const node = document.convert(request.latex, {
          display: request.display === "block",
          em: CANONICAL_FORMULA_FONT_SIZE,
          ex: CANONICAL_FORMULA_FONT_SIZE / 2,
          containerWidth: 4096,
        });
        const markup = adaptor.outerHTML(node);
        if (markup.includes('data-mml-node="merror"')) {
          return {
            ok: false,
            diagnostic: {
              code: "FORMULA_PARSE_ERROR",
              message:
                adaptor.textContent(node).trim() || "Invalid formula source.",
            },
          };
        }
        const artifact = extractSvg(markup, request);
        return {
          ok: true,
          artifact: {
            ...artifact,
            sourceHash: formulaSourceHash(request),
          },
        };
      } catch (error) {
        return {
          ok: false,
          diagnostic: {
            code: "FORMULA_RENDER_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async typeset(request) {
      return this.typesetSync(request);
    },
  };
}

const defaultFormulaTypesetter = createFormulaTypesetter();

/** Synchronous boundary used by the deterministic schematic render pipeline. */
export function typesetFormulaSync(
  request: FormulaRequest,
): FormulaTypesetResult {
  return defaultFormulaTypesetter.typesetSync(request);
}
