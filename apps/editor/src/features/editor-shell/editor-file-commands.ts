import { prepareImportSources } from "../netlist-export/convert-import-sources";
import type { NetlistNamingProfile } from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";
import { safeExportBaseName } from "@icm/exporters";
import type { EditorExportDelivery } from "../../hosts/export-delivery";

import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import {
  netlistModeParts,
  type NetlistMode,
} from "../netlist-export/netlist-mode";
import { planRnlImport } from "../netlist-export/rnl-import";
import { loadRnlRuntime } from "../netlist-export/rnl-runtime";

import {
  createVisualExportArtifact,
  createSvgExportArtifact,
  describeExportFailure,
  planDesignNetlistExport,
  planRnlNetlistExport,
  type DesignNetlistExportPlan,
  type EditorExportArtifact,
} from "./editor-export-commands";

const CLIPBOARD_FALLBACK =
  "Clipboard unavailable; select the netlist in the sidebar and copy it";

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
  showNetlist: (mode: NetlistMode, namingProfile: NetlistNamingProfile) => void;
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

  /** The status when the rnl runtime fails to load or to write. */
  const rnlFailure = (error: unknown) =>
    error instanceof Error
      ? `RNL: ${error.message}`
      : "The rnl runtime could not write this netlist";

  /**
   * Copies an RNL netlist. The copy starts now and takes the text once the
   * runtime's Worker has written it: Safari refuses a clipboard write that
   * starts after that wait.
   */
  const copyRnlNetlist = async (
    options: Omit<Parameters<typeof planRnlNetlistExport>[0], "runtime">,
  ): Promise<void> => {
    const planned: Promise<DesignNetlistExportPlan> = loadRnlRuntime()
      .then((runtime) => planRnlNetlistExport({ ...options, runtime }))
      .catch((error: unknown) => ({
        status: "blocked",
        message: rnlFailure(error),
      }));
    const text = planned.then((plan) =>
      plan.status === "ready"
        ? String(plan.artifact.bytes)
        : Promise.reject(new Error(plan.message)),
    );
    // A blocked plan fails the copy too; the plan says why, below.
    text.catch(() => {});
    const copied = exportDelivery.copyText(text).then(
      () => true,
      () => false,
    );
    const plan = await planned;
    if (plan.status === "blocked") setStatus(plan.message);
    else setStatus((await copied) ? plan.artifact.report : CLIPBOARD_FALLBACK);
  };

  const exportDesignNetlist = async (
    mode: NetlistMode,
    namingProfile: NetlistNamingProfile = "native",
    destination: "clipboard" | "file" = "clipboard",
  ): Promise<void> => {
    showNetlist(mode, namingProfile);
    if (netlistConfigurationError) {
      setStatus(`Fix Netlist configuration: ${netlistConfigurationError}`);
      return;
    }
    const { format, rnl } = netlistModeParts(mode);
    const options = {
      format,
      project,
      namingProfile,
      ...(netlistRootDocumentId
        ? { rootDocumentId: netlistRootDocumentId }
        : {}),
      electricalWarningsPresent: electricalWarningsPresent(),
    };
    if (rnl && destination === "clipboard") {
      await copyRnlNetlist(options);
      return;
    }
    let plan;
    try {
      plan = rnl
        ? await planRnlNetlistExport({
            ...options,
            runtime: await loadRnlRuntime(),
          })
        : planDesignNetlistExport(options);
    } catch (error) {
      setStatus(rnlFailure(error));
      return;
    }
    if (plan.status === "blocked") {
      setStatus(plan.message);
      return;
    }
    try {
      if (destination === "file") {
        const result = await exportDelivery.deliverFile({
          bytes: plan.artifact.bytes,
          mediaType: plan.artifact.mediaType,
          suggestedName: `${safeExportBaseName(project.name)}.${plan.artifact.extension}`,
        });
        setStatus(
          result.status === "cancelled"
            ? "Export cancelled"
            : plan.artifact.report.replace(
                "copied",
                result.status === "saved" ? "saved" : "download requested",
              ),
        );
        return;
      }
      await exportDelivery.copyText(String(plan.artifact.bytes));
      setStatus(plan.artifact.report);
    } catch (error) {
      setStatus(
        destination === "file"
          ? error instanceof Error
            ? error.message
            : "Netlist file export failed"
          : CLIPBOARD_FALLBACK,
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

  /** The chosen files and the one entry among them, or null after saying why. */
  const readSources = async (files: FileList | null) => {
    if (!files || files.length === 0) return null;
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
      return null;
    }
    return { sourceInputs, entryCandidates };
  };

  /** Replace the open Project with an imported one, and open its report. */
  const installImport = async (
    label: string,
    importedProject: CircuitProject,
    report: SpiceImportReport,
  ) => {
    const instanceCount = importedProject.documents.reduce(
      (count, candidate) => count + candidate.instances.length,
      0,
    );
    await guardDirtyReplacement(label, () => {
      replaceActiveProject(importedProject, defaultViewBox, {
        source: "spice-import",
      });
      setImportReport(report);
      setImportReviewOpen(true);
      setSelectionOpen(true);
      const documents = importedProject.documents.length;
      setStatus(
        `Imported ${documents} ${documents === 1 ? "Document" : "Documents"} and ${instanceCount} structural ${instanceCount === 1 ? "instance" : "instances"}`,
      );
    });
  };

  /** Show an import that failed, with its findings. */
  const reportFailedImport = (report: SpiceImportReport, message: string) => {
    setImportReport(report);
    setImportReviewOpen(true);
    setSelectionOpen(true);
    setStatus(message);
  };

  const importRnlFiles = async (files: FileList | null): Promise<void> => {
    const sources = await readSources(files);
    if (!sources) return;
    // readSources returns only with exactly one entry.
    const [entry] = sources.entryCandidates;
    if (!entry) return;
    const entryPath = entry.path;
    setStatus("Importing RNL sources");
    try {
      const plan = await planRnlImport({
        inputs: sources.sourceInputs,
        entryPath,
        runtime: await loadRnlRuntime(),
      });
      const report = { entryPath, diagnostics: plan.diagnostics };
      if (plan.status === "failed") {
        reportFailedImport(report, plan.message);
        return;
      }
      await installImport("Import RNL sources", plan.project, report);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "RNL import failed");
    }
  };

  const importSpiceFiles = async (
    files: FileList | null,
    namingProfile: "native" | "cadence-bang" = "native",
  ): Promise<void> => {
    const sources = await readSources(files);
    if (!sources) return;
    const { sourceInputs, entryCandidates } = sources;
    setStatus("Importing SPICE sources");
    try {
      const prepared = prepareImportSources(sourceInputs);
      const result = await importSpiceSources(
        prepared.inputs,
        entryCandidates[0]!.path,
        {},
        {
          namingProfile,
          originalSources: sourceInputs,
          builtInBodies: prepared.builtInBodies,
        },
      );
      const nextImportReport: SpiceImportReport = {
        entryPath: entryCandidates[0]!.path,
        diagnostics: result.diagnostics,
      };
      if (!result.project || !result.successful) {
        const firstError = result.diagnostics.find(
          (item) => item.severity === "error",
        );
        reportFailedImport(
          nextImportReport,
          firstError?.message ?? "SPICE import failed",
        );
        return;
      }
      await installImport(
        "Import SPICE sources",
        withImportedInstanceDisplays(result.project),
        nextImportReport,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  };

  return {
    exportSvg,
    exportDesignNetlist,
    exportRaster,
    importSpiceFiles,
    importRnlFiles,
  };
}
