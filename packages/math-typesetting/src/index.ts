import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/cases/CasesConfiguration.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";

export const ANALOG_CANVAS_MATH_PROFILE_ID = "analog-canvas-math-v1" as const;

export interface FormulaRequest {
  latex: string;
  display: "inline" | "block";
  fontSize: number;
  color: string;
  profileId: typeof ANALOG_CANVAS_MATH_PROFILE_ID;
}

export interface FormulaArtifact {
  svg: string;
  width: number;
  height: number;
  baseline: number;
  sourceHash: string;
}

export type FormulaDiagnosticCode =
  | "FORMULA_INVALID_REQUEST"
  | "FORMULA_DISALLOWED_COMMAND"
  | "FORMULA_PARSE_ERROR"
  | "FORMULA_RENDER_ERROR";

export interface FormulaDiagnostic {
  code: FormulaDiagnosticCode;
  message: string;
  command?: string;
}

export type FormulaTypesetResult =
  | { ok: true; artifact: FormulaArtifact }
  | { ok: false; diagnostic: FormulaDiagnostic };

const MAX_LATEX_LENGTH = 2048;
const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 512;

const DISALLOWED_COMMANDS = new Set([
  "class",
  "cssId",
  "def",
  "documentclass",
  "edef",
  "futurelet",
  "gdef",
  "href",
  "htmlClass",
  "htmlData",
  "htmlId",
  "htmlStyle",
  "include",
  "includegraphics",
  "input",
  "let",
  "newcommand",
  "newenvironment",
  "openin",
  "openout",
  "providecommand",
  "read",
  "renewcommand",
  "renewenvironment",
  "require",
  "style",
  "unicode",
  "url",
  "usepackage",
  "write",
  "xdef",
]);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SVG_START = /<svg\b/;
const DIMENSION_EX = /^(-?(?:\d+(?:\.\d+)?|\.\d+))ex$/;
const VERTICAL_ALIGN_EX = /vertical-align:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))ex/;

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function formulaSourceHash(request: FormulaRequest): string {
  const source = [
    request.profileId,
    request.display,
    request.fontSize.toString(),
    request.color.toLowerCase(),
    request.latex,
  ].join("\u0000");
  return `${fnv1a32(source, 0x811c9dc5)}${fnv1a32(source, 0x9e3779b9)}`;
}

function findDisallowedCommand(latex: string): string | undefined {
  for (const match of latex.matchAll(/\\([A-Za-z]+)\b/g)) {
    const command = match[1];
    if (command && DISALLOWED_COMMANDS.has(command)) {
      return command;
    }
  }
  return undefined;
}

export function validateFormulaRequest(
  request: FormulaRequest,
): FormulaDiagnostic | undefined {
  if (request.profileId !== ANALOG_CANVAS_MATH_PROFILE_ID) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: `Unsupported formula profile: ${request.profileId}`,
    };
  }
  if (
    request.latex.trim().length === 0 ||
    request.latex.length > MAX_LATEX_LENGTH
  ) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: `Formula source must contain 1-${MAX_LATEX_LENGTH} characters.`,
    };
  }
  if (
    !Number.isFinite(request.fontSize) ||
    request.fontSize < MIN_FONT_SIZE ||
    request.fontSize > MAX_FONT_SIZE
  ) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: `Formula font size must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`,
    };
  }
  if (!HEX_COLOR.test(request.color)) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: "Formula color must use six-digit hexadecimal notation.",
    };
  }

  const command = findDisallowedCommand(request.latex);
  if (command) {
    return {
      code: "FORMULA_DISALLOWED_COMMAND",
      message: `The \\${command} command is not available in the Analog Canvas formula profile.`,
      command,
    };
  }
  return undefined;
}

function parseEx(value: string | null, fontSize: number): number | undefined {
  const match = value?.match(DIMENSION_EX);
  if (!match) return undefined;
  const ex = Number(match[1]);
  return Number.isFinite(ex) ? (ex * fontSize) / 2 : undefined;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function extractSvg(
  markup: string,
  request: FormulaRequest,
): Omit<FormulaArtifact, "sourceHash"> {
  const start = markup.search(SVG_START);
  const end = markup.indexOf("</svg>", start);
  if (start < 0 || end < 0) {
    throw new Error("Math renderer did not return a standalone SVG element.");
  }

  let svg = markup.slice(start, end + "</svg>".length);
  const openTag = svg.slice(0, svg.indexOf(">") + 1);
  const width = parseEx(
    openTag.match(/\bwidth="([^"]+)"/)?.[1] ?? null,
    request.fontSize,
  );
  const height = parseEx(
    openTag.match(/\bheight="([^"]+)"/)?.[1] ?? null,
    request.fontSize,
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

  const color = escapeAttribute(request.color.toLowerCase());
  svg = svg.replace(
    SVG_START,
    `<svg data-icm-formula="${formulaSourceHash(request)}" color="${color}"`,
  );
  const depth = Math.max(0, (-verticalAlign * request.fontSize) / 2);
  return {
    svg,
    width,
    height,
    baseline: Math.max(0, Math.min(height, height - depth)),
  };
}

export interface FormulaTypesetter {
  typeset(request: FormulaRequest): Promise<FormulaTypesetResult>;
}

export function createFormulaTypesetter(): FormulaTypesetter {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({ packages: ["base", "ams", "cases"] });
  const output = new SVG({ fontCache: "none" });
  const document = mathjax.document("", {
    InputJax: input,
    OutputJax: output,
  });
  let queue = Promise.resolve();

  return {
    async typeset(request) {
      const diagnostic = validateFormulaRequest(request);
      if (diagnostic) return { ok: false, diagnostic };

      const render = async (): Promise<FormulaTypesetResult> => {
        try {
          const node = await mathjax.handleRetriesFor(() =>
            document.convert(request.latex, {
              display: request.display === "block",
              em: request.fontSize,
              ex: request.fontSize / 2,
              containerWidth: 4096,
            }),
          );
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
      };

      const pending = queue.then(render, render);
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
}
