import { createBrowserFormalExportSource } from "@icm/exporters";
import {
  createDesignNetlistExport,
  unfinishedDrawingDiagnostics,
} from "@icm/netlist";
import type {
  NetlistDiagnostic,
  NetlistFormat,
  NetlistNamingProfile,
} from "@icm/netlist";
import { createRnlExport } from "@icm/rnl";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { prepareDocumentFormulaArtifacts } from "../text-editing/formula-artifacts";
import { netlistMode, netlistModeLabel } from "../netlist-export/netlist-mode";
import type { RnlRuntime } from "../netlist-export/rnl-runtime";
import {
  ChunkLoadError,
  chunkLoadStatus,
  importChunk,
} from "../../components/chunk-import";

export interface EditorExportArtifact {
  bytes: BlobPart;
  mediaType: string;
  extension: string;
  report: string;
}

async function preparedFormalExportSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
) {
  const prepared = await prepareDocumentFormulaArtifacts(document);
  try {
    return await createBrowserFormalExportSource(document, resolver, {
      title: projectName,
    });
  } finally {
    prepared.release();
  }
}

export type DesignNetlistExportPlan =
  | { status: "blocked"; message: string }
  | { status: "ready"; artifact: EditorExportArtifact };

export async function createSvgExportArtifact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
): Promise<EditorExportArtifact> {
  const source = await preparedFormalExportSource(
    document,
    resolver,
    projectName,
  );
  return {
    bytes: source.svg,
    mediaType: "image/svg+xml",
    extension: "svg",
    report: `Exported revision ${document.revision}`,
  };
}

export function planDesignNetlistExport({
  format,
  project,
  namingProfile = "native",
  electricalWarningsPresent = false,
  rootDocumentId,
}: {
  format: NetlistFormat;
  project: CircuitProject;
  namingProfile?: NetlistNamingProfile;
  electricalWarningsPresent?: boolean;
  rootDocumentId?: string;
}): DesignNetlistExportPlan {
  const result = createDesignNetlistExport(project, {
    format,
    namingProfile,
    ...(rootDocumentId ? { rootDocumentId } : {}),
  });
  if (result.status === "blocked") {
    return {
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    };
  }
  const unfinished = unfinishedMessage(result.diagnostics);
  if (unfinished) return { status: "blocked", message: unfinished };
  const printed = result.file;
  const note =
    result.diagnostics.length || electricalWarningsPresent
      ? "; see Check Report for findings"
      : "";
  return {
    status: "ready",
    artifact: {
      bytes: printed.text,
      mediaType: printed.mediaType,
      extension: printed.extension.slice(1),
      report: `${format === "spice" ? "SPICE" : "Spectre"} netlist copied${note}`,
    },
  };
}

/**
 * A node only one pin reaches is not a complete circuit, so a netlist that
 * has one is not something to hand out even after strict extraction succeeds.
 */
function unfinishedMessage(
  diagnostics: readonly NetlistDiagnostic[],
): string | null {
  const unfinished = unfinishedDrawingDiagnostics([...diagnostics]);
  const [first] = unfinished;
  if (!first) return null;
  return unfinished.length === 1
    ? first.message
    : `${unfinished.length} dead-end nodes. ${first.message}`;
}

/**
 * The SPICE+RNL or Spectre+RNL netlist: that dialect's netlist with the
 * drawing written in by the rnl runtime. It blocks where the plain netlist
 * does, on an RNL error, and when the runtime is missing or refuses the file.
 */
export async function planRnlNetlistExport({
  format,
  project,
  namingProfile = "native",
  electricalWarningsPresent = false,
  rootDocumentId,
  runtime,
}: {
  format: NetlistFormat;
  project: CircuitProject;
  namingProfile?: NetlistNamingProfile;
  electricalWarningsPresent?: boolean;
  rootDocumentId?: string;
  runtime: Pick<RnlRuntime, "write"> | null;
}): Promise<DesignNetlistExportPlan> {
  const exported = createRnlExport(project, {
    format,
    namingProfile,
    ...(rootDocumentId ? { rootDocumentId } : {}),
  });
  if (exported.status === "blocked") {
    const error = exported.diagnostics.find(
      (item) => item.severity === "error",
    );
    return {
      status: "blocked",
      message: error
        ? error.message
        : "Resolve the Check Report findings before export",
    };
  }
  const unfinished = unfinishedMessage(exported.netlistDiagnostics);
  if (unfinished) return { status: "blocked", message: unfinished };
  if (!runtime)
    return {
      status: "blocked",
      message: "RNL formats need the rnl runtime, which this build lacks",
    };
  const written = await runtime.write({
    write: exported.request,
    svg: false,
    primitives: false,
  });
  const error = written.document.diagnostics.find(
    (item) => item.severity === "error",
  );
  if (error) return { status: "blocked", message: `RNL: ${error.message}` };
  const notes = [
    exported.netlistDiagnostics.length || electricalWarningsPresent
      ? "see Check Report for findings"
      : null,
    exported.diagnostics.length ? "RNL warnings in the Netlist panel" : null,
  ].filter(Boolean);
  return {
    status: "ready",
    artifact: {
      bytes: written.text,
      mediaType: exported.file.mediaType,
      extension: exported.file.extension.slice(1),
      report: `${netlistModeLabel(netlistMode(format, true))} netlist copied${
        notes.length ? `; ${notes.join("; ")}` : ""
      }`,
    },
  };
}

export async function createVisualExportArtifact(
  format: "png" | "pdf",
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
): Promise<EditorExportArtifact> {
  const source = await preparedFormalExportSource(
    document,
    resolver,
    projectName,
  );
  if (format === "png") {
    const { rasterizeFormalSvgInBrowser } = await importChunk(
      "PNG export",
      () => import("@icm/exporters/browser-raster"),
    );
    const png = await rasterizeFormalSvgInBrowser(source);
    return {
      bytes: png.bytes as BlobPart,
      mediaType: png.mediaType,
      extension: "png",
      report: `Exported PNG revision ${document.revision}`,
    };
  }
  const { vectorizeFormalSvgInBrowser } = await importChunk(
    "PDF export",
    () => import("@icm/exporters/browser-pdf"),
  );
  const pdf = await vectorizeFormalSvgInBrowser(source);
  return {
    bytes: pdf as BlobPart,
    mediaType: "application/pdf",
    extension: "pdf",
    report: `Exported PDF revision ${document.revision}`,
  };
}

/**
 * User-facing account of a failed export. A vanished on-demand chunk gets
 * the refresh remedy and names the feature so the App can raise the banner;
 * anything else keeps its own message.
 */
export function describeExportFailure(error: unknown): {
  status: string;
  chunkFeature?: string;
} {
  if (error instanceof ChunkLoadError) {
    return {
      status: chunkLoadStatus(error.feature),
      chunkFeature: error.feature,
    };
  }
  return {
    status: error instanceof Error ? error.message : "Export failed",
  };
}
