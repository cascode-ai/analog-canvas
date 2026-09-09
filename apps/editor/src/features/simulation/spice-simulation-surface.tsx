import type { SimulationFocusTarget } from "./simulation-focus-target";
import { useEffect, useRef, useState } from "react";
import {
  type ProjectSimulationSetup,
  type SimulationOutputSpec,
  type SimulationRunPlanAxis,
  type SimulationStructuredInput,
} from "@icm/model";
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
  SimulationSetupSaveResult,
} from "./simulation-surface-types";
import { SetupEditor, DEVELOPMENT_PROFILE_ID } from "./simulation-setup-editor";
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

const RESULT_TABS = [
  ["plot", "Plot"],
  ["operating-point", "Operating Point"],
  ["compare", "Compare"],
  ["console", "Console"],
  ["files", "Files"],
] as const;

const MAX_COMPARISON_RUNS = 5;
type ResultTab = (typeof RESULT_TABS)[number][0];

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
  readonly setupId: string;
  readonly prepared: Prepared;
  readonly outputs: SimulationStructuredInput["outputs"];
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
  readonly setupName: string;
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
  const { session, project, open } = props;
  const selectedSetup = project.simulationSetups.find(
    (setup) => setup.id === props.selectedSetupId,
  );
  const activeSetupId = useRef(props.selectedSetupId);
  activeSetupId.current = props.selectedSetupId;
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const [batch, setBatch] = useState<SimulationBatch>();
  const [batchSelection, setBatchSelection] = useState<readonly string[]>([]);
  const hydratedBatchRuns = useRef(new Set<string>());
  const batchRuns = useRef(new Map<string, { prepared: Prepared; run: Run }>());
  const runDetails = useRef(new SimulationRunDetails());
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const preparedPresentations = useRef(new Map<string, PreparedPresentation>());
  const setupResults = useRef(
    new Map<string, { prepared?: Prepared; run?: Run }>(),
  );
  const [setupOpen, setSetupOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("plot");
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [deleteSetupId, setDeleteSetupId] = useState<string>();
  const [artifactPreview, setArtifactPreview] =
    useState<SimulationArtifactContent>();
  const [artifactBusy, setArtifactBusy] = useState<string>();
  const [canvasOpEnabled, setCanvasOpEnabled] = useState(false);
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
  const setupMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeSetupMenu = (event: PointerEvent): void => {
      if (setupMenuRef.current?.contains(event.target as Node)) return;
      setupMenuRef.current?.removeAttribute("open");
      setDeleteSetupId(undefined);
    };
    document.addEventListener("pointerdown", closeSetupMenu);
    return () => document.removeEventListener("pointerdown", closeSetupMenu);
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
  const previousSetupId = useRef<string | null>(props.selectedSetupId);
  useEffect(() => {
    if (previousSetupId.current === props.selectedSetupId) return;
    previousSetupId.current = props.selectedSetupId;
    const previous = props.selectedSetupId
      ? setupResults.current.get(props.selectedSetupId)
      : undefined;
    setPrepared(previous?.prepared);
    setRun(previous?.run);
    setProblem(undefined);
    setArtifactPreview(undefined);
    props.onOperatingPointProjection?.(null);
    setResultsOpen(!!previous?.run || !!previous?.prepared);
    setSetupOpen(!previous?.run && !previous?.prepared);
  }, [props.selectedSetupId]);
  useEffect(() => {
    if (!open || selectedSetup) return;
    setResultsOpen(false);
    setSetupOpen(true);
  }, [open, selectedSetup, props.activeDocumentId]);
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
      (selectedSetup?.id ?? null) !== activeSetupId.current
    )
      return;
    if (reply.ok && "run" in reply) {
      const owner = preparedPresentations.current.get(
        reply.run.preparedId,
      )?.setupId;
      if (owner !== activeSetupId.current) return;
    }
    if (!reply.ok) {
      setProblem(reply.error);
      if (selectedSetup) {
        setSetupOpen(false);
        setResultsOpen(true);
        setResultTab("console");
      } else {
        setSetupOpen(true);
        setResultsOpen(false);
      }
    } else if ("batch" in reply) {
      setBatch(reply.batch);
      setProblem(undefined);
    } else if ("run" in reply) {
      if (selectedSetup)
        setupResults.current.set(selectedSetup.id, {
          ...setupResults.current.get(selectedSetup.id),
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
          ),
        );
      } else props.onOperatingPointProjection?.(null);
      if (
        reply.run.result ||
        reply.run.error ||
        ["finished", "cancelled", "lost"].includes(reply.run.state)
      ) {
        setSetupOpen(false);
        setResultsOpen(true);
        setResultTab(preferredResultTab(reply.run));
      }
    } else if ("prepared" in reply) {
      if (selectedSetup)
        setupResults.current.set(selectedSetup.id, {
          ...setupResults.current.get(selectedSetup.id),
          prepared: reply.prepared,
        });
      setPrepared(reply.prepared);
      setProblem(undefined);
      setArtifactPreview(undefined);
      setSetupOpen(false);
      setResultsOpen(true);
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
    setBatchSelection((current) =>
      current.filter((id) =>
        project.simulationSetups.some((setup) => setup.id === id),
      ),
    );
  }, [project.simulationSetups]);
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
        setupResults.current.set(item.setupId, {
          prepared: item.prepared,
          run: runReply.run,
        });
        if (item.setupId === activeSetupId.current) {
          setPrepared(item.prepared);
          setRun(runReply.run);
          setResultsOpen(true);
          setSetupOpen(false);
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
    if (
      selectedSetup?.input.kind === "structured" &&
      selectedSetup.input.runPlan.mode === "sweep"
    ) {
      await executeSweep(selectedSetup.input.runPlan.axes, start);
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
          kind: "project-setup",
          setupId: selectedSetup!.id,
          expectedStructureRevision: project.structureRevision,
        },
      });
      if (reply.ok && "prepared" in reply) {
        const input = selectedSetup?.input;
        preparedPresentations.current.set(reply.prepared.id, {
          setupId: selectedSetup!.id,
          prepared: structuredClone(reply.prepared),
          outputs:
            input?.kind === "structured" ? structuredClone(input.outputs) : [],
          analysisLabel:
            input?.kind === "structured"
              ? input.analyses
                  .map((analysis) => analysis.kind.toUpperCase())
                  .join(" + ")
              : input?.kind === "raw"
                ? "RAW"
                : "",
          setupName: selectedSetup?.name ?? "Simulation",
          ...(input?.kind === "structured"
            ? { rootDocumentId: input.rootDocumentId }
            : {}),
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
  const executeBatch = async () => {
    if (lock.current) return;
    const setups = project.simulationSetups.filter((setup) =>
      batchSelection.includes(setup.id),
    );
    if (setups.length < 2) {
      setProblem(
        uiProblem(
          "SIMULATION_BATCH_SELECTION_REQUIRED",
          "Select at least two saved setups to run as a batch",
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
        expectedStructureRevision: project.structureRevision,
        items: setups.map((setup) => ({ id: setup.id, setupId: setup.id })),
      });
      receive(preparedReply);
      if (!preparedReply.ok || !("batch" in preparedReply)) return;
      for (const item of preparedReply.batch.items) {
        const setup = setups.find((candidate) => candidate.id === item.setupId);
        if (!setup) continue;
        const input = setup.input;
        preparedPresentations.current.set(item.prepared.id, {
          setupId: setup.id,
          prepared: structuredClone(item.prepared),
          outputs:
            input.kind === "structured" ? structuredClone(input.outputs) : [],
          analysisLabel:
            input.kind === "structured"
              ? input.analyses
                  .map((analysis) => analysis.kind.toUpperCase())
                  .join(" + ")
              : "RAW",
          setupName: setup.name,
          ...(input.kind === "structured"
            ? { rootDocumentId: input.rootDocumentId }
            : {}),
        });
        setupResults.current.set(setup.id, { prepared: item.prepared });
      }
      receive(
        await session.handle({
          operation: "start-batch",
          batchId: preparedReply.batch.id,
        }),
      );
      setupMenuRef.current?.removeAttribute("open");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const executeSweep = async (
    axes: readonly SimulationRunPlanAxis[],
    start: boolean,
  ) => {
    if (
      lock.current ||
      !selectedSetup ||
      selectedSetup.input.kind !== "structured"
    )
      return;
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    hydratedBatchRuns.current.clear();
    batchRuns.current.clear();
    try {
      const preparedReply = await session.handle({
        operation: "prepare-sweep",
        setupId: selectedSetup.id,
        expectedStructureRevision: project.structureRevision,
        axes: [...axes],
      });
      receive(preparedReply);
      if (!preparedReply.ok || !("batch" in preparedReply)) return;
      for (const item of preparedReply.batch.items) {
        preparedPresentations.current.set(item.prepared.id, {
          setupId: selectedSetup.id,
          prepared: structuredClone(item.prepared),
          outputs: structuredClone(selectedSetup.input.outputs),
          analysisLabel: selectedSetup.input.analyses
            .map((analysis) => analysis.kind.toUpperCase())
            .join(" + "),
          setupName: item.label ?? selectedSetup.name,
          rootDocumentId: selectedSetup.input.rootDocumentId,
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
      setupMenuRef.current?.removeAttribute("open");
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
      setSetupOpen(false);
      setResultsOpen(true);
      setResultTab("files");
      if (presentation)
        setupResults.current.set(item.setupId, { prepared: item.prepared });
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
    if (item.setupId !== activeSetupId.current)
      props.onSelectSetupId(item.setupId);
    setPrepared(resolved.prepared);
    setRun(resolved.run);
    setSetupOpen(false);
    setResultsOpen(true);
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
      !selectedSetup ||
      !runPresentation ||
      selectedSetup.id !== runPresentation.setupId
    )
      return;
    setArtifactBusy("archive:save");
    const captured = await captureSimulationRunArchive(session.files, {
      projectId: project.id,
      setup: selectedSetup,
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
    setupResults.current.set(stored.value.presentation.setupId, {
      prepared: restored.value.prepared,
      run: restored.value.run,
    });
    if (
      stored.value.presentation.setupId !== selectedSetup?.id &&
      project.simulationSetups.some(
        (setup) => setup.id === stored.value!.presentation.setupId,
      )
    )
      props.onSelectSetupId(stored.value.presentation.setupId);
    setPrepared(restored.value.prepared);
    setRun(restored.value.run);
    setProblem(undefined);
    setSetupOpen(false);
    setResultsOpen(true);
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
  const attention = activeProblem || staleMessage;
  const problemSearchText = activeProblem
    ? [
        activeProblem.code,
        activeProblem.message,
        ...(activeProblem.diagnostics ?? []).flatMap((diagnostic) => [
          diagnostic.code,
          diagnostic.message,
        ]),
      ].join(" ")
    : "";
  const attentionSummary = activeProblem
    ? activeProblem.code === "SIMULATION_CAPABILITIES_UNAVAILABLE"
      ? "Simulation service is unavailable in this environment."
      : /probe/i.test(problemSearchText)
        ? "The probe selection needs attention. Open Console for details."
        : activeProblem.stage === "input"
          ? `${activeProblem.code}: ${activeProblem.message}`
          : "Simulation needs attention. Open Console for details."
    : staleMessage;
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
        )
      : undefined;
  const currentComparisonRun: SimulationComparisonRun | undefined =
    run?.outputData && runPresentation
      ? {
          id: run.id,
          label: runPresentation.setupName,
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
            label: presentation.setupName,
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
  ].slice(-MAX_COMPARISON_RUNS);
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
  const createSetup = (): void => {
    const baseName = "Setup";
    let suffix = project.simulationSetups.length + 1;
    while (
      project.simulationSetups.some(
        (setup) => setup.name === `${baseName} ${suffix}`,
      )
    )
      suffix++;
    const created: ProjectSimulationSetup = {
      id: `simulation-setup-${crypto.randomUUID()}`,
      name: `${baseName} ${suffix}`,
      version: 3,
      input: selectedSetup
        ? structuredClone(selectedSetup.input)
        : {
            kind: "structured",
            rootDocumentId: props.activeDocumentId,
            analyses: [{ kind: "op" }],
            outputs: [],
            designVariables: [],
            runPlan: { mode: "nominal" },
            environment: {
              profileId:
                capabilities?.profiles[0]?.id ?? DEVELOPMENT_PROFILE_ID,
            },
          },
    };
    const result = props.onSaveSetup(created);
    if (result.status !== "rejected") {
      props.onSelectSetupId(created.id);
      setupMenuRef.current?.removeAttribute("open");
    } else setProblem(result.problem);
  };
  return (
    <section
      hidden={!open}
      className={`spice-simulation-surface${props.maximized ? " maximized" : ""}`}
      aria-label="Analog simulation"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Escape") return;
        if (setupMenuRef.current?.open) {
          setupMenuRef.current.removeAttribute("open");
          setDeleteSetupId(undefined);
        } else props.onMinimize();
      }}
    >
      <header className="simulation-taskbar">
        <div className="simulation-brand">
          <strong>Simulation</strong>
          <span
            className={`simulation-status-chip simulation-status-${batch?.state ?? run?.state ?? (prepared ? "prepared" : "idle")}`}
            role="status"
          >
            {dirty ? "Setup changed" : statusLabel}
          </span>
        </div>
        <div className="simulation-task-actions">
          <details
            ref={setupMenuRef}
            className="simulation-setup-menu"
            onToggle={(event) => {
              if (!event.currentTarget.open) setDeleteSetupId(undefined);
            }}
          >
            <summary aria-label="Simulation setup" title="Simulation setup">
              <span>{selectedSetup?.name ?? "Setup"}</span>
            </summary>
            <div className="simulation-setup-menu-popover">
              <button
                type="button"
                className="simulation-setup-menu-new"
                disabled={dirty || busy || !!running}
                onClick={createSetup}
              >
                New setup
              </button>
              {project.simulationSetups.length > 1 && capabilities?.batch ? (
                <button
                  type="button"
                  className="simulation-setup-menu-batch"
                  disabled={
                    dirty || busy || !!running || batchSelection.length < 2
                  }
                  onClick={() => void executeBatch()}
                >
                  Run selected ({batchSelection.length})
                </button>
              ) : null}
              {project.simulationSetups.map((setup) => (
                <div
                  key={setup.id}
                  className="simulation-setup-menu-row"
                  data-selected={setup.id === selectedSetup?.id}
                >
                  {capabilities?.batch ? (
                    <input
                      type="checkbox"
                      aria-label={`Include ${setup.name} in batch`}
                      checked={batchSelection.includes(setup.id)}
                      disabled={dirty || busy || !!running}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setBatchSelection((current) =>
                          checked
                            ? [...current, setup.id]
                            : current.filter((id) => id !== setup.id),
                        );
                      }}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="simulation-setup-menu-select"
                    disabled={dirty || busy || !!running}
                    onClick={() => {
                      props.onSelectSetupId(setup.id);
                      setupMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {setup.name}
                  </button>
                  {deleteSetupId === setup.id ? (
                    <span className="simulation-setup-delete-confirmation">
                      <button
                        type="button"
                        className="simulation-setup-delete-confirm"
                        disabled={busy || !!running}
                        onClick={() => {
                          if (props.onDeleteSetup(setup.id)) {
                            if (setup.id === selectedSetup?.id) setDirty(false);
                            setDeleteSetupId(undefined);
                          }
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteSetupId(undefined)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="simulation-setup-delete"
                      aria-label={`Delete ${setup.name}`}
                      title={`Delete ${setup.name}`}
                      disabled={busy || !!running}
                      onClick={() => setDeleteSetupId(setup.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
          <button
            type="button"
            className="simulation-settings-button"
            aria-pressed={setupOpen}
            onClick={() => {
              setResultsOpen(false);
              setSetupOpen(true);
            }}
          >
            Settings
          </button>
          <button
            type="button"
            aria-pressed={resultsOpen}
            onClick={() => {
              setSetupOpen(false);
              setResultsOpen(true);
            }}
          >
            Results
          </button>
          <button
            disabled={busy || !!running || dirty || !selectedSetup}
            onClick={() => void execute(false)}
          >
            Prepare deck
          </button>
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
          ) : selectedSetup ? (
            <button
              className="simulation-primary-button simulation-run-button"
              disabled={busy || dirty}
              onClick={() => void execute(true)}
              aria-label="Run"
              title="Run"
            >
              ▶
            </button>
          ) : (
            <button
              className="simulation-primary-button"
              onClick={() => {
                setResultsOpen(false);
                setSetupOpen(true);
              }}
            >
              Set up
            </button>
          )}
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
            onClick={() => setExitConfirmationOpen(true)}
            aria-label="Exit simulation"
          >
            ×
          </button>
        </div>
      </header>

      {batch ? (
        <div className="simulation-batch-strip" role="status">
          <strong>Batch · {batch.state}</strong>
          <div>
            {batch.items.map((item) => {
              const setup = project.simulationSetups.find(
                (candidate) => candidate.id === item.setupId,
              );
              return (
                <button
                  type="button"
                  key={item.id}
                  data-state={item.state}
                  disabled={item.state === "queued"}
                  onClick={() => void showBatchItem(item)}
                >
                  {item.label ?? setup?.name ?? item.setupId} · {item.state}
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
      ) : null}

      {!selectedSetup && !hasDutInstance ? (
        <p className="simulation-context-hint">
          No DUT instance in this Cell · Edit → New Testbench Cell if needed.
        </p>
      ) : null}

      {exitConfirmationOpen ? (
        <div className="simulation-exit-confirmation" role="alertdialog">
          <strong>Exit Simulation?</strong>
          <p>
            Unapplied setup changes and temporary run files will be discarded.
            An active run will be cancelled.
          </p>
          <div>
            <button onClick={() => setExitConfirmationOpen(false)}>
              Keep working
            </button>
            <button className="simulation-stop-button" onClick={props.onExit}>
              Exit Simulation
            </button>
          </div>
        </div>
      ) : null}

      {attention ? (
        <div className="simulation-workspace-notice" role="alert">
          <span>{attentionSummary}</span>
          {activeProblem?.recovery === "retry-after" && !run ? (
            <button
              onClick={() =>
                void session.handle({ operation: "capabilities" }).then(receive)
              }
            >
              Retry connection
            </button>
          ) : null}
          {activeProblem?.recovery === "retry-same-request" && run ? (
            <button
              onClick={() =>
                void session
                  .handle({ operation: "read", runId: run.id })
                  .then(receive)
              }
            >
              Refresh run status
            </button>
          ) : null}
        </div>
      ) : capabilities?.configured === false ? (
        <div className="simulation-workspace-notice">
          Simulator not configured. You can still edit the Project and setup.
        </div>
      ) : null}

      {setupOpen ? (
        <SetupEditor
          key={selectedSetup?.id ?? `unsaved:${props.activeDocumentId}`}
          {...props}
          setup={selectedSetup}
          capabilities={capabilities}
          onDirty={setDirty}
          onProblem={setProblem}
        />
      ) : null}

      {resultsOpen ? (
        <section
          className="simulation-results-dock"
          aria-label="Simulation results"
        >
          <header className="simulation-results-header">
            <div role="tablist" aria-label="Result views">
              {RESULT_TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={resultTab === id}
                  onClick={() => setResultTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {run ? (
              <div className="simulation-result-actions">
                <button
                  type="button"
                  disabled={
                    artifactBusy !== undefined ||
                    (!run.result && !run.outputData) ||
                    !selectedSetup ||
                    selectedSetup.id !== runPresentation?.setupId
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
          </header>
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
                        enabled && canvasOpProjection
                          ? canvasOpProjection
                          : null,
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
                <SimulationWaveformComparison
                  runs={comparisonRuns}
                  actions={
                    <div className="simulation-comparison-actions">
                      <button
                        type="button"
                        disabled={
                          !currentComparisonRun ||
                          retainedComparisonRuns.some(
                            (candidate) =>
                              candidate.id === currentComparisonRun.id,
                          ) ||
                          retainedComparisonRuns.length >=
                            MAX_COMPARISON_RUNS - 1
                        }
                        onClick={retainCurrentComparison}
                      >
                        {retainedComparisonRuns.some(
                          (candidate) =>
                            candidate.id === currentComparisonRun?.id,
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
                      <small>
                        Local to this browser · {archives.length}/10
                      </small>
                    </header>
                    <ul>
                      {archives.map((archive) => (
                        <li key={archive.id}>
                          <span>
                            <strong>{archive.setupName}</strong>
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
                            aria-label={`Delete archived ${archive.setupName}`}
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
                    The executor response is unknown. Inspect its evidence
                    before starting another run.
                  </p>
                ) : null}
                {runPresentation?.prepared.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
                {run?.resultPreview ? (
                  <p>
                    The on-screen result is bounded; exported artifacts contain
                    the complete data.
                  </p>
                ) : null}
                {activeProblem ? (
                  <SimulationProblemView
                    problem={activeProblem}
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
                            open={
                              category === "Results" || category === "Netlist"
                            }
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
                          {formatArtifactSize(
                            artifactPreview.artifact.byteLength,
                          )}
                        </small>
                      </span>
                      <span>
                        <button
                          type="button"
                          disabled={artifactBusy !== undefined}
                          onClick={() =>
                            void download(artifactPreview.artifact)
                          }
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
                    <pre>
                      {formatSimulationArtifactPreview(artifactPreview)}
                    </pre>
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
      ) : null}
    </section>
  );
}

function formatArtifactSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(byteLength < 10_240 ? 1 : 0)} KB`;
}
