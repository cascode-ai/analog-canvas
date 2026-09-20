import {
  SimulationAgentGuidance,
  SimulationAgentStart,
} from "./simulation-agent-guidance";
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
import { profileEngine } from "@icm/simulation-service";
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
import { SimulationExampleCards } from "./simulation-example-cards";
export type {
  SpiceSimulationSurfaceProps,
  SimulationFolderSaveResult,
} from "./simulation-surface-types";
import {
  SourceCodePane,
  type SourceCodeHandle,
  type SourceFlush,
} from "./source-code-pane";
import {
  sourcePresentation,
  type SimulationPresentationOutput as SimulationOutputSpec,
} from "./source-presentation";
import { SimulationSpecResults } from "./simulation-spec-results";
import { sha256 } from "@icm/simulation-service/files";
import { SimulationProblemView } from "./simulation-problem-view";
import { SimulationRunDetails } from "./simulation-run-details";
import { SimulationActionIcon } from "./simulation-action-icon";
import {
  buildSimulationArtifactArchive,
  buildSimulationWorkspaceArchive,
  readSimulationArtifact,
  readSimulationArtifactPreview,
  type SimulationArtifactContent,
} from "./simulation-artifact-files";
import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import {
  captureSimulationRunArchive,
  restoreSimulationRunArchive,
  type SimulationRunArchiveSummary,
} from "./simulation-run-archive";

type ResultTab = SimulationCodeWorkspaceProps["outputPane"];

function preferredResultTab(run: Run): ResultTab {
  return run.state === "finished" ? "specs" : "console";
}

interface PreparedPresentation {
  readonly folderId: string;
  readonly prepared: Prepared;
  readonly outputs: SimulationOutputSpec[];
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
  readonly folderName: string;
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
  const [sharedRuns, setSharedRuns] = useState(
    () => props.runHistory?.snapshot() ?? [],
  );
  useEffect(() => {
    const history = props.runHistory;
    setSharedRuns(history?.snapshot() ?? []);
    return history?.subscribe(() => setSharedRuns(history.snapshot()));
  }, [props.runHistory]);
  const selectedFolder = project.simulationFolders.find(
    (folder) => folder.id === props.selectedFolderId,
  );
  const activeFolderId = useRef(props.selectedFolderId);
  activeFolderId.current = props.selectedFolderId;
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const openedProjectFiles = useRef(new Map<string, string>());
  const openedProjectFile = run
    ? openedProjectFiles.current.get(run.id)
    : undefined;
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
  const [resultTab, setResultTab] = useState<ResultTab>("specs");

  const [artifactPreview, setArtifactPreview] =
    useState<SimulationArtifactContent>();
  const [artifactBusy, setArtifactBusy] = useState<string>();
  const artifactRequest = useRef(0);
  const closeArtifact = () => {
    artifactRequest.current += 1;
    setArtifactPreview(undefined);
    setArtifactBusy((busy) =>
      busy?.startsWith("preview:") ? undefined : busy,
    );
  };
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
  useEffect(() => {
    let stopped = false;
    void archiveStore.list(project.id).then((result) => {
      if (!stopped && result.ok) setArchives(result.value);
    });
    return () => {
      stopped = true;
    };
  }, [archiveStore, project.id, open, sharedRuns]);
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
    closeArtifact();
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
      if (selectedFolder) setResultTab("console");
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
      closeArtifact();
      setResultTab("console");
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
  const execute = async (start: boolean, inspect = false) => {
    if (lock.current) return;
    const authored = await codeRef.current?.flush();
    if (!authored?.ok) return;
    const selectedConfig = readSimulationExperimentConfig(authored.folder);
    if (selectedConfig.ok && selectedConfig.config.runPlan.mode === "sweep") {
      await executeSweep(
        selectedConfig.config.runPlan.axes,
        start,
        authored,
        inspect,
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
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
      if (
        inspect &&
        reply.ok &&
        "prepared" in reply &&
        alive.current &&
        activeFolderId.current === authored.folder.id
      ) {
        const deck = reply.prepared.artifacts.find(
          (artifact) => artifact.name === "prepared.cir",
        );
        if (deck) await preview(deck);
      }
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
    if (new Set(selection).size < 2) {
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
      const authored = await codeRef.current?.flushFolders(selection);
      if (!authored?.ok) return;
      const folders = authored.folders;
      const preparedReply = await session.handle({
        operation: "prepare-batch",
        expectedStructureRevision: authored.revision,
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
          ...sourcePresentation(folder),
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
    inspect = false,
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
        if (first) {
          await showBatchItem(first);
          if (
            inspect &&
            alive.current &&
            activeFolderId.current === authored.folder.id
          ) {
            const deck = first.prepared.artifacts.find(
              (artifact) => artifact.name === "prepared.cir",
            );
            if (deck) await preview(deck);
          }
        }
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
      closeArtifact();
      setResultTab("console");
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
    const request = ++artifactRequest.current;
    setArtifactBusy(`preview:${artifact.id}`);
    const result = await readSimulationArtifactPreview(session.files, artifact);
    if (request !== artifactRequest.current) return;
    setArtifactBusy((busy) =>
      busy === `preview:${artifact.id}` ? undefined : busy,
    );
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setArtifactPreview(result.content);
  };
  const downloadBundle = async (
    key: "diagnostics" | "run",
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
    const shared = sharedRuns.find((item) => item.id === run.id);
    const existing = shared?.memoryArchive
      ? { ok: true as const, value: shared.memoryArchive }
      : shared?.archive
        ? await archiveStore.read(shared.archive.id)
        : undefined;
    if (existing && (!existing.ok || !existing.value)) {
      setArtifactBusy(undefined);
      setProblem(
        uiProblem(
          "SIMULATION_ARCHIVE_UNAVAILABLE",
          "The existing run archive could not be read; its evidence has not been replaced",
        ),
      );
      return;
    }
    const saved = await archiveStore.save(
      existing?.value ?? {
        ...captured.value,
        id: `run-${run.id}`,
        ...(openedProjectFile ? { projectFile: openedProjectFile } : {}),
      },
    );
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
    const memoryArchive = sharedRuns.find(
      (item) => item.archive?.id === archiveId,
    )?.memoryArchive;
    const stored = memoryArchive
      ? { ok: true as const, value: memoryArchive }
      : await archiveStore.read(archiveId);
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
    if (stored.value.projectFile)
      openedProjectFiles.current.set(
        restored.value.run.id,
        stored.value.projectFile,
      );
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
    props.runHistory?.forgetArchive(archiveId);
  };
  const batchRunning = batch && ["running", "cancelling"].includes(batch.state);
  const running =
    (run && ["running", "cancelling"].includes(run.state)) || batchRunning;
  const finishedBatchItems =
    batch?.items.filter((item) =>
      ["finished", "failed", "cancelled", "lost"].includes(item.state),
    ).length ?? 0;
  const statusLabel = busy
    ? "Preparing…"
    : batch
      ? `Batch ${batch.state} · ${finishedBatchItems}/${batch.items.length}`
      : run
        ? run.state === "finished"
          ? (run.result?.outcome.status ?? run.state)
          : run.state
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
  const runPreparedArtifactIds = new Set(
    runPresentation?.prepared.artifacts.map((artifact) => artifact.id) ?? [],
  );
  const artifactGroups = [
    {
      key: "run" as const,
      label: "Run",
      description: "Execution output",
      artifacts:
        run?.artifacts.filter(
          (artifact) => !runPreparedArtifactIds.has(artifact.id),
        ) ?? [],
    },
  ];
  // A run's diagnostics must stay tied to that run, never a newer prepared input.
  const diagnosticArtifacts = run?.artifacts ?? prepared?.artifacts ?? [];
  const executedDeck = run?.artifacts.find(
    (artifact) => artifact.name === "executed.cir",
  );
  const diagnosticActions = [
    {
      label: "Download complete run…",
      disabled: !run || !!artifactBusy,
      run: () => void downloadBundle("run", run?.artifacts ?? []),
    },
    {
      label: "Download project + results…",
      disabled: !run || !openedProjectFile || !!artifactBusy,
      run: async () => {
        if (!run || !openedProjectFile) return;
        setArtifactBusy("bundle:project");
        const result = await buildSimulationWorkspaceArchive(session.files, [
          {
            kind: "text",
            path: "project.icproj.json",
            text: openedProjectFile,
          },
          ...run.artifacts.map((artifact) => ({
            kind: "artifact" as const,
            path: `results/${artifact.name}`,
            artifact,
          })),
        ]);
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
        anchor.download = "project-with-results.zip";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    },
    {
      label: "Archive current run",
      disabled: !run || !!artifactBusy,
      run: () => void archiveCurrentRun(),
    },
    {
      label: "Preview input netlist…",
      disabled: busy || running,
      run: () => void execute(false, true),
    },
    {
      label: "View executed netlist…",
      disabled: !executedDeck || artifactBusy !== undefined,
      run: () => {
        if (executedDeck) void preview(executedDeck);
      },
    },
    {
      label: "Export diagnostic bundle…",
      disabled: diagnosticArtifacts.length === 0 || artifactBusy !== undefined,
      run: () => void downloadBundle("diagnostics", diagnosticArtifacts),
    },
  ];
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
    const selection = await interaction.name({
      kind: "folder",
      ...(action === "rename" && current ? { folderId: current.id } : {}),
      label: action === "rename" ? "Folder name" : "New simulation folder name",
      ...(action === "new" && capabilities?.profiles.length
        ? {
            profiles: capabilities.profiles.map((profile) => ({
              id: profile.id,
              name: profile.label ?? profile.id,
            })),
          }
        : {}),
      ...(action === "new"
        ? {
            cellSelection: {
              initial: props.activeDocumentId,
              options: latestProject.documents.map(({ id, name }) => ({
                id,
                name,
              })),
              validate: (documentId: string) =>
                session
                  .currentProject()
                  ?.documents.some((cell) => cell.id === documentId)
                  ? undefined
                  : "Select an existing Cell for this experiment.",
            },
          }
        : {}),
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
      initial:
        action === "rename"
          ? (current?.name ?? "")
          : action === "duplicate"
            ? `${current?.name} copy`
            : `Simulation ${latestProject.simulationFolders.length + 1}`,
    });
    if (!selection) return;
    const identity = {
      id:
        action === "rename" && current
          ? current.id
          : `simulation-folder-${crypto.randomUUID()}`,
      name: selection.name,
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
      // Creation is non-modal: never silently substitute a different Cell if
      // the selected one disappeared while the user was naming the folder.
      if (
        !selection.documentId ||
        !namingProject.documents.some(
          (cell) => cell.id === selection.documentId,
        )
      ) {
        setProblem(
          uiProblem(
            "SIMULATION_STARTER_INVALID",
            "The selected Cell no longer exists. Select a Cell and create the experiment again.",
          ),
        );
        return;
      }
      const profile =
        capabilities?.profiles.find((p) => p.id === selection.profileId) ??
        capabilities?.profiles[0];
      const engine = profile
        ? profileEngine(profile, capabilities?.rawfileCollection)
        : "vacask";
      if (!engine) {
        setProblem(
          uiProblem(
            "SIMULATION_ENGINE_UNAVAILABLE",
            "The selected Profile does not declare an execution dialect.",
          ),
        );
        return;
      }
      const result = createSimulationStarter(namingProject, {
        ...identity,
        mode: "circuit",
        documentId: selection.documentId,
        // Offline authoring uses the same candidate as the native starters.
        // Prepare still requires that the connected service advertises it.
        profileId: profile?.id ?? "vacask-sky130-candidate",
        engine,
        template: "op",
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
  const revealSpec = async (source: {
    path: string;
    line: number;
    text: string;
  }) => {
    const file = selectedFolder?.input.files.find(
      (f) => f.path === source.path,
    );
    if (!file || file.text.split(/\r?\n/)[source.line - 1] !== source.text) {
      setProblem(
        uiProblem(
          "SPEC_SOURCE_CHANGED",
          "This specification belongs to an earlier source snapshot. Open that run's executed source.",
        ),
      );
      setResultTab("console");
      return;
    }
    const lines = file.text.split("\n");
    const startOffset = lines
      .slice(0, source.line - 1)
      .reduce((sum, line) => sum + line.length + 1, 0);
    setResultsMaximized(false);
    await codeRef.current?.reveal({
      scope: "authored",
      path: source.path,
      textDigest: await sha256(file.text),
      startOffset,
      endOffset: startOffset + source.text.length,
      line: source.line,
      column: 1,
    });
  };
  const historyContent = (
    <details className="simulation-run-history">
      <summary>Run history</summary>{" "}
      {archives.some(
        (item) =>
          item.folderId === selectedFolder?.id &&
          !sharedRuns.some((run) => run.archive?.id === item.id),
      ) ? (
        <section
          className="simulation-archive-list"
          aria-label="Saved folder results"
        >
          <strong>Saved results · this browser</strong>
          <ul>
            {archives
              .filter(
                (item) =>
                  item.folderId === selectedFolder?.id &&
                  !sharedRuns.some((run) => run.archive?.id === item.id),
              )
              .map((item) => (
                <li key={item.id}>
                  <span>
                    {item.origin === "agent" ? "Agent · " : ""}
                    {item.folderName} · {item.state ?? "saved"} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    disabled={artifactBusy !== undefined}
                    onClick={() => void openArchivedRun(item.id)}
                  >
                    Open result
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete saved result ${item.id}`}
                    onClick={() => void deleteArchivedRun(item.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      {sharedRuns.some(
        (item) => item.presentation.folderId === selectedFolder?.id,
      ) ? (
        <section className="simulation-archive-list" aria-label="Project runs">
          <strong>Project runs · automatically archived in this browser</strong>
          <ul>
            {sharedRuns
              .filter(
                (item) => item.presentation.folderId === selectedFolder?.id,
              )
              .map((item) => (
                <li key={item.id}>
                  <span>
                    {item.owner === "agent" ? "Agent" : "You"} ·{" "}
                    {item.presentation.folderName} ·{" "}
                    {item.presentation.analysisLabel} · {item.state}
                    {item.error ? (
                      <small role="status">{item.error}</small>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    disabled={!item.archive || artifactBusy !== undefined}
                    onClick={() =>
                      item.archive && void openArchivedRun(item.archive.id)
                    }
                  >
                    Open result
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </details>
  );
  const resultContent = (
    <section
      className="simulation-results-dock"
      aria-label="Simulation results"
    >
      <div className="simulation-results-body">
        {run && archivedRunIds.current.has(run.id) ? (
          <p>
            Viewing a saved input snapshot, not a new run of the current source.
          </p>
        ) : null}
        {resultTab === "specs" ? (
          <SimulationSpecResults
            report={run?.outputData?.specs}
            hasRun={!!run?.result}
            stale={activeDirty || run?.inputStatus === "changed"}
            onSource={revealSpec}
          />
        ) : null}
        {resultTab === "console" ? (
          <div className="simulation-console-view">
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
      </div>
    </section>
  );

  const simulationActions = (
    <div className="simulation-task-actions">
      {running ? (
        <button
          className="simulation-stop-button simulation-action-button"
          aria-label={batchRunning ? "Cancel batch" : "Cancel run"}
          title={batchRunning ? "Cancel batch" : "Cancel run"}
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
          <SimulationActionIcon kind="stop" />
        </button>
      ) : selectedFolder ? (
        <button
          className="simulation-action-button simulation-run-button"
          aria-busy={busy}
          disabled={busy}
          onClick={() => void execute(true)}
          aria-label="Run"
          title={`Run ${selectedFolder.name} / ${selectedFolder.input.entry}`}
          aria-description={`Run ${selectedFolder.name} / ${selectedFolder.input.entry}`}
        >
          <SimulationActionIcon kind={busy ? "saving" : "run"} />
          <span className="simulation-run-target">{selectedFolder.name}</span>
        </button>
      ) : (
        <button className="simulation-setup-button" onClick={createFolder}>
          Manual setup
        </button>
      )}
      <span
        className={`simulation-status-chip simulation-status-${batch?.state ?? run?.state ?? (prepared ? "prepared" : "idle")}`}
        role="status"
      >
        {activeDirty ? "Source changed" : statusLabel}
      </span>
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
                    <span>{item.label ?? folder?.name ?? item.folderId}</span>
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
  );
  const windowActions = (
    <>
      {props.agentGuidance && selectedFolder ? (
        <SimulationAgentGuidance {...props.agentGuidance} />
      ) : null}
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
            props.maximized ? "Restore simulation panel" : "Maximize simulation"
          }
          title={
            props.maximized ? "Restore simulation panel" : "Maximize simulation"
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
    </>
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
      {!selectedFolder ? (
        <header className="simulation-taskbar">
          {props.agentGuidance ? (
            <strong className="simulation-start-title">Simulation</strong>
          ) : (
            simulationActions
          )}
          {windowActions}
        </header>
      ) : null}

      {selectedFolder ? (
        <SourceCodePane
          ref={codeRef}
          capabilities={capabilities}
          diagnostics={activeProblem?.diagnostics}
          project={project}
          activeDocumentId={props.activeDocumentId}
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
          actions={simulationActions}
          toolbarEnd={windowActions}
          status={staleMessage}
          onDirty={setDirty}
          onActiveDirty={setActiveDirty}
          onProblem={setProblem}
          console={resultContent}
          results={resultContent}
          history={historyContent}
          artifactGroups={artifactGroups}
          artifactPreview={artifactPreview}
          artifactBusy={artifactBusy}
          onSelectArtifact={(artifact) => void preview(artifact)}
          onCloseArtifact={closeArtifact}
          onDownloadArtifact={(artifact) => void download(artifact)}
          outputPane={resultTab}
          onSelectOutputPane={setResultTab}
          maximized={resultsMaximized}
          onToggleMaximize={toggleResultsMaximized}
          onRun={() => void execute(true)}
          additionalActions={diagnosticActions}
          folders={{
            folders: project.simulationFolders.map((folder) => ({
              ...folder,
              configPath: folder.input.configPath,
              cellLabel: folder.input.circuitBindings.length
                ? "Cell: " +
                  [
                    ...new Set(
                      folder.input.circuitBindings.map(
                        (binding) =>
                          project.documents.find(
                            (cell) => cell.id === binding.documentId,
                          )?.name ?? `Missing (${binding.documentId})`,
                      ),
                    ),
                  ].join(", ")
                : "No Canvas Cell",
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
        />
      ) : (
        <div className="simulation-start-workspace">
          {props.agentGuidance ? (
            <SimulationAgentStart
              {...props.agentGuidance}
              onManualSetup={createFolder}
            />
          ) : null}
          {interaction.edit?.kind === "folder" ? <WorkspaceNameInput /> : null}
          {!project.simulationFolders.length && props.onOpenExample ? (
            <details className="simulation-start-examples">
              <summary>Explore examples</summary>
              <SimulationExampleCards onOpen={props.onOpenExample} />
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
