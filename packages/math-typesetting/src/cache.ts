import { BoundedLruCache } from "./bounded-lru.js";
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

const FORMULA_ARTIFACT_CACHE_MAX_ENTRIES = 128;
const FORMULA_ARTIFACT_CACHE_MAX_BYTES = 16 * 1024 * 1024;

function formulaResultBytes(key: string, result: FormulaTypesetResult): number {
  const fixedObjectEstimate = 128;
  if (result.ok) {
    return (
      fixedObjectEstimate +
      2 *
        (key.length +
          result.artifact.sourceHash.length +
          result.artifact.svg.length)
    );
  }
  return (
    fixedObjectEstimate +
    2 *
      (key.length +
        result.diagnostic.message.length +
        (result.diagnostic.command?.length ?? 0))
  );
}

const artifacts = new BoundedLruCache<string, FormulaTypesetResult>({
  maxEntries: FORMULA_ARTIFACT_CACHE_MAX_ENTRIES,
  maxBytes: FORMULA_ARTIFACT_CACHE_MAX_BYTES,
  sizeOf: formulaResultBytes,
});
const pending = new Map<string, Promise<FormulaTypesetResult>>();
const retentionOwners = new Map<number, Set<string>>();
let retentionOwnerCounter = 0;

function synchronizeRetainedFormulaKeys(): void {
  artifacts.replaceProtectedKeys(
    [...retentionOwners.values()].flatMap((keys) => [...keys]),
  );
}

/** Protects one active render/export working set from background LRU eviction. */
export function retainFormulaArtifacts(
  requests: readonly FormulaRequest[],
): () => void {
  const owner = ++retentionOwnerCounter;
  retentionOwners.set(
    owner,
    new Set(requests.map((request) => formulaSourceHash(request))),
  );
  synchronizeRetainedFormulaKeys();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    retentionOwners.delete(owner);
    synchronizeRetainedFormulaKeys();
  };
}

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
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export function clearFormulaArtifactCacheForTests(): void {
  retentionOwners.clear();
  artifacts.clear();
  pending.clear();
}
