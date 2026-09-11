import type { SimulationFocusTarget } from "./simulation-focus-target";
import { useEffect, useRef, useState } from "react";
import {
  WorkspaceInteractions,
  WorkspaceNameInput,
  useWorkspaceInteractions,
} from "./workspace-interactions";
import {
  readSimulationExperimentConfig,
  type SimulationRunPlanAxis,
} from "@icm/model";
import { createSimulationStarter } from "@icm/netlist";
import type { SimulationCodeWorkspaceProps } from "./code-workspace";
import type {
  ArtifactRef,
  Capabilities,
  Prepared,
  Problem,
  Run,
  SimulationBatch,
  SimulationReply,
} from "@icm/simulation-service/contract";
import { downloadTextArtifact } from "../../document/project-file-service";
import type { SpiceSimulationSurfaceProps } from "./simulation-surface-types";
export type {
  SpiceSimulationSurfaceProps,
  SimulationFolderSaveResult,
} from "./simulation-surface-types";
import authoringProfile from "../../../../../containers/ngspice/hosted-sky130-profile.json";
import {
  SourceCodePane,
  type SourceCodeHandle,
  type SourceFlush,
} from "./source-code-pane";
import {
  sourcePresentation,
  type SimulationPresentationOutput as SimulationOutputSpec,
} from "./source-presentation";
import { SimulationProblemView } from "./simulation-problem-view";
import { SimulationRunDetails } from "./simulation-run-details";
import { AcResultsExplorer } from "./ac-results-explorer";
import { DcResultsExplorer } from "./dc-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";
import {
  SimulationAnalysisCard,
  SimulationOutputResults,
} from "./simulation-output-results";
import { deriveOperatingPointCanvasProjection } from "./operating-point-projection";
import {
  resultRecordGroups,
  resultRecordLabel,
  type RecordSelection,
} from "./simulation-result-records";
import type { OperatingPointDisplay } from "./operating-point-labels";
import { DeviceOperatingPointResults } from "./device-operating-point-results";

import {
  buildSimulationArtifactArchive,
  formatSimulationArtifactPreview,
  readSimulationArtifact,
  readSimulationArtifactPreview,
  simulationArtifactCategory,
  type SimulationArtifactContent,
} from "./simulation-artifact-files";
import {
  buildVisibleSimulationPlotDownload,
  downloadSimulationPlot,
  type SimulationPlotExportFormat,
} from "./simulation-plot-export";
import {
  SimulationRunComparison,
  type SimulationComparisonRun,
} from "./simulation-run-comparison";
import { SimulationWaveformComparison } from "./simulation-waveform-comparison";
import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import {
  captureSimulationRunArchive,
  restoreSimulationRunArchive,
  type SimulationRunArchiveSummary,
} from "./simulation-run-archive";

const MAX_COMPARISON_RUNS = 5;
type ResultTab = SimulationCodeWorkspaceProps["outputPane"];

function preferredResultTab(run: Run): ResultTab {
  const analyses = run.outputData?.analyses ?? run.result?.data?.analyses ?? [];
  if (
    analyses.some(
      (analysis) =>
        analysis.analysis === "dc" ||
        analysis.analysis === "ac" ||
        analysis.analysis === "tran",
    )
  )
    return "plot";
  if (analyses.some((analysis) => analysis.analysis === "op"))
    return "operating-point";
  return "console";
}

interface PreparedPresentation {
  readonly folderId: string;
  readonly prepared: Prepared;
  readonly outputs: SimulationOutputSpec[];
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
  readonly folderName: string;
}

function focusTarget(
  output: SimulationOutputSpec,
): SimulationFocusTarget | null {
  const expression = output.expression;
  return expression.kind === "voltage" || expression.kind === "current"
    ? { ...expression, id: output.id }
    : null;
}

function uiProblem(code: string, message: string): Problem {
  return { code, message, stage: "input", recovery: "fix-input" };
}

/** A projection of the same prepare/start/read/cancel service used by MCP.
 * The canvas remains the editor for sources, connections and DUT instances. */
export function SpiceSimulationSurface(props: SpiceSimulationSurfaceProps) {
  return (
    <WorkspaceInteractions key={props.project.id}>
      <SimulationSurface {...props} />
    </WorkspaceInteractions>
  );
}
function SimulationSurface(props: SpiceSimulationSurfaceProps) {
  const interaction = useWorkspaceInteractions();
  const { session, project, open } = props;
  const selectedFolder = project.simulationFolders.find(
    (folder) => folder.id === props.selectedFolderId,
  );
  const activeFolderId = useRef(props.selectedFolderId);
  activeFolderId.current = props.selectedFolderId;
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const [batch, setBatch] = useState<SimulationBatch>();
  const hydratedBatchRuns = useRef(new Set<string>());
  const batchRuns = useRef(new Map<string, { prepared: Prepared; run: Run }>());
  const runDetails = useRef(new SimulationRunDetails());
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeDirty, setActiveDirty] = useState(false);
  const [resultsMaximized, setResultsMaximized] = useState(false);
  const restoreDockAfterResults = useRef(false);
  useEffect(() => {
    if (!props.maximized) setResultsMaximized(false);
  }, [props.maximized]);
  const toggleResultsMaximized = () => {
    if (resultsMaximized) {
      setResultsMaximized(false);
      if (restoreDockAfterResults.current && props.maximized)
        props.onToggleMaximized();
      restoreDockAfterResults.current = false;
    } else {
      restoreDockAfterResults.current = !props.maximized;
      if (!props.maximized) props.onToggleMaximized();
      setResultsMaximized(true);
    }
  };
  const preparedPresentations = useRef(new Map<string, PreparedPresentation>());
  const folderResults = useRef(
    new Map<string, { prepared?: Prepared; run?: Run }>(),
  );
  const codeRef = useRef<SourceCodeHandle>(null);
  useEffect(() => {
    props.onSourceBuffer?.({
      dirty,
      flush: async () => !codeRef.current || (await codeRef.current.save()),
    });
    return () => props.onSourceBuffer?.(null);
  }, [dirty, selectedFolder?.id, props.onSourceBuffer]);
  const [resultTab, setResultTab] = useState<ResultTab>("plot");

  const [artifactPreview, setArtifactPreview] =
    useState<SimulationArtifactContent>();
  const [artifactBusy, setArtifactBusy] = useState<string>();
  const [canvasOpEnabled, setCanvasOpEnabled] = useState(false);
  const [opRecord, setOpRecord] = useState<{ runId: string; index: number }>();
  const [comparisonRecords, setComparisonRecords] = useState<
    Record<string, RecordSelection>
  >({});
  const [canvasOpDisplay, setCanvasOpDisplay] =
    useState<OperatingPointDisplay>("named");
  const resultsBodyRef = useRef<HTMLDivElement>(null);
  const [retainedComparisonRuns, setRetainedComparisonRuns] = useState<
    readonly SimulationComparisonRun[]
  >([]);
  const [archiveStore] = useState(() => createBrowserSimulationArchiveStore());
  const archivedRunIds = useRef(new Set<string>());
  const [archives, setArchives] = useState<
    readonly SimulationRunArchiveSummary[]
  >([]);

  const batchMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeTaskbarMenus = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!batchMenuRef.current?.contains(target))
        batchMenuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeTaskbarMenus);
    return () => document.removeEventListener("pointerdown", closeTaskbarMenus);
  }, []);
  const operatingPointProjectionRef = useRef(props.onOperatingPointProjection);
  operatingPointProjectionRef.current = props.onOperatingPointProjection;
  useEffect(() => () => operatingPointProjectionRef.current?.(null), []);
  useEffect(() => {
    let stopped = false;
    void archiveStore.list(project.id).then((result) => {
      if (!stopped && result.ok) setArchives(result.value);
    });
    return () => {
      stopped = true;
    };
  }, [archiveStore, project.id, open]);
  useEffect(
    () => () => {
      archiveStore.close();
    },
    [archiveStore],
  );
  const previousFolderId = useRef<string | null>(props.selectedFolderId);
  useEffect(() => {
    if (previousFolderId.current === props.selectedFolderId) return;
    previousFolderId.current = props.selectedFolderId;
    const previous = props.selectedFolderId
      ? folderResults.current.get(props.selectedFolderId)
      : undefined;
    setPrepared(previous?.prepared);
    setRun(previous?.run);
    setProblem(undefined);
    setArtifactPreview(undefined);
    props.onOperatingPointProjection?.(null);
  }, [props.selectedFolderId]);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const receive = (reply: SimulationReply) => {
    if (!alive.current) return;
    if (
      !(reply.ok && "batch" in reply) &&
      (selectedFolder?.id ?? null) !== activeFolderId.current
    )
      return;
    if (reply.ok && "run" in reply) {
      const owner = preparedPresentations.current.get(
        reply.run.preparedId,
      )?.folderId;
      if (owner !== activeFolderId.current) return;
    }
    if (!reply.ok) {
      setProblem(reply.error);
      if (selectedFolder) {
        setResultTab("console");
      } else {
      }
    } else if ("batch" in reply) {
      setBatch(reply.batch);
      setProblem(undefined);
    } else if ("run" in reply) {
      if (selectedFolder)
        folderResults.current.set(selectedFolder.id, {
          ...folderResults.current.get(selectedFolder.id),
          run: reply.run,
        });
      setRun(reply.run);
      setProblem(undefined);
      const presentation = preparedPresentations.current.get(
        reply.run.preparedId,
      );
      if (
        canvasOpEnabled &&
        reply.run.state === "finished" &&
        reply.run.inputStatus !== "changed" &&
        presentation?.rootDocumentId
      ) {
        props.onOperatingPointProjection?.(
          deriveOperatingPointCanvasProjection(
            project,
            presentation.rootDocumentId,
            reply.run.inputRevision,
            reply.run.outputData,
            presentation.outputs,
            canvasOpDisplay,
            opRecord?.runId === reply.run.id ? opRecord.index : undefined,
          ),
        );
      } else props.onOperatingPointProjection?.(null);
      if (
        reply.run.result ||
        reply.run.error ||
        ["finished", "cancelled", "lost"].includes(reply.run.state)
      ) {
        setResultTab(preferredResultTab(reply.run));
      }
    } else if ("prepared" in reply) {
      if (selectedFolder)
        folderResults.current.set(selectedFolder.id, {
          ...folderResults.current.get(selectedFolder.id),
          prepared: reply.prepared,
        });
      setPrepared(reply.prepared);
      setProblem(undefined);
      setArtifactPreview(undefined);
      setResultTab("files");
    } else if ("capabilities" in reply) {
      setCapabilities(reply.capabilities);
      setProblem(undefined);
    }
  };
  useEffect(() => {
    if (open && !capabilities)
      void session.handle({ operation: "capabilities" }).then(receive);
  }, [open, session]);
  // Keep tracking while the drawer is closed. A Project replacement unmounts
  // this owner; closing a view is deliberately not cancellation.
  useEffect(() => {
    if (!run || archivedRunIds.current.has(run.id)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let detailsProblem: Problem | undefined;
      let reply = await session.handle({ operation: "read", runId: run.id });
      if (
        reply.ok &&
        "run" in reply &&
        reply.run.resultPreview &&
        ["finished", "cancelled", "lost"].includes(reply.run.state)
      ) {
        const details = await runDetails.current.read(session.files, reply.run);
        if (details.ok) reply = details;
        else detailsProblem = details.error;
      }
      if (stopped) return;
      receive(reply);
      if (detailsProblem) setProblem(detailsProblem);
      if (
        reply.ok &&
        "run" in reply &&
        ["running", "cancelling"].includes(reply.run.state)
      )
        timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run?.id, session, project]);
  useEffect(() => {
    if (!batch || !["running", "cancelling"].includes(batch.state)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const reply = await session.handle({
        operation: "read-batch",
        batchId: batch.id,
      });
      if (stopped) return;
      receive(reply);
      if (!reply.ok || !("batch" in reply)) return;
      for (const item of reply.batch.items) {
        if (!item.runId || hydratedBatchRuns.current.has(item.runId)) continue;
        if (!["finished", "failed", "cancelled", "lost"].includes(item.state))
          continue;
        const runReply = await session.handle({
          operation: "read",
          runId: item.runId,
        });
        if (!runReply.ok || !("run" in runReply)) continue;
        hydratedBatchRuns.current.add(item.runId);
        batchRuns.current.set(item.runId, {
          prepared: item.prepared,
          run: runReply.run,
        });
        folderResults.current.set(item.folderId, {
          prepared: item.prepared,
          run: runReply.run,
        });
        if (item.folderId === activeFolderId.current) {
          setPrepared(item.prepared);
          setRun(runReply.run);
          setResultTab(preferredResultTab(runReply.run));
        }
      }
      if (["running", "cancelling"].includes(reply.batch.state))
        timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [batch?.id, batch?.state, session, project]);
  const execute = async (start: boolean) => {
    if (lock.current) return;
    const authored = await codeRef.current?.flush();
    if (!authored?.ok) return;
    const selectedConfig = readSimulationExperimentConfig(authored.folder);
    if (selectedConfig.ok && selectedConfig.config.runPlan.mode === "sweep") {
      await executeSweep(selectedConfig.config.runPlan.axes, start, authored);
      return;
    }
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    props.onOperatingPointProjection?.(null);
    try {
      const reply = await session.handle({
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: selectedFolder!.id,
          expectedStructureRevision: authored.revision,
        },
      });
      if (reply.ok && "prepared" in reply) {
        preparedPresentations.current.set(reply.prepared.id, {
          ...sourcePresentation(authored.folder),
          prepared: structuredClone(reply.prepared),
        });
      }
      receive(reply);
      if (start && reply.ok && "prepared" in reply && alive.current)
        receive(
          await session.handle({
            operation: "start",
            preparedId: reply.prepared.id,
            digest: reply.prepared.digest,
          }),
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const executeBatch = async (selection: readonly string[]) => {
    if (lock.current) return;
    const authored = await codeRef.current?.flush();
    if (authored && !authored.ok) return;
    const folders = project.simulationFolders.filter((folder) =>
      selection.includes(folder.id),
    );
    if (folders.length < 2) {
      setProblem(
        uiProblem(
          "SIMULATION_BATCH_SELECTION_REQUIRED",
          "Select at least two saved folders to run as a batch",
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    hydratedBatchRuns.current.clear();
    try {
      const preparedReply = await session.handle({
        operation: "prepare-batch",
        expectedStructureRevision: authored?.ok
          ? authored.revision
          : project.structureRevision,
        items: folders.map((folder) => ({
          id: folder.id,
          folderId: folder.id,
        })),
      });
      receive(preparedReply);
      if (!preparedReply.ok || !("batch" in preparedReply)) return;
      for (const item of preparedReply.batch.items) {
        const folder = folders.find(
          (candidate) => candidate.id === item.folderId,
        );
        if (!folder) continue;
        preparedPresentations.current.set(item.prepared.id, {
          ...sourcePresentation(
            authored?.ok && authored.folder.id === folder.id
              ? authored.folder
              : folder,
          ),
          prepared: structuredClone(item.prepared),
        });
        folderResults.current.set(folder.id, { prepared: item.prepared });
      }
      receive(
        await session.handle({
          operation: "start-batch",
          batchId: preparedReply.batch.id,
        }),
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const executeSweep = async (
    axes: readonly SimulationRunPlanAxis[],
    start: boolean,
    authored: Extract<SourceFlush, { ok: true }>,
  ) => {
    if (lock.current || !selectedFolder) return;
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    hydratedBatchRuns.current.clear();
    batchRuns.current.clear();
    try {
      const preparedReply = await session.handle({
        operation: "prepare-sweep",
        folderId: selectedFolder.id,
        expectedStructureRevision: authored.revision,
        axes: [...axes],
      });
      receive(preparedReply);
      if (!preparedReply.ok || !("batch" in preparedReply)) return;
      for (const item of preparedReply.batch.items) {
        preparedPresentations.current.set(item.prepared.id, {
          ...sourcePresentation(authored.folder),
          prepared: structuredClone(item.prepared),
          folderName: item.label ?? authored.folder.name,
        });
      }
      if (start)
        receive(
          await session.handle({
            operation: "start-batch",
            batchId: preparedReply.batch.id,
          }),
        );
      else {
        const first = preparedReply.batch.items[0];
        if (first) await showBatchItem(first);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const showBatchItem = async (item: SimulationBatch["items"][number]) => {
    if (!item.runId) {
      const presentation = preparedPresentations.current.get(item.prepared.id);
      setPrepared(item.prepared);
      setRun(undefined);
      setProblem(undefined);
      setArtifactPreview(undefined);
      setResultTab("files");
      if (presentation)
        folderResults.current.set(item.folderId, { prepared: item.prepared });
      return;
    }
    let resolved = batchRuns.current.get(item.runId);
    if (!resolved) {
      const reply = await session.handle({
        operation: "read",
        runId: item.runId,
      });
      if (!reply.ok || !("run" in reply)) {
        receive(reply);
        return;
      }
      resolved = { prepared: item.prepared, run: reply.run };
      batchRuns.current.set(item.runId, resolved);
    }
    if (item.folderId !== activeFolderId.current)
      props.onSelectFolderId(item.folderId);
    setPrepared(resolved.prepared);
    setRun(resolved.run);
    setResultTab(preferredResultTab(resolved.run));
  };
  const download = async (artifact: ArtifactRef) => {
    setArtifactBusy(`download:${artifact.id}`);
    const artifactResult = await readSimulationArtifact(
      session.files,
      artifact,
    );
    setArtifactBusy(undefined);
    if (!artifactResult.ok) {
      setProblem(artifactResult.error);
      return;
    }
    const result = downloadTextArtifact(
      artifactResult.content.text,
      artifact.name,
    );
    if (result.status === "failed")
      setProblem(uiProblem("ARTIFACT_DOWNLOAD_FAILED", result.message));
  };
  const preview = async (artifact: ArtifactRef) => {
    setArtifactBusy(`preview:${artifact.id}`);
    const result = await readSimulationArtifactPreview(session.files, artifact);
    setArtifactBusy(undefined);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setArtifactPreview(result.content);
  };
  const downloadBundle = async (
    key: "prepare" | "run",
    artifacts: readonly ArtifactRef[],
  ) => {
    setArtifactBusy(`bundle:${key}`);
    const result = await buildSimulationArtifactArchive(
      session.files,
      artifacts,
    );
    setArtifactBusy(undefined);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([result.bytes as BlobPart], { type: "application/zip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `simulation-${key}.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const archiveCurrentRun = async () => {
    if (
      !run ||
      !selectedFolder ||
      !runPresentation ||
      selectedFolder.id !== runPresentation.folderId
    )
      return;
    setArtifactBusy("archive:save");
    const captured = await captureSimulationRunArchive(session.files, {
      projectId: project.id,
      presentation: {
        folderId: runPresentation.folderId,
        folderName: runPresentation.folderName,
        analysisLabel: runPresentation.analysisLabel,
        outputs: runPresentation.outputs,
        ...(runPresentation.rootDocumentId
          ? { rootDocumentId: runPresentation.rootDocumentId }
          : {}),
      },
      prepared: runPresentation.prepared,
      run,
    });
    if (!captured.ok) {
      setArtifactBusy(undefined);
      setProblem(captured.error);
      return;
    }
    const saved = await archiveStore.save(captured.value);
    setArtifactBusy(undefined);
    if (!saved.ok) {
      setProblem(
        uiProblem(
          "SIMULATION_ARCHIVE_STORAGE_FAILED",
          saved.code === "quota-exceeded"
            ? "Browser storage is full; export the complete run ZIP instead"
            : "Browser result archives are unavailable; export the complete run ZIP instead",
        ),
      );
      return;
    }
    setArchives((current) =>
      [
        saved.value,
        ...current.filter((item) => item.id !== saved.value.id),
      ].slice(0, 10),
    );
  };
  const openArchivedRun = async (archiveId: string) => {
    setArtifactBusy(`archive:open:${archiveId}`);
    const stored = await archiveStore.read(archiveId);
    if (!stored.ok || !stored.value) {
      setArtifactBusy(undefined);
      setProblem(
        uiProblem(
          "SIMULATION_ARCHIVE_UNAVAILABLE",
          "The selected browser archive is no longer available",
        ),
      );
      return;
    }
    const restored = await restoreSimulationRunArchive(
      session.files,
      stored.value,
    );
    setArtifactBusy(undefined);
    if (!restored.ok) {
      setProblem(restored.error);
      return;
    }
    const presentation: PreparedPresentation = {
      ...stored.value.presentation,
      prepared: restored.value.prepared,
    };
    preparedPresentations.current.set(restored.value.prepared.id, presentation);
    archivedRunIds.current.add(restored.value.run.id);
    folderResults.current.set(stored.value.presentation.folderId, {
      prepared: restored.value.prepared,
      run: restored.value.run,
    });
    if (
      stored.value.presentation.folderId !== selectedFolder?.id &&
      project.simulationFolders.some(
        (folder) => folder.id === stored.value!.presentation.folderId,
      )
    )
      props.onSelectFolderId(stored.value.presentation.folderId);
    setPrepared(restored.value.prepared);
    setRun(restored.value.run);
    setProblem(undefined);
    setResultTab(preferredResultTab(restored.value.run));
  };
  const deleteArchivedRun = async (archiveId: string) => {
    const deleted = await archiveStore.delete(archiveId);
    if (!deleted.ok) {
      setProblem(
        uiProblem(
          "SIMULATION_ARCHIVE_DELETE_FAILED",
          "The browser archive could not be removed",
        ),
      );
      return;
    }
    setArchives((current) =>
      current.filter((archive) => archive.id !== archiveId),
    );
  };
  const exportVisiblePlots = async (format: SimulationPlotExportFormat) => {
    if (!resultsBodyRef.current) return;
    setArtifactBusy(`plots:${format}`);
    try {
      const result = await buildVisibleSimulationPlotDownload(
        resultsBodyRef.current,
        format,
      );
      if (!result) {
        setProblem(
          uiProblem(
            "PLOT_EXPORT_UNAVAILABLE",
            "Open Plot with at least one visible chart before exporting an image",
          ),
        );
        return;
      }
      downloadSimulationPlot(result);
    } catch (error) {
      setProblem(
        uiProblem(
          "PLOT_EXPORT_FAILED",
          error instanceof Error
            ? error.message
            : "The visible plot could not be exported",
        ),
      );
    } finally {
      setArtifactBusy(undefined);
    }
  };
  const batchRunning = batch && ["running", "cancelling"].includes(batch.state);
  const running =
    (run && ["running", "cancelling"].includes(run.state)) || batchRunning;
  const activeCell = project.documents.find(
    (candidate) => candidate.id === props.activeDocumentId,
  );
  const hasDutInstance = Boolean(
    activeCell?.instances.some(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    ),
  );
  const finishedBatchItems =
    batch?.items.filter((item) =>
      ["finished", "failed", "cancelled", "lost"].includes(item.state),
    ).length ?? 0;
  const statusLabel = busy
    ? "Preparing…"
    : batch
      ? `Batch ${batch.state} · ${finishedBatchItems}/${batch.items.length}`
      : run
        ? `${run.state}${run.result ? ` · ${run.result.outcome.status}` : ""}`
        : prepared
          ? "Deck prepared"
          : "No run yet";
  const staleMessage =
    run?.inputStatus === "changed"
      ? "Result belongs to an earlier Project revision. Run again to use the current circuit."
      : "";
  const activeProblem = problem ?? run?.error;
  const runPresentation = run
    ? preparedPresentations.current.get(run.preparedId)
    : undefined;
  const canvasOpProjection =
    run && runPresentation?.rootDocumentId
      ? deriveOperatingPointCanvasProjection(
          project,
          runPresentation.rootDocumentId,
          run.inputRevision,
          run.outputData,
          runPresentation.outputs,
          canvasOpDisplay,
          opRecord?.runId === run.id ? opRecord.index : undefined,
        )
      : undefined;
  const currentComparisonRun: SimulationComparisonRun | undefined =
    run?.outputData && runPresentation
      ? {
          id: run.id,
          label: runPresentation.folderName,
          inputRevision: run.inputRevision,
          environment: runPresentation.prepared.environment,
          outputData: run.outputData,
          measurements: run.outputData.measurements ?? [],
          current: true,
        }
      : undefined;
  const batchComparisonRuns: readonly SimulationComparisonRun[] =
    batch?.items
      .flatMap((item) => {
        if (!item.runId) return [];
        const resolved = batchRuns.current.get(item.runId);
        const presentation = preparedPresentations.current.get(
          item.prepared.id,
        );
        if (!resolved?.run.outputData || !presentation) return [];
        return [
          {
            id: resolved.run.id,
            label: presentation.folderName,
            inputRevision: resolved.run.inputRevision,
            environment: presentation.prepared.environment,
            outputData: resolved.run.outputData,
            measurements: resolved.run.outputData.measurements ?? [],
            current: resolved.run.id === run?.id,
          },
        ];
      })
      .slice(-MAX_COMPARISON_RUNS) ?? [];
  const automaticComparisonIds = new Set(
    batchComparisonRuns.map((candidate) => candidate.id),
  );
  const comparisonRuns = [
    ...retainedComparisonRuns.filter(
      (candidate) =>
        candidate.id !== currentComparisonRun?.id &&
        !automaticComparisonIds.has(candidate.id),
    ),
    ...batchComparisonRuns,
    ...(currentComparisonRun &&
    !automaticComparisonIds.has(currentComparisonRun.id)
      ? [currentComparisonRun]
      : []),
  ]
    .slice(-MAX_COMPARISON_RUNS)
    .map((candidate) => ({
      ...candidate,
      records: comparisonRecords[candidate.id] ?? {},
    }));
  const retainCurrentComparison = (): void => {
    if (!currentComparisonRun) return;
    setRetainedComparisonRuns((current) => {
      if (current.some((candidate) => candidate.id === currentComparisonRun.id))
        return current;
      // Reserve one column for the next/current run.
      if (current.length >= MAX_COMPARISON_RUNS - 1) return current;
      return [
        ...current,
        structuredClone({ ...currentComparisonRun, current: false }),
      ];
    });
  };
  const artifactCategories = ["Netlist", "Results", "Evidence", "Log", "Other"];
  const runPreparedArtifactIds = new Set(
    runPresentation?.prepared.artifacts.map((artifact) => artifact.id) ?? [],
  );
  const artifactGroups = [
    ...(prepared
      ? [
          {
            key: "prepare" as const,
            label: "Prepare",
            description: "Compiled input",
            artifacts: prepared.artifacts,
          },
        ]
      : []),
    ...(run
      ? [
          {
            key: "run" as const,
            label: "Run",
            description: "Execution output",
            artifacts: run.artifacts.filter(
              (artifact) => !runPreparedArtifactIds.has(artifact.id),
            ),
          },
        ]
      : []),
  ].filter((group) => group.artifacts.length > 0);
  const resultCsvArtifacts = run
    ? (() => {
        const csv = run.artifacts.filter((artifact) =>
          artifact.name.toLowerCase().endsWith(".csv"),
        );
        const evaluated = csv.filter(
          (artifact) =>
            artifact.name.startsWith("outputs-") ||
            artifact.name === "measurements.csv",
        );
        return evaluated.length ? evaluated : csv;
      })()
    : [];
  const analysisLabel = runPresentation?.analysisLabel;
  const presentationProbes =
    runPresentation?.outputs.flatMap((output) => {
      const probe = focusTarget(output);
      return probe ? [probe] : [];
    }) ?? [];
  const presentationLabels = Object.fromEntries(
    (runPresentation?.outputs ?? []).map((output) => [output.id, output.label]),
  );
  const [requestedRun, setRequestedRun] = useState<string>();
  useEffect(() => {
    if (requestedRun && requestedRun === selectedFolder?.id) {
      setRequestedRun(undefined);
      void execute(true);
    }
  }, [requestedRun, selectedFolder?.id]);
  const folderAction = async (
    action: import("./simulation-file-tree").FolderAction,
    ids: string[],
  ) => {
    if (action === "batch") {
      await executeBatch(ids);
      return;
    }
    const folder = project.simulationFolders.find((item) => item.id === ids[0]);
    if (action === "run" && folder) {
      props.onSelectFolderId(folder.id);
      setRequestedRun(folder.id);
      return;
    }
    if (action === "delete" && folder) {
      if (
        await interaction.confirm({
          title: `Delete folder ${folder.name}?`,
          message:
            "This removes its source files and saved drafts from the Project. Undo restores the folder; archived results are kept.",
        })
      ) {
        if (codeRef.current && !(await codeRef.current.save())) return;
        props.onDeleteFolder(
          folder.id,
          session.currentProject()?.structureRevision,
        );
      }
      return;
    }
    // Folder management must preserve unfinished code, not require a runnable deck.
    if (codeRef.current && !(await codeRef.current.save())) return;
    const latestProject = session.currentProject();
    if (!latestProject) return;
    const current = latestProject.simulationFolders.find(
      (item) => item.id === folder?.id,
    );
    if (action === "export" && current) {
      downloadTextArtifact(
        JSON.stringify(current, null, 2) + "\n",
        `${current.name}.simulation.json`,
      );
      return;
    }
    let template = ids[0] === "ac" ? "AC" : ids[0] === "tran" ? "TRAN" : "OP";
    let starter = "Text only";
    const name = await interaction.name({
      kind: "folder",
      ...(action === "rename" && current ? { folderId: current.id } : {}),
      label: action === "rename" ? "Folder name" : "New simulation folder name",
      validate: (value) =>
        session
          .currentProject()
          ?.simulationFolders.some(
            (item) =>
              !(action === "rename" && item.id === current?.id) &&
              item.name.toLocaleLowerCase("en-US") ===
                value.toLocaleLowerCase("en-US"),
          )
          ? `Simulation folder name already exists: ${value}`
          : undefined,
      ...(action === "new"
        ? {
            template: {
              value: template,
              options: ["OP", "AC", "TRAN"],
              onChange: (value: string) => {
                template = value;
              },
            },
            starter: {
              value: starter,
              options: [
                "Text only",
                "Current Canvas Cell",
                "Text TB for current Cell",
              ],
              onChange: (value: string) => {
                starter = value;
              },
            },
          }
        : {}),
      initial:
        action === "rename"
          ? (current?.name ?? "")
          : action === "duplicate"
            ? `${current?.name} copy`
            : `Simulation ${latestProject.simulationFolders.length + 1}`,
    });
    if (!name?.trim()) return;
    const identity = {
      id:
        action === "rename" && current
          ? current.id
          : `simulation-folder-${crypto.randomUUID()}`,
      name: name.trim(),
    };
    // Naming is non-modal: refresh the revision and source after the user finishes.
    const namingProject = session.currentProject();
    if (!namingProject) return;
    const newest = namingProject.simulationFolders.find(
      (item) => item.id === current?.id,
    );
    if (current && !newest) return;
    let created: typeof current;
    if (newest) created = { ...structuredClone(newest), ...identity };
    else {
      const result = createSimulationStarter(namingProject, {
        ...identity,
        mode:
          starter === "Current Canvas Cell"
            ? "circuit"
            : starter === "Text TB for current Cell"
              ? "dut"
              : "text",
        documentId:
          props.draftContext?.rootDocumentId ?? props.activeDocumentId,
        profileId: capabilities?.profiles[0]?.id ?? authoringProfile.id,
        template:
          template === "AC" ? "ac" : template === "TRAN" ? "tran" : "op",
      });
      if (!result.ok) {
        setProblem(uiProblem("SIMULATION_STARTER_INVALID", result.message));
        return;
      }
      created = result.folder;
    }
    const result = props.onSaveFolder(created, namingProject.structureRevision);
    if (result.status === "rejected") setProblem(result.problem);
    else props.onSelectFolderId(created.id);
  };
  const createFolder = () => void folderAction("new", []);
  const outputActions = (
    <>
      {run ? (
        <div className="simulation-result-actions">
          <button
            type="button"
            disabled={
              artifactBusy !== undefined ||
              (!run.result && !run.outputData) ||
              !selectedFolder ||
              selectedFolder.id !== runPresentation?.folderId
            }
            onClick={() => void archiveCurrentRun()}
          >
            {artifactBusy === "archive:save" ? "Archiving…" : "Archive"}
          </button>
          <details className="simulation-result-export">
            <summary>Export</summary>
            <div>
              {resultTab === "plot" ? (
                <>
                  <button
                    type="button"
                    disabled={artifactBusy !== undefined}
                    onClick={() => void exportVisiblePlots("svg")}
                  >
                    {artifactBusy === "plots:svg"
                      ? "Preparing SVG…"
                      : "Visible plots · SVG"}
                  </button>
                  <button
                    type="button"
                    disabled={artifactBusy !== undefined}
                    onClick={() => void exportVisiblePlots("png")}
                  >
                    {artifactBusy === "plots:png"
                      ? "Preparing PNG…"
                      : "Visible plots · PNG"}
                  </button>
                </>
              ) : null}
              {resultCsvArtifacts.length ? (
                <section>
                  <small>Complete result data</small>
                  {resultCsvArtifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      disabled={artifactBusy !== undefined}
                      onClick={() => void download(artifact)}
                    >
                      {artifact.name}
                    </button>
                  ))}
                </section>
              ) : null}
              <button
                type="button"
                disabled={
                  artifactBusy !== undefined || run.artifacts.length === 0
                }
                onClick={() => void downloadBundle("run", run.artifacts)}
              >
                Complete run · ZIP
              </button>
            </div>
          </details>
        </div>
      ) : null}
    </>
  );
  const resultContent = (
    <section
      className="simulation-results-dock"
      aria-label="Simulation results"
    >
      <div ref={resultsBodyRef} className="simulation-results-body">
        {resultTab === "plot" ? (
          <div className="simulation-analysis-view simulation-plot-view">
            {run?.outputData ? (
              <SimulationOutputResults
                resultKey={run.id}
                data={{
                  ...run.outputData,
                  analyses: run.outputData.analyses.filter(
                    (analysis) => analysis.analysis !== "op",
                  ),
                }}
                outputs={runPresentation?.outputs ?? []}
                signalTargets={runPresentation?.prepared.signalTargets}
                {...(props.onFocusProbe
                  ? {
                      onFocusProbe: (probe: SimulationFocusTarget) =>
                        props.onFocusProbe?.(
                          probe,
                          probe.rootDocumentId ??
                            runPresentation?.rootDocumentId,
                        ),
                    }
                  : {})}
              />
            ) : null}
            {!run?.outputData &&
              run?.result?.data?.analyses
                .filter((analysis) => analysis.analysis === "dc")
                .map((analysis, index) => (
                  <SimulationAnalysisCard key={`dc-${index}`} kind="dc">
                    <DcResultsExplorer
                      analysis={analysis}
                      vectors={runPresentation?.prepared.vectors ?? []}
                      probes={presentationProbes}
                      labels={presentationLabels}
                      {...(props.onFocusProbe
                        ? {
                            onFocusProbe: (probe: SimulationFocusTarget) =>
                              props.onFocusProbe?.(
                                probe,
                                runPresentation?.rootDocumentId,
                              ),
                          }
                        : {})}
                    />
                  </SimulationAnalysisCard>
                ))}
            {!run?.outputData &&
              run?.result?.data?.analyses
                .filter((analysis) => analysis.analysis === "ac")
                .map((analysis, index) => (
                  <SimulationAnalysisCard
                    key={`${run.id}:ac:${index}`}
                    kind="ac"
                  >
                    <AcResultsExplorer
                      resultKey={`${run.id}:ac:${index}`}
                      analysis={analysis}
                      vectors={runPresentation?.prepared.vectors ?? []}
                      probes={presentationProbes}
                      labels={presentationLabels}
                      {...(props.onFocusProbe
                        ? {
                            onFocusProbe: (probe: SimulationFocusTarget) =>
                              props.onFocusProbe?.(
                                probe,
                                runPresentation?.rootDocumentId,
                              ),
                          }
                        : {})}
                    />
                  </SimulationAnalysisCard>
                ))}
            {!run?.outputData &&
              run?.result?.data?.analyses
                .filter((analysis) => analysis.analysis === "tran")
                .map((analysis, index) => (
                  <SimulationAnalysisCard
                    key={`${run.id}:tran:${index}`}
                    kind="tran"
                  >
                    <TransientResultsExplorer
                      resultKey={`${run.id}:tran:${index}`}
                      analysis={analysis}
                      vectors={runPresentation?.prepared.vectors ?? []}
                      probes={presentationProbes}
                      labels={presentationLabels}
                      {...(props.onFocusProbe
                        ? {
                            onFocusProbe: (probe: SimulationFocusTarget) =>
                              props.onFocusProbe?.(
                                probe,
                                runPresentation?.rootDocumentId,
                              ),
                          }
                        : {})}
                    />
                  </SimulationAnalysisCard>
                ))}
            {!run?.result?.data?.analyses.some(
              (analysis) =>
                analysis.analysis === "dc" ||
                analysis.analysis === "ac" ||
                analysis.analysis === "tran",
            ) ? (
              <p className="simulation-empty-result">
                Run a DC, AC, or transient analysis to see a plot.
              </p>
            ) : null}
          </div>
        ) : null}

        {resultTab === "operating-point" ? (
          <div className="simulation-analysis-view simulation-operating-point-view">
            <div className="simulation-op-canvas-controls">
              {run?.outputData &&
              (resultRecordGroups(run.outputData).get("op")?.length ?? 0) >
                1 ? (
                <label>
                  Canvas OP record
                  <select
                    value={opRecord?.runId === run.id ? opRecord.index : ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setOpRecord(
                        value === ""
                          ? undefined
                          : { runId: run.id, index: Number(value) },
                      );
                      setCanvasOpEnabled(false);
                      props.onOperatingPointProjection?.(null);
                    }}
                  >
                    <option value="">Choose a record…</option>
                    {resultRecordGroups(run.outputData)
                      .get("op")!
                      .map(({ index, analysis }) => (
                        <option key={index} value={index}>
                          {resultRecordLabel(index, analysis)}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                aria-pressed={canvasOpEnabled}
                disabled={
                  !canvasOpProjection?.values.length ||
                  run?.inputStatus === "changed"
                }
                onClick={() => {
                  const enabled = !canvasOpEnabled;
                  setCanvasOpEnabled(enabled);
                  props.onOperatingPointProjection?.(
                    enabled && canvasOpProjection ? canvasOpProjection : null,
                  );
                }}
              >
                {canvasOpEnabled ? "Hide canvas values" : "Show on canvas"}
              </button>
              <label>
                Canvas labels
                <select
                  value={canvasOpDisplay}
                  disabled={!canvasOpEnabled}
                  onChange={(event) => {
                    const display = event.currentTarget
                      .value as OperatingPointDisplay;
                    setCanvasOpDisplay(display);
                    if (canvasOpEnabled && canvasOpProjection)
                      props.onOperatingPointProjection?.({
                        ...canvasOpProjection,
                        display,
                      });
                  }}
                >
                  <option value="named">Named and focused</option>
                  <option value="all">All collected</option>
                </select>
              </label>
              <span>
                {run?.inputStatus === "changed"
                  ? "Paused: the circuit changed"
                  : `${canvasOpProjection?.values.length ?? 0} direct Net voltage${canvasOpProjection?.values.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {run?.outputData ? (
              <>
                <DeviceOperatingPointResults
                  devices={run.outputData.deviceOperatingPoints ?? []}
                />
                <SimulationOutputResults
                  resultKey={`${run.id}:op`}
                  data={{
                    ...run.outputData,
                    analyses: run.outputData.analyses.filter(
                      (analysis) => analysis.analysis === "op",
                    ),
                  }}
                  outputs={runPresentation?.outputs ?? []}
                />
              </>
            ) : null}
            {!run?.outputData &&
              run?.result?.data?.analyses
                .filter((analysis) => analysis.analysis === "op")
                .map((analysis, index) => (
                  <SimulationAnalysisCard key={index} kind="op">
                    <table>
                      <thead>
                        <tr>
                          <th>Vector</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.probes.map((probe) => (
                          <tr key={probe.name}>
                            <td>{probe.name}</td>
                            <td>
                              {probe.value.toPrecision(6)} {probe.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </SimulationAnalysisCard>
                ))}
            {!run?.result?.data?.analyses.some(
              (analysis) => analysis.analysis === "op",
            ) ? (
              <p className="simulation-empty-result">
                Run an operating-point analysis to see values.
              </p>
            ) : null}
          </div>
        ) : null}

        {resultTab === "compare" ? (
          <div className="simulation-comparison-view">
            {comparisonRuns.flatMap((candidate) =>
              [...resultRecordGroups(candidate.outputData)]
                .filter(([, records]) => records.length > 1)
                .map(([kind, records]) => (
                  <label key={`${candidate.id}:${kind}`}>
                    {candidate.label} · {kind.toUpperCase()} record
                    <select
                      aria-label={`${candidate.id} ${kind} comparison record`}
                      value={comparisonRecords[candidate.id]?.[kind] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setComparisonRecords((current) => ({
                          ...current,
                          [candidate.id]: {
                            ...current[candidate.id],
                            [kind]: value === "" ? undefined : Number(value),
                          },
                        }));
                      }}
                    >
                      <option value="">Choose before comparing…</option>
                      {records.map(({ index, analysis }) => (
                        <option key={index} value={index}>
                          {resultRecordLabel(index, analysis)}
                        </option>
                      ))}
                    </select>
                  </label>
                )),
            )}
            <SimulationWaveformComparison
              runs={comparisonRuns}
              actions={
                <div className="simulation-comparison-actions">
                  <button
                    type="button"
                    disabled={
                      !currentComparisonRun ||
                      retainedComparisonRuns.some(
                        (candidate) => candidate.id === currentComparisonRun.id,
                      ) ||
                      retainedComparisonRuns.length >= MAX_COMPARISON_RUNS - 1
                    }
                    onClick={retainCurrentComparison}
                  >
                    {retainedComparisonRuns.some(
                      (candidate) => candidate.id === currentComparisonRun?.id,
                    )
                      ? "Current kept"
                      : "Keep current"}
                  </button>
                  {retainedComparisonRuns.length ? (
                    <button
                      type="button"
                      onClick={() => setRetainedComparisonRuns([])}
                    >
                      Clear kept
                    </button>
                  ) : null}
                </div>
              }
            />
            {comparisonRuns.length < 2 && currentComparisonRun ? (
              <p className="simulation-comparison-hint">
                Keep this result, change the circuit or conditions, then run
                again to compare.
              </p>
            ) : null}
            <SimulationRunComparison
              runs={comparisonRuns}
              onRemove={(runId) =>
                setRetainedComparisonRuns((current) =>
                  current.filter((candidate) => candidate.id !== runId),
                )
              }
            />
            {archives.length ? (
              <section
                className="simulation-archive-list"
                aria-label="Saved result archives"
              >
                <header>
                  <strong>Browser archives</strong>
                  <small>Local to this browser · {archives.length}/10</small>
                </header>
                <ul>
                  {archives.map((archive) => (
                    <li key={archive.id}>
                      <span>
                        <strong>{archive.folderName}</strong>
                        <small>
                          {archive.analysisLabel} ·{" "}
                          {archive.environment.corner?.toUpperCase() ??
                            archive.environment.profileId}{" "}
                          · {new Date(archive.createdAt).toLocaleString()}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={artifactBusy !== undefined}
                        onClick={() => void openArchivedRun(archive.id)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete archived ${archive.folderName}`}
                        disabled={artifactBusy !== undefined}
                        onClick={() => void deleteArchivedRun(archive.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {resultTab === "console" ? (
          <div className="simulation-console-view">
            <div className="simulation-console-summary">
              <span>
                <small>Run</small>
                <strong>{statusLabel}</strong>
              </span>
              <span>
                <small>Input</small>
                <strong>{run?.inputStatus ?? "current"}</strong>
              </span>
              <span>
                <small>Analyses</small>
                <strong>{analysisLabel || "Not configured"}</strong>
              </span>
            </div>
            {run?.state === "lost" ? (
              <p>
                The executor response is unknown. Inspect its evidence before
                starting another run.
              </p>
            ) : null}
            {runPresentation?.prepared.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
            {run?.resultPreview ? (
              <p>
                The on-screen result is bounded; exported artifacts contain the
                complete data.
              </p>
            ) : null}
            {activeProblem ? (
              <SimulationProblemView
                problem={activeProblem}
                onSource={(source) => {
                  setResultsMaximized(false);
                  void codeRef.current?.reveal(source);
                }}
                {...(props.onFocusDiagnostic
                  ? { onFocus: props.onFocusDiagnostic }
                  : {})}
              />
            ) : null}
            {run?.result ? (
              <pre>
                {run.result.diagnostics
                  .map((diagnostic) => diagnostic.text)
                  .join("\n")}
                {"\n"}
                {run.result.log}
              </pre>
            ) : null}
            {!activeProblem && !run?.result ? (
              <p className="simulation-empty-result">
                Simulator diagnostics will appear here.
              </p>
            ) : null}
          </div>
        ) : null}

        {resultTab === "files" ? (
          <div
            className={`simulation-files-view${artifactPreview ? " preview-open" : ""}`}
          >
            <div className="simulation-file-browser">
              {artifactGroups.map((group) => (
                <section
                  key={group.key}
                  className="simulation-artifact-group"
                  aria-label={`${group.label} files`}
                >
                  <header>
                    <span>
                      <strong>{group.label}</strong>
                      <small>{group.description}</small>
                    </span>
                    <button
                      type="button"
                      disabled={artifactBusy !== undefined}
                      onClick={() =>
                        void downloadBundle(group.key, group.artifacts)
                      }
                    >
                      {artifactBusy === `bundle:${group.key}`
                        ? "Packing…"
                        : "Download ZIP"}
                    </button>
                  </header>
                  {artifactCategories.map((category) => {
                    const artifacts = group.artifacts.filter(
                      (artifact) =>
                        simulationArtifactCategory(artifact) === category,
                    );
                    return artifacts.length ? (
                      <details
                        key={category}
                        className="simulation-artifact-category"
                        aria-label={`${group.label} ${category}`}
                        open={category === "Results" || category === "Netlist"}
                      >
                        <summary>
                          <strong>{category}</strong>
                          <small>{artifacts.length}</small>
                        </summary>
                        <ul className="simulation-artifact-list">
                          {artifacts.map((artifact) => (
                            <li
                              key={artifact.id}
                              className={
                                artifactPreview?.artifact.id === artifact.id
                                  ? "selected"
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                title={`Preview ${artifact.name}`}
                                disabled={artifactBusy !== undefined}
                                onClick={() => void preview(artifact)}
                              >
                                {artifactBusy === `preview:${artifact.id}`
                                  ? "Opening…"
                                  : artifact.name}
                              </button>
                              <small>
                                {formatArtifactSize(artifact.byteLength)}
                              </small>
                              <button
                                type="button"
                                className="simulation-artifact-download"
                                aria-label={`Download ${artifact.name}`}
                                title={`Download ${artifact.name}`}
                                disabled={artifactBusy !== undefined}
                                onClick={() => void download(artifact)}
                              >
                                ↓
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null;
                  })}
                </section>
              ))}
            </div>
            {artifactPreview ? (
              <section
                className="simulation-artifact-preview"
                aria-label="File preview"
              >
                <header>
                  <span>
                    <strong>{artifactPreview.artifact.name}</strong>
                    <small>
                      {formatArtifactSize(artifactPreview.artifact.byteLength)}
                    </small>
                  </span>
                  <span>
                    <button
                      type="button"
                      disabled={artifactBusy !== undefined}
                      onClick={() => void download(artifactPreview.artifact)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      aria-label="Close file preview"
                      onClick={() => setArtifactPreview(undefined)}
                    >
                      ×
                    </button>
                  </span>
                </header>
                <pre>{formatSimulationArtifactPreview(artifactPreview)}</pre>
                {artifactPreview.truncated ? (
                  <footer>
                    Preview limited to the first 64 KB. Download for the
                    complete file.
                  </footer>
                ) : null}
              </section>
            ) : null}
            {artifactGroups.length === 0 ? (
              <p className="simulation-empty-result">
                Prepare a deck or run the simulation to create files.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );

  return (
    <section
      hidden={!open}
      className={`spice-simulation-surface${props.maximized ? " maximized" : ""}`}
      aria-label="Analog simulation"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Escape") return;
        if (batchMenuRef.current?.open) {
          batchMenuRef.current.removeAttribute("open");
        }
      }}
    >
      <header className="simulation-taskbar">
        <div className="simulation-brand">
          <strong>Simulation</strong>
          <span
            className={`simulation-status-chip simulation-status-${batch?.state ?? run?.state ?? (prepared ? "prepared" : "idle")}`}
            role="status"
          >
            {activeDirty ? "Source changed" : statusLabel}
          </span>
        </div>
        <div className="simulation-task-actions">
          {running ? (
            <button
              className="simulation-stop-button"
              disabled={
                batch?.state === "cancelling" || run?.state === "cancelling"
              }
              onClick={() => {
                if (batchRunning)
                  void session
                    .handle({ operation: "cancel-batch", batchId: batch.id })
                    .then(receive);
                else if (run)
                  void session
                    .handle({ operation: "cancel", runId: run.id })
                    .then(receive);
              }}
            >
              {batchRunning ? "Cancel batch" : "Cancel run"}
            </button>
          ) : selectedFolder ? (
            <button
              className="simulation-primary-button simulation-run-button"
              disabled={busy}
              onClick={() => void execute(true)}
              aria-label="Run"
              title={`Run ${selectedFolder.name}`}
            >
              ▶
            </button>
          ) : (
            <button
              className="simulation-primary-button"
              onClick={createFolder}
            >
              Set up
            </button>
          )}
          {batch ? (
            <details
              ref={batchMenuRef}
              className="simulation-batch-menu"
              onToggle={(event) => {
                if (event.currentTarget.open) batchMenuRef.current?.focus();
              }}
            >
              <summary
                aria-label={`Batch queue: ${batch.state}, ${finishedBatchItems} of ${batch.items.length} finished`}
                title="Batch queue"
              >
                <span aria-hidden="true">≡</span>
              </summary>
              <div className="simulation-batch-menu-popover">
                <header>
                  <strong>Batch · {batch.state}</strong>
                  <span>
                    {finishedBatchItems}/{batch.items.length}
                  </span>
                </header>
                <div className="simulation-batch-menu-items">
                  {batch.items.map((item) => {
                    const folder = project.simulationFolders.find(
                      (candidate) => candidate.id === item.folderId,
                    );
                    return (
                      <button
                        type="button"
                        key={item.id}
                        data-state={item.state}
                        disabled={item.state === "queued"}
                        onClick={() => void showBatchItem(item)}
                      >
                        <span>
                          {item.label ?? folder?.name ?? item.folderId}
                        </span>
                        <small>{item.state}</small>
                      </button>
                    );
                  })}
                </div>
                {!batchRunning ? (
                  <button type="button" onClick={() => setBatch(undefined)}>
                    Dismiss
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
        <div className="simulation-window-actions">
          <button
            className="simulation-minimize-button"
            onClick={props.onMinimize}
            aria-label="Minimize simulation"
            title="Minimize simulation"
          >
            <span className="simulation-minimize-glyph" aria-hidden="true" />
          </button>
          <button
            className="simulation-maximize-button"
            onClick={props.onToggleMaximized}
            aria-label={
              props.maximized
                ? "Restore simulation panel"
                : "Maximize simulation"
            }
            title={
              props.maximized
                ? "Restore simulation panel"
                : "Maximize simulation"
            }
          >
            {props.maximized ? "↙" : "□"}
          </button>
          <button
            className="simulation-close-button"
            onClick={async () => {
              if (
                await interaction.confirm({
                  title: "Exit Simulation?",
                  message:
                    "Unsaved source drafts and temporary run files will be discarded. An active run will be cancelled.",
                  acceptLabel: "Exit Simulation",
                })
              ) {
                codeRef.current?.discard();
                props.onExit();
              }
            }}
            aria-label="Exit simulation"
          >
            ×
          </button>
        </div>
      </header>

      {!selectedFolder && !hasDutInstance ? (
        <p className="simulation-context-hint">
          No DUT instance in this Cell · Edit → New Testbench Cell if needed.
        </p>
      ) : null}

      {selectedFolder ? (
        <SourceCodePane
          ref={codeRef}
          diagnostics={activeProblem?.diagnostics}
          project={project}
          folder={selectedFolder}
          selectedCircuitObject={props.selectedCircuitObject}
          {...(props.onPreviewSignal
            ? { onPreviewSignal: props.onPreviewSignal }
            : {})}
          files={session.files}
          {...{
            ...(props.pickedNet !== undefined
              ? { pickedNet: props.pickedNet }
              : {}),
            ...(props.pickedTerminal !== undefined
              ? { pickedTerminal: props.pickedTerminal }
              : {}),
          }}
          pickNetsActive={props.pickNetsActive ?? false}
          pickTerminalsActive={props.pickTerminalsActive ?? false}
          onPickNetsChange={(active) => props.onPickNetsChange?.(active)}
          onPickTerminalsChange={(active) =>
            props.onPickTerminalsChange?.(active)
          }
          actions={null}
          status={staleMessage || statusLabel}
          onDirty={setDirty}
          onActiveDirty={setActiveDirty}
          onProblem={setProblem}
          console={resultContent}
          results={resultContent}
          outputActions={outputActions}
          outputPane={resultTab}
          onSelectOutputPane={setResultTab}
          maximized={resultsMaximized}
          onToggleMaximize={toggleResultsMaximized}
          onRun={() => void execute(true)}
          onPrepare={() => void execute(false)}
          folders={{
            folders: project.simulationFolders.map((folder) => ({
              ...folder,
              configPath: folder.input.configPath,
              files: [
                ...folder.input.files.map((file) => ({
                  path: file.path,
                  kind: "authored" as const,
                })),
                ...folder.input.circuitBindings.map((binding) => ({
                  path: binding.path,
                  kind: "generated" as const,
                })),
              ],
            })),
            activeId: selectedFolder.id,
            busy: busy || !!running,
            onSelect: props.onSelectFolderId,
            onAction: (action, ids) => void folderAction(action, ids),
          }}
          onHistoryBoundary={props.onHistoryBoundary}
          onSaveProject={props.onSaveProject}
          projectSaveState={props.projectSaveState}
        />
      ) : (
        <div className="simulation-empty-result">
          {interaction.edit?.kind === "folder" ? <WorkspaceNameInput /> : null}
        </div>
      )}
    </section>
  );
}

function formatArtifactSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(byteLength < 10_240 ? 1 : 0)} KB`;
}
