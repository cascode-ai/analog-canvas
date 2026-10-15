import type { RnlSnapshot, RnlWriteRequest } from "@icm/rnl";

import { importChunk } from "../../components/chunk-import";

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
 * The rnl runtime (`@rich-netlist/runtime`), running in a Worker: it writes a
 * drawing's operations into its netlist as RNL. The editor never spells RNL
 * itself.
 */
export interface RnlRuntime {
  write(request: {
    write: RnlWriteRequest;
    svg?: boolean;
    primitives?: boolean;
  }): Promise<RnlWritten>;
  /**
   * How the runtime reads a rich netlist: each level's host circuit and the
   * drawing its RNL makes of it (rnl-dev `spec-draft.md`, 3).
   */
  snapshot(request: {
    entry: string;
    files: Record<string, string>;
    dialect: "spice" | "spectre";
    parts: { drawing: false; host: true; model: true };
  }): Promise<RnlSnapshot>;
}

let started: Promise<RnlRuntime | null> | null = null;

/**
 * The rnl runtime, loaded on first use: its module, Worker and WebAssembly
 * stay out of the editor until an RNL format asks for them, and one Worker
 * serves every request after. A failed load is tried again next time.
 */
export function loadRnlRuntime(): Promise<RnlRuntime | null> {
  started ??= importChunk(
    "RNL formats",
    () => import("@rich-netlist/runtime"),
  ).then(
    ({ startCore }) => {
      const core = startCore();
      return {
        // The Worker takes the request as JSON, where this editor's readonly
        // points and the runtime's point arrays are the same thing.
        write: (request) =>
          core.write(request as unknown as Parameters<typeof core.write>[0]),
        // The import reads the part of the snapshot it declares.
        snapshot: (request) =>
          core.snapshot(request) as unknown as Promise<RnlSnapshot>,
      } satisfies RnlRuntime;
    },
    (error: unknown) => {
      started = null;
      throw error;
    },
  );
  return started;
}
