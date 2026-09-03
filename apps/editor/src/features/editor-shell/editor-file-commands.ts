import { analyzeDesignNetlist } from "@icm/netlist";
import type { NetlistFormat, NetlistNamingProfile } from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";

import {
  createVisualExportArtifact,
  createSvgExportArtifact,
  describeExportFailure,
  planDesignNetlistExport,
  requestBrowserDownload,
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
  electricalWarningsPresent: () => boolean;
  guardDirtyReplacement: (
    label: string,
    replace: () => void | Promise<void>,
  ) => Promise<void>;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox: GridRect,
    options: { source: "spice-import" },
  ) => void;
  setNetlistPreflightOpen: (open: boolean) => void;
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
  electricalWarningsPresent,
  guardDirtyReplacement,
  replaceActiveProject,
  setNetlistPreflightOpen,
  setImportReport,
  setImportReviewOpen,
  setSelectionOpen,
  setStatus,
  onChunkLoadFailure,
}: EditorFileCommandDependencies) {
  const exportSvg = (): void => {
    setStatus("Preparing SVG export");
    void createSvgExportArtifact(document, resolver, project.name)
      .then((artifact) => {
        requestBrowserDownload(artifact, project.name);
        setStatus(artifact.report);
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Export failed");
      });
  };

  const exportDesignNetlist = (
    format: NetlistFormat,
    warningsReviewed = false,
    namingProfile: NetlistNamingProfile = "native",
  ): void => {
    const analysis = analyzeDesignNetlist(project, { format, namingProfile });
    const hasElectricalWarnings = electricalWarningsPresent();
    const plan = planDesignNetlistExport({
      format,
      ir: analysis.ir,
      warningsPresent: analysis.diagnostics.length > 0 || hasElectricalWarnings,
      warningsReviewed,
      projectName: project.name,
    });
    if (plan.status === "blocked") {
      setNetlistPreflightOpen(true);
      setStatus(plan.message);
      return;
    }
    requestBrowserDownload(plan.artifact, project.name);
    setStatus(plan.artifact.report);
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
      requestBrowserDownload(artifact, project.name);
      setStatus(artifact.report);
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
      /\.(?:cir|sp|spi)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter(
      (input) => input.path.split("/").at(-1)?.toLowerCase() === "circuit.spi",
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      setStatus(
        `Select one unambiguous .cir, .sp, or .spi entry and its local include files; found ${entryCandidates.length}`,
      );
      return;
    }
    setStatus("Importing SPICE sources");
    try {
      const result = await importSpiceSources(
        sourceInputs,
        entryCandidates[0]!.path,
        {},
        { namingProfile },
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
      const importedProject = result.project;
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
