import type { AgentNetlistRead } from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";
import { createRnlExport } from "@icm/rnl";
import { loadCore, type Core } from "@rich-netlist/runtime/core";
import type { CoreWorker } from "@rich-netlist/runtime";

import {
  canvasPackageLock,
  decodeCanvasPackage,
} from "../features/netlist-export/rnl-canvas-package";
import { withCanvasPackage } from "../features/netlist-export/rnl-core";
import {
  blockedRnl,
  failedRnl,
  writtenRnl,
  type ReadRnlOptions,
} from "../features/netlist-export/rnl-read";
import { loadHeadlessRnlCoreWasm, loadHeadlessRnlPackage } from "./rnl-assets";

/** The in-thread core behind the Worker-shaped interface the package wrapper takes. */
function workerOf(core: Core): CoreWorker {
  return {
    build: async (request) => core.build(request),
    snapshot: async (request) => core.snapshot(request),
    write: async (request) => core.write(request),
    replaceRecords: async (request) => core.replaceRecords(request),
    catalog: async (request) => core.catalog(request),
    drawings: async (request) => core.drawings(request),
    library: async (request) => core.library(request),
    formats: async (request) => core.formats(request),
    terminate: () => {},
  };
}

let started: Promise<CoreWorker> | null = null;

/**
 * The RNL runtime in this process, with the Canvas package the editor ships.
 * A headless workspace has no Worker and no page to fetch assets from, so the
 * core's WebAssembly and the package bytes come from the bundle (or the
 * checkout, when this module runs from source).
 */
function rnlCore(): Promise<CoreWorker> {
  started ??= (async () => {
    const core = await loadCore(await loadHeadlessRnlCoreWasm());
    const packages = await Promise.all(
      canvasPackageLock.versions.map(async ({ version }) => ({
        version,
        text: await decodeCanvasPackage(
          await loadHeadlessRnlPackage(version),
          version,
        ),
      })),
    );
    return withCanvasPackage(workerOf(core), packages);
  })().catch((error: unknown) => {
    started = null;
    throw error;
  });
  return started;
}

/** The Project's netlist with its drawing written as RNL, in this process. */
export async function readRnlHeadless(
  project: CircuitProject,
  options: ReadRnlOptions,
): Promise<AgentNetlistRead> {
  const format = options.format ?? "spice";
  const documentId = options.rootDocumentId ?? project.topDocumentId;
  const exported = createRnlExport(project, {
    format,
    ...(options.namingProfile ? { namingProfile: options.namingProfile } : {}),
    ...(options.rootDocumentId
      ? { rootDocumentId: options.rootDocumentId }
      : {}),
  });
  if (exported.status !== "ready")
    return { ...blockedRnl(format, exported), documentId };
  try {
    const written = await (
      await rnlCore()
    ).write({
      write: exported.request,
      svg: false,
      primitives: false,
    });
    return { ...writtenRnl(format, exported, written), documentId };
  } catch (error) {
    return {
      ...failedRnl(
        format,
        "RNL_WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      ),
      documentId,
    };
  }
}

/** The callback a local editor registers as its `readRnl`. */
export function createHeadlessRnlRead() {
  return readRnlHeadless;
}
