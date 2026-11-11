import type { RnlSnapshot, RnlWriteRequest } from "@icm/rnl";
import type { Written } from "@rich-netlist/runtime";

import { importChunk } from "../../components/chunk-import";
import { withCanvasPackage, type RnlWorkspace } from "./rnl-core";
import {
  canvasPackageFile,
  canvasPackageLock,
  decodeCanvasPackage,
} from "./rnl-canvas-package";

type RuntimeDiagnostic = Written["document"]["diagnostics"][number];

/**
 * What the editor reads of the runtime's written file: its text, and the
 * findings of the Document it builds from it (rnl standard, ch. 7).
 */
export interface RnlWritten {
  text: Written["text"];
  document: {
    diagnostics: readonly Pick<RuntimeDiagnostic, "severity" | "message">[];
  };
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
   * drawing its RNL makes of it
   * (https://github.com/rich-netlist/rnl/blob/main/crates/rnl-view/README.md#snapshots).
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

/** The Canvas package assets the editor ships, by file name beside this module. */
const packageUrls = import.meta.glob<string>(
  "./analog-canvas-extensions-*.rnl",
  { query: "?url", import: "default" },
);

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
            const asset = packageUrls[`./${canvasPackageFile(version)}`];
            if (!asset)
              throw new Error(`Canvas package ${version} is not shipped`);
            return { version, url: await asset() };
          }),
        ),
      ]),
    );
    const packages = await Promise.all(
      urls.map(({ version, url }) => loadCanvasPackage(version, url)),
    );
    const core = withCanvasPackage(startCore(), packages);
    return {
      write: (request) => core.write(request),
      snapshot: (request) => core.snapshot(request),
    } satisfies RnlRuntime;
  })().catch((error: unknown) => {
    started = null;
    throw error;
  });
  return started;
}
