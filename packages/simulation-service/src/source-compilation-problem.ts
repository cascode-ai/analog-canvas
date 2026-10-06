import type { ProjectSimulationFolder } from "@icm/model";
import type { SimulationSourceDiagnostic } from "@icm/netlist";

import type { Problem } from "./contract.js";
import { sha256 } from "./content-digest.js";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/**
 * Refuse a source that cannot be prepared, locating each diagnostic in its
 * authored file. Blocking errors come first, then warnings, then notes, each
 * group in source order: a client that prints only the first few must still
 * see why the run was refused, not a list of generated net names.
 */
export async function sourceCompilationProblem(
  diagnostics: readonly SimulationSourceDiagnostic[],
  folder: ProjectSimulationFolder,
): Promise<{ ok: false; error: Problem }> {
  const ordered = [...diagnostics].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
  );
  return {
    ok: false,
    error: {
      code: "SIMULATION_COMPILE_REFUSED",
      message: "Correct the located input and prepare again",
      stage: "prepare",
      recovery: "fix-input",
      diagnostics: await Promise.all(
        ordered.map(async (diagnostic) => {
          const file = folder.input.files.find(
            (file) =>
              file.path === (diagnostic.sourceRef?.fileId ?? diagnostic.path),
          );
          if (!file) return diagnostic;
          const start = diagnostic.sourceRef?.start;
          return {
            ...diagnostic,
            source: {
              scope: "authored" as const,
              path: file.path,
              textDigest: await sha256(file.text),
              startOffset: start?.offset ?? 0,
              endOffset: diagnostic.sourceRef?.end.offset ?? 0,
              line: start?.line ?? 1,
              column: start?.column ?? 1,
            },
          };
        }),
      ),
    },
  };
}
