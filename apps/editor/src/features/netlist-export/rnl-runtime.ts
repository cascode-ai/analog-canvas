import type { RnlSnapshot, RnlWriteRequest } from "@icm/rnl";

import { importChunk } from "../../components/chunk-import";
import { withCanvasPackage, type RnlWorkspace } from "./rnl-core";
import { canvasPackageLock, decodeCanvasPackage } from "./rnl-canvas-package";

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
  write(
    request: RnlWorkspace & {
      write: RnlWriteRequest;
      svg?: boolean;
      primitives?: boolean;
    },
  ): Promise<RnlWritten>;
  /**
   * How the runtime reads a rich netlist: each level's host circuit and the
   * drawing its RNL makes of it (rnl-dev `spec-draft.md`, 3).
   */
  snapshot(
    request: RnlWorkspace & {
      entry: string;
      files: Record<string, string>;
      dialect: "spice" | "spectre";
      parts: { drawing: false; host: true; model: true };
    },
  ): Promise<RnlSnapshot>;
}

/** Each locked Canvas package version's asset, by version. */
const packageUrls: Readonly<
  Record<string, () => Promise<{ default: string }>>
> = {
  "0.1": () => import("./analog-canvas-extensions-0.1.rnl?url"),
  "0.2": () => import("./analog-canvas-extensions-0.2.rnl?url"),
};

/** A locked Canvas package version, from the editor's own asset. */
async function loadCanvasPackage(version: string, url: string) {
  try {
    // A retry must replace bad cached bytes; the shell keeps an offline fallback.
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      version,
      text: await decodeCanvasPackage(
        new Uint8Array(await response.arrayBuffer()),
        version,
      ),
    };
  } catch (cause) {
    throw new Error(
      `RNL Canvas package could not load from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

let started: Promise<RnlRuntime | null> | null = null;

/**
 * The rnl runtime, loaded on first use: its module, Worker and WebAssembly
 * stay out of the editor until an RNL format asks for them, and one Worker
 * serves every request after. A failed load is tried again next time.
 */
export function loadRnlRuntime(): Promise<RnlRuntime | null> {
  started ??= (async () => {
    const [{ startCore }, urls] = await importChunk("RNL formats", () =>
      Promise.all([
        import("@rich-netlist/runtime"),
        Promise.all(
          canvasPackageLock.versions.map(async ({ version }) => {
            const asset = packageUrls[version];
            if (!asset)
              throw new Error(`Canvas package ${version} is not shipped`);
            return { version, url: (await asset()).default };
          }),
        ),
      ]),
    );
    const packages = await Promise.all(
      urls.map(({ version, url }) => loadCanvasPackage(version, url)),
    );
    const core = withCanvasPackage(startCore(), packages);
    return {
      // The Worker takes the request as JSON, where this editor's readonly
      // points and the runtime's point arrays are the same thing.
      write: (request) =>
        core.write(request as unknown as Parameters<typeof core.write>[0]),
      // The import reads the part of the snapshot it declares.
      snapshot: (request) =>
        core.snapshot(request) as unknown as Promise<RnlSnapshot>,
    } satisfies RnlRuntime;
  })().catch((error: unknown) => {
    started = null;
    throw error;
  });
  return started;
}
