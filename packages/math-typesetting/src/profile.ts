export const ANALOG_CANVAS_MATH_PROFILE_ID = "analog-canvas-math-v1" as const;

export type FormulaProfileDiagnostic =
  | { code: "FORMULA_INVALID_REQUEST"; message: string }
  | {
      code: "FORMULA_DISALLOWED_COMMAND";
      message: string;
      command: string;
    };

export const FORMULA_MAX_LATEX_LENGTH = 2048;

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

export function validateFormulaSource(
  latex: string,
): FormulaProfileDiagnostic | undefined {
  if (latex.trim().length === 0 || latex.length > FORMULA_MAX_LATEX_LENGTH) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: `Formula source must contain 1-${FORMULA_MAX_LATEX_LENGTH} characters.`,
    };
  }
  for (const match of latex.matchAll(/\\([A-Za-z]+)\b/g)) {
    const command = match[1];
    if (command && DISALLOWED_COMMANDS.has(command)) {
      return {
        code: "FORMULA_DISALLOWED_COMMAND",
        message: `The \\${command} command is not available in the Analog Canvas formula profile.`,
        command,
      };
    }
  }
  let braceDepth = 0;
  for (let index = 0; index < latex.length; index += 1) {
    const character = latex[index];
    const escaped = index > 0 && latex[index - 1] === "\\";
    if (escaped) continue;
    if (character === "{") braceDepth += 1;
    if (character === "}") braceDepth -= 1;
    if (braceDepth < 0) break;
  }
  if (braceDepth !== 0) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: "Formula source has unbalanced braces.",
    };
  }

  const environments: string[] = [];
  for (const match of latex.matchAll(/\\(begin|end)\{([^{}]+)\}/g)) {
    const action = match[1];
    const environment = match[2]!;
    if (action === "begin") environments.push(environment);
    else if (environments.pop() !== environment) {
      return {
        code: "FORMULA_INVALID_REQUEST",
        message: `Formula environment ${environment} is not properly nested.`,
      };
    }
  }
  if (environments.length > 0) {
    return {
      code: "FORMULA_INVALID_REQUEST",
      message: `Formula environment ${environments.at(-1)} is not closed.`,
    };
  }
  return undefined;
}
