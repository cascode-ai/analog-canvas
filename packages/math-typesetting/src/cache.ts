import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  validateFormulaSource,
} from "./profile.js";
export { ANALOG_CANVAS_MATH_PROFILE_ID } from "./profile.js";

export const CANONICAL_FORMULA_FONT_SIZE = 100;

export interface FormulaRequest {
  latex: string;
  display: "inline" | "block";
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

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function formulaSourceHash(request: FormulaRequest): string {
  const source = [request.profileId, request.display, request.latex].join(
    "\u0000",
  );
  return `${fnv1a32(source, 0x811c9dc5)}${fnv1a32(source, 0x9e3779b9)}`;
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
  return validateFormulaSource(request.latex);
}

const artifacts = new Map<string, FormulaTypesetResult>();
const pending = new Map<string, Promise<FormulaTypesetResult>>();

export function cachedFormulaResult(
  request: FormulaRequest,
): FormulaTypesetResult | undefined {
  return artifacts.get(formulaSourceHash(request));
}

export async function prepareFormula(
  request: FormulaRequest,
): Promise<FormulaTypesetResult> {
  const key = formulaSourceHash(request);
  const cached = artifacts.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;

  const task = import("./index.js")
    .then(({ typesetFormulaSync }) => typesetFormulaSync(request))
    .then((result) => {
      artifacts.set(key, result);
      pending.delete(key);
      return result;
    });
  pending.set(key, task);
  return task;
}

export function clearFormulaArtifactCacheForTests(): void {
  artifacts.clear();
  pending.clear();
}
