import type { CircuitProject } from "@icm/model";
import { formatProjectCode, validateProjectCode } from "./project-code";

type Validation = { ok: true } | { ok: false; message: string };
let committed = new WeakMap<
  CircuitProject,
  { source: string; validation: Validation }
>();

/** UI-only reader. Mutable commit plans continue through the uncached parser. */
export function createProjectCodeReader(project: CircuitProject) {
  function validate(source: string): Validation {
    const result = validateProjectCode(source, project.id);
    // Never share the parsed mutable Project with the commit planner.
    return result.ok ? { ok: true } : result;
  }
  let baseline = committed.get(project);
  if (!baseline) {
    const source = formatProjectCode(project);
    baseline = { source, validation: validate(source) };
    // Share the latest owner across panel remounts, not every version held by
    // Undo history. Each live reader independently keeps only its own draft.
    committed = new WeakMap([[project, baseline]]);
  }
  const preparedBaseline = baseline;
  let current = preparedBaseline;
  return {
    baseline: preparedBaseline.source,
    validate(source: string): Validation {
      if (source === preparedBaseline.source)
        return preparedBaseline.validation;
      if (source !== current.source)
        current = { source, validation: validate(source) };
      return current.validation;
    },
  };
}
