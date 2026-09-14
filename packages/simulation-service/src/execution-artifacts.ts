import type { ExecutionOutput } from "./executor.js";

/** Paths remain run-local; prefixes separate evidence from service-owned names. */
export function executionArtifactEntries(output: ExecutionOutput) {
  return [
    ...(output.rawfiles ?? []).map((file) => ({
      kind: "raw" as const,
      path: file.path,
      name: `raw/${file.path}`,
      text: file.text,
    })),
    ...(output.executedFiles ?? []).map((file) => ({
      kind: "executed" as const,
      path: file.path,
      name: `executed/${file.path}`,
      text: file.text,
    })),
  ];
}
