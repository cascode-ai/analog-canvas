import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type ObjectLocator,
  SimulationSetupSchema,
  type CircuitProject,
  type SimulationSetup,
  type SimulationStructuredInput,
} from "@icm/model";
import type {
  ArtifactRef,
  Capabilities,
  Prepared,
  Problem,
  Run,
  SimulationReply,
} from "@icm/simulation-service/contract";
import { downloadTextArtifact } from "../../document/project-file-service";
import type { BrowserSimulationSession } from "./browser-simulation-session";
import { AcResultsExplorer } from "./ac-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";
import {
  deriveSimulationProbeOptions,
  matchSimulationVoltageProbeOptions,
  simulationProbeTargetKey,
  type SimulationProbeOption,
} from "./simulation-probe-options";

const RESULT_TABS = [
  ["summary", "Summary"],
  ["plot", "Plot"],
  ["operating-point", "Operating Point"],
  ["console", "Console"],
  ["files", "Files"],
] as const;

// Vite's UI-only development server has no execution capabilities endpoint.
// Keep its single Preview profile visible for setup authoring; a deployed
// executor's advertised profiles remain authoritative whenever available.
const DEVELOPMENT_PROFILE_ID = import.meta.env.DEV
  ? "sky130-core-continuous-ngspice46-v1"
  : "";
type ResultTab = (typeof RESULT_TABS)[number][0];

export interface SpiceSimulationSurfaceProps {
  open: boolean;
  project: CircuitProject;
  activeDocumentId: string;
  draftContext?: {
    readonly dutDocumentId: string;
    readonly rootDocumentId: string;
  };
  session: BrowserSimulationSession;
  onMinimize(): void;
  onExit(): void;
  onSaveSetup(setup: SimulationSetup | null): boolean;
  onOpenCell(documentId: string): void;
  pickNetsActive?: boolean;
  pickedNet?: {
    readonly sequence: number;
    readonly documentId: string;
    readonly netId: string;
    /** Instance ids from the selected Testbench root to this Cell. */
    readonly occurrence?: readonly string[];
  } | null;
  onPickNetsChange?(active: boolean): void;
  onFocusProbe?(
    probe: SimulationStructuredInput["probes"][number],
    rootDocumentId?: string,
  ): void;
  onFocusDiagnostic?(locator: ObjectLocator): void;
}

interface PreparedPresentation {
  readonly prepared: Prepared;
  readonly probes: SimulationStructuredInput["probes"];
  readonly labels: Readonly<Record<string, string>>;
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
}

function uiProblem(code: string, message: string): Problem {
  return { code, message, stage: "input", recovery: "fix-input" };
}

/** A projection of the same prepare/start/read/cancel service used by MCP.
 * The canvas remains the editor for sources, connections and DUT instances. */
export function SpiceSimulationSurface(props: SpiceSimulationSurfaceProps) {
  const { session, project, open } = props;
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [outputLabels, setOutputLabels] = useState<Record<string, string>>({});
  const preparedPresentations = useRef(new Map<string, PreparedPresentation>());
  const [setupOpen, setSetupOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("summary");
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  useEffect(() => {
    if (!open || project.simulation) return;
    setResultsOpen(false);
    setSetupOpen(true);
  }, [open, project.simulation, props.activeDocumentId]);
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
    if (!reply.ok) {
      setProblem(reply.error);
      if (project.simulation) {
        setSetupOpen(false);
        setResultsOpen(true);
        setResultTab("console");
      } else {
        setSetupOpen(true);
        setResultsOpen(false);
      }
    } else if ("run" in reply) {
      setRun(reply.run);
      setProblem(undefined);
      if (
        reply.run.result ||
        reply.run.error ||
        ["finished", "cancelled", "lost"].includes(reply.run.state)
      ) {
        setSetupOpen(false);
        setResultsOpen(true);
        setResultTab("summary");
      }
    } else if ("prepared" in reply) {
      setPrepared(reply.prepared);
      setProblem(undefined);
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
    if (!run) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const reply = await session.handle({ operation: "read", runId: run.id });
      if (stopped) return;
      receive(reply);
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
  const execute = async (start: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const reply = await session.handle({
        operation: "prepare",
        source: {
          kind: "project-setup",
          expectedStructureRevision: project.structureRevision,
        },
      });
      if (reply.ok && "prepared" in reply) {
        const input = project.simulation?.input;
        preparedPresentations.current.set(reply.prepared.id, {
          prepared: structuredClone(reply.prepared),
          probes:
            input?.kind === "structured" ? structuredClone(input.probes) : [],
          labels: { ...outputLabels },
          analysisLabel:
            input?.kind === "structured"
              ? input.analyses
                  .map((analysis) => analysis.kind.toUpperCase())
                  .join(" + ")
              : input?.kind === "raw"
                ? "RAW"
                : "",
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
  const download = async (artifact: ArtifactRef) => {
    let offset: number | null = 0;
    let text = "";
    while (offset !== null) {
      const chunk = await session.files.handle({
        action: "artifact",
        artifactId: artifact.id,
        offset,
      });
      if (!chunk.ok) {
        setProblem(chunk.error);
        return;
      }
      if (!("text" in chunk)) return;
      text += chunk.text;
      offset = chunk.nextOffset;
    }
    const result = downloadTextArtifact(text, artifact.name);
    if (result.status === "failed")
      setProblem(uiProblem("ARTIFACT_DOWNLOAD_FAILED", result.message));
  };
  const running = run && ["running", "cancelling"].includes(run.state);
  const activeCell = project.documents.find(
    (candidate) => candidate.id === props.activeDocumentId,
  );
  const draftDut = project.documents.find(
    (candidate) => candidate.id === props.draftContext?.dutDocumentId,
  );
  const savedRoot = project.documents.find(
    (candidate) =>
      candidate.id ===
      (project.simulation?.input.kind === "structured"
        ? project.simulation.input.rootDocumentId
        : undefined),
  );
  const hasDutInstance = Boolean(
    activeCell?.instances.some(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    ),
  );
  const artifactGroups = [
    ...(prepared
      ? [
          {
            label: "Prepared input",
            identity: prepared.id,
            artifacts: prepared.artifacts,
          },
        ]
      : []),
    ...(run
      ? [
          {
            label: "Run evidence",
            identity: `${run.id} / prepared ${run.preparedId}`,
            artifacts: run.artifacts,
          },
        ]
      : []),
  ];
  const statusLabel = busy
    ? "Preparing…"
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
        : "Simulation needs attention. Open Console for details."
    : staleMessage;
  const runPresentation = run
    ? preparedPresentations.current.get(run.preparedId)
    : undefined;
  const analysisLabel = runPresentation?.analysisLabel;
  return (
    <section
      hidden={!open}
      className="spice-simulation-surface"
      aria-label="Analog simulation"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onMinimize();
      }}
    >
      <header className="simulation-taskbar">
        <div className="simulation-brand">
          <strong>Simulation</strong>
        </div>
        {draftDut || (savedRoot && savedRoot.id !== activeCell?.id) ? (
          <div
            className="simulation-cell-context"
            data-testid="simulation-cell-flow"
          >
            {draftDut ? (
              <button onClick={() => props.onOpenCell(draftDut.id)}>
                <small>DUT</small>
                {draftDut.name}
              </button>
            ) : null}
            {savedRoot && savedRoot.id !== activeCell?.id ? (
              <button onClick={() => props.onOpenCell(savedRoot.id)}>
                <small>Setup root</small>
                {savedRoot.name}
              </button>
            ) : null}
          </div>
        ) : null}
        <span
          className={`simulation-status-chip simulation-status-${run?.state ?? (prepared ? "prepared" : "idle")}`}
          role="status"
        >
          {dirty ? "Setup changed" : statusLabel}
        </span>
        <div className="simulation-task-actions">
          <button
            type="button"
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
            disabled={busy || !!running || dirty || !project.simulation}
            onClick={() => void execute(false)}
          >
            Prepare deck
          </button>
          {running ? (
            <button
              className="simulation-stop-button"
              disabled={run.state === "cancelling"}
              onClick={() =>
                void session
                  .handle({ operation: "cancel", runId: run.id })
                  .then(receive)
              }
            >
              Cancel run
            </button>
          ) : project.simulation ? (
            <button
              className="simulation-primary-button"
              disabled={busy || dirty}
              onClick={() => void execute(true)}
            >
              Run
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
          <button
            className="simulation-minimize-button"
            onClick={props.onMinimize}
            aria-label="Minimize simulation"
          >
            —
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

      {!project.simulation && !hasDutInstance ? (
        <p className="simulation-context-hint">
          This Cell has no DUT instance. You can continue here, or use Edit →
          New Testbench Cell before simulation.
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
          <strong>Needs attention</strong>
          <span>{attentionSummary}</span>
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
      ) : dirty ? (
        <div className="simulation-workspace-notice">
          Apply setup changes before running.
        </div>
      ) : null}

      {setupOpen ? (
        <SetupEditor
          key={
            JSON.stringify(project.simulation) ??
            `unsaved:${props.activeDocumentId}`
          }
          {...props}
          capabilities={capabilities}
          onDirty={setDirty}
          onProblem={setProblem}
          outputLabels={outputLabels}
          onOutputLabelChange={(probeId, label) =>
            setOutputLabels((current) => {
              if (label.trim()) return { ...current, [probeId]: label };
              const next = { ...current };
              delete next[probeId];
              return next;
            })
          }
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
          </header>
          <div className="simulation-results-body">
            {resultTab === "summary" ? (
              <div className="simulation-result-summary">
                <div>
                  <small>Run state</small>
                  <strong>{statusLabel}</strong>
                </div>
                <div>
                  <small>Input</small>
                  <strong>{run?.inputStatus ?? "current"}</strong>
                </div>
                <div>
                  <small>Analyses</small>
                  <strong>{analysisLabel || "Not configured"}</strong>
                </div>
                {run?.state === "lost" ? (
                  <p>
                    The executor response is unknown. This run was not
                    automatically resubmitted; inspect its evidence before
                    choosing a new run.
                  </p>
                ) : null}
                {runPresentation?.prepared.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
                {run?.resultPreview ? (
                  <p>
                    Result preview is bounded. Export artifacts for complete
                    data.
                  </p>
                ) : null}
              </div>
            ) : null}

            {resultTab === "plot" ? (
              <div className="simulation-analysis-view">
                {run?.result?.data?.analyses
                  .filter((analysis) => analysis.analysis === "ac")
                  .map((analysis, index) => (
                    <AcResultsExplorer
                      key={index}
                      analysis={analysis}
                      vectors={runPresentation?.prepared.vectors ?? []}
                      probes={runPresentation?.probes ?? []}
                      labels={runPresentation?.labels ?? {}}
                      {...(props.onFocusProbe
                        ? {
                            onFocusProbe: (
                              probe: SimulationStructuredInput["probes"][number],
                            ) =>
                              props.onFocusProbe?.(
                                probe,
                                runPresentation?.rootDocumentId,
                              ),
                          }
                        : {})}
                    />
                  ))}
                {run?.result?.data?.analyses
                  .filter((analysis) => analysis.analysis === "tran")
                  .map((analysis, index) => (
                    <TransientResultsExplorer
                      key={`tran-${index}`}
                      analysis={analysis}
                      vectors={runPresentation?.prepared.vectors ?? []}
                      probes={runPresentation?.probes ?? []}
                      labels={runPresentation?.labels ?? {}}
                      {...(props.onFocusProbe
                        ? {
                            onFocusProbe: (
                              probe: SimulationStructuredInput["probes"][number],
                            ) =>
                              props.onFocusProbe?.(
                                probe,
                                runPresentation?.rootDocumentId,
                              ),
                          }
                        : {})}
                    />
                  ))}
                {!run?.result?.data?.analyses.some(
                  (analysis) =>
                    analysis.analysis === "ac" || analysis.analysis === "tran",
                ) ? (
                  <p className="simulation-empty-result">
                    Run an AC or transient analysis to see a plot.
                  </p>
                ) : null}
              </div>
            ) : null}

            {resultTab === "operating-point" ? (
              <div className="simulation-analysis-view">
                {run?.result?.data?.analyses
                  .filter((analysis) => analysis.analysis === "op")
                  .map((analysis, index) => (
                    <section key={index} aria-label="OP results">
                      <h3>{analysis.plotName}</h3>
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
                    </section>
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

            {resultTab === "console" ? (
              <div className="simulation-console-view">
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
              <div className="simulation-files-view">
                {(run || prepared) && (
                  <details>
                    <summary>Input identity</summary>
                    <pre>
                      {prepared &&
                        `Prepared ${prepared.id}\nInput ${prepared.inputRevision}\n`}
                      {run &&
                        `Run ${run.id}\nPrepared ${run.preparedId}\nInput ${run.inputRevision}`}
                    </pre>
                  </details>
                )}
                {artifactGroups.map((group) => (
                  <section key={group.label} aria-label={group.label}>
                    <div>
                      <strong>{group.label}</strong>
                      <small>{group.identity}</small>
                    </div>
                    <div className="simulation-artifact-list">
                      {group.artifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          onClick={() => void download(artifact)}
                        >
                          {artifact.name}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
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

const RECOVERY_LABELS: Record<Problem["recovery"], string> = {
  "fix-input": "Review the highlighted input and apply the correction.",
  reprepare: "The input changed. Prepare it again before running.",
  "retry-same-request":
    "The response is uncertain. Refresh this run; do not start a duplicate.",
  "retry-after":
    "Keep the current work and try again after the service recovers.",
  reauthorize:
    "Reconnect the simulation session, then continue with the same Project.",
  "not-retryable":
    "This run will not be retried automatically. Preserve its files before starting another.",
};

function SimulationProblemView({
  problem,
  onFocus,
}: {
  problem: Problem;
  onFocus?: (locator: ObjectLocator) => void;
}) {
  const locator = (
    value: NonNullable<NonNullable<Problem["diagnostics"]>[number]["primary"]>,
  ): ObjectLocator => ({
    documentId: value.documentId,
    hierarchyPath: value.hierarchyPath.map((frame) => ({ ...frame })),
    kind: value.kind,
    objectId: value.objectId,
    ...(value.endpoint === undefined ? {} : { endpoint: value.endpoint }),
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
  });
  return (
    <section className="simulation-problem" aria-label="Simulation problem">
      <header>
        <strong>{problem.code}</strong>
        <small>
          {problem.stage} · {problem.recovery}
        </small>
      </header>
      <p>{problem.message}</p>
      <p>{RECOVERY_LABELS[problem.recovery]}</p>
      {problem.retryAfterMs !== undefined ? (
        <small>
          Try again after {Math.ceil(problem.retryAfterMs / 1000)} s.
        </small>
      ) : null}
      {problem.diagnostics?.length ? (
        <ul>
          {problem.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${index}`}>
              <span>
                <strong>{diagnostic.code}</strong> {diagnostic.message}
                {diagnostic.field ? <small>{diagnostic.field}</small> : null}
              </span>
              {diagnostic.primary && onFocus ? (
                <button
                  type="button"
                  onClick={() => onFocus(locator(diagnostic.primary!))}
                >
                  Show
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SetupEditor({
  project,
  activeDocumentId,
  draftContext,
  capabilities,
  onSaveSetup,
  onDirty,
  onProblem,
  pickNetsActive,
  pickedNet,
  onPickNetsChange,
  outputLabels,
  onOutputLabelChange,
}: SpiceSimulationSurfaceProps & {
  capabilities: Capabilities | undefined;
  onDirty(value: boolean): void;
  onProblem(value: Problem | undefined): void;
  outputLabels: Readonly<Record<string, string>>;
  onOutputLabelChange(probeId: string, label: string): void;
}) {
  const saved =
    project.simulation?.input.kind === "structured"
      ? project.simulation.input
      : undefined;
  const [rootId, setRootId] = useState(
    saved?.rootDocumentId ?? draftContext?.rootDocumentId ?? activeDocumentId,
  );
  const [probes, setProbes] = useState(saved?.probes ?? []);
  const root = project.documents.find((d) => d.id === rootId);
  const probeOptions = deriveSimulationProbeOptions(project, rootId);
  const probeLabels = new Map(
    [...probeOptions.voltage, ...probeOptions.sourceCurrent].map((option) => [
      option.key,
      option.label,
    ]),
  );
  const ac = saved?.analyses.find((a) => a.kind === "ac");
  const tran = saved?.analyses.find((a) => a.kind === "tran");
  const [acEnabled, setAcEnabled] = useState(!!ac);
  const [tranEnabled, setTranEnabled] = useState(!!tran);
  const [profileId, setProfileId] = useState(
    saved?.environment.profileId ?? DEVELOPMENT_PROFILE_ID,
  );
  const rawSaved =
    project.simulation?.input.kind === "raw"
      ? project.simulation.input
      : undefined;
  const [switchFromRaw, setSwitchFromRaw] = useState(false);
  const [pickCandidates, setPickCandidates] = useState<
    readonly SimulationProbeOption[]
  >([]);
  useEffect(() => {
    const defaultProfileId = capabilities?.profiles[0]?.id;
    if (
      !saved?.environment.profileId &&
      defaultProfileId &&
      (!profileId || profileId === DEVELOPMENT_PROFILE_ID)
    )
      setProfileId(defaultProfileId);
  }, [capabilities?.profiles[0]?.id, profileId, saved?.environment.profileId]);
  useEffect(() => {
    if (!pickedNet) return;
    const candidates = matchSimulationVoltageProbeOptions(
      project,
      probeOptions.voltage,
      pickedNet,
    );
    if (candidates.length > 1) {
      setPickCandidates(candidates);
      onProblem(undefined);
      return;
    }
    const option = candidates[0];
    if (!option) {
      onProblem(
        uiProblem(
          "PROBE_TARGET_UNAVAILABLE",
          "That Net is outside the selected Testbench occurrence. Choose it from the Output list or change the Testbench Cell.",
        ),
      );
      return;
    }
    const key = simulationProbeTargetKey(option.target);
    if (probes.some((probe) => simulationProbeTargetKey(probe) === key)) return;
    setProbes((current) => [...current, probeFromOption(option)]);
    onDirty(true);
    setPickCandidates([]);
    onProblem(undefined);
  }, [pickedNet?.sequence]);
  useEffect(() => {
    onDirty(false);
  }, []);
  if (rawSaved && !switchFromRaw) {
    return (
      <aside className="simulation-setup-panel" aria-label="Simulation setup">
        <header>
          <div>
            <small>Simulation</small>
            <strong>Raw setup</strong>
          </div>
        </header>
        <div className="simulation-raw-summary">
          <p>
            <strong>{rawSaved.entry}</strong>
          </p>
          <p>
            {rawSaved.files.length} authored file(s) ·{" "}
            {rawSaved.dependencies.length} dependency declaration(s)
          </p>
          <p>Profile: {rawSaved.environment.profileId}</p>
          <button type="button" onClick={() => setSwitchFromRaw(true)}>
            Switch to structured setup…
          </button>
          <button type="button" onClick={() => onSaveSetup(null)}>
            Delete setup
          </button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="simulation-setup-panel" aria-label="Simulation setup">
      <header>
        <div>
          <small>Simulation</small>
          <strong>Setup</strong>
        </div>
      </header>
      <form
        onChange={() => onDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const parsed = SimulationSetupSchema.safeParse({
            version: 1,
            input: {
              kind: "structured",
              rootDocumentId: rootId,
              analyses: [
                ...(data.has("op") ? [{ kind: "op" }] : []),
                ...(data.has("ac")
                  ? [
                      {
                        kind: "ac",
                        sweep: data.get("sweep"),
                        points: Number(data.get("points")),
                        startHz: Number(data.get("startHz")),
                        stopHz: Number(data.get("stopHz")),
                      },
                    ]
                  : []),
                ...(data.has("tran")
                  ? [
                      {
                        kind: "tran",
                        stepSeconds: Number(data.get("tranStepSeconds")),
                        stopSeconds: Number(data.get("tranStopSeconds")),
                        ...optionalFormNumber(
                          data,
                          "tranStartSeconds",
                          "startSeconds",
                        ),
                        ...optionalFormNumber(
                          data,
                          "tranMaxStepSeconds",
                          "maxStepSeconds",
                        ),
                      },
                    ]
                  : []),
              ],
              probes,
              environment: {
                profileId: data.get("profileId"),
                ...(data.get("corner") ? { corner: data.get("corner") } : {}),
                ...(data.get("temperatureC")
                  ? { temperatureC: Number(data.get("temperatureC")) }
                  : {}),
              },
            },
          });
          if (!parsed.success) {
            onProblem(
              uiProblem(
                "SIMULATION_SETUP_INVALID",
                parsed.error.issues.map((i) => i.message).join("\n"),
              ),
            );
            return;
          }
          if (onSaveSetup(parsed.data)) {
            onDirty(false);
            onProblem(undefined);
          } else
            onProblem(
              uiProblem(
                "SIMULATION_SETUP_NOT_APPLIED",
                "Setup was not applied. See the editor status; your draft is retained.",
              ),
            );
        }}
      >
        <label>
          Testbench Cell
          <select value={rootId} onChange={(e) => setRootId(e.target.value)}>
            {!root && <option value={rootId}>Missing: {rootId}</option>}
            {project.documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Environment profile
          <select
            name="profileId"
            required
            value={profileId}
            onChange={(event) => setProfileId(event.currentTarget.value)}
          >
            {!profileId ? (
              <option value="" disabled>
                {capabilities ? "No profiles available" : "Loading profiles…"}
              </option>
            ) : null}
            {profileId &&
            !capabilities?.profiles.some(
              (profile) => profile.id === profileId,
            ) ? (
              <option value={profileId}>{profileId}</option>
            ) : null}
            {capabilities?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id}
              </option>
            ))}
          </select>
        </label>
        <div className="simulation-setup-group simulation-inline-fields columns-2">
          <label>
            Corner
            <input
              name="corner"
              defaultValue={saved?.environment.corner ?? ""}
              placeholder="Profile default"
            />
          </label>
          <label>
            Temperature (°C)
            <input
              name="temperatureC"
              type="number"
              step="any"
              defaultValue={saved?.environment.temperatureC ?? ""}
              placeholder="Profile default"
            />
          </label>
        </div>
        <fieldset className="simulation-setup-group simulation-analysis-row">
          <legend>Analyses</legend>
          <label>
            <input
              name="op"
              type="checkbox"
              defaultChecked={
                !saved || saved.analyses.some((a) => a.kind === "op")
              }
            />
            OP
          </label>
          <label>
            <input
              name="ac"
              type="checkbox"
              checked={acEnabled}
              onChange={(event) => setAcEnabled(event.currentTarget.checked)}
            />
            AC
          </label>
          <label>
            <input
              name="tran"
              type="checkbox"
              checked={tranEnabled}
              onChange={(event) => setTranEnabled(event.currentTarget.checked)}
            />
            TRAN
          </label>
        </fieldset>
        {acEnabled ? (
          <div className="simulation-setup-group simulation-analysis-settings">
            <label>
              AC sweep
              <select name="sweep" defaultValue={ac?.sweep ?? "dec"}>
                <option value="dec">Decade</option>
                <option value="oct">Octave</option>
                <option value="lin">Linear</option>
              </select>
            </label>
            <div className="simulation-inline-fields columns-3">
              <label>
                Points
                <input
                  name="points"
                  type="number"
                  min="1"
                  defaultValue={ac?.points ?? 20}
                />
              </label>
              <label>
                Start (Hz)
                <input
                  name="startHz"
                  type="number"
                  step="any"
                  defaultValue={ac?.startHz ?? 1}
                />
              </label>
              <label>
                Stop (Hz)
                <input
                  name="stopHz"
                  type="number"
                  step="any"
                  defaultValue={ac?.stopHz ?? 1e6}
                />
              </label>
            </div>
          </div>
        ) : null}
        {tranEnabled ? (
          <div className="simulation-setup-group simulation-inline-fields columns-2">
            <label>
              TRAN step (s)
              <input
                name="tranStepSeconds"
                type="number"
                step="any"
                defaultValue={tran?.stepSeconds ?? 1e-9}
              />
            </label>
            <label>
              TRAN stop (s)
              <input
                name="tranStopSeconds"
                type="number"
                step="any"
                defaultValue={tran?.stopSeconds ?? 1e-6}
              />
            </label>
            <label>
              TRAN start saving (s)
              <input
                name="tranStartSeconds"
                type="number"
                step="any"
                min="0"
                defaultValue={tran?.startSeconds ?? ""}
                placeholder="0"
              />
            </label>
            <label>
              TRAN maximum step (s)
              <input
                name="tranMaxStepSeconds"
                type="number"
                step="any"
                min="0"
                defaultValue={tran?.maxStepSeconds ?? ""}
                placeholder="Simulator default"
              />
            </label>
          </div>
        ) : null}
        <ProbeSelect
          label="Add voltage probe"
          placeholder="Choose a Net"
          options={probeOptions.voltage}
          probes={probes}
          onAdd={(option) => {
            setProbes([...probes, probeFromOption(option)]);
            onDirty(true);
          }}
          trailingAction={
            <button
              type="button"
              className={pickNetsActive ? "simulation-pick-active" : undefined}
              aria-pressed={pickNetsActive}
              onClick={() => onPickNetsChange?.(!pickNetsActive)}
            >
              {pickNetsActive ? "Picking Nets…" : "Pick on canvas"}
            </button>
          }
        />
        {pickCandidates.length > 1 ? (
          <fieldset
            className="simulation-setup-group"
            aria-label="Choose Net occurrence"
          >
            <legend>Choose occurrence</legend>
            {pickCandidates.map((option) => (
              <button
                type="button"
                key={option.key}
                onClick={() => {
                  setProbes((current) => [...current, probeFromOption(option)]);
                  setPickCandidates([]);
                  onDirty(true);
                }}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        ) : null}
        <ProbeSelect
          label="Add current output"
          placeholder="Choose a voltage-source branch"
          options={probeOptions.sourceCurrent}
          probes={probes}
          onAdd={(option) => {
            setProbes([...probes, probeFromOption(option)]);
            onDirty(true);
          }}
        />
        <ul className="simulation-probe-list" aria-label="Configured Outputs">
          {probes.map((p) => (
            <li key={p.id}>
              <span>
                <input
                  aria-label={`Output name for ${probeLabels.get(simulationProbeTargetKey(p)) ?? p.id}`}
                  value={outputLabels[p.id] ?? ""}
                  placeholder={
                    probeLabels.get(simulationProbeTargetKey(p)) ??
                    (p.kind === "net-voltage"
                      ? simulationProbeTargetKey(p)
                      : p.instanceId)
                  }
                  onChange={(event) => {
                    event.stopPropagation();
                    const label = event.currentTarget.value;
                    onOutputLabelChange(p.id, label);
                  }}
                />
                <small>
                  {p.kind === "net-voltage" ? "Voltage" : "Current"} ·{" "}
                  {probeLabels.get(simulationProbeTargetKey(p)) ??
                    "Target unavailable"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Remove probe"
                onClick={() => {
                  setProbes(probes.filter((v) => v.id !== p.id));
                  onOutputLabelChange(p.id, "");
                  onDirty(true);
                }}
              >
                Remove probe
              </button>
            </li>
          ))}
        </ul>
        <button type="submit">Apply setup</button>
        {saved && (
          <button type="button" onClick={() => onSaveSetup(null)}>
            Delete setup
          </button>
        )}
      </form>
    </aside>
  );
}

function optionalFormNumber(
  data: FormData,
  formName: "tranStartSeconds" | "tranMaxStepSeconds",
  outputName: "startSeconds" | "maxStepSeconds",
): Partial<Record<typeof outputName, number>> {
  const value = String(data.get(formName) ?? "").trim();
  return value ? { [outputName]: Number(value) } : {};
}

function probeFromOption(
  option: SimulationProbeOption,
): SimulationStructuredInput["probes"][number] {
  const target = option.target;
  if (target.kind === "net-voltage") {
    return {
      id: crypto.randomUUID(),
      kind: target.kind,
      documentId: target.documentId,
      anchor: structuredClone(target.anchor),
      occurrence: [...target.occurrence],
    };
  }
  return {
    id: crypto.randomUUID(),
    kind: target.kind,
    documentId: target.documentId,
    instanceId: target.instanceId,
    occurrence: [...target.occurrence],
  };
}

function ProbeSelect({
  label,
  placeholder,
  options,
  probes,
  onAdd,
  trailingAction,
}: {
  label: string;
  placeholder: string;
  options: readonly SimulationProbeOption[];
  probes: SimulationStructuredInput["probes"];
  onAdd(option: SimulationProbeOption): void;
  trailingAction?: ReactNode;
}) {
  const selected = new Set(probes.map(simulationProbeTargetKey));
  return (
    <label className="simulation-probe-select">
      <span>{label}</span>
      <span className="simulation-probe-control">
        <select
          value=""
          onChange={(event) => {
            const option = options.find(
              (candidate) => candidate.key === event.target.value,
            );
            if (option) onAdd(option);
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option
              key={option.key}
              value={option.key}
              disabled={selected.has(option.key)}
            >
              {option.label}
            </option>
          ))}
        </select>
        {trailingAction}
      </span>
    </label>
  );
}
