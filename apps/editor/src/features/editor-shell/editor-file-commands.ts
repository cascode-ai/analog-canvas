import { convertImportSources } from "../netlist-export/convert-import-sources";
import type { NetlistFormat, NetlistNamingProfile } from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";
import { safeExportBaseName } from "@icm/exporters";
import type { EditorExportDelivery } from "../../hosts/export-delivery";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";

import {
  createVisualExportArtifact,
  createSvgExportArtifact,
  describeExportFailure,
  planDesignNetlistExport,
  type EditorExportArtifact,
} from "./editor-export-commands";

type SpiceImportResult = Awaited<ReturnType<typeof importSpiceSources>>;
export interface SpiceImportReport {
  entryPath: string;
  diagnostics: SpiceImportResult["diagnostics"];
}

export interface EditorFileCommandDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  defaultViewBox: GridRect;
  exportDelivery: EditorExportDelivery;
  electricalWarningsPresent: () => boolean;
  netlistRootDocumentId?: string | undefined;
  netlistConfigurationError?: string | null;
  guardDirtyReplacement: (
    label: string,
    replace: () => void | Promise<void>,
  ) => Promise<void>;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox: GridRect,
    options: { source: "spice-import" },
  ) => void;
  showNetlist: (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile,
  ) => void;
  setImportReport: (report: SpiceImportReport | null) => void;
  setImportReviewOpen: (open: boolean) => void;
  setSelectionOpen: (open: boolean) => void;
  setStatus: (status: string) => void;
  /** Raise the refresh banner when an on-demand chunk has gone missing. */
  onChunkLoadFailure?: (feature: string) => void;
}

/** File import/export commands and their user-facing gate/status policy. */
export function createEditorFileCommands({
  project,
  document,
  resolver,
  defaultViewBox,
  exportDelivery,
  electricalWarningsPresent,
  netlistRootDocumentId,
  netlistConfigurationError,
  guardDirtyReplacement,
  replaceActiveProject,
  showNetlist,
  setImportReport,
  setImportReviewOpen,
  setSelectionOpen,
  setStatus,
  onChunkLoadFailure,
}: EditorFileCommandDependencies) {
  const deliverArtifact = async (artifact: EditorExportArtifact) => {
    const result = await exportDelivery.deliverFile({
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      suggestedName: `${safeExportBaseName(project.name)}.${artifact.extension}`,
    });
    setStatus(
      result.status === "cancelled" ? "Export cancelled" : artifact.report,
    );
  };

  const exportSvg = async (): Promise<void> => {
    setStatus("Preparing SVG export");
    try {
      const artifact = await createSvgExportArtifact(
        document,
        resolver,
        project.name,
      );
      await deliverArtifact(artifact);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  };

  const exportDesignNetlist = async (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile = "native",
  ): Promise<void> => {
    showNetlist(format, namingProfile);
    if (netlistConfigurationError) {
      setStatus(`Fix Netlist configuration: ${netlistConfigurationError}`);
      return;
    }
    const plan = planDesignNetlistExport({
      format,
      project,
      namingProfile,
      ...(netlistRootDocumentId
        ? { rootDocumentId: netlistRootDocumentId }
        : {}),
      electricalWarningsPresent: electricalWarningsPresent(),
    });
    if (plan.status === "blocked") {
      setStatus(plan.message);
      return;
    }
    try {
      await exportDelivery.copyText(String(plan.artifact.bytes));
      setStatus(plan.artifact.report);
    } catch {
      setStatus(
        "Clipboard unavailable; select the netlist in the sidebar and copy it",
      );
    }
  };

  const exportRaster = async (format: "png" | "pdf"): Promise<void> => {
    setStatus(`Preparing ${format.toUpperCase()} export`);
    try {
      const artifact = await createVisualExportArtifact(
        format,
        document,
        resolver,
        project.name,
      );
      await deliverArtifact(artifact);
    } catch (error) {
      const failure = describeExportFailure(error);
      setStatus(failure.status);
      if (failure.chunkFeature) onChunkLoadFailure?.(failure.chunkFeature);
    }
  };

  const importSpiceFiles = async (
    files: FileList | null,
    namingProfile: "native" | "cadence-bang" = "native",
  ): Promise<void> => {
    if (!files || files.length === 0) return;
    const sourceInputs = await Promise.all(
      [...files].map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const conventionalEntries = sourceInputs.filter((input) =>
      /\.(?:cir|sp|spi|scs)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter((input) =>
      /^circuit\.(?:spi|scs)$/iu.test(input.path.split("/").at(-1) ?? ""),
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      setStatus(
        `Select one unambiguous .cir, .sp, .spi, or .scs entry and its local include files; found ${entryCandidates.length}`,
      );
      return;
    }
    setStatus("Importing SPICE sources");
    try {
      const result = await importSpiceSources(
        convertImportSources(sourceInputs),
        entryCandidates[0]!.path,
        {},
        { namingProfile, originalSources: sourceInputs },
      );
      const nextImportReport: SpiceImportReport = {
        entryPath: entryCandidates[0]!.path,
        diagnostics: result.diagnostics,
      };
      if (!result.project || !result.successful) {
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        const firstError = result.diagnostics.find(
          (item) => item.severity === "error",
        );
        setStatus(firstError?.message ?? "SPICE import failed");
        return;
      }
      const importedProject = withImportedInstanceDisplays(result.project);
      const instanceCount = importedProject.documents.reduce(
        (count, candidate) => count + candidate.instances.length,
        0,
      );
      await guardDirtyReplacement("Import SPICE sources", () => {
        replaceActiveProject(importedProject, defaultViewBox, {
          source: "spice-import",
        });
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        setStatus(
          `Imported ${importedProject.documents.length} Documents and ${instanceCount} structural instances`,
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  };

  return {
    exportSvg,
    exportDesignNetlist,
    exportRaster,
    importSpiceFiles,
  };
}
