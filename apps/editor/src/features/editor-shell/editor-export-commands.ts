import {
  createBrowserFormalExportSource,
  safeExportBaseName,
} from "@icm/exporters";
import {
  createDesignNetlistExport,
  unfinishedDrawingDiagnostics,
} from "@icm/netlist";
import type {
  NetlistFormat,
  NetlistNamingProfile,
  NetlistPortCase,
} from "@icm/netlist";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { prepareDocumentFormulaArtifacts } from "../text-editing/formula-artifacts";
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
  portCase,
  electricalWarningsPresent = false,
  rootDocumentId,
}: {
  format: NetlistFormat;
  project: CircuitProject;
  namingProfile?: NetlistNamingProfile;
  portCase?: NetlistPortCase;
  electricalWarningsPresent?: boolean;
  rootDocumentId?: string;
}): DesignNetlistExportPlan {
  const result = createDesignNetlistExport(project, {
    format,
    namingProfile,
    ...(rootDocumentId ? { rootDocumentId } : {}),
    ...(portCase ? { portCase } : {}),
  });
  if (result.status === "blocked") {
    return {
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    };
  }
  // A node only one pin reaches is not a complete circuit, so this netlist is
  // not something to hand out even after strict extraction succeeds.
  const unfinished = unfinishedDrawingDiagnostics(result.diagnostics);
  if (unfinished.length > 0) {
    return {
      status: "blocked",
      message:
        unfinished.length === 1
          ? unfinished[0]!.message
          : `${unfinished.length} dead-end nodes. ${unfinished[0]!.message}`,
    };
  }
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

/** Deliver a prepared artifact through the browser download surface. */
export function requestBrowserDownload(
  artifact: EditorExportArtifact,
  baseName: string,
): void {
  const url = URL.createObjectURL(
    new Blob([artifact.bytes], { type: artifact.mediaType }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeExportBaseName(baseName)}.${artifact.extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
