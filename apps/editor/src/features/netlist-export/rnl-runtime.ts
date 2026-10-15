import type { RnlWriteRequest } from "@icm/rnl";

/** A finding of the rnl runtime about the file it wrote (rnl standard, ch. 7). */
export interface RnlRuntimeDiagnostic {
  /** "error", "warning" or "hint". */
  severity: string;
  message: string;
}

/** The rnl runtime's written file, and the Document it builds from it. */
export interface RnlWritten {
  text: string;
  document: { diagnostics: readonly RnlRuntimeDiagnostic[] };
}

/**
 * The rnl runtime (rnl's bindings/runtime-wasm), running in a Worker: it
 * writes a drawing's operations into its netlist as RNL. The editor never
 * spells RNL itself.
 */
export interface RnlRuntime {
  write(request: {
    write: RnlWriteRequest;
    svg?: boolean;
    primitives?: boolean;
  }): Promise<RnlWritten>;
}

/**
 * The rnl runtime, started on first use. rnl's package is not linked into
 * this build yet, so there is none: the RNL formats say so instead of
 * writing.
 */
export function loadRnlRuntime(): Promise<RnlRuntime | null> {
  return Promise.resolve(null);
}
